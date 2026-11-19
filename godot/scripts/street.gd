class_name Street
extends Node3D
# 街景：地面、人行道、建築、招牌、擺設，以及白天／黃昏／夜晚三套光線。
# 只負責場景與光影，不含任何遊戲邏輯。檢視器和遊戲共用。

const U := 0.0234           # 舊版 1 單位 ≈ 0.0234 公尺
const ARENA := 7.0

# 打光編排（每個時段一套）。方向都用「光從哪個位置照向場地中央」表示，遊戲鏡頭在南方上空。
#   key   主光：太陽或月亮，有影子，決定整體明暗方向
#   rim   輪廓光：只照角色，從背後斜上方勾邊，把人物從背景分離
#   fill  補光：只照角色，從鏡頭方向補冷色，暗面不會死黑
#   bounce 反彈光：從下往上的暖色弱光，模擬陽光打到地面彈上來
#   flood 屋頂泛光燈：夜間的主要光源，兩盞交叉照向場地中央（固定不閃）
const TOD := {
	"day": {
		"name": "白天",
		"key_from": Vector3(-8.5, 8.2, 5.5), "key_color": Color(1.0, 0.93, 0.82), "key_energy": 1.1,
		"rim_from": Vector3(3, 6, -10), "rim_color": Color(1.0, 0.98, 0.92), "rim_energy": 0.6,
		"fill_from": Vector3(4, 5, 10), "fill_color": Color(0.55, 0.7, 1.0), "fill_energy": 0.28,
		"bounce_color": Color(0.9, 0.8, 0.66), "bounce_energy": 0.16,
		"sky_top": Color(0.24, 0.4, 0.68), "sky_horizon": Color(0.62, 0.7, 0.8), "ambient": Color(0.52, 0.58, 0.72), "ambient_energy": 0.7,
		"fog": Color(0.62, 0.69, 0.78), "fog_density": 0.003, "exposure": 0.9, "contrast": 1.08, "saturation": 0.98,
		"window": 0.0, "neon": 0.5, "neon_light": 0.0, "flood": 0.0, "glow": 0.2, "vignette": 0.18, "contact": 0.36,
	},
	"dusk": {
		"name": "黃昏",
		"key_from": Vector3(-9, 7.2, 5.5), "key_color": Color(1.0, 0.58, 0.28), "key_energy": 2.0,
		"rim_from": Vector3(-5, 5, -9), "rim_color": Color(1.0, 0.62, 0.3), "rim_energy": 1.3,
		"fill_from": Vector3(6, 5, 9), "fill_color": Color(0.42, 0.5, 0.95), "fill_energy": 0.42,
		"bounce_color": Color(1.0, 0.58, 0.36), "bounce_energy": 0.3,
		"sky_top": Color(0.16, 0.2, 0.48), "sky_horizon": Color(1.0, 0.56, 0.3), "ambient": Color(0.56, 0.5, 0.8), "ambient_energy": 1.05,
		"fog": Color(0.9, 0.52, 0.36), "fog_density": 0.0032, "exposure": 1.1, "contrast": 1.05, "saturation": 1.15,
		"window": 1.0, "neon": 1.6, "neon_light": 0.6, "flood": 0.3, "glow": 0.45, "vignette": 0.3, "contact": 0.34,
	},
	"night": {
		"name": "夜晚",
		"key_from": Vector3(7, 12, -8), "key_color": Color(0.55, 0.68, 1.0), "key_energy": 0.75,
		"rim_from": Vector3(4, 7, -9), "rim_color": Color(0.5, 0.72, 1.0), "rim_energy": 1.5,
		"fill_from": Vector3(2, 5, 10), "fill_color": Color(0.45, 0.5, 0.9), "fill_energy": 0.32,
		"bounce_color": Color(0.4, 0.45, 0.7), "bounce_energy": 0.18,
		"sky_top": Color(0.02, 0.03, 0.09), "sky_horizon": Color(0.08, 0.11, 0.24), "ambient": Color(0.32, 0.4, 0.72), "ambient_energy": 0.95,
		"fog": Color(0.05, 0.07, 0.15), "fog_density": 0.0035, "exposure": 1.25, "contrast": 1.04, "saturation": 1.12,
		"window": 2.4, "neon": 3.0, "neon_light": 1.0, "flood": 1.0, "glow": 0.75, "vignette": 0.38, "contact": 0.32,
	},
}
# 天空球與遠景的各時段設定：雲的顏色與多寡、星星、遠方城市剪影的顏色與窗燈、遠景大樓的色調
const SKY_EXTRA := {
	"day": {"sun": 1.0, "cloud": Color(1.0, 1.0, 1.0), "cloud_amount": 0.42, "star": 0.0, "city": Color(0.42, 0.5, 0.64), "city_light": 0.0, "backdrop": Color(0.5, 0.56, 0.68)},
	"dusk": {"sun": 1.2, "cloud": Color(1.0, 0.62, 0.45), "cloud_amount": 0.5, "star": 0.15, "city": Color(0.2, 0.15, 0.27), "city_light": 0.7, "backdrop": Color(0.3, 0.2, 0.28)},
	"night": {"sun": 0.8, "cloud": Color(0.1, 0.13, 0.24), "cloud_amount": 0.4, "star": 1.0, "city": Color(0.03, 0.04, 0.09), "city_light": 1.0, "backdrop": Color(0.05, 0.06, 0.12)},
}
const CHAR_LAYER := 2          # 角色專用的光照圖層（輪廓光、補光只照這一層）

