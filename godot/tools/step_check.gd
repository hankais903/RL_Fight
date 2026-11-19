extends SceneTree
# 量每個招式中，髖部離站位點最遠的水平距離（公尺）：主角出招時實際會往外踏多遠
func _initialize():
	var h = HeroRig.build()
	get_root().add_child(h.node)
	await process_frame
	await process_frame
	var sk: Skeleton3D = h.skel
	var anim: AnimationPlayer = h.anim
	var worst := 0.0
	for k in HeroRig.MOVES:
		anim.play(k)
		var n := int(anim.current_animation_length * 30.0)
		var mx := 0.0
		for f in n:
			anim.seek(f / 30.0, true)
			anim.advance(0.0)
			var p := sk.get_bone_pose_position(sk.find_bone("Hips"))
			mx = maxf(mx, Vector2(p.x, p.z).length() * HeroRig.HERO_SCALE)
		worst = maxf(worst, mx)
		print("%s｜髖部最遠離站位點 %.2f 公尺" % [HeroRig.MOVES[k][3], mx])
	print("最大 %.2f 公尺" % worst)
	quit()
