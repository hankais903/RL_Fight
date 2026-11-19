#!/usr/bin/env python3
"""產生廟口廣場用的貼圖（顏色、凹凸、粗糙度）：
  paving  石板鋪面（可重複）　plaza  中央的石雕圓盤（不重複，圓外透明）　rooftile  琉璃瓦（可重複）
用法：python3 tools/plaza_textures.py"""
import numpy as np
from PIL import Image
rng = np.random.default_rng(11)
OUT = 'assets/textures/'

def noise(n, scale, octaves=4):
    """可無縫重複的雜訊：白雜訊在頻率域做低通，天生就是週期性的"""
    out = np.zeros((n, n)); amp = 1.0; tot = 0.0
    fy = np.fft.fftfreq(n)[:, None]; fx = np.fft.fftfreq(n)[None, :]
    for o in range(octaves):
        f0 = scale * (2 ** o) / n
        filt = np.exp(-(fx ** 2 + fy ** 2) / (2 * f0 ** 2))
        a = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * filt))
        a = (a - a.mean()) / (a.std() + 1e-9)
        out += a * amp; tot += amp; amp *= 0.5
    out /= tot
    return np.clip(out * 0.25 + 0.5, 0, 1)

def normal_from_height(h, strength, wrap=True):
    if wrap:
        dx = np.roll(h, -1, 1) - np.roll(h, 1, 1); dy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    else:
        dy, dx = np.gradient(h); dx *= 2; dy *= 2
    nx = -dx * strength; ny = -dy * strength; nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([(nx / l * 0.5 + 0.5), (-ny / l * 0.5 + 0.5), nz / l * 0.5 + 0.5], -1)

def save(name, color, height, rough, strength, wrap=True, alpha=None):
    c = (np.clip(color, 0, 1) * 255).astype(np.uint8)
    if alpha is not None:
        Image.fromarray(np.dstack([c, (np.clip(alpha, 0, 1) * 255).astype(np.uint8)]), 'RGBA').save(OUT + name + '_color.png')
    else:
        Image.fromarray(c).save(OUT + name + '_color.jpg', quality=90)
    Image.fromarray((normal_from_height(height, strength, wrap) * 255).astype(np.uint8)).save(OUT + name + '_normal.jpg', quality=92)
    Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8)).save(OUT + name + '_rough.jpg', quality=90)
    print('已存', name, c.shape)

# ---------- 石板鋪面 ----------
def paving(n=1024, rows=8, cols=4):
    y, x = np.mgrid[0:n, 0:n] / n
    ry = y * rows; row = np.floor(ry).astype(int)
    cx = x * cols + (row % 2) * 0.5; col = np.floor(cx).astype(int) % cols
    fy = ry - row; fx = cx - np.floor(cx)
    edge = np.minimum(np.minimum(fx, 1 - fx) * (n / cols), np.minimum(fy, 1 - fy) * (n / rows))   # 離石板邊緣幾個像素
    grout = np.clip(1 - edge / 3.0, 0, 1)
    bevel = np.clip(edge / 9.0, 0, 1)
    tone = rng.uniform(0.82, 1.08, (rows, cols))[row, col]
    hue = rng.uniform(-0.03, 0.03, (rows, cols))[row, col]
    big = noise(n, 3); fine = noise(n, 40, 3); stain = noise(n, 6)
    v = (0.46 + (big - 0.5) * 0.16 + (fine - 0.5) * 0.14) * tone
    v *= 1 - np.clip((stain - 0.6) * 2.2, 0, 1) * 0.3                       # 深色水漬
    col_rgb = np.stack([v * (1.04 + hue), v * 1.0, v * (0.94 - hue)], -1)
    col_rgb = col_rgb * (1 - grout[..., None] * 0.62)
    height = bevel * 0.7 + fine * 0.3 - grout * 0.6
    rough = 0.78 + (fine - 0.5) * 0.25 - np.clip((stain - 0.6) * 2.2, 0, 1) * 0.35 + grout * 0.12
    save('paving', col_rgb, height, rough, 4.0)

