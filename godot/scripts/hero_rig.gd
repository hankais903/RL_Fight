class_name HeroRig
# 主角模型 ＋ Mixamo 動作庫（檢視器和遊戲共用）

const HERO_SCALE := 1.8
# 招式：[動作檔名, 命中格(30fps), 位移保留比例, 中文名, 連段進場格, 連段可接招格]
# 進場格：連段中從這一格開始播（保留轉腰、踏步的蓄力，跳過最前面站著不動的部分）
# 可接招格：打中後拳腳收回一半，從這裡可以接下一招
const MOVES := {
	"idle":  ["fighting_idle", -1, 1.0, "待機", 0, 0],
	"jab":   ["punching", 13, 1.0, "刺拳", 2, 19],
	"cross": ["cross_punch", 24, 1.0, "重拳", 12, 30],
	"hook":  ["hook_punch", 27, 1.0, "勾拳", 14, 36],
	"upper": ["uppercut", 12, 1.0, "上勾拳", 3, 18],
	"round": ["roundhouse_kick", 22, 0.5, "迴旋踢", 8, 29],
	"side":  ["side_kick", 14, 0.5, "側踢", 3, 22],
	"fly":   ["flying_kick", 9, 0.3, "飛踢", 0, 16],
}
const COMBO := ["jab", "cross", "hook", "upper", "round", "jab", "upper", "cross", "side", "fly"]

static var hair_physics := true      # 測試用開關：頭髮物理
static var face_fix := true          # 測試用開關：臉部權重修正
static var foot_ik := true           # 測試用開關：腳貼地
static var smooth_normals := false   # 測試用開關：重新計算平滑法線

# 回傳 {node, skel, anim}
static func build(trim_root := true) -> Dictionary:
	var hero: Node3D = load("res://assets/hero/hero.glb").instantiate()
	hero.scale = Vector3.ONE * HERO_SCALE
	var skel: Skeleton3D = hero.find_children("*", "Skeleton3D", true, false)[0]
	if smooth_normals: _smooth_normals(hero)
	if face_fix: _fix_face_weights(hero, skel)   # 臉部改成完全跟著頭（要最先做，後面的飄帶、頭髮會接著改同一份網格）
	# 身體修正（頭抬高、腳貼地）：要排在飄帶物理之前，飄帶才會碰到修正後的腿
	var fix := BodyFix.new()
	fix.name = "BodyFix"
	fix.setup(skel, (hero.find_children("*", "MeshInstance3D", true, false)[0] as MeshInstance3D).skin)
	fix.foot_ik = foot_ik
	skel.add_child(fix)
	var sash := SashSim.rig(hero, skel)   # 腰帶飄帶：加骨頭與物理（要在換材質之前做，因為會重建網格）
	var hair := HairSim.rig(hero, skel) if hair_physics else null   # 頭髮：加骨頭與物理（同樣會重建網格）
	_fix_materials(hero)
	var lib := AnimationLibrary.new()
	for k in MOVES:
		var sc: Node = load("res://assets/anims/%s.fbx" % MOVES[k][0]).instantiate()
		var ap: AnimationPlayer = sc.find_children("*", "AnimationPlayer", true, false)[0]
		var an: Animation = ap.get_animation(ap.get_animation_list()[0]).duplicate()
		if trim_root: _trim_root_motion(an, MOVES[k][2])
		an.loop_mode = Animation.LOOP_LINEAR if k == "idle" else Animation.LOOP_NONE
		lib.add_animation(k, an)
		sc.free()
	var anim := AnimationPlayer.new()
	hero.add_child(anim)
	anim.add_animation_library("", lib)
	return {"node": hero, "skel": skel, "anim": anim, "sash": sash, "fix": fix, "hair": hair}

# 原地出招：髖部的水平位移只保留一部分，移動交給遊戲（衝刺）
static func _trim_root_motion(an: Animation, keep: float) -> void:
	for t in an.get_track_count():
		if an.track_get_type(t) != Animation.TYPE_POSITION_3D: continue
		if not str(an.track_get_path(t)).ends_with(":Hips"): continue
		var n := an.track_get_key_count(t)
		if n == 0: continue
		var p0: Vector3 = an.track_get_key_value(t, 0)
		for i in n:
			var p: Vector3 = an.track_get_key_value(t, i)
			an.track_set_key_value(t, i, Vector3((p.x - p0.x) * keep, p.y, (p.z - p0.z) * keep))