var env: Environment
var sky_mat: ShaderMaterial
var sun: DirectionalLight3D
var char_key: DirectionalLight3D   # 主光的「角色版」：同方向同顏色、不投影，只照角色
var key_dir := Vector3.UP          # 指向主光來源的方向
var key_base := 1.0
var occluders: Array = []          # 建築的包圍盒（算角色有沒有被擋住陽光）
var char_lit := 1.0                # 角色照到主光的比例（0～1，平滑過）
var rim: DirectionalLight3D
var fill: DirectionalLight3D
var bounce: DirectionalLight3D
var floods: Array = []         # [SpotLight3D, 基準亮度, 燈罩材質]
var vignette_mat: ShaderMaterial
var ao_mats: Array = []        # 牆腳、角色腳下的接地暗影材質
var mats := {}
var facade_mats: Array = []     # 有窗戶燈光的牆面材質
var neon_labels: Array = []     # [Label3D, 顏色]
var neon_lights: Array = []     # [OmniLight3D, 基準亮度]
var tod := "day"
# ---- 天氣 ----
const WEATHERS := {   # [名稱, 雨量, 地面濕度, 雪量, 積雪]
	"clear": ["晴天", 0.0, 0.0, 0.0, 0.0], "rain": ["下雨", 1.0, 1.0, 0.0, 0.0], "after": ["雨後", 0.0, 1.0, 0.0, 0.0],
	"snow": ["下雪", 0.0, 0.0, 1.0, 1.0], "snowed": ["積雪", 0.0, 0.0, 0.0, 1.0],
}
const WEATHER_ORDER := ["clear", "rain", "after", "snow", "snowed"]
var weather := "clear"
const RAIN_DENSITY := 0.35     # 雨的密度（1 是大雨）。使用者要小雨
var rain_now := 0.0            # 目前的雨量（0～1，平滑過渡）
var snow_now := 0.0            # 目前的雪量（0～1）
var cover_now := 0.0           # 目前的積雪程度（0～1）
var snow_mat: ShaderMaterial
var cover_mat: ShaderMaterial
var snow_mm: MultiMesh
var wet_now := 0.0             # 目前地面的濕度（0～1）
var last_params := {}          # 最近一次套用的時段參數（天氣改變時要重新套用）
var wet_mats: Array = []       # 會變濕的地面材質：[材質, 乾的顏色]
var puddle_mats: Array = []    # 積水的材質（濕的時候更明顯）
var rain_mat: ShaderMaterial
var splash_mat: ShaderMaterial
var rain_mm: MultiMesh
var rain_audio: AudioStreamPlayer
var backdrop_mats: Array = []     # 遠景大樓的材質（隨時段換色）
var quality := 2                   # 畫質：2 高、1 中、0 低
const QUALITY_NAMES := ["低", "中", "高"]

func _init() -> void:
	_build_env()
	_build_ground()
	_build_buildings()
	_build_props()
	_build_backdrop()
	_merge_static()
	set_tod("day")

# 效能：把場景裡「同一個材質、同樣設定」的靜態物件合併成一個網格，一次畫完。
# 場景原本是幾百個各自獨立的方塊、圓柱，每個都要單獨送一次繪製指令（陰影每一段還要再送一次），
# 手機的繪圖晶片最怕這個。合併後外觀完全一樣（頂點、材質都沒變），只是送的次數少很多。
# 只合併不透明的標準材質；透明的、用著色器的、有登記用途（meta）的都不動。
func _merge_static() -> void:
	var groups := {}
	for c in get_children():
		var mi := c as MeshInstance3D
		if mi == null or mi.get_child_count() > 0 or not mi.visible or mi.mesh == null or mi.mesh.get_surface_count() != 1: continue
		var metas := mi.get_meta_list()
		if metas.size() > 1 or (metas.size() == 1 and metas[0] != &"snow"): continue
		var mat := mi.get_active_material(0) as StandardMaterial3D
		if mat == null or mat.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED or mat.billboard_mode != BaseMaterial3D.BILLBOARD_DISABLED: continue
		if mi.material_overlay != null or mi.skin != null: continue
		var fmt := (mi.mesh as ArrayMesh).surface_get_format(0) if mi.mesh is ArrayMesh else -1
		var key := "%d|%d|%d|%s|%d|%s" % [mat.get_instance_id(), mi.cast_shadow, mi.layers, mi.has_meta("snow"), fmt, mi.gi_mode]
		if not groups.has(key): groups[key] = []
		groups[key].append(mi)
	for key in groups:
		var list: Array = groups[key]
		if list.size() < 2: continue
		var first: MeshInstance3D = list[0]
		var st := SurfaceTool.new()
		for m in list:
			var mi: MeshInstance3D = m
			st.append_from(mi.mesh, 0, mi.transform)
		var merged := MeshInstance3D.new()
		merged.mesh = st.commit()
		merged.material_override = first.get_active_material(0)
		merged.cast_shadow = first.cast_shadow
		merged.layers = first.layers
		merged.gi_mode = first.gi_mode
		if first.has_meta("snow"): merged.set_meta("snow", true)
		add_child(merged)
		for m in list:
			remove_child(m)
			(m as Node).free()

# ---------------- 材質 ----------------
func _tex(n: String) -> Texture2D:
	var path := "res://assets/textures/%s.jpg" % n
	if not ResourceLoader.exists(path): path = "res://assets/textures/%s.png" % n
	return load(path)

# PBR 材質：顏色、法線、粗糙度三張貼圖；tri = 依世界座標三向投影（方塊不用自己攤貼圖）
func pbr(set_name: String, uv: float, tri := false, tint := Color.WHITE, key_extra := "") -> StandardMaterial3D:
	var key := "%s|%s|%s|%s|%s" % [set_name, uv, tri, tint, key_extra]
	if mats.has(key): return mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_texture = _tex(set_name + "_color")
	m.albedo_color = tint
	m.normal_enabled = true
	m.normal_texture = _tex(set_name + "_normal")
	m.normal_scale = 1.0
	m.roughness_texture = _tex(set_name + "_rough")
	m.roughness = 1.0
	m.metallic_specular = 0.4
	m.uv1_scale = Vector3(uv, uv, uv)
	m.uv1_triplanar = tri
	m.uv1_world_triplanar = tri
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	mats[key] = m
	return m

