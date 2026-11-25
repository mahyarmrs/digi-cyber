package com.digicyber.client.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings as AndroidSettings
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.digicyber.client.BuildConfig
import com.digicyber.client.R
import com.digicyber.client.data.NoticeEntry
import com.digicyber.client.data.Profile
import com.digicyber.client.data.Repo
import com.digicyber.client.data.Settings

// The protection tab: how the app connects and what goes around the tunnel.
@Composable
fun ProtectionPage(settings: Settings, onApps: () -> Unit) {
    val t = LocalT.current
    val c = LocalDc.current
    val context = LocalContext.current
    var dns by remember(settings.dns) { mutableStateOf(settings.dns) }
    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        PageTitle(t("protection"))
        DcCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(R.drawable.ic_server, size = 44.dp)
                Spacer(Modifier.width(14.dp))
                Text(t("protocol"), color = c.text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
            ChoiceChips(listOf("auto" to t("auto"), "xray" to "Xray", "wireguard" to "WireGuard", "openvpn" to "OpenVPN"), settings.protocol) { v -> Repo.updateSettings { it.copy(protocol = v) } }
            Spacer(Modifier.height(10.dp))
            Text(t("protocolHint"), color = c.muted, fontSize = 13.sp, lineHeight = 21.sp)
        }
        DcCard(padding = 14.dp) {
            ToggleRow(R.drawable.ic_pin, t("iranDirect"), t("iranDirectHint"), settings.iranDirect) { v -> Repo.updateSettings { it.copy(iranDirect = v) } }
            HorizontalDivider(color = c.line, modifier = Modifier.padding(vertical = 4.dp))
            ToggleRow(R.drawable.ic_ban, t("adBlock"), t("adBlockHint"), settings.adBlock) { v -> Repo.updateSettings { it.copy(adBlock = v) } }
        }
        DcCard(padding = 14.dp) {
            NavRow(R.drawable.ic_lock, t("killSwitch"), t("killSwitchHint")) { runCatching { context.startActivity(Intent(AndroidSettings.ACTION_VPN_SETTINGS)) } }
            HorizontalDivider(color = c.line, modifier = Modifier.padding(vertical = 4.dp))
            NavRow(R.drawable.ic_grid, t("splitTunneling"), if (settings.splitApps.isEmpty()) t("splitHint") else t("appsCount", "n" to iso("${settings.splitApps.size}")), onClick = onApps)
        }
        DcCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(R.drawable.ic_globe, size = 44.dp)
                Spacer(Modifier.width(14.dp))
                Text(t("dns"), color = c.text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
            Ltr {
                OutlinedTextField(
                    value = dns,
                    onValueChange = { dns = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    placeholder = { Text("1.1.1.1, 8.8.8.8", color = c.muted) },
                    shape = RoundedCornerShape(16.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.button, unfocusedBorderColor = c.line, cursorColor = c.button),
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(t("dnsHint"), color = c.muted, fontSize = 13.sp, lineHeight = 21.sp)
            if (dns.trim() != settings.dns) {
                Spacer(Modifier.height(10.dp))
                PrimaryButton(t("save")) {
                    Repo.updateSettings { it.copy(dns = dns.trim()) }
                    Toast.makeText(context, t("saved"), Toast.LENGTH_SHORT).show()
                }
            }
        }
        Text(t("appliesNextConnect"), color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 6.dp))
        Spacer(Modifier.height(16.dp))
    }
}

// The bell's list as a page: the subscription's announcement, then the panel's notices newest first.
@Composable
fun NoticesPage(log: List<NoticeEntry>, onBack: () -> Unit) {
    val t = LocalT.current
    val c = LocalDc.current
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(R.drawable.ic_back, t("back"), size = 48.dp, background = c.card, onClick = onBack)
            Spacer(Modifier.width(12.dp))
            PageTitle(t("notices"))
        }
        Spacer(Modifier.height(8.dp))
        if (log.isEmpty()) {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                IconTile(R.drawable.ic_bell, size = 72.dp)
                Spacer(Modifier.height(16.dp))
                Text(t("noNotices"), color = c.muted, fontSize = 15.sp, lineHeight = 24.sp, modifier = Modifier.padding(horizontal = 24.dp))
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(log, key = { it.key }) { NoticeCard(it) }
                item { Spacer(Modifier.height(16.dp)) }
            }
        }
    }
}