# ---------- 中央的石雕圓盤 ----------
def plaza(n=2048):
    y, x = (np.mgrid[0:n, 0:n] + 0.5) / n * 2 - 1
    r = np.sqrt(x * x + y * y); a = np.arctan2(y, x)
    big = noise(n, 4); fine = noise(n, 70, 3); stain = noise(n, 9)
    v = np.full((n, n), 0.5); groove = np.zeros((n, n)); tint = np.zeros((n, n))
    # 一圈圈的扇形石板：每圈的石板數不同、交錯排列，深淺相間
    rings = [(0.30, 0.44, 16), (0.44, 0.58, 24), (0.58, 0.72, 32), (0.72, 0.86, 40)]
    for i, (r0, r1, cnt) in enumerate(rings):
        m = (r >= r0) & (r < r1)
        seg = (a / (2 * np.pi) + 0.5) * cnt + (i % 2) * 0.5
        k = np.floor(seg).astype(int) % cnt
        tone = rng.uniform(0.86, 1.08, cnt)[k]
        v = np.where(m, 0.5 * tone, v)
        fs = seg - np.floor(seg)
        d_ang = np.minimum(fs, 1 - fs) / cnt * 2 * np.pi * r * (n / 2)
        d_rad = np.minimum(r - r0, r1 - r) * (n / 2)
        groove = np.where(m, np.clip(1 - np.minimum(d_ang, d_rad) / 3.5, 0, 1), groove)
    # 深色的分隔環與外框
    for rr, w, dark in [(0.30, 0.012, 0.55), (0.58, 0.008, 0.4), (0.86, 0.02, 0.6), (0.955, 0.03, 0.7)]:
        band = np.clip(1 - np.abs(r - rr) / w, 0, 1)
        v = v * (1 - band * dark); tint += band * 0.5
    outer = (r >= 0.86)
    v = np.where(outer & (r < 0.97), v * 0.9, v)
    # 中心圖案：八瓣的幾何花紋，外加一圈小圓點
    petal = np.cos(a * 4) ** 2
    star = (r < 0.27) & (r < 0.09 + 0.17 * petal ** 0.7)
    core = r < 0.075
    v = np.where(r < 0.30, 0.42, v)
    v = np.where(star, 0.66, v); v = np.where(core, 0.34, v)
    tint = np.where(star, 0.9, tint); tint = np.where(core, 0.0, tint)
    edge_star = np.clip(1 - np.abs(r - (0.09 + 0.17 * petal ** 0.7)) * (n / 2) / 4.0, 0, 1) * (r < 0.28)
    groove = np.maximum(groove, edge_star)
    dots = (np.abs(r - 0.283) < 0.008) & (np.cos(a * 24) > 0.8)
    v = np.where(dots, 0.7, v)
    # 石頭質感、髒污、磨損（中央被踩得比較亮滑）
    v = v * (0.86 + (big - 0.5) * 0.3 + (fine - 0.5) * 0.22)
    wear = np.clip(1 - r / 0.75, 0, 1)
    v = v * (1 + wear * 0.12) * (1 - np.clip((stain - 0.62) * 2.5, 0, 1) * 0.28)
    warm = np.stack([1.06, 1.0, 0.9]); red = np.stack([1.25, 0.72, 0.5])
    col = v[..., None] * (warm[None, None, :] * (1 - tint[..., None] * 0.5) + red[None, None, :] * tint[..., None] * 0.5)
    col = col * (1 - groove[..., None] * 0.6)
    height = (1 - groove) * 0.6 + fine * 0.35 + np.where(star, 0.12, 0.0)
    rough = 0.72 + (fine - 0.5) * 0.25 - wear * 0.22 + groove * 0.15 - np.clip((stain - 0.62) * 2.5, 0, 1) * 0.3
    alpha = np.clip((0.985 - r) * (n / 2) / 3.0, 0, 1)
    save('plaza', col, height, rough, 3.5, wrap=False)   # 圓形由圓盤網格來切，貼圖不需要透明（無損的透明圖檔太大）

# ---------- 琉璃瓦 ----------
def rooftile(n=512, cols=8, rows=6):
    y, x = np.mgrid[0:n, 0:n] / n
    cx = x * cols; fx = cx - np.floor(cx)
    ry = y * rows; fy = ry - np.floor(ry)
    ridge = np.sin(fx * np.pi) ** 0.8                              # 一條條隆起的筒瓦
    lap = fy ** 2                                                  # 每片瓦往下疊，尾端翹起
    tone = rng.uniform(0.85, 1.1, (rows, cols))[np.floor(ry).astype(int), np.floor(cx).astype(int)]
    fine = noise(n, 30, 3)
    v = (0.55 + ridge * 0.35 - (1 - fy) * 0.12) * tone * (0.9 + (fine - 0.5) * 0.3)
    col = np.stack([v * 1.0, v * 0.52, v * 0.16], -1)             # 橘黃色琉璃
    col *= (1 - np.clip(1 - fy * 14, 0, 1)[..., None] * 0.5)       # 瓦片交疊處的陰影
    height = ridge * 0.8 + lap * 0.35
    rough = 0.32 + (fine - 0.5) * 0.2 + (1 - ridge) * 0.25
    save('rooftile', col, height, rough, 5.0)

paving(); plaza(); rooftile()
