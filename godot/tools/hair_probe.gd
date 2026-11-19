extends SceneTree
# 分析頭髮：找出頭部以上的深色頂點，印出範圍、離頭中心的距離分布、各方向的數量
func _initialize():
	var hero: Node3D = load("res://assets/hero/hero.glb").instantiate()
	var sk: Skeleton3D = hero.find_children("*", "Skeleton3D", true, false)[0]
	var mi: MeshInstance3D = hero.find_children("*", "MeshInstance3D", true, false)[0]
	var arr := mi.mesh.surface_get_arrays(0)
	var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var uv: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV]
	var img: Image = (mi.mesh.surface_get_material(0) as BaseMaterial3D).albedo_texture.get_image()
	if img.is_compressed(): img.decompress()
	var skin := mi.skin
	var hb := sk.find_bone("Head")
	var head_m := Vector3.ZERO
	for i in skin.get_bind_count():
		if skin.get_bind_bone(i) == hb or skin.get_bind_name(i) == &"Head": head_m = skin.get_bind_pose(i).affine_inverse().origin
	print("頭關節（網格座標） ", head_m.snapped(Vector3.ONE * 0.001))
	var top := 0.0
	for v in vs: top = maxf(top, v.y)
	print("模型最高點 ", snappedf(top, 0.001))
	var skin_pts: Array = []
	var hair: Array = []
	for i in vs.size():
		var v := vs[i]
		if v.y < head_m.y + 0.01: continue
		var c := img.get_pixel(clampi(int(fposmod(uv[i].x, 1.0) * img.get_width()), 0, img.get_width() - 1), clampi(int(fposmod(uv[i].y, 1.0) * img.get_height()), 0, img.get_height() - 1))
		var mx := maxf(c.r, maxf(c.g, c.b))
		if c.r > 0.6 and c.g > 0.4 and c.b > 0.3: skin_pts.append(v)
		elif mx < 0.42: hair.append(v)
	print("頭部以上：膚色頂點 ", skin_pts.size(), "　深色頂點 ", hair.size())
	var smin := Vector3.ONE * 9.0
	var smax := -Vector3.ONE * 9.0
	for v in skin_pts:
		smin = smin.min(v)
		smax = smax.max(v)
	print("膚色範圍 ", smin.snapped(Vector3.ONE * 0.001), " ～ ", smax.snapped(Vector3.ONE * 0.001))
	var hmin := Vector3.ONE * 9.0
	var hmax := -Vector3.ONE * 9.0
	for v in hair:
		hmin = hmin.min(v)
		hmax = hmax.max(v)
	print("深色範圍 ", hmin.snapped(Vector3.ONE * 0.001), " ～ ", hmax.snapped(Vector3.ONE * 0.001))
	var c0 := Vector3((hmin.x + hmax.x) * 0.5, head_m.y + 0.075, (smin.z + smax.z) * 0.5 - 0.01)
	print("估計的頭中心 ", c0.snapped(Vector3.ONE * 0.001))
	var ds: Array = []
	for v in hair: ds.append((v - c0).length())
	ds.sort()
	print("深色頂點離頭中心：5%% %.3f　25%% %.3f　50%% %.3f　75%% %.3f　95%% %.3f　最遠 %.3f" % [ds[ds.size() / 20], ds[ds.size() / 4], ds[ds.size() / 2], ds[ds.size() * 3 / 4], ds[ds.size() * 19 / 20], ds[ds.size() - 1]])
	var sd: Array = []
	for v in skin_pts: sd.append((v - c0).length())
	sd.sort()
	if sd.size() > 4: print("膚色頂點離頭中心：50%% %.3f　95%% %.3f" % [sd[sd.size() / 2], sd[sd.size() * 19 / 20]])
	quit()
