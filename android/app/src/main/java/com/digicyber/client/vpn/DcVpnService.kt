package com.digicyber.client.vpn

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.system.OsConstants
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.URL
import com.digicyber.client.data.AppLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import com.digicyber.client.R
import com.digicyber.client.core.Core
import com.digicyber.client.data.Config
import com.digicyber.client.data.ConnState
import com.digicyber.client.data.Repo
import com.digicyber.client.data.Settings
import com.digicyber.client.data.Status
import com.digicyber.client.ui.MainActivity

// Xray runs the panel's outbound behind a local SOCKS port; hev-socks5-tunnel carries the VPN
// interface's packets to it. OpenVPN runs as its own process and is handed the VPN interface (OpenVpn.kt).
// The app itself is left out of the VPN, so the engines' own connections leave directly.
class DcVpnService : VpnService() {
    companion object {
        const val ACTION_CONNECT = "com.digicyber.client.CONNECT"
        const val ACTION_DISCONNECT = "com.digicyber.client.DISCONNECT"
        private const val EXTRA_LOCATION = "location"
        private const val FASTEST = -1
        private const val MTU = 8500
        private const val NOTICE_CHANNEL = "notices"
        private const val OPENVPN_TIMEOUT_MS = 35_000L
        private const val TAG = "DcVpn"

        fun connect(context: Context, locationId: Int?) {
            context.startService(Intent(context, DcVpnService::class.java).setAction(ACTION_CONNECT).putExtra(EXTRA_LOCATION, locationId ?: FASTEST))
        }

        fun disconnect(context: Context) {
            context.startService(Intent(context, DcVpnService::class.java).setAction(ACTION_DISCONNECT))
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var tun: ParcelFileDescriptor? = null
    @Volatile private var openvpn: OpenVpn? = null
    // The connection that is up, until stopEngines takes it down, and the tunnel address OpenVPN was given.
    @Volatile private var connectedTo: Status? = null
    @Volatile private var openvpnAddress: String? = null
    private var work: Job? = null
    private var refresher: Job? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_DISCONNECT) {
            AppLog.i(TAG, "disconnecting")
            work?.cancel()
            work = scope.launch {
                set(Status(ConnState.Disconnecting, VpnState.status.value.locationId))
                stopEngines()
                set(Status(ConnState.Disconnected, VpnState.status.value.locationId))
                stopSelf()
            }
            return START_NOT_STICKY
        }
        // ACTION_CONNECT from the app, or the system starting an always-on VPN.
        val requested = intent?.takeIf { it.hasExtra(EXTRA_LOCATION) }?.getIntExtra(EXTRA_LOCATION, FASTEST)
        val locationId = when (requested) {
            null -> Repo.settings.value.locationId
            FASTEST -> null
            else -> requested
        }
        work?.cancel()
        work = scope.launch { connect(locationId) }
        return START_STICKY
    }

    override fun onRevoke() {
        AppLog.w(TAG, "Android took the VPN away (another VPN started, or the permission was revoked)")
        scope.launch {
            stopEngines()
            set(Status(ConnState.Disconnected, error = "connection_lost"))
            stopSelf()
        }
    }

    override fun onDestroy() {
        refresher?.cancel()
        openvpn?.let { runCatching { it.stop() } }
        openvpn = null
        runCatching { if (TProxyService.TProxyIsRunning()) TProxyService.TProxyStopService() }
        runCatching { tun?.close() }
        runCatching { Core.stop() }
        if (VpnState.status.value.state != ConnState.Disconnected) set(Status(ConnState.Disconnected))
        scope.cancel()
        super.onDestroy()
    }

    private fun set(status: Status) {
        VpnState.status.value = status
    }

    // Called off the main thread: once the tunnel is down, the panel hears that this device left the
    // connection it was on, so its seat is free at once and not only after WireGuard's quiet.
    private fun stopEngines() {
        val left = connectedTo
        val address = openvpnAddress
        connectedTo = null
        openvpnAddress = null
        refresher?.cancel()
        openvpn?.let { runCatching { it.stop() } }
        openvpn = null
        runCatching { if (TProxyService.TProxyIsRunning()) TProxyService.TProxyStopService() }
        runCatching { tun?.close() }
        tun = null
        runCatching { Core.stop() }
        left?.takeIf { it.protocol.isNotEmpty() }?.let { conn ->
            Repo.tellPanelLeft(conn.protocol, conn.serverId, if (conn.protocol == "openvpn") address else null)
        }
    }

