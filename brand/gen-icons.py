import subprocess, io, os, sys
from PIL import Image
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location('parts', pathlib.Path(__file__).with_name('mark.py')); parts = importlib.util.module_from_spec(spec); spec.loader.exec_module(parts)
D = str(pathlib.Path(__file__).resolve().parent.parent)
def render(svg, size):
    png = subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size)], input=svg.encode(), capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(png)).convert('RGBA')
big = parts.icon(scale=0.78)
small = parts.icon(ring=False, scale=1.0)
def app_icon(size): return render(big if size >= 64 else small, size)
# Desktop app icons
app_icon(512).save(f'{D}/build/icon.png')
for s in (16, 24, 32, 48, 64, 128, 256, 512):
    app_icon(s).save(f'{D}/build/icons/{s}x{s}.png')
ico_sizes = [16, 24, 32, 48, 64, 128, 256]
imgs = [app_icon(s) for s in ico_sizes]
imgs[-1].save(f'{D}/build/icon.ico', sizes=[(s, s) for s in ico_sizes], append_images=imgs[:-1])
# macOS: the icon sits inside a smaller rounded square, as Big Sur icons do.
mac = parts.svg('<g transform="translate(256 256) scale(0.82) translate(-256 -256)">' + parts.icon(scale=0.78).split('</defs>',1)[1].rsplit('</svg>',1)[0] + '</g>', parts.GRAD + parts.RING + parts.BG)
render(mac, 1024).save(f'/tmp/icon-mac.png')
Image.open('/tmp/icon-mac.png').save(f'{D}/build/icon.icns')
# Tray: one colour, the simple mark (no shield, two lines) below 32 px
def tray(color, size):
    svg = parts.mono(color, simple=size < 32)
    inner = svg.split('<defs></defs>',1)[1].rsplit('</svg>',1)[0]
    svg = parts.svg(f'<g transform="translate(256 256) scale(1.38) translate(-262 -256)">{inner}</g>')
    return render(svg, size)
for shade, color in (('white', '#ffffff'), ('dark', '#0E1430')):
    for s in (16, 20, 24, 32, 48, 64):
        tray(color, s).save(f'{D}/build/tray/tray-{shade}-{s}.png')
    ims = [tray(color, s) for s in (16, 20, 24, 32, 48, 64)]
    ims[-1].save(f'{D}/build/tray/tray-{shade}.ico', sizes=[(s, s) for s in (16, 20, 24, 32, 48, 64)], append_images=ims[:-1])
tray('#000000', 18).save(f'{D}/build/tray/trayTemplate.png')
tray('#000000', 36).save(f'{D}/build/tray/trayTemplate@2x.png')
# Android launcher PNGs (pre-26 devices): rounded square and circle
R = f'{D}/android/app/src/main/res'
for name, s in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
    app_icon(s).save(f'{R}/mipmap-{name}/ic_launcher.png')
    circ = render(parts.svg('<clipPath id="c"><circle cx="256" cy="256" r="256"/></clipPath><g clip-path="url(#c)">' + parts.icon(rounded=False, scale=0.78).split('</defs>',1)[1].rsplit('</svg>',1)[0] + '</g>', parts.GRAD + parts.RING + parts.BG), s)
    circ.save(f'{R}/mipmap-{name}/ic_launcher_round.png')
# Hub / README logo
app_icon(256).save(f'{D}/hub/assets/logo.png')
open(f'{D}/src/renderer/logo.svg', 'w').write(parts.mark())
print('ok')
