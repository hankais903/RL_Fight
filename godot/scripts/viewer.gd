extends Node3D
# 動作檢視器：只有主角和乾淨的地板，用來單獨檢查、調整動作。不跑任何遊戲邏輯。
# 操作：下方按鈕選招式；拖曳畫面轉視角；可切慢動作、暫停、逐格。

var hero: Node3D
var skel: Skeleton3D
var anim: AnimationPlayer
var cam: Camera3D
var info: Label
var cur := "idle"
var cam_yaw := 0.5       # 視角水平角度（0 = 正面）
var cam_pitch := 0.12
var cam_dist := 5.8
var speed := 1.0
var paused := false
var loop_move := true
var dragging := false
var combo_mode := ""     # "" 單招、"old" 舊播法、"new" 新播法
var combo_i := 0
var combo_t := 0.0
var combo_rest := 0.0
var hit_flash := 0.0
var hit_done := false
var we: WorldEnvironment
var studio_env: Environment
var studio: Node3D            # 攝影棚（灰背景、格線地板）
var street: Plaza = null     # 街景（要用時才建立）
var far_view := false         # 遠景：用遊戲的俯視鏡頭看整個場景
var auto_quality := true      # 每秒畫面數太低時自動降畫質
var fps_t := 0.0
var fps_n := 0
var fps_now := 60.0
var warmup := 2.5
var sky_shot := false
# ---- 敵人檢視 ----
var hero_fix: BodyFix
var enemy = null               # 目前檢視的敵人（EnemyRig.build() 的結果）
var enemy_rigs := {}           # 種類 → 建好的敵人（第一次切過去才建立）
var hero_anim: AnimationPlayer
var subject: Node3D            # 目前在看的角色（主角或敵人）
var enemy_cur := "walk"
var fall_cam := Vector3(0, 0.95, 0)
var enemy_walk := false        # 敵人是否真的往前走（看腳有沒有滑）
var foot_low := [0.0, 0.0]     # 兩隻腳鞋底離地的高度（公分）；要在骨架更新完（腳的修正套用後）才量，不然讀到的是修正前的
var foot_dbg := false          # 顯示腳的量測數字
var tune: TunePanel
var test_voff := -0.95
var test_bias := -1.0
var ref: Node3D = null   # 對照用：動作檔原本的骨架模型

func _ready() -> void:
	studio = Node3D.new()
	add_child(studio)
	var env := Environment.new()
	studio_env = env
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.36, 0.39, 0.44)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.75, 0.78, 0.85)
	env.ambient_light_energy = 0.75
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	we = WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, -35, 0)
	sun.light_energy = 1.1
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 14.0
	studio.add_child(sun)
	# 地板：淺灰，上面畫一公尺的格線，看得出有沒有滑步
	var floor_mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(16, 16)
	floor_mi.mesh = pm
	var fm := StandardMaterial3D.new()
	fm.albedo_texture = _grid_tex()
	fm.albedo_color = Color(0.5, 0.5, 0.52)
	fm.uv1_scale = Vector3(16, 16, 1)
	fm.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	fm.roughness = 0.95
	floor_mi.material_override = fm
	studio.add_child(floor_mi)
	cam = Camera3D.new()
	cam.fov = 34.0
	add_child(cam)
	HeroRig.smooth_normals = OS.get_cmdline_user_args().has("--smooth")
	var h := HeroRig.build()
	hero = h.node
	subject = hero
	hero_fix = h.fix
	h.skel.skeleton_updated.connect(_foot_sample.bind(h))
	skel = h.skel
	anim = h.anim
	hero_anim = anim
	add_child(hero)
	anim.animation_finished.connect(_on_finished)
	_build_ui()
	_play("idle")
	_scene("day")   # 一打開就是街景白天；攝影棚改成要按按鈕才切過去
	_test_args()

func _grid_tex() -> ImageTexture:
	var img := Image.create(64, 64, false, Image.FORMAT_RGB8)
	img.fill(Color(0.62, 0.63, 0.66))
	for i in 64:
		for w in 2:
			img.set_pixel(i, w, Color(0.48, 0.49, 0.53))
			img.set_pixel(w, i, Color(0.48, 0.49, 0.53))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

