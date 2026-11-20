class_name EnemyRig
# 敵人角色：模型 ＋ 移動（走路或跑步）、被打、出拳、倒下的動作 ＋ 腳貼地。種類見 KINDS。
# 做法跟主角一樣：Mixamo 骨架對應、匯入時修正輪廓、BodyFix 把腳站回地面。
# 動作庫和材質全部敵人共用一份，一次生很多隻才不會慢。

const SCALE := 1.95            # 模型原始高度約 1，放大成 1.95 公尺。主角是 1.8 公尺但頭比較大；敵人照 1.7 公尺時使用者說跟主角比起來太小
const HIPS_RAISE := 0.009      # 整個人抬高的量（模型單位），用 tools/enemy_check.gd 實測校正
# 敵人種類：[模型, 移動用的動作, 整個人抬高的量（模型單位，用 tools/enemy_check.gd 實測校正）]
# 被打、出拳、倒下的動作所有種類共用
const KINDS := {
	"grunt": ["res://assets/enemy/badguy_1.glb", "walk", 0.009],      # 小嘍囉：走路
	"runner": ["res://assets/enemy/badguy_2.glb", "run", 0.006],      # 快腿仔：跑步
	"tank": ["res://assets/enemy/badguy_3.glb", "walk_tank", 0.009],  # 肉盾：自己的走路動作（步伐沉重）
}
# 動作：[檔案, 中文名, 是否循環]。出拳直接用主角的直拳動作檔（主角和敵人是同一套骨架對照，可以共用）
const ANIMS := {"walk": ["res://assets/enemy/walk.fbx", "走路", true], "run": ["res://assets/enemy/run.fbx", "跑步", true], "walk_tank": ["res://assets/enemy/walk_tank.fbx", "走路", true], "hit": ["res://assets/enemy/hit.fbx", "被打", false], "punch": ["res://assets/anims/cross_punch.fbx", "出拳", false], "fall": ["res://assets/enemy/fall.fbx", "倒下", false]}
# 倒下的動作：往後倒、躺平（約第 50 格躺好）。身體的位移是動作的一部分，要完整保留
const FALL_ENTER := 6
const FALL_DOWN := 52
const FALL_SPEED := 1.5
# 出拳的時間點（30 格／秒的格數）：從哪一格開始播、哪一格打到、整段到哪一格；以及播放倍率
const PUNCH_ENTER := 10
const PUNCH_IMPACT := 24
const PUNCH_END := 40
const PUNCH_SPEED := 1.25
# 走路動作本身的前進速度（公尺／秒，已乘上 SCALE）：遊戲裡依實際移動速度調整播放倍率，腳才不會滑
static var walk_speed := 1.0     # 小嘍囉走路的速度（舊的量測工具還在用）
static var move_raw := {}       # 動作名稱 → 動作檔裡的前進速度（動作檔自己的單位，要乘上骨架的位移比例才是模型單位）
static var mats := {}           # 種類 → 共用材質

static var lib: AnimationLibrary = null
static var flash_mat: StandardMaterial3D = null

static func _prepare() -> void:
	if lib != null: return
	lib = AnimationLibrary.new()
	for k in ANIMS:
		var sc: Node = load(ANIMS[k][0]).instantiate()
		var ap: AnimationPlayer = sc.find_children("*", "AnimationPlayer", true, false)[0]
		var an: Animation = ap.get_animation(ap.get_animation_list()[0]).duplicate()
		var dist := _strip_root_motion(an) if k != "fall" else 0.0
		if ANIMS[k][2]: move_raw[k] = dist / an.length
		an.loop_mode = Animation.LOOP_LINEAR if ANIMS[k][2] else Animation.LOOP_NONE
		lib.add_animation(k, an)
		sc.free()
	# 被打中時疊上去的白色閃光
	flash_mat = StandardMaterial3D.new()
	flash_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	flash_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	flash_mat.albedo_color = Color(0.75, 0.75, 0.75)

# 把髖部的水平位移拿掉（原地播放，移動交給遊戲），回傳原本整段動作前進的距離（模型單位）
static func _strip_root_motion(an: Animation) -> float:
	for t in an.get_track_count():
		if an.track_get_type(t) != Animation.TYPE_POSITION_3D: continue
		if not str(an.track_get_path(t)).ends_with(":Hips"): continue
		var n := an.track_get_key_count(t)
		if n == 0: continue
		var p0: Vector3 = an.track_get_key_value(t, 0)
		var p1: Vector3 = an.track_get_key_value(t, n - 1)
		for i in n:
			var p: Vector3 = an.track_get_key_value(t, i)
			# 只拿掉「等速前進」的部分，身體左右前後的小晃動保留
			var k := float(i) / maxf(1.0, n - 1)
			an.track_set_key_value(t, i, Vector3(p.x - p0.x - (p1.x - p0.x) * k, p.y, p.z - p0.z - (p1.z - p0.z) * k))
		return Vector2(p1.x - p0.x, p1.z - p0.z).length()
	return 0.0

# 建立一隻敵人。回傳 {node, skel, anim, fix, meshes, move（移動用的動作名稱）, move_speed（該動作原速的前進速度，公尺／秒）}
static func build(kind := "grunt", scale_mul := 1.0) -> Dictionary:
	_prepare()
	if not KINDS.has(kind): kind = "grunt"
	var K: Array = KINDS[kind]
	var node: Node3D = load(K[0]).instantiate()
	node.scale = Vector3.ONE * SCALE * scale_mul
	var skel: Skeleton3D = node.find_children("*", "Skeleton3D", true, false)[0]
	var meshes: Array = node.find_children("*", "MeshInstance3D", true, false)
	for m in meshes:
		var mi: MeshInstance3D = m
		if not mats.has(kind):
			# 材質修正跟主角同樣的理由：自動產生的金屬度／粗糙度貼圖不可靠，凹凸貼圖是雜訊
			var shared_mat: StandardMaterial3D = mi.mesh.surface_get_material(0).duplicate()
			if not use_pbr:
				shared_mat.metallic = 0.0
				shared_mat.metallic_texture = null
				shared_mat.roughness_texture = null
				shared_mat.roughness = 0.78
			shared_mat.normal_enabled = false
			shared_mat.disable_receive_shadows = true     # 理由同主角：陰影貼圖會在角色身上畫出條紋
			mats[kind] = shared_mat
		for i in mi.mesh.get_surface_count(): mi.set_surface_override_material(i, mats[kind])
		mi.lod_bias = lod_bias
	var move_speed: float = move_raw[K[1]] * skel.motion_scale * SCALE
	if kind == "grunt": walk_speed = move_speed
	var fix := BodyFix.new()
	fix.name = "BodyFix"
	fix.setup(skel, (meshes[0] as MeshInstance3D).skin)
	fix.hips_raise = K[2]
	fix.head_lift = 0.0
	fix.foot_lock = false          # 敵人一直在走，腳不能固定在地上
	fix.foot_ik = foot_ik
	skel.add_child(fix)
	var anim := AnimationPlayer.new()
	node.add_child(anim)
	anim.add_animation_library("", lib)
	return {"node": node, "skel": skel, "anim": anim, "fix": fix, "meshes": meshes, "move": K[1], "move_speed": move_speed, "kind": kind}

static var foot_ik := true      # 測試用開關
static var lod_bias := 1.0     # 遠距離簡化的傾向（越小越早換成面數少的版本）
static var use_pbr := true     # 用模型自帶的金屬度／粗糙度貼圖（關掉就是全身同一種反光）
