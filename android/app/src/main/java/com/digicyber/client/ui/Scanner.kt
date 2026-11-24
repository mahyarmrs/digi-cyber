package com.digicyber.client.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.GlobalHistogramBinarizer
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory
import kotlin.math.max
import com.digicyber.client.R

// The camera reads QR codes on the phone itself (ZXing, no Google services needed), so it works
// on every Android the app runs on.
@Composable
fun ScannerScreen(message: String, onResult: (String) -> Unit, onImage: () -> Unit, onClose: () -> Unit) {
    val t = LocalT.current
    val context = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var denied by remember { mutableStateOf(false) }
    var torch by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok
        denied = !ok
    }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (granted) CameraPreview(torch, onResult)
        ScanFrame(Modifier.fillMaxSize())
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(R.drawable.ic_close, t("close"), background = Color.Black.copy(alpha = 0.45f), tint = Color.White, onClick = onClose)
            Spacer(Modifier.weight(1f))
            if (granted) {
                CircleIconButton(R.drawable.ic_flashlight, t("torch"), background = if (torch) Palette.cyan else Color.Black.copy(alpha = 0.45f), tint = if (torch) Palette.midnight else Color.White) { torch = !torch }
            }
        }
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(t("scanTitle"), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text(if (denied) t("cameraDenied") else t("scanHint"), color = Color.White.copy(alpha = 0.8f), fontSize = 14.sp, textAlign = TextAlign.Center, lineHeight = 22.sp)
            if (message.isNotEmpty()) Text(message, color = Color(0xFFFF8A80), fontSize = 14.sp, textAlign = TextAlign.Center)
            Spacer(Modifier.height(4.dp))
            SecondaryButton(t("chooseImage"), icon = R.drawable.ic_image, color = Color.White, onClick = onImage)
        }
    }
}

@Composable
private fun CameraPreview(torch: Boolean, onResult: (String) -> Unit) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val holder = remember { arrayOfNulls<BarcodeView>(1) }
    var done by remember { mutableStateOf(false) }
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            BarcodeView(ctx).apply {
                decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
                decodeContinuous(BarcodeCallback { result ->
                    val text = result.text
                    if (!done && !text.isNullOrBlank()) {
                        done = true
                        onResult(text)
                    }
                })
                holder[0] = this
                resume()
            }
        },
    )
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> holder[0]?.resume()
                Lifecycle.Event.ON_PAUSE -> holder[0]?.pause()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            holder[0]?.pause()
        }
    }
    LaunchedEffect(torch) { holder[0]?.setTorch(torch) }
}

// The dark veil with a clear window and teal corners where the code goes.
@Composable
private fun ScanFrame(modifier: Modifier) {
    Canvas(modifier.graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)) {
        val side = minOf(size.width, size.height) * 0.68f
        val topLeft = Offset((size.width - side) / 2, (size.height - side) / 2 - 40.dp.toPx())
        val radius = CornerRadius(28.dp.toPx())
        drawRect(Color.Black.copy(alpha = 0.55f))
        drawRoundRect(Color.Transparent, topLeft, Size(side, side), radius, blendMode = BlendMode.Clear)
        val arm = side * 0.18f
        val stroke = Stroke(width = 5.dp.toPx(), cap = StrokeCap.Round)
        val r = 28.dp.toPx()
        val l = topLeft.x
        val tp = topLeft.y
        val rt = l + side
        val b = tp + side
        val corners = listOf(
            listOf(Offset(l, tp + arm), Offset(l, tp + r), Offset(l + r, tp), Offset(l + arm, tp)),
            listOf(Offset(rt - arm, tp), Offset(rt - r, tp), Offset(rt, tp + r), Offset(rt, tp + arm)),
            listOf(Offset(rt, b - arm), Offset(rt, b - r), Offset(rt - r, b), Offset(rt - arm, b)),
            listOf(Offset(l + arm, b), Offset(l + r, b), Offset(l, b - r), Offset(l, b - arm)),
        )
        for (pts in corners) {
            val path = androidx.compose.ui.graphics.Path().apply {
                moveTo(pts[0].x, pts[0].y)
                lineTo(pts[1].x, pts[1].y)
                quadraticTo(if (pts[1].x == pts[0].x) pts[1].x else pts[2].x, if (pts[1].x == pts[0].x) pts[2].y else pts[1].y, pts[2].x, pts[2].y)
                lineTo(pts[3].x, pts[3].y)
            }
            drawPath(path, Palette.cyan, style = stroke)
        }
    }
}

// A QR code in a picture: a screenshot of the bot's message, or the photo it sent.
object QrImage {
    fun decode(context: Context, uri: Uri): String? {
        val bitmap = load(context, uri, 1600) ?: return null
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
        val source: LuminanceSource = RGBLuminanceSource(w, h, pixels)
        val hints = mapOf<DecodeHintType, Any>(DecodeHintType.TRY_HARDER to true, DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE))
        for (candidate in listOf(source, source.invert())) {
            for (binary in listOf(BinaryBitmap(HybridBinarizer(candidate)), BinaryBitmap(GlobalHistogramBinarizer(candidate)))) {
                val text = runCatching { QRCodeReader().decode(binary, hints).text }.getOrNull()
                if (!text.isNullOrBlank()) return text
            }
        }
        return null
    }

    private fun load(context: Context, uri: Uri, maxSide: Int): Bitmap? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > maxSide) sample *= 2
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
    }.getOrNull()
}
