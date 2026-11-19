extends Node3D
# RL Fight（Godot 4 版）遊戲本體：自動戰鬥、敵人、波次。
# 主角（HeroRig：骨架修正、材質、腳貼地、飄帶與頭髮物理）和街景打光（Street）都是和動作檢視器共用的。
# 單位：公尺。舊版 1 單位 ≈ 0.0234 公尺。

const U := 0.0234
const ARENA := 7.0            # 擂台半徑
const HERO_R := 0.42          # 主角碰撞半徑
const KNOCKBACK := 0.0        # 一般攻擊的擊退力道：零。被打中的敵人位置完全不動，只有原地的受擊反應；把敵人打退是之後的技能
const BODY_HALF := 0.35       # 主角半個身寬：軀幹要整個留在黃圈裡，所以身體中心最遠只能到「圓圈半徑 − 這個值」
const SPAWN_GAP := 0.3       # 一波敵人分批進場，每隔這麼久出一個：敵人是一直湧進來的，不是一次全到
const FX_SCALE := 1.7         # 特效整體放大的倍率（鏡頭拉遠之後，原本的尺寸在畫面上太小）
const DAY_LEN := 180.0        # 日夜循環一輪的秒數（三分鐘）
const JUMPS := [0.06, 0.48, 0.7]   # 按「時段」時依序跳到：白天、黃昏、夜晚

# 敵人種類（數值沿用舊版，速度與體型換算成公尺）。目前外觀是臨時替身
const ENEMY_TYPES := {
	"grunt":  {"name": "小嘍囉", "hp": 5.0,  "speed": 58.0,  "dmg": 2.0, "r": 15.0, "color": Color("d9534f"), "mass": 1.0},
	"runner": {"name": "快腿仔", "hp": 4.0,  "speed": 140.0, "dmg": 2.0, "r": 13.0, "color": Color("f0883e"), "mass": 0.8},
	"tank":   {"name": "肉盾",   "hp": 24.0, "speed": 44.0,  "dmg": 6.0, "r": 24.0, "color": Color("8e5bd1"), "mass": 3.0},
}

var street: Plaza
var sfx: Sfx
var hero: Node3D
var anim: AnimationPlayer
var fix: BodyFix
var skel: Skeleton3D
var hips_bone := 0
var cam: Camera3D
var hud_top: Label
var hud_info: Label
var hud_hp: ProgressBar
var hud_banner: Label
var tune: TunePanel
var fx_root: Node3D
var gore: Gore
var gore_btn: Button

var enemies: Array = []
var bodies: Array = []
var hp := 100.0
var max_hp := 100.0
var base_dmg := 5.0
var attack_range := 3.5
var combo_i := 0
var atk = null               # 目前這一擊：{move, target, t, wind, total, hit, finisher}
var idle_wait := 0.0
var in_idle := true
var hero_yaw := 0.0
var face_yaw := 0.0
var hitstop := 0.0
var shake := 0.0
var shake_dir := Vector2.ZERO
var wave := 0
var kills := 0
var wave_delay := 1.0
var spawn_left := 0            # 這一波還沒進場的敵人數
var spawn_t := 0.0
var slowmo := 0.0             # 收尾後的短暫慢動作（剩餘秒數）
var last_hit = null           # 剛被打中的敵人（命中停頓時讓它震動）
var last_dir := Vector3.ZERO
var dbg_far := 0.0            # 測試用：主角身體離擂台中心最遠到過哪裡
var dbg_punches := 0          # 測試用：敵人出了幾拳
var dbg_hurts := 0            # 測試用：主角被打中幾次
var dbg_far_punch := 0.0      # 測試用：敵人出拳時離主角最遠的距離（應該不超過攻擊距離）
var dbg_push := 0.0           # 測試用：敵人被打中後位置被推動的最大距離
var banner_t := 0.0
var time := 0.0
var god := false
var dead := false
var dead_t := 0.0
var day_t := 0.06              # 日夜循環目前的位置（0～1）
var day_run := true            # 時間是否自動前進（測試指定時段時會停住）
var close_cam := false
var zoom_kick := 0.0             # 暴擊、收尾時鏡頭瞬間微微拉近的量（度），很快彈回
# 畫質自動調整
var auto_quality := true
var fps_t := 0.0
var fps_n := 0
var fps_now := 60.0
var warmup := 2.5