# 材質修正：模型原本的粗糙度是雜亂色塊、白色滾邊被標成金屬。
# 換成依部位重新產生的粗糙度貼圖（tools/hero_pbr.py），金屬度歸零。
static func _fix_materials(hero: Node3D) -> void:
	var orm: Texture2D = load("res://assets/hero/hero_orm.png")
	for mi in hero.find_children("*", "MeshInstance3D", true, false):
		var mesh: Mesh = (mi as MeshInstance3D).mesh
		for i in mesh.get_surface_count():
			var m: BaseMaterial3D = mesh.surface_get_material(i).duplicate()
			m.metallic = 0.0
			m.metallic_texture = null
			m.roughness = 1.0
			m.roughness_texture = orm
			m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
			m.metallic_specular = 0.5
			# 模型附的凹凸貼圖幾乎是平的，只有零散的弧線雜訊，低角度的光一打會變成線條，所以關掉
			m.normal_enabled = false
			(mi as MeshInstance3D).set_surface_override_material(i, m)

# 重新計算平滑法線：把共用頂點的面法線平均，皺褶上的稜線會變圓
static func _smooth_normals(hero: Node3D) -> void:
	for mi in hero.find_children("*", "MeshInstance3D", true, false):
		var src: ArrayMesh = (mi as MeshInstance3D).mesh
		var out := ArrayMesh.new()
		for i in src.get_surface_count():
			var st := SurfaceTool.new()
			st.create_from(src, i)
			st.generate_normals()
			st.generate_tangents()
			st.commit(out)
			out.surface_set_material(i, src.surface_get_material(i))
		(mi as MeshInstance3D).mesh = out

# 臉部權重修正：模型原本把下巴到鼻子高度的頂點綁了一部分在脖子上，頭相對脖子一轉，臉就被拉扯變形。
# 這裡把下巴以上的頂點改成只跟著頭；下巴以下留一小段漸變接回原本的權重，脖子才不會出現折痕。
static func _fix_face_weights(hero: Node3D, sk: Skeleton3D) -> void:
	var mi: MeshInstance3D = hero.find_children("*", "MeshInstance3D", true, false)[0]
	var src: ArrayMesh = mi.mesh
	var arr := src.surface_get_arrays(0)
	var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var bones: PackedInt32Array = arr[Mesh.ARRAY_BONES]
	var weights: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
	var per := bones.size() / vs.size()
	var skin := mi.skin
	var head_bone := sk.find_bone("Head")
	var head_bind := -1
	for b in skin.get_bind_count():
		if skin.get_bind_bone(b) == head_bone or skin.get_bind_name(b) == &"Head": head_bind = b
	if head_bind < 0: return
	var hm: Vector3 = skin.get_bind_pose(head_bind).affine_inverse().origin      # 頭關節在網格座標的位置
	for i in vs.size():
		var v := vs[i]
		if v.y < hm.y - 0.008 or Vector2(v.x - hm.x, v.z - hm.z).length() > 0.14: continue
		# 頭關節下方 0.8 公分到上方 1.2 公分之間漸變；再往上（下巴以上）完全跟著頭
		var t := smoothstep(hm.y - 0.008, hm.y + 0.012, v.y)
		var slot := -1
		var smallest := 0
		for j in per:
			weights[i * per + j] *= 1.0 - t
			if bones[i * per + j] == head_bind and slot < 0: slot = j
			if weights[i * per + j] < weights[i * per + smallest]: smallest = j
		if slot < 0:
			slot = smallest
			bones[i * per + slot] = head_bind
			weights[i * per + slot] = 0.0
		weights[i * per + slot] += t
		# 重新正規化（把被取代掉的那一點點權重補回來）
		var sum := 0.0
		for j in per: sum += weights[i * per + j]
		if sum > 0.0001:
			for j in per: weights[i * per + j] /= sum
	arr[Mesh.ARRAY_BONES] = bones
	arr[Mesh.ARRAY_WEIGHTS] = weights
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr, [], {}, Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS if per == 8 else 0)
	am.surface_set_material(0, src.surface_get_material(0))
	mi.mesh = am