@Composable
private fun NoticeCard(n: NoticeEntry) {
    val t = LocalT.current
    val c = LocalDc.current
    val color = when (n.level) {
        "critical" -> Palette.bad
        "warning" -> Palette.warn
        else -> c.accent
    }
    DcCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(if (n.level == "info") R.drawable.ic_info else R.drawable.ic_alert), null, tint = color, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(if (n.key == "announce") t("subscriptionNotice") else t("level.${n.level}"), color = color, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.weight(1f))
            if (n.createdAt > 0) Text(dateTime(t, n.createdAt), fontSize = 12.sp, color = c.muted)
        }
        Spacer(Modifier.height(8.dp))
        NoticeText(n.body, c.text, 15)
    }
}

// The account tab: who is signed in, the plan, the app's look and signing out.
@Composable
fun AccountPage(p: Profile, settings: Settings) {
    val t = LocalT.current
    val c = LocalDc.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val fetchedAt by Repo.fetchedAt.collectAsState()
    val accounts by Repo.accounts.collectAsState()
    var refreshing by remember { mutableStateOf(false) }
    var switchingAccount by remember { mutableStateOf<String?>(null) }
    var accountError by remember { mutableStateOf("") }
    var confirmLogout by remember { mutableStateOf(false) }
    var reporting by remember { mutableStateOf(false) }
    val a = p.account
    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        PageTitle(t("account"))
        DcCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(58.dp).clip(CircleShape).background(Palette.gradient()), contentAlignment = Alignment.Center) {
                    Text(a.username.firstOrNull()?.uppercase() ?: "?", color = c.onButton, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Ltr { Text(a.username, color = c.text, fontSize = 19.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    if (p.title.isNotEmpty()) Text(p.title, color = c.muted, fontSize = 14.sp)
                }
                StatusPill(if (a.enabled) t("active") else t("inactive"), a.enabled)
            }
            Spacer(Modifier.height(14.dp))
            HorizontalDivider(color = c.line)
            Spacer(Modifier.height(6.dp))
            InfoLine(t("yourPlan"), expiryText(t, a))
            if (a.expiryTime > 0) InfoLine(t("expiresOn"), date(t, a.expiryTime))
            val used = a.upload + a.download
            InfoLine(t("traffic"), if (a.total > 0) t("usedOf", "used" to iso(bytes(used)), "total" to iso(bytes(a.total))) else "${t("unlimitedTraffic")} · ${iso(bytes(used))}")
            InfoLine("${t("uploaded")} / ${t("downloaded")}", iso("${bytes(a.upload)} / ${bytes(a.download)}"))
            if (a.deviceLimit > 0) InfoLine(t("devices"), iso("${a.devices} / ${a.deviceLimit}"))
        }
        DcCard(padding = 14.dp) {
            SectionHeader(t("accounts"), t("addAccount")) { Repo.beginAddAccount() }
            Spacer(Modifier.height(4.dp))
            for (account in accounts) {
                Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Ltr { Text(account.username, color = c.text, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        if (account.label.isNotEmpty()) Ltr { Text(account.label, color = c.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                    Spacer(Modifier.width(8.dp))
                    if (account.active) {
                        StatusPill(t("currentAccount"), true)
                    } else {
                        TextButton(
                            enabled = switchingAccount == null,
                            onClick = {
                                accountError = ""
                                switchingAccount = account.id
                                scope.launch {
                                    try {
                                        Repo.switchAccount(account.id)
                                        Repo.ping()
                                    } catch (e: com.digicyber.client.data.ApiException) {
                                        accountError = t.error(e.code)
                                    } catch (_: Exception) {
                                        accountError = t.error("unexpected")
                                    } finally {
                                        switchingAccount = null
                                    }
                                }
                            },
                        ) {
                            Text(if (switchingAccount == account.id) t("switchingAccount") else t("switchToAccount"), color = c.accent, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
            MessageText(accountError, true)
            HorizontalDivider(color = c.line, modifier = Modifier.padding(vertical = 4.dp))
            NavRow(R.drawable.ic_refresh, t("refreshSub"), t("updatedAgo", "when" to ago(t, fetchedAt)), trailing = {
                if (refreshing) CircularProgressIndicator(Modifier.size(20.dp), color = c.accent, strokeWidth = 2.dp)
            }) {
                if (!refreshing) {
                    refreshing = true
                    scope.launch {
                        val error = Repo.refresh()
                        refreshing = false
                        Toast.makeText(context, if (error == null) t("refreshed") else t("refreshFailed"), Toast.LENGTH_SHORT).show()
                    }
                }
            }
            if (p.supportUrl.isNotEmpty()) {
                HorizontalDivider(color = c.line, modifier = Modifier.padding(vertical = 4.dp))
                NavRow(R.drawable.ic_chat, t("support")) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(p.supportUrl))) } }
            }
        }
        DcCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(R.drawable.ic_language, size = 44.dp)
                Spacer(Modifier.width(14.dp))
                Text(t("language"), color = c.text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
            ChoiceChips(listOf("fa" to "فارسی", "en" to "English"), settings.language) { v -> Repo.updateSettings { it.copy(language = v) } }
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(R.drawable.ic_moon, size = 44.dp)
                Spacer(Modifier.width(14.dp))
                Text(t("appearance"), color = c.text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
            ChoiceChips(listOf("dark" to t("themeDark"), "light" to t("themeLight"), "system" to t("themeSystem")), settings.theme) { v -> Repo.updateSettings { it.copy(theme = v) } }
        }
        DcCard(padding = 14.dp) {
            NavRow(R.drawable.ic_alert, t("reportProblem"), t("reportRow")) { reporting = true }
        }
        DcCard(padding = 14.dp) {
            NavRow(R.drawable.ic_logout, t("logout"), color = Palette.bad) { confirmLogout = true }
        }
        Column(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Wordmark(20.sp)
            Spacer(Modifier.height(8.dp))
            Text("${t("version")} ${iso(BuildConfig.VERSION_NAME)} · ${t("madeBy")}", color = c.muted, fontSize = 12.sp)
        }
        Spacer(Modifier.height(8.dp))
    }
    if (reporting) ReportSheet(p.supportUrl) { reporting = false }
    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            containerColor = c.card,
            title = { Text(t("logout"), color = c.text) },
            text = { Text(t("logoutConfirm", "user" to iso(a.username)), color = c.muted) },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    scope.launch {
                        try {
                            Repo.logout()
                        } catch (e: kotlinx.coroutines.CancellationException) {
                            throw e
                        } catch (e: com.digicyber.client.data.ApiException) {
                            Toast.makeText(context, t.error(e.code), Toast.LENGTH_SHORT).show()
                        } catch (_: Exception) {
                            Toast.makeText(context, t.error("unexpected"), Toast.LENGTH_SHORT).show()
                        }
                    }
                }) { Text(t("logout"), color = Palette.bad, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text(t("cancel"), color = c.text) } },
        )
    }
}

