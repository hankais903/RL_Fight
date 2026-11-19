extends SceneTree
func _initialize():
	var sum := 0.0
	for m in HeroRig.COMBO:
		var t := HeroRig.move_time(m)
		sum += t[1]
		print("%s｜蓄力 %.2f 秒｜整招 %.2f 秒" % [HeroRig.MOVES[m][3], t[0], t[1]])
	print("一套十招 %.1f 秒，平均每招 %.2f 秒" % [sum, sum / HeroRig.COMBO.size()])
	quit()
