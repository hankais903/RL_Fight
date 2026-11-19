class_name BodyFix
extends SkeletonModifier3D
# 動畫套用之後的身體修正（每格執行）：
#   1. 頭抬高一點（原本的備戰姿勢下巴收得太低）
#   2. 腳站回地面：補上主角球鞋和動作檔原始骨架之間的差異（鞋底厚度、腳掌角度）。
#      動作本身的腳跟起落、踮腳彈跳完全保留，不強制壓平。
#   3. 反向運動只當保險：鞋底低於地面才往上頂；前腳掌踩地時固定位置（不滑步）、修掉左右歪斜；腳趾踩地時壓平。

const HEAD_LIFT_NECK := 4.0     # 脖子往上抬的角度
const HEAD_LIFT_HEAD := 6.0     # 頭再往上抬的角度
# 動作檔（Mixamo）原始骨架的腳：腳踝→腳趾關節的方向，以及腳踝高度佔髖部高度的比例（由 js/hero_anims.js 的靜止姿勢算出）
const SRC_FOOT_DIR := {"Left": Vector3(0.083, -0.659, 0.748), "Right": Vector3(-0.096, -0.652, 0.753)}
const SRC_ANKLE_RATIO := 0.1176
# 整個人抬高的量（模型單位，模型身高約 1；0.012 ≈ 2.2 公分）。
# 主角球鞋比動作檔原始骨架的腳厚，不抬的話支撐腳的鞋底會陷在地面下約 3 公分。
# 這個值是實測校正的：用 tools/foot_check.gd --lows 量「支撐腳鞋底離地」，調到各招式的中位數接近 0。
# 不要用腳踝高度比例去推算——試過，會抬過頭、腳懸空 3 公分。換模型後要重新量。
const HIPS_RAISE := 0.012
const CONTACT_LO := 0.012       # 前腳掌離地這麼多以內：算踩地（模型單位，模型身高約 1）
const CONTACT_HI := 0.05        # 離地這麼多以上：完全不管
const SMOOTH := 16.0             # 修正量緩衝的速度（越大越跟手、越小越穩）
const LEASH := 0.05             # 踩地時前腳掌可以離固定點多遠；超過代表動作真的要它移動，固定點跟著走

static var dbg := ""            # 測試用：字串裡有 l／r／y／t／h 就關掉固定、歪斜、高度、腳趾、硬性不穿地
var foot_ik := true
var foot_lock := true           # 固定踩地的前腳掌（角色本身在移動時要關掉，例如衝刺）
var legs: Array = []
var hips := -1
var hips_raise := 0.0
var neck := -1
var head := -1
var sh_l := -1
var sh_r := -1

