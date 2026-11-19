extends SceneTree
func _initialize():
	for f in ["badguy_1.glb", "walk.fbx", "hit.fbx"]:
		var n: Node = load("res://assets/enemy/" + f).instantiate()
		var sks := n.find_children("*", "Skeleton3D", true, false)
		if sks.is_empty():
			print(f, "｜沒有骨架")
			continue
		var sk: Skeleton3D = sks[0]
		var names := []
		for i in mini(6, sk.get_bone_count()): names.append(sk.get_bone_name(i))
		print(f, "｜骨架路徑 ", n.get_path_to(sk), "｜骨頭數 ", sk.get_bone_count(), "｜", names)
		for m in n.find_children("*", "MeshInstance3D", true, false):
			var mi: MeshInstance3D = m
			var tris := 0
			for s in mi.mesh.get_surface_count(): tris += mi.mesh.surface_get_array_len(s)
			print("  網格 ", String(mi.name).left(24), "｜大小 ", mi.get_aabb().size.snapped(Vector3.ONE * 0.01), "｜最低點 ", snappedf(mi.get_aabb().position.y, 0.01), "｜材質組 ", mi.mesh.get_surface_count(), "｜頂點 ", tris)
		for ap in n.find_children("*", "AnimationPlayer", true, false):
			for a in (ap as AnimationPlayer).get_animation_list():
				var an: Animation = (ap as AnimationPlayer).get_animation(a)
				print("  動作 ", a, "｜", snappedf(an.length, 0.01), " 秒｜軌道 ", an.get_track_count())
	quit()
