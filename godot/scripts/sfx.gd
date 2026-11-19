class_name Sfx
extends Node
# 音效：優先用 assets/sfx/ 裡的音檔（同一種有好幾個版本就輪流隨機播）；沒有音檔的才用程式合成的頂著。
# 音檔由 tools/sfx_import.py 整理（裁掉空白、音量一致、環境音與音樂做成無縫循環）。
# 打擊感有一大半來自聲音：揮拳的風聲、命中的悶響、重擊的低頻、暴擊的清脆爆裂、收尾的轟一聲。

const RATE := 22050
const VOICES := 10
# 整體音量的平衡（分貝）。使用者聽過後調整：音效太大聲、音樂要大一點
const SFX_GAIN := -6.0         # 所有一次性音效（揮拳、命中、提示音…）一起加減
const MUSIC_GAIN := 6.0        # 背景音樂

var streams := {}
var banks := {}                # 音檔：名稱 → 好幾個版本
var last_pick := {}
var loop_target := {}          # 循環音的目標音量
var loops := {}                # 循環播放的環境音與音樂：名稱 → 播放器
# 遊戲裡用的名稱 → 音檔的開頭
const FILES := {"whoosh": "whoosh_punch", "whoosh_kick": "whoosh_kick", "hit": "hit", "heavy": "heavy", "crit": "crit", "boom": "finisher", "hurt": "hurt", "fall": "fall", "wave": "ui_wave_start", "defeat": "ui_defeat"}
const LOOPS := {"bgm": "bgm_fight_day", "market": "amb_market", "snow": "amb_snow"}
var players: Array = []
var next := 0
var rng := RandomNumberGenerator.new()

func _ready() -> void:
	rng.seed = 7
	streams["whoosh"] = _make(0.16, _whoosh)
	streams["hit"] = _make(0.14, _hit)
	streams["heavy"] = _make(0.22, _heavy)
	streams["crit"] = _make(0.24, _crit)
	streams["boom"] = _make(0.5, _boom)
	streams["hurt"] = _make(0.16, _hurt)
	# 讀音檔：先找「開頭_1、開頭_2…」，沒有編號的就找「開頭」本身
	for key in FILES:
		var list: Array = []
		for i in range(1, 9):
			var path := "res://assets/sfx/%s_%d.wav" % [FILES[key], i]
			if ResourceLoader.exists(path): list.append(load(path))
		var single := "res://assets/sfx/%s.wav" % FILES[key]
		if list.is_empty() and ResourceLoader.exists(single): list.append(load(single))
		if not list.is_empty(): banks[key] = list
	for key in LOOPS:
		var path := "res://assets/sfx/%s.ogg" % LOOPS[key]
		if not ResourceLoader.exists(path): continue
		var st: AudioStreamOggVorbis = load(path)
		st.loop = true
		var lp := AudioStreamPlayer.new()
		lp.stream = st
		lp.volume_db = -60.0
		add_child(lp)
		loops[key] = lp
	for i in VOICES:
		var p := AudioStreamPlayer.new()
		add_child(p)
		players.append(p)

# 播放：name 是音效名稱，volume 是音量（分貝），pitch 是音高倍率（每次略有不同才不會聽起來像機關槍）
func play(sound: String, volume := 0.0, pitch := 1.0) -> void:
	var st: AudioStream = null
	if banks.has(sound):
		# 有好幾個版本時隨機挑，但不連續挑同一個
		var list: Array = banks[sound]
		var i := randi() % list.size()
		if list.size() > 1 and i == last_pick.get(sound, -1): i = (i + 1) % list.size()
		last_pick[sound] = i
		st = list[i]
	elif streams.has(sound): st = streams[sound]
	elif sound == "whoosh_kick" and banks.has("whoosh"): st = banks["whoosh"][0]
	if st == null: return
	var p: AudioStreamPlayer = players[next]
	next = (next + 1) % VOICES
	p.stream = st
	p.volume_db = volume + SFX_GAIN
	p.pitch_scale = pitch * randf_range(0.93, 1.08)
	p.play()

# 設定某個循環音（音樂、環境音）的目標音量（分貝）；實際音量會平滑地淡入、淡出（見 _process）
func loop_volume(key: String, db: float) -> void:
	if loops.has(key): loop_target[key] = db + (MUSIC_GAIN if key == "bgm" else 0.0)

