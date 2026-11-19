extends SceneTree
# 量頭部移動的速度與加速度（世界座標），判斷頭髮物理的輸入有多大
var sk: Skeleton3D
var hist: Array = []
var acc: Array = []
var spd: Array = []
func _initialize():
	HeroRig.hair_physics = false
	var h = HeroRig.build()
	get_root().add_child(h.node)
	sk = h.skel
	sk.skeleton_updated.connect(_s)
	var anim: AnimationPlayer = h.anim
	for k in ["idle", "jab", "upper"]:
		anim.play(k, 0.1)
		for i in 6: await process_frame
		hist.clear(); acc.clear(); spd.clear()
		var frames := int(anim.current_animation_length * 30.0) - 8 if k != "idle" else 90
		for i in frames: await process_frame
		acc.sort(); spd.sort()
		print("%s｜頭部速度 中位數 %.2f 最大 %.2f 公尺／秒｜加速度 中位數 %.1f 九成 %.1f 最大 %.1f 公尺／秒平方" % [HeroRig.MOVES[k][3], spd[spd.size() / 2], spd[-1], acc[acc.size() / 2], acc[acc.size() * 9 / 10], acc[-1]])
	quit()
func _s() -> void:
	var p: Vector3 = sk.global_transform * sk.get_bone_global_pose(sk.find_bone("Head")).origin
	hist.append(p)
	if hist.size() > 3: hist.pop_front()
	if hist.size() == 3:
		acc.append(((hist[2] as Vector3) - (hist[1] as Vector3) * 2.0 + (hist[0] as Vector3)).length() * 900.0)
		spd.append(((hist[2] as Vector3) - (hist[1] as Vector3)).length() * 30.0)
