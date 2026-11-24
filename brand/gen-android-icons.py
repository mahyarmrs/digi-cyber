import importlib.util, pathlib
spec = importlib.util.spec_from_file_location('parts', pathlib.Path(__file__).with_name('mark.py')); parts = importlib.util.module_from_spec(spec); spec.loader.exec_module(parts)
R = str(pathlib.Path(__file__).resolve().parent.parent / 'android/app/src/main/res')
def paths(fill_attr, simple=False, shield=True, shield_fill=None):
    out = [f'<path {fill_attr} android:pathData="{parts.D}"/>']
    lines = parts.LINES if not simple else [parts.LINES[0], parts.LINES[2]]
    for x1, x2, y in lines:
        r = 10; t, b = y - 10, y + 10
        out.append(f'<path {fill_attr} android:pathData="M{x1+r} {t}H{x2-r}A{r} {r} 0 0 1 {x2-r} {b}H{x1+r}A{r} {r} 0 0 1 {x1+r} {t}Z"/>')
    if not simple:
        for cx, cy in parts.DOTS:
            out.append(f'<path {fill_attr} android:pathData="M{cx-10} {cy}A10 10 0 1 1 {cx+10} {cy}A10 10 0 1 1 {cx-10} {cy}Z"/>')
    if shield and not simple:
        sf = f'android:fillColor="{shield_fill}" ' if shield_fill else ''
        stroke = fill_attr.replace('fillColor', 'strokeColor')
        out.append(f'<path {sf}{stroke} android:strokeWidth="12" android:strokeLineJoin="round" android:pathData="{parts.SHIELD}"/>')
    return out
GRAD = lambda attr: (f'<aapt:attr name="android:{attr}"><gradient android:type="linear" android:startX="80" android:startY="140" android:endX="430" android:endY="380">'
    '<item android:offset="0" android:color="#FF2FD3FF"/><item android:offset="0.5" android:color="#FF4F7BFF"/><item android:offset="1" android:color="#FF9B6BFF"/></gradient></aapt:attr>')
def grad_paths():
    # Each path carries its own gradient (aapt:attr); the shield is an outline with a dark fill.
    out = []
    lines = [parts.D] + [f'M{x1+10} {y-10}H{x2-10}A10 10 0 0 1 {x2-10} {y+10}H{x1+10}A10 10 0 0 1 {x1+10} {y-10}Z' for x1, x2, y in parts.LINES] + \
        [f'M{cx-10} {cy}A10 10 0 1 1 {cx+10} {cy}A10 10 0 1 1 {cx-10} {cy}Z' for cx, cy in parts.DOTS]
    for d in lines:
        out.append(f'<path android:pathData="{d}">{GRAD("fillColor")}</path>')
    out.append(f'<path android:fillColor="#FF0A1030" android:strokeWidth="12" android:strokeLineJoin="round" android:pathData="{parts.SHIELD}">{GRAD("strokeColor")}</path>')
    return out
def vector(size_dp, viewport, body, comment):
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
        f'<!-- {comment} -->\n'
        '<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt"\n'
        f'    android:width="{size_dp}dp" android:height="{size_dp}dp" android:viewportWidth="{viewport}" android:viewportHeight="{viewport}">\n'
        + body + '\n</vector>\n')
# Launcher foreground: 108 × 108, the mark inside the 66 dp safe zone (512 → 58 units).
s = 58 / 512 * 1.26
t = 54 - 262 * s
sm = 58 / 512 * 1.5
tm = 54 - 262 * sm
fg = f'    <group android:scaleX="{s:.5f}" android:scaleY="{s:.5f}" android:translateX="{t:.3f}" android:translateY="{54-256*s:.3f}">\n        ' + '\n        '.join(grad_paths()) + '\n    </group>'
# a thin ring like the logo's
ring = ('    <path android:strokeWidth="1.6" android:pathData="M54 21A33 33 0 1 1 54 87A33 33 0 1 1 54 21Z">'
    '<aapt:attr name="android:strokeColor"><gradient android:type="linear" android:startX="30" android:startY="25" android:endX="80" android:endY="85">'
    '<item android:offset="0" android:color="#FF2FD3FF"/><item android:offset="1" android:color="#FF9B6BFF"/></gradient></aapt:attr></path>\n')
open(f'{R}/drawable/ic_launcher_foreground.xml', 'w').write(vector(108, 108, ring + fg, 'The Digi Cyber mark inside its ring, for the adaptive launcher icon.'))
mono = f'    <group android:scaleX="{sm:.5f}" android:scaleY="{sm:.5f}" android:translateX="{tm:.3f}" android:translateY="{54-256*sm:.3f}">\n        ' + '\n        '.join(paths('android:fillColor="#FFFFFFFF"', shield=False)) + '\n    </group>'
open(f'{R}/drawable/ic_launcher_monochrome.xml', 'w').write(vector(108, 108, mono, 'The Digi Cyber mark in one colour, for themed launcher icons.'))
st = '    <group android:scaleX="1.36" android:scaleY="1.36" android:translateX="-100.3" android:translateY="-92.2">\n        ' + '\n        '.join(paths('android:fillColor="#FFFFFFFF"', simple=True)) + '\n    </group>'
open(f'{R}/drawable/ic_stat_dc.xml', 'w').write(vector(24, 512, st, 'The Digi Cyber mark in one colour, for the status bar.'))
open(f'{R}/values/ic_launcher_background.xml', 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0A1030</color>\n</resources>\n')
print('ok')
