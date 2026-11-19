extends SceneTree
# 印出主角模型的材質設定，並把貼圖存成圖片檢查
func _initialize():
	var hero = load("res://assets/hero/hero.glb").instantiate()
	for mi in hero.find_children("*", "MeshInstance3D", true, false):
		var mesh: Mesh = mi.mesh
		print("網格 ", mi.name.left(20), " 面數材質組 ", mesh.get_surface_count())
		for i in mesh.get_surface_count():
			var m: BaseMaterial3D = mesh.surface_get_material(i)
			print("  金屬度 ", m.metallic, " 金屬貼圖 ", m.metallic_texture != null, " 通道 ", m.metallic_texture_channel,
				"｜粗糙度 ", m.roughness, " 粗糙貼圖 ", m.roughness_texture != null, " 通道 ", m.roughness_texture_channel,
				"｜反光 ", m.metallic_specular, "｜法線貼圖 ", m.normal_enabled, "｜顏色 ", m.albedo_color, " 貼圖 ", m.albedo_texture != null,
				"｜發光 ", m.emission_enabled, "｜透明 ", m.transparency, "｜雙面 ", m.cull_mode)
			for pr in [["albedo", m.albedo_texture], ["mr", m.metallic_texture], ["rough", m.roughness_texture], ["normal", m.normal_texture]]:
				if pr[1] != null:
					var img: Image = pr[1].get_image()
					if img.is_compressed(): img.decompress()
					img.save_png("user://hero_%s.png" % pr[0])
					print("  貼圖 ", pr[0], " 尺寸 ", img.get_size())
	quit()
