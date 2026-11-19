#!/usr/bin/env python3
"""把產生器下載的音效整理成遊戲用的檔案，放進 assets/sfx/。
  打擊音效、提示音：去掉夾帶的封面等附加資料、裁掉前後空白（一觸發就要響）、音量調整一致，存成單聲道 .wav
  環境音（amb_*）、音樂（bgm_*）：頭尾交疊做成無縫循環，存成 .ogg
用法：python3 tools/sfx_import.py <下載檔案的資料夾>     （需要 ffmpeg）"""
import os, sys, subprocess, wave
import numpy as np
src = sys.argv[1]
out = 'assets/sfx'
os.makedirs(out, exist_ok=True)
RATE = 44100

def decode(path, ch):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(ch), '-ar', str(RATE), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch).copy()

def encode_ogg(a, path, q):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ac', str(a.shape[1]), '-ar', str(RATE), '-i', '-', '-map_metadata', '-1', '-c:a', 'libvorbis', '-q:a', str(q), path], input=a.astype(np.float32).tobytes(), check=True)

for f in sorted(os.listdir(src)):
    name, ext = os.path.splitext(f)
    if ext.lower() not in ('.mp3', '.wav', '.ogg', '.flac', '.m4a'): continue
    loop = name.startswith('amb_') or name.startswith('bgm_')
    a = decode(os.path.join(src, f), 2 if loop else 1)
    if loop:
        # 無縫循環：把最後一段淡出、疊到開頭淡入的那一段上，循環點前後就是連續的
        n = int(RATE * (2.0 if name.startswith('bgm_') else 0.8))
        k = np.linspace(0, 1, n)[:, None]
        body = a[:-n].copy()
        body[:n] = body[:n] * np.sqrt(k) + a[-n:] * np.sqrt(1 - k)
        peak = np.abs(body).max() or 1.0
        body *= 0.85 / peak
        encode_ogg(body, f'{out}/{name}.ogg', 3 if name.startswith('bgm_') else 2)
        print(f'{name}.ogg　循環 {len(body) / RATE:.1f} 秒　{os.path.getsize(f"{out}/{name}.ogg") // 1024} KB')
    else:
        m = np.abs(a[:, 0])
        peak = m.max() or 1.0
        # 起點：找「真正的聲音」——第一次超過峰值 25% 的地方，再往前退到音量低於 3% 為止（最多退 60 毫秒），
        # 這樣開頭零星的小雜音和它後面的靜音會一起被裁掉。之前用「第一次超過 4%」會被雜音騙到
        on = int(np.argmax(m > peak * 0.25))
        start = on
        lim = max(0, on - int(RATE * 0.06))
        win = int(RATE * 0.003)
        while start > lim and m[max(0, start - win):start].max() > peak * 0.03: start -= win
        start = max(0, start - int(RATE * 0.003))
        # 終點：最後一次超過峰值 2% 的地方，往後留 40 毫秒
        # 用 50 毫秒一格的平均音量來判斷，結尾零星的小雜音才不會被當成聲音
        w50 = int(RATE * 0.05)
        rms = np.sqrt(np.array([(m[i:i + w50] ** 2).mean() for i in range(0, len(m), w50)]))
        loud = np.nonzero(rms > rms.max() * 0.03)[0]
        last = min(len(m), (int(loud[-1]) + 1) * w50)
        end = min(len(m), last + int(RATE * 0.04))
        b = a[start:end, 0] * (0.92 / peak)
        # 尾端淡出。如果聲音到檔案結尾都還在響（被產生器的長度硬切斷），淡出要拉長，不然會戛然而止
        cut_off = end >= len(m) - int(RATE * 0.01)
        fo = min(len(b), int(RATE * (0.35 if cut_off else 0.03)))
        b[-fo:] *= np.linspace(1, 0, fo) ** (2 if cut_off else 1)
        on = start
        with wave.open(f'{out}/{name}.wav', 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
            w.writeframes((np.clip(b, -1, 1) * 32767).astype(np.int16).tobytes())
        print(f'{name}.wav　原本 {len(a) / RATE:.2f} 秒，前面空白 {on / RATE * 1000:.0f} 毫秒 → 裁成 {len(b) / RATE:.2f} 秒　{os.path.getsize(f"{out}/{name}.wav") // 1024} KB')