func _build_ui() -> void:
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
	TunePanel.load_saved()
	tune = TunePanel.new()
	tune.offset_bottom = -450   # 疊在按鈕區上方
	root.add_child(tune)
	info = Label.new()
	info.position = Vector2(20, 14)
	info.add_theme_color_override("font_outline_color", Color.BLACK)
	info.add_theme_constant_override("outline_size", 8)
	root.add_child(info)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	box.grow_vertical = Control.GROW_DIRECTION_BEGIN
	box.offset_left = 12
	box.offset_right = -12
	box.offset_bottom = -12
	root.add_child(box)
	var grid := GridContainer.new()
	grid.columns = 4
	box.add_child(grid)
	for k in HeroRig.MOVES:
		var b := Button.new()
		b.text = HeroRig.MOVES[k][3]
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size.y = 70
		b.pressed.connect(_play.bind(k))
		grid.add_child(b)
	var row := HBoxContainer.new()
	box.add_child(row)
	var row3 := HBoxContainer.new()
	box.add_child(row3)
	for item in [["攝影棚", _scene.bind("")], ["白天", _scene.bind("day")], ["黃昏", _scene.bind("dusk")], ["夜晚", _scene.bind("night")], ["遠景", _toggle_far]]:
		var b := Button.new()
		b.text = item[0]
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size.y = 70
		b.pressed.connect(item[1])
		row3.add_child(b)
	var row5 := HBoxContainer.new()
	box.add_child(row5)
	var row6 := HBoxContainer.new()
	box.add_child(row6)
	for item in [["主角", _subject.bind(false), row5], ["小嘍囉", _enemy_kind.bind("grunt"), row5], ["快腿仔", _enemy_kind.bind("runner"), row5], ["肉盾", _enemy_kind.bind("tank"), row5], ["敵被打", _enemy_anim.bind("hit"), row6], ["敵出拳", _enemy_anim.bind("punch"), row6], ["敵倒下", _enemy_anim.bind("fall"), row6], ["腳貼地", _toggle_ik, row6]]:
		var b := Button.new()
		b.text = item[0]
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size.y = 70
		b.pressed.connect(item[1])
		(item[2] as HBoxContainer).add_child(b)
	var row4 := HBoxContainer.new()
	box.add_child(row4)
	for item in [["晴天", _weather.bind("clear")], ["下雨", _weather.bind("rain")], ["雨後", _weather.bind("after")], ["下雪", _weather.bind("snow")], ["積雪", _weather.bind("snowed")]]:
		var b := Button.new()
		b.text = item[0]
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size.y = 70
		b.pressed.connect(item[1])
		row4.add_child(b)
	var row2 := HBoxContainer.new()
	box.add_child(row2)
	for item in [["連段：舊播法", _combo.bind("old")], ["連段：新播法", _combo.bind("new")], ["速度", _toggle_tune], ["畫質", _cycle_quality], ["回遊戲", _back_to_game], ["重整", HeroRig.reload_page.bind(get_tree())]]:
		var b := Button.new()
		b.text = item[0]
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size.y = 70
		b.pressed.connect(item[1])
		row2.add_child(b)
	for item in [["慢動作", _toggle_slow], ["暫停", _toggle_pause], ["下一格", _step], ["正面", _view.bind(0.0)], ["側面", _view.bind(PI / 2)]]:
		var b := Button.new()
		b.text = item[0]
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size.y = 70
		b.pressed.connect(item[1])
		row.add_child(b)

# 切換背景：空字串 = 攝影棚；day／dusk／night = 街景的三個時段
func _scene(tod: String) -> void:
	if tod == "":
		studio.visible = true
		if street != null:
			street.visible = false
			(street.get_meta("vignette_layer") as CanvasLayer).visible = false
		we.environment = studio_env
		far_view = false
		return
	if street == null:
		street = Plaza.new()
		add_child(street)
		street.add_character(hero)
	street.visible = true
	(street.get_meta("vignette_layer") as CanvasLayer).visible = true
	street.set_tod(tod)
	studio.visible = false
	we.environment = street.env