    // geoip.dat and geosite.dat ship in the APK and are copied once per version.
    private fun assetDir(): String {
        val dir = File(filesDir, "xray").apply { mkdirs() }
        val marker = File(dir, "version")
        val version = packageManager.getPackageInfo(packageName, 0).lastUpdateTime.toString()
        if (marker.takeIf { it.exists() }?.readText() != version) {
            for (name in listOf("geoip.dat", "geosite.dat")) {
                assets.open(name).use { input -> File(dir, name).outputStream().use { input.copyTo(it) } }
            }
            marker.writeText(version)
        }
        return dir.absolutePath
    }

    private fun freePort(): Int = ServerSocket(0).use { it.localPort }

    // The config works only if an empty page comes back through it.
    private fun probe(port: Int): Boolean = runCatching {
        val conn = URL("https://www.gstatic.com/generate_204").openConnection(Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", port))) as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        try {
            val code = conn.responseCode
            if (code != 204) AppLog.w(TAG, "the test page answered $code")
            code == 204
        } finally {
            conn.disconnect()
        }
    }.onFailure { AppLog.w(TAG, "test page: $it") }.getOrDefault(false)

    private suspend fun connect(locationId: Int?) {
        stopEngines()
        val profile = Repo.profile.value
        val settings = Repo.settings.value
        if (profile == null) {
            set(Status(ConnState.Disconnected, locationId, error = "no_config"))
            return
        }
        val list = Candidates.forLocation(profile, locationId, settings.protocol, Repo.pings.value)
        AppLog.i(TAG, "connect to ${locationId?.let { "location $it" } ?: "the fastest location"}, protocol ${settings.protocol}: ${list.size} config(s) to try")
        if (list.isEmpty()) {
            set(Status(ConnState.Disconnected, locationId, error = "no_config"))
            return
        }
        set(Status(ConnState.Connecting, locationId))
        val dns = XrayConfig.dnsServers(settings.dns)
        Core.setAssetDir(assetDir())
        for ((i, config) in list.withIndex()) {
            if (!scope.isActive) return
            set(Status(ConnState.Connecting, locationId, config.locationId, config.name, config.protocol))
            AppLog.i(TAG, "(${i + 1}/${list.size}) trying ${config.protocol} \"${config.name}\" of location ${config.locationId ?: "-"}")
            val started = System.currentTimeMillis()
            val attempt = try {
                if (config.protocol == "openvpn") startOpenVpn(config, settings) else startXray(config, settings, dns)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                AppLog.e(TAG, "failed", e)
                Attempt.Failed
            }
            AppLog.i(TAG, "${if (attempt == Attempt.Started) "connected" else "did not connect"} (${System.currentTimeMillis() - started} ms)")
            when (attempt) {
                Attempt.Failed -> continue
                Attempt.Denied -> {
                    set(Status(ConnState.Disconnected, locationId, error = "vpn_denied"))
                    return
                }
                Attempt.Started -> {
                    Repo.updateSettings { it.copy(locationId = locationId) }
                    val up = Status(ConnState.Connected, locationId, config.locationId, config.name, config.protocol, System.currentTimeMillis())
                    connectedTo = up
                    set(up)
                    startRefresher()
                    return
                }
            }
        }
        AppLog.i(TAG, "no config connected")
        set(Status(ConnState.Disconnected, locationId, error = "all_failed"))
    }

    private enum class Attempt { Started, Failed, Denied }

    private val logDir: File get() = File(filesDir, "logs").apply { mkdirs() }
    private val xrayLog: File get() = File(logDir, "xray.log")

    // Xray's own log file goes into the app's log after each step; Xray keeps appending to it.
    private fun drainXrayLog() {
        runCatching {
            val f = xrayLog
            if (!f.exists()) return
            val text = f.readText()
            if (text.isNotBlank()) AppLog.write("xray", text)
            RandomAccessFile(f, "rw").use { it.setLength(0) }
        }
    }

