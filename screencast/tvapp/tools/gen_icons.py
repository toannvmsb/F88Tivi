"""Sinh logo web + icon/banner Android TV từ logo gốc F88 (assets/f88-logo.png), bằng Pillow.
Dùng: python gen_icons.py <thư mục res/drawable cho Android>"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))          # thư mục screencast
SRC = os.path.join(ROOT, 'assets', 'f88-logo.png')
PUBLIC = os.path.join(ROOT, 'public')
GREEN, FOREST, LIME = (24, 116, 92), (28, 86, 88), (98, 226, 34)
SS = 4

def font(size):
    for f in ('ariblk.ttf', 'arialbd.ttf', 'segoeuib.ttf'):
        p = os.path.join('C:/Windows/Fonts', f)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def recolor(img, rgb):
    out = Image.new('RGBA', img.size, rgb + (0,))
    out.putalpha(img.getchannel('A'))
    return out

# --- logo gốc: cắt sát nội dung, thêm lề nhỏ ---
src = Image.open(SRC).convert('RGBA')
x0, y0, x1, y1 = src.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
pad = 4
logo = src.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))          # xanh gốc, nền trong suốt
logo_white = recolor(logo, (255, 255, 255))                          # chữ F "khoét" lộ nền
h = logo.height
mark_white = logo_white.crop((0, 0, h, h))                           # chỉ khối tròn chứa chữ F

def fit(img, w=None, h=None):
    if w: h = round(img.height * w / img.width)
    else: w = round(img.width * h / img.height)
    return img.resize((w, h), Image.LANCZOS)

def gradient(w, h, c1, c2):
    img = Image.new('RGB', (w, h)); px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / w + y / h) / 2
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return img

def banner(path):
    W, H = 640 * SS, 360 * SS
    img = gradient(W, H, GREEN, FOREST).convert('RGBA')
    lw = fit(logo_white, w=380 * SS)
    img.alpha_composite(lw, ((W - lw.width) // 2, 70 * SS))
    d = ImageDraw.Draw(img)
    ft = font(58 * SS)
    a, b = 'F88', 'Tivi'
    wa, wb = d.textlength(a, font=ft), d.textlength(b, font=ft)
    x, y = (W - wa - wb) / 2, 285 * SS
    d.text((x, y), a, font=ft, fill=(255, 255, 255, 255), anchor='lm')
    d.text((x + wa, y), b, font=ft, fill=LIME + (255,), anchor='lm')
    img.convert('RGB').resize((640, 360), Image.LANCZOS).save(path)

def icon(path):
    S = 256 * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, S - 1, S - 1], radius=52 * SS, fill=GREEN)
    lw = fit(logo_white, w=200 * SS)
    img.alpha_composite(lw, ((S - lw.width) // 2, (S - lw.height) // 2))
    img.resize((256, 256), Image.LANCZOS).save(path)

def favicon(path):
    S = 256
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, S - 1, S - 1], radius=52, fill=GREEN)
    m = fit(mark_white, w=190)
    img.alpha_composite(m, ((S - m.width) // 2, (S - m.height) // 2))
    img.resize((64, 64), Image.LANCZOS).save(path)

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
banner(os.path.join(out, 'banner.png'))
icon(os.path.join(out, 'icon.png'))
logo.save(os.path.join(PUBLIC, 'logo.png'))
logo_white.save(os.path.join(PUBLIC, 'logo-white.png'))
favicon(os.path.join(PUBLIC, 'favicon.png'))
print('ok')