# 接地暗影：中間（物體正下方）最暗、往外漸淡的半透明黑色。fx、fz 是物體佔這張貼圖的比例
func contact_mat(fx: float, fz: float) -> StandardMaterial3D:
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	for y in 64:
		for x in 64:
			var u := absf((x + 0.5) / 64.0 - 0.5) * 2.0
			var v := absf((y + 0.5) / 64.0 - 0.5) * 2.0
			var dx := clampf((u - fx) / maxf(0.001, 1.0 - fx), 0.0, 1.0)
			var dz := clampf((v - fz) / maxf(0.001, 1.0 - fz), 0.0, 1.0)
			var k := 1.0 - clampf(sqrt(dx * dx + dz * dz), 0.0, 1.0)
			img.set_pixel(x, y, Color(0, 0, 0, k * k))
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_texture = ImageTexture.create_from_image(img)
	m.albedo_color = Color(0, 0, 0.02, 0.5)
	m.render_priority = 1
	ao_mats.append(m)
	return m

# 讓角色吃到輪廓光與補光，並在腳下加接地暗影
# main = 主角（走進建築影子時「角色版主光」的亮度看它）；敵人傳 false
func add_character(node: Node3D, radius := 0.55, main := true) -> void:
	for mi in node.find_children("*", "MeshInstance3D", true, false):
		var m3 := mi as MeshInstance3D
		m3.layers = CHAR_LAYER      # 只在角色圖層：吃角色版主光、輪廓光、補光，不吃場景的主光
		for i in m3.mesh.get_surface_count():
			var mt: BaseMaterial3D = m3.get_surface_override_material(i)
			if mt == null:
				mt = m3.mesh.surface_get_material(i).duplicate()
				m3.set_surface_override_material(i, mt)
			mt.disable_receive_shadows = true
	var blob := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(radius * 2.0, radius * 2.0)
	blob.mesh = pm
	if char_blob_mat == null: char_blob_mat = contact_mat(0.05, 0.05)     # 所有角色共用一份，不要每生一隻就多一個材質
	blob.material_override = char_blob_mat
	blob.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	blob.position.y = 0.02
	blob.top_level = true
	blob.name = "ContactShadow"
	add_child(blob)
	blob.set_meta("follow", node)
	blob.set_meta("main", main)
	blobs.append(blob)
	set_process(true)

var char_blob_mat: Material = null
var blobs: Array = []          # 所有角色腳下的接地暗影（每格只更新這些，不必掃過整個場景）

func _process(dt: float) -> void:
	var target := 1.0
	var gone := false
	for c in blobs:
		var n = c.get_meta("follow")
		if not is_instance_valid(n) or n.is_queued_for_deletion() or n.has_meta("down"):
			c.queue_free()     # 角色不在了，腳下的暗影一起清掉
			c.set_meta("gone", true)
			gone = true
			continue
		var np: Vector3 = (n as Node3D).global_position
		(c as Node3D).global_position = Vector3(np.x, 0.02, np.z)
		(c as Node3D).visible = np.y < 0.3   # 被打飛到空中時不畫
		if c.get_meta("main", true): target = lit_amount(np)
	if gone: blobs = blobs.filter(func(b): return not b.has_meta("gone"))
	# 進出建築影子時平滑過渡
	char_lit = lerpf(char_lit, target, minf(1.0, dt * 7.0))
	char_key.light_energy = key_base * char_lit
	_update_weather(dt)

# ---------------- 天氣 ----------------
# 切換天氣：clear 晴天、rain 下雨（地面跟著變濕）、after 雨後（雨停了但地還是濕的）。instant 是立刻到位（測試截圖用）
func set_weather(name: String, instant := false) -> void:
	if not WEATHERS.has(name): return
	weather = name
	if instant:
		rain_now = WEATHERS[name][1]
		wet_now = WEATHERS[name][2]
		snow_now = WEATHERS[name][3]
		cover_now = WEATHERS[name][4]
		_apply_weather()

func weather_name() -> String:
	return WEATHERS[weather][0]

func _update_weather(dt: float) -> void:
	var r_to: float = WEATHERS[weather][1]
	var w_to: float = WEATHERS[weather][2]
	var s_to: float = WEATHERS[weather][3]
	var c_to: float = WEATHERS[weather][4]
	if is_equal_approx(rain_now, r_to) and is_equal_approx(wet_now, w_to) and is_equal_approx(snow_now, s_to) and is_equal_approx(cover_now, c_to): return
	snow_now = move_toward(snow_now, s_to, dt / 2.5)
	# 雪要下起來才開始積，大約 8 秒積滿；融掉比較快
	cover_now = move_toward(cover_now, c_to, dt / (8.0 if c_to > cover_now else 4.0))
	rain_now = move_toward(rain_now, r_to, dt / 2.5)     # 雨大約 2.5 秒下起來或停掉
	wet_now = move_toward(wet_now, w_to, dt / 4.0)       # 地面大約 4 秒濕透或乾掉
	_apply_weather()

func _apply_weather() -> void:
	_build_rain()
	# 小雨：只用到三成多的雨絲、一半的落點
	rain_mat.set_shader_parameter("amount", rain_now * RAIN_DENSITY)
	splash_mat.set_shader_parameter("amount", rain_now * 0.5)
	(get_meta("rain_node") as Node3D).visible = rain_now > 0.005
	(get_meta("splash_node") as Node3D).visible = rain_now > 0.005
	rain_audio.volume_db = lerpf(-40.0, -13.0, rain_now)
	if rain_now > 0.01 and not rain_audio.playing: rain_audio.play(0.85 if rain_audio.stream is AudioStreamOggVorbis else 0.0)   # 跳過循環檔開頭疊著結尾的那一段
	elif rain_now <= 0.01 and rain_audio.playing: rain_audio.stop()
	_apply_snow()
	# 地面變濕：顏色變深、變光滑（會反射天空和燈光）
	for m in wet_mats:
		var mt: StandardMaterial3D = m[0]
		mt.albedo_color = (m[1] as Color) * lerpf(1.0, 0.62, wet_now)
		mt.albedo_color.a = 1.0
		mt.roughness = lerpf(1.0, 0.4, wet_now)
		mt.metallic_specular = lerpf(0.4, 0.68, wet_now)
	for m in puddle_mats: (m as StandardMaterial3D).albedo_color.a = lerpf(0.3, 0.85, wet_now)
	# 陰天的光線要跟著重新套用
	if not last_params.is_empty(): _apply(last_params)

