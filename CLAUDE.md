# 專案規則

- **所有回覆、說明、進度回報、總結一律使用繁體中文**，不可夾雜英文段落，**連專有名詞也盡量翻成中文**（例如：commit→提交、push→上傳到雲端倉庫、IK→腳步固定、動作名稱用中文）。只有程式碼、檔名、指令、或使用者必須拿去搜尋的關鍵字可以保留英文，並附上中文說明。內部思考可以用英文，但**所有顯示給使用者的文字**（回覆、工具呼叫之間的進度說明、總結）都必須是繁體中文。
- 所有工作都在雲端環境與這個 git 倉庫中進行，除非使用者明確要求，否則不要在使用者的本機電腦上操作。
- 遊戲內文字、程式註解、commit 訊息也使用繁體中文。
- 這是一款原創的 Roguelike 拳擊遊戲，玩法方向參考 Endless Puncher，但不得複製其角色、美術、名稱或關卡。
- 試玩版：用 `python3 tools/build_demo.py <輸出路徑>` 打包成單一 HTML，再發佈到同一個 Artifact 連結更新。
- 畫面為 3D（Three.js r128）：`js/render3d.js` 只負責繪圖，遊戲邏輯都在 `js/game.js`（以 x、y 平面運算）。本機用 `vendor/three.min.js`，試玩版從 cdnjs 載入。
- 角色動畫為 CMU 動作捕捉（`js/mocap.js`，由 `tools/mocap/extract.py` 產生）；角色骨架與身體零件在 `render3d.js` 的 `createRig`。需保留資料來源標示。
- **測試一律用大批敵人**：`node tools/test/crowd_test.js 150`（手機直式加參數 `m`），會開無敵並一次生出大量敵人，檢查錯誤、繪製次數、飛踢與截圖。敵人與屍體用實例化批次繪製（`render3d.js` 的 `crowdAdd`），新增角色零件時要確認批次顏色正常。
- 主角模型 `assets/models/hero.glb`（Mixamo 骨架），在 `render3d.js` 的 `setupHero`／`retargetHero` 每格從隱藏的動作捕捉骨架重定向；換模型後要跑 `python3 tools/embed_models.py` 重新產生 `js/models.js`。
- **修改流程**：改完先更新試玩版（Artifact 預覽連結）給使用者確認，**未經使用者同意不可 commit 或 push**。使用者說可以後，才一起 commit + push。

## Godot 4 版（`godot/` 資料夾，重做中）

- 引擎 Godot 4.6，繪圖用「相容模式」（Compatibility）。雲端環境的引擎裝在 `/opt/godot`（指令 `godot`），環境重建後要重新下載引擎與網頁匯出範本。
- 遊戲邏輯在 `godot/scripts/game.gd`，場景用程式建立；單位是公尺（舊版 1 單位 ≈ 0.0234 公尺）。
- 主角模型與 Mixamo 動作檔用 `godot/assets/mixamo_bonemap.tres` 做骨架重定向（設定寫在各檔的 `.import`）。
- 截圖測試：`cd godot && xvfb-run -a -s "-screen 0 720x1280x24" godot --path . --rendering-driver opengl3 -- --spawn=40 --god --shots=3,6`（加 `--close` 是主角近照），圖存在 `~/.local/share/godot/app_userdata/RL Fight/`。
- 網頁試玩：`godot --headless --path . --export-release "Web" export/index.html`，再 `python3 tools/web_split.py export <輸出資料夾>`（壓縮後轉文字分塊，符合試玩連結的檔案限制），發佈到 Godot 版的 Artifact 連結 https://claude.ai/artifact/HSd8jDZ5prLkYNy66hhrcL 。舊網頁版的連結維持不動。
- **目前階段：先單獨把主角動作調順，不跑遊戲**。主場景是動作檢視器 `godot/viewer.tscn`（`scripts/viewer.gd`），主角與動作庫在 `scripts/hero_rig.gd`；遊戲本體 `main.tscn`／`scripts/game.gd` 暫時不用。每次預覽都要讓角色看得清楚，其他東西先不運算。
- 主角模型的靜止姿勢是 A 字站姿、動作檔是 T 字站姿，匯入設定必須開「修正輪廓」（`.import` 裡的 `retarget/rest_fixer/fix_silhouette/enable`），否則手臂會全部偏低。
- 動作檢查：檢視器加 `-- --sheet` 會把每個招式的命中格拍成正面、側面，再用 `python3 tools/sheet_grid.py 輸出.png` 排成一張；`godot --headless --path . -s tools/impact.gd` 量每招的命中格與伸展。
