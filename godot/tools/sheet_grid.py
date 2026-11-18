#!/usr/bin/env python3
"""把檢視器 --sheet 拍的圖排成一張（上排正面、下排側面）。用法：python3 tools/sheet_grid.py 輸出.png"""
import sys, os
from PIL import Image
d = os.path.expanduser('~/.local/share/godot/app_userdata/RL Fight')
W, H = 240, 400
s = Image.new('RGB', (W * 8, H * 2))
for i in range(8):
    for r, v in enumerate('fs'):
        im = Image.open(f'{d}/sheet_{i}_{v}.png').crop((60, 60, 660, 1060)).resize((W, H))
        s.paste(im, (i * W, r * H))
s.save(sys.argv[1])