# 基準取自「模型原始綁定」：綁定時模型是鞋底貼平地面站著的（鞋底在網格 y=0）。
# 蒙皮的綁定矩陣 B 把網格座標轉到骨頭座標，所以：
#   骨頭座標裡的「鞋底朝上」方向 = B 的旋轉 × 上；骨頭原點離鞋底的高度 = B 反矩陣的原點高度
func setup(sk: Skeleton3D, skin: Skin) -> void:
	hips = sk.find_bone("Hips")
	neck = sk.find_bone("Neck")
	head = sk.find_bone("Head")
	sh_l = sk.find_bone("LeftShoulder")
	sh_r = sk.find_bone("RightShoulder")
	var bind := {}
	for i in skin.get_bind_count():
		var bi := skin.get_bind_bone(i)
		if bi < 0: bi = sk.find_bone(skin.get_bind_name(i))
		bind[bi] = skin.get_bind_pose(i)
	for s in ["Left", "Right"]:
		var f := sk.find_bone(s + "Foot")
		var t := sk.find_bone(s + "Toes")
		var bf: Transform3D = bind[f]
		var bt: Transform3D = bind[t]
		var fr := sk.get_bone_global_rest(f)
		var ankle_h: float = bf.affine_inverse().origin.y
		var toe_h: float = bt.affine_inverse().origin.y
		var sole_n := (bf.basis * Vector3.UP).normalized()
		var toe_local: Vector3 = fr.affine_inverse() * sk.get_bone_global_rest(t).origin
		# 動作檔認為的「鞋底朝上」：它原始骨架站平時腳掌朝 SRC_FOOT_DIR，匯入時被轉成和主角靜止姿勢同一個方向
		var ref_dir := (sk.get_bone_global_rest(t).origin - fr.origin).normalized()
		var src_n: Vector3 = fr.basis.inverse() * (Quaternion((SRC_FOOT_DIR[s] as Vector3).normalized(), ref_dir) * Vector3.UP)
		# 沿鞋底平面往腳尖的方向（用來找腳跟的位置）
		var fwd := (toe_local - sole_n * toe_local.dot(sole_n)).normalized()
		legs.append({
			"up": sk.find_bone(s + "UpperLeg"), "low": sk.find_bone(s + "LowerLeg"), "foot": f, "toes": t,
			"ankle_h": ankle_h, "toe_h": toe_h, "sole_n": sole_n,
			"toe_n": (bt.basis * Vector3.UP).normalized(), "toe_local": toe_local,
			"fix": Basis(Quaternion(sole_n, src_n.normalized())),          # 腳掌角度修正（骨頭座標）
			"ball_local": toe_local - sole_n * toe_h,                       # 前腳掌著地點（腳趾關節正下方的鞋底）
			"heel_local": -sole_n * ankle_h - fwd * 0.035,                  # 腳跟著地點
			"lat_local": fwd.cross(sole_n).normalized(),                    # 腳掌的左右方向
			"locked": false, "lock": Vector3.ZERO, "w": 0.0,
			"roll": 0.0, "dy": 0.0, "ox": 0.0, "oz": 0.0,          # 各項修正量的緩衝值
		})
	# 整個人要抬高多少才會站在地面上：用實測校正（見 HIPS_RAISE 的說明）
	hips_raise = HIPS_RAISE

static func _flatten(b: Basis, n_local: Vector3) -> Basis:
	# 把骨頭轉到「底面朝正上方」，水平朝向不變
	var n := (b * n_local).normalized()
	if n.dot(Vector3.UP) > 0.99999: return b
	return Basis(Quaternion(n, Vector3.UP)) * b

