extends Node3D
# RL Fight（Godot 4 版）第一階段：街景、主角招式、敵人、自動戰鬥、波次
# 單位：公尺。舊版 1 單位 ≈ 0.0234 公尺。

const U := 0.0234
const ARENA := 7.0            # 擂台半徑
const HERO_R := 0.42          # 主角碰撞半徑
const HERO_SCALE := 1.8       # 模型原始高度約 1，放大成 1.8 公尺

# 招式：[動作檔名, 命中格(30fps), 位移保留比例, 是否腳]
const MOVES := {
	"idle":  ["fighting_idle", -1, 1.0, false],
	"jab":   ["punching", 13, 1.0, false],
	"cross": ["cross_punch", 24, 1.0, false],
	"hook":  ["hook_punch", 27, 1.0, false],
	"upper": ["uppercut", 12, 1.0, false],
	"round": ["roundhouse_kick", 22, 0.5, true],
	"side":  ["side_kick", 14, 0.5, true],
	"fly":   ["flying_kick", 9, 0.3, true],
}
const COMBOS := [
	["jab", "cross", "hook", "upper", "round"],
	["hook", "jab", "upper", "cross", "side"],
	["cross", "upper", "hook", "jab", "round"],
	["jab", "hook", "upper", "cross", "side"],
]
# 敵人種類（數值沿用舊版，速度與體型換算成公尺）
const ENEMY_TYPES := {
	"grunt":  {"name": "小嘍囉", "hp": 5.0,  "speed": 58.0,  "dmg": 2.0, "r": 15.0, "color": Color("d9534f"), "mass": 1.0},
	"runner": {"name": "快腿仔", "hp": 4.0,  "speed": 112.0, "dmg": 2.0, "r": 13.0, "color": Color("f0883e"), "mass": 0.8},
	"tank":   {"name": "肉盾",   "hp": 24.0, "speed": 36.0,  "dmg": 6.0, "r": 24.0, "color": Color("8e5bd1"), "mass": 3.0},
}

var hero: Node3D
var hero_skel: Skeleton3D
var anim: AnimationPlayer
var cam: Camera3D
var sun: DirectionalLight3D
var hud_top: Label
var hud_hp: ProgressBar
var hud_banner: Label
var fx_root: Node3D

var enemies: Array = []
var bodies: Array = []
var hp := 100.0
var max_hp := 100.0
var base_dmg := 5.0
var rate := 0.3
var attack_range := 3.5
var punch_t := 0.0
var strike_n := 0
var combo_route: Array = []
var combo_step := 0
var attack = null            # 目前這一擊：{target, t, hit_at, dur, hit, move, finisher}
var post_impact := 0.0
var hero_yaw := 0.0
var face_yaw := 0.0
var hitstop := 0.0
var shake := 0.0
var shake_dir := Vector2.ZERO
var wave := 0
var kills := 0
var wave_delay := 1.0
var banner_t := 0.0
var time := 0.0
var god := false
var dead := false
var mats := {}
var close_cam := false

func _ready() -> void:
	_build_world()
	_build_hero()
	_build_hud()
	_test_args()

# ---------------- 街景 ----------------
func _tex(n: String) -> Texture2D:
	return load("res://assets/textures/%s.jpg" % n)

func _pbr(set_name: String, uv: float, tri := false, tint := Color.WHITE) -> StandardMaterial3D:
	var key := "%s|%s|%s" % [set_name, uv, tri]
	if mats.has(key): return mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_texture = _tex(set_name + "_color")
	m.albedo_color = tint
	m.normal_enabled = true
	m.normal_texture = _tex(set_name + "_normal")
	m.roughness_texture = _tex(set_name + "_rough")
	m.uv1_scale = Vector3(uv, uv, uv)
	m.uv1_triplanar = tri
	mats[key] = m
	return m

