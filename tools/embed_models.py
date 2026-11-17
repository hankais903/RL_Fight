"""把 assets/models/*.glb 轉成 js/models.js（base64 內嵌），讓本機直接開檔與單一 HTML 試玩版都能載入模型。
用法：python3 tools/embed_models.py
"""
import base64, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
items = []
for f in sorted((root / 'assets' / 'models').glob('*.glb')):
    items.append(f"  {f.stem}: '{base64.b64encode(f.read_bytes()).decode()}'")
    print('內嵌', f.name, f.stat().st_size // 1024, 'KB')
(root / 'js' / 'models.js').write_text('// 由 tools/embed_models.py 產生，請勿手動修改\nwindow.MODELS = {\n' + ',\n'.join(items) + '\n};\n')
