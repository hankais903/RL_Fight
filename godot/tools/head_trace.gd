extends SceneTree
var sk: Skeleton3D
var n := 0
var on := false
func _initialize():
	HeroRig.hair_physics = false
	HeroRig.foot_ik = not OS.get_cmdline_user_args().has("--noik")
	var h = HeroRig.build()
	get_root().add_child(h.node)
	sk = h.skel
	sk.skeleton_updated.connect(_s)
	(h.anim as AnimationPlayer).play("idle", 0.0)
	for i in 10: await process_frame
	on = true
	for i in 6: await process_frame
	quit()
func _s() -> void:
	if not on: return
	var hd := sk.get_bone_global_pose(sk.find_bone("Head")).origin
	var hp := sk.get_bone_global_pose(sk.find_bone("Hips")).origin
	print("畫面格 %d　髖 y=%.4f　頭 (%.4f, %.4f, %.4f)" % [Engine.get_process_frames(), hp.y, hd.x, hd.y, hd.z])