func _box(pos: Vector3, size: Vector3, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	add_child(mi)
	return mi

func _build_world() -> void:
	# 天空、環境光、色調
	var env := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.35, 0.5, 0.78)
	sm.sky_horizon_color = Color(0.72, 0.78, 0.86)
	sm.ground_horizon_color = Color(0.6, 0.62, 0.66)
	sm.ground_bottom_color = Color(0.25, 0.24, 0.26)
	sky.sky_material = sm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.55
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 0.85
	env.glow_enabled = true
	env.glow_intensity = 0.5
	env.fog_enabled = true
	env.fog_light_color = Color(0.7, 0.75, 0.82)
	env.fog_density = 0.0025
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	# 太陽（有影子）
	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52, -38, 0)
	sun.light_energy = 1.25
	sun.light_color = Color(1.0, 0.96, 0.9)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 45.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	add_child(sun)
	# 鏡頭：斜上方俯視
	cam = Camera3D.new()
	cam.fov = 38.0
	add_child(cam)
	cam.position = Vector3(0, 15.5, 12.5)
	cam.look_at(Vector3(0, 0, 0.6))
	# 地面
	var outer := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(90, 90)
	outer.mesh = pm
	outer.material_override = _pbr("asphalt", 20.0, false, Color(0.55, 0.55, 0.55))
	outer.position.y = -0.01
	add_child(outer)
	var ground := MeshInstance3D.new()
	var gm := PlaneMesh.new()
	gm.size = Vector2(37, 37)
	ground.mesh = gm
	ground.material_override = _pbr("groundbig", 1.0, false, Color(0.7, 0.7, 0.7))
	add_child(ground)
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
	ring.position.y = 0.01
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(ring)
	# 建築：北側一排、東西各一排
	var blocks := [
		[-470, -510, 300, 330, 180, "brick"], [-120, -530, 260, 420, 200, "plaster"], [210, -515, 280, 290, 180, "brick2"], [540, -500, 260, 380, 180, "brick"],
		[-590, -150, 200, 300, 260, "brick2"], [-580, 230, 200, 360, 300, "plaster"],
		[590, -170, 200, 340, 280, "plaster"], [580, 220, 200, 280, 260, "brick"],
	]
	for b in blocks:
		var h: float = b[3] * U
		_box(Vector3(b[0] * U, h * 0.5, b[1] * U), Vector3(b[2] * U, h, b[4] * U), _pbr(b[5], 0.3, true))
	fx_root = Node3D.new()
	add_child(fx_root)

# ---------------- 主角 ----------------
func _build_hero() -> void:
	hero = load("res://assets/hero/hero.glb").instantiate()
	hero.scale = Vector3.ONE * HERO_SCALE
	add_child(hero)
	hero_skel = hero.find_children("*", "Skeleton3D", true, false)[0]
	var lib := AnimationLibrary.new()
	for k in MOVES:
		var sc: Node = load("res://assets/anims/%s.fbx" % MOVES[k][0]).instantiate()
		var ap: AnimationPlayer = sc.find_children("*", "AnimationPlayer", true, false)[0]
		var an: Animation = ap.get_animation(ap.get_animation_list()[0]).duplicate()
		_trim_root_motion(an, MOVES[k][2])
		an.loop_mode = Animation.LOOP_LINEAR if k == "idle" else Animation.LOOP_NONE
		lib.add_animation(k, an)
		sc.free()
	anim = AnimationPlayer.new()
	hero.add_child(anim)
	anim.add_animation_library("", lib)
	anim.play("idle")

# 原地出招：髖部的水平位移只保留一部分，移動交給遊戲（衝刺）
func _trim_root_motion(an: Animation, keep: float) -> void:
	for t in an.get_track_count():
		if an.track_get_type(t) != Animation.TYPE_POSITION_3D: continue
		if not str(an.track_get_path(t)).ends_with(":Hips"): continue
		var n := an.track_get_key_count(t)
		if n == 0: continue
		var p0: Vector3 = an.track_get_key_value(t, 0)
		for i in n:
			var p: Vector3 = an.track_get_key_value(t, i)
			an.track_set_key_value(t, i, Vector3((p.x - p0.x) * keep, p.y, (p.z - p0.z) * keep))

# ---------------- 介面 ----------------
func _build_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var font: Font = load("res://assets/fonts/NotoSansTC.ttf")
	var theme := Theme.new()
	theme.default_font = font
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

func _banner(text: String, sec := 1.2) -> void:
	hud_banner.text = text
	banner_t = sec

