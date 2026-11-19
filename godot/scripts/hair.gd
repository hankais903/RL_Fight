class_name HairSim
extends SkeletonModifier3D
# 頭髮：骨架 ＋ 物理（刺蝟頭的髮束）
# rig()：找出頭髮的頂點，依方向分成數束，每束兩節骨頭（髮根段、髮尖段），
#        頂點越靠近髮尖受骨頭影響越大、髮根跟著頭不動；相鄰兩束之間漸變混合。
# 本節點掛在骨架底下，每格在動畫與身體修正之後跑：每節各用一個彈簧擺錘追著走，
#        髮尖段比髮根段軟，所以髮束會彎曲，而不只是整束擺動。

const STIFF_A := 95.0          # 髮根段的彈簧強度（越小越軟、晃得越久）
const STIFF_B := 55.0          # 髮尖段的彈簧強度（比髮根段軟，髮尖才會彎）
const DAMPING := 3.6           # 阻尼（越小彈得越多下）
const GRAVITY := 1.0           # 微微下垂
const MAX_A := 0.6             # 髮根段最多偏離的角度（弧度，約 34 度）
const MAX_B := 0.7             # 髮尖段相對髮根段最多再彎的角度（約 40 度）
# 虛擬擺錘的長度（模型單位，0.14 ≈ 25 公分）。髮束本身只有約 6 公分，直接用它算角度太敏感
# （髮尖落後 1 公分就是 10 度）；改用沿髮束方向延伸出去的一個質點來算，擺動才會慢而柔
const PENDULUM := 0.14
const CARRY := 0.25            # 頭移動時髮尖直接跟上的比例；其餘靠彈簧追（越大越穩、越小越甩）
const ROOT_R := 0.064          # 髮根離頭中心的距離（模型單位）：這裡以內完全跟著頭
const MID_R := 0.079           # 髮根段與髮尖段的交界
const TIP_R := 0.098           # 髮尖離頭中心的距離
const MAX_WEIGHT := 0.95

# 髮束的方向（頭的座標：+Y 上、+Z 前、+X 左）
const DIRS := [
	Vector3(0, 1, 0),
	Vector3(0, 0.75, 0.66), Vector3(0, 0.75, -0.66), Vector3(0.66, 0.75, 0), Vector3(-0.66, 0.75, 0),
	Vector3(0.6, 0.5, 0.62), Vector3(-0.6, 0.5, 0.62), Vector3(0.68, 0.3, -0.66), Vector3(-0.68, 0.3, -0.66),
	Vector3(0, 0.15, -1), Vector3(0.95, 0.3, 0.05), Vector3(-0.95, 0.3, 0.05),
]

var strands: Array = []        # 每束的骨頭、靜止位置與擺錘狀態
var head := -1
var head_rest_inv: Transform3D

