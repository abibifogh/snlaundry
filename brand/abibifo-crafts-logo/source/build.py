"""Build the polished Abibifo Crafts & More logo kit (vector master + exports)."""
import os, re, sys, math, io, json, shutil
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import cairosvg
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "kit")

# ---------- brand palette ----------
GOLD = "#B8833F"      # Abibifo Gold   (sampled from original)
CHAR = "#626262"      # Charcoal       (the C)
LINE = "#8C8C8C"      # Stone          (ring, slash, rules)
INK = "#1E1E1E"       # Ink            (tagline)
CREAM = "#FAF6EF"     # Ivory          (light backgrounds)
DARK = "#1E1E1E"      # Ink background for reversed use

PALETTES = {
    "color":    dict(a=GOLD, c=CHAR, line=LINE, word=GOLD, tag=INK),
    "reversed": dict(a=GOLD, c="#E8E8E8", line="#A8A8A8", word=GOLD, tag="#F4F1EC"),
    "black":    dict(a="#000", c="#000", line="#000", word="#000", tag="#000"),
    "white":    dict(a="#FFF", c="#FFF", line="#FFF", word="#FFF", tag="#FFF"),
    "gold":     dict(a=GOLD, c=GOLD, line=GOLD, word=GOLD, tag=GOLD),
}