func _foot_sample(who: Dictionary) -> void:
	if (who.node as Node3D) != subject: return
	var f: BodyFix = who.fix
	var sk2: Skeleton3D = who.skel
	for i in 2:
		var lg: Dictionary = f.legs[i]
		var fp := sk2.get_bone_global_pose(lg.foot)
		var fb := fp.basis.orthonormalized()
		foot_low[i] = minf((fp.origin + fb * (lg.ball_local as Vector3)).y, (fp.origin + fb * (lg.heel_local as Vector3)).y) * subject.scale.y * 100.0

# 切換檢視的對象：主角或敵人
func _subject(want_enemy: bool) -> void:
	if want_enemy and enemy == null: _build_enemy("grunt")
	hero.visible = not want_enemy
	for k in enemy_rigs: (enemy_rigs[k].node as Node3D).visible = want_enemy and enemy_rigs[k] == enemy
	subject = enemy.node if want_enemy else hero
	anim = enemy.anim if want_enemy else hero_anim
	combo_mode = ""
	paused = false

func _build_enemy(kind: String) -> void:
	if not enemy_rigs.has(kind):
		var e := EnemyRig.build(kind)
		add_child(e.node)
		if street != null: street.add_character(e.node, 0.5, false)
		(e.anim as AnimationPlayer).animation_finished.connect(_enemy_finished)
		(e.skel as Skeleton3D).skeleton_updated.connect(_foot_sample.bind(e))
		enemy_rigs[kind] = e
	enemy = enemy_rigs[kind]

# 換一種敵人來看，並播它移動的動作（小嘍囉走路、快腿仔跑步）
func _enemy_kind(kind: String) -> void:
	_build_enemy(kind)
	_enemy_anim(enemy.move)

# 敵人的動作：走路會真的往前走（來回一段路，鏡頭跟著），這樣才看得出腳有沒有在地上滑
func _enemy_anim(k: String) -> void:
	_subject(true)
	if k == "walk" or k == "run" or k == "walk_tank": k = enemy.move
	enemy_walk = k == enemy.move
	enemy_cur = k
	(enemy.fix as BodyFix).foot_ik = k != "fall"     # 躺下時腳貼地要關掉
	(enemy.node as Node3D).position = Vector3.ZERO
	anim.play(k, 0.15)

func _enemy_finished(_n: StringName) -> void:
	# 被打的動作播完：停一下再重播
	await get_tree().create_timer((1.2 if enemy_cur == "fall" else 0.5) / maxf(0.1, speed)).timeout
	if subject != hero and not enemy_walk: anim.play(enemy_cur, 0.0 if enemy_cur == "fall" else 0.15)

# 腳貼地（反向運動）開關：關掉就是動作檔原始的樣子，可以對照
func _toggle_ik() -> void:
	var f: BodyFix = enemy.fix if subject != hero else hero_fix
	f.foot_ik = not f.foot_ik
	foot_dbg = true

func _toggle_tune() -> void:
	tune.toggle()

func _back_to_game() -> void:
	get_tree().change_scene_to_file("res://main.tscn")

# 手動切換畫質（高 → 中 → 低 → 高），切過之後就不再自動調整
func _cycle_quality() -> void:
	if street == null: return
	auto_quality = false
	street.set_quality((street.quality + 2) % 3)

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
	if auto_quality and street != null and street.visible and fps_now < 40.0 and street.quality > 0:
		street.set_quality(street.quality - 1)
		warmup = 1.0

# 切換天氣（要在街景裡才看得到；在攝影棚按的話會先切到白天的街景）
func _weather(w: String) -> void:
	if street == null or not street.visible: _scene("day")
	street.set_weather(w)

func _toggle_far() -> void:
	if street == null or not street.visible: _scene("day")
	far_view = not far_view

func _combo(mode: String) -> void:
	_subject(false)
	combo_mode = mode
	combo_i = 0
	combo_t = 0.0
	combo_rest = 0.0
	paused = false
	_combo_next()

