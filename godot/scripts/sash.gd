class_name SashSim
extends SkeletonModifier3D
# 腰帶下垂的兩條飄帶：骨架 ＋ 物理
# rig()：從模型裡找出飄帶的頂點，替左右兩條各加一串骨頭並重新分配權重。
# 本節點掛在骨架底下，每格在動畫套用之後跑物理，再把結果寫回那些骨頭。

const SEG := 4                 # 每條飄帶的節數
const GRAVITY := 20.0          # 公尺／秒平方（比真實重一些，布才垂得下來、不會飄）
const DAMP := 0.86             # 每 1/60 秒保留的速度比例
const CARRY := 0.6             # 身體移動時，飄帶跟著被帶走的比例（其餘靠慣性拖在後面）
const LEG_R := 0.105           # 大腿／小腿的碰撞半徑（模型單位）
const MIN_FWD := 0.07          # 飄帶至少要在髖部前方這麼遠（模型單位），不會陷進褲子

var chains: Array = []         # 每條：{bones, rest（骨架空間的節點位置）, pos, prev（世界座標）}
var hips := -1
var hips_rest_inv: Transform3D
var legs: Array = []           # [[大腿骨, 小腿骨, 腳骨], …]
var last_anchor: Array = []
var ready_sim := false

# ---------------- 建立骨頭與權重 ----------------
static func rig(hero: Node3D, sk: Skeleton3D) -> SashSim:
	var mi: MeshInstance3D = hero.find_children("*", "MeshInstance3D", true, false)[0]
	var src: ArrayMesh = mi.mesh
	var arr := src.surface_get_arrays(0)
	var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var uv: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV]
	var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	var bones: PackedInt32Array = arr[Mesh.ARRAY_BONES]
	var weights: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
	var n := vs.size()
	var per := bones.size() / n
	var mat: BaseMaterial3D = src.surface_get_material(0)
	var img: Image = mat.albedo_texture.get_image()
	if img.is_compressed(): img.decompress()
	var iw := img.get_width()
	var ih := img.get_height()
	# 1. 紅色頂點（飄帶和腰帶是紅的）
	var red := PackedByteArray()
	red.resize(n)
	for i in n:
		var c := img.get_pixel(clampi(int(fposmod(uv[i].x, 1.0) * iw), 0, iw - 1), clampi(int(fposmod(uv[i].y, 1.0) * ih), 0, ih - 1))
		red[i] = 1 if (c.r > 0.45 and c.g < 0.25 and c.b < 0.25) else 0
	# 2. 網格連通塊：只要「含有腰帶以下、身體前面紅色頂點」的那幾塊
	var par := PackedInt32Array()
	par.resize(n)
	for i in n: par[i] = i
	var find := func(a: int) -> int:
		while par[a] != a:
			par[a] = par[par[a]]
			a = par[a]
		return a
	# 同位置的頂點（貼圖接縫切開的）先併在一起，連通塊才不會被接縫切碎
	var weld := {}
	for i in n:
		var key := Vector3i(roundi(vs[i].x * 4000.0), roundi(vs[i].y * 4000.0), roundi(vs[i].z * 4000.0))
		if weld.has(key): par[find.call(i)] = find.call(weld[key])
		else: weld[key] = i
	for k in range(0, idx.size(), 3):
		var a: int = find.call(idx[k])
		par[find.call(idx[k + 1])] = a
		par[find.call(idx[k + 2])] = a
	var top := 0.555
	var bot := 0.33
	var good := {}
	for i in n:
		var v := vs[i]
		if red[i] == 1 and v.y > bot and v.y < top - 0.005 and v.z > 0.03 and absf(v.x) < 0.11: good[find.call(i)] = true
	var cand: Array = []
	for i in n:
		if not good.has(find.call(i)): continue
		var v := vs[i]
		if v.y < bot - 0.01 or v.y > top + 0.01 or absf(v.x) > 0.11 or v.z < 0.045: continue
		cand.append(i)
	if cand.size() < 40:
		push_warning("找不到飄帶的頂點（%d 個），飄帶不做物理" % cand.size())
		return null
	# 3. 分成左右兩條：以 x 方向最大的空隙分開
	var xs: Array = []
	for i in cand:
		if vs[i].y < 0.45: xs.append(vs[i].x)
	xs.sort()
	var gap := 0.0
	var split: float = xs[xs.size() / 2]
	for k in range(1, xs.size()):
		if xs[k] - xs[k - 1] > gap and k > xs.size() * 0.2 and k < xs.size() * 0.8:
			gap = xs[k] - xs[k - 1]
			split = (xs[k] + xs[k - 1]) * 0.5
	# 4. 骨架：髖部的「靜止全域變換 × 綁定矩陣」把網格空間轉到骨架空間
	var skin: Skin = mi.skin.duplicate()
	var hips_bone := sk.find_bone("Hips")
	var hips_bind := -1
	for b in skin.get_bind_count():
		if skin.get_bind_bone(b) == hips_bone or skin.get_bind_name(b) == &"Hips": hips_bind = b
	var hips_rest := sk.get_bone_global_rest(hips_bone)
	var m_h: Transform3D = hips_rest * skin.get_bind_pose(hips_bind)
	var sim := SashSim.new()
	sim.hips = hips_bone
	sim.hips_rest_inv = hips_rest.affine_inverse()
	for side in 2:
		var mine: Array = []
		for i in cand:
			if (vs[i].x < split) == (side == 0): mine.append(i)
		if mine.size() < 10: continue
		var cx := 0.0
		var y_top := -1e9
		var y_bot := 1e9
		for i in mine:
			cx += vs[i].x
			y_top = maxf(y_top, vs[i].y)
			y_bot = minf(y_bot, vs[i].y)
		cx /= mine.size()
		# 各節的位置（網格空間）：沿高度等分，前後位置取那個高度附近頂點的平均
		var pts: Array = []
		for k in SEG + 1:
			var y := y_top - (y_top - y_bot) * k / SEG
			var sz := 0.0
			var cnt := 0
			for i in mine:
				if absf(vs[i].y - y) < 0.03:
					sz += vs[i].z
					cnt += 1
			pts.append(m_h * Vector3(cx, y, sz / cnt if cnt > 0 else 0.07))
		# 加骨頭：第一節掛在髖部，其餘一節接一節
		var ids: Array = []
		var parent := hips_bone
		var base_bind := skin.get_bind_count()
		for k in SEG:
			var bi := sk.add_bone("Sash%d_%d" % [side, k])
			sk.set_bone_parent(bi, parent)
			var g := Transform3D(Basis.IDENTITY, pts[k])
			var pg: Transform3D = hips_rest if k == 0 else Transform3D(Basis.IDENTITY, pts[k - 1])
			sk.set_bone_rest(bi, pg.affine_inverse() * g)
			sk.reset_bone_pose(bi)
			skin.add_bind(bi, g.affine_inverse() * m_h)
			ids.append(bi)
			parent = bi
		# 權重：依高度落在哪兩節之間漸變；最上面一小段和髖部混合，接縫才不會裂開
		var seg_h := (y_top - y_bot) / SEG
		for i in mine:
			var f := clampf((y_top - vs[i].y) / seg_h, 0.0, SEG - 0.001)
			var k := int(f)
			var t := f - k
			var wa := 1.0 - t
			var wb := t
			var wh := 0.0
			if f < 0.6:
				wh = (0.6 - f) / 0.6
				wa *= 1.0 - wh
				wb *= 1.0 - wh
			for j in per:
				bones[i * per + j] = 0
				weights[i * per + j] = 0.0
			bones[i * per] = base_bind + k
			weights[i * per] = wa
			bones[i * per + 1] = base_bind + mini(SEG - 1, k + 1)
			weights[i * per + 1] = wb
			bones[i * per + 2] = hips_bind
			weights[i * per + 2] = wh
		sim.chains.append({"bones": ids, "rest": pts, "pos": [], "prev": []})
	if sim.chains.is_empty(): return null
	# 5. 用新的權重重建網格
	arr[Mesh.ARRAY_BONES] = bones
	arr[Mesh.ARRAY_WEIGHTS] = weights
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr, [], {}, Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS if per == 8 else 0)
	am.surface_set_material(0, mat)
	mi.mesh = am
	mi.skin = skin
	for s in ["Left", "Right"]:
		sim.legs.append([sk.find_bone(s + "UpperLeg"), sk.find_bone(s + "LowerLeg"), sk.find_bone(s + "Foot")])
	sim.name = "SashSim"
	sk.add_child(sim)
	return sim

