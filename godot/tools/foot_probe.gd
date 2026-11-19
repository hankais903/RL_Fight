extends SceneTree
func r3(v: Vector3) -> Vector3: return v.snapped(Vector3.ONE * 0.001)
func _initialize():
	HeroRig.foot_ik = false
	var h = HeroRig.build()
	get_root().add_child(h.node)
	var sk: Skeleton3D = h.skel
	var mi: MeshInstance3D = h.node.find_children("*", "MeshInstance3D", true, false)[0]
	var vs: PackedVector3Array = mi.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var lo := 9.0
	for v in vs: lo = minf(lo, v.y)
	print("網格最低點（鞋底）y=", snappedf(lo, 0.001), "　網格節點變換 ", mi.transform.origin, "　骨架節點 ", sk.transform.origin, " 縮放 ", sk.transform.basis.get_scale())
	for b in ["Hips", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "LeftToes"]:
		var i := sk.find_bone(b)
		print(b, " 靜止位置 ", r3(sk.get_bone_global_rest(i).origin))
	var f := sk.find_bone("LeftFoot")
	var t := sk.find_bone("LeftToes")
	print("靜止：腳踝→腳趾方向 ", r3((sk.get_bone_global_rest(t).origin - sk.get_bone_global_rest(f).origin).normalized()))
	var anim: AnimationPlayer = h.anim
	anim.play("idle", 0.0)
	for i in 5: await process_frame
	for b in ["Hips", "LeftFoot", "LeftToes", "RightFoot", "RightToes"]:
		print("待機：", b, " 位置 ", r3(sk.get_bone_global_pose(sk.find_bone(b)).origin))
	print("待機：左腳踝→腳趾方向 ", r3((sk.get_bone_global_pose(t).origin - sk.get_bone_global_pose(f).origin).normalized()))
	quit()