func _ready() -> void:
	TunePanel.load_saved()
	Gore.load_saved()
	EnemyRig.lod_bias = 0.5      # 效能：遊戲鏡頭很遠，敵人提早換成面數較少的版本（對照過截圖，看不出差別）；動作檢視器是近看，維持原本的
	sfx = Sfx.new()
	add_child(sfx)
	# 街景與打光
	street = Plaza.new()
	add_child(street)
	var we := WorldEnvironment.new()
	we.environment = street.env
	add_child(we)
	# 主角
	var h := HeroRig.build()
	hero = h.node
	anim = h.anim
	fix = h.fix
	skel = h.skel
	hips_bone = skel.find_bone("Hips")
	add_child(hero)
	street.add_character(hero)
	anim.play("idle")
	# 鏡頭：斜上方俯視
	cam = Camera3D.new()
	cam.fov = 40.0
	add_child(cam)
	# 攻擊範圍的黃色圈
	var ring := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = attack_range - 0.04
	tm.outer_radius = attack_range
	tm.rings = 96
	tm.ring_segments = 4
	ring.mesh = tm
	var rm := StandardMaterial3D.new()
	rm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rm.albedo_color = Color(1.0, 0.85, 0.3)
	ring.material_override = rm
	ring.scale = Vector3(1, 0.05, 1)
	ring.position.y = 0.012
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(ring)
	fx_root = Node3D.new()
	add_child(fx_root)
	gore = Gore.new()
	add_child(gore)
	_build_hud()
	_test_args()
	_start_gate()

# ---------------- 介面 ----------------
func _build_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var theme := Theme.new()
	theme.default_font = load("res://assets/fonts/NotoSansTC.ttf")
	theme.default_font_size = 30
	var root := Control.new()
	root.theme = theme
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(root)
	hud_hp = ProgressBar.new()
	hud_hp.position = Vector2(24, 24)
	hud_hp.size = Vector2(280, 30)
	hud_hp.show_percentage = false
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color("ff4d5e")
	fill.set_corner_radius_all(6)
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0, 0, 0, 0.5)
	bg.set_corner_radius_all(6)
	hud_hp.add_theme_stylebox_override("fill", fill)
	hud_hp.add_theme_stylebox_override("background", bg)
	root.add_child(hud_hp)
	hud_top = Label.new()
	hud_top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	hud_top.position.y = 20
	hud_top.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hud_top.offset_right = -24
	hud_top.add_theme_color_override("font_outline_color", Color.BLACK)
	hud_top.add_theme_constant_override("outline_size", 8)
	root.add_child(hud_top)
	hud_info = Label.new()
	hud_info.position = Vector2(24, 62)
	hud_info.add_theme_font_size_override("font_size", 22)
	hud_info.add_theme_color_override("font_outline_color", Color.BLACK)
	hud_info.add_theme_constant_override("outline_size", 6)
	root.add_child(hud_info)
	hud_banner = Label.new()
	hud_banner.set_anchors_preset(Control.PRESET_CENTER_TOP)
	hud_banner.position.y = 260
	hud_banner.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hud_banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud_banner.add_theme_font_size_override("font_size", 64)
	hud_banner.add_theme_color_override("font_color", Color("ffe14a"))
	hud_banner.add_theme_color_override("font_outline_color", Color.BLACK)
	hud_banner.add_theme_constant_override("outline_size", 14)
	root.add_child(hud_banner)
	# 下方按鈕：切換時段、畫質、開啟動作檢視器
	var row := HBoxContainer.new()
	row.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	row.grow_vertical = Control.GROW_DIRECTION_BEGIN
	row.offset_left = 12
	row.offset_right = -12
	row.offset_bottom = -12
	root.add_child(row)
	# 動作速度調整面板（按「速度」開關）
	tune = TunePanel.new()
	tune.offset_bottom = -94
	root.add_child(tune)
	for item in [["時段", _cycle_tod], ["天氣", _cycle_weather], ["畫質", _cycle_quality], ["速度", tune.toggle], ["血腥", _toggle_gore], ["檢視", _open_viewer], ["重整", HeroRig.reload_page.bind(get_tree())]]:
		var b := Button.new()
		b.text = item[0]
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size.y = 70
		b.focus_mode = Control.FOCUS_NONE
		b.pressed.connect(item[1])
		row.add_child(b)
		if item[0] == "血腥":
			gore_btn = b
			b.text = "血腥開" if Gore.enabled else "血腥關"

func _banner(text: String, sec := 1.2) -> void:
	hud_banner.text = text
	banner_t = sec

func _cycle_tod() -> void:
	# 跳到下一個時段，之後時間照常往前走
	var x := fposmod(day_t, 1.0)
	var nxt: float = JUMPS[0]
	for j in JUMPS:
		if j > x + 0.02:
			nxt = j
			break
	day_t = nxt

# 天氣輪流切換：晴天 → 下雨 → 雨後（地濕）→ 下雪 → 積雪 → 晴天
func _cycle_weather() -> void:
	var order: Array = Street.WEATHER_ORDER
	street.set_weather(order[(order.find(street.weather) + 1) % order.size()])

# 血腥表現的開關（噴血、地上的血跡），設定會記住
func _toggle_gore() -> void:
	Gore.set_enabled(not Gore.enabled)
	gore_btn.text = "血腥開" if Gore.enabled else "血腥關"
	if not Gore.enabled: gore.clear()

func _cycle_quality() -> void:
	auto_quality = false
	street.set_quality((street.quality + 2) % 3)

func _open_viewer() -> void:
	get_tree().change_scene_to_file("res://viewer.tscn")

