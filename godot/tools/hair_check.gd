extends SceneTree
# 量頭髮物理：各招式中髮束偏離原位的最大角度、平均角度，以及回到待機兩秒後是否靜下來
func _initialize():
	var h = HeroRig.build()
	get_root().add_child(h.node)
	var hair: HairSim = h.hair
	if hair == null:
		print("頭髮：沒有建立")
		quit()
		return
	print("頭髮：%d 束，受影響的頂點 %d 個" % [hair.strands.size(), hair.get_meta("count")])
	var anim: AnimationPlayer = h.anim
	for k in ["idle", "jab", "cross", "hook", "upper", "round", "fly"]:
		anim.play(k, 0.1)
		var frames := int(anim.current_animation_length * 30.0) if k != "idle" else 90
		var mx := 0.0
		var sum := 0.0
		var cnt := 0
		for i in frames:
			await process_frame
			for s in hair.strands:
				mx = maxf(mx, s.ang)
				sum += s.ang
				cnt += 1
		print("%s｜髮束最大偏離 %.0f 度｜平均 %.1f 度" % [HeroRig.MOVES[k][3], rad_to_deg(mx), rad_to_deg(sum / cnt)])
	anim.stop()
	for i in 60: await process_frame
	var rest := 0.0
	for s in hair.strands: rest = maxf(rest, s.ang)
	print("停止動作兩秒後｜髮束最大偏離 %.1f 度（只剩重力造成的微微下垂）" % rad_to_deg(rest))
	quit()
