#!/usr/bin/env python3
"""把檢視器 --light 拍的九張圖排成一張（每列一個時段：近景、背面近景、遠景）。用法：python3 tools/light_grid.py 輸出.png"""
import os, sys
from PIL import Image
d = os.path.expanduser('~/.local/share/godot/app_userdata/RL Fight')
W, H = 300, 370
s = Image.new('RGB', (W * 3, H * 3))
for i in range(9):
    s.paste(Image.open(f'{d}/light_{i}.png').crop((0, 0, 720, 890)).resize((W, H)), ((i % 3) * W, (i // 3) * H))
s.save(sys.argv[1])