# 雪花與積雪：第一次要用時才建立
func _apply_snow() -> void:
	if snow_mat == null:
		if snow_now <= 0.0 and cover_now <= 0.0: return
		var rng := RandomNumberGenerator.new()
		rng.seed = 321
		snow_mat = ShaderMaterial.new()
		snow_mat.shader = load("res://shaders/snow.gdshader")
		snow_mm = MultiMesh.new()
		snow_mm.transform_format = MultiMesh.TRANSFORM_3D
		snow_mm.use_custom_data = true
		var qm := QuadMesh.new()
		qm.size = Vector2(1, 1)
		snow_mm.mesh = qm
		snow_mm.instance_count = 1800
		for i in snow_mm.instance_count:
			snow_mm.set_instance_transform(i, Transform3D.IDENTITY)
			snow_mm.set_instance_custom_data(i, Color(rng.randf(), rng.randf(), rng.randf(), rng.randf()))
		var n := MultiMeshInstance3D.new()
		n.multimesh = snow_mm
		n.material_override = snow_mat
		n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		n.custom_aabb = AABB(Vector3(-40, -1, -40), Vector3(80, 30, 80))
		add_child(n)
		set_meta("snow_node", n)
		# 積雪：同一層材質疊在場景所有實體物件上（會投影的物件，加上特別標記要積雪的），只有朝上的面會白
		cover_mat = ShaderMaterial.new()
		cover_mat.shader = load("res://shaders/snow_cover.gdshader")
		for c in get_children():
			if c is MeshInstance3D and ((c as MeshInstance3D).cast_shadow != GeometryInstance3D.SHADOW_CASTING_SETTING_OFF or c.has_meta("snow")):
				(c as MeshInstance3D).material_overlay = cover_mat
		set_quality(quality)
	snow_mat.set_shader_parameter("amount", snow_now)
	(get_meta("snow_node") as Node3D).visible = snow_now > 0.005
	cover_mat.set_shader_parameter("cover", cover_now)

# 登記一個會變濕的地面材質
func wettable(mt: StandardMaterial3D) -> StandardMaterial3D:
	wet_mats.append([mt, mt.albedo_color])
	return mt

# 雨絲、水圈、雨聲：第一次要用時才建立
func _build_rain() -> void:
	if rain_mat != null: return
	var rng := RandomNumberGenerator.new()
	rng.seed = 99
	rain_mat = ShaderMaterial.new()
	rain_mat.shader = load("res://shaders/rain.gdshader")
	splash_mat = ShaderMaterial.new()
	splash_mat.shader = load("res://shaders/splash.gdshader")
	var defs := [[2400, QuadMesh.new(), rain_mat, "rain_node"], [320, PlaneMesh.new(), splash_mat, "splash_node"]]
	for d in defs:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = true
		var mesh: PrimitiveMesh = d[1]
		mesh.set("size", Vector2(1, 1))
		mm.mesh = mesh
		mm.instance_count = d[0]
		for i in mm.instance_count:
			mm.set_instance_transform(i, Transform3D.IDENTITY)
			mm.set_instance_custom_data(i, Color(rng.randf(), rng.randf(), rng.randf(), rng.randf()))
		var n := MultiMeshInstance3D.new()
		n.multimesh = mm
		n.material_override = d[2]
		n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		n.custom_aabb = AABB(Vector3(-40, -1, -40), Vector3(80, 30, 80))   # 位置是在著色器裡算的，要手動給範圍才不會被誤判成看不到
		n.visible = false
		add_child(n)
		set_meta(d[3], n)
		if d[3] == "rain_node": rain_mm = mm
	# 雨聲：一段可以無縫循環的沙沙聲
	var rate := 22050
	var count := rate * 2
	var buf := PackedFloat32Array()
	buf.resize(count)
	var lp := 0.0
	var lp2 := 0.0
	for i in count:
		var w := rng.randf_range(-1.0, 1.0)
		lp += (w - lp) * 0.5
		lp2 += (w - lp2) * 0.04
		buf[i] = (lp - lp2) * 0.6
	var data := PackedByteArray()
	data.resize(count * 2)
	var xf := rate / 4        # 尾端四分之一秒和開頭交疊，循環時聽不出接縫
	for i in count:
		var v := buf[i]
		if i < xf:
			var k := float(i) / xf
			v = v * k + buf[count - xf + i] * (1.0 - k)
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 30000.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = rate
	wav.data = data
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_begin = 0
	wav.loop_end = count - xf
	rain_audio = AudioStreamPlayer.new()
	rain_audio.stream = wav
	# 有錄好的雨聲就用它（已經做成無縫循環），沒有才用上面合成的
	if ResourceLoader.exists("res://assets/sfx/amb_rain.ogg"):
		var ogg: AudioStreamOggVorbis = load("res://assets/sfx/amb_rain.ogg")
		ogg.loop = true
		rain_audio.stream = ogg
	rain_audio.volume_db = -40.0
	add_child(rain_audio)

# 下雨時的天色：雲層變厚、陽光減弱、霧氣變重、顏色偏灰。回傳調整過的參數（不改原本的）
func _weathered(t: Dictionary) -> Dictionary:
	# 陰天的程度：下雨或下雪都會讓天色變灰；積雪會把光反射回來，環境比較亮
	var k := maxf(rain_now, snow_now * 0.9)
	if k <= 0.001 and cover_now <= 0.001: return t
	var d := t.duplicate()
	var gray := func(c: Color, mul: float) -> Color:
		var l := c.get_luminance() * mul
		return c.lerp(Color(l * 0.94, l, l * 1.08), 0.55 * k)
	d.key_energy = t.key_energy * lerpf(1.0, 0.68, k)
	d.rim_energy = t.rim_energy * lerpf(1.0, 0.7, k)
	d.sky_top = gray.call(t.sky_top, 0.85)
	d.sky_horizon = gray.call(t.sky_horizon, 0.8)
	d.fog = gray.call(t.fog, 0.85)
	d.fog_density = t.fog_density * lerpf(1.0, 1.7, k)
	d.ambient = gray.call(t.ambient, 1.05)
	d.ambient_energy = t.ambient_energy * lerpf(1.0, 1.08, k)
	d.saturation = t.saturation * lerpf(1.0, 0.92, k)
	d.exposure = t.exposure * lerpf(1.0, 0.94, k)
	d.sun = t.sun * (1.0 - k * 0.8)
	d.cloud_amount = lerpf(t.cloud_amount, 0.85, k)
	d.cloud = gray.call(t.cloud, 0.6)
	d.star = t.star * (1.0 - k)
	d.bounce_energy = t.bounce_energy * lerpf(1.0, 1.4, cover_now)
	d.bounce_color = (t.bounce_color as Color).lerp(Color(0.85, 0.9, 1.0), cover_now * 0.7)
	return d