// Sends the log since the app started to the panel, which files it under this account; or copies or shares it.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportSheet(supportUrl: String, onClose: () -> Unit) {
    val t = LocalT.current
    val c = LocalDc.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf("") }
    var failed by remember { mutableStateOf(false) }
    var log by remember { mutableStateOf<String?>(null) }
    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = c.button,
        unfocusedBorderColor = c.line,
        focusedLabelColor = c.accent,
        unfocusedLabelColor = c.muted,
        cursorColor = c.button,
        focusedContainerColor = c.card,
        unfocusedContainerColor = c.card,
    )
    suspend fun text(): String = withContext(Dispatchers.IO) { Repo.logText() }
    ModalBottomSheet(onDismissRequest = onClose, containerColor = c.card) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(t("reportProblem"), color = c.text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text(t("reportHint"), color = c.muted, fontSize = 13.sp, lineHeight = 21.sp)
            OutlinedTextField(
                value = message,
                onValueChange = { message = it.take(4000) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(t("reportPlaceholder")) },
                minLines = 3,
                shape = RoundedCornerShape(18.dp),
                colors = fieldColors,
            )
            PrimaryButton(if (sending) t("reportSending") else t("reportSend"), Modifier.fillMaxWidth(), enabled = !sending, loading = sending) {
                sending = true
                result = ""
                scope.launch {
                    val (id, error) = Repo.sendReport(message.trim())
                    sending = false
                    failed = error != null
                    result = when {
                        error == "report_unsupported" -> t("reportUnsupported")
                        error != null -> t.error(error)
                        id != null -> t("reportSentId", "id" to iso(id))
                        else -> t("reportSent")
                    }
                    if (error == null) message = ""
                }
            }
            MessageText(result, failed)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryButton(t("copyLog"), Modifier.weight(1f)) {
                    scope.launch {
                        val clip = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
                        clip?.setPrimaryClip(android.content.ClipData.newPlainText("Digi Cyber log", AppLogTail(text(), 300_000)))
                        Toast.makeText(context, t("copied"), Toast.LENGTH_SHORT).show()
                    }
                }
                SecondaryButton(t("shareLog"), Modifier.weight(1f)) {
                    scope.launch {
                        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, "Digi Cyber log").putExtra(Intent.EXTRA_TEXT, AppLogTail(text(), 150_000))
                        runCatching { context.startActivity(Intent.createChooser(send, t("shareLog"))) }
                    }
                }
            }
            SecondaryButton(if (log == null) t("showLog") else t("refreshLog"), Modifier.fillMaxWidth()) {
                scope.launch { log = AppLogTail(text(), 60_000) }
            }
            log?.let { shown ->
                Ltr {
                    Text(
                        shown,
                        color = c.text,
                        fontSize = 11.sp,
                        lineHeight = 15.sp,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.line.copy(alpha = 0.35f)).padding(10.dp),
                    )
                }
            }
            if (supportUrl.isNotEmpty()) {
                TextButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(supportUrl))) } }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    Text(t("support"), color = c.accent)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

