#!/usr/bin/env python3
"""把 Godot 網頁匯出的大檔壓縮（gzip）後轉成文字（base64）分塊，並在 index.html 裡加上載入時還原的程式。
試玩連結只接受網頁常見的檔案類型，而且單檔有大小上限，所以要這樣處理。
用法：python3 tools/web_split.py export 輸出資料夾"""
import os, sys, json, shutil, gzip, base64
src, out = sys.argv[1], sys.argv[2]
RAW = 9 * 1024 * 1024   # 每塊 9MB 原始資料 → 12MB 文字
os.makedirs(out, exist_ok=True)
parts = {}
for f in sorted(os.listdir(src)):
    p = os.path.join(src, f)
    if os.path.getsize(p) > 4 * 1024 * 1024:
        data = gzip.compress(open(p, 'rb').read(), 9); n = 0
        for i in range(0, len(data), RAW):
            open(os.path.join(out, f'{f}.{n}.txt'), 'wb').write(base64.b64encode(data[i:i + RAW])); n += 1
        parts[f] = n
    elif f != 'index.html':
        shutil.copy(p, os.path.join(out, f))
html = open(os.path.join(src, 'index.html'), encoding='utf-8').read()
patch = '''<script>
// 大檔分塊載入：把切開的小塊抓回來拼成原本的檔案，再交給引擎
(function () {
  var PARTS = %s, _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    var name = String(url && url.url ? url.url : url).split('/').pop().split('?')[0];
    if (!PARTS[name]) return _fetch(url, opts);
    var jobs = [];
    for (var i = 0; i < PARTS[name]; i++) jobs.push(_fetch(name + '.' + i + '.txt').then(function (r) { if (!r.ok) throw new Error('載入失敗 ' + r.status); return r.text(); }));
    return Promise.all(jobs).then(function (texts) {
      // 文字 → 位元組 → 解壓縮
      var bufs = texts.map(function (t) { var s = atob(t), u = new Uint8Array(s.length); for (var k = 0; k < s.length; k++) u[k] = s.charCodeAt(k); return u; });
      var stream = new Blob(bufs).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer();
    }).then(function (all) {
      return new Response(all, { status: 200, headers: { 'Content-Type': /\\.wasm$/.test(name) ? 'application/wasm' : 'application/octet-stream', 'Content-Length': String(all.byteLength) } });
    });
  };
})();
</script>
''' % json.dumps(parts)
html = html.replace('<script src="index.js"></script>', patch + '<script src="index.js"></script>')
assert patch in html, '找不到 index.js 的載入位置'
html = html.replace('<title>RL Fight</title>', '<title>RL Fight Godot</title>')
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(html)
print('分塊', parts, '輸出檔案', sorted(os.listdir(out)))
