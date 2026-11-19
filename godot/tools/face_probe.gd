extends SceneTree
# 檢查臉部蒙皮：(1) 原始模型裡臉的頂點綁在哪些骨頭上 (2) 加了頭髮物理後，臉的皮膚頂點有沒有跟會動的頭髮頂點連在同一個三角形上
func _color(img: Image, uv: Vector2) -> Color:
	return img.get_pixel(clampi(int(fposmod(uv.x, 1.0) * img.get_width()), 0, img.get_width() - 1), clampi(int(fposmod(uv.y, 1.0) * img.get_height()), 0, img.get_height() - 1))
func _initialize():
	HeroRig.hair_physics = false
	HeroRig.face_fix = not OS.get_cmdline_user_args().has("--raw")
	var hero: Node3D = HeroRig.build().node
	var sk: Skeleton3D = hero.find_children("*", "Skeleton3D", true, false)[0]
	var mi: MeshInstance3D = hero.find_children("*", "MeshInstance3D", true, false)[0]
	var arr := mi.mesh.surface_get_arrays(0)
	var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var uv: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV]
	var bones: PackedInt32Array = arr[Mesh.ARRAY_BONES]
	var weights: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
	var per := bones.size() / vs.size()
	var img: Image = (mi.mesh.surface_get_material(0) as BaseMaterial3D).albedo_texture.get_image()
	if img.is_compressed(): img.decompress()
	var skin := mi.skin
	var names := {}
	var head_bind := -1
	for i in skin.get_bind_count():
		var bi := skin.get_bind_bone(i)
		names[i] = sk.get_bone_name(bi) if bi >= 0 else String(skin.get_bind_name(i))
		if names[i] == "Head": head_bind = i
	var head_y: float = skin.get_bind_pose(head_bind).affine_inverse().origin.y
	print("每個頂點的骨頭數 ", per, "　頭關節高度 ", snappedf(head_y, 0.001))
	# (1) 頭部（頭關節以上）各高度層：頭骨頭的平均權重、其他骨頭有哪些
	for band in [[head_y - 0.03, head_y - 0.01], [head_y - 0.01, head_y + 0.01], [head_y + 0.01, head_y + 0.03], [head_y + 0.03, head_y + 0.06], [head_y + 0.06, 2.0]]:
		var cnt := 0
		var hw := 0.0
		var low := 0
		var others := {}
		for i in vs.size():
			if vs[i].y < band[0] or vs[i].y >= band[1] or absf(vs[i].x) > 0.09: continue
			cnt += 1
			var w_head := 0.0
			for j in per:
				var w := weights[i * per + j]
				if w <= 0.0: continue
				if bones[i * per + j] == head_bind: w_head += w
				else: others[names[bones[i * per + j]]] = others.get(names[bones[i * per + j]], 0.0) + w
			hw += w_head
			if w_head < 0.95: low += 1
		var top := others.keys()
		top.sort_custom(func(a, b): return others[a] > others[b])
		var txt := ""
		for k in top.slice(0, 3): txt += " %s %.0f%%" % [k, others[k] / maxf(1.0, cnt) * 100.0]
		print("高度 %.3f～%.3f｜頂點 %d｜頭骨頭平均權重 %.0f%%｜權重不到 95%% 的有 %d 個｜其他骨頭：%s" % [band[0], minf(band[1], 1.0), cnt, hw / maxf(1.0, cnt) * 100.0, low, txt])
	quit()
