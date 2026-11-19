extends SceneTree
# 量每個招式的三個時間點：蓄力起點（拳腳收到最後面）、命中格、可接下一招（拳腳收回一半）
func _initialize():
	var h = HeroRig.build(false)
	get_root().add_child(h.node)
	await process_frame
	await process_frame
	var sk: Skeleton3D = h.skel
	var anim: AnimationPlayer = h.anim
	var limb = {"jab": "LeftHand", "cross": "RightHand", "hook": "RightHand", "upper": "LeftHand", "round": "RightFoot", "side": "RightFoot", "fly": "LeftFoot"}
	for k in limb:
		anim.play(k)
		var n := int(anim.current_animation_length * 30.0)
		var r := []
		for f in n:
			anim.seek(f / 30.0, true)
			anim.advance(0.0)
			sk.force_update_all_bone_transforms()
			var hips := sk.get_bone_global_pose(sk.find_bone("Hips")).origin
			var c := sk.get_bone_global_pose(sk.find_bone(limb[k])).origin
			r.append(Vector2(c.x - hips.x, c.z - hips.z).length())
		var imp: int = HeroRig.MOVES[k][1]
		# 往回找：伸展量不再變小的那一格就是蓄力起點
		var st := imp
		while st > 0 and r[st - 1] <= r[st] + 0.002: st -= 1
		# 再往回留幾格讓身體先動（轉腰、踏步通常比手早）
		var lo: float = r[st]
		var hi: float = r[imp]
		var cn := imp
		while cn < n - 1 and r[cn] > lo + (hi - lo) * 0.5: cn += 1
		print("%s 共 %d 格｜蓄力起點 %d｜命中 %d｜可接招 %d｜蓄力到命中 %.2f 秒｜命中到接招 %.2f 秒" % [HeroRig.MOVES[k][3], n, st, imp, cn, (imp - st) / 30.0, (cn - imp) / 30.0])
	quit()
