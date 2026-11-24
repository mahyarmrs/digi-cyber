# Digi Cyber mark parts in a 512 box; centred by a +6 shift.
D = "M176 132H300A124 124 0 0 1 300 380H176L214 330H300A74 74 0 0 0 300 182H214Z"
SHIELD = "M306 206L348 221V256C348 284 330 302 306 310C282 302 264 284 264 256V221Z"
LINES = [  # (x1, x2, y) bars, rounded; dots (cx, cy)
    (154, 246, 218), (114, 240, 256), (162, 246, 294)]
DOTS = [(130, 218), (90, 256), (138, 294)]
def body(fill, shield_fill, simple=False, stroke_w=12):
    out = [f'<path d="{D}" fill="{fill}"/>']
    for x1, x2, y in (LINES if not simple else [LINES[0], LINES[2]]):
        out.append(f'<rect x="{x1}" y="{y-10}" width="{x2-x1}" height="20" rx="10" fill="{fill}"/>')
    if not simple:
        for cx, cy in DOTS: out.append(f'<circle cx="{cx}" cy="{cy}" r="10" fill="{fill}"/>')
        out.append(f'<path d="{SHIELD}" fill="{shield_fill}" stroke="{fill}" stroke-width="{stroke_w}" stroke-linejoin="round"/>')
    return '<g transform="translate(6 0)">' + ''.join(out) + '</g>'
GRAD = '<linearGradient id="g" x1="80" y1="140" x2="430" y2="380" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2FD3FF"/><stop offset="0.5" stop-color="#4F7BFF"/><stop offset="1" stop-color="#9B6BFF"/></linearGradient>'
RING = '<linearGradient id="r" x1="60" y1="60" x2="452" y2="452" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2FD3FF"/><stop offset="1" stop-color="#9B6BFF"/></linearGradient>'
BG = '<radialGradient id="bg" cx="0.5" cy="0.4" r="0.75"><stop offset="0" stop-color="#141D42"/><stop offset="1" stop-color="#060A17"/></radialGradient>'
def svg(inner, defs=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>{defs}</defs>{inner}</svg>'
def mark(shield_fill='none'):
    return svg(body('url(#g)', shield_fill), GRAD)
def icon(rounded=True, ring=True, scale=0.7):
    bg = f'<rect width="512" height="512" rx="{116 if rounded else 0}" fill="url(#bg)"/>'
    r = '<circle cx="256" cy="256" r="200" fill="none" stroke="url(#r)" stroke-width="10"/>' if ring else ''
    g = f'<g transform="translate(256 256) scale({scale}) translate(-256 -256)">{body("url(#g)", "#0A1030")}</g>'
    return svg(bg + r + g, GRAD + RING + BG)
def mono(color, simple=False, shield_fill='none'):
    return svg(body(color, shield_fill, simple))
