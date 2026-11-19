extends SceneTree
# 檢查循環音的起播位置與淡入：印出前 2 秒每 0.25 秒的播放位置和音量
func _initialize():
	var s := Sfx.new()
	get_root().add_child(s)
	await process_frame
	s.loop_volume("bgm", -15.0)
	for i in 9:
		var lp: AudioStreamPlayer = s.loops["bgm"]
		print("第 %.2f 秒｜正在播放 %s｜播放位置 %.2f 秒｜音量 %.1f 分貝" % [i * 0.25, lp.playing, lp.get_playback_position(), lp.volume_db])
		await create_timer(0.25).timeout
	quit()
