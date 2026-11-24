package com.digicyber.client.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import com.digicyber.client.R
import com.digicyber.client.data.ConnState
import com.digicyber.client.data.Location
import com.digicyber.client.data.Profile
import com.digicyber.client.data.Repo
import com.digicyber.client.data.Settings
import com.digicyber.client.vpn.Candidates
import com.digicyber.client.vpn.VpnState

private data class CountryGroup(val key: String, val code: String, val name: String, val locations: List<Location>, val ping: Int?)

// The protocol family a config belongs to, for the list's filter.
private fun family(protocol: String): String = when (protocol) {
    "wireguard" -> "wireguard"
    "openvpn" -> "openvpn"
    else -> "xray"
}

// Every location the account can reach, grouped by country, quickest first; a country with
// several locations opens to list them, as the big VPN apps list cities.
@Composable
fun LocationsScreen(p: Profile, settings: Settings, activity: MainActivity, focusSearch: Boolean, asTab: Boolean = false, onClose: () -> Unit) {
    val t = LocalT.current
    val c = LocalDc.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val status by VpnState.status.collectAsState()
    val pings by Repo.pings.collectAsState()
    val pinging by Repo.pinging.collectAsState()
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("all") }
    var open by remember { mutableStateOf(setOf<String>()) }
    val focus = remember { FocusRequester() }
    val listState = rememberLazyListState()
    LaunchedEffect(Unit) { if (focusSearch) runCatching { focus.requestFocus() } }

    val runnable = remember(p) { p.configs.filter { Candidates.runnable(it) } }
    val families = remember(runnable) { listOf("xray", "wireguard", "openvpn").filter { f -> runnable.any { family(it.protocol) == f } } }
    val active = if (status.state != ConnState.Disconnected) status.serverId ?: status.locationId else null
    val q = query.trim().lowercase()
    val groups = remember(p, filter, q, pings, t.language) {
        val reachable = p.locations.filter { l -> runnable.any { it.locationId == l.id && (filter == "all" || family(it.protocol) == filter) } }
        reachable.groupBy { it.countryCode.ifEmpty { "#${it.name}" } }.map { (key, list) ->
            val code = list.first().countryCode
            val name = Geo.name(context, code, t.language).ifEmpty { list.first().name.ifEmpty { code } }
            val sorted = list.sortedBy { Candidates.bestPing(p, pings, it.id) ?: Int.MAX_VALUE }
            CountryGroup(key, code, name, sorted, sorted.mapNotNull { Candidates.bestPing(p, pings, it.id) }.minOrNull())
        }.filter { g ->
            q.isEmpty() || g.name.lowercase().contains(q) || Geo.name(context, g.code, "en").lowercase().contains(q) || Geo.name(context, g.code, "fa").contains(q) ||
                g.code.lowercase() == q || g.locations.any { it.name.lowercase().contains(q) || it.city.lowercase().contains(q) }
        }.sortedWith(compareBy<CountryGroup>({ it.ping ?: Int.MAX_VALUE }, { it.name }))
    }

    // A new search or filter starts at the top: the list would otherwise keep its place on the first
    // row still shown, leaving Fastest location above it once the search is cleared.
    LaunchedEffect(q, filter) { listState.scrollToItem(0) }

    fun connect(id: Int?) {
        if (id == null || id != active) activity.connect(id)
        onClose()
    }

    val frame = Modifier.fillMaxSize().background(c.background).statusBarsPadding()
    Column(if (asTab) frame else frame.navigationBarsPadding()) {
        if (asTab) PageTitle(t("locationsTab"), Modifier.padding(start = 20.dp, end = 20.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (!asTab) {
                CircleIconButton(R.drawable.ic_back, t("back"), size = 52.dp, background = c.card, onClick = onClose)
                Spacer(Modifier.width(10.dp))
            }
            Row(
                Modifier.weight(1f).height(54.dp).clip(RoundedCornerShape(18.dp)).background(c.card).border(1.dp, c.line, RoundedCornerShape(18.dp)).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(painterResource(R.drawable.ic_search), null, tint = c.muted, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(12.dp))
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) Text(t("searchLocations"), color = c.muted, fontSize = 17.sp, maxLines = 1)
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        singleLine = true,
                        textStyle = TextStyle(color = c.text, fontSize = 17.sp, fontFamily = Estedad),
                        cursorBrush = SolidColor(c.button),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus),
                    )
                }
                if (query.isNotEmpty()) {
                    Icon(painterResource(R.drawable.ic_close), t("close"), tint = c.muted, modifier = Modifier.size(22.dp).clip(CircleShape).clickable { query = "" })
                }
            }
        }
        if (families.size > 1) {
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(listOf("all") + families) { f ->
                    val on = f == filter
                    val label = when (f) {
                        "all" -> t("all")
                        "xray" -> "Xray"
                        "wireguard" -> "WireGuard"
                        else -> "OpenVPN"
                    }
                    Text(
                        label,
                        color = if (on) c.accent else c.muted,
                        fontSize = 14.sp,
                        fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) c.accentSoft else Color.Transparent)
                            .border(1.dp, if (on) Color.Transparent else c.line, RoundedCornerShape(50))
                            .clickable { filter = f }.padding(horizontal = 18.dp, vertical = 9.dp),
                    )
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 12.dp, top = 18.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(t("chooseLocation"), color = c.muted, fontSize = 17.sp, modifier = Modifier.weight(1f))
            Row(
                Modifier.clip(RoundedCornerShape(50)).clickable(enabled = !pinging) { scope.launch { Repo.ping() } }.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (pinging) {
                    CircularProgressIndicator(Modifier.size(16.dp), color = c.accent, strokeWidth = 2.dp)
                } else {
                    Icon(painterResource(R.drawable.ic_pulse), null, tint = c.accent, modifier = Modifier.size(18.dp))
                }
                Spacer(Modifier.width(6.dp))
                Text(if (pinging) t("pinging") else t("pingNow"), color = c.accent, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            }
        }
        LazyColumn(state = listState, modifier = Modifier.padding(horizontal = 16.dp).clip(RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp)).background(c.card).fillMaxSize()) {
            if (q.isEmpty()) {
                item(key = "fastest") {
                    Row(Modifier.fillMaxWidth().clickable { connect(null) }.padding(horizontal = 18.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(46.dp).clip(CircleShape).background(Palette.gradient()), contentAlignment = Alignment.Center) {
                            Icon(painterResource(R.drawable.ic_zap), null, tint = Color.White, modifier = Modifier.size(24.dp))
                        }
                        Spacer(Modifier.width(16.dp))
                        Column(Modifier.weight(1f)) {
                            Text(t("fastest"), color = c.text, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            Text(t("bestPing"), color = c.muted, fontSize = 14.sp)
                        }
                        if (settings.locationId == null && active == null) Icon(painterResource(R.drawable.ic_check), null, tint = c.accent, modifier = Modifier.size(22.dp))
                    }
                    HorizontalDivider(Modifier.padding(start = 80.dp, end = 18.dp), color = c.line)
                }
            }
            if (groups.isEmpty()) {
                item(key = "empty") {
                    Text(if (q.isEmpty()) t("noLocations") else t("noResults"), color = c.muted, fontSize = 15.sp, modifier = Modifier.padding(24.dp))
                }
            }
            for (g in groups) {
                val many = g.locations.size > 1
                val expanded = g.key in open || (q.isNotEmpty() && many)
                item(key = "country-${g.key}") {
                    val single = g.locations.first()
                    val chosen = !many && (single.id == active || (active == null && single.id == settings.locationId))
                    Row(
                        Modifier.fillMaxWidth().clickable {
                            if (many) {
                                open = if (g.key in open) open - g.key else open + g.key
                            } else {
                                connect(single.id)
                            }
                        }.padding(horizontal = 18.dp, vertical = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        FlagCircle(g.code, 46.dp)
                        Spacer(Modifier.width(16.dp))
                        Column(Modifier.weight(1f)) {
                            Text(g.name, color = c.text, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            val sub = if (many) {
                                val cities = g.locations.map { it.city.ifEmpty { it.name } }.distinct().size
                                if (cities == g.locations.size) t("cities", "n" to iso("$cities")) else t("servers", "n" to iso("${g.locations.size}"))
                            } else {
                                single.city.ifEmpty { if (single.name != g.name && single.name != Geo.name(context, g.code, "en")) single.name else "" }
                            }
                            if (sub.isNotEmpty()) Text(sub, color = c.muted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        PingText(g.ping, pinging)
                        Spacer(Modifier.width(10.dp))
                        when {
                            many -> Icon(painterResource(if (expanded) R.drawable.ic_chevron_up else R.drawable.ic_chevron_down), null, tint = c.text, modifier = Modifier.size(24.dp))
                            chosen -> Icon(painterResource(R.drawable.ic_check), null, tint = c.accent, modifier = Modifier.size(22.dp))
                            else -> Spacer(Modifier.size(24.dp))
                        }
                    }
                }
                if (many && expanded) {
                    items(g.locations, key = { "loc-${it.id}" }) { l ->
                        val chosen = l.id == active || (active == null && l.id == settings.locationId)
                        Row(
                            Modifier.fillMaxWidth().background(c.cardHigh.copy(alpha = 0.45f)).clickable { connect(l.id) }.padding(start = 80.dp, end = 18.dp, top = 14.dp, bottom = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(l.city.ifEmpty { l.name }, color = c.text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                                // The panel's own name for the location, when it says more than the country does.
                                val countryNames = setOf(g.name, Geo.name(context, g.code, "en"), Geo.name(context, g.code, "fa"))
                                if (l.city.isNotEmpty() && l.name.isNotEmpty() && l.name !in countryNames) Text(l.name, color = c.muted, fontSize = 13.sp)
                            }
                            PingText(Candidates.bestPing(p, pings, l.id), pinging)
                            Spacer(Modifier.width(10.dp))
                            if (chosen) Icon(painterResource(R.drawable.ic_check), null, tint = c.accent, modifier = Modifier.size(22.dp)) else Spacer(Modifier.size(22.dp))
                        }
                    }
                }
                item(key = "line-${g.key}") { HorizontalDivider(Modifier.padding(start = 80.dp, end = 18.dp), color = c.line) }
            }
            item(key = "end") { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun PingText(ms: Int?, pinging: Boolean) {
    val c = LocalDc.current
    val color = when {
        ms == null -> c.muted
        ms < 150 -> c.secured
        ms < 300 -> Palette.warn
        else -> Palette.bad
    }
    Ltr { Text(if (ms != null) "$ms ms" else if (pinging) "…" else "—", color = color, fontSize = 14.sp) }
}
