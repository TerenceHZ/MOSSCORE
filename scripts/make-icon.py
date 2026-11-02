from pathlib import Path
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(r"D:\数据库")
OUT = ROOT / "assets" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)

# Work at 2x for clean downsampling.
S = 2048
K = S / 1024.0
CX = CY = S / 2

GOLD = (232, 160, 32)
GOLD_LIGHT = (255, 210, 122)
GOLD_DEEP = (138, 90, 18)
WHITE = (242, 240, 232)
RED = (255, 26, 18)
RED_DEEP = (100, 0, 0)
BG = (4, 4, 3)


def sc(v):
    return int(round(v * K))


def rounded_mask():
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([sc(24), sc(24), S - sc(24), S - sc(24)], radius=sc(178), fill=255)
    return m


def background():
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    dx = (xx - CX) / S
    dy = (yy - CY) / S
    dist = np.sqrt(dx * dx + dy * dy)

    # deep metal plate with a warm reactor bloom
    base = np.stack([
        np.full_like(dist, BG[0]),
        np.full_like(dist, BG[1]),
        np.full_like(dist, BG[2]),
    ], axis=-1)
    bloom = np.exp(-(dist / 0.34) ** 2)
    base[..., 0] += bloom * 34
    base[..., 1] += bloom * 20
    base[..., 2] += bloom * 4

    # subtle vertical brushed metal
    brush = (np.sin(yy * 0.23) * 2.0 + np.sin(yy * 0.071 + 1.2) * 1.2)[..., None]
    base += brush * np.array([1.0, 0.8, 0.45])

    # vignette
    vig = np.clip((dist - 0.30) / 0.38, 0, 1)
    base *= (1 - vig[..., None] * 0.55)

    rgb = np.clip(base, 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB").convert("RGBA")
    img.putalpha(rounded_mask())
    return img


def glow_layer(draw_fn, blur=18, opacity=0.9):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    draw_fn(d)
    layer = layer.filter(ImageFilter.GaussianBlur(sc(blur)))
    if opacity < 1:
        a = layer.getchannel("A").point(lambda v: int(v * opacity))
        layer.putalpha(a)
    return layer


def add(base, layer):
    return Image.alpha_composite(base, layer)


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


def arc_color(angle):
    # bright at top-left, deep at bottom-right
    v = 0.5 + 0.5 * math.cos(angle + math.radians(40))
    if v > 0.72:
        return GOLD_LIGHT + (255,)
    if v > 0.20:
        return GOLD + (255,)
    return GOLD_DEEP + (255,)


def draw_outer_ring(d, width=22, alpha=255):
    radius = sc(392)
    n = 12
    for i in range(n):
        a0 = -90 + i * (360 / n) + 2.0
        a1 = a0 + (360 / n) - 4.0
        c = arc_color(math.radians((a0 + a1) / 2))
        c = c[:3] + (alpha,)
        d.arc([CX - radius, CY - radius, CX + radius, CY + radius],
              a0, a1, fill=c, width=sc(width))
    # inner bezel
    r2 = sc(374)
    d.arc([CX - r2, CY - r2, CX + r2, CY + r2], 0, 360, fill=(40, 28, 12, 230), width=sc(4))


def draw_mid_ring(d, alpha=255):
    radius = sc(330)
    n = 48
    for i in range(n):
        a0 = -90 + i * (360 / n) + 1.0
        a1 = a0 + (360 / n) - 2.0
        col = (WHITE[0], WHITE[1], WHITE[2], int(alpha * (0.35 if i % 4 else 0.72)))
        d.arc([CX - radius, CY - radius, CX + radius, CY + radius],
              a0, a1, fill=col, width=sc(5 if i % 4 == 0 else 3))


def draw_inner_ring(d, alpha=255):
    radius = sc(224)
    d.arc([CX - radius, CY - radius, CX + radius, CY + radius], 0, 360,
          fill=(180, 140, 70, int(alpha * 0.55)), width=sc(3))
    radius = sc(168)
    d.arc([CX - radius, CY - radius, CX + radius, CY + radius], 0, 360,
          fill=(230, 190, 110, int(alpha * 0.4)), width=sc(2))


def ellipse_points(rx, ry, rot, steps=240):
    pts = []
    cr, sr = math.cos(rot), math.sin(rot)
    for i in range(steps + 1):
        t = i / steps * math.tau
        x = rx * math.cos(t)
        y = ry * math.sin(t)
        pts.append((CX + x * cr - y * sr, CY + x * sr + y * cr))
    return pts


def draw_orbits(d, alpha=255):
    for rx, ry, deg, w, col in [
        (390, 142, 28, 7, (255, 210, 122, int(alpha * 0.75))),
        (330, 118, -32, 5, (242, 240, 232, int(alpha * 0.45))),
        (285, 90, 8, 4, (232, 160, 32, int(alpha * 0.5))),
    ]:
        pts = ellipse_points(sc(rx), sc(ry), math.radians(deg))
        d.line(pts, fill=col, width=sc(w), joint="curve")


def draw_core(d, alpha=255):
    # dark well
    r = sc(154)
    d.ellipse([CX - r, CY - r, CX + r, CY + r], fill=(3, 3, 2, 255))
    d.arc([CX - r, CY - r, CX + r, CY + r], 0, 360,
          fill=(232, 160, 32, int(alpha * 0.95)), width=sc(12))
    # iris vanes
    for i in range(12):
        a = math.radians(-90 + i * 30)
        r0, r1 = sc(58), sc(146)
        c = (255, 210, 122, int(alpha * 0.75)) if i % 3 == 0 else (175, 125, 50, int(alpha * 0.55))
        d.line([(CX + math.cos(a) * r0, CY + math.sin(a) * r0),
                (CX + math.cos(a) * r1, CY + math.sin(a) * r1)],
               fill=c, width=sc(4 if i % 3 == 0 else 2.5))
    # inner gold ring
    r = sc(112)
    d.arc([CX - r, CY - r, CX + r, CY + r], 0, 360,
          fill=(255, 205, 115, int(alpha * 0.85)), width=sc(4))
    # red eye socket
    r = sc(70)
    d.ellipse([CX - r, CY - r, CX + r, CY + r], fill=(0, 0, 0, 255))
    d.arc([CX - r, CY - r, CX + r, CY + r], 0, 360,
          fill=(255, 80, 55, int(alpha * 0.8)), width=sc(3))
    # red glow disc
    for rr, aa in [(sc(60), 30), (sc(48), 50), (sc(34), 90), (sc(22), 170)]:
        d.ellipse([CX - rr, CY - rr, CX + rr, CY + rr], fill=(255, 26, 18, aa))
    # red core
    r = sc(24)
    d.ellipse([CX - r, CY - r, CX + r, CY + r], fill=(255, 28, 16, 255))
    r = sc(9)
    d.ellipse([CX - r, CY - r, CX + r, CY + r], fill=(255, 232, 210, 255))


def draw_nodes(d, alpha=255):
    # energy nodes around the reactor ring
    radius = sc(392)
    for i in range(8):
        a = math.radians(-90 + i * 45)
        x = CX + math.cos(a) * radius
        y = CY + math.sin(a) * radius
        r = sc(12 if i % 2 else 16)
        d.ellipse([x - r, y - r, x + r, y + r],
                  fill=(255, 225, 170, int(alpha * 0.95)))
        r2 = sc(5)
        d.ellipse([x - r2, y - r2, x + r2, y + r2],
                  fill=(255, 255, 245, int(alpha * 0.95)))


def draw_top_marker(d, alpha=255):
    # reactor alignment mark at 12 o'clock
    x, y = CX, CY - sc(438)
    pts = [(x, y - sc(12)), (x + sc(16), y + sc(16)), (x - sc(16), y + sc(16))]
    d.polygon(pts, fill=(255, 210, 122, int(alpha * 0.9)))


def draw_specks(d, alpha=255):
    # tiny star-ring dust, not too much
    rng = np.random.default_rng(550)
    for _ in range(38):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(sc(250), sc(455))
        x = CX + math.cos(a) * r
        y = CY + math.sin(a) * r * rng.uniform(.75, 1.0)
        s = rng.uniform(1.2, 3.4) * K
        d.ellipse([x - s, y - s, x + s, y + s],
                  fill=(255, 220, 160, int(alpha * rng.uniform(.12, .45))))


def build():
    img = background()

    # soft outer bloom
    img = add(img, glow_layer(lambda d: draw_outer_ring(d, 22, 255), blur=26, opacity=.38))
    img = add(img, glow_layer(lambda d: draw_orbits(d, 255), blur=16, opacity=.30))
    img = add(img, glow_layer(lambda d: draw_core(d, 255), blur=22, opacity=.75))

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    draw_specks(d)
    draw_orbits(d, 255)
    draw_outer_ring(d, 22, 255)
    draw_mid_ring(d, 255)
    draw_inner_ring(d, 255)
    draw_core(d, 255)
    draw_nodes(d, 255)
    draw_top_marker(d, 255)

    # inner dark bevel behind outer ring for depth
    img = Image.alpha_composite(img, layer)

    # inner shadow around the core
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ds = ImageDraw.Draw(shadow)
    r = sc(190)
    ds.ellipse([CX - r, CY - r, CX + r, CY + r], outline=(0, 0, 0, 180), width=sc(40))
    shadow = shadow.filter(ImageFilter.GaussianBlur(sc(20)))
    img = Image.alpha_composite(img, shadow)

    # thin titanium rim
    rim = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(rim)
    dr.rounded_rectangle([sc(24), sc(24), S - sc(24), S - sc(24)], radius=sc(178),
                         outline=(232, 160, 32, 210), width=sc(7))
    dr.rounded_rectangle([sc(40), sc(40), S - sc(40), S - sc(40)], radius=sc(164),
                         outline=(70, 50, 22, 160), width=sc(2))
    img = Image.alpha_composite(img, rim)

    master = img.resize((1024, 1024), Image.Resampling.LANCZOS)
    master.save(OUT / "moss-core-1024.png")

    for size in (512, 256, 128, 64, 48, 32, 16):
        im = master.resize((size, size), Image.Resampling.LANCZOS)
        im.save(OUT / f"moss-core-{size}.png")

    master.save(OUT / "moss-core.ico", format="ICO",
                sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    # Electron/tray/build icon
    master.save(BUILD / "icon.ico", format="ICO",
                sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    master.save(BUILD / "icon.png")

    print("WROTE", OUT / "moss-core.ico")
    print("WROTE", BUILD / "icon.ico")
    print("WROTE", OUT / "moss-core-1024.png")


if __name__ == "__main__":
    build()