# 量每秒畫面數；太低就自動降一級畫質
func _watch_fps(dt: float) -> void:
	if warmup > 0.0:
		warmup -= dt
		return
	fps_t += dt
	fps_n += 1
	if fps_t < 1.5: return
	fps_now = fps_n / fps_t
	fps_t = 0.0
	fps_n = 0
	if auto_quality and fps_now < 40.0 and street.quality > 0:
		street.set_quality(street.quality - 1)
		warmup = 1.0

# ---------------- 敵人（臨時替身） ----------------
# 生一個敵人。外觀一律用敵人角色模型（EnemyRig），不同種類目前只有體型大小不同
func spawn_enemy(type: String, pos := Vector3.INF) -> void:
	var T: Dictionary = ENEMY_TYPES[type]
	var r: float = T.r * U
	var mul: float = {"runner": 0.97, "tank": 1.25}.get(type, 1.0)     # 體型：小嘍囉 1、快腿仔幾乎一樣、肉盾比較大
	var rig := EnemyRig.build(type, mul)                 # 小嘍囉用走的、快腿仔用跑的、肉盾有自己的模型和沉重的走路
	var node: Node3D = rig.node
	(rig.fix as BodyFix).legs_ik = close_cam or type == "tank"     # 肉盾數量少、體型大，原始動作穿地較深，保留逐腳修正
	# （其餘敵人）效能：遠鏡頭下只把整個人抬到地面上，不逐腳修正（近照測試時才開）
	add_child(node)
	street.add_character(node, r * 1.5, false)        # 吃角色的光、腳下有接地暗影
	if pos == Vector3.INF:
		var a := randf() * TAU
		var d := ARENA + 2.0 + randf() * 2.0
		pos = Vector3(cos(a) * d, 0, sin(a) * d)
	node.position = pos
	var anim: AnimationPlayer = rig.anim
	anim.play(rig.move)
	anim.seek(randf() * anim.current_animation_length, true)   # 每一隻的腳步錯開，不要整群同手同腳
	var hp_scale := pow(1.18, wave - 1) if wave > 1 else 1.0
	enemies.append({"type": type, "T": T, "node": node, "anim": anim, "fix": rig.fix, "meshes": rig.meshes, "base": node.scale, "mul": mul, "move": rig.move, "move_speed": rig.move_speed, "pos": pos, "vel": Vector3.ZERO, "r": r,
		"hp": T.hp * hp_scale, "speed": T.speed * U, "dmg": T.dmg, "mass": T.mass, "flash": 0.0, "stun": 0.0, "atk": 0.6 + randf() * 0.6, "dead": false, "squash": 0.0, "flashing": false, "hit_anim": false, "punch": -1.0, "punched": false})

func _start_wave() -> void:
	wave += 1
	_banner("第 %d 波" % wave)
	sfx.play("wave", -6.0, 1.0)
	spawn_left = 18 + wave * 8
	spawn_t = 0.0