# ---------------- 建立骨頭與權重 ----------------
static func rig(hero: Node3D, sk: Skeleton3D) -> HairSim:
	var mi: MeshInstance3D = hero.find_children("*", "MeshInstance3D", true, false)[0]
	var src: ArrayMesh = mi.mesh
	var arr := src.surface_get_arrays(0)
	var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var uv: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV]
	var bones0: PackedInt32Array = arr[Mesh.ARRAY_BONES]
	var weights0: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
	var n := vs.size()
	var per0 := bones0.size() / n
	# 每個頂點要用到五根骨頭（頭、兩束各兩節），所以把權重欄位擴充成八個
	var per := 8
	var bones := PackedInt32Array()
	var weights := PackedFloat32Array()
	bones.resize(n * per)
	weights.resize(n * per)
	for i in n:
		for j in mini(per0, per):
			bones[i * per + j] = bones0[i * per0 + j]
			weights[i * per + j] = weights0[i * per0 + j]
	var mat: BaseMaterial3D = src.surface_get_material(0)
	var img: Image = mat.albedo_texture.get_image()
	if img.is_compressed(): img.decompress()
	var iw := img.get_width()
	var ih := img.get_height()
	var skin: Skin = mi.skin.duplicate()
	var head_bone := sk.find_bone("Head")
	var head_bind := -1
	for b in skin.get_bind_count():
		if skin.get_bind_bone(b) == head_bone or skin.get_bind_name(b) == &"Head": head_bind = b
	if head_bind < 0: return null
	var head_m: Vector3 = skin.get_bind_pose(head_bind).affine_inverse().origin      # 頭關節在網格座標的位置
	var center := Vector3(head_m.x, head_m.y + 0.075, head_m.z + 0.002)              # 頭的中心
	var head_rest := sk.get_bone_global_rest(head_bone)
	var m_h: Transform3D = head_rest * skin.get_bind_pose(head_bind)                 # 網格座標 → 骨架座標
	var sim := HairSim.new()
	sim.head = head_bone
	sim.head_rest_inv = head_rest.affine_inverse()
	# 每束兩節骨頭：髮根段掛在頭底下（支點在頭皮），髮尖段接在髮根段後面
	var dirs: Array = []
	var base_bind := skin.get_bind_count()
	for k in DIRS.size():
		var d: Vector3 = (DIRS[k] as Vector3).normalized()
		dirs.append(d)
		var pa: Vector3 = m_h * (center + d * ROOT_R)
		var pb: Vector3 = m_h * (center + d * MID_R)
		var tip: Vector3 = m_h * (center + d * TIP_R)
		var ga := Transform3D(Basis.IDENTITY, pa)
		var gb := Transform3D(Basis.IDENTITY, pb)
		var ba := sk.add_bone("Hair%dA" % k)
		sk.set_bone_parent(ba, head_bone)
		sk.set_bone_rest(ba, head_rest.affine_inverse() * ga)
		sk.reset_bone_pose(ba)
		skin.add_bind(ba, ga.affine_inverse() * m_h)
		var bb := sk.add_bone("Hair%dB" % k)
		sk.set_bone_parent(bb, ba)
		sk.set_bone_rest(bb, ga.affine_inverse() * gb)
		sk.reset_bone_pose(bb)
		skin.add_bind(bb, gb.affine_inverse() * m_h)
		# 每束的軟硬略有不同，才不會整頭一起動
		sim.strands.append({"a": ba, "b": bb, "pa": pa, "pb": pb, "tip": tip, "k": 0.8 + 0.4 * fposmod(k * 0.618, 1.0),
			"pos_a": Vector3.ZERO, "vel_a": Vector3.ZERO, "last_a": Vector3.ZERO, "pos_b": Vector3.ZERO, "vel_b": Vector3.ZERO, "last_b": Vector3.ZERO, "ok": false, "ang": 0.0})
	# 頭髮的頂點：頭關節以上、深色、不是臉的正面（眼睛和眉毛也是深色，要排除）
	var count := 0
	for i in n:
		var v := vs[i]
		if v.y < head_m.y + 0.01: continue
		var c := img.get_pixel(clampi(int(fposmod(uv[i].x, 1.0) * iw), 0, iw - 1), clampi(int(fposmod(uv[i].y, 1.0) * ih), 0, ih - 1))
		if maxf(c.r, maxf(c.g, c.b)) > 0.42: continue
		var off := v - center
		var dist := off.length()
		if dist < ROOT_R: continue
		var dir := off / dist
		if dir.z > 0.45 and dir.y < 0.4: continue                 # 臉的正面
		# 越靠近髮尖，受髮束骨頭影響越大
		var w := smoothstep(0.0, 1.0, clampf((dist - ROOT_R) / (TIP_R - ROOT_R), 0.0, 1.0)) * MAX_WEIGHT
		# 貼著臉的瀏海和額頭是連在一起的網格，擺動太多會扯到臉：越靠前、越低的髮束動得越少
		w *= lerpf(1.0, smoothstep(0.3, 0.75, dir.y), smoothstep(0.15, 0.55, dir.z))
		if w < 0.01: continue
		# 髮根段與髮尖段的分配：過了交界越往外，越歸髮尖段
		var u := smoothstep(0.0, 1.0, clampf((dist - MID_R) / (TIP_R - MID_R), 0.0, 1.0))
		# 找方向最接近的兩束，依接近程度混合
		var k1 := -1
		var k2 := -1
		var d1 := -2.0
		var d2 := -2.0
		for k in dirs.size():
			var dd: float = dir.dot(dirs[k])
			if dd > d1:
				d2 = d1
				k2 = k1
				d1 = dd
				k1 = k
			elif dd > d2:
				d2 = dd
				k2 = k
		var a := pow(maxf(0.0, d1 - 0.3), 2.0)
		var b := pow(maxf(0.0, d2 - 0.3), 2.0)
		if a + b < 0.0001:
			a = 1.0
			b = 0.0
		var sum := a + b
		k2 = maxi(k2, 0)
		var slot := [[head_bind, 1.0 - w],
			[base_bind + k1 * 2, w * (1.0 - u) * a / sum], [base_bind + k2 * 2, w * (1.0 - u) * b / sum],
			[base_bind + k1 * 2 + 1, w * u * a / sum], [base_bind + k2 * 2 + 1, w * u * b / sum]]
		for j in per:
			bones[i * per + j] = slot[j][0] if j < slot.size() else 0
			weights[i * per + j] = slot[j][1] if j < slot.size() else 0.0
		count += 1
	if count < 50:
		push_warning("找不到足夠的頭髮頂點（%d 個），頭髮不做物理" % count)
		return null
	arr[Mesh.ARRAY_BONES] = bones
	arr[Mesh.ARRAY_WEIGHTS] = weights
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr, [], {}, Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS)
	am.surface_set_material(0, mat)
	mi.mesh = am
	mi.skin = skin
	sim.set_meta("count", count)
	sim.name = "HairSim"
	sk.add_child(sim)
	return sim