# ---------------- 物理 ----------------
func _process_modification() -> void:
	var sk := get_skeleton()
	if sk == null or chains.is_empty(): return
	var xf := sk.global_transform
	var scale := xf.basis.get_scale().x
	var dt := clampf(get_process_delta_time(), 0.0, 1.0 / 30.0)
	var hips_pose := sk.get_bone_global_pose(hips)
	var carry_xf: Transform3D = hips_pose * hips_rest_inv       # 靜止位置 → 目前跟著髖部的位置（骨架空間）
	# 髖部前方（世界座標）：由左右大腿根部的連線與「上」算出
	var lw: Vector3 = xf * sk.get_bone_global_pose(legs[0][0]).origin
	var rw: Vector3 = xf * sk.get_bone_global_pose(legs[1][0]).origin
	var fwd := (lw - rw).cross(Vector3.UP).normalized()
	var hips_w: Vector3 = xf * hips_pose.origin
	# 腿的碰撞膠囊（世界座標）
	var caps: Array = []
	for lg in legs:
		var a: Vector3 = xf * sk.get_bone_global_pose(lg[0]).origin
		var b: Vector3 = xf * sk.get_bone_global_pose(lg[1]).origin
		var c: Vector3 = xf * sk.get_bone_global_pose(lg[2]).origin
		caps.append([a, b])
		caps.append([b, c])
	var r := LEG_R * scale
	var ci := 0
	for ch in chains:
		var rest: Array = ch.rest
		var anchor: Vector3 = xf * (carry_xf * (rest[0] as Vector3))
		var pos: Array = ch.pos
		var prev: Array = ch.prev
		# 第一次、暫停後、或瞬間移動太遠：直接擺回跟著身體的靜止位置
		if pos.is_empty() or (anchor - (pos[0] as Vector3)).length() > 1.0 * scale:
			pos.clear()
			prev.clear()
			for k in SEG + 1:
				var p: Vector3 = xf * (carry_xf * (rest[k] as Vector3))
				pos.append(p)
				prev.append(p)
			ch.pos = pos
			ch.prev = prev
		var delta: Vector3 = anchor - (pos[0] as Vector3)
		pos[0] = anchor
		prev[0] = anchor
		if dt > 0.0:
			var damp := pow(DAMP, dt * 60.0)
			for k in range(1, SEG + 1):
				var p: Vector3 = pos[k]
				var v: Vector3 = (p - (prev[k] as Vector3)) * damp
				prev[k] = p + delta * CARRY
				pos[k] = p + delta * CARRY + v + Vector3(0, -GRAVITY * dt * dt, 0)
			for it in 4:
				for k in range(1, SEG + 1):
					var p: Vector3 = pos[k]
					# 每節長度固定
					var q: Vector3 = pos[k - 1]
					var want: float = ((rest[k] as Vector3) - (rest[k - 1] as Vector3)).length() * scale
					var d := p - q
					var dl := d.length()
					if dl > 0.0001: p = q + d / dl * want
					# 不穿進大腿、小腿
					for cp in caps:
						var a: Vector3 = cp[0]
						var ab: Vector3 = (cp[1] as Vector3) - a
						var tt := clampf((p - a).dot(ab) / maxf(0.0001, ab.length_squared()), 0.0, 1.0)
						var near := a + ab * tt
						var off := p - near
						var ol := off.length()
						if ol < r and ol > 0.0001: p = near + off / ol * r
					# 不陷進身體：至少在髖部前方一小段
					var f := (p - hips_w).dot(fwd)
					var need := MIN_FWD * scale
					if f < need: p += fwd * (need - f)
					# 不穿地
					if p.y < 0.02: p.y = 0.02
					pos[k] = p
		# 把結果寫回骨頭（骨架空間）：位置是節點，方向是從靜止方向轉到目前方向
		var inv := xf.affine_inverse()
		var ids: Array = ch.bones
		for k in SEG:
			var o: Vector3 = inv * (pos[k] as Vector3)
			var dir: Vector3 = (inv * (pos[k + 1] as Vector3) - o).normalized()
			var rd: Vector3 = ((rest[k + 1] as Vector3) - (rest[k] as Vector3)).normalized()
			var bas := Basis.IDENTITY
			if dir.length_squared() > 0.5 and absf(rd.dot(dir)) < 0.9999: bas = Basis(Quaternion(rd, dir))
			sk.set_bone_global_pose(ids[k], Transform3D(bas, o))
		ci += 1