func _update_enemies(dt: float) -> void:
	var hp3 := hero.position
	for e in enemies:
		if e.dead: continue        # 這一格剛被打倒的交給 _update_bodies 處理
		var pos: Vector3 = e.pos
		e.flash = maxf(0.0, e.flash - dt)
		e.stun = maxf(0.0, e.stun - dt)
		pos += e.vel * dt
		e.vel *= maxf(0.0, 1.0 - dt * 6.0)
		var to := hp3 - pos
		to.y = 0
		var d := to.length()
		var reach: float = e.r + HERO_R + 0.1
		var ea: AnimationPlayer = e.anim
		if e.stun > 0.0:
			e.punch = -1.0             # 被打中：出到一半的拳被打斷
		elif e.punch >= 0.0:
			# 出拳中：站定不動，動作播到打中的那一格才扣主角的血
			e.punch += dt
			if not e.punched and e.punch >= (EnemyRig.PUNCH_IMPACT - EnemyRig.PUNCH_ENTER) / 30.0 / EnemyRig.PUNCH_SPEED:
				e.punched = true
				if d < reach + 0.5: _hurt(e.dmg)      # 主角已經離開的話就揮空
			if e.punch >= (EnemyRig.PUNCH_END - EnemyRig.PUNCH_ENTER) / 30.0 / EnemyRig.PUNCH_SPEED:
				e.punch = -1.0
				e.atk = 0.5 + randf() * 0.3            # 收拳後停一下再出下一拳
		elif d > reach:
			# 敵人不停往主角走，不會停下來等（這是這個遊戲的玩法）
			pos += to / d * e.speed * dt
			e.atk = minf(e.atk, 0.2)                   # 走到面前後很快就出第一拳
		else:
			# 已經走到主角面前：站定，時間到就揮拳（只有直拳一種）
			e.atk -= dt
			if e.atk <= 0.0:
				e.punch = 0.0
				e.punched = false
				dbg_punches += 1
				dbg_far_punch = maxf(dbg_far_punch, d - reach)
				ea.speed_scale = 1.0
				ea.play("punch", 0.12, EnemyRig.PUNCH_SPEED)
				ea.seek(EnemyRig.PUNCH_ENTER / 30.0, true)
				sfx.play("whoosh", -14.0, 0.85)
		e.pos = pos
		var node: Node3D = e.node
		node.position = pos
		if d > 0.01: node.rotation.y = lerp_angle(node.rotation.y, atan2(to.x, to.z), minf(1.0, dt * 10.0))
		# 被打的瞬間稍微壓扁再彈回來（很輕微，主要的反應是被打的動作）
		e.squash = maxf(0.0, e.squash - dt * 3.2)
		var sq: float = e.squash * 0.45
		node.scale = (e.base as Vector3) * Vector3(1.0 + sq * 0.5, 1.0 - sq, 1.0 + sq * 0.5)
		# 動作：被打時播受擊動作；其餘時間走路，播放速度跟實際移動速度同步，腳才不會滑
		var anim: AnimationPlayer = e.anim
		if e.stun > 0.0:
			pass      # 受擊動作在 _damage() 裡開始播
		else:
			if e.hit_anim:
				e.hit_anim = false
				anim.play(e.move, 0.2)
			if e.punch >= 0.0:
				pass      # 出拳動作在上面開始播
			elif d > reach:
				if anim.current_animation != e.move: anim.play(e.move, 0.2)
				anim.speed_scale = (e.speed as float) / ((e.move_speed as float) * (e.mul as float))
			else:
				# 站在主角面前等下一拳：停在出拳動作收回來的備戰姿勢（剛走到的話先把腳步停住）
				if anim.current_animation == e.move: anim.speed_scale = 0.0
		# 被打中的白色閃光：疊一層發亮的材質
		var want: bool = e.flash > 0.0
		if want != e.flashing:
			e.flashing = want
			for m in e.meshes: (m as MeshInstance3D).material_overlay = EnemyRig.flash_mat if want else null
	# 敵人之間互相推開，不要疊在一起
	for i in enemies.size():
		for j in range(i + 1, enemies.size()):
			var a = enemies[i]
			var b = enemies[j]
			var dv: Vector3 = b.pos - a.pos
			dv.y = 0
			var dd := dv.length()
			var mn: float = a.r + b.r
			if dd < mn and dd > 0.001:
				var push := dv / dd * (mn - dd) * 0.5
				a.pos -= push
				b.pos += push

func _hurt(amount: float) -> void:
	if god or dead: return
	hp -= amount
	dbg_hurts += 1
	shake = maxf(shake, 0.1)
	sfx.play("hurt", -4.0)
	if hp <= 0.0:
		hp = 0.0
		dead = true
		dead_t = 3.2
		sfx.play("defeat", -4.0, 1.0)
		_banner("倒下了…", 99.0)

# 打擊感分四級，一級比一級明顯：0 普通命中、1 打到重型敵人、2 暴擊、3 收尾。
# [命中停頓秒數, 鏡頭晃動, 鏡頭拉近, 光條數量, 火花大小, 敵人壓扁程度]
const HIT_FEEL := [
	[0.06, 0.1, 0.4, 5, 0.5, 0.3],
	[0.085, 0.16, 0.7, 6, 0.6, 0.18],
	[0.12, 0.28, 1.8, 9, 0.85, 0.4],
	[0.17, 0.45, 3.0, 14, 1.15, 0.5],
]

func _damage(e: Dictionary, amount: float, dir: Vector3, kb: float, level: int, main := true) -> void:
	var f: Array = HIT_FEEL[level]
	e.hp -= amount
	e.flash = 0.11
	e.stun = 0.4 if level >= 2 else 0.24
	e.squash = f[5]
	# 受擊動作：從頭播，速度加快到跟僵直時間差不多長
	var ea: AnimationPlayer = e.anim
	ea.speed_scale = 1.0
	ea.play("hit", 0.05, 2.4)
	ea.seek(0.12, true)
	e.hit_anim = true
	e.vel += dir * kb / e.mass
	var at: Vector3 = e.pos + Vector3(0, e.r * 2.6, 0) - dir * e.r
	_impact_fx(at, dir, level if main else 0)
	# 噴血（血腥表現開著才有）：越重的一擊噴越多、越遠；打倒的那一下再多一些
	gore.burst(at, dir, [10, 14, 22, 32][level] + (16 if e.hp <= 0.0 else 0), [1.0, 1.1, 1.3, 1.6][level])
	_number(e.pos + Vector3(0, e.r * 5.0, 0), amount, level >= 2 and main)
	if main:
		hitstop = maxf(hitstop, f[0] * HeroRig.HITSTOP_SCALE)
		shake = maxf(shake, f[1])
		zoom_kick = maxf(zoom_kick, f[2])
		shake_dir = Vector2(dir.x, dir.z)
		last_hit = e
		last_dir = dir
		sfx.play(["hit", "heavy", "crit", "boom"][level], [-2.0, -1.0, 0.0, 1.0][level])
		if level == 3: slowmo = 0.22
	if e.hp <= 0.0 and not e.dead:
		e.dead = true
		kills += 1
		sfx.play("fall", -10.0)
		for m in e.meshes: (m as MeshInstance3D).material_overlay = null
		# 倒下：原地播被打倒的動作（往後倒、躺平），不再整隻飛出去。腳貼地在躺下時要關掉
		(e.node as Node3D).scale = e.base
		(e.fix as BodyFix).foot_ik = false
		(e.node as Node3D).set_meta("down", true)      # 倒下了：腳下的接地暗影拿掉
		ea.speed_scale = 1.0
		ea.play("fall", 0.08, EnemyRig.FALL_SPEED)
		ea.seek(EnemyRig.FALL_ENTER / 30.0, true)
		bodies.append({"base": e.base, "node": e.node, "life": 2.6})