# 這個位置的角色照到主光的比例：從腳、腰、頭各朝主光方向檢查有沒有被建築擋住
func lit_amount(pos: Vector3) -> float:
	if key_dir.y < 0.03: return 1.0
	var lit := 0
	for h in [0.2, 0.9, 1.6]:
		var from := Vector3(pos.x, h, pos.z)
		var hit := false
		for bx in occluders:
			if (bx as AABB).intersects_ray(from, key_dir) != null:
				hit = true
				break
		if not hit: lit += 1
	return lit / 3.0

func _flat(c: Color, rough := 0.8, metal := 0.0) -> StandardMaterial3D:
	var key := "flat|%s|%s|%s" % [c, rough, metal]
	if mats.has(key): return mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	mats[key] = m
	return m

func _box(pos: Vector3, size: Vector3, mat: Material, rot_y := 0.0) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	mi.rotation.y = rot_y
	add_child(mi)
	return mi

func _cyl(pos: Vector3, r: float, h: float, mat: Material, r_top := -1.0) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.bottom_radius = r
	cm.top_radius = r if r_top < 0.0 else r_top
	cm.height = h
	cm.radial_segments = 16
	mi.mesh = cm
	mi.material_override = mat
	mi.position = pos
	add_child(mi)
	return mi

# ---------------- 天空、太陽、霧、色調 ----------------
func _build_env() -> void:
	env = Environment.new()
	var sky := Sky.new()
	# 天空球：自訂的天空著色器（漸層、雲、星星、遠方城市剪影），見 shaders/sky.gdshader
	sky_mat = ShaderMaterial.new()
	sky_mat.shader = load("res://shaders/sky.gdshader")
	sky.sky_material = sky_mat
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	# 環境光用指定顏色（夜晚天空很暗，直接取天空會黑成一片）；反光仍取自天空
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_white = 6.0
	env.glow_enabled = true
	env.glow_bloom = 0.05
	env.glow_hdr_threshold = 0.95
	env.fog_enabled = true
	env.fog_sky_affect = 0.3
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.06
	env.adjustment_saturation = 1.08
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 42.0
	sun.directional_shadow_blend_splits = true
	sun.shadow_bias = 0.04
	# 法線偏移要夠大：低角度的光貼著角色表面時，陰影貼圖的格子會在皺褶上切出銳利的暗紋
	sun.shadow_normal_bias = 2.0
	sun.shadow_blur = 2.2
	# 影子的濃度：1 是全黑。使用者覺得影子顏色太深，調淡讓影子裡還看得到地面的顏色和紋理
	sun.shadow_opacity = 0.62
	# 主光只照場景；角色改由下面這盞「角色版主光」照，且角色不接收陰影貼圖。
	# 原因：低角度的光貼著角色表面時，陰影貼圖的精度不足會在身上畫出黑色條紋（手機上特別明顯）。
	# 角色走進建築影子時變暗，改用射線計算被擋住幾成（見 _process）。
	sun.light_cull_mask = 1
	add_child(sun)
	char_key = DirectionalLight3D.new()
	char_key.light_cull_mask = CHAR_LAYER
	add_child(char_key)
	# 輪廓光、補光：只照角色（不影響場景），不投影
	rim = DirectionalLight3D.new()
	rim.light_cull_mask = CHAR_LAYER
	rim.light_specular = 1.4
	add_child(rim)
	fill = DirectionalLight3D.new()
	fill.light_cull_mask = CHAR_LAYER
	fill.light_specular = 0.2
	add_child(fill)
	# 地面反彈光：由下往上，照亮牆面下半部與物體底面
	bounce = DirectionalLight3D.new()
	bounce.basis = Basis.looking_at(Vector3(0.15, 1, -0.1).normalized(), Vector3.FORWARD)
	bounce.light_specular = 0.0
	add_child(bounce)
	# 屋頂泛光燈：兩盞交叉照向場地中央，左暖右偏冷，有影子
	# 位置要在屋頂外緣之外，不然光會被自己那棟樓的女兒牆擋住
	for f in [[Vector3(-10.7, 9.3, 3.5), Color(1.0, 0.8, 0.56), 13.0], [Vector3(10.8, 8.8, -2.5), Color(0.8, 0.88, 1.0), 7.0]]:
		var sp := SpotLight3D.new()
		sp.position = f[0]
		sp.basis = Basis.looking_at((Vector3(0, 0.6, 0) - (f[0] as Vector3)).normalized(), Vector3.UP)
		sp.light_color = f[1]
		sp.spot_range = 30.0
		sp.spot_angle = 30.0
		sp.spot_angle_attenuation = 0.7
		sp.spot_attenuation = 0.9
		sp.shadow_enabled = true
		sp.shadow_normal_bias = 2.0
		sp.shadow_blur = 2.0
		sp.shadow_opacity = 0.6
		add_child(sp)
		# 燈具：小燈箱加發光的燈面
		var lm := StandardMaterial3D.new()
		lm.albedo_color = Color(0.1, 0.1, 0.1)
		lm.emission_enabled = true
		lm.emission = f[1]
		var fx := _box(f[0], Vector3(0.5, 0.35, 0.5), lm)
		fx.basis = sp.basis
		fx.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		floods.append([sp, f[2], lm])
	# 暗角：畫面四角壓暗，把視線集中到中央（蓋在 3D 畫面上、介面底下）
	var layer := CanvasLayer.new()
	layer.layer = 0
	add_child(layer)
	var rect := ColorRect.new()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = "shader_type canvas_item;\nuniform float strength = 0.3;\nvoid fragment() {\n\tvec2 d = (UV - 0.5) * vec2(1.0, 1.15);\n\tCOLOR = vec4(0.01, 0.01, 0.03, smoothstep(0.32, 0.85, length(d)) * strength);\n}"
	vignette_mat = ShaderMaterial.new()
	vignette_mat.shader = sh
	rect.material = vignette_mat
	layer.add_child(rect)
	set_meta("vignette_layer", layer)