    // The system's resolver, before the tunnel is up (and the app is outside it anyway): IPv4 when
    // there is one, IPv6 otherwise. Xray then never asks its own tunnel where its server is.
    private fun resolve(names: List<String>): Map<String, List<String>> {
        val out = ConcurrentHashMap<String, List<String>>()
        val workers = names.map { name ->
            thread(isDaemon = true, name = "resolve") {
                val all = runCatching { InetAddress.getAllByName(name).toList() }.getOrNull() ?: return@thread
                val v4 = all.filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }
                val v6 = all.filterIsInstance<Inet6Address>().mapNotNull { it.hostAddress?.substringBefore('%') }
                val ips = (v4.ifEmpty { v6 }).distinct()
                if (ips.isNotEmpty()) out[name] = ips
            }
        }
        val deadline = System.currentTimeMillis() + 6_000
        for (w in workers) w.join(maxOf(1L, deadline - System.currentTimeMillis()))
        return HashMap(out)
    }

    private fun startXray(config: Config, settings: Settings, dns: List<String>): Attempt {
        val outbound = XrayConfig.proxyOutboundFor(config.protocol, config.link, config.outbound)
        if (outbound == null) {
            AppLog.w(TAG, "${config.name}: no outbound to run")
            return Attempt.Failed
        }
        val names = XrayConfig.serverNames(outbound)
        val hosts = resolve(names)
        for (name in names) AppLog.i(TAG, hosts[name]?.let { "$name is ${it.joinToString(", ")}" } ?: "$name did not resolve; Xray will try it itself")
        val port = freePort()
        runCatching { xrayLog.delete() }
        fun run(level: String): Boolean {
            val json = XrayConfig.build(outbound, port, settings.iranDirect, settings.adBlock, dns, hosts, level, xrayLog.absolutePath)
            return runCatching { Core.start(json) }.onFailure { AppLog.w(TAG, "Xray refused the config: ${it.message}") }.isSuccess
        }
        // Tested with Xray's detailed log, which then shows only the test page's connection.
        if (!run("info")) {
            drainXrayLog()
            return Attempt.Failed
        }
        val started = System.currentTimeMillis()
        val answered = probe(port)
        drainXrayLog()
        if (!answered) {
            AppLog.w(TAG, "no answer through this config (test page https://www.gstatic.com/generate_204, ${System.currentTimeMillis() - started} ms)")
            runCatching { Core.stop() }
            drainXrayLog()
            return Attempt.Failed
        }
        AppLog.i(TAG, "the test page answered through it in ${System.currentTimeMillis() - started} ms")
        // Run again with the short log before the user's traffic goes through it.
        if (!run("warning")) return Attempt.Failed
        drainXrayLog()
        val fd = establish(dns.first(), settings.splitApps)
        if (fd == null) {
            AppLog.w(TAG, "Android did not give the VPN interface (permission revoked or another VPN is always-on)")
            runCatching { Core.stop() }
            return Attempt.Denied
        }
        tun = fd
        val hevConfig = File(filesDir, "tunnel.yml")
        hevConfig.writeText(
            """
            tunnel:
              mtu: $MTU
              ipv4: 172.19.0.1
              ipv6: 'fdfe:dcba:9876::1'
            socks5:
              port: $port
              address: 127.0.0.1
              udp: 'udp'
            misc:
              task-stack-size: 81920
              log-file: '${File(logDir, "tunnel.log").absolutePath}'
              log-level: warn
            """.trimIndent(),
        )
        runCatching { File(logDir, "tunnel.log").delete() }
        if (!TProxyService.TProxyStartService(hevConfig.absolutePath, fd.fd)) {
            AppLog.w(TAG, "the packet tunnel (hev-socks5-tunnel) did not start")
            stopEngines()
            return Attempt.Failed
        }
        return Attempt.Started
    }

    // OpenVPN brings the tunnel up itself and asks for the VPN interface on the way (openTun).
    private suspend fun startOpenVpn(config: Config, settings: Settings): Attempt {
        val profile = OpenVpnProfile.decode(config.link)
        if (profile == null) {
            AppLog.w(TAG, "${config.name}: not an OpenVPN profile")
            return Attempt.Failed
        }
        OpenVpnProfile.unsafeDirective(profile)?.let {
            AppLog.w(TAG, "${config.name}: the profile has '$it', which the app does not run")
            return Attempt.Failed
        }
        val session = OpenVpn(this, object : OpenVpn.Host {
            override fun protect(fd: Int): Boolean = this@DcVpnService.protect(fd)
            override fun openTun(spec: OpenVpn.TunSpec): ParcelFileDescriptor? = establishOpenVpn(spec, settings)
        })
        // Once up, OpenVPN reconnects by itself; the status follows, and only its exit ends the connection.
        session.onReconnecting = { VpnState.status.value.takeIf { it.state == ConnState.Connected }?.let { set(it.copy(state = ConnState.Connecting)) } }
        session.onReconnected = { VpnState.status.value.takeIf { it.state == ConnState.Connecting }?.let { set(it.copy(state = ConnState.Connected)) } }
        session.onLost = {
            scope.launch {
                if (openvpn === session) {
                    AppLog.w(TAG, "the OpenVPN connection ended")
                    val locationId = VpnState.status.value.locationId
                    stopEngines()
                    set(Status(ConnState.Disconnected, locationId, error = "connection_lost"))
                    stopSelf()
                }
            }
        }
        openvpn = session
        val outcome = session.start(profile, OPENVPN_TIMEOUT_MS)
        AppLog.i(TAG, "${config.name}: OpenVPN $outcome")
        return when (outcome) {
            OpenVpn.Outcome.Connected -> Attempt.Started
            OpenVpn.Outcome.VpnDenied -> {
                openvpn = null
                Attempt.Denied
            }
            else -> {
                openvpn = null
                Attempt.Failed
            }
        }
    }

    private fun establishOpenVpn(spec: OpenVpn.TunSpec, settings: Settings): ParcelFileDescriptor? {
        openvpnAddress = spec.address?.address
        val builder = Builder().setSession("Digi Cyber").setMtu(spec.mtu)
        spec.address?.let { builder.addAddress(it.address, it.prefix) }
        spec.address6?.let { builder.addAddress(it.address, it.prefix) }
        for (route in spec.routes + spec.routes6) runCatching { builder.addRoute(route.address, route.prefix) }
        // With every route in the tunnel and no IPv6 in it, Android blocks IPv6 rather than let it leave
        // around the tunnel; an IPv6 DNS server would let it through, so it is left out then.
        val everything = spec.routes.any { it.prefix <= 1 }
        val dns = if (settings.dns.isNotBlank()) XrayConfig.dnsServers(settings.dns) else spec.dns.ifEmpty { XrayConfig.defaultDns }
        for (server in dns) {
            if (everything && spec.address6 == null && server.contains(':')) continue
            runCatching { builder.addDnsServer(server) }
        }
        spec.domain?.let { runCatching { builder.addSearchDomain(it) } }
        if (!everything && spec.address6 == null) runCatching { builder.allowFamily(OsConstants.AF_INET6) }
        runCatching { builder.addDisallowedApplication(packageName) }
        for (app in settings.splitApps) runCatching { builder.addDisallowedApplication(app) }
        if (Build.VERSION.SDK_INT >= 29) builder.setMetered(false)
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        builder.setConfigureIntent(open)
        return runCatching { builder.establish() }.getOrNull()
    }

    private fun establish(dns: String, splitApps: Set<String>): ParcelFileDescriptor? {
        val builder = Builder()
            .setSession("Digi Cyber")
            .setMtu(MTU)
            .addAddress("172.19.0.1", 30)
            .addRoute("0.0.0.0", 0)
            .addDnsServer(dns)
        // IPv6 goes into the tunnel too, so nothing leaves around it.
        runCatching { builder.addAddress("fdfe:dcba:9876::1", 126).addRoute("::", 0) }
        runCatching { builder.addDisallowedApplication(packageName) }
        for (app in splitApps) runCatching { builder.addDisallowedApplication(app) }
        if (Build.VERSION.SDK_INT >= 29) builder.setMetered(false)
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        builder.setConfigureIntent(open)
        return runCatching { builder.establish() }.getOrNull()
    }

    // While connected the profile is fetched every 10 minutes; a new warning or critical notice is a notification too.
    private fun startRefresher() {
        refresher?.cancel()
        refresher = scope.launch {
            while (isActive) {
                delay(Repo.REFRESH_MS)
                val known = Repo.profile.value?.notices?.maxOfOrNull { it.id } ?: 0
                if (Repo.refresh() == null) {
                    Repo.profile.value?.notices?.filter { it.id > known && it.level != "info" }?.forEach { notify(it.id, it.level, it.body) }
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun notify(id: Int, level: String, body: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(NOTICE_CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(NOTICE_CHANNEL, if (Repo.settings.value.language == "fa") "اعلان‌ها" else "Notices", NotificationManager.IMPORTANCE_HIGH))
        }
        val fa = Repo.settings.value.language == "fa"
        val title = if (level == "critical") (if (fa) "اطلاعیه مهم" else "Important notice") else (if (fa) "اطلاعیه" else "Notice")
        val open = PendingIntent.getActivity(this, id, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, NOTICE_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_dc)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(this).notify(1000 + id, notification) }
    }
}
