class_name Gore
extends Node3D
# 血腥表現（可以開關）：被打中時從命中點噴出血滴，落地後在地上留下血跡，過一陣子淡掉。
# 血滴和血跡各用一個多重網格批次繪製，數量有上限（循環使用最舊的），一次很多敵人也不會慢。
# 開關是靜態變數 Gore.enabled，存在 user://gore.cfg；關掉時 burst() 什麼都不做。

const MAX_DROPS := 520
const MAX_SPLATS := 320
const GRAVITY := 16.0
const SPLAT_LIFE := 6.0         # 血跡留在地上的秒數（最後兩秒淡出）。原本 14 秒，使用者要快一點消失
const SPLAT_RATE := 0.55       # 落地的血滴有多少比例會留下血跡
const SAVE_PATH := "user://gore.cfg"
static var enabled := true

var drops: Array = []          # 飛行中的血滴：{p, v, s}
var splats: Array = []         # 地上的血跡：{xf, t, a}
var splat_i := 0
var splat_live := 0             # 地上還有幾片血跡（沒有血的時候每格什麼都不用做）
var drop_mm := MultiMesh.new()
var splat_mm := MultiMesh.new()

static func load_saved() -> void:
	var cf := ConfigFile.new()
	if cf.load(SAVE_PATH) == OK: enabled = bool(cf.get_value("gore", "on", true))

static func set_enabled(on: bool) -> void:
	enabled = on
	var cf := ConfigFile.new()
	cf.set_value("gore", "on", on)
	cf.save(SAVE_PATH)

func _ready() -> void:
	# 血滴：小圓球，暗紅、帶一點反光
	var sm := SphereMesh.new()
	sm.radius = 0.5
	sm.height = 1.0
	sm.radial_segments = 6
	sm.rings = 3
	var dm := StandardMaterial3D.new()
	dm.albedo_color = Color(0.28, 0.008, 0.008)
	dm.roughness = 0.3
	dm.disable_receive_shadows = true
	sm.material = dm
	drop_mm.transform_format = MultiMesh.TRANSFORM_3D
	drop_mm.mesh = sm
	drop_mm.instance_count = MAX_DROPS
	drop_mm.visible_instance_count = 0
	var di := MultiMeshInstance3D.new()
	di.multimesh = drop_mm
	di.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	di.custom_aabb = AABB(Vector3(-40, -1, -40), Vector3(80, 12, 80))
	add_child(di)
	# 血跡：貼在地上的扁圓片，用每一片自己的透明度淡出
	var cm := CylinderMesh.new()
	cm.top_radius = 0.5
	cm.bottom_radius = 0.5
	cm.height = 0.004
	cm.radial_segments = 10
	cm.rings = 1
	var pm := StandardMaterial3D.new()
	pm.vertex_color_use_as_albedo = true
	pm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	pm.albedo_color = Color(0.19, 0.005, 0.005)      # 使用者要求比第一版（0.36）更深
	pm.roughness = 0.35
	cm.material = pm
	splat_mm.transform_format = MultiMesh.TRANSFORM_3D
	splat_mm.use_colors = true
	splat_mm.mesh = cm
	splat_mm.instance_count = MAX_SPLATS
	for i in MAX_SPLATS:
		splat_mm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ZERO), Vector3.ZERO))
		splat_mm.set_instance_color(i, Color(1, 1, 1, 0))
		splats.append(null)
	var si := MultiMeshInstance3D.new()
	si.multimesh = splat_mm
	si.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	si.custom_aabb = AABB(Vector3(-40, -1, -40), Vector3(80, 2, 80))
	add_child(si)

# 噴血：pos 是命中點，dir 是出拳方向（血往那邊噴），amount 是血滴數量，power 是力道（越大噴越遠）
func burst(pos: Vector3, dir: Vector3, amount: int, power := 1.0) -> void:
	if not enabled: return
	_mist(pos, dir, power)
	for i in amount:
		if drops.size() >= MAX_DROPS: drops.pop_front()
		var d := (dir + Vector3(randf_range(-0.55, 0.55), 0.0, randf_range(-0.55, 0.55))).normalized()
		var v := d * randf_range(1.2, 4.6) * power + Vector3(0, randf_range(0.6, 3.6) * power, 0)
		drops.append({"p": pos + Vector3(randf_range(-0.08, 0.08), randf_range(-0.1, 0.1), randf_range(-0.08, 0.08)), "v": v, "s": randf_range(0.06, 0.15), "mark": randf() < SPLAT_RATE})

