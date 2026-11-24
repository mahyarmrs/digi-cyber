package com.digicyber.client.vpn

import android.content.Context
import android.net.ConnectivityManager
import android.net.LocalSocket
import android.net.LocalSocketAddress
import android.net.Network
import android.os.Build
import android.os.ParcelFileDescriptor
import android.system.Os
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileDescriptor
import java.io.IOException
import java.net.InetAddress
import java.util.ArrayDeque
import kotlin.concurrent.thread
import com.digicyber.client.data.AppLog
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

// OpenVPN 2.7, built by CI for Android as libovpnexec.so, runs as its own process. Built for Android it
// opens no tun device and sets no routes: over its management socket it tells the app the address,
// routes and DNS servers it wants (NEED-OK IFCONFIG, ROUTE, DNSSERVER, ...), then asks for the tunnel
// (OPENTUN), which the app opens with VpnService and passes back as a file descriptor. Every socket it
// opens to the server comes over too (PROTECTFD), so the app can keep it out of the tunnel.
// The protocol is OpenVPN's doc/android.txt.
class OpenVpn(private val context: Context, private val host: Host) {
    interface Host {
        fun protect(fd: Int): Boolean
        fun openTun(spec: TunSpec): ParcelFileDescriptor?
    }

    data class Route(val address: String, val prefix: Int)

    data class TunSpec(
        val address: Route?,
        val address6: Route?,
        val mtu: Int,
        val routes: List<Route>,
        val routes6: List<Route>,
        val dns: List<String>,
        val domain: String?,
    )

    enum class Outcome { Connected, AuthFailed, VpnDenied, Failed }

    companion object {
        private const val TAG = "openvpn"
        // OpenVPN's stand-in for the network's own gateway on Android (127.'d'.'g'.'w'): routes through it
        // are meant to bypass the tunnel, which the app's own traffic already does.
        private const val NET_GATEWAY = "127.100.103.119"

        fun binary(context: Context): File = File(context.applicationInfo.nativeLibraryDir, "libovpnexec.so")

        fun prefixOf(netmask: String): Int? = runCatching {
            val bits = InetAddress.getByName(netmask).address.fold(0) { acc, b -> acc + Integer.bitCount(b.toInt() and 0xff) }
            bits
        }.getOrNull()

        // VpnService takes a route only with the host bits cleared.
        fun network(address: String, prefix: Int): Route? = runCatching {
            val bytes = InetAddress.getByName(address).address
            for (i in bytes.indices) {
                val keep = (prefix - i * 8).coerceIn(0, 8)
                bytes[i] = (bytes[i].toInt() and (0xff shl (8 - keep)) and 0xff).toByte()
            }
            Route(InetAddress.getByAddress(bytes).hostAddress ?: return null, prefix)
        }.getOrNull()
    }

    var onReconnecting: (() -> Unit)? = null
    var onReconnected: (() -> Unit)? = null
    var onLost: (() -> Unit)? = null

    private val dir = File(context.noBackupFilesDir, "openvpn")
    private val result = CompletableDeferred<Outcome>()
    private val writeLock = Any()
    private val received = ArrayDeque<FileDescriptor>()
    private var process: Process? = null
    private var socket: LocalSocket? = null
    private var username: String? = null
    private var password: String? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    @Volatile private var stopping = false
    @Volatile private var connected = false

    // What the next tunnel is to look like, gathered from the NEED-OK requests before OPENTUN.
    private var address: Route? = null
    private var address6: Route? = null
    private var mtu = 1500
    private val routes = mutableListOf<Route>()
    private val routes6 = mutableListOf<Route>()
    private val dns = mutableListOf<String>()
    private var domain: String? = null
    private var pending: TunSpec? = null
    private var opened: TunSpec? = null