# 循環音的檔案為了能無縫循環，開頭那一段疊著曲子的結尾（tools/sfx_import.py 做的）。
# 從頭播的話一開始就會聽到一小段結尾的音樂，很突兀；所以第一次播放要跳過那一段，等繞回來時才會經過它
const LOOP_SKIP := {"bgm": 2.05, "market": 0.85, "snow": 0.85}

func _process(dt: float) -> void:
	for key in loop_target:
		var lp: AudioStreamPlayer = loops[key]
		var to: float = loop_target[key]
		if to > -45.0 and not lp.playing:
			lp.volume_db = -45.0
			lp.play(LOOP_SKIP.get(key, 0.0))
		# 淡入慢一點（每秒 18 分貝，從無聲到正常約 1.5 秒），淡出快一點
		lp.volume_db = move_toward(lp.volume_db, to, dt * (18.0 if to > lp.volume_db else 30.0))
		if to <= -45.0 and lp.playing and lp.volume_db <= -44.5: lp.stop()

# 把一個「時間 → 振幅（-1～1）」的函式轉成 16 位元單聲道音訊
func _make(seconds: float, f: Callable) -> AudioStreamWAV:
	var n := int(seconds * RATE)
	var data := PackedByteArray()
	data.resize(n * 2)
	var lp := 0.0          # 低通濾波的狀態（給各音效用）
	for i in n:
		var t := float(i) / RATE
		var r: Array = f.call(t, seconds, rng.randf_range(-1.0, 1.0), lp)
		lp = r[1]
		# 尾端 5 毫秒淡出，避免結束時「啪」一聲
		var fade := clampf((seconds - t) / 0.005, 0.0, 1.0)
		data.encode_s16(i * 2, int(clampf(r[0] * fade, -1.0, 1.0) * 32000.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.stereo = false
	w.data = data
	return w

# 以下每個函式回傳 [振幅, 新的濾波狀態]。noise 是 -1～1 的白雜訊

# 揮拳的風聲：悶悶的雜訊，音量先升後降
func _whoosh(t: float, dur: float, noise: float, lp: float) -> Array:
	lp += (noise - lp) * 0.16
	return [lp * sin(PI * t / dur) * 0.55, lp]

# 一般命中：短促的悶響（往下掉的低音）＋一點雜訊的「啪」
func _hit(t: float, _dur: float, noise: float, lp: float) -> Array:
	lp += (noise - lp) * 0.45
	var thump := sin(TAU * (150.0 * t - 380.0 * t * t)) * exp(-t * 26.0)
	return [thump * 0.85 + lp * exp(-t * 45.0) * 0.7, lp]

# 打到重型敵人：更低、更長
func _heavy(t: float, _dur: float, noise: float, lp: float) -> Array:
	lp += (noise - lp) * 0.3
	var thump := sin(TAU * (95.0 * t - 150.0 * t * t)) * exp(-t * 15.0)
	return [thump * 0.95 + lp * exp(-t * 30.0) * 0.6, lp]

# 暴擊：悶響之上再疊一聲清脆的爆裂（高頻雜訊）和一個往下掉的亮音
func _crit(t: float, _dur: float, noise: float, lp: float) -> Array:
	lp += (noise - lp) * 0.35
	var thump := sin(TAU * (130.0 * t - 240.0 * t * t)) * exp(-t * 16.0)
	var crack := (noise - lp) * exp(-t * 55.0)
	var ping := sin(TAU * (1500.0 * t - 2600.0 * t * t)) * exp(-t * 30.0)
	return [thump * 0.9 + crack * 0.75 + ping * 0.22 + lp * exp(-t * 28.0) * 0.5, lp]

# 收尾：轟一聲（很低的長音＋一陣雜訊）
func _boom(t: float, _dur: float, noise: float, lp: float) -> Array:
	lp += (noise - lp) * 0.12
	var low := sin(TAU * (70.0 * t - 45.0 * t * t)) * exp(-t * 7.0)
	var crack := (noise - lp) * exp(-t * 40.0)
	return [low * 0.95 + lp * exp(-t * 9.0) * 0.8 + crack * 0.5, lp]

# 主角被打
func _hurt(t: float, _dur: float, noise: float, lp: float) -> Array:
	lp += (noise - lp) * 0.25
	return [sin(TAU * (210.0 * t - 500.0 * t * t)) * exp(-t * 22.0) * 0.6 + lp * exp(-t * 35.0) * 0.5, lp]