func _update_bodies(dt: float) -> void:
	for b in bodies:
		var n: Node3D = b.node
		b.life -= dt
		# 躺一會兒之後沉進地面消失
		if b.life < 0.6: n.position.y = -(0.6 - b.life) / 0.6 * 0.5
		if b.life <= 0.0: n.queue_free()
	bodies = bodies.filter(func(b): return b.life > 0.0)

func _fx_mat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = c
	return m

# 命中特效：閃光 ＋ 順著出拳方向噴出去的光條；暴擊和收尾再加一圈地面震波
func _impact_fx(pos: Vector3, dir: Vector3, level: int) -> void:
	var f: Array = HIT_FEEL[level]
	var size: float = f[4] * FX_SCALE
	var col := Color(1.0, 0.82, 0.3) if level >= 2 else Color(1.0, 0.95, 0.82)
	# 閃光
	var flash := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.5
	sm.height = 1.0
	flash.mesh = sm
	var fm := _fx_mat(col)
	flash.material_override = fm
	flash.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	flash.position = pos
	flash.scale = Vector3.ONE * size * 0.45
	fx_root.add_child(flash)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(flash, "scale", Vector3.ONE * size, 0.11).set_ease(Tween.EASE_OUT)
	tw.tween_property(fm, "albedo_color:a", 0.0, 0.13)
	tw.chain().tween_callback(flash.queue_free)
	# 光條：細長的亮條朝出拳方向散開飛出去
	for i in int(f[3]):
		var d := (dir + Vector3(randf_range(-0.6, 0.6), randf_range(-0.15, 0.7), randf_range(-0.6, 0.6))).normalized()
		var st := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.07, 0.07, 1.0)
		st.mesh = bm
		var m2 := _fx_mat(col if i % 2 == 0 else Color.WHITE)
		st.material_override = m2
		st.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		fx_root.add_child(st)
		st.look_at_from_position(pos + d * 0.15, pos + d * 2.0, Vector3.UP if absf(d.y) < 0.95 else Vector3.RIGHT)
		var length: float = randf_range(0.35, 0.7) * (0.8 + size)
		st.scale = Vector3(1, 1, length)
		var t2 := create_tween()
		t2.set_parallel(true)
		t2.tween_property(st, "position", pos + d * randf_range(0.9, 1.7) * (0.7 + size), 0.16).set_ease(Tween.EASE_OUT)
		t2.tween_property(st, "scale", Vector3(1, 1, 0.05), 0.16)
		t2.tween_property(m2, "albedo_color:a", 0.0, 0.16)
		t2.chain().tween_callback(st.queue_free)
	# 地面震波：暴擊和收尾才有
	if level >= 2:
		var ring := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 0.86
		tm.outer_radius = 1.0
		tm.rings = 40
		tm.ring_segments = 4
		ring.mesh = tm
		var rm := _fx_mat(col)
		ring.material_override = rm
		ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		ring.position = Vector3(pos.x, 0.03, pos.z)
		ring.scale = Vector3(0.3, 0.05, 0.3)
		fx_root.add_child(ring)
		var r_end := 2.4 if level == 2 else 4.2
		var t3 := create_tween()
		t3.set_parallel(true)
		t3.tween_property(ring, "scale", Vector3(r_end, 0.05, r_end), 0.28).set_ease(Tween.EASE_OUT)
		t3.tween_property(rm, "albedo_color:a", 0.0, 0.28)
		t3.chain().tween_callback(ring.queue_free)

# 傷害數字：往上跳一下再淡出；暴擊是黃色大字
var num_font: Font = null
func _number(pos: Vector3, amount: float, big: bool) -> void:
	if num_font == null: num_font = load("res://assets/fonts/NotoSansTC.ttf")
	var lb := Label3D.new()
	lb.text = str(roundi(amount)) + ("!" if big else "")
	lb.font = num_font
	lb.font_size = 96 if big else 64
	lb.pixel_size = 0.0105
	lb.outline_size = 14
	lb.modulate = Color(1.0, 0.85, 0.25) if big else Color.WHITE
	lb.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	lb.no_depth_test = true
	lb.shaded = false
	lb.position = pos + Vector3(randf_range(-0.2, 0.2), 0, 0)
	fx_root.add_child(lb)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(lb, "position", lb.position + Vector3(0, 1.5, 0), 0.5).set_ease(Tween.EASE_OUT)
	tw.tween_property(lb, "modulate:a", 0.0, 0.25).set_delay(0.3)
	tw.tween_property(lb, "outline_modulate:a", 0.0, 0.25).set_delay(0.3)
	tw.chain().tween_callback(lb.queue_free)

