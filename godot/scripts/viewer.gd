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
var cam_dist := 5.4
var speed := 1.0
var paused := false
var loop_move := true
var dragging := false
var ref: Node3D = null   # 對照用：動作檔原本的骨架模型

func _ready() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.36, 0.39, 0.44)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.75, 0.78, 0.85)
	env.ambient_light_energy = 0.75
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, -35, 0)
	sun.light_energy = 1.1
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 14.0
	add_child(sun)
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
	add_child(floor_mi)
	cam = Camera3D.new()
	cam.fov = 34.0
	add_child(cam)
	var h := HeroRig.build()
	hero = h.node
	skel = h.skel
	anim = h.anim
	add_child(hero)
	anim.animation_finished.connect(_on_finished)
	_build_ui()
	_play("idle")
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
	for item in [["慢動作", _toggle_slow], ["暫停", _toggle_pause], ["下一格", _step], ["正面", _view.bind(0.0)], ["側面", _view.bind(PI / 2)]]:
		var b := Button.new()
		b.text = item[0]
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size.y = 70
		b.pressed.connect(item[1])
		row.add_child(b)

func _play(k: String) -> void:
	cur = k
	paused = false
	anim.play(k, 0.15)

func _on_finished(_n: StringName) -> void:
	# 招式播完：回到待機一下，再重播同一招，方便反覆看
	if cur == "idle": return
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
		cam_pitch = clampf(cam_pitch + ev.relative.y * 0.005, -0.1, 1.2)
	elif ev is InputEventScreenDrag:
		cam_yaw -= ev.relative.x * 0.008
		cam_pitch = clampf(cam_pitch + ev.relative.y * 0.005, -0.1, 1.2)

func _process(_dt: float) -> void:
	anim.speed_scale = 0.0 if paused else speed
	# 鏡頭繞著主角：永遠對準身體中段，整個人都在畫面裡
	var target := Vector3(0, 0.95, 0)
	var dir := Vector3(sin(cam_yaw) * cos(cam_pitch), sin(cam_pitch), cos(cam_yaw) * cos(cam_pitch))
	cam.position = target + dir * cam_dist
	cam.look_at(target)
	cam.v_offset = -0.55   # 構圖往上移，腳不會被下方按鈕擋住
	var an := anim.current_animation
	if an != "":
		info.text = "%s　第 %d 格%s" % [HeroRig.MOVES[an][3] if HeroRig.MOVES.has(an) else an, int(anim.current_animation_position * 30.0), "　慢動作" if speed < 0.5 else ""]

# ---------------- 測試用 ----------------
# --sheet：每個招式在命中格各拍正面、側面；--ref：旁邊放動作檔原本的骨架模型對照
func _test_args() -> void:
	var args := OS.get_cmdline_user_args()
	if args.has("--ref"): _add_ref("idle")
	if not args.has("--sheet"): return
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