    suspend fun start(profile: String, timeoutMs: Long): Outcome = withContext(Dispatchers.IO) {
        val exe = binary(context)
        if (!exe.exists()) {
            AppLog.w(TAG, "$exe is missing")
            return@withContext Outcome.Failed
        }
        dir.mkdirs()
        val mgmt = File(dir, "mgmt")
        val conf = File(dir, "profile.ovpn")
        mgmt.delete()
        val prepared = OpenVpnProfile.prepare(profile, mgmt.absolutePath)
        username = prepared.username
        password = prepared.password
        conf.writeText(prepared.config)
        val proc = try {
            // Android has no /tmp, OpenVPN's default for the files it writes on the way.
            ProcessBuilder(exe.absolutePath, "--config", conf.absolutePath, "--tmp-dir", context.cacheDir.absolutePath)
                .directory(dir).redirectErrorStream(true).start()
        } catch (e: IOException) {
            AppLog.w(TAG, "cannot start OpenVPN: $e")
            conf.delete()
            return@withContext Outcome.Failed
        }
        process = proc
        thread(name = "openvpn-log", isDaemon = true) {
            runCatching { proc.inputStream.bufferedReader().forEachLine { AppLog.i(TAG, it) } }
        }
        val sock = connectManagement(mgmt, proc)
        // OpenVPN has read the whole profile before it opens its management socket.
        conf.delete()
        if (sock == null) {
            stop()
            return@withContext Outcome.Failed
        }
        socket = sock
        thread(name = "openvpn-management", isDaemon = true) { readLoop(sock) }
        val outcome = withTimeoutOrNull(timeoutMs) { result.await() } ?: Outcome.Failed
        if (outcome == Outcome.Connected) watchNetwork() else stop()
        outcome
    }

    // SIGINT lets OpenVPN tell the server it is leaving (the profile asks for the exit notification,
    // OpenVpnProfile.prepare); its exit closes the tunnel. The notification takes about a second, so
    // OpenVPN gets five before it is destroyed.
    fun stop() {
        stopping = true
        unwatchNetwork()
        send("signal SIGINT")
        process?.let { proc ->
            val deadline = System.currentTimeMillis() + 5000
            while (alive(proc) && System.currentTimeMillis() < deadline) Thread.sleep(50)
            if (alive(proc)) proc.destroy()
        }
        socket?.let { sock ->
            runCatching { sock.shutdownInput() }
            runCatching { sock.close() }
        }
        synchronized(received) {
            while (received.isNotEmpty()) runCatching { Os.close(received.poll()) }
        }
        File(dir, "profile.ovpn").delete()
        File(dir, "mgmt").delete()
        result.complete(Outcome.Failed)
    }

    private fun alive(proc: Process): Boolean = try {
        proc.exitValue()
        false
    } catch (e: IllegalThreadStateException) {
        true
    }