# ---------------- 敵人 ----------------
func spawn_enemy(type: String, pos := Vector3.INF) -> void:
	var T: Dictionary = ENEMY_TYPES[type]
	var r: float = T.r * U
	var node := Node3D.new()
	var mat := StandardMaterial3D.new()
	mat.albedo_color = T.color
	mat.roughness = 0.8
	var body := MeshInstance3D.new()
	var cm := CapsuleMesh.new()
	cm.radius = r * 0.85
	cm.height = r * 3.6
	body.mesh = cm
	body.position.y = r * 1.8
	body.material_override = mat
	node.add_child(body)
	var head := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = r * 0.75
	sm.height = r * 1.5
	head.mesh = sm
	head.position.y = r * 4.1
	var hm := StandardMaterial3D.new()
	hm.albedo_color = Color("e0ac85")
	head.material_override = hm
	node.add_child(head)
	add_child(node)
	if pos == Vector3.INF:
		var a := randf() * TAU
		var d := ARENA + 2.0 + randf() * 2.0
		pos = Vector3(cos(a) * d, 0, sin(a) * d)
	node.position = pos
	var hp_scale := pow(1.18, wave - 1) if wave > 1 else 1.0
	enemies.append({"type": type, "T": T, "node": node, "mat": mat, "pos": pos, "vel": Vector3.ZERO, "r": r,
		"hp": T.hp * hp_scale, "speed": T.speed * U, "dmg": T.dmg, "mass": T.mass, "flash": 0.0, "stun": 0.0, "atk": 0.6 + randf() * 0.6, "ph": randf() * 10.0, "dead": false})

func _start_wave() -> void:
	wave += 1
	_banner("第 %d 波" % wave)
	var n := 8 + wave * 4
	for i in n:
		var roll := randf()
		spawn_enemy("tank" if roll < 0.1 and wave >= 2 else ("runner" if roll < 0.3 else "grunt"))

func _update_enemies(dt: float) -> void:
	var hp3 := hero.position
	for e in enemies:
		var pos: Vector3 = e.pos
		e.flash = maxf(0.0, e.flash - dt)
		e.stun = maxf(0.0, e.stun - dt)
		# 擊退速度衰減
		pos += e.vel * dt
		e.vel *= maxf(0.0, 1.0 - dt * 6.0)
		var to := hp3 - pos
		to.y = 0
		var d := to.length()
		var reach: float = e.r + HERO_R + 0.1
		if e.stun <= 0.0 and e.vel.length() < 1.0:
			if d > reach:
				pos += to / d * e.speed * dt
			else:
				e.atk -= dt
				if e.atk <= 0.0:
					e.atk = 1.2
					_hurt(e.dmg)
		e.pos = pos
		var node: Node3D = e.node
		node.position = pos + Vector3(0, absf(sin(time * 9.0 + e.ph)) * 0.04 if e.stun <= 0.0 else 0.0, 0)
		if d > 0.01: node.rotation.y = atan2(to.x, to.z)
		node.rotation.x = -0.35 if e.stun > 0.0 else 0.0
		var mat: StandardMaterial3D = e.mat
		mat.albedo_color = (e.T.color as Color).lerp(Color.WHITE, 0.6) if e.flash > 0.0 else e.T.color
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
	shake = maxf(shake, 0.06)
	if hp <= 0.0:
		hp = 0.0
		dead = true
		_banner("倒下了…", 99.0)

func _damage(e: Dictionary, amount: float, dir: Vector3, kb: float, crit: bool) -> void:
	e.hp -= amount
	e.flash = 0.08
	e.stun = 0.35 if crit else 0.2
	e.vel += dir * kb / e.mass
	_spark(e.pos + Vector3(0, e.r * 2.6, 0) - dir * e.r, crit)
	var heavy: bool = e.mass >= 2.0
	hitstop = maxf(hitstop, 0.07 if crit else (0.045 if heavy else 0.03))
	shake = maxf(shake, 0.12 if crit else (0.05 if heavy else 0.0))
	shake_dir = Vector2(dir.x, dir.z)
	if e.hp <= 0.0 and not e.dead:
		e.dead = true
		kills += 1
		# 被揍飛的身體
		bodies.append({"node": e.node, "vel": dir * (12.0 + randf() * 6.0) / sqrt(e.mass) + Vector3(0, 6.0 + randf() * 3.0, 0), "life": 2.0, "spin": randf_range(-10.0, 10.0)})

