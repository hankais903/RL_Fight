# 專案規則

- **所有回覆、說明、進度回報、總結一律使用繁體中文**，不可夾雜英文段落（程式碼、檔名、指令除外）。
- 所有工作都在雲端環境與這個 git 倉庫中進行，除非使用者明確要求，否則不要在使用者的本機電腦上操作。
- 遊戲內文字、程式註解、commit 訊息也使用繁體中文。
- 這是一款原創的 Roguelike 拳擊遊戲，玩法方向參考 Endless Puncher，但不得複製其角色、美術、名稱或關卡。
- 試玩版：用 `python3 tools/build_demo.py <輸出路徑>` 打包成單一 HTML，再發佈到同一個 Artifact 連結更新。
- 畫面為 3D（Three.js r128）：`js/render3d.js` 只負責繪圖，遊戲邏輯都在 `js/game.js`（以 x、y 平面運算）。本機用 `vendor/three.min.js`，試玩版從 cdnjs 載入。
- 角色動畫為 CMU 動作捕捉（`js/mocap.js`，由 `tools/mocap/extract.py` 產生）；角色骨架與身體零件在 `render3d.js` 的 `createRig`。需保留資料來源標示。
- **測試一律用大批敵人**：`node tools/test/crowd_test.js 150`（手機直式加參數 `m`），會開無敵並一次生出大量敵人，檢查錯誤、繪製次數、飛踢與截圖。敵人與屍體用實例化批次繪製（`render3d.js` 的 `crowdAdd`），新增角色零件時要確認批次顏色正常。
- 主角模型 `assets/models/hero.glb`（Mixamo 骨架），在 `render3d.js` 的 `setupHero`／`retargetHero` 每格從隱藏的動作捕捉骨架重定向；換模型後要跑 `python3 tools/embed_models.py` 重新產生 `js/models.js`。
