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
- 街景與光線在 `godot/scripts/street.gd`（`Street` 類別）：地面、人行道、建築、招牌、擺設，以及白天／黃昏／夜晚三套光線（`TOD` 設定表，`set_tod()` 切換）。不含遊戲邏輯，檢視器和遊戲共用。光線檢查：檢視器加 `-- --light` 會把三個時段各拍兩張近景和一張遠景。
- 打光編排（`street.gd` 的 `TOD`）：主光（太陽／月亮，有影子）＋ 只照角色的輪廓光與補光（光照圖層 `CHAR_LAYER`，角色要呼叫 `street.add_character()` 才吃得到）＋ 由下往上的地面反彈光 ＋ 夜間屋頂泛光燈 ＋ 霓虹燈 ＋ 接地暗影 ＋ 暗角。光的方向一律用「從哪個位置照向場地中央」表示（`key_from` 等）。
- 相容模式每個物體預設最多吃 8 盞燈，已在 `project.godot` 調到 24；新增燈光時注意別超過。屋頂的燈要放在屋頂外緣之外，否則會被自己那棟樓的女兒牆擋住。光線圖排版：`python3 tools/light_grid.py 輸出.png`。
- 主角材質：模型原本的粗糙度／金屬度貼圖是雜亂色塊且把白邊標成金屬，已改用 `godot/assets/hero/hero_orm.png`（由 `tools/hero_mat.gd` 匯出顏色貼圖後、`tools/hero_pbr.py` 依部位分類產生），在 `hero_rig.gd` 的 `_fix_materials()` 套用，金屬度歸零。換模型後要重跑這兩個工具。
- **角色不接收陰影貼圖**（材質 `disable_receive_shadows`，在 `street.add_character()` 設定）：低角度的光會讓陰影貼圖在角色身上畫出黑色條紋，手機上特別明顯。場景的主光只照場景（光照圖層 1）；角色改吃同方向的「角色版主光」`char_key`，亮度依 `lit_amount()`（從腳、腰、頭朝主光方向對建築包圍盒做射線檢查）調整，所以走進建築影子還是會變暗。目前 `char_key` 只有一盞，全體角色共用同一個亮度；之後加入敵人時要改成每隻各自計算（例如用實例顏色）。檢查工具：`godot --headless --path . -s tools/lit_check.gd`。
- 畫質分級在 `street.set_quality()`（高／中／低：反鋸齒、陰影解析度與段數、泛光燈投影、霓虹燈光、光暈、3D 解析度比例）。檢視器會量每秒畫面數（顯示在左上角），低於 40 就自動降一級；按「畫質」可手動切換並關掉自動。帶任何測試參數啟動時固定高畫質，`--quality=0/1/2` 可指定。這個雲端環境是軟體模擬繪圖（每秒約 8 格），量不到真實效能，以使用者手機上的數字為準。動作資料檢查：`godot --headless --path . -s tools/anim_check.gd`。
- 腰帶飄帶的骨架與物理在 `godot/scripts/sash.gd`（`SashSim`，繼承 `SkeletonModifier3D`，掛在骨架底下、動畫套用後才跑）。`SashSim.rig()` 在 `hero_rig.gd` 建立主角時呼叫：用貼圖紅色＋網格連通塊挑出飄帶頂點、分左右、各加四節骨頭並重寫權重與蒙皮綁定（會重建網格，所以要在換材質之前做）。物理是世界座標的位置式模擬：重力、阻尼、身體帶動比例、每節定長、大腿小腿膠囊碰撞、不陷進髖部前方、不穿地；參數是檔案開頭的常數。檢查：`godot --headless --path . -s tools/sash_check.gd`，以及檢視器 `-- --combo=new --shots=24` 的連續截圖。
- 身體修正在 `godot/scripts/body_fix.gd`（`BodyFix`，`SkeletonModifier3D`，排在飄帶物理之前）：頭抬高（脖子 4 度＋頭 6 度）與腳站回地面。**腳的原則：動作本身的腳跟起落、踮腳彈跳要完整保留，不可強制壓平**（試過「靠近地面就壓平釘死」，把待機的踮腳彈跳壓掉了，使用者不接受）。做法：(1) 整個人抬高鞋底厚度差 `hips_raise`（主角球鞋的腳踝離地比 Mixamo 原始骨架高，不抬的話鞋底陷進地面約 5 公分）；(2) 腳掌補固定的小角度差（Mixamo 腳掌往下 41 度、主角 37.5 度）；(3) 反向運動只當保險：鞋底低於地面才往上頂、前腳掌踩地時固定位置（`foot_lock`，角色本身在移動時要關掉）並修掉左右歪斜、腳趾踩地時壓平。基準一律取自蒙皮的綁定矩陣（模型原始綁定是鞋底貼平站著），不能用骨架靜止姿勢（「修正輪廓」把腳掌骨頭轉成水平了）。量測：`godot --headless --path . --fixed-fps 30 -s tools/foot_check.gd`（加 `-- --noik` 是原始動作對照），其中「腳跟起落範圍」修正前後要一致。
- 天空球是自訂天空著色器 `godot/shaders/sky.gdshader`（漸層、雲、星星、太陽光暈、地平線上的遠方城市剪影），各時段參數在 `street.gd` 的 `SKY_EXTRA`；場地外另有兩圈簡化的遠景大樓（`_build_backdrop()`）和 700 公尺的地面。檢視器的視角俯仰下限是 0，再低鏡頭會鑽到地面底下。
- 腳的修正必須有時間上的緩衝，否則會抖：踩地程度限速變化、左右歪斜與固定點拉力經過低通（`SMOOTH`）、不穿地是「立刻頂上、慢慢放掉」。**不要主動把腳往下拉去貼地**（試過，是抖動的主因，還會把小跳步吸在地上）。`tools/foot_check.gd` 會印「抖動量」（膝蓋、腳踝、腳趾關節位置的三階差分），修正後要跟 `--noik` 的原始動作差不多；`--dbg=l/r/y/t/h` 可逐項關掉修正找原因。
- 整個人抬高的量是 `body_fix.gd` 的常數 `HIPS_RAISE`（0.012 模型單位 ≈ 2.2 公分），**用實測校正**：`tools/foot_check.gd -- --lows` 會印各招式「支撐腳鞋底離地」的分布，調到中位數接近 0。原始動作是陷在地面下約 3 公分；用腳踝高度比例推算會得到 5.7 公分，抬過頭、腳懸空 3.5 公分（使用者回報「腳浮空」）。上面第一條寫的 `hips_raise` 推算法已作廢，以這條為準。腳的三個驗收指標要同時成立：穿地 0、支撐腳離地中位數 ≈ 0、抖動量接近原始動作。
- 頭髮的骨架與物理在 `godot/scripts/hair.gd`（`HairSim`，`SkeletonModifier3D`，排在身體修正和飄帶之後；`HairSim.rig()` 在 `hero_rig.gd` 的飄帶之後呼叫，同樣會重建網格）。頭髮頂點＝頭關節以上的深色頂點，排除臉的正面（眼睛、眉毛也是深色）。依方向分 12 束（`DIRS`），每束一根骨頭掛在頭底下，支點在頭皮（`ROOT_R`）；頂點權重隨離頭中心的距離從髮根 0 漸增到髮尖 `MAX_WEIGHT`，並在方向最近的兩束之間混合。物理：每束一個「虛擬擺錘」質點（沿髮束方向 `PENDULUM` 處）用彈簧追著頭走，有跟隨比例 `CARRY`、角度上限 `MAX_ANGLE`。**不要直接用髮束本身的長度（約 6 公分）算角度**，太敏感、會一直頂在上限。這個待機動作每秒彈跳 3～4 下、頭部加速度約 7～10 公尺／秒平方，頭髮被帶著晃是正常的。量測：`godot --headless --path . --fixed-fps 30 -s tools/hair_check.gd`（第一版待機平均 5 度、出拳 6～8 度，使用者說「不夠軟」；目前調到待機約 10 度、出拳 16～20 度、停止兩秒後約 4 度，每束的彈簧強度另有 ±20% 的差異）；`tools/head_accel.gd` 量頭部加速度。
- 頭髮第三版（使用者兩次說不夠軟之後）：每束改成兩節骨頭（髮根段 `Hair?A`、髮尖段 `Hair?B`，交界 `MID_R`），各用一個彈簧擺錘，髮尖段較軟（`STIFF_B` < `STIFF_A`）所以會彎曲；頂點權重擴充成八欄（頭＋兩束各兩節）。貼著臉的瀏海（方向靠前、偏低）權重另外打折，因為它和額頭是連在一起的網格，擺動太多會扯到臉。目前量測：待機髮尖平均偏離約 21 度、出拳 31～36 度、停止兩秒後約 14 度（含重力下垂）。
- 臉部權重修正在 `hero_rig.gd` 的 `_fix_face_weights()`（最先做）：模型原本把下巴到鼻子高度的頂點綁了一部分在脖子上，頭相對脖子一轉臉就被拉扯（抬頭修正會放大這個問題）。現在頭關節上方 1.2 公分以上的頂點只跟著頭，下方留一小段漸變。檢查：`godot --headless --path . -s tools/face_probe.gd`（加 `-- --raw` 看原始權重）。