func _update_bodies(dt: float) -> void:
	for b in bodies:
		var n: Node3D = b.node
		b.vel.y -= 22.0 * dt
		n.position += b.vel * dt
		n.rotation.x -= dt * 9.0 if n.position.y > 0.05 else 0.0
		if n.position.y <= 0.0:
			n.position.y = 0.0
			b.vel = Vector3(b.vel.x * 0.5, 0.0, b.vel.z * 0.5)
			n.rotation.x = -PI / 2
		b.life -= dt
		if b.life < 0.4: n.scale = Vector3.ONE * maxf(0.01, b.life / 0.4)
		if b.life <= 0.0: n.queue_free()
	bodies = bodies.filter(func(b): return b.life > 0.0)

# 命中火花：普通命中一小朵，暴擊比較大
func _spark(pos: Vector3, crit: bool) -> void:
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.5
	sm.height = 1.0
	mi.mesh = sm
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = Color(1.0, 0.85, 0.35) if crit else Color(1.0, 0.95, 0.8)
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = pos
	var s := 0.55 if crit else 0.3
	mi.scale = Vector3.ONE * s * 0.4
	fx_root.add_child(mi)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(mi, "scale", Vector3.ONE * s, 0.12)
	tw.tween_property(m, "albedo_color:a", 0.0, 0.12)
	tw.chain().tween_callback(mi.queue_free)

# ---------------- 自動戰鬥 ----------------
func _zone_enemies() -> Array:
	var out: Array = []
	for e in enemies:
		if e.dead: continue
		var dc := Vector2(e.pos.x, e.pos.z).length() - (e.r as float)
		var dh := (e.pos as Vector3).distance_to(hero.position) - (e.r as float)
		if dc <= attack_range or dh < HERO_R + 0.9: out.append(e)
	out.sort_custom(func(a, b): return (a.pos as Vector3).distance_squared_to(hero.position) < (b.pos as Vector3).distance_squared_to(hero.position))
	return out

func _next_move(finisher: bool) -> String:
	if finisher: return "fly"
	if combo_route.is_empty() or combo_step >= combo_route.size():
		combo_route = COMBOS.pick_random()
		combo_step = 0
	combo_step += 1
	return combo_route[combo_step - 1]

func _launch(target: Dictionary, finisher: bool) -> void:
	var move := _next_move(finisher)
	var dur := minf(0.45, rate * 1.4) if finisher else minf(0.32, rate * 0.9)
	var hit_at := dur * (0.6 if finisher else 0.5)
	attack = {"target": target, "t": 0.0, "hit_at": hit_at, "dur": dur, "hit": false, "move": move, "finisher": finisher}
	# 讓動作的「命中格」剛好對上判定時間：從命中前一小段開始播
	var ti: float = MOVES[move][1] / 30.0
	var t0 := maxf(0.0, ti - maxf(0.12, hit_at) * 1.25)
	anim.play(move, 0.1, maxf(1.0, (ti - t0) / maxf(0.05, hit_at)))
	anim.seek(t0, true)
	post_impact = -1.0

