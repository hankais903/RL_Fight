"""把遊戲打包成單一 HTML 檔（試玩版用）。用法：python3 tools/build_demo.py [輸出路徑]"""
import sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist' / 'rl-fight-demo.html'
css = (root / 'css/style.css').read_text(encoding='utf-8')
data = (root / 'js/data.js').read_text(encoding='utf-8')
game = (root / 'js/game.js').read_text(encoding='utf-8')
r3d = (root / 'js/render3d.js').read_text(encoding='utf-8')
mocap = (root / 'js/mocap.js').read_text(encoding='utf-8')
postfx = (root / 'vendor/three-postfx.js').read_text(encoding='utf-8') + '\n' + (root / 'vendor/GLTFLoader.js').read_text(encoding='utf-8')
import subprocess
subprocess.run(['python3', str(root / 'tools/embed_models.py')], check=True)
models = (root / 'js/models.js').read_text(encoding='utf-8')
html = f"""<title>RL Fight</title>
<style>
:root {{ color-scheme: dark; }}
{css}
</style>
<div id="stage">
  <canvas id="world"></canvas>
  <canvas id="game"></canvas>
  <button id="pauseBtn" class="hidden" aria-label="暫停">❚❚</button>
  <button id="ultBtn" class="hidden" aria-label="連擊爆發">爆發</button>
  <div id="overlay" class="hidden"></div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
{postfx}
</script>
<script>
{data}
</script>
<script>
{mocap}
</script>
<script>
{models}
</script>
<script>
{r3d}
</script>
<script>
{game}
</script>
"""
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding='utf-8')
print('wrote', out)
