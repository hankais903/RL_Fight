#!/usr/bin/env python3
"""重新產生主角的粗糙度貼圖。
模型原本的粗糙度／金屬度貼圖是自動產生的：粗糙度是跟材質無關的雜亂色塊，金屬度把白色滾邊標成金屬。
這裡依顏色貼圖把每個部位分類，給各材質合理的粗糙度，金屬度一律為零。
用法：先跑 godot --headless --path . -s tools/hero_mat.gd 匯出顏色貼圖，再 python3 tools/hero_pbr.py"""
import os, colorsys
import numpy as np
from PIL import Image, ImageFilter
d = os.path.expanduser('~/.local/share/godot/app_userdata/RL Fight')
rgb = np.asarray(Image.open(f'{d}/hero_albedo.png').convert('RGB')).astype(np.float32) / 255.0
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
mx, mn = rgb.max(-1), rgb.min(-1)
v = mx
s = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
# 色相（0～360）
dlt = np.maximum(mx - mn, 1e-5)
h = np.where(mx == r, ((g - b) / dlt) % 6, np.where(mx == g, (b - r) / dlt + 2, (r - g) / dlt + 4)) * 60.0
rough = np.full(v.shape, 0.72, np.float32)                         # 其他：一般布料
dark = v < 0.36
red = ((h < 14) | (h > 344)) & (s > 0.5) & ~dark
skin = (h >= 14) & (h < 44) & (s > 0.18) & (s < 0.7) & (v > 0.55)
white = (s < 0.16) & (v > 0.68)
rough[dark] = 0.86      # 深色褲子、頭髮、護腕：霧面布料
rough[red] = 0.68       # 紅色背心、腰帶、鞋面：稍有光澤的布
rough[skin] = 0.5       # 皮膚：帶一點油亮
rough[white] = 0.58     # 白色滾邊、鞋底
names = {'深色（褲子、頭髮、護腕）': dark, '紅色（背心、腰帶、鞋）': red, '皮膚': skin, '白色（滾邊、鞋底）': white}
for k, m in names.items(): print(f'{k} 佔 {m.mean() * 100:.0f}%')
img = Image.fromarray((rough * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))
# 存成「遮蔽／粗糙／金屬」三合一：紅=遮蔽（全白）、綠=粗糙度、藍=金屬度（全黑）
out = Image.merge('RGB', (Image.new('L', img.size, 255), img, Image.new('L', img.size, 0)))
out.save('assets/hero/hero_orm.png')
print('已存 assets/hero/hero_orm.png', out.size)