# ---------------- 自動戰鬥 ----------------
# 攻擊範圍內的敵人（黃色圈以擂台中心為圓心；貼身的敵人就算在圈外也要反擊），依離主角的距離排序
func _zone_enemies() -> Array:
	var out: Array = []
	for e in enemies:
		if e.dead: continue
		var dc := Vector2(e.pos.x, e.pos.z).length() - (e.r as float)
		var dh := (e.pos as Vector3).distance_to(hero.position) - (e.r as float)
		if dc <= attack_range or dh < HERO_R + 0.9: out.append(e)
	out.sort_custom(func(a, b): return (a.pos as Vector3).distance_squared_to(hero.position) < (b.pos as Vector3).distance_squared_to(hero.position))
	return out

# 出下一招。播法跟動作檢視器的「新播法」一樣：從蓄力（進場格）開始播，命中格對上判定，
# 打中後收到一半（可接招格）才接下一招。衝刺安排在蓄力期間。
# 動作完整保留但加快：蓄力段 HeroRig.WIND_SPEED 倍、收招段 HeroRig.RECOVER_SPEED 倍（在 _process 裡設定）。
func _launch(zone: Array) -> void:
	var move: String = HeroRig.COMBO[combo_i % HeroRig.COMBO.size()]
	combo_i += 1
	var finisher := move == "fly"
	# 不管哪一招，一律打離主角最近的那一個
	var target: Dictionary = zone[0]
	var tm := HeroRig.move_time(move)
	anim.play(move, 0.07)
	anim.seek(HeroRig.MOVES[move][4] / 30.0, true)
	# 揮拳和踢腿的風聲不同
	sfx.play("whoosh_kick" if move in ["round", "side", "fly"] else "whoosh", -7.0)
	atk = {"move": move, "target": target, "t": 0.0, "wind": tm[0], "total": tm[1], "hit": false, "finisher": finisher}
	in_idle = false

func _update_combat(dt: float) -> void:
	if atk == null and not dead:
		var zone := _zone_enemies()
		if not zone.is_empty():
			_launch(zone)
		elif not in_idle:
			# 圈內沒有敵人了：等一小段，沒有下一招就回備戰姿勢
			idle_wait += dt
			if idle_wait > 0.12:
				in_idle = true
				anim.play("idle", 0.25)
	if atk != null:
		idle_wait = 0.0
		var tg: Dictionary = atk.target
		var tp: Vector3 = tg.pos
		var to := tp - hero.position
		to.y = 0
		var d := maxf(0.001, to.length())
		var moving := false
		if not atk.hit:
			face_yaw = atan2(to.x, to.z)
			# 衝刺：在蓄力期間移動到目標面前（不出圈）
			var stand: float = tg.r + HERO_R + 0.15
			var goal := tp - to / d * stand
			var gl := Vector2(goal.x, goal.z).length()
			# 站位點不超過圈內的活動範圍（再往內留一點，出招往前踏時才不會頂到邊界）
			var lim := attack_range - BODY_HALF - 0.15
			if gl > lim: goal *= lim / gl
			var left := maxf(dt, atk.wind - atk.t)
			var mv := goal - hero.position
			mv.y = 0
			if mv.length() > 0.01:
				hero.position += mv * minf(1.0, dt / left)
				moving = mv.length() / left > 0.6
		# 主角本身在移動時不能固定腳，不然腳會被拖著走；站定出拳時再固定
		fix.foot_lock = not moving
		atk.t += dt
		if not atk.hit and atk.t >= atk.wind:
			atk.hit = true
			var crit := randf() < 0.14
			var dir := to / d
			var dmg := base_dmg * (3.0 if atk.finisher else 1.0) * (2.0 if crit else 1.0)
			var level := 3 if atk.finisher else (2 if crit else (1 if tg.mass >= 2.0 else 0))
			# 敵人要一個一個解決：一拳只打一個目標，旁邊的不受影響；被打的也不會被推走，只原地頓一下，
			# 血打完才倒下飛出去。把敵人彈開、震開一圈這類效果留給之後的技能（KNOCKBACK 預設幾乎是零）
			if not tg.dead: _damage(tg, dmg, dir, KNOCKBACK, level)
		if atk.t >= atk.total: atk = null
	else:
		fix.foot_lock = true
	_keep_in_ring()
	# 平滑轉向
	hero_yaw = lerp_angle(hero_yaw, face_yaw, minf(1.0, dt * 18.0))
	hero.rotation.y = hero_yaw

