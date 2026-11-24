package com.digicyber.client.ui

import android.content.Context
import androidx.compose.ui.geometry.Offset
import kotlin.math.PI
import kotlin.math.ln
import kotlin.math.tan
import org.json.JSONObject

// Each country's centre and its English and Persian name
object Geo {
    data class Country(val lat: Double, val lon: Double, val en: String, val fa: String)

    private class Table(val width: Double, val height: Double, val scale: Double, val ty: Double, val countries: Map<String, Country>)

    @Volatile private var table: Table? = null

    private fun table(context: Context): Table = table ?: synchronized(this) {
        table ?: run {
            val o = JSONObject(context.assets.open("map/countries.json").bufferedReader().use { it.readText() })
            val map = o.getJSONObject("map")
            val list = o.getJSONObject("countries")
            val countries = HashMap<String, Country>()
            for (code in list.keys()) {
                val c = list.getJSONObject(code)
                countries[code] = Country(c.optDouble("lat"), c.optDouble("lon"), c.optString("en"), c.optString("fa"))
            }
            Table(map.getDouble("width"), map.getDouble("height"), map.getDouble("scale"), map.getDouble("ty"), countries).also { table = it }
        }
    }

    val ratio: Float get() = (table?.let { it.height / it.width } ?: 0.663).toFloat()

    fun name(context: Context, code: String, language: String): String {
        val c = table(context).countries[code.uppercase()] ?: return ""
        return if (language == "en") c.en else c.fa
    }

    // A country's centre as fractions of the map's width and height.
    fun point(context: Context, code: String): Offset? {
        val t = table(context)
        val c = t.countries[code.uppercase()] ?: return null
        if (c.lat == 0.0 && c.lon == 0.0) return null
        return project(t, c.lat, c.lon)
    }

    fun project(context: Context, lat: Double, lon: Double): Offset = project(table(context), lat, lon)

    private fun project(t: Table, lat: Double, lon: Double): Offset {
        val x = (t.width / 2 + t.scale * (lon * PI / 180)) / t.width
        val y = (t.ty - t.scale * ln(tan(PI / 4 + lat * PI / 360))) / t.height
        return Offset(x.toFloat(), y.toFloat())
    }

    const val WIDTH = 1000f
}
