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
		"key_from": Vector3(-7, 11, 5), "key_color": Color(1.0, 0.95, 0.84), "key_energy": 1.55,
		"rim_from": Vector3(3, 6, -10), "rim_color": Color(1.0, 0.98, 0.92), "rim_energy": 0.7,
		"fill_from": Vector3(4, 5, 10), "fill_color": Color(0.55, 0.7, 1.0), "fill_energy": 0.28,
		"bounce_color": Color(0.95, 0.82, 0.62), "bounce_energy": 0.22,
		"sky_top": Color(0.22, 0.42, 0.80), "sky_horizon": Color(0.66, 0.78, 0.92), "ambient": Color(0.52, 0.64, 0.92), "ambient_energy": 0.62,
		"fog": Color(0.68, 0.78, 0.92), "fog_density": 0.0016, "exposure": 0.98, "contrast": 1.08, "saturation": 1.1,
		"window": 0.0, "neon": 0.5, "neon_light": 0.0, "flood": 0.0, "glow": 0.2, "vignette": 0.18, "contact": 0.55,
	},
	"dusk": {
		"name": "黃昏",
		"key_from": Vector3(-9, 7.2, 5.5), "key_color": Color(1.0, 0.58, 0.28), "key_energy": 2.0,
		"rim_from": Vector3(-5, 5, -9), "rim_color": Color(1.0, 0.62, 0.3), "rim_energy": 1.3,
		"fill_from": Vector3(6, 5, 9), "fill_color": Color(0.42, 0.5, 0.95), "fill_energy": 0.42,
		"bounce_color": Color(1.0, 0.58, 0.36), "bounce_energy": 0.3,
		"sky_top": Color(0.16, 0.2, 0.48), "sky_horizon": Color(1.0, 0.56, 0.3), "ambient": Color(0.56, 0.5, 0.8), "ambient_energy": 1.05,
		"fog": Color(0.9, 0.52, 0.36), "fog_density": 0.0032, "exposure": 1.1, "contrast": 1.05, "saturation": 1.15,
		"window": 1.0, "neon": 1.6, "neon_light": 0.6, "flood": 0.3, "glow": 0.45, "vignette": 0.3, "contact": 0.5,
	},
	"night": {
		"name": "夜晚",
		"key_from": Vector3(7, 12, -8), "key_color": Color(0.55, 0.68, 1.0), "key_energy": 0.75,
		"rim_from": Vector3(4, 7, -9), "rim_color": Color(0.5, 0.72, 1.0), "rim_energy": 1.5,
		"fill_from": Vector3(2, 5, 10), "fill_color": Color(0.45, 0.5, 0.9), "fill_energy": 0.32,
		"bounce_color": Color(0.4, 0.45, 0.7), "bounce_energy": 0.18,
		"sky_top": Color(0.02, 0.03, 0.09), "sky_horizon": Color(0.08, 0.11, 0.24), "ambient": Color(0.32, 0.4, 0.72), "ambient_energy": 0.95,
		"fog": Color(0.05, 0.07, 0.15), "fog_density": 0.0035, "exposure": 1.25, "contrast": 1.04, "saturation": 1.12,
		"window": 2.4, "neon": 3.0, "neon_light": 1.0, "flood": 1.0, "glow": 0.75, "vignette": 0.38, "contact": 0.45,
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
var backdrop_mats: Array = []     # 遠景大樓的材質（隨時段換色）
var quality := 2                   # 畫質：2 高、1 中、0 低
const QUALITY_NAMES := ["低", "中", "高"]

func _init() -> void:
	_build_env()
	_build_ground()
	_build_buildings()
	_build_props()
	_build_backdrop()
	set_tod("day")

# ---------------- 材質 ----------------
func _tex(n: String) -> Texture2D:
	return load("res://assets/textures/%s.jpg" % n)

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
func add_character(node: Node3D, radius := 0.55) -> void:
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
	blob.material_override = contact_mat(0.05, 0.05)
	blob.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	blob.position.y = 0.02
	blob.top_level = true
	blob.name = "ContactShadow"
	add_child(blob)
	blob.set_meta("follow", node)
	set_process(true)

func _process(dt: float) -> void:
	var target := 1.0
	for c in get_children():
		if c.has_meta("follow"):
			var n: Node3D = c.get_meta("follow")
			if not is_instance_valid(n): continue
			(c as Node3D).global_position = Vector3(n.global_position.x, 0.02, n.global_position.z)
			target = lit_amount(n.global_position)
	# 進出建築影子時平滑過渡
	char_lit = lerpf(char_lit, target, minf(1.0, dt * 7.0))
	char_key.light_energy = key_base * char_lit

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
		sp.shadow_opacity = 0.8
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

func set_tod(name: String) -> void:
	tod = name
	var t: Dictionary = TOD[name]
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
	var sx: Dictionary = SKY_EXTRA[name]
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
func set_quality(q: int) -> void:
	quality = clampi(q, 0, 2)
	var vp := get_viewport()
	if vp != null:
		vp.msaa_3d = Viewport.MSAA_4X if quality >= 2 else Viewport.MSAA_DISABLED
		vp.scaling_3d_scale = [0.6, 0.8, 1.0][quality]
	RenderingServer.directional_shadow_atlas_set_size([1024, 2048, 4096][quality], true)
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if quality >= 2 else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	env.glow_enabled = quality >= 1
	set_tod(tod)

# ---------------- 地面與人行道 ----------------
func _build_ground() -> void:
	# 外圍柏油路（重複貼圖）
	var outer := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(700, 700)   # 鋪到很遠，配合霧和天空球的城市剪影，看不到地面的邊緣
	outer.mesh = pm
	outer.material_override = pbr("asphalt", 175.0, false, Color(0.52, 0.52, 0.54))
	outer.position.y = -0.02
	add_child(outer)
	# 打鬥區：不重複的大張路面（有裂縫、修補痕跡）
	var ground := MeshInstance3D.new()
	var gm := PlaneMesh.new()
	gm.size = Vector2(37, 37)
	ground.mesh = gm
	ground.material_override = pbr("groundbig", 1.0, false, Color(0.74, 0.74, 0.76))
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
