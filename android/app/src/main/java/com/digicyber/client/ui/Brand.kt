package com.digicyber.client.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asComposePath
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.PathParser

// The Digi Cyber mark from the logo: the open D, its speed lines and the shield (brand/mark.py
// draws the same shapes for the icons). Drawn in its own 400 × 290 box.
private object MarkShapes {
    const val D = "M176 132H300A124 124 0 0 1 300 380H176L214 330H300A74 74 0 0 0 300 182H214Z"
    const val SHIELD = "M306 206L348 221V256C348 284 330 302 306 310C282 302 264 284 264 256V221Z"
    val lines = listOf(Triple(154f, 246f, 218f), Triple(114f, 240f, 256f), Triple(162f, 246f, 294f))
    val dots = listOf(Offset(130f, 218f), Offset(90f, 256f), Offset(138f, 294f))

    fun path(d: String): Path = PathParser.createPathFromPathData(d).asComposePath()
}

@Composable
fun DcMark(modifier: Modifier = Modifier, brush: Brush? = null, color: Color? = null) {
    val d = remember { MarkShapes.path(MarkShapes.D) }
    val shield = remember { MarkShapes.path(MarkShapes.SHIELD) }
    Canvas(modifier) {
        val s = minOf(size.width / 400f, size.height / 290f)
        val paint: Brush = brush ?: if (color != null) SolidColor(color) else Brush.linearGradient(Palette.brand, start = Offset(80f, 140f), end = Offset(430f, 380f))
        withTransform({
            translate((size.width - 400f * s) / 2f, (size.height - 290f * s) / 2f)
            scale(s, s, pivot = Offset.Zero)
            translate(-54f, -110f)
        }) {
            drawPath(d, paint)
            for ((x1, x2, y) in MarkShapes.lines) {
                drawRoundRect(paint, topLeft = Offset(x1, y - 10f), size = Size(x2 - x1, 20f), cornerRadius = CornerRadius(10f, 10f))
            }
            for (c in MarkShapes.dots) drawCircle(paint, radius = 10f, center = c)
            drawPath(shield, paint, style = Stroke(width = 12f, join = StrokeJoin.Round))
        }
    }
}

// Text painted with the logo's gradient.
fun Modifier.gradientText(brush: Brush = Palette.horizontal()): Modifier =
    graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen).drawWithContent {
        drawContent()
        drawRect(brush, blendMode = BlendMode.SrcAtop)
    }

// The mark and "digicyber", cyber in the gradient; the wordmark always reads left to right.
@Composable
fun Wordmark(size: TextUnit = 18.sp, color: Color? = null, markColor: Color? = null, showMark: Boolean = true) {
    val c = LocalDc.current
    Ltr {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (showMark) {
                DcMark(Modifier.size((size.value * 1.7f).dp, (size.value * 1.25f).dp), color = markColor)
                Spacer(Modifier.width((size.value * 0.45f).dp))
            }
            Text("digi", color = color ?: c.text, fontSize = size, fontWeight = FontWeight.Bold)
            Text("cyber", color = color?.copy(alpha = 0.8f) ?: Palette.blue, fontSize = size, fontWeight = FontWeight.Bold, modifier = if (color == null) Modifier.gradientText() else Modifier)
        }
    }
}

// The main action: the logo's gradient, full width.
@Composable
fun GradientButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false, height: Dp = 56.dp, onClick: () -> Unit) {
    val active = enabled && !loading
    Box(
        modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(18.dp)).background(Palette.gradient()).alpha(if (active) 1f else 0.55f)
            .clickable(enabled = active, onClick = onClick).semantics { role = Role.Button },
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            if (loading) {
                CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
            }
            Text(text, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

// A see-through button for the gradient hero.
@Composable
fun GlassButton(text: String, icon: Int? = null, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(18.dp)).background(Color.White.copy(alpha = 0.16f))
            .border(1.dp, Color.White.copy(alpha = 0.35f), RoundedCornerShape(18.dp)).clickable(onClick = onClick).semantics { role = Role.Button },
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                Icon(painterResource(icon), null, tint = Color.White, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
            }
            Text(text, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
    }
}