# 命中瞬間的一團血霧：幾顆暗紅色的球從命中點順著出拳方向迅速膨脹、淡掉。
# 光靠小血滴在遠鏡頭下不夠明顯（使用者要求噴血更明顯），這一團是讓人一眼看到「噴了」的主體
var mist_mesh: SphereMesh = null
func _mist(pos: Vector3, dir: Vector3, power: float) -> void:
	if mist_mesh == null:
		mist_mesh = SphereMesh.new()
		mist_mesh.radius = 0.5
		mist_mesh.height = 1.0
		mist_mesh.radial_segments = 10
		mist_mesh.rings = 5
	for i in 4:
		var m := MeshInstance3D.new()
		m.mesh = mist_mesh
		var mt := StandardMaterial3D.new()
		mt.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mt.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mt.albedo_color = Color(0.33, 0.0, 0.0, 0.8)
		m.material_override = mt
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var d := (dir + Vector3(randf_range(-0.5, 0.5), randf_range(0.0, 0.5), randf_range(-0.5, 0.5))).normalized()
		m.position = pos + d * 0.1
		m.scale = Vector3.ONE * 0.18
		add_child(m)
		var size := randf_range(0.45, 0.8) * power
		var tw := create_tween()
		tw.set_parallel(true)
		tw.tween_property(m, "position", pos + d * randf_range(0.5, 1.1) * power, 0.22).set_ease(Tween.EASE_OUT)
		tw.tween_property(m, "scale", Vector3.ONE * size, 0.22).set_ease(Tween.EASE_OUT)
		tw.tween_property(mt, "albedo_color:a", 0.0, 0.24).set_ease(Tween.EASE_IN)
		tw.chain().tween_callback(m.queue_free)

# 清掉所有血（關掉開關時用）
func clear() -> void:
	drops.clear()
	splat_live = 0
	for i in MAX_SPLATS:
		splats[i] = null
		splat_mm.set_instance_color(i, Color(1, 1, 1, 0))

func _splat(p: Vector3, size: float) -> void:
	var b := Basis(Vector3.UP, randf() * TAU) * Basis.from_scale(Vector3(size * randf_range(0.7, 1.5), 1.0, size * randf_range(0.7, 1.5)))
	# 每一片高一點點，疊在一起時才不會閃爍
	var xf := Transform3D(b, Vector3(p.x, 0.016 + (splat_i % 16) * 0.0006, p.z))
	if splats[splat_i] == null: splat_live += 1
	splats[splat_i] = {"t": SPLAT_LIFE}
	splat_mm.set_instance_transform(splat_i, xf)
	splat_mm.set_instance_color(splat_i, Color(1, 1, 1, 0.9))
	splat_i = (splat_i + 1) % MAX_SPLATS

func _process(dt: float) -> void:
	if drops.is_empty() and splat_live == 0:
		if drop_mm.visible_instance_count != 0: drop_mm.visible_instance_count = 0
		return
	var keep: Array = []
	for d in drops:
		var v: Vector3 = d.v
		v.y -= GRAVITY * dt
		var p: Vector3 = d.p + v * dt
		if p.y <= 0.02:
			# 落地：留下一片血跡。空中的血滴後來加大加多了，但地上的血跡使用者要維持第一版的量和大小，
			# 所以只有一部分血滴會留痕，大小也照第一版的範圍
			if d.mark: _splat(p, randf_range(0.035, 0.085) * randf_range(2.2, 4.5))
			continue
		d.v = v
		d.p = p
		keep.append(d)
	drops = keep
	drop_mm.visible_instance_count = drops.size()
	for i in drops.size():
		var d = drops[i]
		# 沿飛行方向拉長一點，看起來像甩出去的血滴
		var v: Vector3 = d.v
		var s: float = d.s
		var b := Basis.from_scale(Vector3(s, s, s))
		if v.length() > 0.5:
			var z := v.normalized()
			var x := z.cross(Vector3.UP if absf(z.y) < 0.95 else Vector3.RIGHT).normalized()
			b = Basis(x * s, z.cross(x) * s, z * s * (1.0 + minf(2.0, v.length() * 0.3)))
		drop_mm.set_instance_transform(i, Transform3D(b, d.p))
	for i in MAX_SPLATS:
		if splats[i] == null: continue
		splats[i].t -= dt
		var t: float = splats[i].t
		if t <= 0.0:
			splats[i] = null
			splat_live -= 1
			splat_mm.set_instance_color(i, Color(1, 1, 1, 0))
		elif t < 2.0:
			splat_mm.set_instance_color(i, Color(1, 1, 1, 0.9 * t / 2.0))
