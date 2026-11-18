extends SceneTree
func _initialize():
	var hero = load("res://assets/hero/hero.glb").instantiate()
	var sk: Skeleton3D = hero.find_children("*", "Skeleton3D", true, false)[0]
	print("主角骨架節點: ", hero.get_path_to(sk), " 骨頭數 ", sk.get_bone_count())
	var names = []
	for i in mini(8, sk.get_bone_count()): names.append(sk.get_bone_name(i))
	print("前幾根: ", names)
	for m in hero.find_children("*", "MeshInstance3D", true, false): print("網格: ", m.name, " aabb ", m.get_aabb().size)
	var a = load("res://assets/anims/cross_punch.fbx").instantiate()
	var ap: AnimationPlayer = a.find_children("*", "AnimationPlayer", true, false)[0]
	var ask: Skeleton3D = a.find_children("*", "Skeleton3D", true, false)[0]
	print("動作檔骨架: ", a.get_path_to(ask), " 骨頭數 ", ask.get_bone_count(), " 第一根 ", ask.get_bone_name(0), " 靜止髖高 ", ask.get_bone_rest(0).origin)
	print("主角 靜止髖 ", sk.get_bone_rest(0).origin, " 骨架縮放 ", sk.get_parent().transform.basis.get_scale() if sk.get_parent() is Node3D else "")
	for n in ap.get_animation_list():
		var an = ap.get_animation(n)
		print("軌道例 ", an.track_get_path(5), " 類型 ", an.track_get_type(5)); print("動作 ", n, " 長度 ", an.length, " 軌道數 ", an.get_track_count(), " 例 ", an.track_get_path(0), " ", an.track_get_path(1))
	quit()
