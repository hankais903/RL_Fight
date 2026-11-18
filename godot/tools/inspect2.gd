extends SceneTree
func dirv(sk: Skeleton3D, a: String, b: String) -> Vector3:
	var pa := sk.get_bone_global_rest(sk.find_bone(a)).origin
	var pb := sk.get_bone_global_rest(sk.find_bone(b)).origin
	return (pb - pa).normalized().snapped(Vector3.ONE * 0.01)
func _initialize():
	var hero = load("res://assets/hero/hero.glb").instantiate()
	var hs: Skeleton3D = hero.find_children("*", "Skeleton3D", true, false)[0]
	var a = load("res://assets/anims/cross_punch.fbx").instantiate()
	var s2: Skeleton3D = a.find_children("*", "Skeleton3D", true, false)[0]
	for pr in [["LeftShoulder", "LeftUpperArm"], ["LeftUpperArm", "LeftLowerArm"], ["LeftLowerArm", "LeftHand"], ["LeftUpperLeg", "LeftLowerLeg"], ["Hips", "Spine"], ["RightUpperArm", "RightLowerArm"]]:
		print(pr[0], "→", pr[1], "  主角 ", dirv(hs, pr[0], pr[1]), "  動作檔 ", dirv(s2, pr[0], pr[1]))
	# 靜止姿勢下骨頭本身的朝向（重定向後兩邊應該一樣）
	for b in ["LeftUpperArm", "LeftLowerArm", "LeftHand", "LeftUpperLeg"]:
		print(b, " 朝向  主角 ", hs.get_bone_global_rest(hs.find_bone(b)).basis.get_euler().snapped(Vector3.ONE * 0.01), "  動作檔 ", s2.get_bone_global_rest(s2.find_bone(b)).basis.get_euler().snapped(Vector3.ONE * 0.01))
	quit()
