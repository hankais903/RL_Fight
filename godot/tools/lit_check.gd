extends SceneTree
# 檢查：各時段、各位置的角色照到主光的比例（1 = 完全照到，0 = 完全被建築擋住）
func _initialize():
	var st := Street.new()
	get_root().add_child(st)
	for t in ["day", "dusk", "night"]:
		st.set_tod(t)
		var row := ""
		for x in [-6.0, -4.5, -3.0, -1.5, 0.0, 1.5, 3.0, 4.5, 6.0]:
			row += "  x=%.1f→%.2f" % [x, st.lit_amount(Vector3(x, 0, 0))]
		print(Street.TOD[t].name, row)
	quit()