# 主角不可以超出黃圈：看的是身體（髖部）實際的位置，不是站位點——出招時動作本身會往前踏，
# 飛踢甚至離站位點 60 公分。只要身體超出範圍，就把整個人往圈內推回來。
func _keep_in_ring() -> void:
	var hips: Vector3 = skel.global_transform * skel.get_bone_pose_position(hips_bone)
	var r := Vector2(hips.x, hips.z).length()
	var lim := attack_range - BODY_HALF
	if r > lim:
		var push := Vector3(hips.x, 0, hips.z) / r * (r - lim)
		hero.position -= push

func _process(delta: float) -> void:
	_watch_fps(delta)
	# 日夜循環：三分鐘一輪，光線、天空、燈火連續變化
	if day_run: day_t += delta / DAY_LEN
	street.set_time(day_t)
	# 音樂與環境音：倒下時音樂壓低；下雪時換成安靜的雪地聲、市集的人聲變小
	sfx.loop_volume("bgm", -15.0 if not dead else -30.0)
	sfx.loop_volume("market", lerpf(-21.0, -30.0, maxf(street.rain_now, street.snow_now)))
	sfx.loop_volume("snow", lerpf(-60.0, -14.0, street.snow_now))
	var dt := minf(delta, 1.0 / 30.0)
	time += dt
	# 收尾後的短暫慢動作
	var slow := 1.0
	if slowmo > 0.0 and hitstop <= 0.0:
		slowmo -= delta
		slow = 0.35
		dt *= slow
	# 命中停頓：動作定格一下
	if hitstop > 0.0:
		hitstop -= dt
		anim.speed_scale = 0.02
		# 定格時被打的敵人沿受力方向快速震動，像被打得發抖
		if last_hit != null and is_instance_valid(last_hit.node):
			(last_hit.node as Node3D).position = (last_hit.pos as Vector3) + last_dir * sin(time * 95.0) * 0.07
		_update_camera(dt)
		return
	_update_combat(dt)
	# 出招中依階段調整播放速度；待機是原速
	anim.speed_scale = slow * (HeroRig.IDLE_SPEED if atk == null else (HeroRig.RECOVER_SPEED if atk.hit else HeroRig.WIND_SPEED))
	_update_enemies(dt)
	_update_bodies(dt)
	enemies = enemies.filter(func(e): return not e.dead)
	if dead:
		dead_t -= dt
		if dead_t <= 0.0: get_tree().reload_current_scene()
	elif spawn_left > 0:
		# 這一波的敵人分批進場
		spawn_t -= dt
		if spawn_t <= 0.0:
			spawn_t = SPAWN_GAP
			spawn_left -= 1
			var roll := randf()
			spawn_enemy("tank" if roll < 0.1 and wave >= 2 else ("runner" if roll < 0.3 else "grunt"))
	elif enemies.is_empty():
		wave_delay -= dt
		if wave_delay <= 0.0:
			wave_delay = 2.0
			_start_wave()
	# 測試用的量測
	var hw: Vector3 = skel.global_transform * skel.get_bone_pose_position(hips_bone)
	dbg_far = maxf(dbg_far, Vector2(hw.x, hw.z).length())
	for e in enemies: dbg_push = maxf(dbg_push, (e.vel as Vector3).length())
	_update_camera(dt)
	hud_hp.max_value = max_hp
	hud_hp.value = hp
	# 效能：文字有變才重設（每格都設會讓文字重新排版）
	var top := "第 1 章　第 %d 波　擊倒 %d" % [wave, kills]
	if hud_top.text != top: hud_top.text = top
	var info := "版本 %d　%s・%s　每秒 %d 格　畫質：%s%s" % [HeroRig.BUILD, street.phase_name(), street.weather_name(), roundi(fps_now), Street.QUALITY_NAMES[street.quality], "（自動）" if auto_quality else ""]
	if hud_info.text != info: hud_info.text = info
	if banner_t > 0.0:
		banner_t -= dt
		if banner_t <= 0.0: hud_banner.text = ""

func _update_camera(dt: float) -> void:
	# 鏡頭晃動：沿出拳方向來回，幅度小、衰減快
	shake = maxf(0.0, minf(0.5, shake) - dt * 2.2)
	zoom_kick = maxf(0.0, zoom_kick - dt * 9.0)
	# 沿出拳方向來回晃，再加一點垂直方向，不用隨機抖動（隨機抖動容易讓人不舒服）
	var o := shake_dir * sin(time * 52.0) * shake + Vector2(-shake_dir.y, shake_dir.x) * sin(time * 37.0 + 1.3) * shake * 0.25
	if close_cam:
		cam.fov = 34.0
		cam.position = hero.position + Vector3(2.2, 1.7, 4.2)
		cam.look_at(hero.position + Vector3(0, 0.95, 0))
	else:
		# 鏡頭固定不跟隨，拉遠到整個攻擊圈和圈外等待的敵人都看得到；只有命中時的晃動和微微拉近
		cam.fov = 40.0 - zoom_kick
		cam.position = Vector3(o.x, 23.5, 19.0 + o.y)
		cam.look_at(Vector3(0, 0, 0.6))