    private fun connectManagement(path: File, proc: Process): LocalSocket? {
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline && !stopping && alive(proc)) {
            if (path.exists()) {
                val sock = LocalSocket()
                try {
                    sock.connect(LocalSocketAddress(path.absolutePath, LocalSocketAddress.Namespace.FILESYSTEM))
                    return sock
                } catch (e: IOException) {
                    runCatching { sock.close() }
                }
            }
            Thread.sleep(100)
        }
        AppLog.w(TAG, "no management socket")
        return null
    }

    private fun send(vararg lines: String) {
        val sock = socket ?: return
        synchronized(writeLock) {
            try {
                sock.outputStream.write(lines.joinToString("") { "$it\n" }.toByteArray())
                sock.outputStream.flush()
            } catch (e: IOException) {
                if (!stopping) AppLog.w(TAG, "management write: $e")
            }
        }
    }

    // The tunnel's descriptor goes along with the confirmation, as ancillary data.
    private fun sendWithFd(line: String, fd: FileDescriptor) {
        val sock = socket ?: return
        synchronized(writeLock) {
            try {
                sock.setFileDescriptorsForSend(arrayOf(fd))
                sock.outputStream.write("$line\n".toByteArray())
                sock.outputStream.flush()
            } catch (e: IOException) {
                AppLog.w(TAG, "management write: $e")
            } finally {
                sock.setFileDescriptorsForSend(null)
            }
        }
    }

    private fun quote(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    private fun fail(outcome: Outcome) {
        result.complete(outcome)
    }

    private fun readLoop(sock: LocalSocket) {
        val input = sock.inputStream
        val buffer = ByteArray(4096)
        val line = ByteArrayOutputStream()
        try {
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                sock.ancillaryFileDescriptors?.let { fds -> synchronized(received) { fds.forEach { received.add(it) } } }
                for (i in 0 until n) {
                    val b = buffer[i]
                    if (b == '\n'.code.toByte()) {
                        handle(line.toString(Charsets.UTF_8.name()).trimEnd('\r'))
                        line.reset()
                    } else {
                        line.write(b.toInt())
                    }
                }
            }
        } catch (e: IOException) {
            if (!stopping) AppLog.w(TAG, "management read: $e")
        }
        val wasConnected = connected
        fail(Outcome.Failed)
        if (wasConnected && !stopping) onLost?.invoke()
    }

    private fun handle(line: String) {
        when {
            line.startsWith(">HOLD:") -> send("state on", "hold release")
            line.startsWith(">PASSWORD:Need 'Auth'") -> {
                val user = username
                val pass = password
                if (user == null || pass == null) {
                    AppLog.w(TAG, "the profile carries no login")
                    fail(Outcome.AuthFailed)
                    send("signal SIGTERM")
                } else {
                    send("username \"Auth\" ${quote(user)}", "password \"Auth\" ${quote(pass)}")
                }
            }
            line.startsWith(">PASSWORD:Verification Failed") -> {
                AppLog.w(TAG, line)
                fail(Outcome.AuthFailed)
            }
            line.startsWith(">PASSWORD:Auth-Token") -> Unit
            line.startsWith(">PASSWORD:") -> {
                // A key passphrase or a challenge: nothing the app can answer.
                AppLog.w(TAG, line)
                fail(Outcome.Failed)
                send("signal SIGTERM")
            }
            line.startsWith(">NEED-OK:") -> needOk(line)
            line.startsWith(">STATE:") -> state(line)
            line.startsWith(">FATAL:") -> AppLog.w(TAG, line)
        }
    }

    private fun state(line: String) {
        when (line.removePrefix(">STATE:").split(',').getOrNull(1)) {
            "CONNECTED" -> {
                if (!connected) {
                    connected = true
                    result.complete(Outcome.Connected)
                } else {
                    onReconnected?.invoke()
                }
            }
            "RECONNECTING" -> if (connected) onReconnecting?.invoke()
        }
    }

    private fun needOk(line: String) {
        val m = Regex("^>NEED-OK:Need '([^']+)' confirmation MSG:(.*)$").find(line) ?: return
        val what = m.groupValues[1]
        val msg = m.groupValues[2].trim()
        val parts = msg.split(Regex("\\s+"))
        when (what) {
            "PROTECTFD" -> {
                val fd = synchronized(received) { received.poll() }
                if (fd != null) {
                    try {
                        ParcelFileDescriptor.dup(fd).use { if (!host.protect(it.fd)) AppLog.w(TAG, "protect failed") }
                    } catch (e: IOException) {
                        AppLog.w(TAG, "protect: $e")
                    }
                    runCatching { Os.close(fd) }
                }
                reply(what, "ok")
            }
            // "local netmask mtu topology": subnet gives a netmask; net30 and p2p give the peer's address.
            "IFCONFIG" -> {
                val local = parts.getOrNull(0)
                val second = parts.getOrNull(1)
                parts.getOrNull(2)?.toIntOrNull()?.let { mtu = it }
                if (local != null && second != null) {
                    when (parts.getOrNull(3)) {
                        "net30" -> address = Route(local, 30)
                        "p2p" -> {
                            address = Route(local, 32)
                            network(second, 32)?.let { routes += it }
                        }
                        else -> {
                            val prefix = prefixOf(second) ?: 32
                            address = Route(local, prefix)
                        }
                    }
                    address?.let { a -> network(a.address, a.prefix)?.let { routes += it } }
                }
                reply(what, "ok")
            }
            // "address/bits mtu"
            "IFCONFIG6" -> {
                val (addr, bits) = parts.getOrNull(0)?.split('/')?.let { it.getOrNull(0) to it.getOrNull(1)?.toIntOrNull() } ?: (null to null)
                parts.getOrNull(1)?.toIntOrNull()?.let { mtu = it }
                if (addr != null && bits != null) {
                    address6 = Route(addr, bits)
                    network(addr, bits)?.let { routes6 += it }
                }
                reply(what, "ok")
            }
            // "network netmask gateway [dev name]"
            "ROUTE" -> {
                val net = parts.getOrNull(0)
                val prefix = parts.getOrNull(1)?.let { prefixOf(it) }
                if (net != null && prefix != null && parts.getOrNull(2) != NET_GATEWAY) network(net, prefix)?.let { routes += it }
                reply(what, "ok")
            }
            // "network/bits device"
            "ROUTE6" -> {
                val spec = parts.getOrNull(0)?.split('/')
                val bits = spec?.getOrNull(1)?.toIntOrNull()
                if (spec != null && bits != null) network(spec[0], bits)?.let { routes6 += it }
                reply(what, "ok")
            }
            "DNSSERVER", "DNS6SERVER" -> {
                if (msg.isNotEmpty()) dns += msg
                reply(what, "ok")
            }
            "DNSDOMAIN" -> {
                domain = msg.ifEmpty { null }
                reply(what, "ok")
            }
            // The same tunnel as before is kept; anything new is opened before the old one closes.
            "PERSIST_TUN_ACTION" -> {
                val spec = collect()
                pending = spec
                reply(what, if (spec == opened) "NOACTION" else "OPEN_BEFORE_CLOSE")
            }
            "OPENTUN" -> openTun()
            else -> reply(what, "ok")
        }
    }

    private fun reply(what: String, answer: String) = send("needok '$what' $answer")

    // The spec gathered so far; the requests for the next tunnel start afresh.
    private fun collect(): TunSpec {
        val spec = TunSpec(address, address6, mtu, routes.distinct(), routes6.distinct(), dns.distinct(), domain)
        address = null
        address6 = null
        mtu = 1500
        routes.clear()
        routes6.clear()
        dns.clear()
        domain = null
        return spec
    }

    private fun openTun() {
        val spec = pending ?: collect()
        pending = null
        val tun = try {
            host.openTun(spec)
        } catch (e: Exception) {
            AppLog.w(TAG, "establish: $e")
            null
        }
        if (tun == null) {
            reply("OPENTUN", "cancel")
            fail(Outcome.VpnDenied)
            return
        }
        sendWithFd("needok 'OPENTUN' ok", tun.fileDescriptor)
        // OpenVPN holds its own copy now; the tunnel lives as long as OpenVPN does.
        runCatching { tun.close() }
        opened = spec
    }

    // On a new network (Wi-Fi to mobile data and back) OpenVPN reconnects at once instead of waiting for its timeout.
    private fun watchNetwork() {
        if (Build.VERSION.SDK_INT < 24) return
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            private var current: Network? = null

            override fun onAvailable(network: Network) {
                val previous = current
                current = network
                if (previous != null && previous != network && !stopping) send("network-change")
            }
        }
        if (runCatching { manager.registerDefaultNetworkCallback(callback) }.isSuccess) networkCallback = callback
    }

    private fun unwatchNetwork() {
        val callback = networkCallback ?: return
        networkCallback = null
        runCatching { (context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)?.unregisterNetworkCallback(callback) }
    }
}
