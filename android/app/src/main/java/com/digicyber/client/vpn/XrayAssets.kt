package com.digicyber.client.vpn

import android.content.Context
import java.io.File

// The same geo database files are shared by the live VPN engine and isolated URL-test instances.
object XrayAssets {
    @Synchronized
    fun ensure(context: Context): String {
        val dir = File(context.filesDir, "xray").apply { mkdirs() }
        val marker = File(dir, "version")
        val version = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime.toString()
        if (marker.takeIf { it.exists() }?.readText() != version) {
            for (name in listOf("geoip.dat", "geosite.dat")) {
                context.assets.open(name).use { input -> File(dir, name).outputStream().use { input.copyTo(it) } }
            }
            marker.writeText(version)
        }
        return dir.absolutePath
    }
}