static func _aim(l: Light3D, from: Vector3) -> void:
	l.basis = Basis.looking_at(-from.normalized(), Vector3.UP)

# 日夜循環的關鍵時刻（一輪是 0～1）：白天最長，黃昏過渡到夜晚，夜晚之後經過一段像黃昏的清晨回到白天
const CYCLE := [[0.0, "day"], [0.36, "day"], [0.48, "dusk"], [0.58, "night"], [0.88, "night"], [0.95, "dusk"], [1.0, "day"]]

# 某個時段的全部參數（打光＋天空）
func _params(name: String) -> Dictionary:
	var d: Dictionary = (TOD[name] as Dictionary).duplicate()
	d.merge(SKY_EXTRA[name])
	return d

# 直接切到某個時段
func set_tod(name: String) -> void:
	tod = name
	time_sig.x = -9.0      # 讓下一次 set_time 一定會重算
	_apply(_params(name))

# 連續的日夜變化：x 是一輪裡的位置（0～1），在相鄰兩個關鍵時刻之間平滑內插
var time_sig := Vector4(-9, 0, 0, 0)
var time_wsig := Vector4.ZERO
func set_time(x: float) -> void:
	x = fposmod(x, 1.0)
	# 效能：這個函式每格都會被呼叫，但光線一輪要三分鐘，一格的變化小到看不出來。
	# 時間前進不到一輪的兩千分之一（三分鐘一輪時約 0.09 秒）、天氣也沒在變的話，就沿用上一次的結果
	var wsig := Vector4(rain_now, wet_now, snow_now, cover_now)
	if absf(x - time_sig.x) < 0.0005 and wsig == time_wsig and int(time_sig.y) == quality: return
	time_sig = Vector4(x, quality, 0, 0)
	time_wsig = wsig
	var i := 0
	while i < CYCLE.size() - 2 and x >= CYCLE[i + 1][0]: i += 1
	var a: Dictionary = _params(CYCLE[i][1])
	var b: Dictionary = _params(CYCLE[i + 1][1])
	var k := clampf((x - CYCLE[i][0]) / maxf(0.0001, CYCLE[i + 1][0] - CYCLE[i][0]), 0.0, 1.0)
	k = k * k * (3.0 - 2.0 * k)
	tod = CYCLE[i][1] if k < 0.5 else CYCLE[i + 1][1]
	var d := {}
	for key in a:
		var va = a[key]
		var vb = b[key]
		if va is float or va is int: d[key] = lerpf(va, vb, k)
		elif va is Color: d[key] = (va as Color).lerp(vb, k)
		elif va is Vector3: d[key] = (va as Vector3).lerp(vb, k)
		else: d[key] = va if k < 0.5 else vb
	_apply(d)

# 目前是哪個時段（顯示用）
func phase_name() -> String:
	return TOD[tod].name

# 子類別的場景可以在這裡處理自己的東西（燈籠、燈泡之類）
func _apply_extra(_t: Dictionary) -> void:
	pass

func _apply(t: Dictionary) -> void:
	last_params = t
	t = _weathered(t)
	_aim(sun, t.key_from)
	sun.light_color = t.key_color
	sun.light_energy = t.key_energy
	_aim(char_key, t.key_from)
	char_key.light_color = t.key_color
	key_base = t.key_energy
	key_dir = (t.key_from as Vector3).normalized()
	_aim(rim, t.rim_from)
	rim.light_color = t.rim_color
	rim.light_energy = t.rim_energy
	_aim(fill, t.fill_from)
	fill.light_color = t.fill_color
	fill.light_energy = t.fill_energy
	bounce.light_color = t.bounce_color
	bounce.light_energy = t.bounce_energy
	for f in floods:
		var sp: SpotLight3D = f[0]
		sp.light_energy = f[1] * t.flood
		sp.visible = t.flood > 0.01
		sp.shadow_enabled = quality >= 2
		(f[2] as StandardMaterial3D).emission_energy_multiplier = 4.0 * t.flood
	env.adjustment_contrast = t.contrast
	env.adjustment_saturation = t.saturation
	vignette_mat.set_shader_parameter("strength", t.vignette)
	for m in ao_mats: (m as StandardMaterial3D).albedo_color.a = t.contact
	var sx := t
	sky_mat.set_shader_parameter("top_color", t.sky_top)
	sky_mat.set_shader_parameter("horizon_color", t.sky_horizon)
	sky_mat.set_shader_parameter("ground_color", (t.fog as Color).darkened(0.35))
	sky_mat.set_shader_parameter("sun_dir", (t.key_from as Vector3).normalized())
	sky_mat.set_shader_parameter("sun_color", t.key_color)
	sky_mat.set_shader_parameter("sun_energy", sx.sun)
	sky_mat.set_shader_parameter("cloud_color", sx.cloud)
	sky_mat.set_shader_parameter("cloud_amount", sx.cloud_amount)
	sky_mat.set_shader_parameter("star", sx.star)
	sky_mat.set_shader_parameter("city_color", sx.city)
	sky_mat.set_shader_parameter("city_light", sx.city_light)
	for m in backdrop_mats: (m as StandardMaterial3D).albedo_color = sx.backdrop
	env.ambient_light_color = t.ambient
	env.ambient_light_energy = t.ambient_energy
	env.fog_light_color = t.fog
	env.fog_density = t.fog_density
	env.tonemap_exposure = t.exposure
	env.glow_intensity = t.glow
	for m in facade_mats: (m as StandardMaterial3D).emission_energy_multiplier = t.window
	for n in neon_labels:
		var lb: Label3D = n[0]
		lb.modulate = (n[1] as Color) * minf(1.0, 0.45 + t.neon * 0.35)
		lb.modulate.a = 1.0
	for l in neon_lights:
		var ol: OmniLight3D = l[0]
		ol.light_energy = l[1] * t.neon_light
		ol.visible = t.neon_light > 0.01 and quality >= 1