private fun AppLogTail(text: String, max: Int): String = com.digicyber.client.data.AppLog.tail(text, max)

@Composable
private fun InfoLine(label: String, value: String) {
    val c = LocalDc.current
    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = c.muted, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Text(value, color = c.text, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppPicker(settings: Settings, onClose: () -> Unit) {
    val t = LocalT.current
    val c = LocalDc.current
    val context = LocalContext.current
    var apps by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    LaunchedEffect(Unit) {
        apps = withContext(Dispatchers.IO) {
            val pm = context.packageManager
            val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            pm.queryIntentActivities(launcher, 0)
                .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
                .filter { it.first != context.packageName }
                .distinctBy { it.first }
                .sortedBy { it.second.lowercase() }
        }
    }
    ModalBottomSheet(onDismissRequest = onClose, containerColor = c.card) {
        Text(t("splitTunneling"), color = c.text, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 20.dp))
        Text(t("splitHint"), color = c.muted, fontSize = 13.sp, lineHeight = 21.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
        if (apps.isEmpty()) CircularProgressIndicator(Modifier.padding(24.dp).align(Alignment.CenterHorizontally), color = c.accent)
        LazyColumn(Modifier.padding(horizontal = 12.dp)) {
            items(apps, key = { it.first }) { (pkg, label) ->
                val on = pkg in settings.splitApps
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { Repo.updateSettings { s -> s.copy(splitApps = if (on) s.splitApps - pkg else s.splitApps + pkg) } }.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = on, onCheckedChange = null, colors = CheckboxDefaults.colors(checkedColor = c.button, checkmarkColor = c.onButton, uncheckedColor = c.muted))
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(label, color = c.text)
                        Text(pkg, fontSize = 11.sp, color = c.muted)
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}
