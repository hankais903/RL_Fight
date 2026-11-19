extends SceneTree
func _initialize():
	var h = HeroRig.build()
	get_root().add_child(h.node)
	var s: SashSim = h.sash
	if s == null:
		print("飄帶：沒有建立")
	else:
		for ch in s.chains:
			var r: Array = ch.rest
			print("飄帶 骨頭 ", ch.bones, " 從 ", (r[0] as Vector3).snapped(Vector3.ONE * 0.01), " 到 ", (r[4] as Vector3).snapped(Vector3.ONE * 0.01))
	quit()
