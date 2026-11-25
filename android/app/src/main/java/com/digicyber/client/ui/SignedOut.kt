package com.digicyber.client.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.digicyber.client.R
import com.digicyber.client.data.ApiException
import com.digicyber.client.data.Repo
import com.digicyber.client.data.SignIn
import com.digicyber.client.data.SignInCode

// Signed out or adding an account: one page that signs in with the subscription link alone, and the QR scanner.
// A sign-in code (QR, picture, pasted text or a tapped digicyber:// link) signs in at once.
@Composable
fun SignedOutScreen(addingAccount: Boolean = false) {
    val t = LocalT.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var scanning by rememberSaveable { mutableStateOf(false) }
    var link by rememberSaveable(addingAccount) { mutableStateOf(if (addingAccount) "" else Repo.lastSubLink()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val reason by Repo.signOutReason.collectAsState()
    val pending by Repo.pendingSignIn.collectAsState()

    fun signIn(code: SignInCode) {
        link = code.subLink
        busy = true
        error = ""
        scope.launch {
            var succeeded = false
            try {
                Repo.login(code.subLink, code.username)
                succeeded = true
                Repo.ping()
            } catch (e: ApiException) {
                error = t.error(e.code)
            } catch (e: Exception) {
                error = t.error("unexpected")
            } finally {
                busy = false
                if (succeeded) Repo.cancelAddAccount()
            }
        }
    }

    fun scanned(text: String) {
        scanning = false
        val code = SignIn.parse(text)
        if (code == null) error = t("notSignInCode") else signIn(code)
    }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            scope.launch {
                val text = withContext(Dispatchers.Default) { QrImage.decode(context, uri) }
                if (text == null) {
                    scanning = false
                    error = t("noQrInImage")
                } else {
                    scanned(text)
                }
            }
        }
    }

    LaunchedEffect(pending) {
        val code = pending ?: return@LaunchedEffect
        Repo.pendingSignIn.value = null
        signIn(code)
    }
    BackHandler(enabled = scanning || addingAccount) {
        if (scanning) scanning = false else if (!busy) Repo.cancelAddAccount()
    }

    if (scanning) {
        ScannerScreen(message = "", onResult = { scanned(it) }, onImage = { pickImage.launch("image/*") }, onClose = { scanning = false })
        return
    }
    SignInPage(
        link = link,
        onLink = { value ->
            // A pasted digicyber:// link shows as the subscription link it carries.
            link = if (value.trim().startsWith("${SignIn.SCHEME}:", ignoreCase = true)) SignIn.parse(value)?.subLink ?: value else value
        },
        error = error.ifEmpty { if (reason.isNotEmpty()) t.error(reason) else "" },
        busy = busy,
        onSubmit = {
            val code = SignIn.parse(link)
            if (code == null) error = t.error("bad_link") else signIn(code)
        },
        onPaste = { text ->
            val code = SignIn.parse(text)
            if (code != null) signIn(code) else link = text.trim()
        },
        onScan = {
            error = ""
            scanning = true
        },
        onImage = { pickImage.launch("image/*") },
        addingAccount = addingAccount,
        onCancel = { Repo.cancelAddAccount() },
    )
}

