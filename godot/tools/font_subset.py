#!/usr/bin/env python3
"""把中文字型精簡成只留遊戲用到的字（完整的字型有上萬個字、12 MB，遊戲只用幾百個）。
會掃描 scripts/ 裡所有程式的文字。**程式裡新增了畫面上會顯示的中文字之後要重跑**，否則新字會顯示成方框。
完整的字型放在 tools/fonts/NotoSansTC-full.ttf（不會被匯出）。用法：python3 tools/font_subset.py   （需要 fonttools）"""
import glob, subprocess, os
chars = set(chr(c) for c in range(0x20, 0x7f))
chars |= set('，。、：；！？「」（）《》・…—－＋−～％　●○→←↑↓×')
for f in glob.glob('scripts/*.gd'):
    chars |= set(c for c in open(f, encoding='utf-8').read() if ord(c) > 0x7f)
open('/tmp/_chars.txt', 'w', encoding='utf-8').write(''.join(sorted(chars)))
subprocess.run(['pyftsubset', 'tools/fonts/NotoSansTC-full.ttf', '--text-file=/tmp/_chars.txt', '--output-file=assets/fonts/NotoSansTC.ttf', '--layout-features=*', '--no-hinting'], check=True)
print('保留 %d 個字，%d KB → %d KB' % (len(chars), os.path.getsize('tools/fonts/NotoSansTC-full.ttf') // 1024, os.path.getsize('assets/fonts/NotoSansTC.ttf') // 1024))
