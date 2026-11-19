extends SceneTree
# 檢查合成音效：長度、最大振幅、平均音量（這個環境沒有音訊裝置，只能看數字）
func _initialize():
	var s := Sfx.new()
	get_root().add_child(s)
	await process_frame
	for k in s.streams:
		var w: AudioStreamWAV = s.streams[k]
		var n := w.data.size() / 2
		var peak := 0.0
		var sum := 0.0
		for i in n:
			var v := w.data.decode_s16(i * 2) / 32768.0
			peak = maxf(peak, absf(v))
			sum += v * v
		print("%s｜長度 %.2f 秒｜最大振幅 %.2f｜平均音量 %.3f" % [k, float(n) / w.mix_rate, peak, sqrt(sum / n)])
	for k in s.banks: print("音檔 %s｜%d 個版本" % [k, (s.banks[k] as Array).size()])
	for k in s.loops: print("循環 %s｜%.1f 秒" % [k, ((s.loops[k] as AudioStreamPlayer).stream as AudioStream).get_length()])
	quit()
