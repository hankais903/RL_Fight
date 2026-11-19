extends SceneTree
func _initialize():
	var n: Node = load("res://assets/enemy/fall.fbx").instantiate()
	var ap: AnimationPlayer = n.find_children("*", "AnimationPlayer", true, false)[0]
	var sk: Skeleton3D = n.find_children("*", "Skeleton3D", true, false)[0]
	get_root().add_child(n)
	var an := ap.get_animation(ap.get_animation_list()[0])
	print("長度 %.2f 秒" % an.length)
	ap.play(ap.get_animation_list()[0])
	for f in [0, 10, 20, 30, 40, 50, 60, 70, 80, int(an.length * 30.0) - 1]:
		if f / 30.0 > an.length: continue
		ap.seek(f / 30.0, true)
		ap.advance(0.0)
		var h := sk.get_bone_pose_position(sk.find_bone("Hips"))
		var hd := sk.get_bone_global_pose(sk.find_bone("Head")).origin
		print("第 %d 格｜髖部 高 %.2f 前後 %.2f 左右 %.2f｜頭 高 %.2f 前後 %.2f（動作檔單位，站立時髖高約 %.2f）" % [f, h.y, h.z, h.x, hd.y, hd.z, sk.get_bone_global_rest(sk.find_bone("Hips")).origin.y])
	quit()