# 畫質分級（手機網頁版很吃效能，掉格時要能降）：
#   高：四倍反鋸齒、四段式 4096 陰影、泛光燈有影子、全解析度
#   中：關反鋸齒、兩段式 2048 陰影、泛光燈不投影、解析度八成
#   低：再關霓虹燈的光與光暈、陰影 1024、解析度六成
	_apply_extra(t)

func set_quality(q: int) -> void:
	quality = clampi(q, 0, 2)
	var vp := get_viewport()
	if vp != null:
		vp.msaa_3d = Viewport.MSAA_4X if quality >= 2 else Viewport.MSAA_DISABLED
		vp.scaling_3d_scale = [0.6, 0.8, 1.0][quality]
	RenderingServer.directional_shadow_atlas_set_size([1024, 2048, 4096][quality], true)
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if quality >= 2 else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	env.glow_enabled = quality >= 1
	if rain_mm != null: rain_mm.visible_instance_count = [900, 1500, -1][quality]
	if snow_mm != null: snow_mm.visible_instance_count = [600, 1100, -1][quality]
	set_tod(tod)

# ---------------- 地面與人行道 ----------------
func _build_ground() -> void:
	# 外圍柏油路（重複貼圖）
	var outer := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(700, 700)   # 鋪到很遠，配合霧和天空球的城市剪影，看不到地面的邊緣
	outer.mesh = pm
	outer.material_override = pbr("asphalt", 175.0, false, Color(0.44, 0.44, 0.46))
	outer.position.y = -0.02
	add_child(outer)
	# 打鬥區：不重複的大張路面（有裂縫、修補痕跡）
	var ground := MeshInstance3D.new()
	var gm := PlaneMesh.new()
	gm.size = Vector2(37, 37)
	ground.mesh = gm
	ground.material_override = pbr("groundbig", 1.0, false, Color(0.6, 0.6, 0.62))
	add_child(ground)
	# 人行道：建築前面一圈水泥，比路面高一階
	var cm := pbr("concrete", 0.35, true, Color(0.78, 0.78, 0.8))
	var d := ARENA + 2.6
	_box(Vector3(0, 0.07, -9.0), Vector3(36, 0.14, 1.7), cm)
	_box(Vector3(-d - 1.0, 0.07, 0.5), Vector3(2.0, 0.14, 22), cm)
	_box(Vector3(d + 1.0, 0.07, 0.5), Vector3(2.0, 0.14, 22), cm)
	# 斑馬線（南側）
	var paint := _flat(Color(0.78, 0.78, 0.74), 0.85)
	for i in 7:
		var s := _box(Vector3(-3.6 + i * 1.2, 0.006, ARENA + 3.4), Vector3(0.6, 0.004, 2.6), paint)
		s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

