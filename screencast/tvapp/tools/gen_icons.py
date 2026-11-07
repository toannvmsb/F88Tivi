"""Sinh icon (192x192) và banner Android TV (320x180) bằng Python thuần, không cần thư viện ngoài."""
import struct, sys, zlib

def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(sum((px(x, y) for x in range(w)), ())) for y in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

BG, TV, ACC, WHITE = (15, 20, 32, 255), (79, 140, 255, 255), (46, 204, 143, 255), (255, 255, 255, 255)

def draw(w, h, scale):
    """Vẽ cảnh: khung TV viền xanh, tam giác play trắng ở giữa."""
    def px(x, y):
        u, v = x / w, y / h
        # nền dốc nhẹ
        base = (int(15 + 20 * v), int(20 + 25 * v), int(32 + 45 * v), 255)
        cx, cy = 0.5, 0.45
        hw, hh = 0.30 * scale, 0.22 * scale * (w / h)
        dx, dy = abs(u - cx), abs(v - cy)
        # viền TV
        t = 0.025 * scale
        if dx <= hw and dy * (h / w) * (w / h) <= hh and (dx > hw - t or dy > hh - t * (w / h)):
            return TV
        # chân đế
        if abs(u - cx) <= 0.10 * scale and 0.45 + hh < v <= 0.45 + hh + 0.035 * scale * (w / h):
            return TV
        # tam giác play
        px_, py_ = (u - cx) / (0.10 * scale), (v - cy) / (0.10 * scale * (w / h))
        if -0.6 <= px_ <= 0.8 and abs(py_) <= (0.8 - px_) * 0.75 * (1.0 if px_ > -0.6 else 0):
            return WHITE
        return base
    return px

png(sys.argv[1] + '/icon.png', 192, 192, draw(192, 192, 1.35))
png(sys.argv[1] + '/banner.png', 320, 180, draw(320, 180, 1.0))
print('ok')