# ---------------- 測試用：命令列參數 ----------------
# 例：godot --path . res://main.tscn -- --spawn=40 --god --shots=3,6　（--close 主角近照、--tod=dusk 指定時段）
func _test_args() -> void:
	var shots: Array = []
	var args := OS.get_cmdline_user_args()
	if not args.is_empty(): auto_quality = false   # 測試截圖時固定用高畫質
	for a in args:
		if a.begins_with("--lod="): EnemyRig.lod_bias = float(a.split("=")[1])
	for a in args:
		if a == "--god": god = true
		elif a == "--close": close_cam = true
		elif a.begins_with("--weather="): street.set_weather(a.split("=")[1], true)
		elif a.begins_with("--tod="):
			# 指定時段並停住時間：day／dusk／night，或直接給 0～1 的數字
			var v := a.split("=")[1]
			day_t = {"day": 0.15, "dusk": 0.48, "night": 0.72}.get(v, float(v))
			day_run = false
		elif a.begins_with("--spawn="):
			wave = 1
			wave_delay = 99999.0
			for i in int(a.split("=")[1]):
				var roll := randf()
				spawn_enemy("tank" if roll < 0.1 else ("runner" if roll < 0.3 else "grunt"))
		elif a.begins_with("--perf="):
			# 效能量測：跑這麼多秒後印出平均的繪製次數、三角形數、每格運算時間
			_perf(float(a.split("=")[1]))
		elif a.begins_with("--shots="):
			for s in a.split("=")[1].split(","): shots.append(float(s))
	if shots.is_empty(): return
	var i := 0
	for s in shots:
		await get_tree().create_timer(s - (shots[i - 1] if i > 0 else 0.0)).timeout
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("user://shot_%d.png" % i)
		print("截圖 %d 秒：敵人 %d 擊倒 %d 血量 %d｜主角身體離中心最遠 %.2f 公尺（上限 %.2f）｜敵人被推動的最大速度 %.2f｜敵人出拳 %d 次、打中主角 %d 次、出拳時超出攻擊距離最多 %.2f 公尺" % [s, enemies.size(), kills, hp, dbg_far, attack_range - BODY_HALF, dbg_push, dbg_punches, dbg_hurts, dbg_far_punch])
		i += 1
	get_tree().quit()

# 效能量測（測試用）：暖機 2 秒後取樣，印出平均值。這個雲端環境沒有顯示卡，畫面張數不準，
# 但繪製次數、三角形數、程式運算時間是準的，可以拿來比較修改前後
func _perf(sec: float) -> void:
	await get_tree().create_timer(2.0).timeout
	var n := 0
	var dc := 0.0
	var prim := 0.0
	var proc := 0.0
	var t0 := Time.get_ticks_msec()
	while Time.get_ticks_msec() - t0 < sec * 1000.0:
		await get_tree().process_frame
		n += 1
		dc += Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)
		prim += Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)
		proc += Performance.get_monitor(Performance.TIME_PROCESS)
	print("效能：%d 格｜敵人 %d｜繪製次數 %.0f｜三角形 %.0f 千｜每格運算 %.2f 毫秒｜物件數 %d｜節點數 %d" % [n, enemies.size(), dc / n, prim / n / 1000.0, proc / n * 1000.0, Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME), Performance.get_monitor(Performance.OBJECT_NODE_COUNT)])
	get_tree().quit()

# 開場的「點一下開始」：瀏覽器規定使用者點過畫面之前網頁不能出聲，直接開打的話前面一段會沒有聲音
# （使用者回報「剛開遊戲都沒聲音，按了下面的功能才有」）。所以網頁版先停在這個畫面，點了才開始。
# 倒下後重新開始、從動作檢視器回來都不會再出現；帶測試參數啟動也不會出現
static var started := false
func _start_gate() -> void:
	if started or not OS.has_feature("web") or not OS.get_cmdline_user_args().is_empty(): return
	var layer := CanvasLayer.new()
	layer.layer = 50
	layer.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(layer)
	var b := Button.new()
	b.set_anchors_preset(Control.PRESET_FULL_RECT)
	b.text = "點一下開始"
	b.add_theme_font_size_override("font_size", 56)
	b.add_theme_font_override("font", load("res://assets/fonts/NotoSansTC.ttf"))
	b.focus_mode = Control.FOCUS_NONE
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, 0, 0, 0.55)
	for st in ["normal", "hover", "pressed"]: b.add_theme_stylebox_override(st, sb)
	layer.add_child(b)
	# 暫停前先把鏡頭和光線擺好，背景才是正常的遊戲畫面
	street.set_time(day_t)
	_update_camera(1.0 / 30.0)
	anim.advance(0.0)          # 主角先擺出待機姿勢，不然暫停時是張開雙手的原始站姿
	get_tree().paused = true
	b.pressed.connect(func():
		started = true
		get_tree().paused = false
		layer.queue_free())
