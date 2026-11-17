"""把遊戲打包成單一 HTML 檔（試玩版用）。用法：python3 tools/build_demo.py [輸出路徑]"""
import sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist' / 'rl-fight-demo.html'
css = (root / 'css/style.css').read_text(encoding='utf-8')
data = (root / 'js/data.js').read_text(encoding='utf-8')
game = (root / 'js/game.js').read_text(encoding='utf-8')
html = f"""<title>RL Fight</title>
<style>
:root {{ color-scheme: dark; }}
{css}
@media (orientation: portrait) and (max-width: 700px) {{
  #rotateHint {{ display: block !important; }}
}}
#rotateHint {{ display: none; position: fixed; left: 0; right: 0; bottom: max(12px, env(safe-area-inset-bottom, 0px));
  text-align: center; color: #9a9ab0; font-size: 13px; pointer-events: none; }}
</style>
<div id="stage">
  <canvas id="game"></canvas>
  <button id="pauseBtn" class="hidden" aria-label="暫停">❚❚</button>
  <div id="overlay" class="hidden"></div>
</div>
<div id="rotateHint">📱 把手機轉成橫向，畫面會更大</div>
<script>
{data}
</script>
<script>
{game}
</script>
"""
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding='utf-8')
print('wrote', out)
