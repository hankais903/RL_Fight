class_name TunePanel
extends PanelContainer
# 動作速度調整面板：用滑桿（或旁邊的 − ＋ 按鈕）即時調整出招的速度，遊戲和動作檢視器共用。
# 調好的值存在使用者資料夾，下次打開還在；「還原預設」會回到程式裡的預設值。

const SAVE_PATH := "user://tune.cfg"
# [名稱, 存檔用的鍵, 最小, 最大, 每格, 說明]
const ITEMS := [
	["蓄力速度", "wind", 0.8, 4.0, 0.1, "起手到打中這一段的播放倍率"],
	["收招速度", "recover", 0.8, 4.0, 0.1, "打中到接下一招這一段的播放倍率"],
	["命中停頓", "hitstop", 0.0, 2.5, 0.1, "打中瞬間定格時間的倍率（0＝不停頓）"],
	["待機速度", "idle", 0.4, 2.0, 0.1, "沒在出招時備戰動作的播放倍率"],
]

var sliders := {}
var values := {}
var info: Label

static func _val(key: String) -> float:
	match key:
		"wind": return HeroRig.WIND_SPEED
		"recover": return HeroRig.RECOVER_SPEED
		"hitstop": return HeroRig.HITSTOP_SCALE
		_: return HeroRig.IDLE_SPEED

static func _put(key: String, v: float) -> void:
	match key:
		"wind": HeroRig.WIND_SPEED = v
		"recover": HeroRig.RECOVER_SPEED = v
		"hitstop": HeroRig.HITSTOP_SCALE = v
		_: HeroRig.IDLE_SPEED = v

# 啟動時呼叫：把上次調好的值讀回來
static func load_saved() -> void:
	var cf := ConfigFile.new()
	if cf.load(SAVE_PATH) != OK: return
	for it in ITEMS:
		if cf.has_section_key("speed", it[1]): _put(it[1], clampf(float(cf.get_value("speed", it[1])), it[2], it[3]))

static func _save() -> void:
	var cf := ConfigFile.new()
	for it in ITEMS: cf.set_value("speed", it[1], _val(it[1]))
	cf.save(SAVE_PATH)

func _init() -> void:
	visible = false
	set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	grow_vertical = Control.GROW_DIRECTION_BEGIN
	offset_left = 12
	offset_right = -12
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0.06, 0.07, 0.1, 0.9)
	bg.set_corner_radius_all(10)
	bg.set_content_margin_all(14)
	add_theme_stylebox_override("panel", bg)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	add_child(box)
	var title := Label.new()
	title.text = "動作速度調整"
	title.add_theme_color_override("font_color", Color("ffe14a"))
	box.add_child(title)
	for it in ITEMS:
		var key: String = it[1]
		var row := HBoxContainer.new()
		box.add_child(row)
		var name_lb := Label.new()
		name_lb.text = it[0]
		name_lb.custom_minimum_size.x = 132
		name_lb.add_theme_font_size_override("font_size", 26)
		row.add_child(name_lb)
		var minus := Button.new()
		minus.text = "−"
		minus.custom_minimum_size = Vector2(58, 58)
		minus.focus_mode = Control.FOCUS_NONE
		row.add_child(minus)
		var sl := HSlider.new()
		sl.min_value = it[2]
		sl.max_value = it[3]
		sl.step = it[4]
		sl.value = _val(key)
		sl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		sl.custom_minimum_size.y = 44
		sl.focus_mode = Control.FOCUS_NONE
		row.add_child(sl)
		var plus := Button.new()
		plus.text = "＋"
		plus.custom_minimum_size = Vector2(58, 58)
		plus.focus_mode = Control.FOCUS_NONE
		row.add_child(plus)
		var val := Label.new()
		val.custom_minimum_size.x = 76
		val.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(val)
		sliders[key] = sl
		values[key] = val
		sl.value_changed.connect(_changed.bind(key))
		minus.pressed.connect(func(): sl.value -= sl.step)
		plus.pressed.connect(func(): sl.value += sl.step)
	info = Label.new()
	info.add_theme_font_size_override("font_size", 22)
	info.add_theme_color_override("font_color", Color(0.75, 0.8, 0.9))
	info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(info)
	var row2 := HBoxContainer.new()
	box.add_child(row2)
	for b in [["還原預設", _reset], ["關閉", func(): visible = false]]:
		var btn := Button.new()
		btn.text = b[0]
		btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		btn.custom_minimum_size.y = 62
		btn.focus_mode = Control.FOCUS_NONE
		btn.pressed.connect(b[1])
		row2.add_child(btn)
	_refresh()

func _changed(v: float, key: String) -> void:
	_put(key, v)
	_save()
	_refresh()

func _reset() -> void:
	for it in ITEMS: (sliders[it[1]] as HSlider).value = HeroRig.SPEED_DEFAULTS[it[1]]

func _refresh() -> void:
	for it in ITEMS: (values[it[1]] as Label).text = "%.1f 倍" % _val(it[1])
	# 換算成實際的節奏，方便判斷
	var sum := 0.0
	var fast := 99.0
	var slow := 0.0
	for m in HeroRig.COMBO:
		var t: float = HeroRig.move_time(m)[1]
		sum += t
		fast = minf(fast, t)
		slow = maxf(slow, t)
	info.text = "目前節奏：平均每招 %.2f 秒（最快 %.2f、最慢 %.2f），一套十招 %.1f 秒。數值會自動記住。" % [sum / HeroRig.COMBO.size(), fast, slow, sum]

func toggle() -> void:
	visible = not visible