@Composable
fun LanguageChip(onDark: Boolean = false) {
    val c = LocalDc.current
    val settings by Repo.settings.collectAsState()
    val other = if (settings.language == "fa") "English" else "فارسی"
    val ink = if (onDark) Color.White else c.text
    Row(
        Modifier.clip(RoundedCornerShape(50)).background(if (onDark) Color.White.copy(alpha = 0.16f) else c.card)
            .border(1.dp, if (onDark) Color.White.copy(alpha = 0.3f) else c.line, RoundedCornerShape(50))
            .clickable { Repo.updateSettings { it.copy(language = if (it.language == "fa") "en" else "fa") } }
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_language), null, tint = ink, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text(other, color = ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun SignInPage(
    link: String,
    onLink: (String) -> Unit,
    error: String,
    busy: Boolean,
    onSubmit: () -> Unit,
    onPaste: (String) -> Unit,
    onScan: () -> Unit,
    onImage: () -> Unit,
    addingAccount: Boolean = false,
    onCancel: () -> Unit = {},
) {
    val t = LocalT.current
    val c = LocalDc.current
    val clipboard = LocalClipboardManager.current
    var help by remember { mutableStateOf(false) }
    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = c.accent,
        unfocusedBorderColor = c.line,
        focusedLabelColor = c.accent,
        unfocusedLabelColor = c.muted,
        cursorColor = c.accent,
        focusedContainerColor = c.card,
        unfocusedContainerColor = c.card,
    )
    Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())) {
        // The brand: the logo's gradient with the mark, its rings and the wordmark.
        Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(bottomStart = 36.dp, bottomEnd = 36.dp)).background(Palette.gradient())
                .background(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.22f), Color.Transparent), radius = 700f)),
        ) {
            Box(Modifier.align(Alignment.Center).padding(top = 40.dp).size(300.dp).border(1.dp, Color.White.copy(alpha = 0.18f), CircleShape))
            Box(Modifier.align(Alignment.Center).padding(top = 40.dp).size(210.dp).border(1.dp, Color.White.copy(alpha = 0.14f), CircleShape))
            Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 20.dp, vertical = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    LanguageChip(onDark = true)
                    Spacer(Modifier.weight(1f))
                    CircleIconButton(R.drawable.ic_help, t("helpTitle"), size = 42.dp, background = Color.White.copy(alpha = 0.16f), tint = Color.White) { help = true }
                }
                Column(Modifier.fillMaxWidth().padding(top = 26.dp, bottom = 34.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    DcMark(Modifier.size(132.dp, 96.dp), color = Color.White)
                    Spacer(Modifier.height(14.dp))
                    Wordmark(30.sp, color = Color.White, showMark = false)
                    Spacer(Modifier.height(8.dp))
                    Text(t("onboardTitle"), color = Color.White.copy(alpha = 0.88f), fontSize = 15.sp, textAlign = TextAlign.Center)
                }
            }
        }
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp, vertical = 22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(t(if (addingAccount) "addAccount" else "signInTitle"), fontSize = 26.sp, fontWeight = FontWeight.Bold, color = c.text)
            if (addingAccount) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(t("addAccountIntro"), fontSize = 15.sp, lineHeight = 24.sp, color = c.muted, modifier = Modifier.weight(1f))
                    TextButton(enabled = !busy, onClick = onCancel) { Text(t("cancel"), color = c.accent) }
                }
            } else {
                Text(t("signInHint"), fontSize = 15.sp, lineHeight = 24.sp, color = c.muted)
            }
            Ltr {
                OutlinedTextField(
                    value = link,
                    onValueChange = onLink,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(t("subLink")) },
                    placeholder = { Text("https://…/sub/…", color = c.faint) },
                    singleLine = true,
                    shape = RoundedCornerShape(18.dp),
                    colors = fieldColors,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { if (link.isNotBlank() && !busy) onSubmit() }),
                    trailingIcon = {
                        IconButton(onClick = { clipboard.getText()?.text?.let(onPaste) }) {
                            Icon(painterResource(R.drawable.ic_paste), t("paste"), tint = c.accent)
                        }
                    },
                )
            }
            MessageText(error, true)
            GradientButton(if (busy) t("signingIn") else t("signIn"), enabled = link.isNotBlank() && !busy, loading = busy, onClick = onSubmit)
            Row(verticalAlignment = Alignment.CenterVertically) {
                HorizontalDivider(Modifier.weight(1f), color = c.line)
                Text(t("or"), color = c.muted, modifier = Modifier.padding(horizontal = 12.dp))
                HorizontalDivider(Modifier.weight(1f), color = c.line)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton(t("scanShort"), Modifier.weight(1f), icon = R.drawable.ic_qr, onClick = onScan)
                SecondaryButton(t("imageShort"), Modifier.weight(1f), icon = R.drawable.ic_image, onClick = onImage)
            }
            TextButton(onClick = { help = true }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text(t("whereDetails"), color = c.accent, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
    if (busy) BusyVeil(t("signingIn"))
    if (help) HelpSheet { help = false }
}

@Composable
private fun BusyVeil(text: String) {
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)).clickable(enabled = true) {}, contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            CircularProgressIndicator(color = Palette.cyan)
            Text(text, color = Color.White, fontSize = 16.sp)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HelpSheet(onClose: () -> Unit) {
    val t = LocalT.current
    val c = LocalDc.current
    ModalBottomSheet(onDismissRequest = onClose, containerColor = c.card) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            IconTile(R.drawable.ic_qr, size = 52.dp)
            Text(t("helpTitle"), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = c.text)
            Text(t("helpText"), fontSize = 15.sp, lineHeight = 26.sp, color = c.muted)
            PrimaryButton(t("gotIt"), onClick = onClose)
        }
    }
}