func _update_combat(dt: float) -> void:
	punch_t -= dt
	if attack == null and punch_t <= 0.0 and not dead:
		var zone := _zone_enemies()
		if not zone.is_empty():
			strike_n += 1
			punch_t = rate
			if strike_n % 6 == 0:
				_launch(zone[zone.size() - 1], true)
				punch_t = rate * 1.6
			else:
				_launch(zone[0], false)
	if attack != null:
		var tg: Dictionary = attack.target
		var tp: Vector3 = tg.pos
		var to := tp - hero.position
		to.y = 0
		var d := maxf(0.001, to.length())
		face_yaw = atan2(to.x, to.z)
		if not attack.hit:
			# 衝刺：在命中前移動到目標面前（不出圈）
			var stand: float = tg.r + HERO_R + 0.15
			var goal := tp - to / d * stand
			var gl := Vector2(goal.x, goal.z).length()
			if gl > attack_range: goal *= attack_range / gl
			var left := maxf(dt, attack.hit_at - attack.t)
			var mv := goal - hero.position
			mv.y = 0
			if mv.length() > 0.01: hero.position += mv * minf(1.0, dt / left)
		attack.t += dt
		if not attack.hit and attack.t >= attack.hit_at:
			attack.hit = true
			post_impact = 0.0
			var crit := randf() < 0.12
			var dir := to / d
			var dmg := base_dmg * (3.0 if attack.finisher else 1.0) * (2.0 if crit else 1.0)
			if not tg.dead: _damage(tg, dmg, dir, 14.0 if attack.finisher else 6.0, crit or attack.finisher)
			if attack.finisher:
				# 收尾飛踢：震開周圍的敵人
				for o in enemies:
					if o.dead or o == tg: continue
					var dv: Vector3 = o.pos - tp
					dv.y = 0
					if dv.length() < 2.0 + o.r: _damage(o, dmg, dv.normalized(), 12.0, false)
				shake = maxf(shake, 0.2)
			anim.speed_scale = 1.2
		if attack.t >= attack.dur: attack = null
	# 命中後一小段時間沒有下一拳，就回到備戰姿勢
	if post_impact >= 0.0:
		post_impact += dt
		if attack == null and post_impact > 0.45:
			post_impact = -1.0
			anim.speed_scale = 1.0
			anim.play("idle", 0.25)
	# 平滑轉向
	hero_yaw = lerp_angle(hero_yaw, face_yaw, minf(1.0, dt * 30.0))
	hero.rotation.y = hero_yaw

func _process(delta: float) -> void:
	var dt := minf(delta, 1.0 / 30.0)
	time += dt
	# 命中停頓：整個畫面定格一下
	if hitstop > 0.0:
		hitstop -= dt
		anim.speed_scale = 0.0001 if anim.speed_scale > 0.001 else anim.speed_scale
		_update_camera(dt)
		return
	if attack != null and attack.hit and anim.speed_scale < 0.01: anim.speed_scale = 1.2
	_update_combat(dt)
	_update_enemies(dt)
	_update_bodies(dt)
	enemies = enemies.filter(func(e): return not e.dead)
	if enemies.is_empty() and not dead:
		wave_delay -= dt
		if wave_delay <= 0.0:
			wave_delay = 2.0
			_start_wave()
	_update_camera(dt)
	hud_hp.max_value = max_hp
	hud_hp.value = hp
	hud_top.text = "第 1 章　第 %d 波　擊倒 %d" % [wave, kills]
	if banner_t > 0.0:
		banner_t -= dt
		if banner_t <= 0.0: hud_banner.text = ""

func _update_camera(dt: float) -> void:
	# 鏡頭晃動：沿出拳方向來回，幅度小、衰減快
	shake = maxf(0.0, minf(0.25, shake) - dt * 1.4)
	var o := shake_dir * sin(time * 46.0) * shake
	if close_cam:
		cam.position = hero.position + Vector3(1.6, 1.9, 3.2)
		cam.look_at(hero.position + Vector3(0, 0.9, 0))
	else:
		cam.position = Vector3(o.x, 15.5, 12.5 + o.y)

# ---------------- 測試用：命令列參數 ----------------
# 例：godot --path . -- --spawn=60 --god --shots=2,5,8
func _test_args() -> void:
	var shots: Array = []
	for a in OS.get_cmdline_user_args():
		if a == "--god": god = true
		elif a == "--close": close_cam = true
		elif a.begins_with("--spawn="):
			wave = 1
			wave_delay = 99999.0
			for i in int(a.split("=")[1]):
				var roll := randf()
				spawn_enemy("tank" if roll < 0.1 else ("runner" if roll < 0.3 else "grunt"))
		elif a.begins_with("--shots="):
			for s in a.split("=")[1].split(","): shots.append(float(s))
	if shots.is_empty(): return
	var i := 0
	for s in shots:
		await get_tree().create_timer(s - (shots[i - 1] if i > 0 else 0.0)).timeout
		await RenderingServer.frame_post_draw
		var img := get_viewport().get_texture().get_image()
		img.save_png("user://shot_%d.png" % i)
		print("截圖 %d 秒：敵人 %d 擊倒 %d 血量 %d 繪製次數 %d 每秒畫面 %d" % [s, enemies.size(), kills, hp, RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME), Engine.get_frames_per_second()])
		i += 1
	get_tree().quit()