# 連段裡出下一招
func _combo_next() -> void:
	var k: String = HeroRig.COMBO[combo_i % HeroRig.COMBO.size()]
	combo_i += 1
	cur = k
	hit_done = false
	var ti: float = HeroRig.MOVES[k][1] / 30.0
	if combo_mode == "old":
		# 舊播法（遊戲原本的做法）：只從命中前 0.17 秒開始播、加速，0.3 秒後就被下一拳切掉
		var hit_at := 0.135
		var t0 := maxf(0.0, ti - maxf(0.12, hit_at) * 1.25)
		anim.play(k, 0.1, maxf(1.0, (ti - t0) / hit_at))
		anim.seek(t0, true)
		combo_t = 0.3
	else:
		# 新播法：從蓄力開始播，打中後收到一半才接下一招；動作完整但加快（速度在 _process 依階段設定）
		anim.play(k, 0.07)
		anim.seek(HeroRig.MOVES[k][4] / 30.0, true)

func _update_combo(dt: float) -> void:
	if combo_mode == "" or paused: return
	var d := dt * speed
	var an := anim.current_animation
	if combo_rest > 0.0:
		combo_rest -= d
		if combo_rest <= 0.0: _combo_next()
		return
	if an == "" or not HeroRig.MOVES.has(an) or an == "idle": return
	var pos := anim.current_animation_position
	var ti: float = HeroRig.MOVES[an][1] / 30.0
	if not hit_done and pos >= ti:
		hit_done = true
		hit_flash = 0.12
	var last := combo_i % HeroRig.COMBO.size() == 0
	var go := false
	if combo_mode == "old":
		combo_t -= d
		go = combo_t <= 0.0
	else:
		go = pos >= HeroRig.MOVES[an][5] / 30.0
	if go:
		if last:
			# 一套打完：回備戰姿勢休息一下再重來
			anim.play("idle", 0.3)
			combo_rest = 1.2
		else: _combo_next()

func _play(k: String) -> void:
	_subject(false)
	combo_mode = ""
	cur = k
	paused = false
	anim.play(k, 0.15)

func _on_finished(_n: StringName) -> void:
	# 招式播完：回到待機一下，再重播同一招，方便反覆看
	if cur == "idle" or combo_mode != "" or subject != hero: return
	anim.play("idle", 0.25)
	if loop_move:
		await get_tree().create_timer(0.7 / maxf(0.1, speed)).timeout
		if anim.current_animation == "idle" and cur != "idle": anim.play(cur, 0.15)

func _toggle_slow() -> void: speed = 0.25 if speed > 0.5 else 1.0
func _toggle_pause() -> void: paused = not paused
func _step() -> void:
	paused = true
	anim.speed_scale = 1.0
	anim.advance(1.0 / 30.0)
func _view(y: float) -> void: cam_yaw = y

func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventMouseButton and ev.button_index == MOUSE_BUTTON_LEFT: dragging = ev.pressed
	elif ev is InputEventMouseMotion and dragging:
		cam_yaw -= ev.relative.x * 0.008
		cam_pitch = clampf(cam_pitch + ev.relative.y * 0.005, 0.0, 1.2)
	elif ev is InputEventScreenDrag:
		cam_yaw -= ev.relative.x * 0.008
		cam_pitch = clampf(cam_pitch + ev.relative.y * 0.005, 0.0, 1.2)