# ---------------- 物理 ----------------
# 一個彈簧擺錘走一步：質點被彈簧拉向靜止位置，長度固定在支點 pv 外 length 處，偏離 rest_dir 不超過 max_ang。
# 回傳 [位置, 速度, 方向, 這一格的靜止位置]
func _swing(pos: Vector3, vel: Vector3, last: Vector3, pv: Vector3, rest_dir: Vector3, length: float, stiff: float, max_ang: float, dt: float, grav: float) -> Array:
	var tgt := pv + rest_dir * length
	pos += (tgt - last) * CARRY                      # 跟著支點走一部分
	if dt > 0.0:
		for step in 4:
			var h := dt * 0.25
			var acc := (tgt - pos) * stiff - vel * DAMPING + Vector3(0, -grav, 0)
			vel += acc * h
			pos += vel * h
	var d := (pos - pv).normalized()
	var ang := rest_dir.angle_to(d)
	if ang > max_ang:
		d = rest_dir.slerp(d, max_ang / ang).normalized()
		vel *= 0.6                                   # 撞到角度上限時削掉一部分速度，才不會貼著上限抖
	return [pv + d * length, vel, d, tgt]

func _process_modification() -> void:
	var sk := get_skeleton()
	if sk == null or strands.is_empty(): return
	var xf := sk.global_transform
	var inv := xf.affine_inverse()
	var rot := xf.basis.orthonormalized()
	var rot_inv := rot.inverse()
	var scale := xf.basis.get_scale().x
	var dt := clampf(get_process_delta_time(), 0.0, 1.0 / 30.0)
	var carry: Transform3D = sk.get_bone_global_pose(head) * head_rest_inv     # 靜止位置 → 目前跟著頭的位置（骨架座標）
	var cb := carry.basis.orthonormalized()
	var length := PENDULUM * scale
	var grav := GRAVITY * scale
	for s in strands:
		var pa_s: Vector3 = carry * (s.pa as Vector3)
		var pv: Vector3 = xf * pa_s
		var pb_rest_w: Vector3 = xf * (carry * (s.pb as Vector3))                # 髮尖段支點：沒有擺動時的位置
		var rest_dir: Vector3 = (xf * (carry * (s.tip as Vector3)) - pv).normalized()
		# 第一次、或瞬間移動太遠：直接擺回原位
		if not s.ok or ((s.pos_a as Vector3) - (pv + rest_dir * length)).length() > 0.6 * scale:
			s.pos_a = pv + rest_dir * length
			s.vel_a = Vector3.ZERO
			s.last_a = s.pos_a
			s.pos_b = pb_rest_w + rest_dir * length
			s.vel_b = Vector3.ZERO
			s.last_b = s.pos_b
			s.ok = true
		# 髮根段
		var ra := _swing(s.pos_a, s.vel_a, s.last_a, pv, rest_dir, length, STIFF_A * (s.k as float), MAX_A, dt, grav)
		s.pos_a = ra[0]
		s.vel_a = ra[1]
		s.last_a = ra[3]
		var da: Vector3 = ra[2]
		var qa := Basis.IDENTITY
		if rest_dir.angle_to(da) > 0.0005: qa = Basis(Quaternion(rest_dir, da))
		sk.set_bone_global_pose(s.a, Transform3D((rot_inv * qa * rot) * cb, pa_s))
		# 髮尖段：支點跟著髮根段轉，原本的方向就是髮根段現在的方向；彈簧比較軟，所以會落後更多、形成彎曲
		var pvb: Vector3 = pv + qa * (pb_rest_w - pv)
		var rb := _swing(s.pos_b, s.vel_b, s.last_b, pvb, da, length, STIFF_B * (s.k as float), MAX_B, dt, grav)
		s.pos_b = rb[0]
		s.vel_b = rb[1]
		s.last_b = rb[3]
		var db: Vector3 = rb[2]
		var qb := qa
		if da.angle_to(db) > 0.0005: qb = Basis(Quaternion(da, db)) * qa
		sk.set_bone_global_pose(s.b, Transform3D((rot_inv * qb * rot) * cb, inv * pvb))
		s.ang = rest_dir.angle_to(db)                # 髮尖目前偏離的總角度（量測用）