# ---------- type -> outlines ----------
class Face:
    def __init__(self, path):
        self.tt = TTFont(path)
        self.upm = self.tt["head"].unitsPerEm
        self.gs = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        blob = hb.Blob.from_file_path(path)
        self.hbfont = hb.Font(hb.Face(blob))

    def cap_height(self):
        return self.tt["OS/2"].sCapHeight

    def path(self, text, size, tracking=0.0):
        """Return (svg path d, advance width) with baseline at y=0. tracking in em."""
        buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
        hb.shape(self.hbfont, buf, {"kern": True, "liga": False})
        s = size / self.upm
        x = 0.0; ds = []
        n = len(buf.glyph_infos)
        for k, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
            name = self.order[info.codepoint]
            pen = SVGPathPen(self.gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
            tp = TransformPen(pen, (s, 0, 0, -s, x + pos.x_offset * s, -pos.y_offset * s))
            self.gs[name].draw(tp)
            ds.append(pen.getCommands())
            x += pos.x_advance * s
            if k < n - 1:
                x += tracking * size
        return " ".join(d for d in ds if d), x

FONTS = os.path.join(HERE, "fonts")
JOST = Face(os.path.join(FONTS, "jost500.ttf"))
CORM = Face(os.path.join(FONTS, "corm700.ttf"))

# ---------- monogram (coordinates from the traced original) ----------
A_D = open(os.path.join(HERE, "pathA.txt")).read()
C_RAW = open(os.path.join(HERE, "pathC.txt")).read()
# drop the stray sliver of the ring that the C trace picked up (smallest subpath)
subs = [p.strip() for p in re.split(r"(?=M)", C_RAW) if p.strip()]
def _extent(p):
    nums = list(map(float, re.findall(r"-?\d+\.?\d*", p)))
    xs, ys = nums[0::2], nums[1::2]
    return (max(xs) - min(xs)) * (max(ys) - min(ys))
C_D = " ".join(p for p in subs if _extent(p) > 5000)

CX, CY, R = 1003.0, 774.0, 689.5
GAP_START, GAP_END = -105.5, 14.0      # ring opening (degrees, y-down)
SLASH = ((648.0, 1099.0), (1195.0, 356.0))
RULE_Y, RULE_IN, RULE_OUT = 1503.0, 152.0, 600.0

def arc_d(cx, cy, r, a0, a1):
    """Arc drawn clockwise (y-down) from angle a0 to a1."""
    p = lambda a: (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
    (x0, y0), (x1, y1) = p(a0), p(a1)
    sweep = (a1 - a0) % 360
    return f"M{x0:.2f},{y0:.2f} A{r},{r} 0 {1 if sweep > 180 else 0} 1 {x1:.2f},{y1:.2f}"

def mark(pal, bold=False, rules=True):
    """Monogram group in source coordinates. bold=True thickens hairlines for tiny sizes."""
    ring_w, slash_w, rule_w = (46, 34, 0) if bold else (6.5, 5.5, 3.5)
    if bold: pal = dict(pal, line=pal["c"])
    glyph = (lambda col: f' stroke="{col}" stroke-width="20" stroke-linejoin="round"') if bold else (lambda col: "")
    g = [f'<path d="{arc_d(CX, CY, R, GAP_END, GAP_START + 360)}" fill="none" stroke="{pal["line"]}" stroke-width="{ring_w}" stroke-linecap="round"/>',
         f'<line x1="{SLASH[0][0]}" y1="{SLASH[0][1]}" x2="{SLASH[1][0]}" y2="{SLASH[1][1]}" stroke="{pal["line"]}" stroke-width="{slash_w}" stroke-linecap="round"/>',
         f'<path d="{A_D}" fill="{pal["a"]}" fill-rule="evenodd"{glyph(pal["a"])}/>',
         f'<path d="{C_D}" fill="{pal["c"]}" fill-rule="evenodd"{glyph(pal["c"])}/>']
    if rules and not bold:
        for x0, x1 in ((CX - RULE_OUT, CX - RULE_IN), (CX + RULE_IN, CX + RULE_OUT)):
            g.append(f'<line x1="{x0}" y1="{RULE_Y}" x2="{x1}" y2="{RULE_Y}" stroke="{pal["line"]}" stroke-width="{rule_w}"/>')
    return "\n".join(g)

# bounding boxes of the mark (with / without the rules)
MARK_BOX = (CX - R - 4, 180.0 - 4, CX + R + 4, CY + R + 4)   # A apex ~187
MARK_BOX_RULES = (CX - R - 4, 180.0 - 4, CX + R + 4, RULE_Y + 3)

# ---------- wordmark ----------
WORD = "ABIBIFO CRAFTS & MORE"
TAG = "where tradition, passion and creativity converge"

def wordmark(pal, width, tagline=True, align="center", tag_scale=1.0):
    """Wordmark block of given width; returns (svg, height). Origin top-left."""
    cap = JOST.cap_height() / JOST.upm
    d, w = JOST.path(WORD, 100, tracking=0.20)
    s = width / w
    capH = cap * 100 * s
    out = [f'<path transform="translate(0,{capH:.2f}) scale({s:.5f})" d="{d}" fill="{pal["word"]}"/>']
    h = capH
    if tagline:
        td, tw = CORM.path(TAG, 100, tracking=0.06)
        ts = width * 0.80 * tag_scale / tw
        tgap = capH * 0.95
        asc = 0.70 * 100 * ts         # Cormorant ascender ~0.70 em
        base = h + tgap + asc
        tx = {"center": (width - tw * ts) / 2, "left": 0, "right": width - tw * ts}[align]
        out.append(f'<path transform="translate({tx:.2f},{base:.2f}) scale({ts:.5f})" d="{td}" fill="{pal["tag"]}"/>')
        h = base + 0.24 * 100 * ts    # descender
    return "\n".join(out), h

# ---------- compositions ----------
def svg_doc(body, w, h, bg=None, title="Abibifo Crafts &amp; More"):
    bgr = f'<rect width="100%" height="100%" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}">'
            f'<title>{title}</title>{bgr}\n{body}\n</svg>\n')

def place_mark(pal, x, y, scale, bold=False, rules=True):
    box = MARK_BOX_RULES if rules else MARK_BOX
    return (f'<g transform="translate({x:.2f},{y:.2f}) scale({scale:.5f}) translate({-box[0]:.2f},{-box[1]:.2f})">'
            f'{mark(pal, bold, rules)}</g>'), (box[2] - box[0]) * scale, (box[3] - box[1]) * scale

def stacked(pal, bg=None, tagline=True):
    W = 2000; pad = 140
    mw = 1240
    m, mw_, mh = place_mark(pal, (W - mw) / 2, pad, mw / (MARK_BOX_RULES[2] - MARK_BOX_RULES[0]))
    ww = W - 2 * pad - 60
    wm, wh = wordmark(pal, ww, tagline)
    y = pad + mh + 110
    body = m + f'<g transform="translate({(W - ww) / 2:.2f},{y:.2f})">{wm}</g>'
    return svg_doc(body, W, y + wh + pad, bg)

def horizontal(pal, bg=None, tagline=True):
    pad = 80; mh = 560
    box = MARK_BOX
    sc = mh / (box[3] - box[1]); mw = (box[2] - box[0]) * sc
    m, _, _ = place_mark(pal, pad, pad, sc, rules=False)
    ww = 1500
    wm, wh = wordmark(pal, ww, tagline, align="left", tag_scale=0.93)
    gap = 90
    # vertical divider in stone, then text block centred on the ring
    dx = pad + mw + gap
    div = f'<line x1="{dx:.1f}" y1="{pad + mh * 0.22:.1f}" x2="{dx:.1f}" y2="{pad + mh * 0.92:.1f}" stroke="{pal["line"]}" stroke-width="3"/>'
    tx = dx + gap
    ty = pad + (box[1] * 0 + (CY - box[1]) * sc) - wh / 2 + 20
    body = m + div + f'<g transform="translate({tx:.2f},{ty:.2f})">{wm}</g>'
    return svg_doc(body, tx + ww + pad, mh + 2 * pad, bg)

def icon(pal, bg=None, size=2000, pad_frac=0.10, bold=False):
    box = MARK_BOX
    bw, bh = box[2] - box[0], box[3] - box[1]
    sc = size * (1 - 2 * pad_frac) / max(bw, bh)
    x = (size - bw * sc) / 2; y = (size - bh * sc) / 2
    m, _, _ = place_mark(pal, x, y, sc, bold=bold, rules=False)
    return svg_doc(m, size, size, bg)

def wordmark_only(pal, bg=None, tagline=False):
    pad = 60; ww = 2000
    wm, wh = wordmark(pal, ww, tagline)
    return svg_doc(f'<g transform="translate({pad},{pad})">{wm}</g>', ww + 2 * pad, wh + 2 * pad, bg)

def banner(pal, w, h, bg):
    """Social cover: horizontal lockup centred within the safe area."""
    inner = horizontal(pal, None)
    vb = list(map(float, re.search(r'viewBox="([^"]+)"', inner).group(1).split()))
    body = re.search(r"</title>(.*)</svg>", inner, re.S).group(1)
    sc = min(w * 0.72 / vb[2], h * 0.62 / vb[3])
    x = (w - vb[2] * sc) / 2; y = (h - vb[3] * sc) / 2
    return svg_doc(f'<g transform="translate({x:.2f},{y:.2f}) scale({sc:.5f})">{body}</g>', w, h, bg)

def square_profile(pal, bg, size=1080):
    """Profile picture: monogram sized to survive circular crops."""
    return icon(pal, bg, size, pad_frac=0.17)

# ---------- export helpers ----------
def write(rel, text):
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w").write(text); return p

def png(svg_text, rel, width, bg=None):
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    cairosvg.svg2png(bytestring=svg_text.encode(), write_to=p, output_width=width, background_color=bg)
    return p

def jpg(svg_text, rel, width, bg="#FFFFFF"):
    buf = cairosvg.svg2png(bytestring=svg_text.encode(), output_width=width, background_color=bg)
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    Image.open(io.BytesIO(buf)).convert("RGB").save(p, quality=95, optimize=True)

def pdf(svg_text, rel):
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    cairosvg.svg2pdf(bytestring=svg_text.encode(), write_to=p)

def eps(svg_text, rel):
    import cairocffi
    from cairosvg.surface import PSSurface
    p = os.path.join(OUT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    class EPSSurface(PSSurface):
        def _create_surface(self, width, height):
            s = cairocffi.PSSurface(self.output, width, height)
            s.set_eps(True)
            return s, width, height
    EPSSurface.convert(bytestring=svg_text.encode(), write_to=p)

if __name__ == "__main__":
    if os.path.exists(OUT): shutil.rmtree(OUT)
    LOCKUPS = {"stacked": stacked, "horizontal": horizontal, "monogram": icon, "wordmark": wordmark_only}
    VARIANTS = ["color", "reversed", "black", "white", "gold"]
    for lname, fn in LOCKUPS.items():
        for v in VARIANTS:
            s = fn(PALETTES[v])
            base = f"abibifo-{lname}-{v}"
            write(f"01-vector-svg/{base}.svg", s)
            pdf(s, f"02-print-pdf-eps/{base}.pdf")
            eps(s, f"02-print-pdf-eps/{base}.eps")
            for wpx in (500, 1000, 2000, 4000):
                png(s, f"03-png-transparent/{lname}/{base}-{wpx}px.png", wpx)
        # flat JPGs for places that don't take transparency
        jpg(fn(PALETTES["color"]), f"04-jpg-backgrounds/abibifo-{lname}-on-white.jpg", 2000, "#FFFFFF")
        jpg(fn(PALETTES["color"]), f"04-jpg-backgrounds/abibifo-{lname}-on-ivory.jpg", 2000, CREAM)
        jpg(fn(PALETTES["reversed"]), f"04-jpg-backgrounds/abibifo-{lname}-on-ink.jpg", 2000, DARK)

    # ---- web / app icons ----
    small = icon(PALETTES["color"], None, 512, pad_frac=0.04, bold=True)
    write("05-web-favicon/favicon.svg", small)
    for px in (16, 32, 48, 64):
        png(small, f"05-web-favicon/favicon-{px}.png", px)
    ims = [Image.open(os.path.join(OUT, f"05-web-favicon/favicon-{px}.png")) for px in (16, 32, 48)]
    ims[2].save(os.path.join(OUT, "05-web-favicon/favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)], append_images=ims[:2])
    app = icon(PALETTES["color"], "#FFFFFF", 1024, pad_frac=0.12)
    png(app, "05-web-favicon/apple-touch-icon.png", 180)
    for px in (192, 512):
        png(app, f"05-web-favicon/android-chrome-{px}.png", px)
    png(icon(PALETTES["color"], "#FFFFFF", 1024, pad_frac=0.22), "05-web-favicon/maskable-512.png", 512)
    write("05-web-favicon/site.webmanifest", json.dumps({
        "name": "Abibifo Crafts & More", "short_name": "Abibifo",
        "icons": [{"src": "android-chrome-192.png", "sizes": "192x192", "type": "image/png"},
                  {"src": "android-chrome-512.png", "sizes": "512x512", "type": "image/png"},
                  {"src": "maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
        "theme_color": GOLD, "background_color": "#FFFFFF", "display": "standalone"}, indent=2))
    write("05-web-favicon/head-snippet.html",
          '<link rel="icon" href="/favicon.ico" sizes="any">\n'
          '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
          '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
          '<link rel="manifest" href="/site.webmanifest">\n'
          f'<meta name="theme-color" content="{GOLD}">\n')

    # ---- social media ----
    soc = "06-social-media"
    png(square_profile(PALETTES["color"], "#FFFFFF"), f"{soc}/profile-picture-1080-white.png", 1080)
    png(square_profile(PALETTES["color"], CREAM), f"{soc}/profile-picture-1080-ivory.png", 1080)
    png(square_profile(PALETTES["reversed"], DARK), f"{soc}/profile-picture-1080-ink.png", 1080)
    png(square_profile(PALETTES["white"], GOLD), f"{soc}/profile-picture-1080-gold.png", 1080)
    for name, (w, h) in {"facebook-cover-1640x624": (1640, 624), "linkedin-banner-1584x396": (1584, 396),
                         "x-twitter-header-1500x500": (1500, 500), "youtube-banner-2560x1440": (2560, 1440)}.items():
        png(banner(PALETTES["color"], w, h, CREAM), f"{soc}/{name}.png", w)
    png(stacked(PALETTES["color"], "#FFFFFF"), f"{soc}/instagram-post-1080.png", 1080)
    st = stacked(PALETTES["color"])
    vb = list(map(float, re.search(r'viewBox="([^"]+)"', st).group(1).split()))
    body = re.search(r"</title>(.*)</svg>", st, re.S).group(1)
    sc = 1080 * 0.7 / vb[2]
    png(svg_doc(f'<g transform="translate({(1080 - vb[2] * sc) / 2:.1f},{(1920 - vb[3] * sc) / 2:.1f}) scale({sc:.5f})">{body}</g>', 1080, 1920, CREAM),
        f"{soc}/story-1080x1920.png", 1080)
    png(icon(PALETTES["color"], None, 1000, pad_frac=0.02), f"{soc}/watermark-monogram-transparent.png", 600)

    # ---- email signature & documents ----
    png(horizontal(PALETTES["color"]), "07-email-documents/email-signature-600w.png", 600)
    png(horizontal(PALETTES["color"]), "07-email-documents/email-signature-600w@2x.png", 1200)
    png(horizontal(PALETTES["color"], None, tagline=True), "07-email-documents/letterhead-header-2480w.png", 2480)
    jpg(stacked(PALETTES["color"]), "07-email-documents/document-cover-logo.jpg", 1600)
    print("done ->", OUT)