func _process(_dt: float) -> void:
	_watch_fps(_dt)
	_update_combo(_dt)
	hit_flash = maxf(0.0, hit_flash - _dt)
	anim.speed_scale = 0.0 if paused else speed
	if combo_mode == "new" and not paused and HeroRig.MOVES.has(anim.current_animation) and anim.current_animation != "idle":
		# 新播法：蓄力段和收招段各有自己的速度（跟遊戲一致）
		anim.speed_scale = speed * (HeroRig.WIND_SPEED if anim.current_animation_position < HeroRig.MOVES[anim.current_animation][1] / 30.0 else HeroRig.RECOVER_SPEED)
	# 鏡頭繞著主角：永遠對準身體中段，整個人都在畫面裡
	# 敵人走路：照動作本身的速度往前走，走 5 公尺後回到起點
	if subject != hero and enemy_walk and not paused:
		var en: Node3D = enemy.node
		en.position.z += (enemy.move_speed as float) * speed * _dt
		if en.position.z > 2.5: en.position.z = -2.5
	var target := subject.position + Vector3(0, 0.95, 0)
	# 敵人倒下時身體會往後退一大段：鏡頭改成跟著髖部走，高度壓低一點
	if subject != hero and enemy_cur == "fall":
		var esk: Skeleton3D = enemy.skel
		var hw: Vector3 = esk.global_transform * esk.get_bone_pose_position(esk.find_bone("Hips"))
		fall_cam = fall_cam.lerp(Vector3(hw.x * 0.6, 0.7, hw.z * 0.6), minf(1.0, _dt * 6.0))
		target = fall_cam
	var dir := Vector3(sin(cam_yaw) * cos(cam_pitch), sin(cam_pitch), cos(cam_yaw) * cos(cam_pitch))
	if sky_shot:
		# 測試用：站在場地南邊往北仰望，檢查天空球和遠景
		cam.fov = 60.0
		cam.v_offset = 0.0
		cam.position = Vector3(0, 2.0, 9.0)
		cam.look_at(Vector3(0, 9.0, -12.0))
	elif far_view:
		cam.fov = 38.0
		cam.v_offset = 0.0
		cam.position = Vector3(0, 15.5, 12.5)
		cam.look_at(Vector3(0, 0, 0.6))
	else:
		cam.fov = 34.0
		cam.position = target + dir * cam_dist
		cam.look_at(target)
		cam.v_offset = test_voff   # 構圖往上移，腳不會被下方按鈕擋住
	var an := anim.current_animation
	if an != "":
		var label: String = HeroRig.MOVES[an][3] if HeroRig.MOVES.has(an) else an
		if subject != hero: label = "敵人・" + (EnemyRig.ANIMS[an][1] if EnemyRig.ANIMS.has(an) else an)
		info.text = "%s　第 %d 格%s" % [label, int(anim.current_animation_position * 30.0), "　慢動作" if speed < 0.5 else ""]
		# 腳的量測：兩隻腳的鞋底離地多高（負的就是穿進地面），以及腳貼地有沒有開
		if subject != hero or foot_dbg:
			var f: BodyFix = enemy.fix if subject != hero else hero_fix
			var txt := "\n腳貼地：%s　左腳離地 %.1f 公分　右腳 %.1f 公分" % ["開" if f.foot_ik else "關（原始動作）", foot_low[0], foot_low[1]]
			info.text += txt
		if street != null and street.visible: info.text += "\n每秒 %d 格　畫質：%s%s" % [roundi(fps_now), Street.QUALITY_NAMES[street.quality], "（自動）" if auto_quality else ""]
		if combo_mode != "": info.text = ("舊播法　" if combo_mode == "old" else "新播法　") + info.text + ("　● 命中" if hit_flash > 0.0 else "")

