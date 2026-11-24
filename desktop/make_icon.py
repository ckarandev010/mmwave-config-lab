"""Draws desktop/icon.ico: a radar field-of-view wedge with range rings. Needs Pillow."""
import math
import os

from PIL import Image, ImageDraw

S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([8, 8, S - 8, S - 8], radius=48, fill=(47, 91, 211, 255))
cx, cy = S / 2, S - 44
# field-of-view wedge
a0, a1 = math.radians(-60), math.radians(60)
pts = [(cx, cy)] + [(cx + 170 * math.sin(a0 + (a1 - a0) * k / 40), cy - 170 * math.cos(a0 + (a1 - a0) * k / 40)) for k in range(41)]
d.polygon(pts, fill=(255, 255, 255, 60))
# range rings
for r in (60, 110, 160):
    d.arc([cx - r, cy - r, cx + r, cy + r], start=210, end=330, fill=(255, 255, 255, 235), width=10)
# detections
for x, y in ((150, 92), (104, 120), (170, 150)):
    d.ellipse([x - 11, y - 11, x + 11, y + 11], fill=(120, 230, 220, 255))
d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=(255, 255, 255, 255))
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.ico")
img.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(out)