func _process_modification() -> void:
	var sk := get_skeleton()
	if sk == null: return
	# ---- 頭抬高 ----
	if neck >= 0 and head >= 0:
		var left := (sk.get_bone_global_pose(sh_l).origin - sk.get_bone_global_pose(sh_r).origin).normalized()
		var nk := sk.get_bone_global_pose(neck)
		sk.set_bone_global_pose(neck, Transform3D(Basis(Quaternion(left, deg_to_rad(-HEAD_LIFT_NECK))) * nk.basis, nk.origin))
		var hd := sk.get_bone_global_pose(head)
		sk.set_bone_global_pose(head, Transform3D(Basis(Quaternion(left, deg_to_rad(-HEAD_LIFT_HEAD))) * hd.basis, hd.origin))
	if not foot_ik: return
	# ---- 整個人抬高鞋底的厚度差 ----
	var hp := sk.get_bone_global_pose(hips)
	hp.origin.y += hips_raise
	sk.set_bone_global_pose(hips, hp)
	# ---- 腳 ----
	var xf := sk.global_transform
	var inv := xf.affine_inverse()
	var scale := xf.basis.get_scale().x
	var gy: float = (inv * Vector3(xf.origin.x, 0.0, xf.origin.z)).y      # 地面在骨架座標裡的高度
	var dt := clampf(get_process_delta_time(), 0.0, 0.05)
	var kf := 1.0 - exp(-dt * SMOOTH)                                      # 這一格緩衝值往目標靠近的比例
	for lg in legs:
		var up_t := sk.get_bone_global_pose(lg.up)
		var low_t := sk.get_bone_global_pose(lg.low)
		var foot_t := sk.get_bone_global_pose(lg.foot)
		var a := foot_t.origin
		# 腳掌角度修正（固定的小角度），之後腳跟的起落完全照動作
		var fb := foot_t.basis.orthonormalized() * (lg.fix as Basis)
		# 踩地程度：看前腳掌離地多高。不能瞬間跳變（每秒最多變 7 倍），否則腳會在門檻附近抖
		var ball_h: float = (a + fb * (lg.ball_local as Vector3)).y - gy
		lg.w = move_toward(lg.w, 1.0 - smoothstep(CONTACT_LO, CONTACT_HI, ball_h), dt * 7.0)
		var w: float = lg.w
		# 踩地時修掉左右歪斜（腳掌不會側翻），前後的踮腳角度不動。修正量經過緩衝
		var f_axis := (fb * (lg.toe_local as Vector3)).normalized()
		var lat := fb * (lg.lat_local as Vector3)
		var c := f_axis.cross(lat).y
		if absf(c) > 0.3 and not dbg.contains("r"): lg.roll = lerpf(lg.roll, clampf(-lat.y / c, -0.6, 0.6) * w, kf)
		else: lg.roll = lerpf(lg.roll, 0.0, kf)
		if absf(lg.roll) > 0.0005: fb = Basis(Quaternion(f_axis, lg.roll)) * fb
		var ball := a + fb * (lg.ball_local as Vector3)
		var heel := a + fb * (lg.heel_local as Vector3)
		var tgt := a
		# 高度：只保證不穿地。鞋底低於地面時立刻頂上來（硬性），離開後慢慢放掉，不會一格一格跳。
		# 不主動把腳往下拉去貼地——整個人的高度已經用鞋底厚度校正過，再拉會把小跳步吸在地上並造成抖動
		var low := minf(ball.y, heel.y) - gy
		var need := maxf(0.0, -low)
		lg.dy = need if need > lg.dy else lerpf(lg.dy, need, kf * 0.5)
		tgt.y += lg.dy
		# 固定前腳掌：踩地的腳固定在世界座標的一個點上，可以原地踮腳、轉動，但不會滑。拉力經過緩衝
		var ox := 0.0
		var oz := 0.0
		if foot_lock and w > 0.6 and not dbg.contains("l"):
			var bw := xf * ball
			if not lg.locked:
				lg.locked = true
				lg.lock = bw
			var off := Vector2(bw.x - lg.lock.x, bw.z - lg.lock.z)
			if off.length() > LEASH * scale:
				var ex := off.normalized() * (off.length() - LEASH * scale)
				lg.lock.x += ex.x
				lg.lock.z += ex.y
			var lw := inv * Vector3(lg.lock.x, 0.0, lg.lock.z)
			var k := smoothstep(0.6, 1.0, w)
			ox = (lw.x - ball.x) * k
			oz = (lw.z - ball.z) * k
		elif w < 0.4 or not foot_lock:
			lg.locked = false
		lg.ox = lerpf(lg.ox, ox, kf)
		lg.oz = lerpf(lg.oz, oz, kf)
		tgt.x += lg.ox
		tgt.z += lg.oz
		# 兩節骨頭的反向運動：大腿、小腿轉到讓腳踝落在目標上，膝蓋彎的方向照原動作
		var h := up_t.origin
		var k0 := low_t.origin
		var l1 := (k0 - h).length()
		var l2 := (a - k0).length()
		var d := tgt - h
		var dist := clampf(d.length(), 0.001, (l1 + l2) * 0.999)
		var dir := d.normalized()
		var cos_a := clampf((l1 * l1 + dist * dist - l2 * l2) / (2.0 * l1 * dist), -1.0, 1.0)
		var kd := k0 - h
		var perp := kd - dir * kd.dot(dir)
		if perp.length() < 0.0005: perp = Vector3(0, 0, 1) - dir * dir.z
		perp = perp.normalized()
		var k2 := h + dir * cos_a * l1 + perp * sqrt(maxf(0.0, 1.0 - cos_a * cos_a)) * l1
		var a2 := h + dir * dist
		var ub := Basis(Quaternion((k0 - h).normalized(), (k2 - h).normalized())) * up_t.basis
		var lb := Basis(Quaternion((a - k0).normalized(), (a2 - k2).normalized())) * low_t.basis
		sk.set_bone_global_pose(lg.up, Transform3D(ub, h))
		sk.set_bone_global_pose(lg.low, Transform3D(lb, k2))
		sk.set_bone_global_pose(lg.foot, Transform3D(fb, a2))
		# 腳趾：前腳掌踩地時壓平（踮腳時腳趾仍平貼地面）
		if w > 0.001 and not dbg.contains("t"):
			var toe_t := sk.get_bone_global_pose(lg.toes)
			var tb := toe_t.basis.orthonormalized()
			sk.set_bone_global_pose(lg.toes, Transform3D(tb.slerp(_flatten(tb, lg.toe_n), w), toe_t.origin))
