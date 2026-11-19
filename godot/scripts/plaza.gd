class_name Plaza
extends Street
# 廟口廣場：北面是紅柱琉璃瓦的武館大殿和牌樓，東西兩側是店面和夜市攤位，
# 地面是石板鋪面，中央一圈圈放射狀的石雕圓盤當擂台，四周一圈紅燈籠。
# 打光、天空、日夜循環、畫質分級都沿用 Street；這裡只換掉場景的內容。
# 打擊區上方不掛任何東西，俯視鏡頭下不會擋到角色。

var lamp_mats: Array = []       # 入夜才亮的發光材質：[材質, 最亮時的強度, 白天的強度]
var lantern_lights: Array = []  # 燈籠柱上的光：[OmniLight3D, 最亮時的強度]

# ---------------- 小工具 ----------------
func _prism(pos: Vector3, size: Vector3, mat: Material, rot_y := 0.0) -> MeshInstance3D:
	# 三角柱（屋頂、棚子）。size 是 (山牆寬, 高, 屋脊長)；屋脊沿 Z，要沿 X 就轉 90 度
	var mi := MeshInstance3D.new()
	var pm := PrismMesh.new()
	pm.size = size
	mi.mesh = pm
	mi.material_override = mat
	mi.position = pos
	mi.rotation.y = rot_y
	add_child(mi)
	return mi

func _ball(pos: Vector3, r: float, mat: Material, squash := 1.0) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = r
	sm.height = r * 2.0 * squash
	sm.radial_segments = 14
	sm.rings = 8
	mi.mesh = sm
	mi.material_override = mat
	mi.position = pos
	add_child(mi)
	return mi

# 同一種小東西畫很多個（燈籠、燈泡）：用一次繪製完成
func _multi(mesh: Mesh, mat: Material, xfs: Array) -> void:
	if xfs.is_empty(): return
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = xfs.size()
	for i in xfs.size(): mm.set_instance_transform(i, xfs[i])
	var n := MultiMeshInstance3D.new()
	n.multimesh = mm
	n.material_override = mat
	n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(n)

# 會發光的材質（入夜變亮）
func _glow(c: Color, night: float, day := 0.15) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 0.5
	m.emission_enabled = true
	m.emission = c
	m.emission_energy_multiplier = day
	lamp_mats.append([m, night, day])
	return m

# 條紋布（攤位的棚子）
func _stripes(c: Color) -> StandardMaterial3D:
	var img := Image.create(32, 4, false, Image.FORMAT_RGB8)
	for x in 32:
		for y in 4: img.set_pixel(x, y, c if (x / 4) % 2 == 0 else Color(0.92, 0.9, 0.84))
	var m := StandardMaterial3D.new()
	m.albedo_texture = ImageTexture.create_from_image(img)
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	m.roughness = 0.9
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.uv1_triplanar = true
	m.uv1_world_triplanar = true
	m.uv1_scale = Vector3(0.5, 0.5, 0.5)
	return m

func _sign(text: String, pos: Vector3, rot: float, col: Color, size := 150, board := true) -> void:
	var lb := Label3D.new()
	lb.text = text
	lb.font = load("res://assets/fonts/NotoSansTC.ttf")
	lb.font_size = size
	lb.pixel_size = 0.0055
	lb.outline_size = 0
	lb.shaded = false
	lb.double_sided = false
	lb.position = pos
	lb.rotation.y = rot
	add_child(lb)
	neon_labels.append([lb, col])
	if board:
		var n := Vector3(sin(rot), 0, cos(rot))
		_box(pos - n * 0.06, Vector3(size * 0.0055 * text.length() + 0.5, size * 0.0055 * 1.25 + 0.25, 0.08), _flat(Color(0.05, 0.04, 0.04), 0.6), rot)