# ---------------- 測試用 ----------------
# --sheet：每個招式在命中格各拍正面、側面；--ref：旁邊放動作檔原本的骨架模型對照
func _test_args() -> void:
	var args := OS.get_cmdline_user_args()
	if not args.is_empty(): auto_quality = false   # 測試截圖時固定用高畫質
	for a in args:
		if a.begins_with("--quality=") and street != null: street.set_quality(int(a.split("=")[1]))
	if args.has("--ref"): _add_ref("idle")
	# --combo=new --shots=12：連段模式下每 0.1 秒拍一張，共 12 張
	for a in args:
		if a.begins_with("--combo="): _combo(a.split("=")[1])
		elif a == "--nopbr": EnemyRig.use_pbr = false
		elif a.begins_with("--kind="): _build_enemy(a.split("=")[1])
		elif a.begins_with("--enemy="): _enemy_anim(a.split("=")[1])
		elif a == "--noik": _toggle_ik()
	# --dist=3：鏡頭拉近（檢查材質細節用）；--nonormal、--bias=數值：測試用的開關
	for a in args:
		if a.begins_with("--dist="):
			cam_dist = float(a.split("=")[1])
			test_voff = -0.15
		elif a == "--nonormal":
			for mi in hero.find_children("*", "MeshInstance3D", true, false):
				for i in (mi as MeshInstance3D).mesh.get_surface_count():
					((mi as MeshInstance3D).get_surface_override_material(i) as BaseMaterial3D).normal_enabled = false
		elif a.begins_with("--bias="): test_bias = float(a.split("=")[1])
		elif a.begins_with("--heropos="):
			var pp := a.split("=")[1].split(",")
			hero.position = Vector3(float(pp[0]), 0, float(pp[1]))
	for a in args:
		if a.begins_with("--weather="):
			_scene("day")
			street.set_weather(a.split("=")[1], true)
	# --light：三個時段各拍近景（兩個角度）與遠景
	if args.has("--light"):
		var n := 0
		for t in ["day", "dusk", "night"]:
			_scene(t)
			if test_bias >= 0.0:
				street.sun.shadow_normal_bias = test_bias
				for f in street.floods: (f[0] as SpotLight3D).shadow_normal_bias = test_bias
			for v in [[0.5, false], [2.6, false], [0.0, true], [4.2, false, 0.0], [0.0, false, 0.0, true]]:
				cam_yaw = v[0]
				far_view = v[1]
				cam_pitch = v[2] if v.size() > 2 else 0.12
				sky_shot = v.size() > 3
				for k in 4: await get_tree().process_frame
				await RenderingServer.frame_post_draw
				get_viewport().get_texture().get_image().save_png("user://light_%d.png" % n)
				n += 1
		print("光線圖完成 ", n)
		get_tree().quit()
		return
	for a in args:
		if a.begins_with("--shots="):
			cam_yaw = 1.1
			for i in int(a.split("=")[1]):
				await get_tree().create_timer(0.1).timeout
				await RenderingServer.frame_post_draw
				get_viewport().get_texture().get_image().save_png("user://seq_%02d.png" % i)
				print("序列 %d：%s" % [i, info.text])
			get_tree().quit()
			return
	if not args.has("--sheet"): return
	_scene("")   # 動作圖表在攝影棚拍，背景乾淨比較好看姿勢
	loop_move = false
	paused = true
	var i := 0
	for k in HeroRig.MOVES:
		var f: int = HeroRig.MOVES[k][1]
		anim.play(k, 0.0)
		anim.seek(maxf(0.0, f) / 30.0 if f >= 0 else 0.5, true)
		if ref != null:
			var rap: AnimationPlayer = ref.get_meta("ap")
			_set_ref(k)
			rap.seek(maxf(0.0, f) / 30.0 if f >= 0 else 0.5, true)
		for v in [0.0, PI / 2]:
			cam_yaw = v
			await get_tree().process_frame
			await get_tree().process_frame
			await RenderingServer.frame_post_draw
			get_viewport().get_texture().get_image().save_png("user://sheet_%d_%s.png" % [i, "f" if v == 0.0 else "s"])
		i += 1
	print("動作圖表完成 ", i)
	get_tree().quit()

func _add_ref(k: String) -> void:
	_set_ref(k)

func _set_ref(k: String) -> void:
	if ref != null: ref.free()
	ref = load("res://assets/anims/%s.fbx" % HeroRig.MOVES[k][0]).instantiate()
	add_child(ref)
	var rs: Skeleton3D = ref.find_children("*", "Skeleton3D", true, false)[0]
	# 動作檔的骨架比例比較大：縮到跟主角一樣高，站在旁邊
	var hh: float = rs.get_bone_global_rest(rs.find_bone("Head")).origin.y
	var mh: float = skel.get_bone_global_rest(skel.find_bone("Head")).origin.y * HeroRig.HERO_SCALE
	ref.scale = Vector3.ONE * (mh / maxf(0.01, hh))
	ref.position = Vector3(1.3, 0, 0)
	hero.position = Vector3(-0.5, 0, 0)
	var ap: AnimationPlayer = ref.find_children("*", "AnimationPlayer", true, false)[0]
	ap.play(ap.get_animation_list()[0])
	ap.speed_scale = 0.0
	ref.set_meta("ap", ap)
