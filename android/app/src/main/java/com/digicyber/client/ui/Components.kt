package com.digicyber.client.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.digicyber.client.R

// The building blocks every page shares: cards, buttons, rows and flags.

@Composable
fun DcCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, padding: Dp = 18.dp, content: @Composable ColumnScope.() -> Unit) {
    val c = LocalDc.current
    val shape = RoundedCornerShape(22.dp)
    var m = modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.line, shape)
    if (onClick != null) m = m.clickable(onClick = onClick)
    Column(m.padding(padding), content = content)
}

@Composable
fun PageTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = LocalDc.current.text, modifier = modifier.padding(top = 12.dp, bottom = 2.dp))
}

@Composable
fun SectionHeader(title: String, action: String? = null, onAction: (() -> Unit)? = null) {
    val c = LocalDc.current
    Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontSize = 18.sp, color = c.muted, modifier = Modifier.weight(1f))
        if (action != null && onAction != null) {
            Row(Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onAction).padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(action, fontSize = 17.sp, color = c.text, fontWeight = FontWeight.Medium)
                Spacer(Modifier.width(4.dp))
                Icon(painterResource(R.drawable.ic_chevron_end), null, tint = c.text, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false, onClick: () -> Unit) {
    GradientButton(text, modifier, enabled = enabled, loading = loading, onClick = onClick)
}

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, icon: Int? = null, color: Color? = null, onClick: () -> Unit) {
    val c = LocalDc.current
    val ink = color ?: c.text
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, if (color != null) color.copy(alpha = 0.6f) else c.line),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = ink),
        modifier = modifier.fillMaxWidth().height(56.dp),
    ) {
        if (icon != null) {
            Icon(painterResource(icon), null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun CircleIconButton(icon: Int, description: String, modifier: Modifier = Modifier, size: Dp = 48.dp, background: Color? = null, tint: Color? = null, onClick: () -> Unit) {
    val c = LocalDc.current
    Box(
        modifier.size(size).clip(CircleShape).background(background ?: c.card).clickable(onClick = onClick)
            .semantics { contentDescription = description; role = Role.Button },
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(icon), null, tint = tint ?: c.text, modifier = Modifier.size(size * 0.46f))
    }
}

@Composable
fun IconTile(icon: Int, modifier: Modifier = Modifier, size: Dp = 48.dp, tint: Color? = null) {
    val c = LocalDc.current
    Box(modifier.size(size).clip(RoundedCornerShape(size * 0.32f)).background(if (tint == null) c.accentSoft else c.cardHigh), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), null, tint = tint ?: c.accent, modifier = Modifier.size(size * 0.48f))
    }
}

// A flag as a round badge, like the location lists of the big VPN apps; a globe when the country is unknown.
@Composable
fun FlagCircle(code: String, size: Dp = 40.dp) {
    val c = LocalDc.current
    Box(Modifier.size(size).clip(CircleShape).background(c.cardHigh), contentAlignment = Alignment.Center) {
        val emoji = flag(code)
        if (emoji == null) {
            Icon(painterResource(R.drawable.ic_globe), null, tint = c.muted, modifier = Modifier.size(size * 0.55f))
        } else {
            Text(emoji, fontSize = (size.value * 1.18f).sp, lineHeight = (size.value * 1.3f).sp, modifier = Modifier.wrapContentSize(unbounded = true))
        }
    }
}

@Composable
fun StatusPill(text: String, good: Boolean) {
    val c = LocalDc.current
    val color = if (good) c.secured else c.unsecured
    Text(
        text,
        color = color,
        fontSize = 13.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.14f)).padding(horizontal = 12.dp, vertical = 4.dp),
    )
}

@Composable
fun ToggleRow(icon: Int, title: String, hint: String, value: Boolean, onChange: (Boolean) -> Unit) {
    val c = LocalDc.current
    Row(Modifier.fillMaxWidth().clickable { onChange(!value) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconTile(icon, size = 44.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.text)
            if (hint.isNotEmpty()) Text(hint, fontSize = 13.sp, color = c.muted, lineHeight = 20.sp)
        }
        Spacer(Modifier.width(8.dp))
        Switch(
            checked = value,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = c.button, checkedThumbColor = Color.White, checkedBorderColor = c.button, uncheckedTrackColor = c.cardHigh, uncheckedBorderColor = c.line, uncheckedThumbColor = c.muted),
        )
    }
}

@Composable
fun NavRow(icon: Int, title: String, subtitle: String = "", color: Color? = null, trailing: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val c = LocalDc.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        IconTile(icon, size = 44.dp, tint = color)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = color ?: c.text)
            if (subtitle.isNotEmpty()) Text(subtitle, fontSize = 13.sp, color = c.muted, lineHeight = 20.sp)
        }
        if (trailing != null) trailing() else Icon(painterResource(R.drawable.ic_chevron_end), null, tint = c.muted, modifier = Modifier.size(20.dp))
    }
}

@Composable
fun ChoiceChips(options: List<Pair<String, String>>, value: String, onChange: (String) -> Unit) {
    val c = LocalDc.current
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(options.size) { i ->
            val (key, label) = options[i]
            val on = key == value
            Text(
                label,
                color = if (on) c.text else c.muted,
                fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                fontSize = 15.sp,
                modifier = Modifier.clip(RoundedCornerShape(50))
                    .background(if (on) c.button.copy(alpha = 0.16f) else c.cardHigh)
                    .border(1.5.dp, if (on) c.button else Color.Transparent, RoundedCornerShape(50))
                    .clickable { onChange(key) }
                    .padding(horizontal = 18.dp, vertical = 10.dp),
            )
        }
    }
}

@Composable
fun MessageText(text: String, error: Boolean) {
    if (text.isEmpty()) return
    val c = LocalDc.current
    Text(
        text,
        color = if (error) c.unsecured else c.accent,
        fontSize = 14.sp,
        lineHeight = 22.sp,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background((if (error) c.unsecured else c.accent).copy(alpha = 0.1f)).padding(12.dp),
    )
}

// Links, usernames and numbers read left to right inside Persian pages.
@Composable
fun Ltr(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr, content = content)
}

// Notices are written in Persian, so they are right to left in Estedad whatever the app's language.
@Composable
fun NoticeText(body: String, color: Color, size: Int = 14) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        Text(
            body,
            modifier = Modifier.fillMaxWidth(),
            style = TextStyle(fontFamily = Estedad, fontSize = size.sp, lineHeight = (size * 1.8).sp, color = color, textDirection = TextDirection.Rtl, textAlign = TextAlign.Start),
        )
    }
}