# ---------------- 地面 ----------------
func _build_ground() -> void:
	# 石板鋪面（重複貼圖），鋪到很遠
	var outer := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(700, 700)
	outer.mesh = pm
	outer.material_override = wettable(pbr("paving", 700.0 / 3.2, false, Color(0.5, 0.49, 0.48)))
	outer.position.y = -0.01
	add_child(outer)
	# 中央的石雕圓盤（不重複的大張貼圖，圓外透明）：擂台
	var disc := MeshInstance3D.new()
	var dm := CylinderMesh.new()
	dm.top_radius = 10.34
	dm.bottom_radius = 10.34
	dm.height = 0.008
	dm.radial_segments = 72
	disc.mesh = dm
	# 用世界座標從正上方投影貼圖：一張貼圖剛好蓋住 21 公尺見方，中心對準原點
	var mat: StandardMaterial3D = pbr("plaza", 1.0 / 21.0, true, Color(0.56, 0.55, 0.53))
	mat.uv1_offset = Vector3(0.5, 0.5, 0.5)
	wettable(mat)
	disc.material_override = mat
	disc.position.y = 0.004
	disc.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	disc.set_meta("snow", true)   # 擂台不投影，但要積雪
	add_child(disc)
	# 積水：很光滑的深色薄片，會反射天空和燈光
	var water := StandardMaterial3D.new()
	water.albedo_color = Color(0.05, 0.055, 0.065, 0.3)
	water.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	water.roughness = 0.04
	water.metallic_specular = 1.0
	puddle_mats.append(water)
	for p in [[-8.6, 6.2, 1.5, 0.9], [9.4, 3.4, 1.1, 1.4], [6.8, -8.8, 1.7, 0.8], [-10.2, -3.6, 0.9, 1.2], [2.6, 10.6, 1.3, 0.7], [-4.8, 9.6, 0.7, 0.9]]:
		var w := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 1.0
		cm.bottom_radius = 1.0
		cm.height = 0.002
		cm.radial_segments = 24
		w.mesh = cm
		w.material_override = water
		w.position = Vector3(p[0], 0.008, p[1])
		w.scale = Vector3(p[2], 1, p[3])
		w.rotation.y = p[0] * 0.7
		w.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(w)

