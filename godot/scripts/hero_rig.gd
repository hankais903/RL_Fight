class_name HeroRig
# 主角模型 ＋ Mixamo 動作庫（檢視器和遊戲共用）

const HERO_SCALE := 1.8
# 招式：[動作檔名, 命中格(30fps), 位移保留比例, 中文名]
const MOVES := {
	"idle":  ["fighting_idle", -1, 1.0, "待機"],
	"jab":   ["punching", 13, 1.0, "刺拳"],
	"cross": ["cross_punch", 24, 1.0, "重拳"],
	"hook":  ["hook_punch", 27, 1.0, "勾拳"],
	"upper": ["uppercut", 12, 1.0, "上勾拳"],
	"round": ["roundhouse_kick", 22, 0.5, "迴旋踢"],
	"side":  ["side_kick", 14, 0.5, "側踢"],
	"fly":   ["flying_kick", 9, 0.3, "飛踢"],
}

# 回傳 {node, skel, anim}
static func build(trim_root := true) -> Dictionary:
	var hero: Node3D = load("res://assets/hero/hero.glb").instantiate()
	hero.scale = Vector3.ONE * HERO_SCALE
	var skel: Skeleton3D = hero.find_children("*", "Skeleton3D", true, false)[0]
	var lib := AnimationLibrary.new()
	for k in MOVES:
		var sc: Node = load("res://assets/anims/%s.fbx" % MOVES[k][0]).instantiate()
		var ap: AnimationPlayer = sc.find_children("*", "AnimationPlayer", true, false)[0]
		var an: Animation = ap.get_animation(ap.get_animation_list()[0]).duplicate()
		if trim_root: _trim_root_motion(an, MOVES[k][2])
		an.loop_mode = Animation.LOOP_LINEAR if k == "idle" else Animation.LOOP_NONE
		lib.add_animation(k, an)
		sc.free()
	var anim := AnimationPlayer.new()
	hero.add_child(anim)
	anim.add_animation_library("", lib)
	return {"node": hero, "skel": skel, "anim": anim}

# 原地出招：髖部的水平位移只保留一部分，移動交給遊戲（衝刺）
static func _trim_root_motion(an: Animation, keep: float) -> void:
	for t in an.get_track_count():
		if an.track_get_type(t) != Animation.TYPE_POSITION_3D: continue
		if not str(an.track_get_path(t)).ends_with(":Hips"): continue
		var n := an.track_get_key_count(t)
		if n == 0: continue
		var p0: Vector3 = an.track_get_key_value(t, 0)
		for i in n:
			var p: Vector3 = an.track_get_key_value(t, i)
			an.track_set_key_value(t, i, Vector3((p.x - p0.x) * keep, p.y, (p.z - p0.z) * keep))
