# 專案規則

- **所有回覆、說明、進度回報、總結一律使用繁體中文**，不可夾雜英文段落（程式碼、檔名、指令除外）。
- 所有工作都在雲端環境與這個 git 倉庫中進行，除非使用者明確要求，否則不要在使用者的本機電腦上操作。
- 遊戲內文字、程式註解、commit 訊息也使用繁體中文。
- 這是一款原創的 Roguelike 拳擊遊戲，玩法方向參考 Endless Puncher，但不得複製其角色、美術、名稱或關卡。
- 試玩版：用 `python3 tools/build_demo.py <輸出路徑>` 打包成單一 HTML，再發佈到同一個 Artifact 連結更新。
- 畫面為 3D（Three.js r128）：`js/render3d.js` 只負責繪圖，遊戲邏輯都在 `js/game.js`（以 x、y 平面運算）。本機用 `vendor/three.min.js`，試玩版從 cdnjs 載入。