# ---------------- 建築 ----------------
func _build_buildings() -> void:
	var red_wall: StandardMaterial3D = pbr("plaster", 0.3, true, Color(0.62, 0.17, 0.12), "redwall")
	var lacquer := _flat(Color(0.5, 0.07, 0.05), 0.32)
	var stone: StandardMaterial3D = pbr("concrete", 0.4, true, Color(0.74, 0.72, 0.68))
	var roof: StandardMaterial3D = pbr("rooftile", 0.5, true, Color(1.0, 1.0, 1.0))
	roof.uv1_triplanar_sharpness = 4.0
	var trim := _flat(Color(0.08, 0.26, 0.28), 0.5)
	var gold := _flat(Color(0.85, 0.62, 0.18), 0.35, 0.6)
	var dark_wood: StandardMaterial3D = pbr("wood", 0.8, true, Color(0.32, 0.2, 0.14))
	# ---- 武館大殿（北面） ----
	var hz := -17.6
	_box(Vector3(0, 0.3, hz + 0.6), Vector3(24, 0.6, 11), stone)                      # 台基
	for i in 3: _box(Vector3(0, 0.1 + i * 0.2, hz + 6.4 + (2 - i) * 0.4), Vector3(8, 0.2, 0.5), stone)   # 台階
	_box(Vector3(0, 0.6 + 2.6, hz), Vector3(17, 5.2, 6.5), red_wall)                 # 殿身
	occluders.append(AABB(Vector3(-10.5, 0, hz - 4.5), Vector3(21, 11.0, 9.5)))
	for x in [-7.5, -4.5, -1.6, 1.6, 4.5, 7.5]:
		_cyl(Vector3(x, 0.6 + 2.6, hz + 3.9), 0.27, 5.2, lacquer)                    # 前廊紅柱
		_box(Vector3(x, 0.72, hz + 3.9), Vector3(0.75, 0.24, 0.75), stone)           # 柱礎
	_box(Vector3(0, 5.95, hz + 0.6), Vector3(20.5, 0.34, 9.8), trim)                 # 簷下的彩繪橫樑
	_prism(Vector3(0, 6.95, hz + 0.6), Vector3(10.6, 1.7, 21.5), roof, PI / 2)       # 下層屋頂
	_box(Vector3(0, 8.3, hz), Vector3(11, 1.6, 4.4), red_wall)                       # 上層
	_box(Vector3(0, 9.25, hz), Vector3(13.4, 0.3, 6.4), trim)
	_prism(Vector3(0, 10.5, hz), Vector3(7.4, 2.2, 14.6), roof, PI / 2)              # 上層屋頂
	_box(Vector3(0, 11.72, hz), Vector3(13.2, 0.26, 0.4), gold)                      # 屋脊
	for sx in [-1, 1]:
		_box(Vector3(sx * 6.9, 11.95, hz), Vector3(0.5, 0.7, 0.45), gold)            # 屋脊兩端的脊飾
		_box(Vector3(sx * 10.6, 6.25, hz + 5.3), Vector3(0.5, 0.5, 0.5), gold)       # 簷角
	# 大門與格子窗（入夜透出暖光）
	_box(Vector3(0, 2.4, hz + 3.28), Vector3(3.2, 3.6, 0.1), dark_wood)
	var win := _glow(Color(1.0, 0.72, 0.36), 2.6, 0.0)
	for x in [-6.0, -3.1, 3.1, 6.0]:
		_box(Vector3(x, 2.8, hz + 3.28), Vector3(1.9, 2.2, 0.06), win)
		for k in 3: _box(Vector3(x - 0.5 + k * 0.5, 2.8, hz + 3.32), Vector3(0.06, 2.2, 0.04), dark_wood)
		_box(Vector3(x, 2.8, hz + 3.32), Vector3(1.9, 0.06, 0.04), dark_wood)
	_sign("武館", Vector3(0, 4.9, hz + 3.5), 0.0, Color(1.0, 0.82, 0.3), 230)
	# ---- 牌樓（大殿前） ----
	var gz := -10.6
	for x in [-5.4, -2.3, 2.3, 5.4]:
		var h := 5.6 if absf(x) < 3.0 else 4.6
		_cyl(Vector3(x, h * 0.5, gz), 0.24, h, lacquer)
		_box(Vector3(x, 0.3, gz), Vector3(0.85, 0.6, 0.85), stone)
	_box(Vector3(0, 5.2, gz), Vector3(5.4, 0.5, 0.36), trim)
	_box(Vector3(0, 4.3, gz), Vector3(11.4, 0.4, 0.34), lacquer)
	_prism(Vector3(0, 6.1, gz), Vector3(1.9, 0.9, 6.4), roof, PI / 2)
	for sx in [-1, 1]:
		_prism(Vector3(sx * 3.9, 5.05, gz), Vector3(1.6, 0.7, 3.9), roof, PI / 2)
		_box(Vector3(sx * 3.85, 4.72, gz), Vector3(3.6, 0.2, 0.4), trim)
	_sign("龍拳街", Vector3(0, 4.78, gz + 0.22), 0.0, Color(1.0, 0.82, 0.3), 110)
	# ---- 東西兩側的店面 ----
	var shops := [["麵", Color(1.0, 0.31, 0.42)], ["茶", Color(0.4, 1.0, 0.5)], ["當舖", Color(0.25, 0.88, 0.77)], ["酒", Color(1.0, 0.81, 0.23)], ["旅社", Color(1.0, 0.54, 0.24)], ["理髮", Color(0.31, 0.64, 1.0)]]
	var facades := ["brick", "plaster", "brick2"]
	var tints := [Color(1, 0.96, 0.92), Color(0.92, 0.9, 0.86), Color(0.96, 0.94, 1.0)]
	var si := 0
	for sx in [-1, 1]:
		for k in 3:
			var z := -8.6 + k * 8.2
			var h: float = [7.2, 8.4, 6.6][(k + (0 if sx < 0 else 1)) % 3]
			var c := Vector3(sx * 17.2, 0, z)
			var fm: StandardMaterial3D = pbr(facades[(k + si) % 3], 1.0 / 7.0, true, tints[(k + si) % 3], "shop%d" % si)
			fm.emission_enabled = true
			fm.emission_texture = _tex(facades[(k + si) % 3] + "_emit")
			fm.emission_energy_multiplier = 0.0
			facade_mats.append(fm)
			_box(c + Vector3(0, h * 0.5, 0), Vector3(6.0, h, 7.6), fm)
			occluders.append(AABB(c + Vector3(-3.0, 0, -3.8), Vector3(6.0, h, 7.6)))
			_box(c + Vector3(0, h + 0.14, 0), Vector3(6.3, 0.28, 7.9), stone)
			_box(c + Vector3(0, 0.3, 0), Vector3(6.1, 0.6, 7.7), stone)
			# 騎樓的雨遮（斜的條紋布）和招牌
			var aw := _box(c + Vector3(-sx * 3.7, 3.0, 0), Vector3(1.7, 0.06, 6.4), _stripes([Color(0.75, 0.16, 0.14), Color(0.14, 0.36, 0.6), Color(0.16, 0.5, 0.3)][(k + si) % 3]))
			aw.rotation.z = sx * 0.3
			var sg: Array = shops[si % shops.size()]
			_sign(sg[0], c + Vector3(-sx * 3.06, 4.3, 0), -sx * PI / 2, sg[1], 150)
			if k != 1:
				var ol := OmniLight3D.new()
				ol.light_color = sg[1]
				ol.omni_range = 8.5
				ol.omni_attenuation = 1.1
				ol.shadow_enabled = false
				ol.position = c + Vector3(-sx * 4.2, 3.4, 0)
				add_child(ol)
				neon_lights.append([ol, 2.0])
			# 牆腳的接地暗影
			var ao := MeshInstance3D.new()
			var apm := PlaneMesh.new()
			apm.size = Vector2(9.0, 10.6)
			ao.mesh = apm
			ao.material_override = contact_mat(6.0 / 9.0, 7.6 / 10.6)
			ao.position = c + Vector3(0, 0.014, 0)
			ao.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(ao)
			si += 1
	# 大殿的接地暗影
	var ao2 := MeshInstance3D.new()
	var apm2 := PlaneMesh.new()
	apm2.size = Vector2(28, 15)
	ao2.mesh = apm2
	ao2.material_override = contact_mat(24.0 / 28.0, 11.0 / 15.0)
	ao2.position = Vector3(0, 0.014, hz + 0.6)
	ao2.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(ao2)

