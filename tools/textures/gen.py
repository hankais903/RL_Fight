"""
程式產生的 PBR 貼圖（原創，無授權問題）：顏色、法線、粗糙度（部分有發光）。
用法：python3 tools/textures/gen.py   → 輸出到 assets/textures/*.jpg
"""
import numpy as np, pathlib
from PIL import Image, ImageDraw, ImageFilter
OUT = pathlib.Path(__file__).resolve().parents[2] / 'assets' / 'textures'
rng = np.random.default_rng(7)

def up(a, n):  # 平滑放大（雙線性，可無縫）
    img = Image.fromarray((a * 255).astype(np.uint8))
    return np.asarray(img.resize((n, n), Image.BICUBIC)).astype(np.float32) / 255

def fbm(n, oct=6, base=4, pers=0.55):
    out = np.zeros((n, n), np.float32); amp = 1; tot = 0
    for o in range(oct):
        g = base * 2 ** o
        r = rng.random((g, g)).astype(np.float32)
        r = np.pad(r, 1, mode='wrap')            # 無縫
        img = Image.fromarray((r * 255).astype(np.uint8)).resize((n + 2 * n // g, n + 2 * n // g), Image.BICUBIC)
        a = np.asarray(img).astype(np.float32)[n // g:n // g + n, n // g:n // g + n] / 255
        out += a * amp; tot += amp; amp *= pers
    out /= tot
    return (out - out.min()) / (out.max() - out.min() + 1e-6)

def normal_from(h, strength=4.0):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    l = np.sqrt(gx * gx + gy * gy + nz * nz)
    n = np.stack([-gx / l, gy / l, nz / l], -1)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)

def save(name, color, height, rough, emissive=None, nstr=4.0, q=88):
    Image.fromarray(np.clip(color * 255, 0, 255).astype(np.uint8)).save(OUT / f'{name}_color.jpg', quality=q)
    Image.fromarray(normal_from(height, nstr)).save(OUT / f'{name}_normal.jpg', quality=q)
    Image.fromarray(np.clip(rough * 255, 0, 255).astype(np.uint8)).save(OUT / f'{name}_rough.jpg', quality=q)
    if emissive is not None:
        Image.fromarray(np.clip(emissive * 255, 0, 255).astype(np.uint8)).save(OUT / f'{name}_emit.jpg', quality=q)
    print('輸出', name)

def tint(gray, rgb):
    return gray[..., None] * np.array(rgb, np.float32)[None, None]

# ---------- 柏油路（含裂縫、油漬、水窪） ----------
def asphalt(n=1024):
    base = fbm(n, 7, 8, 0.6)
    grain = rng.random((n, n)).astype(np.float32)
    h = base * 0.5 + grain * 0.5
    c = 0.17 + 0.10 * base + 0.06 * (grain - 0.5)
    col = tint(c, (1.0, 0.98, 0.95))
    rough = 0.82 + 0.12 * grain
    # 裂縫：隨機折線
    crack = Image.new('L', (n, n), 0); d = ImageDraw.Draw(crack)
    for _ in range(14):
        x, y = rng.random() * n, rng.random() * n; a = rng.random() * 6.28
        pts = [(x, y)]
        for _ in range(int(rng.integers(6, 18))):
            a += rng.normal(0, 0.6); x += np.cos(a) * 25; y += np.sin(a) * 25; pts.append((x, y))
        d.line(pts, fill=255, width=int(rng.integers(2, 5)))
    crack = np.asarray(crack.filter(ImageFilter.GaussianBlur(1))).astype(np.float32) / 255
    h -= crack * 0.8; col *= (1 - crack[..., None] * 0.6)
    # 油漬、髒污
    stain = np.clip((fbm(n, 4, 3) - 0.62) * 4, 0, 1)
    col *= (1 - stain[..., None] * 0.45); rough -= stain * 0.35
    # 水窪：很光滑、顏色偏暗
    pud = np.clip((fbm(n, 4, 2, 0.5) - 0.7) * 6, 0, 1)
    col *= (1 - pud[..., None] * 0.35); rough = rough * (1 - pud) + 0.08 * pud; h = h * (1 - pud) + h.mean() * pud
    save('asphalt', col, h, rough, nstr=3.0)

# ---------- 磚牆立面（含窗戶、發光窗、髒污、水漬） ----------
def facade(name, n=1024, brick=(0.42, 0.2, 0.14), bays=4, floors=4, plaster=False):
    h = np.zeros((n, n), np.float32); col = np.zeros((n, n, 3), np.float32); rough = np.full((n, n), 0.88, np.float32)
    emit = np.zeros((n, n, 3), np.float32)
    noise = fbm(n, 6, 8); grain = rng.random((n, n)).astype(np.float32)
    if plaster:
        c = 0.5 + 0.2 * noise + 0.05 * (grain - 0.5)
        col[:] = tint(c, brick); h = noise * 0.4 + grain * 0.1
    else:
        bw, bh = n // 16, n // 40
        yy, xx = np.mgrid[0:n, 0:n]
        row = yy // bh; off = (row % 2) * (bw // 2)
        bx = (xx + off) % bw; by = yy % bh
        mortar = ((bx < 3) | (by < 3)).astype(np.float32)
        bid = ((xx + off) // bw) * 131 + row * 7
        var = (np.sin(bid * 12.9898) * 43758.5453) % 1
        bc = tint(0.75 + 0.35 * var + 0.15 * noise, brick)
        mc = tint(0.45 + 0.1 * noise, (0.55, 0.53, 0.5))
        col[:] = bc * (1 - mortar[..., None]) + mc * mortar[..., None]
        h = (1 - mortar) * (0.6 + 0.2 * noise) + grain * 0.1
    # 窗戶
    cw, ch = n // bays, n // floors
    for f in range(floors):
        for b in range(bays):
            x0 = b * cw + cw // 4; x1 = (b + 1) * cw - cw // 4
            y0 = f * ch + ch // 4; y1 = (f + 1) * ch - ch // 5
            col[y0 - 6:y1 + 10, x0 - 6:x1 + 6] = tint(np.full((y1 - y0 + 16, x1 - x0 + 12), 0.55), (0.6, 0.58, 0.55))  # 窗框（水泥）
            h[y0 - 6:y1 + 10, x0 - 6:x1 + 6] = 0.9
            lit = rng.random() < 0.3
            glass = 0.05 + 0.05 * rng.random()
            col[y0:y1, x0:x1] = (0.06, 0.07, 0.08) if not lit else (0.35, 0.28, 0.15)
            h[y0:y1, x0:x1] = 0.2
            rough[y0:y1, x0:x1] = 0.15
            if lit:
                warm = np.array([1.0, 0.72, 0.35]) if rng.random() < 0.7 else np.array([0.55, 0.75, 1.0])
                emit[y0:y1, x0:x1] = warm * (0.55 + 0.4 * rng.random())
            # 窗格
            mx = (x0 + x1) // 2; my = (y0 + y1) // 2
            col[y0:y1, mx - 3:mx + 3] = 0.25; col[my - 3:my + 3, x0:x1] = 0.25
            emit[y0:y1, mx - 3:mx + 3] = 0; emit[my - 3:my + 3, x0:x1] = 0
            # 窗下水漬
            drip = np.clip(fbm(64, 3, 4)[:, :1], 0, 1)
            col[y1 + 10:min(n, y1 + 10 + ch // 3), x0:x1] *= 0.75
    # 整體髒污、由下往上的黑垢
    dirt = np.clip((fbm(n, 5, 3) - 0.5) * 2.5, 0, 1)
    grad = np.linspace(0, 1, n)[:, None] ** 3
    col *= (1 - 0.45 * dirt[..., None]) * (1 - 0.3 * grad[..., None])
    rough = np.clip(rough + 0.05 * dirt, 0, 1)
    save(name, col, h, rough, emissive=emit, nstr=5.0)

# ---------- 鐵捲門（生鏽波浪鐵皮） ----------
def shutter(n=512):
    yy = np.mgrid[0:n, 0:n][0].astype(np.float32)
    wave = (np.sin(yy / n * np.pi * 2 * 28) * 0.5 + 0.5)
    noise = fbm(n, 6, 6); rust = np.clip((fbm(n, 5, 4) - 0.45) * 3, 0, 1)
    metal = tint(0.45 + 0.15 * wave + 0.1 * noise, (0.6, 0.62, 0.64))
    rustc = tint(0.5 + 0.3 * noise, (0.45, 0.22, 0.1))
    col = metal * (1 - rust[..., None]) + rustc * rust[..., None]
    # 塗鴉色塊
    g = Image.new('RGB', (n, n)); d = ImageDraw.Draw(g)
    for _ in range(5):
        cc = tuple(int(v) for v in rng.choice([(200, 40, 60), (40, 160, 200), (230, 200, 40), (120, 220, 90)]))
        x, y = rng.random() * n, rng.random() * n
        d.line([(x, y), (x + rng.normal(0, 120), y + rng.normal(0, 60)), (x + rng.normal(0, 160), y + rng.normal(0, 80))], fill=cc, width=int(rng.integers(10, 24)))
    gr = np.asarray(g.filter(ImageFilter.GaussianBlur(2))).astype(np.float32) / 255
    gm = (gr.sum(-1) > 0.05)[..., None] * (rng.random() < 2)
    col = col * (1 - gm * 0.85) + gr * gm * 0.85
    h = wave * 0.7 + noise * 0.2 - rust * 0.1
    rough = 0.45 + 0.4 * rust + 0.1 * noise
    save('shutter', col, h, rough, nstr=4.0)

# ---------- 水泥（人行道、牆腳、垃圾箱以外的雜物） ----------
def concrete(n=512):
    noise = fbm(n, 7, 6); grain = rng.random((n, n)).astype(np.float32)
    c = 0.42 + 0.15 * noise + 0.05 * (grain - 0.5)
    stain = np.clip((fbm(n, 4, 3) - 0.55) * 3, 0, 1)
    col = tint(c, (0.62, 0.61, 0.58)) * (1 - stain[..., None] * 0.4)
    # 方塊地磚接縫
    yy, xx = np.mgrid[0:n, 0:n]
    seam = (((xx % (n // 4)) < 4) | ((yy % (n // 4)) < 4)).astype(np.float32)
    col *= (1 - seam[..., None] * 0.4)
    h = noise * 0.4 + grain * 0.15 - seam * 0.6
    rough = 0.85 + 0.1 * grain - stain * 0.2
    save('concrete', col, h, rough, nstr=3.0)

# ---------- 生鏽塗漆金屬（垃圾箱、油桶） ----------
def paintmetal(n=512):
    noise = fbm(n, 6, 6); rust = np.clip((fbm(n, 6, 5) - 0.5) * 3, 0, 1)
    scratch = np.clip((fbm(n, 3, 32) - 0.75) * 5, 0, 1)
    paint = tint(0.55 + 0.1 * noise, (0.22, 0.4, 0.28))
    rustc = tint(0.45 + 0.3 * noise, (0.42, 0.2, 0.09))
    col = paint * (1 - rust[..., None]) + rustc * rust[..., None]
    col = col * (1 - scratch[..., None] * 0.4) + scratch[..., None] * 0.25
    h = noise * 0.3 - rust * 0.2
    rough = 0.55 + 0.35 * rust
    save('paintmetal', col, h, rough, nstr=3.0)

# ---------- 木頭（木箱） ----------
def wood(n=512):
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    noise = fbm(n, 5, 4)
    ring = np.sin((xx / n * 40 + noise * 6)) * 0.5 + 0.5
    plank = ((yy % (n // 5)) < 5).astype(np.float32)
    col = tint(0.35 + 0.25 * ring, (0.55, 0.38, 0.22)) * (1 - plank[..., None] * 0.6)
    h = ring * 0.3 - plank * 0.8
    rough = 0.8 + 0.1 * noise
    save('wood', col, h, rough, nstr=3.0)


# ---------- 打鬥區的大地板（不重複）：1600×1600 世界單位，畫進各種路面細節 ----------
def ground_big(n=2048, world=1600):
    px = n / world
    base = fbm(n, 8, 6, 0.6); grain = rng.random((n, n)).astype(np.float32)
    macro = fbm(n, 4, 2, 0.5)                       # 大範圍明暗變化，打破均勻感
    h = base * 0.4 + grain * 0.35
    c = 0.14 + 0.08 * base + 0.05 * macro + 0.05 * (grain - 0.5)
    col = tint(c, (1.0, 0.98, 0.95))
    rough = 0.8 + 0.12 * grain
    img = Image.new('L', (n, n), 0)
    W = lambda v: v * px
    yy, xx = np.mgrid[0:n, 0:n]
    # 修補過的柏油：顏色較深、比較平滑的方塊
    patch = Image.new('L', (n, n), 0); dp = ImageDraw.Draw(patch)
    for _ in range(22):
        x, y = rng.random() * n, rng.random() * n; w, hh = W(rng.uniform(40, 160)), W(rng.uniform(30, 120))
        dp.polygon([(x, y), (x + w, y + rng.normal(0, 5)), (x + w + rng.normal(0, 8), y + hh), (x, y + hh + rng.normal(0, 6))], fill=int(rng.uniform(120, 255)))
    pm = np.asarray(patch.filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32) / 255
    tone = rng.uniform(0.6, 0.85)
    col = col * (1 - pm[..., None]) + col * tone * pm[..., None]; rough -= pm * 0.12; h = h * (1 - pm * 0.5)
    # 裂縫（修補邊緣也裂）
    crack = Image.new('L', (n, n), 0); d = ImageDraw.Draw(crack)
    for _ in range(70):
        x, y = rng.random() * n, rng.random() * n; a = rng.random() * 6.28
        pts = [(x, y)]
        for _ in range(int(rng.integers(5, 25))):
            a += rng.normal(0, 0.55); x += np.cos(a) * W(9); y += np.sin(a) * W(9); pts.append((x, y))
        d.line(pts, fill=255, width=int(rng.integers(1, 4)))
        if rng.random() < 0.4:   # 分岔
            bx, by = pts[len(pts) // 2]; b = a + rng.choice([-1, 1]) * 1.2; q = [(bx, by)]
            for _ in range(6): b += rng.normal(0, 0.5); bx += np.cos(b) * W(7); by += np.sin(b) * W(7); q.append((bx, by))
            d.line(q, fill=200, width=1)
    cm = np.asarray(crack.filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255
    h -= cm * 0.9; col *= (1 - cm[..., None] * 0.65); rough += cm * 0.08
    # 褪色的油漆：斑馬線、停止線、箭頭（被磨損）
    paint = Image.new('L', (n, n), 0); d = ImageDraw.Draw(paint)
    cx = n * 0.5
    for i in range(9):   # 斑馬線（在畫面下方，打鬥區外）
        x0 = cx - W(260) + i * W(60); y0 = n * 0.5 + W(430)
        d.rectangle([x0, y0, x0 + W(32), y0 + W(120)], fill=255)
    d.rectangle([cx - W(500), n * 0.5 - W(440), cx + W(500), n * 0.5 - W(432)], fill=255)  # 停止線
    for k in range(4):   # 停車格
        x0 = cx + W(380) + k * W(70)
        d.line([(x0, n * 0.5 + W(150)), (x0, n * 0.5 + W(330))], fill=255, width=int(W(5)))
    wear = np.clip(fbm(n, 6, 10) * 1.6 - 0.35, 0, 1) * (grain > 0.25)
    pa = np.asarray(paint).astype(np.float32) / 255 * wear
    col = col * (1 - pa[..., None] * 0.75) + np.array([0.68, 0.66, 0.6]) * pa[..., None] * 0.75; rough -= pa * 0.1; h += pa * 0.08
    # 人孔蓋、排水溝蓋（金屬、凹凸花紋）
    for (mx, my, kind) in [(-180, 120, 'man'), (260, -150, 'man'), (-420, -380, 'man'), (380, 420, 'grate'), (-520, 300, 'grate'), (120, 520, 'grate'), (560, -460, 'man')]:
        X, Y = n / 2 + W(mx), n / 2 + W(my)
        if kind == 'man':
            r = W(26); m = ((xx - X) ** 2 + (yy - Y) ** 2) < r * r
            ring = m & (((xx - X) ** 2 + (yy - Y) ** 2) > (r - W(3)) ** 2)
            pat = (np.sin((xx - X) / W(3)) * np.sin((yy - Y) / W(3)) > 0.3) & m
            col[m] = col[m] * 0.3 + np.array([0.2, 0.19, 0.18]) * 0.7
            col[pat] *= 0.75; h[m] = 0.55; h[pat] = 0.65; h[ring] = 0.3
            rough[m] = 0.45; rough[pat] = 0.35
        else:
            m = (np.abs(xx - X) < W(40)) & (np.abs(yy - Y) < W(16))
            bars = m & ((((xx - X) / W(5)).astype(int) % 2) == 0)
            col[m] = np.array([0.05, 0.05, 0.05]); col[bars] = np.array([0.22, 0.2, 0.18])
            h[m] = 0.1; h[bars] = 0.6; rough[bars] = 0.4
    # 輪胎痕
    tire = Image.new('L', (n, n), 0); d = ImageDraw.Draw(tire)
    for _ in range(6):
        x, y = rng.random() * n, rng.random() * n; a = rng.random() * 6.28; pts = [(x, y)]
        for _ in range(30): a += rng.normal(0, 0.05); x += np.cos(a) * W(12); y += np.sin(a) * W(12); pts.append((x, y))
        for off in (-W(8), W(8)):
            d.line([(p[0] + off * np.sin(a), p[1] - off * np.cos(a)) for p in pts], fill=110, width=int(W(5)))
    tm = np.asarray(tire.filter(ImageFilter.GaussianBlur(2))).astype(np.float32) / 255
    col *= (1 - tm[..., None] * 0.35)
    # 油漬、髒污、落葉／垃圾小點
    stain = np.clip((fbm(n, 5, 5) - 0.6) * 4, 0, 1)
    col *= (1 - stain[..., None] * 0.45); rough -= stain * 0.3
    debris = (rng.random((n, n)) > 0.9985).astype(np.float32)
    debris = np.asarray(Image.fromarray((debris * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1))).astype(np.float32) / 255
    leaf = np.array([0.32, 0.22, 0.1]); col = col * (1 - debris[..., None] * 0.8) + leaf * debris[..., None] * 0.8; h += debris * 0.2
    # 水窪：不規則、靠近低窪處（大尺度雜訊低點）
    pud = np.clip((fbm(n, 5, 3, 0.55) * 0.7 + (1 - macro) * 0.3 - 0.66) * 7, 0, 1)
    col *= (1 - pud[..., None] * 0.45); rough = rough * (1 - pud) + 0.04 * pud; h = h * (1 - pud) + 0.35 * pud
    rough = np.clip(rough, 0.03, 1)
    # 顏色存 2048、法線與粗糙度存 1024（檔案小，看起來差不多）
    Image.fromarray(np.clip(col * 255, 0, 255).astype(np.uint8)).save(OUT / 'groundbig_color.jpg', quality=82)
    Image.fromarray(normal_from(h, 3.5)).resize((1024, 1024), Image.BILINEAR).save(OUT / 'groundbig_normal.jpg', quality=85)
    Image.fromarray(np.clip(rough * 255, 0, 255).astype(np.uint8)).resize((1024, 1024), Image.BILINEAR).save(OUT / 'groundbig_rough.jpg', quality=85)
    print('輸出 groundbig')

if __name__ == '__main__':
    # 用法：python3 tools/textures/gen.py        → 全部重產
    #       python3 tools/textures/gen.py big    → 只產生打鬥區大地板
    import sys
    if 'big' not in sys.argv:
        asphalt()
        facade('brick', brick=(0.42, 0.2, 0.14))
        facade('plaster', brick=(0.62, 0.58, 0.5), plaster=True, bays=3, floors=4)
        facade('brick2', brick=(0.3, 0.25, 0.22), bays=5, floors=5)
        shutter(); concrete(); paintmetal(); wood()
    ground_big()
