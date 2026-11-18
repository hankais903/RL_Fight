extends SceneTree
# 量每個招式：哪個肢體、在哪一格離身體最遠（就是命中格），以及那一格手肘／膝蓋的彎曲角度
func _initialize():
	var h = HeroRig.build(false)
	get_root().add_child(h.node)
	await process_frame
	await process_frame
	var sk: Skeleton3D = h.skel
	var anim: AnimationPlayer = h.anim
	var limbs = {"左手": ["LeftUpperArm", "LeftLowerArm", "LeftHand"], "右手": ["RightUpperArm", "RightLowerArm", "RightHand"], "左腳": ["LeftUpperLeg", "LeftLowerLeg", "LeftFoot"], "右腳": ["RightUpperLeg", "RightLowerLeg", "RightFoot"]}
	for k in HeroRig.MOVES:
		if k == "idle": continue
		anim.play(k)
		var n := int(anim.current_animation_length * 30.0)
		var best := {}
		for f in n:
			anim.seek(f / 30.0, true)
			anim.advance(0.0)
			sk.force_update_all_bone_transforms()
			var hips := sk.get_bone_global_pose(sk.find_bone("Hips")).origin
			for L in limbs:
				var a := sk.get_bone_global_pose(sk.find_bone(limbs[L][0])).origin
				var b := sk.get_bone_global_pose(sk.find_bone(limbs[L][1])).origin
				var c := sk.get_bone_global_pose(sk.find_bone(limbs[L][2])).origin
				var reach := Vector2(c.x - hips.x, c.z - hips.z).length()
				var bend := rad_to_deg((b - a).angle_to(c - b))
				if not best.has(L) or reach > best[L][0]: best[L] = [reach, f, bend, c - hips]
		var top := ""
		var tv := -1.0
		var kick: bool = k in ["round", "side", "fly"]
		for L in best:
			if kick != L.ends_with("腳"): continue   # 拳只看手、踢只看腳
			if best[L][0] > tv:
				tv = best[L][0]
				top = L
		print("%s（%d 格）→ %s 第 %d 格 伸出 %.2f 彎曲 %.0f 度 方向 %s" % [HeroRig.MOVES[k][3], n, top, best[top][1], best[top][0], best[top][2], (best[top][3] as Vector3).snapped(Vector3.ONE * 0.01)])
	quit()
