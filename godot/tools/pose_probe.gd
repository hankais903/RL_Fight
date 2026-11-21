extends SceneTree
# 量某個招式每一格的姿勢：髖部高度、兩手的高度與往前伸的量（模型單位×主角比例＝公尺）。把特效接到動作上之前先看這個
func _initialize():
	var move := "upper"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--move="): move = a.split("=")[1]
	var h = HeroRig.build(false)
	get_root().add_child(h.node)
	await process_frame
	await process_frame
	var sk: Skeleton3D = h.skel
	var anim: AnimationPlayer = h.anim
	anim.play(move)
	var n := int(anim.current_animation_length * 30.0)
	var s := HeroRig.HERO_SCALE
	for f in n:
		anim.seek(f / 30.0, true)
		anim.advance(0.0)
		sk.force_update_all_bone_transforms()
		var hips := sk.get_bone_global_pose(sk.find_bone("Hips")).origin
		var l := sk.get_bone_global_pose(sk.find_bone("LeftHand")).origin
		var r := sk.get_bone_global_pose(sk.find_bone("RightHand")).origin
		var hd := sk.get_bone_global_pose(sk.find_bone("Head")).origin
		print("%2d 格｜髖高 %.2f｜頭高 %.2f｜左手 高 %.2f 前 %.2f｜右手 高 %.2f 前 %.2f" % [f, hips.y * s, hd.y * s, l.y * s, (l.z - hips.z) * s, r.y * s, (r.z - hips.z) * s])
	quit()
