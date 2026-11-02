from pathlib import Path
import struct
from PIL import Image

ROOT = Path(r"D:\数据库")
SRC = ROOT / "assets" / "icons" / "moss-core-1024.png"
OUT = ROOT / "assets" / "icons" / "moss-core-bmp.ico"

sizes = [256, 128, 64, 48, 32, 16]
img = Image.open(SRC).convert("RGBA")


def bmp_entry(im):
    w, h = im.size
    px = im.load()
    # ICO stores BGRA, bottom-up.
    rows = []
    for y in range(h - 1, -1, -1):
        row = bytearray()
        for x in range(w):
            r, g, b, a = px[x, y]
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    xor = b"".join(rows)
    and_row = ((w + 31) // 32) * 4
    and_mask = b"\x00" * (and_row * h)
    bih = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(xor) + len(and_mask), 0, 0, 0, 0)
    return bih + xor + and_mask


blobs = []
for s in sizes:
    im = img.resize((s, s), Image.Resampling.LANCZOS)
    blobs.append((s, bmp_entry(im)))

offset = 6 + 16 * len(blobs)
header = struct.pack("<HHH", 0, 1, len(blobs))
entries = b""
for s, data in blobs:
    entries += struct.pack("<BBBBHHII", 0 if s >= 256 else s, 0 if s >= 256 else s, 0, 0, 1, 32, len(data), offset)
    offset += len(data)

OUT.write_bytes(header + entries + b"".join(d for _, d in blobs))
print("WROTE", OUT, OUT.stat().st_size)