# ---------------- 攤位、燈籠、樹、擺設 ----------------
func _build_props() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 4242
	var wood: StandardMaterial3D = pbr("wood", 1.2, true)
	var pole_mat := _flat(Color(0.1, 0.09, 0.09), 0.5, 0.4)
	var stone: StandardMaterial3D = pbr("concrete", 0.4, true, Color(0.74, 0.72, 0.68))
	var cloth_cols := [Color(0.78, 0.15, 0.13), Color(0.14, 0.36, 0.62), Color(0.9, 0.62, 0.1), Color(0.15, 0.5, 0.3)]
	var bulbs: Array = []
	# ---- 夜市攤位：東西兩側各一排、南邊一排 ----
	var stalls: Array = []
	for sx in [-1, 1]:
		for k in 5: stalls.append([Vector3(sx * 12.1, 0, -6.4 + k * 3.5), sx * PI / 2])
	for k in 4: stalls.append([Vector3(-5.6 + k * 3.7, 0, 12.6), PI])
	var gi := 0
	for st in stalls:
		var p: Vector3 = st[0]
		var rot: float = st[1]
		var b := Basis(Vector3.UP, rot)
		# 朝向擂台的方向是 -b.z
		_box(p + Vector3(0, 0.45, 0), Vector3(2.0, 0.9, 0.9), wood, rot)
		for c in [[-0.95, -0.4], [0.95, -0.4], [-0.95, 0.4], [0.95, 0.4]]:
			_cyl(p + b * Vector3(c[0], 1.15, c[1]), 0.035, 2.3, pole_mat)
		var canopy := _prism(p + Vector3(0, 2.55, 0), Vector3(1.5, 0.55, 2.5), _stripes(cloth_cols[gi % 4]), rot + PI / 2)
		canopy.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		# 攤子上的貨物
		for g in 5:
			var gc := Color.from_hsv(rng.randf(), 0.65, 0.85)
			var gp: Vector3 = p + b * Vector3(-0.75 + g * 0.37, 0.98, rng.randf_range(-0.2, 0.2))
			if g % 2 == 0: _box(gp, Vector3(0.26, 0.16, 0.3), _flat(gc, 0.7), rot)
			else: _ball(gp + Vector3(0, 0.03, 0), 0.11, _flat(gc, 0.5))
		# 棚子前緣的一串燈泡
		for g in 6: bulbs.append(Transform3D(Basis.IDENTITY, p + b * Vector3(-1.0 + g * 0.4, 2.22 - sin(g / 5.0 * PI) * 0.08, -0.72)))
		gi += 1
	var bulb_mesh := SphereMesh.new()
	bulb_mesh.radius = 0.055
	bulb_mesh.height = 0.11
	bulb_mesh.radial_segments = 8
	bulb_mesh.rings = 4
	_multi(bulb_mesh, _glow(Color(1.0, 0.86, 0.55), 5.0, 0.3), bulbs)
	# ---- 一圈紅燈籠：八根柱子圍著擂台，相鄰兩根之間拉一串（不經過擂台上方） ----
	var lanterns: Array = []
	var posts: Array = []
	for k in 8:
		var a := PI / 8 + k * PI / 4
		posts.append(Vector3(cos(a) * 10.4, 0, sin(a) * 10.4))
	var banner_cols := [Color(0.75, 0.12, 0.1), Color(0.9, 0.68, 0.15)]
	for k in 8:
		var p: Vector3 = posts[k]
		_cyl(p + Vector3(0, 2.9, 0), 0.07, 5.8, pole_mat)
		_box(p + Vector3(0, 0.2, 0), Vector3(0.5, 0.4, 0.5), stone)
		# 柱子上的旗幟
		var face := atan2(-p.x, -p.z)
		_box(p + Vector3(0, 3.7, 0) + Basis(Vector3.UP, face) * Vector3(0.36, 0, 0), Vector3(0.6, 1.7, 0.03), _flat(banner_cols[k % 2], 0.85), face)
		var q: Vector3 = posts[(k + 1) % 8]
		for i in range(1, 9):
			var t := i / 9.0
			var pos := p.lerp(q, t) + Vector3(0, 5.6 - sin(t * PI) * 0.95, 0)
			lanterns.append(Transform3D(Basis.IDENTITY, pos))
		# 燈籠的光：入夜才亮，照亮擂台的外圈
		var ol := OmniLight3D.new()
		ol.light_color = Color(1.0, 0.46, 0.2)
		ol.omni_range = 8.0
		ol.omni_attenuation = 1.2
		ol.shadow_enabled = false
		ol.position = p + Vector3(0, 4.6, 0) * 1.0 - Vector3(p.x, 0, p.z).normalized() * 0.8
		add_child(ol)
		lantern_lights.append([ol, 1.5])
	var lan_mesh := SphereMesh.new()
	lan_mesh.radius = 0.2
	lan_mesh.height = 0.46
	lan_mesh.radial_segments = 10
	lan_mesh.rings = 6
	_multi(lan_mesh, _glow(Color(0.95, 0.16, 0.1), 3.4, 0.25), lanterns)
	# ---- 泛光燈的燈柱（燈本身在 Street 裡建立，這裡補上柱子） ----
	for f in floods:
		var fp: Vector3 = (f[0] as SpotLight3D).position
		_cyl(Vector3(fp.x, fp.y * 0.5, fp.z), 0.11, fp.y, pole_mat)
		_box(Vector3(fp.x, 0.25, fp.z), Vector3(0.6, 0.5, 0.6), stone)
	# ---- 大樹：四個角落 ----
	var bark: StandardMaterial3D = pbr("wood", 0.6, true, Color(0.36, 0.28, 0.22))
	var leaf := _flat(Color(0.13, 0.3, 0.12), 0.95)
	var leaf2 := _flat(Color(0.18, 0.38, 0.14), 0.95)
	for tp in [Vector3(-13.6, 0, -12.6), Vector3(13.6, 0, -12.6), Vector3(-10.4, 0, 15.2), Vector3(10.4, 0, 15.2)]:
		_cyl(tp + Vector3(0, 1.7, 0), 0.38, 3.4, bark, 0.24)
		_box(tp + Vector3(0, 0.12, 0), Vector3(2.0, 0.24, 2.0), stone)              # 樹池
		for i in 9:
			var off := Vector3(rng.randf_range(-1.7, 1.7), rng.randf_range(3.6, 5.6), rng.randf_range(-1.7, 1.7))
			_ball(tp + off, rng.randf_range(1.1, 1.9), leaf if i % 2 == 0 else leaf2, 0.85)
	# ---- 香爐與石獅（牌樓前） ----
	var bronze := _flat(Color(0.42, 0.3, 0.14), 0.42, 0.75)
	var cp := Vector3(0, 0, -8.9)
	for c in [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]: _cyl(cp + Vector3(c[0], 0.18, c[1]), 0.07, 0.36, bronze)
	_cyl(cp + Vector3(0, 0.72, 0), 0.62, 0.75, bronze, 0.7)
	_cyl(cp + Vector3(0, 1.14, 0), 0.74, 0.1, bronze)
	_ball(cp + Vector3(0, 1.22, 0), 0.55, _flat(Color(0.3, 0.29, 0.28), 1.0), 0.35)   # 香灰
	for sx in [-1, 1]:
		var lp := Vector3(sx * 6.6, 0, -9.3)
		_box(lp + Vector3(0, 0.4, 0), Vector3(0.9, 0.8, 1.2), stone)
		_box(lp + Vector3(0, 1.15, -0.05), Vector3(0.6, 0.75, 0.85), stone)
		_ball(lp + Vector3(0, 1.72, 0.2), 0.36, stone)

# ---------------- 隨時段變化的東西 ----------------
func _apply_extra(t: Dictionary) -> void:
	# 石材比柏油淺很多，泛光燈照原本的強度會把地面打到過曝，所以這個場景的泛光燈調弱
	for f in floods: (f[0] as SpotLight3D).light_energy *= 0.5
	var nl: float = t.neon_light        # 0 白天 → 1 夜晚
	for m in lamp_mats: (m[0] as StandardMaterial3D).emission_energy_multiplier = lerpf(m[2], m[1], nl)
	for l in lantern_lights:
		var ol: OmniLight3D = l[0]
		ol.light_energy = l[1] * nl
		ol.visible = nl > 0.01 and quality >= 1