# ---------------- 建築與招牌 ----------------
func _build_buildings() -> void:
	var blocks := [
		# [x, z, 寬, 高, 深, 牆面貼圖, 色調]
		[-470, -510, 300, 330, 180, "brick", Color(1, 1, 1)], [-120, -530, 260, 420, 200, "plaster", Color(0.95, 0.93, 0.9)],
		[210, -515, 280, 290, 180, "brick2", Color(1, 1, 1)], [540, -500, 260, 380, 180, "brick", Color(0.9, 0.86, 0.84)],
		[-590, -150, 200, 300, 260, "brick2", Color(0.95, 0.95, 1.0)], [-580, 230, 200, 360, 300, "plaster", Color(1, 0.97, 0.92)],
		[590, -170, 200, 340, 280, "plaster", Color(0.92, 0.95, 1.0)], [580, 220, 200, 280, 260, "brick", Color(1, 1, 1)],
		[-420, 760, 320, 260, 200, "plaster", Color(0.9, 0.9, 0.95)], [0, 790, 300, 340, 200, "brick2", Color(1, 1, 1)], [400, 770, 300, 240, 200, "brick", Color(0.95, 0.9, 0.9)],
	]
	var roof := _flat(Color(0.09, 0.09, 0.1), 0.95)
	var trim := pbr("concrete", 0.5, true, Color(0.6, 0.6, 0.62))
	var signs := [["麵", Color(1.0, 0.31, 0.42)], ["當舖", Color(0.25, 0.88, 0.77)], ["酒", Color(1.0, 0.81, 0.23)], ["旅社", Color(1.0, 0.54, 0.24)], ["按摩", Color(0.78, 0.42, 1.0)], ["理髮", Color(0.31, 0.64, 1.0)], ["茶", Color(0.4, 1.0, 0.5)], ["撞球", Color(1.0, 0.36, 0.7)]]
	var font: Font = load("res://assets/fonts/NotoSansTC.ttf")
	var i := 0
	for b in blocks:
		var w: float = b[2] * U
		var h: float = b[3] * U
		var dp: float = b[4] * U
		var c := Vector3(b[0] * U, 0, b[1] * U)
		# 牆面：一張貼圖約 7 公尺見方（四層樓、四扇窗），窗戶另有夜間發光貼圖
		var fm: StandardMaterial3D = pbr(b[5], 1.0 / 7.0, true, b[6], "facade%d" % i)
		fm.emission_enabled = true
		fm.emission_texture = _tex(b[5] + "_emit")
		fm.emission_energy_multiplier = 0.0
		facade_mats.append(fm)
		_box(c + Vector3(0, h * 0.5, 0), Vector3(w, h, dp), fm)
		occluders.append(AABB(c + Vector3(-w * 0.5, 0, -dp * 0.5), Vector3(w, h, dp)))
		# 屋頂女兒牆與一樓的水泥基座，讓方塊看起來像建築
		_box(c + Vector3(0, h + 0.12, 0), Vector3(w + 0.3, 0.24, dp + 0.3), trim)
		_box(c + Vector3(0, h + 0.26, 0), Vector3(w - 0.2, 0.06, dp - 0.2), roof)
		_box(c + Vector3(0, 0.3, 0), Vector3(w + 0.12, 0.6, dp + 0.12), trim)
		# 面向擂台的那一面：鐵捲門、霓虹招牌
		var axis_x := absf(c.x) > absf(c.z) + 2.0     # 東西兩側的建築面向 X
		var n := Vector3(signf(-c.x), 0, 0) if axis_x else Vector3(0, 0, signf(-c.z))
		var half := (w if axis_x else dp) * 0.5
		var front := c + n * (half + 0.03)
		var rot := atan2(n.x, n.z)
		var sm := pbr("shutter", 0.5, true)
		_box(front + Vector3(0, 1.25, 0) + n * 0.02, Vector3(2.6, 2.1, 0.08), sm, rot)
		var sg: Array = signs[i % signs.size()]
		var lb := Label3D.new()
		lb.text = sg[0]
		lb.font = font
		lb.font_size = 160
		lb.pixel_size = 0.0055
		lb.outline_size = 0
		lb.shaded = false
		lb.double_sided = false
		lb.position = front + Vector3(0, 3.1, 0) + n * 0.12
		lb.rotation.y = rot
		add_child(lb)
		neon_labels.append([lb, sg[1]])
		# 招牌底板（深色），招牌字才看得清楚
		_box(front + Vector3(0, 3.1, 0) + n * 0.05, Vector3(0.95 * (sg[0] as String).length() + 0.5, 1.15, 0.08), _flat(Color(0.05, 0.05, 0.06), 0.6), rot)
		# 霓虹燈的光：黃昏與夜晚才亮，照亮招牌下方的地面與牆
		var ol := OmniLight3D.new()
		ol.light_color = sg[1]
		ol.omni_range = 8.5
		ol.omni_attenuation = 1.1
		ol.shadow_enabled = false
		ol.position = front + Vector3(0, 2.7, 0) + n * 0.9
		add_child(ol)
		neon_lights.append([ol, 3.2])
		# 牆腳的接地暗影：建築周圍一圈柔和的暗色，物體才會「站」在地上
		var ao := MeshInstance3D.new()
		var apm := PlaneMesh.new()
		apm.size = Vector2(w + 3.0, dp + 3.0)
		ao.mesh = apm
		ao.material_override = contact_mat(w / (w + 3.0), dp / (dp + 3.0))
		ao.position = c + Vector3(0, 0.016, 0)
		ao.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(ao)
		i += 1

# ---------------- 街道擺設 ----------------
# 遠景：場地外圍再排兩圈簡化的大樓（單色、不投影），填滿近景建築和天空球之間的空檔
func _build_backdrop() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 20260
	for ring in 2:
		var m := StandardMaterial3D.new()
		m.roughness = 1.0
		m.metallic_specular = 0.0
		m.albedo_texture = _tex("plaster_color")
		m.uv1_triplanar = true
		m.uv1_world_triplanar = true
		m.uv1_scale = Vector3.ONE / 9.0
		backdrop_mats.append(m)
		var count := 16 + ring * 8
		var rad := 30.0 + ring * 22.0
		for i in count:
			var a := TAU * (i + rng.randf() * 0.5) / count
			var w := rng.randf_range(7.0, 13.0) + ring * 4.0
			var h := rng.randf_range(10.0, 24.0) + ring * 12.0
			var d := rad + rng.randf_range(-3.0, 4.0)
			var b := _box(Vector3(cos(a) * d, h * 0.5, sin(a) * d), Vector3(w, h, w * rng.randf_range(0.7, 1.2)), m, -a + PI * 0.5)
			b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _build_props() -> void:
	var wood := pbr("wood", 1.2, true)
	var metal_g := pbr("paintmetal", 0.8, true, Color(0.45, 0.62, 0.5))
	var metal_b := pbr("paintmetal", 0.8, true, Color(0.5, 0.56, 0.72))
	var dark := _flat(Color(0.07, 0.07, 0.08), 0.5, 0.2)
	var d := ARENA + 1.6
	# 木箱堆
	for p in [[-d + 0.4, -d + 1.2, 0.3], [-d + 1.3, -d + 0.9, -0.2], [d - 0.9, d - 2.2, 0.5]]:
		_box(Vector3(p[0], 0.4, p[1]), Vector3(0.8, 0.8, 0.8), wood, p[2])
	_box(Vector3(-d + 0.8, 1.1, -d + 1.1), Vector3(0.6, 0.6, 0.6), wood, 0.6)
	# 垃圾子母車
	_box(Vector3(d - 0.6, 0.6, -d + 2.0), Vector3(1.9, 1.2, 1.0), metal_g, 0.25)
	_box(Vector3(d - 0.6, 1.23, -d + 2.0), Vector3(2.0, 0.08, 1.1), dark, 0.25)
	_box(Vector3(-d + 0.4, 0.6, d - 3.4), Vector3(1.9, 1.2, 1.0), metal_b, -0.4)
	# 鐵桶
	for p in [[d - 2.4, -d + 0.9], [d - 3.2, -d + 1.3], [-d + 2.6, d - 2.6]]:
		_cyl(Vector3(p[0], 0.45, p[1]), 0.3, 0.9, metal_b if p[0] > 0 else metal_g)
	# 三角錐
	var cone := _flat(Color(0.95, 0.42, 0.12), 0.6)
	for p in [[-3.8, d - 0.6], [4.4, d - 0.2], [d - 0.4, 1.8]]:
		_cyl(Vector3(p[0], 0.3, p[1]), 0.19, 0.6, cone, 0.03)
		_box(Vector3(p[0], 0.02, p[1]), Vector3(0.46, 0.04, 0.46), cone)
