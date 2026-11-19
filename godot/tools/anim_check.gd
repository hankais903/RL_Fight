extends SceneTree
# 檢查動作資料：長度、關鍵格數量、補間方式（確認不是資料本身跳格）
func _initialize():
	var h = HeroRig.build()
	var anim: AnimationPlayer = h.anim
	for k in ["idle", "cross", "round"]:
		var an: Animation = anim.get_animation(k)
		var t := -1
		for i in an.get_track_count():
			if str(an.track_get_path(i)).ends_with(":RightUpperArm") and an.track_get_type(i) == Animation.TYPE_ROTATION_3D: t = i
		print("%s：長度 %.2f 秒，右上臂關鍵格 %d 個（每秒 %.0f 個），補間方式 %d（1＝線性），壓縮 %s，步進 %.4f" % [HeroRig.MOVES[k][3], an.length, an.track_get_key_count(t), an.track_get_key_count(t) / an.length, an.track_get_interpolation_type(t), an.track_is_compressed(t), an.step])
	print("動畫播放器更新時機 ", anim.callback_mode_process, "（1＝每格畫面更新）")
	quit()
