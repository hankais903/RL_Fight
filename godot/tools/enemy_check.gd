extends SceneTree
# 量敵人的腳：穿地、支撐腳鞋底離地、踩地時的滑動速度（跟走路速度比）、抖動量。加 -- --noik 是原始動作對照
var sk: Skeleton3D
var fix: BodyFix
var on := false
var lows: Array = []
var pen := 0.0
var jit := 0.0
var jn := 0
var hist := {}
var slide: Array = []
var prev := {}
var speed := 0.0
func _initialize():
	EnemyRig.foot_ik = not OS.get_cmdline_user_args().has("--noik")
	var kind := "grunt"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--kind="): kind = a.split("=")[1]
	var e := EnemyRig.build(kind)
	speed = e.move_speed
	get_root().add_child(e.node)
	sk = e.skel
	fix = e.fix
	sk.skeleton_updated.connect(_s)
	var hb := sk.find_bone("Head")
	print("基準：腳踝離地 %.3f、腳趾關節離地 %.3f（模型單位）｜移動動作的前進速度 %.2f 公尺／秒｜頭關節高度 %.2f 公尺" % [fix.legs[0].ankle_h, fix.legs[0].toe_h, speed, sk.get_bone_global_rest(hb).origin.y * EnemyRig.SCALE])
	for k in [e.move, "hit", "punch"]:
		(e.anim as AnimationPlayer).play(k, 0.0)
		for i in 4: await process_frame
		lows.clear(); slide.clear(); pen = 0.0; jit = 0.0; jn = 0; hist.clear(); prev.clear()
		on = true
		for i in int((e.anim as AnimationPlayer).current_animation_length * 30.0) * (3 if k == e.move else 1) - 6: await process_frame
		on = false
		lows.sort(); slide.sort()
		var s := EnemyRig.SCALE * 100.0
		var sl := ("｜踩地的腳往後移動的速度 中位數 %.2f 公尺／秒" % (slide[slide.size() / 2] if slide.size() > 0 else 0.0)) if k == e.move else ""
		print("%s｜最深穿地 %.1f 公分｜支撐腳鞋底離地 最低 %.1f 中位數 %.1f 公分｜抖動量 %.2f%s" % [EnemyRig.ANIMS[k][1], pen * s, lows[0] * s, lows[lows.size() / 2] * s, jit / maxi(1, jn) * 1000.0 * EnemyRig.SCALE, sl])
	quit()
func _s() -> void:
	if not on: return
	var low := 9.0
	for lg in fix.legs:
		var fp := sk.get_bone_global_pose(lg.foot)
		var fb := fp.basis.orthonormalized()
		var ball: Vector3 = fp.origin + fb * (lg.ball_local as Vector3)
		var heel: Vector3 = fp.origin + fb * (lg.heel_local as Vector3)
		var l := minf(ball.y, heel.y)
		pen = maxf(pen, -l)
		low = minf(low, l)
		for b in [lg.low, lg.foot, lg.toes]:
			var p := sk.get_bone_global_pose(b).origin
			var h: Array = hist.get(b, [])
			h.append(p)
			if h.size() > 4: h.pop_front()
			if h.size() == 4:
				jit += ((h[3] as Vector3) - (h[2] as Vector3) * 3.0 + (h[1] as Vector3) * 3.0 - (h[0] as Vector3)).length()
				jn += 1
			hist[b] = h
		# 踩地的腳（鞋底幾乎貼地）在原地播放時往後移動的速度，應該等於走路的前進速度
		if l < 0.008:
			if prev.has(lg.foot): slide.append(-(ball.z - (prev[lg.foot] as Vector3).z) * 30.0 * EnemyRig.SCALE)
			prev[lg.foot] = ball
		else: prev.erase(lg.foot)
	lows.append(low)
