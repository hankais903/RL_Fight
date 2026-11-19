extends SceneTree
# 量腳的狀況：穿地深度、踩地時腳底歪幾度、踩著時滑了多遠。參數 --noik 可關掉腳貼地做對照。
var sk: Skeleton3D
var rows := {}
var cur := ""
var prev := {}
var fix: BodyFix
func _initialize():
	HeroRig.foot_ik = not OS.get_cmdline_user_args().has("--noik")
	for x in OS.get_cmdline_user_args():
		if x.begins_with("--dbg="): BodyFix.dbg = x.split("=")[1]
	var h = HeroRig.build()
	get_root().add_child(h.node)
	sk = h.skel
	fix = h.fix
	print("基準：腳踝離地 %.3f、腳趾關節離地 %.3f、整個人抬高 %.3f（模型單位）" % [fix.legs[0].ankle_h, fix.legs[0].toe_h, fix.hips_raise])
	var anim: AnimationPlayer = h.anim
	sk.skeleton_updated.connect(_sample)
	for k in (["idle", "upper"] if BodyFix.dbg != "" else ["idle", "jab", "cross", "hook", "upper", "round", "side"]):
		cur = ""
		anim.play(k, 0.0)
		for i in 3: await process_frame
		prev = {}
		rows[k] = {"pen": 0.0, "roll": 0.0, "slide": 0.0, "heel_lo": 9.0, "heel_hi": -9.0, "jit": 0.0, "jn": 0, "lows": []}
		cur = k
		var frames := int(anim.current_animation_length * 30.0) if k != "idle" else 90
		for i in frames: await process_frame
		cur = ""
		var r: Dictionary = rows[k]
		var ls: Array = r.lows
		ls.sort()
		if OS.get_cmdline_user_args().has("--lows"): print("%s｜支撐腳鞋底離地：最低 %.1f、四分之一 %.1f、中位數 %.1f、四分之三 %.1f 公分" % [HeroRig.MOVES[k][3], ls[0] * 180.0, ls[ls.size() / 4] * 180.0, ls[ls.size() / 2] * 180.0, ls[ls.size() * 3 / 4] * 180.0])
		print("%s｜最深穿地 %.1f 公分｜踩地時左右歪斜最大 %.0f 度｜前腳掌踩地時滑動 %.0f 公分｜腳跟起落範圍 %.1f 公分｜抖動量 %.2f" % [HeroRig.MOVES[k][3], r.pen * 180.0, r.roll, r.slide * 180.0, (r.heel_hi - r.heel_lo) * 180.0, r.jit / maxi(1, r.jn) * 1800.0])
	quit()

func _sample() -> void:
	if cur == "": return
	var r: Dictionary = rows[cur]
	# 抖動量：膝蓋、腳踝、腳趾關節位置的「加加速度」（連續四格的三階差分）。動作平順時很小，逐格亂跳時很大
	for lg in fix.legs:
		for b in [lg.low, lg.foot, lg.toes]:
			var p := sk.get_bone_global_pose(b).origin
			var key := "h%d" % b
			var hist: Array = prev.get(key, [])
			hist.append(p)
			if hist.size() > 4: hist.pop_front()
			if hist.size() == 4:
				r.jit += ((hist[3] as Vector3) - (hist[2] as Vector3) * 3.0 + (hist[1] as Vector3) * 3.0 - (hist[0] as Vector3)).length()
				r.jn += 1
			prev[key] = hist
	var frame_low := 9.0
	for lg in fix.legs:
		var s: int = lg.foot
		var fp := sk.get_bone_global_pose(lg.foot)
		var fb := fp.basis.orthonormalized()
		var ball: Vector3 = fp.origin + fb * (lg.ball_local as Vector3)
		var heel: Vector3 = fp.origin + fb * (lg.heel_local as Vector3)
		r.pen = maxf(r.pen, -minf(ball.y, heel.y))
		frame_low = minf(frame_low, minf(ball.y, heel.y))
		r.heel_lo = minf(r.heel_lo, heel.y)
		r.heel_hi = maxf(r.heel_hi, heel.y)
		if ball.y < 0.012:
			r.roll = maxf(r.roll, absf(rad_to_deg(asin(clampf((fb * (lg.lat_local as Vector3)).y, -1.0, 1.0)))))
			if prev.has(s): r.slide += Vector2(ball.x - prev[s].x, ball.z - prev[s].z).length()
			prev[s] = ball
		else:
			prev.erase(s)
	(r.lows as Array).append(frame_low)
