extends SceneTree
# 測試用：建一個簡單的 3D 場景，畫幾格後存成圖片
func _initialize():
	var root3 = Node3D.new()
	get_root().add_child(root3)
	var cam = Camera3D.new(); cam.position = Vector3(0, 2, 5); root3.add_child(cam); cam.look_at(Vector3.ZERO)
	var light = DirectionalLight3D.new(); light.rotation_degrees = Vector3(-50, 30, 0); light.shadow_enabled = true; root3.add_child(light)
	var box = MeshInstance3D.new(); box.mesh = BoxMesh.new(); box.position.y = 0.5; root3.add_child(box)
	var floor = MeshInstance3D.new(); var pm = PlaneMesh.new(); pm.size = Vector2(10, 10); floor.mesh = pm; root3.add_child(floor)
	for i in 5: await process_frame
	await RenderingServer.frame_post_draw
	var img = get_root().get_texture().get_image()
	img.save_png("user://probe.png")
	print("存檔 ", ProjectSettings.globalize_path("user://probe.png"), " 大小 ", img.get_size())
	quit()
