extends Node3D
# 技能測試場：只為了測試技能而做的獨立環境，不跑遊戲的波次、血量、自動連段。
# 主角站在場地中央，四周擺幾圈敵人（預設站著不動，也可以切成一直走過來）；
# 上方兩個大按鈕各放一種技能（震地、穿透拳），按了之後下方的滑桿會切到那個技能的數值；
# 「重置」把敵人擺回去，「換隊形」在三圈和直排之間切換，「走動」讓敵人一直走過來。
# 鏡頭、場景、光線跟遊戲一樣，所以這裡看到的大小就是遊戲裡的大小。
#
# 第一個技能「震地」：主角出招落地，以自己為圓心震出一圈正圓的震波往外擴——掃到的敵人全部受傷並被往外震退。

const ENEMY_HP := {"grunt": 5.0, "runner": 4.0, "tank": 24.0}
const BASE_DMG := 5.0          # 跟遊戲裡普通一拳的傷害一樣，技能的傷害用它的倍數表示
# 可以調的數值：[名稱, 最小, 最大, 每格, 預設, 單位]
# 最後一欄是這個數值屬於哪個技能（按哪個技能的按鈕，下方就顯示哪一組滑桿）
const PARAMS := {
	"range": ["範圍", 1.0, 5.0, 0.1, 2.5, "公尺", "quake"],
	"dmg": ["傷害", 0.5, 6.0, 0.1, 1.5, "倍", "quake"],
	"knock": ["擊退", 0.0, 4.0, 0.1, 2.0, "公尺", "quake"],
	"p_len": ["穿透", 1.0, 8.0, 0.5, 4.0, "公尺", "pierce"],
	"p_dmg": ["後排", 0.1, 1.5, 0.1, 0.5, "倍", "pierce"],
	"p_wid": ["寬度", 0.4, 2.0, 0.1, 0.8, "公尺", "pierce"],
	"f_hits": ["連打", 4.0, 14.0, 1.0, 8.0, "下", "flurry"],
	"f_dmg": ["每下", 0.2, 1.5, 0.1, 0.6, "倍", "flurry"],
	"f_fin": ["收尾", 1.0, 5.0, 0.5, 2.0, "倍", "flurry"],
	"s_range": ["範圍", 1.5, 6.0, 0.1, 3.5, "公尺", "roar"],
	"s_time": ["冰凍", 0.5, 6.0, 0.5, 2.5, "秒", "roar"],
	"s_amp": ["增傷", 1.0, 4.0, 0.1, 2.0, "倍", "roar"],
	"c_jumps": ["跳數", 2.0, 12.0, 1.0, 6.0, "個", "chain"],
	"c_dist": ["跳距", 1.0, 5.0, 0.1, 2.5, "公尺", "chain"],
	"c_dmg": ["傷害", 0.5, 4.0, 0.1, 1.5, "倍", "chain"],
}
var val := {"range": 2.5, "dmg": 1.5, "knock": 2.0, "p_len": 4.0, "p_dmg": 0.5, "p_wid": 0.8, "f_hits": 8.0, "f_dmg": 0.6, "f_fin": 2.0, "s_range": 3.5, "s_time": 2.5, "s_amp": 2.0, "c_jumps": 6.0, "c_dist": 2.5, "c_dmg": 1.5}
var skill := "quake"           # 目前在看哪個技能的數值
var rows := {}                 # 參數名稱 → 那一列滑桿（切換技能時顯示或隱藏）
var layout := "ring"           # 敵人的隊形：ring 三圈、line 四個方向各排一直排

var street: Plaza
var sfx: Sfx
var hero: Node3D
var anim: AnimationPlayer
var cam: Camera3D
var fx_root: Node3D
var gore: Gore
var skel: Skeleton3D
var hero_glow: StandardMaterial3D     # 主角蓄力時身上發光用的疊加材質
var orb = null                 # 蓄力時拳頭上的光球（跟著拳頭走）
var fx_sh := {}
var fx_quad: QuadMesh = null
var fx_strip: ArrayMesh = null
var zoom := 0.0                # 命中瞬間鏡頭拉近的量（度），很快彈回
var slow_t := 0.0              # 慢動作還剩幾秒（真實時間）
var info: Label
var enemies: Array = []
var walking := false
var cast = null                # 施放中：{t, hit_at, total, target}
var hero_yaw := 0.0
var shake := 0.0
var shake_dir := Vector2.ZERO
var hitstop := 0.0
var last_hits := 0
var last_kills := 0
var num_font: Font = null
var value_labels := {}
var draw_acc := 0.0
var time := 0.0

func _ready() -> void:
	Engine.time_scale = 1.0
	RenderingServer.render_loop_enabled = true
	get_tree().paused = false
	TunePanel.load_saved()
	sfx = Sfx.new()
	add_child(sfx)
	street = Plaza.new()
	add_child(street)
	var we := WorldEnvironment.new()
	we.environment = street.env
	add_child(we)
	street.set_tod("day")
	var h := HeroRig.build()
	hero = h.node
	anim = h.anim
	skel = h.skel
	add_child(hero)
	street.add_character(hero)
	hero_glow = _add_mat(Color(1.0, 0.72, 0.25, 0.0))
	for m in hero.find_children("*", "MeshInstance3D", true, false): (m as MeshInstance3D).material_overlay = hero_glow
	anim.play("idle")
	cam = Camera3D.new()
	cam.fov = 40.0
	add_child(cam)
	fx_root = Node3D.new()
	add_child(fx_root)
	Gore.load_saved()
	gore = Gore.new()
	add_child(gore)
	_build_ui()
	_reset()
	_update_camera()
	_test_args()

# ---------------- 敵人 ----------------
# 三圈敵人：內圈貼近主角，外圈在技能範圍之外，才看得出範圍的邊界在哪裡
func _reset() -> void:
	for e in enemies:
		(e.node as Node3D).queue_free()
		if e.ice != null and is_instance_valid(e.ice): (e.ice as Node).queue_free()
	enemies.clear()
	var i := 0
	if layout == "line":
		# 直排：四個方向各排一列六個，測穿透拳用（一拳能穿過幾個一目了然）
		for c in 4:
			var a := TAU * c / 4.0 + 0.5
			for k in 6:
				var kind: String = "tank" if (c == 1 and k == 2) else ("runner" if (i % 3 == 1) else "grunt")
				_spawn(kind, Vector3(cos(a), 0, sin(a)) * (1.6 + k * 1.0))
				i += 1
	else:
		for ring in [[1.7, 6], [3.0, 9], [4.4, 12]]:
			for k in int(ring[1]):
				var a := TAU * k / float(ring[1]) + float(ring[0])
				var kind: String = "tank" if i % 9 == 4 else ("runner" if i % 3 == 1 else "grunt")
				_spawn(kind, Vector3(cos(a), 0, sin(a)) * float(ring[0]))
				i += 1
	last_hits = 0
	last_kills = 0

func _spawn(kind: String, pos: Vector3) -> void:
	var mul: float = {"runner": 0.97, "tank": 1.25}.get(kind, 1.0)
	var rig := EnemyRig.build(kind, mul)
	var node: Node3D = rig.node
	add_child(node)
	street.add_character(node, 0.5 * mul, false)
	node.position = pos
	node.rotation.y = atan2(-pos.x, -pos.z)
	var ea: AnimationPlayer = rig.anim
	ea.play(rig.move)
	ea.seek(randf() * ea.current_animation_length, true)
	ea.speed_scale = 0.0
	enemies.append({"kind": kind, "node": node, "anim": ea, "fix": rig.fix, "meshes": rig.meshes, "move": rig.move, "move_speed": rig.move_speed, "mul": mul,
		"pos": pos, "hp": ENEMY_HP[kind], "dead": false, "flash": 0.0, "stun": 0.0, "push": null, "life": 0.0, "frozen": 0.0, "ice": null})

func _update_enemies(dt: float) -> void:
	for e in enemies:
		var node: Node3D = e.node
		var ea: AnimationPlayer = e.anim
		# 被震退：短時間內滑到新的位置（先快後慢）
		if e.push != null:
			e.push.t += dt
			var k: float = 1.0 - pow(1.0 - minf(1.0, e.push.t / 0.4), 3.0)
			e.pos = (e.push.from as Vector3).lerp(e.push.to, k)
			if e.push.t >= 0.4: e.push = null
		if e.dead:
			if e.ice != null: _thaw(e)        # 凍著的時候被打死：冰當場碎掉
			e.life -= dt
			node.position = e.pos
			if e.life < 0.6: node.position.y = -(0.6 - e.life) / 0.6 * 0.5
			continue
		e.flash = maxf(0.0, e.flash - dt)
		e.stun = maxf(0.0, e.stun - dt)
		var want: bool = e.flash > 0.0
		for m in e.meshes: (m as MeshInstance3D).material_overlay = EnemyRig.flash_mat if want else (ice_mat if e.frozen > 0.0 else null)
		# 被凍住：動作整個停住、不走也不轉身，時間到冰才碎掉
		if e.frozen > 0.0:
			e.frozen -= dt
			ea.speed_scale = 0.0
			node.position = e.pos
			if e.ice != null and is_instance_valid(e.ice): (e.ice as Node3D).position = e.pos
			if e.frozen <= 0.0: _thaw(e)
			continue
		var to: Vector3 = hero.position - (e.pos as Vector3)
		to.y = 0
		var d := to.length()
		if e.stun <= 0.0:
			if ea.current_animation != e.move: ea.play(e.move, 0.2)
			if walking and d > 1.3:
				e.pos += to / d * (e.move_speed as float) * (e.mul as float) * 0.75 * dt
				ea.speed_scale = 0.75
			else:
				ea.speed_scale = 0.0
			if d > 0.01: node.rotation.y = lerp_angle(node.rotation.y, atan2(to.x, to.z), minf(1.0, dt * 8.0))
		node.position = e.pos
	enemies = enemies.filter(func(e):
		if e.dead and e.life <= 0.0:
			(e.node as Node3D).queue_free()
			return false
		return true)

# ---------------- 技能：震地 ----------------
func _cast_quake() -> void:
	_cast("quake", "fly")

func _cast_pierce() -> void:
	_cast("pierce", "cross")

func _cast_flurry() -> void:
	_show_skill("flurry")
	if cast != null: return
	var target = null
	var best := 1e9
	for e in enemies:
		if e.dead: continue
		var d: float = (e.pos as Vector3).distance_to(hero.position)
		if d < best:
			best = d
			target = e
	if target == null or best > 2.8: return        # 要有敵人在面前才打得出來
	var to: Vector3 = (target.pos as Vector3) - hero.position
	hero_yaw = atan2(to.x, to.z)
	hero.rotation.y = hero_yaw
	last_hits = 0
	last_kills = 0
	var n := int(val.f_hits)
	cast = {"skill": "flurry", "t": 0.0, "target": target, "n": n, "i": 0, "done": false, "fin_t": FLURRY_CHARGE + n * FLURRY_GAP + FLURRY_PAUSE, "total": FLURRY_CHARGE + n * FLURRY_GAP + FLURRY_PAUSE + 1.0, "wind_speed": 1.0, "hit_at": 0.0, "fin_started": false}
	anim.play("jab", 0.1)
	anim.seek(4.0 / 30.0, true)
	anim.speed_scale = 0.15
	sfx.play("whoosh", -7.0, 0.7)
	_flurry_charge()

func _cast(which: String, move: String) -> void:
	_show_skill(which)
	if cast != null: return
	# 找最近的敵人當落點；場上沒有敵人就踢向正前方
	var target = null
	var best := 1e9
	for e in enemies:
		if e.dead: continue
		var d: float = (e.pos as Vector3).distance_to(hero.position)
		if d < best:
			best = d
			target = e
	var tm := HeroRig.move_time(move)
	if target != null:
		var to: Vector3 = (target.pos as Vector3) - hero.position
		hero_yaw = atan2(to.x, to.z)
	hero.rotation.y = hero_yaw
	anim.play(move, 0.07)
	anim.seek(HeroRig.MOVES[move][4] / 30.0, true)
	var wind_speed := HeroRig.WIND_SPEED
	var hit_at: float = tm[0]
	var total: float = tm[1] + 0.25
	if which == "pierce":
		# 穿透拳有一段蓄力：拉拳的動作放慢，讓人看得出是在集氣放大招
		# 光柱要跟揮拳同步（使用者：現在是揮完拳才出氣功）。量過這個動作：第 12～17 格是前手先探一下，
		# 真正的後手直拳在第 20～24 格才打出去。原本從第 12 格開始播、第 24 格才發射，看起來就像「先打一拳，隔一下才出光柱」。
		# 所以改成：跳過前手那一段，停在後手拉滿的姿勢蓄力（第 18→20 格慢慢走），蓄滿後後手高速打出去，
		# 拳頭一送出去光柱就跟著轟出來，手臂伸直停住直到光柱打完才收回。
		anim.seek(PIERCE_F_CHARGE / 30.0, true)
		wind_speed = (PIERCE_F_THRUST - PIERCE_F_CHARGE) / 30.0 / PIERCE_CHARGE_TIME
		hit_at = PIERCE_CHARGE_TIME + (PIERCE_F_FIRE - PIERCE_F_THRUST) / 30.0 / PIERCE_THRUST_SPEED
		total = PIERCE_CHARGE_TIME + (PIERCE_F_OUT - PIERCE_F_THRUST) / 30.0 / PIERCE_THRUST_SPEED + PIERCE_HOLD + (HeroRig.MOVES[move][5] - PIERCE_F_OUT) / 30.0 / HeroRig.RECOVER_SPEED + 0.35
		_charge_fx(hit_at)
	anim.speed_scale = wind_speed
	sfx.play("whoosh_kick" if move == "fly" else "whoosh", -7.0)
	cast = {"t": 0.0, "hit_at": hit_at, "total": total, "target": target, "done": false, "skill": which, "wind_speed": wind_speed}

# 震波一律是以主角為圓心的正圓，從腳下往外擴（使用者要求：不管強或弱都是圓圈震波往外震）。
# 範圍調大調小只是圓的半徑不同；敵人被往正外側推，震波掃到誰、誰才受傷（離得越遠越晚被打到）。
const WAVE_TIME := 0.9         # 震波從腳下擴到最外圈花的時間（同時從最亮淡到看不見）
func _quake() -> void:
	var fwd := Vector3(sin(hero_yaw), 0, cos(hero_yaw))
	var center := Vector3(hero.position.x, 0, hero.position.z)
	var r: float = val.range
	last_hits = 0
	last_kills = 0
	for e in enemies:
		if e.dead: continue
		var off: Vector3 = (e.pos as Vector3) - center
		off.y = 0
		if off.length() > r: continue
		last_hits += 1
		var dir := off.normalized() if off.length() > 0.05 else fwd
		# 震波的前緣到了才生效
		# 光環是先快後慢地擴出去的，照同一條曲線算它掃到這個敵人的時間
		var delay := WAVE_TIME * (1.0 - pow(1.0 - clampf(off.length() / r, 0.0, 1.0), 1.0 / 3.0))
		get_tree().create_timer(delay).timeout.connect(_quake_hit.bind(e, dir))
	# 表現：定格一下、鏡頭震動、聲音、圓形震波
	hitstop = 0.08
	shake = 0.5
	shake_dir = Vector2(fwd.x, fwd.z)
	sfx.play("boom", 1.0)
	_wave_fx(center, r)

func _quake_hit(e: Dictionary, dir: Vector3) -> void:
	if e.dead or not is_instance_valid(e.node): return
	var dmg: float = _amp(e, BASE_DMG * (val.dmg as float))
	e.hp -= dmg
	e.flash = 0.12
	e.stun = 0.5
	_number((e.pos as Vector3) + Vector3(0, 2.0, 0), dmg)
	var ea: AnimationPlayer = e.anim
	ea.speed_scale = 1.0
	if e.hp <= 0.0:
		e.dead = true
		e.life = 2.8
		last_kills += 1
		for m in e.meshes: (m as MeshInstance3D).material_overlay = null
		(e.fix as BodyFix).foot_ik = false
		(e.node as Node3D).set_meta("down", true)
		(e.node as Node3D).rotation.y = atan2(-dir.x, -dir.z)      # 背對圓心倒下去
		ea.play("fall", 0.08, EnemyRig.FALL_SPEED)
		ea.seek(EnemyRig.FALL_ENTER / 30.0, true)
	elif e.frozen <= 0.0:
		ea.play("hit", 0.05, 2.0)
		ea.seek(0.12, true)
	e.push = {"t": 0.0, "from": e.pos, "to": (e.pos as Vector3) + dir * (val.knock as float)}

# ---------------- 技能：穿透拳 ----------------
# 正直拳打中最近的敵人（照常一拳的傷害），力道穿過去，打到他正後方一直線上的敵人。
# 後排吃的傷害是一拳的幾成（p_dmg），不擊退——推人是震地的事，兩個技能的手感才分得開。
# 被打倒的照遊戲的規則順著出拳方向飛出去倒下。
const PIERCE_SPEED := 26.0     # 力道往後傳的速度（公尺／秒），後排依距離先後被打到
func _pierce() -> void:
	var fwd := Vector3(sin(hero_yaw), 0, cos(hero_yaw))
	var tg = cast.target
	last_hits = 0
	last_kills = 0
	if tg == null or tg.dead or (tg.pos as Vector3).distance_to(hero.position) > 2.8:
		sfx.play("whoosh", -6.0)       # 揮空
		return
	var origin: Vector3 = tg.pos
	origin.y = 0
	var dir: Vector3 = origin - Vector3(hero.position.x, 0, hero.position.z)
	dir = dir.normalized() if dir.length() > 0.05 else fwd
	var side := dir.cross(Vector3.UP)
	# 第一個目標：完整的一拳
	last_hits = 1
	_strike(tg, dir, BASE_DMG)
	# 後排：在目標後方 p_len 公尺內、離這條直線不超過半個寬度（再加敵人自己的半個身寬）
	var far := 0.0
	for e in enemies:
		if e.dead or e == tg: continue
		var off: Vector3 = (e.pos as Vector3) - origin
		off.y = 0
		var along := off.dot(dir)
		if along <= 0.05 or along > (val.p_len as float): continue
		if absf(off.dot(side)) > (val.p_wid as float) * 0.5 + 0.3 * (e.mul as float): continue
		last_hits += 1
		far = maxf(far, along)
		get_tree().create_timer(along / PIERCE_SPEED).timeout.connect(_strike.bind(e, dir, BASE_DMG * (val.p_dmg as float)))
	# 爆發：定格、鏡頭大力震加瞬間拉近、定格後接一小段慢動作、聲音疊兩層
	hitstop = 0.05      # 發射的瞬間只頓一下：拳頭還在往前送，定太久會停在半路
	shake = 0.5
	zoom = 5.0
	slow_t = 0.4
	shake_dir = Vector2(dir.x, dir.z)
	sfx.play("boom", 2.0)
	sfx.play("crit", 0.0)
	_hit_fx(origin + Vector3(0, 1.25, 0), dir, 1.6)
	_beam_fx(dir, origin)

# 一個敵人挨一下（不擊退；打倒的話順著方向飛出去倒下）
func _strike(e: Dictionary, dir: Vector3, dmg: float) -> void:
	if e.dead or not is_instance_valid(e.node): return
	# 每一個被打到的都有自己的命中感：閃光、噴血、鏡頭再震一下
	var at: Vector3 = (e.pos as Vector3) + Vector3(0, 1.25, 0)
	if dmg < BASE_DMG:
		_hit_fx(at, dir, 1.1)
		sfx.play("hit", -3.0)
		shake = maxf(shake, 0.28)
	gore.burst(at, dir, 16 if dmg >= BASE_DMG else 10, 1.2)
	dmg = _amp(e, dmg)
	e.hp -= dmg
	e.flash = 0.12
	e.stun = 0.35
	_number((e.pos as Vector3) + Vector3(0, 2.0, 0), dmg)
	var ea: AnimationPlayer = e.anim
	ea.speed_scale = 1.0
	if e.hp <= 0.0:
		e.dead = true
		e.life = 2.8
		last_kills += 1
		for m in e.meshes: (m as MeshInstance3D).material_overlay = null
		(e.fix as BodyFix).foot_ik = false
		(e.node as Node3D).set_meta("down", true)
		(e.node as Node3D).rotation.y = atan2(-dir.x, -dir.z)
		ea.play("fall", 0.08, EnemyRig.FALL_SPEED)
		ea.seek(EnemyRig.FALL_ENTER / 30.0, true)
		e.push = {"t": 0.0, "from": e.pos, "to": (e.pos as Vector3) + dir * 1.9}
	elif e.frozen <= 0.0:
		ea.play("hit", 0.05, 2.4)
		ea.seek(0.12, true)

# ================= 穿透拳的表演：氣功砲 =================
# 使用者選的方向是「氣功砲」，並指出上一版太陽春、沒有層次、主角沒有戲。所以分成三段：
#   蓄力（主角慢慢拉拳、拳頭上聚出光球、四周的光往拳頭收、身上發光、鏡頭推近）
#   爆發（砲口閃光＋一道粗的能量光柱轟出去貫穿整排、砲口炸開兩圈衝擊環、定格與慢動作）
#   餘波（光柱從尾端收掉並變細、沿路有火星往上飄）
const PIERCE_CHARGE_TIME := 0.5        # 蓄力幾秒
const PIERCE_THRUST_SPEED := 1.5       # 出拳那一下的播放倍率
const PIERCE_HOLD := 0.34              # 手臂伸直停住多久（光柱在打的時間）
const PIERCE_F_CHARGE := 18.0          # 正直拳動作的格數：蓄力從這一格開始（後手拉滿的姿勢）
const PIERCE_F_THRUST := 20.0          # 後手開始打出去
const PIERCE_F_FIRE := 21.5            # 拳頭送出去到一半：光柱在這一格發射
const PIERCE_F_OUT := 24.0             # 手臂完全伸直
const KI_COL := Color(1.0, 0.62, 0.15)  # 能量的顏色（金橘，跟遊戲的命中特效同一個色系）

# 拳頭在世界座標的位置。front=true 取比較前面的那隻手（出拳的手），false 取後面的（蓄力拉著的手）
func _fist(front: bool) -> Vector3:
	var fwd := Vector3(sin(hero_yaw), 0, cos(hero_yaw))
	var best := hero.position + Vector3(0, 1.3, 0)
	var best_d := -1e9 if front else 1e9
	for bn in ["LeftHand", "RightHand"]:
		var bi := skel.find_bone(bn)
		if bi < 0: continue
		var p: Vector3 = skel.global_transform * skel.get_bone_global_pose(bi).origin
		var d := (p - hero.position).dot(fwd)
		if (front and d > best_d) or (not front and d < best_d):
			best_d = d
			best = p
	return best

# 用著色器畫的一片特效；回傳 [節點, 材質]
func _fx_shader_piece(mesh: Mesh, shader: String, col: Color) -> Array:
	if not fx_sh.has(shader): fx_sh[shader] = load("res://shaders/%s.gdshader" % shader)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	var m := ShaderMaterial.new()
	m.shader = fx_sh[shader]
	m.set_shader_parameter("color", col)
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	fx_root.add_child(mi)
	return [mi, m]

func _fx_meshes() -> void:
	if fx_quad != null: return
	fx_quad = QuadMesh.new()
	# 光柱用的長方片：尾端在原點、沿 Y 軸往前一個單位
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var pts := [[Vector3(-0.5, 0, 0), Vector2(0, 0)], [Vector3(0.5, 0, 0), Vector2(1, 0)], [Vector3(0.5, 1, 0), Vector2(1, 1)], [Vector3(-0.5, 1, 0), Vector2(0, 1)]]
	for k in [0, 1, 2, 0, 2, 3]:
		st.set_uv(pts[k][1])
		st.add_vertex(pts[k][0])
	fx_strip = st.commit()

# ---- 第一段：蓄力 ----
func _charge_fx(dur: float) -> void:
	_fx_meshes()
	var at := _fist(false)
	# 拳頭上的光球：從很小長到很大
	var o := _fx_shader_piece(fx_quad, "fx_glow", KI_COL)
	orb = o[0]
	var om: ShaderMaterial = o[1]
	(orb as Node3D).global_position = at
	(orb as Node3D).scale = Vector3.ONE * 0.25
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(orb, "scale", Vector3.ONE * 1.7, dur).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
	tw.tween_method(func(v: float): om.set_shader_parameter("alpha", v), 0.35, 1.0, dur)
	# 四周的光往拳頭收：一條條細光從外面飛進來
	for i in 14:
		var d := Vector3(randf_range(-1, 1), randf_range(-0.3, 1.0), randf_range(-1, 1)).normalized()
		var start := at + d * randf_range(1.6, 2.8)
		var st := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.05, 0.05, 1.0)
		st.mesh = bm
		var m2 := _add_mat(Color(1.0, 0.85, 0.45, 0.0))
		st.material_override = m2
		st.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		fx_root.add_child(st)
		st.look_at_from_position(start, at, Vector3.UP if absf(d.y) < 0.95 else Vector3.RIGHT)
		st.scale = Vector3(1, 1, randf_range(0.4, 0.8))
		var delay := randf_range(0.0, dur * 0.6)
		var fly := dur * 0.38
		var t2 := create_tween()
		t2.set_parallel(true)
		t2.tween_property(st, "position", at, fly).set_delay(delay).set_ease(Tween.EASE_IN)
		t2.tween_property(m2, "albedo_color:a", 0.9, fly * 0.4).set_delay(delay)
		t2.tween_property(st, "scale", Vector3(1, 1, 0.1), fly).set_delay(delay)
		t2.chain().tween_callback(st.queue_free)
	# 主角身上發光：越蓄越亮
	hero_glow.albedo_color = Color(1.0, 0.72, 0.25, 0.0)      # 穿透拳是金色（連環拳會把它改成紅色，這裡要改回來）
	var t4 := create_tween()
	t4.tween_property(hero_glow, "albedo_color:a", 0.5, dur).set_ease(Tween.EASE_IN)

# ---- 第二段＋第三段：爆發與餘波 ----
func _beam_fx(dir: Vector3, target_pos: Vector3) -> void:
	_fx_meshes()
	# 蓄力的光球收掉，主角身上的光先閃到最亮再退
	if orb != null and is_instance_valid(orb): (orb as Node3D).queue_free()
	orb = null
	hero_glow.albedo_color.a = 0.9
	create_tween().tween_property(hero_glow, "albedo_color:a", 0.0, 0.5)
	var muzzle := _fist(true)
	# 光柱跟出拳方向平行、高度在拳頭的高度，從拳頭一路打到目標後方的穿透距離
	var length: float = Vector2(target_pos.x - muzzle.x, target_pos.z - muzzle.z).length() + (val.p_len as float)
	var wid: float = maxf(1.5, (val.p_wid as float) * 2.4)
	var look := -cam.global_transform.basis.z
	var sx := dir.cross(look)
	if sx.length() < 0.05: sx = dir.cross(Vector3.UP)
	sx = sx.normalized()
	# 砲口的閃光
	var f := _fx_shader_piece(fx_quad, "fx_glow", KI_COL)
	var fl: MeshInstance3D = f[0]
	var flm: ShaderMaterial = f[1]
	fl.global_position = muzzle
	fl.scale = Vector3.ONE * 1.2
	var tf := create_tween()
	tf.set_parallel(true)
	tf.tween_property(fl, "scale", Vector3.ONE * 4.2, 0.2).set_ease(Tween.EASE_OUT)
	tf.tween_method(func(v: float): flm.set_shader_parameter("alpha", v), 1.0, 0.0, 0.3)
	tf.chain().tween_callback(fl.queue_free)
	# 光柱：頭端很快轟到底 → 維持一下 → 尾端往前收、同時變細變淡
	var b := _fx_shader_piece(fx_strip, "ki_beam", KI_COL)
	var beam: MeshInstance3D = b[0]
	var bm: ShaderMaterial = b[1]
	beam.basis = Basis(sx * wid, dir * length, sx.cross(dir).normalized())
	beam.position = muzzle
	bm.set_shader_parameter("head", 0.0)
	var tb := create_tween()
	tb.tween_method(func(v: float): bm.set_shader_parameter("head", v), 0.0, 1.05, 0.09)
	tb.tween_interval(0.16)
	tb.set_parallel(true)
	tb.tween_method(func(v: float): bm.set_shader_parameter("tail", v), 0.0, 1.0, 0.3).set_ease(Tween.EASE_IN)
	tb.tween_method(func(v: float): bm.set_shader_parameter("width", v), 1.0, 0.25, 0.3)
	tb.tween_method(func(v: float): bm.set_shader_parameter("alpha", v), 1.0, 0.0, 0.3).set_ease(Tween.EASE_IN)
	tb.chain().tween_callback(beam.queue_free)
	# 砲口炸開兩圈衝擊環（垂直於出拳方向，邊擴邊淡）
	for k in 2:
		var ring := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 0.8
		tm.outer_radius = 1.0
		tm.rings = 48
		tm.ring_segments = 4
		ring.mesh = tm
		var rm := _add_mat(Color(1.0, 0.8, 0.4, 0.9))
		ring.material_override = rm
		ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var up := Vector3.UP
		ring.basis = Basis(dir.cross(up).normalized(), dir, dir.cross(up).normalized().cross(dir))
		ring.position = muzzle + dir * (0.3 + k * 0.9)
		ring.scale = Vector3(0.25, 0.25, 0.25)
		fx_root.add_child(ring)
		var r1 := 1.5 - k * 0.4
		var delay := k * 0.05
		var tr := create_tween()
		tr.set_parallel(true)
		tr.tween_property(ring, "scale", Vector3(r1, 0.3, r1), 0.3).set_delay(delay).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
		tr.tween_property(rm, "albedo_color:a", 0.0, 0.3).set_delay(delay)
		tr.chain().tween_callback(ring.queue_free)
	var side := dir.cross(Vector3.UP).normalized()
	# 地上不放任何特效（使用者要求：地上的特效不要）——蓄力時腳下的光圈、打完後的灼痕都拿掉了
	# 餘波：沿路的火星往上飄
	for i in 18:
		var e := _fx_shader_piece(fx_quad, "fx_glow", Color(1.0, 0.7, 0.25))
		var en: MeshInstance3D = e[0]
		var em: ShaderMaterial = e[1]
		var p0 := muzzle + dir * randf_range(0.3, length) + side * randf_range(-0.35, 0.35)
		en.global_position = p0
		en.scale = Vector3.ONE * randf_range(0.12, 0.26)
		var delay := randf_range(0.05, 0.3)
		var life := randf_range(0.5, 0.9)
		var te := create_tween()
		te.set_parallel(true)
		te.tween_property(en, "position", p0 + Vector3(randf_range(-0.3, 0.3), randf_range(0.6, 1.5), randf_range(-0.3, 0.3)), life).set_delay(delay).set_ease(Tween.EASE_OUT)
		te.tween_method(func(v: float): em.set_shader_parameter("alpha", v), 0.9, 0.0, life).set_delay(delay)
		em.set_shader_parameter("alpha", 0.0)
		te.chain().tween_callback(en.queue_free)

# ================= 技能：連環拳（紅色） =================
# 對付血厚的單一目標：對最近的敵人打出一陣高速連打，最後一記重拳把他轟飛，沿路撞到的敵人一起受傷倒退。
# 表演一樣分三段：蓄力（壓著架式、雙拳聚紅光、身上發紅）→ 連打（左右拳輪流、每一下都有紅色命中閃光）→ 收尾（頓一下再一拳轟飛）。
# 目標被打死就馬上換下一個：每一拳都打在活人身上。對一群小兵是一路掃過去，對肉盾是全部打在他身上。
const FLURRY_CHARGE := 0.32    # 蓄力幾秒
const FLURRY_GAP := 0.085      # 連打每一下的間隔（秒）
const FLURRY_PAUSE := 0.2      # 連打完到收尾那一拳之間的停頓
const FLURRY_LAUNCH := 4.0     # 收尾把目標轟飛多遠（公尺）
const FLURRY_COL := Color(1.0, 0.16, 0.1)
var fist_orbs: Array = []      # 連打期間兩個拳頭上的紅光（跟著拳頭走）

func _flurry_charge() -> void:
	_fx_meshes()
	hero_glow.albedo_color = Color(FLURRY_COL.r, FLURRY_COL.g, FLURRY_COL.b, 0.0)
	create_tween().tween_property(hero_glow, "albedo_color:a", 0.45, FLURRY_CHARGE)
	for bn in ["LeftHand", "RightHand"]:
		var o := _fx_shader_piece(fx_quad, "fx_glow", FLURRY_COL)
		var node: MeshInstance3D = o[0]
		var m: ShaderMaterial = o[1]
		node.scale = Vector3.ONE * 0.2
		node.set_meta("bone", skel.find_bone(bn))
		m.set_shader_parameter("alpha", 0.9)
		create_tween().tween_property(node, "scale", Vector3.ONE * 0.85, FLURRY_CHARGE).set_ease(Tween.EASE_OUT)
		fist_orbs.append(node)
	# 四周的紅光往身上收
	var at := hero.position + Vector3(0, 1.2, 0)
	for i in 10:
		var d := Vector3(randf_range(-1, 1), randf_range(-0.2, 0.9), randf_range(-1, 1)).normalized()
		var st := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.05, 0.05, 1.0)
		st.mesh = bm
		var m2 := _add_mat(Color(1.0, 0.3, 0.2, 0.9))
		st.material_override = m2
		st.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		fx_root.add_child(st)
		var start := at + d * randf_range(1.4, 2.2)
		st.look_at_from_position(start, at, Vector3.UP if absf(d.y) < 0.95 else Vector3.RIGHT)
		st.scale = Vector3(1, 1, randf_range(0.4, 0.7))
		var t2 := create_tween()
		t2.set_parallel(true)
		t2.tween_property(st, "position", at, FLURRY_CHARGE).set_ease(Tween.EASE_IN)
		t2.tween_property(st, "scale", Vector3(1, 1, 0.1), FLURRY_CHARGE)
		t2.chain().tween_callback(st.queue_free)

# 連環拳的目標：拳頭打得到的範圍內（FLURRY_REACH）離主角最近的活人；沒有就回傳 null
const FLURRY_REACH := 2.8
func _flurry_target():
	var best = null
	var bd := FLURRY_REACH
	for e in enemies:
		if e.dead: continue
		var d: float = (e.pos as Vector3).distance_to(hero.position)
		if d < bd:
			bd = d
			best = e
	return best

func _flurry_update(dt: float, real: float) -> void:
	cast.t += dt
	# 目標被打死就馬上換下一個（使用者確認的規則）：主角原地轉身，只換打得到的範圍內最近的；
	# 範圍內沒人了，剩下的拳數不打，直接進收尾
	if not cast.done and (cast.target == null or cast.target.dead):
		cast.target = _flurry_target()
		if cast.target == null and cast.i < cast.n and cast.t >= FLURRY_CHARGE:
			cast.n = cast.i
			cast.fin_t = (cast.t as float) + FLURRY_PAUSE
			cast.total = (cast.fin_t as float) + 1.0
	var fwd0 := Vector3(sin(hero_yaw), 0, cos(hero_yaw))
	var dir := fwd0
	var tg = cast.target
	if tg != null:
		dir = (tg.pos as Vector3) - hero.position
		dir.y = 0
		dir = dir.normalized() if dir.length() > 0.05 else fwd0
		# 轉身面對目標（很快，但不是瞬間）
		hero_yaw = lerp_angle(hero_yaw, atan2(dir.x, dir.z), minf(1.0, dt * 22.0))
		hero.rotation.y = hero_yaw
	# 拳頭上的紅光跟著拳頭
	for o in fist_orbs:
		if is_instance_valid(o): (o as Node3D).global_position = skel.global_transform * skel.get_bone_global_pose(int(o.get_meta("bone"))).origin
	if cast.t < FLURRY_CHARGE:
		anim.speed_scale = 0.15
		zoom = minf(2.0, zoom + real * 20.0)
		return
	# 連打：時間到就出下一拳，左右輪流
	while cast.i < cast.n and cast.t >= FLURRY_CHARGE + cast.i * FLURRY_GAP:
		var left: bool = cast.i % 2 == 0
		if left:
			anim.play("jab", 0.02)
			anim.seek(9.0 / 30.0, true)
			anim.speed_scale = (13.0 - 9.0) / 30.0 / FLURRY_GAP * 1.6
		else:
			anim.play("cross", 0.02)
			anim.seek(21.0 / 30.0, true)
			anim.speed_scale = (24.0 - 21.0) / 30.0 / FLURRY_GAP * 1.6
		if tg != null: _flurry_hit(tg, dir, cast.i)
		cast.i += 1
	if cast.i >= cast.n and not cast.fin_started and cast.t >= FLURRY_CHARGE + cast.n * FLURRY_GAP + 0.02:
		# 收尾前：拉回後手蓄一下
		cast.fin_started = true
		anim.play("cross", 0.06)
		anim.seek(18.0 / 30.0, true)
		anim.speed_scale = (20.0 - 18.0) / 30.0 / (FLURRY_PAUSE - 0.06)
		sfx.play("whoosh", -5.0, 0.8)
	if cast.fin_started and not cast.done:
		zoom = minf(3.0, zoom + real * 20.0)
		if cast.t >= cast.fin_t - 0.05: anim.speed_scale = 1.6
		if cast.t >= cast.fin_t:
			cast.done = true
			cast["fin_at"] = cast.t
			if tg != null and not tg.dead:
				_flurry_finish(tg, dir)
			else:
				# 面前已經沒有活的敵人：收尾空揮，光收掉、提早結束
				_flurry_end_glow()
				sfx.play("whoosh", -5.0)
				cast.total = (cast.t as float) + 0.45
	elif cast.done:
		# 手臂伸直停一下再收
		anim.speed_scale = 0.02 if cast.t < (cast.fin_at as float) + 0.3 else HeroRig.RECOVER_SPEED
	if cast.t >= cast.total:
		cast = null
		anim.play("idle", 0.25)
		anim.speed_scale = HeroRig.IDLE_SPEED

# 連打的其中一下
func _flurry_hit(e: Dictionary, dir: Vector3, i: int) -> void:
	if not is_instance_valid(e.node): return
	var dmg: float = _amp(e, BASE_DMG * (val.f_dmg as float))
	e.hp = (e.hp as float) - dmg
	e.flash = 0.07
	e.stun = 0.4
	last_hits += 1
	var at: Vector3 = (e.pos as Vector3) + Vector3(randf_range(-0.25, 0.25), randf_range(0.95, 1.6), randf_range(-0.25, 0.25))
	_number(at + Vector3(0, 0.6, 0), dmg)
	_hit_fx(at, dir, 0.75, Color(1.0, 0.3, 0.2))
	gore.burst(at, dir, 5, 0.9)
	var ea: AnimationPlayer = e.anim
	ea.speed_scale = 1.0
	if e.hp <= 0.0:
		# 打死了：照一般的規則當下就倒下、順著方向飛出去（下一拳會換目標）
		e.dead = true
		e.life = 2.8
		last_kills += 1
		for m in e.meshes: (m as MeshInstance3D).material_overlay = null
		(e.fix as BodyFix).foot_ik = false
		(e.node as Node3D).set_meta("down", true)
		(e.node as Node3D).rotation.y = atan2(-dir.x, -dir.z)
		ea.play("fall", 0.06, EnemyRig.FALL_SPEED)
		ea.seek(EnemyRig.FALL_ENTER / 30.0, true)
		e.push = {"t": 0.0, "from": e.pos, "to": (e.pos as Vector3) + dir * 1.9}
		gore.burst(at, dir, 12, 1.2)
		shake = maxf(shake, 0.26)
	elif e.frozen <= 0.0:
		ea.play("hit", 0.02, 3.0)
		ea.seek(0.1, true)
	shake = maxf(shake, 0.16)
	shake_dir = Vector2(dir.x, dir.z) * (1.0 if i % 2 == 0 else -1.0)
	sfx.play("hit", -4.0, 1.0 + i * 0.05)                # 音高一下比一下高

# 收尾：一拳把目標轟飛，沿路撞到的敵人一起受傷倒退
func _flurry_end_glow() -> void:
	for o in fist_orbs:
		if is_instance_valid(o): (o as Node).queue_free()
	fist_orbs.clear()
	create_tween().tween_property(hero_glow, "albedo_color:a", 0.0, 0.4)

func _flurry_finish(e: Dictionary, dir: Vector3) -> void:
	_flurry_end_glow()
	hero_glow.albedo_color.a = 0.9
	hitstop = 0.12
	shake = 0.5
	zoom = 5.5
	slow_t = 0.4
	shake_dir = Vector2(dir.x, dir.z)
	sfx.play("boom", 2.0)
	sfx.play("crit", 0.0)
	if not is_instance_valid(e.node): return
	var p0: Vector3 = e.pos
	var at := p0 + Vector3(0, 1.25, 0)
	_hit_fx(at, dir, 2.2, Color(1.0, 0.25, 0.15))
	# 命中點炸一團紅光
	var f := _fx_shader_piece(fx_quad, "fx_glow", FLURRY_COL)
	var fl: MeshInstance3D = f[0]
	var flm: ShaderMaterial = f[1]
	fl.global_position = at
	fl.scale = Vector3.ONE * 1.4
	var tf := create_tween()
	tf.set_parallel(true)
	tf.tween_property(fl, "scale", Vector3.ONE * 5.0, 0.22).set_ease(Tween.EASE_OUT)
	tf.tween_method(func(v: float): flm.set_shader_parameter("alpha", v), 1.0, 0.0, 0.32)
	tf.chain().tween_callback(fl.queue_free)
	gore.burst(at, dir, 30, 1.6)
	var dmg: float = _amp(e, BASE_DMG * (val.f_fin as float))
	e.hp = (e.hp as float) - dmg
	e.flash = 0.14
	e.stun = 0.8
	_number(at + Vector3(0, 0.9, 0), dmg)
	var ea: AnimationPlayer = e.anim
	ea.speed_scale = 1.0
	if e.hp <= 0.05:
		e.hp = 0.0
		e.dead = true
		e.life = 3.0
		last_kills += 1
		for m in e.meshes: (m as MeshInstance3D).material_overlay = null
		(e.fix as BodyFix).foot_ik = false
		(e.node as Node3D).set_meta("down", true)
		(e.node as Node3D).rotation.y = atan2(-dir.x, -dir.z)
		ea.play("fall", 0.06, EnemyRig.FALL_SPEED)
		ea.seek(EnemyRig.FALL_ENTER / 30.0, true)
	elif e.frozen <= 0.0:
		ea.play("hit", 0.05, 1.6)
		ea.seek(0.12, true)
	e.push = {"t": 0.0, "from": p0, "to": p0 + dir * FLURRY_LAUNCH}
	# 沿路撞到的：離飛行路線 0.9 公尺內的敵人吃一拳的傷害、往旁邊倒退，依距離先後被撞到
	var side := dir.cross(Vector3.UP).normalized()
	for o in enemies:
		if o.dead or o == e: continue
		var off: Vector3 = (o.pos as Vector3) - p0
		off.y = 0
		var along := off.dot(dir)
		if along < 0.2 or along > FLURRY_LAUNCH + 0.5: continue
		var lat := off.dot(side)
		if absf(lat) > 0.9: continue
		var away := (dir * 0.6 + side * (1.0 if lat >= 0.0 else -1.0)).normalized()
		get_tree().create_timer(along / 11.0).timeout.connect(_bowled.bind(o, away))

# ================= 技能：戰吼（冰凍） =================
# 主角大喝一聲，一圈寒氣從身上往外衝，掃到的敵人整個凍住（動作停住、不走不打），凍住期間受到的傷害加倍；時間到或被打死冰就碎掉。
# 本身不打傷害，是控場加增傷——先吼再接別的技能。顏色是冰藍（震地與穿透拳金橘、連環拳紅）。
# 主角沒有專用的吼叫動作，借用上勾拳：量過這個動作，第 5～9 格是往下蹲（髖部從 0.89 降到 0.81 公尺），
# 第 10～14 格左拳往上衝到最高（1.72 公尺）。所以蓄力＝慢慢蹲下去，爆發＝起身舉拳的瞬間寒氣衝出去，舉著拳停一下再收。
const ROAR_COL := Color(0.45, 0.8, 1.0)
const ROAR_CHARGE := 0.4           # 蓄力幾秒
const ROAR_F_CHARGE := 5.0         # 上勾拳動作的格數：從這一格開始蹲
const ROAR_F_LOW := 9.5            # 蹲到最低
const ROAR_F_FIRE := 13.0          # 拳頭往上衝到一半：寒氣在這一格衝出去
const ROAR_F_OUT := 14.5           # 拳頭舉到最高
const ROAR_BURST_SPEED := 1.6      # 起身那一下的播放倍率
const ROAR_HOLD := 0.4             # 舉著拳停多久
const ROAR_WAVE := 0.35            # 寒氣從身上擴到範圍邊緣花的時間
var ice_mat: ShaderMaterial = null
var crystal_mat: StandardMaterial3D = null

# 凍住的敵人受到的傷害加倍
func _amp(e: Dictionary, dmg: float) -> float:
	if e.frozen <= 0.0: return dmg
	_hit_fx((e.pos as Vector3) + Vector3(0, 1.3, 0), Vector3.UP, 0.5, ROAR_COL)      # 冰面被打裂的一點碎光
	return dmg * (val.s_amp as float)

func _chest() -> Vector3:
	var bi := skel.find_bone("Spine2")
	if bi < 0: bi = skel.find_bone("Head")
	return skel.global_transform * skel.get_bone_global_pose(bi).origin

func _cast_roar() -> void:
	_show_skill("roar")
	if cast != null: return
	last_hits = 0
	last_kills = 0
	var fire_t := ROAR_CHARGE + (ROAR_F_FIRE - ROAR_F_LOW) / 30.0 / ROAR_BURST_SPEED
	var out_t := ROAR_CHARGE + (ROAR_F_OUT - ROAR_F_LOW) / 30.0 / ROAR_BURST_SPEED
	cast = {"skill": "roar", "t": 0.0, "done": false, "fire_t": fire_t, "out_t": out_t, "total": out_t + ROAR_HOLD + (30.0 - ROAR_F_OUT) / 30.0 / HeroRig.RECOVER_SPEED + 0.1}
	anim.play("upper", 0.1)
	anim.seek(ROAR_F_CHARGE / 30.0, true)
	anim.speed_scale = (ROAR_F_LOW - ROAR_F_CHARGE) / 30.0 / ROAR_CHARGE
	sfx.play("whoosh", -6.0, 0.6)
	# 蓄力：胸口聚出一團寒光、四周的冷光往身上收、身上泛起冰藍色
	_fx_meshes()
	var o := _fx_shader_piece(fx_quad, "fx_glow", ROAR_COL)
	orb = o[0]
	var om: ShaderMaterial = o[1]
	(orb as Node3D).global_position = _chest()
	(orb as Node3D).scale = Vector3.ONE * 0.2
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(orb, "scale", Vector3.ONE * 1.5, ROAR_CHARGE).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
	tw.tween_method(func(v: float): om.set_shader_parameter("alpha", v), 0.3, 1.0, ROAR_CHARGE)
	var at := _chest()
	for i in 16:
		var d := Vector3(randf_range(-1, 1), randf_range(-0.2, 0.9), randf_range(-1, 1)).normalized()
		var start := at + d * randf_range(1.8, 3.0)
		var st := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.05, 0.05, 1.0)
		st.mesh = bm
		var m2 := _add_mat(Color(0.7, 0.92, 1.0, 0.0))
		st.material_override = m2
		st.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		fx_root.add_child(st)
		st.look_at_from_position(start, at, Vector3.UP if absf(d.y) < 0.95 else Vector3.RIGHT)
		st.scale = Vector3(1, 1, randf_range(0.4, 0.8))
		var delay := randf_range(0.0, ROAR_CHARGE * 0.6)
		var fly := ROAR_CHARGE * 0.38
		var t2 := create_tween()
		t2.set_parallel(true)
		t2.tween_property(st, "position", at, fly).set_delay(delay).set_ease(Tween.EASE_IN)
		t2.tween_property(m2, "albedo_color:a", 0.9, fly * 0.4).set_delay(delay)
		t2.tween_property(st, "scale", Vector3(1, 1, 0.1), fly).set_delay(delay)
		t2.chain().tween_callback(st.queue_free)
	hero_glow.albedo_color = Color(0.45, 0.8, 1.0, 0.0)
	create_tween().tween_property(hero_glow, "albedo_color:a", 0.5, ROAR_CHARGE).set_ease(Tween.EASE_IN)

func _roar_update(dt: float, real: float) -> void:
	cast.t += dt
	var t: float = cast.t
	if t < ROAR_CHARGE:
		anim.speed_scale = (ROAR_F_LOW - ROAR_F_CHARGE) / 30.0 / ROAR_CHARGE
		zoom = minf(2.4, zoom + real * 20.0)
	elif t < (cast.out_t as float): anim.speed_scale = ROAR_BURST_SPEED
	elif t < (cast.out_t as float) + ROAR_HOLD: anim.speed_scale = 0.02
	else: anim.speed_scale = HeroRig.RECOVER_SPEED
	if not cast.done and orb != null and is_instance_valid(orb): (orb as Node3D).global_position = _chest()
	if not cast.done and t >= (cast.fire_t as float):
		cast.done = true
		_roar()
	if t >= (cast.total as float):
		cast = null
		anim.play("idle", 0.25)
		anim.speed_scale = HeroRig.IDLE_SPEED

# 爆發：寒氣衝出去
func _roar() -> void:
	var fwd := Vector3(sin(hero_yaw), 0, cos(hero_yaw))
	var center := Vector3(hero.position.x, 0, hero.position.z)
	var r: float = val.s_range
	var at := _chest()
	if orb != null and is_instance_valid(orb): (orb as Node).queue_free()
	orb = null
	hero_glow.albedo_color.a = 0.9
	create_tween().tween_property(hero_glow, "albedo_color:a", 0.0, 0.6)
	hitstop = 0.1
	shake = 0.6
	shake_dir = Vector2(fwd.x, fwd.z)
	zoom = 5.0
	slow_t = 0.25
	sfx.play("boom", 1.0, 0.75)
	sfx.play("crit", -2.0, 0.7)
	# 身上炸一團寒光
	var f := _fx_shader_piece(fx_quad, "fx_glow", ROAR_COL)
	var fl: MeshInstance3D = f[0]
	var flm: ShaderMaterial = f[1]
	fl.global_position = at
	fl.scale = Vector3.ONE * 1.2
	var tf := create_tween()
	tf.set_parallel(true)
	tf.tween_property(fl, "scale", Vector3.ONE * 5.5, 0.22).set_ease(Tween.EASE_OUT)
	tf.tween_method(func(v: float): flm.set_shader_parameter("alpha", v), 1.0, 0.0, 0.3)
	tf.chain().tween_callback(fl.queue_free)
	# 兩層寒氣的球殼從身上往外擴：邊擴邊淡，擴到範圍邊緣剛好淡到看不見（跟震波同一個原則）
	for k in 2:
		var sm := SphereMesh.new()
		sm.radius = 1.0
		sm.height = 2.0
		sm.radial_segments = 48
		sm.rings = 24
		var s := _fx_shader_piece(sm, "fx_shell", ROAR_COL)
		var sh: MeshInstance3D = s[0]
		var shm: ShaderMaterial = s[1]
		sh.position = center + Vector3(0, 0.9, 0)
		sh.scale = Vector3.ONE * 0.4
		var delay := k * 0.07
		var ts := create_tween()
		ts.set_parallel(true)
		ts.tween_property(sh, "scale", Vector3(r, r * 0.7, r), ROAR_WAVE).set_delay(delay).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
		ts.tween_method(func(v: float): shm.set_shader_parameter("alpha", v), [1.0, 0.6][k], 0.0, ROAR_WAVE).set_delay(delay)
		ts.chain().tween_callback(sh.queue_free)
	# 一圈往外射的冷風
	for i in 22:
		var a := TAU * i / 22.0 + randf_range(-0.1, 0.1)
		var d := Vector3(cos(a), randf_range(-0.05, 0.25), sin(a)).normalized()
		var st := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.06, 0.06, 1.0)
		st.mesh = bm
		var m2 := _add_mat(Color(0.8, 0.95, 1.0, 0.9) if i % 2 == 0 else Color(0.45, 0.8, 1.0, 0.9))
		st.material_override = m2
		st.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		fx_root.add_child(st)
		var p0 := Vector3(at.x, randf_range(0.6, 1.6), at.z) + d * 0.5
		st.look_at_from_position(p0, p0 + d, Vector3.UP)
		st.scale = Vector3(1, 1, randf_range(0.6, 1.1))
		var t2 := create_tween()
		t2.set_parallel(true)
		t2.tween_property(st, "position", p0 + d * (r - 0.5), ROAR_WAVE).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
		t2.tween_property(m2, "albedo_color:a", 0.0, ROAR_WAVE)
		t2.chain().tween_callback(st.queue_free)
	# 寒氣掃到誰、誰才凍住（離得越遠越晚）
	for e in enemies:
		if e.dead: continue
		var off: Vector3 = (e.pos as Vector3) - center
		off.y = 0
		if off.length() > r: continue
		var delay2 := ROAR_WAVE * (1.0 - pow(1.0 - clampf(off.length() / r, 0.0, 1.0), 1.0 / 3.0))
		get_tree().create_timer(delay2).timeout.connect(_freeze.bind(e))

# 冰晶的形狀：六角柱，底部略窄、中段最寬、上端收成小的六角平頂；每一面都是平的（不做平滑），才有稜有角。
# 底在原點、高 1、最寬處半徑 1，用的時候再縮放
var crystal_mesh: ArrayMesh = null
func _crystal_mesh() -> ArrayMesh:
	if crystal_mesh != null: return crystal_mesh
	var prof := [[0.0, 0.78], [0.62, 1.0], [0.9, 0.55], [1.0, 0.22]]      # [高度, 半徑]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in 6:
		var a0 := TAU * k / 6.0
		var a1 := TAU * (k + 1) / 6.0
		for j in prof.size() - 1:
			var p00 := Vector3(cos(a0) * prof[j][1], prof[j][0], sin(a0) * prof[j][1])
			var p01 := Vector3(cos(a1) * prof[j][1], prof[j][0], sin(a1) * prof[j][1])
			var p10 := Vector3(cos(a0) * prof[j + 1][1], prof[j + 1][0], sin(a0) * prof[j + 1][1])
			var p11 := Vector3(cos(a1) * prof[j + 1][1], prof[j + 1][0], sin(a1) * prof[j + 1][1])
			for v in [p00, p10, p11, p00, p11, p01]: st.add_vertex(v)
		var top: float = prof[-1][1]
		for v in [Vector3(0, 1, 0), Vector3(cos(a1) * top, 1, sin(a1) * top), Vector3(cos(a0) * top, 1, sin(a0) * top)]: st.add_vertex(v)
	st.generate_normals()
	crystal_mesh = st.commit()
	return crystal_mesh

# 凍住一個敵人：身上結一層冰、腳邊冒出幾根冰晶
func _freeze(e: Dictionary) -> void:
	if e.dead or not is_instance_valid(e.node): return
	if ice_mat == null:
		ice_mat = ShaderMaterial.new()
		ice_mat.shader = load("res://shaders/fx_ice.gdshader")
		crystal_mat = StandardMaterial3D.new()
		crystal_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		crystal_mat.albedo_color = Color(0.42, 0.7, 0.95, 0.88)
		crystal_mat.roughness = 0.3
		crystal_mat.metallic_specular = 0.8
		crystal_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		crystal_mat.emission_enabled = true
		crystal_mat.emission = Color(0.25, 0.55, 0.9)
		crystal_mat.emission_energy_multiplier = 0.18
	last_hits += 1
	var fresh: bool = e.frozen <= 0.0
	e.frozen = val.s_time
	e.flash = 0.12
	e.stun = 0.0
	e.push = null
	(e.anim as AnimationPlayer).speed_scale = 0.0
	var mul: float = e.mul
	var pos: Vector3 = e.pos
	if fresh:
		var holder := Node3D.new()
		holder.position = pos
		fx_root.add_child(holder)
		e.ice = holder
		# 多角形的冰晶（使用者：原本的尖錐太尖，要多角形的冰晶）：六角柱、上端收成有稜有角的平頂，粗短、大小不一、略微歪斜
		for i in 7:
			var a := TAU * i / 7.0 + randf_range(-0.35, 0.35)
			var big: bool = i % 2 == 0
			var h := (randf_range(0.5, 0.8) if big else randf_range(0.25, 0.42)) * mul
			var w := (randf_range(0.15, 0.2) if big else randf_range(0.1, 0.14)) * mul
			var c := MeshInstance3D.new()
			c.mesh = _crystal_mesh()
			c.material_override = crystal_mat
			c.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			holder.add_child(c)
			var out := Vector3(cos(a), 0, sin(a))
			var tilt := randf_range(0.1, 0.4)
			c.basis = Basis(out.cross(Vector3.UP).normalized(), -tilt) * Basis(Vector3.UP, randf() * TAU)
			c.position = out * randf_range(0.32, 0.55) * mul
			var full := Vector3(w, h, w)
			c.scale = full * 0.05
			create_tween().tween_property(c, "scale", full, 0.16).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	# 結冰瞬間的一團白霧
	var f := _fx_shader_piece(fx_quad, "fx_glow", Color(0.75, 0.93, 1.0))
	var fl: MeshInstance3D = f[0]
	var flm: ShaderMaterial = f[1]
	fl.global_position = pos + Vector3(0, 1.1 * mul, 0)
	fl.scale = Vector3.ONE * 0.8
	var tf := create_tween()
	tf.set_parallel(true)
	tf.tween_property(fl, "scale", Vector3.ONE * 2.6 * mul, 0.3).set_ease(Tween.EASE_OUT)
	tf.tween_method(func(v: float): flm.set_shader_parameter("alpha", v), 0.8, 0.0, 0.3)
	tf.chain().tween_callback(fl.queue_free)
	sfx.play("hit", -9.0, 1.7)

# 解凍：冰碎掉，碎片往四周噴、落地、淡掉
func _thaw(e: Dictionary) -> void:
	e.frozen = 0.0
	if e.ice != null and is_instance_valid(e.ice): (e.ice as Node).queue_free()
	e.ice = null
	if not e.dead and is_instance_valid(e.node):
		(e.anim as AnimationPlayer).speed_scale = 1.0
		for m in e.meshes: (m as MeshInstance3D).material_overlay = null
	var pos: Vector3 = e.pos
	var mul: float = e.mul
	for i in 12:
		var a := randf() * TAU
		var d := Vector3(cos(a), 0, sin(a))
		var st := MeshInstance3D.new()
		var bm := BoxMesh.new()
		var sz := randf_range(0.07, 0.16)
		bm.size = Vector3(sz, sz * randf_range(1.0, 2.2), sz)
		st.mesh = bm
		var m2 := _add_mat(Color(0.7, 0.92, 1.0, 0.95))
		st.material_override = m2
		st.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		fx_root.add_child(st)
		st.position = pos + d * 0.3 * mul + Vector3(0, randf_range(0.3, 1.7) * mul, 0)
		st.rotation = Vector3(randf() * TAU, randf() * TAU, randf() * TAU)
		var to := st.position + d * randf_range(0.6, 1.5)
		var life := randf_range(0.38, 0.55)
		var t2 := create_tween()
		t2.set_parallel(true)
		t2.tween_property(st, "position:x", to.x, life).set_ease(Tween.EASE_OUT)
		t2.tween_property(st, "position:z", to.z, life).set_ease(Tween.EASE_OUT)
		t2.tween_property(st, "position:y", 0.06, life).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
		t2.tween_property(st, "rotation:x", st.rotation.x + randf_range(-6, 6), life)
		t2.tween_property(m2, "albedo_color:a", 0.0, life * 0.5).set_delay(life * 0.5)
		t2.chain().tween_callback(st.queue_free)
	sfx.play("hit", -10.0, 2.0)

# ================= 技能：雷鏈（連鎖閃電） =================
# 主角一掌打向最近的敵人，電流從他身上跳到旁邊最近的敵人，再跳到下一個，一路串下去（紫色）。
# 不看隊形：敵人站得越密跳得越多，散開就跳不遠。每跳一次傷害少一點，被電到的短暫麻痺。
# 動作用正直拳，時間點跟穿透拳一樣（後手拉滿蓄力 → 後手打出去、送到一半就放電 → 手臂伸直停住）。
const CHAIN_COL := Color(0.66, 0.36, 1.0)
const CHAIN_CHARGE := 0.4          # 蓄力幾秒
const CHAIN_GAP := 0.075           # 每一跳之間隔多久（秒）
const CHAIN_DECAY := 0.15          # 每跳一次傷害少幾成
const CHAIN_STUN := 0.5            # 被電到麻痺幾秒
const CHAIN_HOLD := 0.3            # 手臂伸直停多久
var chain_sparks := 0.0            # 蓄力時身上竄電弧的計時

func _cast_chain() -> void:
	_show_skill("chain")
	if cast != null: return
	var target = null
	var best := 1e9
	for e in enemies:
		if e.dead: continue
		var d: float = (e.pos as Vector3).distance_to(hero.position)
		if d < best:
			best = d
			target = e
	if target != null:
		var to: Vector3 = (target.pos as Vector3) - hero.position
		hero_yaw = atan2(to.x, to.z)
	hero.rotation.y = hero_yaw
	last_hits = 0
	last_kills = 0
	var fire_t := CHAIN_CHARGE + (PIERCE_F_FIRE - PIERCE_F_THRUST) / 30.0 / PIERCE_THRUST_SPEED
	var out_t := CHAIN_CHARGE + (PIERCE_F_OUT - PIERCE_F_THRUST) / 30.0 / PIERCE_THRUST_SPEED
	cast = {"skill": "chain", "t": 0.0, "done": false, "target": target, "fire_t": fire_t, "out_t": out_t,
		"total": out_t + CHAIN_HOLD + (HeroRig.MOVES["cross"][5] - PIERCE_F_OUT) / 30.0 / HeroRig.RECOVER_SPEED + 0.3}
	anim.play("cross", 0.08)
	anim.seek(PIERCE_F_CHARGE / 30.0, true)
	anim.speed_scale = (PIERCE_F_THRUST - PIERCE_F_CHARGE) / 30.0 / CHAIN_CHARGE
	sfx.play("whoosh", -6.0, 0.7)
	# 蓄力：後拉的拳頭上聚一團紫色的電光、身上泛紫
	_fx_meshes()
	var o := _fx_shader_piece(fx_quad, "fx_glow", CHAIN_COL)
	orb = o[0]
	var om: ShaderMaterial = o[1]
	(orb as Node3D).global_position = _fist(false)
	(orb as Node3D).scale = Vector3.ONE * 0.2
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(orb, "scale", Vector3.ONE * 1.4, CHAIN_CHARGE).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_QUAD)
	tw.tween_method(func(v: float): om.set_shader_parameter("alpha", v), 0.3, 1.0, CHAIN_CHARGE)
	hero_glow.albedo_color = Color(0.66, 0.36, 1.0, 0.0)
	create_tween().tween_property(hero_glow, "albedo_color:a", 0.45, CHAIN_CHARGE).set_ease(Tween.EASE_IN)
	chain_sparks = 0.0

func _chain_update(dt: float, real: float) -> void:
	cast.t += dt
	var t: float = cast.t
	if t < CHAIN_CHARGE:
		anim.speed_scale = (PIERCE_F_THRUST - PIERCE_F_CHARGE) / 30.0 / CHAIN_CHARGE
		zoom = minf(2.4, zoom + real * 20.0)
	elif t < (cast.out_t as float): anim.speed_scale = PIERCE_THRUST_SPEED
	elif t < (cast.out_t as float) + CHAIN_HOLD: anim.speed_scale = 0.02
	else: anim.speed_scale = HeroRig.RECOVER_SPEED
	if not cast.done:
		var f := _fist(false)
		if orb != null and is_instance_valid(orb): (orb as Node3D).global_position = f
		# 身上竄細小的電弧：從拳頭跳到身體四周，越蓄越密
		chain_sparks -= dt
		if chain_sparks <= 0.0:
			chain_sparks = lerpf(0.09, 0.035, clampf(t / CHAIN_CHARGE, 0.0, 1.0))
			var q := hero.position + Vector3(randf_range(-0.55, 0.55), randf_range(0.3, 1.9), randf_range(-0.55, 0.55))
			_bolt(f, q, 0.26, 0.12, 4, 0.12)
		if t >= (cast.fire_t as float):
			cast.done = true
			_chain()
	if t >= (cast.total as float):
		cast = null
		anim.play("idle", 0.25)
		anim.speed_scale = HeroRig.IDLE_SPEED

# 爆發：算出電流會跳到哪些人，再一個接一個電過去
func _chain() -> void:
	var fwd := Vector3(sin(hero_yaw), 0, cos(hero_yaw))
	var from := _fist(true)
	if orb != null and is_instance_valid(orb): (orb as Node).queue_free()
	orb = null
	hero_glow.albedo_color.a = 0.85
	create_tween().tween_property(hero_glow, "albedo_color:a", 0.0, 0.5)
	hitstop = 0.05
	shake = 0.5
	shake_dir = Vector2(fwd.x, fwd.z)
	zoom = 4.5
	slow_t = 0.3
	sfx.play("boom", 0.0, 1.2)
	sfx.play("crit", 0.0, 1.4)
	# 掌前的電光
	var f := _fx_shader_piece(fx_quad, "fx_glow", CHAIN_COL)
	var fl: MeshInstance3D = f[0]
	var flm: ShaderMaterial = f[1]
	fl.global_position = from
	fl.scale = Vector3.ONE * 1.0
	var tf := create_tween()
	tf.set_parallel(true)
	tf.tween_property(fl, "scale", Vector3.ONE * 3.6, 0.2).set_ease(Tween.EASE_OUT)
	tf.tween_method(func(v: float): flm.set_shader_parameter("alpha", v), 1.0, 0.0, 0.28)
	tf.chain().tween_callback(fl.queue_free)
	var tg = cast.target
	if tg == null or tg.dead:
		# 面前沒有人：電打向前方的空中就散了
		_bolt_flicker(from, from + fwd * 2.5 + Vector3(0, 0.2, 0), 0.5)
		return
	# 從第一個目標開始，每次跳到還沒被電過、離現在這個最近、而且在跳距內的敵人
	var path: Array = [tg]
	var cur = tg
	while path.size() < int(val.c_jumps):
		var nxt = null
		var best: float = val.c_dist
		for e in enemies:
			if e.dead or path.has(e): continue
			var d: float = (e.pos as Vector3).distance_to(cur.pos)
			if d <= best:
				best = d
				nxt = e
		if nxt == null: break
		path.append(nxt)
		cur = nxt
	for i in path.size():
		var prev = null if i == 0 else path[i - 1]
		get_tree().create_timer(i * CHAIN_GAP).timeout.connect(_chain_hit.bind(path[i], prev, from, i))

func _chain_hit(e: Dictionary, prev, from: Vector3, i: int) -> void:
	if not is_instance_valid(e.node): return
	var at: Vector3 = (e.pos as Vector3) + Vector3(0, 1.25 * (e.mul as float), 0)
	var src := from
	if prev != null: src = (prev.pos as Vector3) + Vector3(0, 1.25 * (prev.mul as float), 0)
	_bolt_flicker(src, at, 0.62 if i == 0 else 0.5)
	if e.dead: return
	var dir := at - src
	dir.y = 0
	dir = dir.normalized() if dir.length() > 0.05 else Vector3(sin(hero_yaw), 0, cos(hero_yaw))
	var dmg: float = _amp(e, BASE_DMG * (val.c_dmg as float) * pow(1.0 - CHAIN_DECAY, i))
	e.hp = (e.hp as float) - dmg
	e.flash = 0.12
	e.stun = CHAIN_STUN
	last_hits += 1
	_number(at + Vector3(0, 0.8, 0), dmg)
	_hit_fx(at, dir, 0.9, Color(0.75, 0.5, 1.0))
	# 被電到的那一下：身上一團紫光
	var f := _fx_shader_piece(fx_quad, "fx_glow", CHAIN_COL)
	var fl: MeshInstance3D = f[0]
	var flm: ShaderMaterial = f[1]
	fl.global_position = at
	fl.scale = Vector3.ONE * 0.9
	var tf := create_tween()
	tf.set_parallel(true)
	tf.tween_property(fl, "scale", Vector3.ONE * 2.8, 0.18).set_ease(Tween.EASE_OUT)
	tf.tween_method(func(v: float): flm.set_shader_parameter("alpha", v), 0.9, 0.0, 0.24)
	tf.chain().tween_callback(fl.queue_free)
	shake = maxf(shake, 0.24)
	shake_dir = Vector2(dir.x, dir.z)
	sfx.play("hit", -4.0, 1.3 + i * 0.07)
	var ea: AnimationPlayer = e.anim
	ea.speed_scale = 1.0
	if e.hp <= 0.0:
		e.dead = true
		e.life = 2.8
		last_kills += 1
		for m in e.meshes: (m as MeshInstance3D).material_overlay = null
		(e.fix as BodyFix).foot_ik = false
		(e.node as Node3D).set_meta("down", true)
		(e.node as Node3D).rotation.y = atan2(-dir.x, -dir.z)
		ea.play("fall", 0.06, EnemyRig.FALL_SPEED)
		ea.seek(EnemyRig.FALL_ENTER / 30.0, true)
		e.push = {"t": 0.0, "from": e.pos, "to": (e.pos as Vector3) + dir * 1.9}
	elif e.frozen <= 0.0:
		ea.play("hit", 0.03, 2.6)
		ea.seek(0.1, true)
	# 餘波：身上殘留幾道小電弧
	for k in 4:
		get_tree().create_timer(0.1 + k * 0.11 + randf() * 0.04).timeout.connect(_residual.bind(e))

func _residual(e: Dictionary) -> void:
	if not is_instance_valid(e.node) or e.dead: return
	var m: float = e.mul
	var c: Vector3 = e.pos
	var a := c + Vector3(randf_range(-0.4, 0.4), randf_range(0.3, 1.8), randf_range(-0.4, 0.4)) * m
	var b := c + Vector3(randf_range(-0.4, 0.4), randf_range(0.3, 1.8), randf_range(-0.4, 0.4)) * m
	_bolt(a, b, 0.24, 0.14, 4, 0.14)

# 一道閃電會閃兩三下（每次的鋸齒形狀都不一樣），最後一下慢一點淡掉
func _bolt_flicker(a: Vector3, b: Vector3, width: float) -> void:
	_bolt(a, b, width, 0.09, 9, 0.3, true)
	get_tree().create_timer(0.05).timeout.connect(_bolt.bind(a, b, width * 0.9, 0.09, 9, 0.3, false))
	get_tree().create_timer(0.1).timeout.connect(_bolt.bind(a, b, width * 0.8, 0.38, 9, 0.3, true))

# 畫一道鋸齒狀的閃電：a 到 b 之間切成幾段，中間的點隨機偏移；每段是兩片交叉的發光片（fx_bolt）。
# width 粗細、life 多久淡掉、segs 幾段、jag 偏移的幅度、branch 要不要長分岔
func _bolt(a: Vector3, b: Vector3, width: float, life: float, segs := 9, jag := 0.3, branch := false) -> void:
	_fx_meshes()
	if not fx_sh.has("fx_bolt"): fx_sh["fx_bolt"] = load("res://shaders/fx_bolt.gdshader")
	var holder := Node3D.new()
	fx_root.add_child(holder)
	var mat := ShaderMaterial.new()
	mat.shader = fx_sh["fx_bolt"]
	mat.set_shader_parameter("color", CHAIN_COL)
	var len := a.distance_to(b)
	var n := clampi(int(len / 0.3) + 2, 3, segs)
	var pts: Array = [a]
	for k in range(1, n):
		var off := Vector3(randf_range(-1, 1), randf_range(-0.7, 0.7), randf_range(-1, 1)) * jag * minf(1.0, len * 0.5)
		pts.append(a.lerp(b, float(k) / n) + off)
	pts.append(b)
	for k in pts.size() - 1: _bolt_seg(holder, mat, pts[k], pts[k + 1], width)
	if branch and len > 0.8:
		# 分岔：從中間某一點岔出去一小段細的
		for j in 2:
			var p: Vector3 = pts[randi_range(1, pts.size() - 2)]
			var q := p + Vector3(randf_range(-1, 1), randf_range(-0.2, 0.6), randf_range(-1, 1)).normalized() * randf_range(0.4, 0.9)
			var mid := p.lerp(q, 0.5) + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.12
			_bolt_seg(holder, mat, p, mid, width * 0.55)
			_bolt_seg(holder, mat, mid, q, width * 0.4)
	var tw := create_tween()
	tw.tween_method(func(v: float): mat.set_shader_parameter("alpha", v), 1.0, 0.0, life)
	tw.tween_callback(holder.queue_free)

func _bolt_seg(holder: Node3D, mat: ShaderMaterial, p: Vector3, q: Vector3, width: float) -> void:
	var d := q - p
	var l := d.length()
	if l < 0.01: return
	var y := d / l
	var x := y.cross(Vector3.UP)
	if x.length() < 0.05: x = y.cross(Vector3.RIGHT)
	x = x.normalized()
	var z := x.cross(y)
	for turn in 2:
		var mi := MeshInstance3D.new()
		mi.mesh = fx_strip
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var bx := x if turn == 0 else z
		var bz := z if turn == 0 else -x
		mi.transform = Transform3D(Basis(bx * width, y * l, bz), p)
		holder.add_child(mi)

func _bowled(e: Dictionary, away: Vector3) -> void:
	if e.dead or not is_instance_valid(e.node): return
	last_hits += 1
	_strike(e, away, BASE_DMG)
	if not e.dead: e.push = {"t": 0.0, "from": e.pos, "to": (e.pos as Vector3) + away * 1.2}

# 震波的畫面：以圓心為中心的正圓。光環從最小的時候最亮，一路往外擴、一路變淡，擴到最大（技能的範圍）時剛好淡到看不見。
# （使用者要求：震波要從最小開始就慢慢變淡到最大。之前是先擴到最大、再停在那裡淡掉，看起來很突然；
#   也試過停留一秒多再淡、和到邊緣立刻消失，都不對。）所以也不再留邊界線。
func _wave_fx(center: Vector3, r: float) -> void:
	for pass_i in 2:
		var ring := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = [0.86, 0.94][pass_i]
		tm.outer_radius = 1.0
		tm.rings = 72
		tm.ring_segments = 4
		ring.mesh = tm
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		m.albedo_color = Color(1.0, 0.82, 0.3, [1.0, 0.7][pass_i])
		ring.material_override = m
		ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		ring.position = center + Vector3(0, 0.04, 0)
		ring.scale = Vector3(0.15, 0.05, 0.15)
		fx_root.add_child(ring)
		var delay := 0.0 if pass_i == 0 else 0.09
		var tw := create_tween()
		tw.set_parallel(true)
		# 大小：先快後慢地擴到範圍；透明度：同一段時間內等速淡到零
		tw.tween_property(ring, "scale", Vector3(r, 0.05, r), WAVE_TIME).set_delay(delay).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
		tw.tween_property(m, "albedo_color:a", 0.0, WAVE_TIME).set_delay(delay)
		tw.chain().tween_callback(ring.queue_free)

# 命中的閃光和光條：跟遊戲裡的命中特效同一種樣式（半透明閃光球＋順著方向的光條），size 是大小
func _hit_fx(pos: Vector3, dir: Vector3, size: float, col := Color(1.0, 0.82, 0.3)) -> void:
	var flash := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.5
	sm.height = 1.0
	flash.mesh = sm
	var fm := _add_mat(col)
	flash.material_override = fm
	flash.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	flash.position = pos
	flash.scale = Vector3.ONE * size * 0.45
	fx_root.add_child(flash)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(flash, "scale", Vector3.ONE * size, 0.12).set_ease(Tween.EASE_OUT)
	tw.tween_property(fm, "albedo_color:a", 0.0, 0.14)
	tw.chain().tween_callback(flash.queue_free)
	for i in int(5 + size * 4):
		var d := (dir + Vector3(randf_range(-0.6, 0.6), randf_range(-0.15, 0.7), randf_range(-0.6, 0.6))).normalized()
		var st := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.07, 0.07, 1.0)
		st.mesh = bm
		var m2 := _add_mat(col if i % 2 == 0 else Color.WHITE)
		st.material_override = m2
		st.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		fx_root.add_child(st)
		st.look_at_from_position(pos + d * 0.15, pos + d * 2.0, Vector3.UP if absf(d.y) < 0.95 else Vector3.RIGHT)
		st.scale = Vector3(1, 1, randf_range(0.35, 0.7) * (0.8 + size))
		var t2 := create_tween()
		t2.set_parallel(true)
		t2.tween_property(st, "position", pos + d * randf_range(0.9, 1.7) * (0.7 + size), 0.16).set_ease(Tween.EASE_OUT)
		t2.tween_property(st, "scale", Vector3(1, 1, 0.05), 0.16)
		t2.tween_property(m2, "albedo_color:a", 0.0, 0.16)
		t2.chain().tween_callback(st.queue_free)

func _add_mat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = c
	return m

func _number(pos: Vector3, amount: float) -> void:
	if num_font == null: num_font = load("res://assets/fonts/NotoSansTC.ttf")
	var lb := Label3D.new()
	lb.text = str(snappedf(amount, 0.1)).trim_suffix(".0")
	lb.font = num_font
	lb.font_size = 64
	lb.pixel_size = 0.0105
	lb.outline_size = 14
	lb.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	lb.no_depth_test = true
	lb.shaded = false
	lb.position = pos
	fx_root.add_child(lb)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(lb, "position", pos + Vector3(0, 1.5, 0), 0.5).set_ease(Tween.EASE_OUT)
	tw.tween_property(lb, "modulate:a", 0.0, 0.25).set_delay(0.3)
	tw.tween_property(lb, "outline_modulate:a", 0.0, 0.25).set_delay(0.3)
	tw.chain().tween_callback(lb.queue_free)

# ---------------- 每格更新 ----------------
func _process(delta: float) -> void:
	# 跟遊戲一樣鎖定每秒最多畫 30 格
	if OS.get_cmdline_user_args().is_empty():
		draw_acc += delta
		var drew := draw_acc >= (1.0 / 30.0) * 0.9
		if drew: draw_acc = 0.0
		RenderingServer.render_loop_enabled = drew
	# 慢動作用真實時間倒數（delta 已經被時間倍率縮小過，要除回來）
	var real := delta / maxf(0.05, Engine.time_scale)
	if slow_t > 0.0 and hitstop <= 0.0:
		slow_t -= real
		Engine.time_scale = 0.3
	elif Engine.time_scale != 1.0 and hitstop <= 0.0:
		Engine.time_scale = minf(1.0, Engine.time_scale + real * 5.0)
	var dt := minf(delta, 1.0 / 30.0)
	time += real
	shake = maxf(0.0, shake - real * 1.6)
	zoom = maxf(0.0, zoom - real * 14.0)
	_update_camera()
	if hitstop > 0.0:
		hitstop -= real
		anim.speed_scale = 0.02
		return
	if cast != null and cast.skill == "flurry":
		_flurry_update(dt, real)
	elif cast != null and cast.skill == "roar":
		_roar_update(dt, real)
	elif cast != null and cast.skill == "chain":
		_chain_update(dt, real)
	elif cast != null:
		cast.t += dt
		anim.speed_scale = (cast.wind_speed as float) if not cast.done else HeroRig.RECOVER_SPEED
		if cast.skill == "pierce":
			# 穿透拳的動作分四段：蓄力（慢）→ 出拳（快）→ 手臂伸直停住（光柱在打）→ 收拳
			var t_thrust: float = PIERCE_CHARGE_TIME
			var t_out: float = t_thrust + (PIERCE_F_OUT - PIERCE_F_THRUST) / 30.0 / PIERCE_THRUST_SPEED
			if cast.t < t_thrust: anim.speed_scale = cast.wind_speed
			elif cast.t < t_out: anim.speed_scale = PIERCE_THRUST_SPEED
			elif cast.t < t_out + PIERCE_HOLD: anim.speed_scale = 0.02
			else: anim.speed_scale = HeroRig.RECOVER_SPEED
		# 蓄力的光球跟著後拉的那隻拳頭；蓄力期間鏡頭慢慢推近
		if not cast.done and cast.skill == "pierce":
			if orb != null and is_instance_valid(orb): (orb as Node3D).global_position = _fist(false)
			zoom = minf(2.6, zoom + real * 6.0 + real * 14.0)
		if not cast.done and cast.t >= cast.hit_at:
			cast.done = true
			if cast.skill == "pierce": _pierce()
			else: _quake()
		if cast.t >= cast.total:
			cast = null
			anim.play("idle", 0.25)
			anim.speed_scale = HeroRig.IDLE_SPEED
	_update_enemies(dt)
	var alive := 0
	for e in enemies:
		if not e.dead: alive += 1
	var txt := ""
	if skill == "chain":
		txt = "技能測試場　雷鏈\n最多跳 %d 個　每跳 %.1f 公尺內　第一個 %.1f（一拳的 %.1f 倍）之後每跳少 %d%%　麻痺 %.1f 秒" % [int(val.c_jumps), val.c_dist, BASE_DMG * val.c_dmg, val.c_dmg, int(CHAIN_DECAY * 100.0), CHAIN_STUN]
	elif skill == "roar":
		txt = "技能測試場　戰吼\n範圍 %.1f 公尺　冰凍 %.1f 秒　凍住時受到的傷害 %.1f 倍（本身不打傷害）" % [val.s_range, val.s_time, val.s_amp]
	elif skill == "flurry":
		txt = "技能測試場　連環拳\n連打 %d 下 × %.1f　收尾 %.1f　合計 %.1f（一拳是 %.0f）　轟飛 %.0f 公尺" % [int(val.f_hits), BASE_DMG * val.f_dmg, BASE_DMG * val.f_fin, BASE_DMG * (val.f_hits * val.f_dmg + val.f_fin), BASE_DMG, FLURRY_LAUNCH]
	elif skill == "pierce":
		txt = "技能測試場　穿透拳\n第一個目標 %.0f　後排各 %.1f（一拳的 %.1f 倍）　穿透 %.1f 公尺　寬 %.1f 公尺" % [BASE_DMG, BASE_DMG * val.p_dmg, val.p_dmg, val.p_len, val.p_wid]
	else:
		txt = "技能測試場　震地\n範圍 %.1f 公尺　傷害 %.1f（普通一拳的 %.1f 倍）　擊退 %.1f 公尺" % [val.range, BASE_DMG * val.dmg, val.dmg, val.knock]
	txt += "\n上一次：打到 %d 個、打倒 %d 個　場上還有 %d 個　隊形：%s" % [last_hits, last_kills, alive, "直排" if layout == "line" else "三圈"]
	if info.text != txt: info.text = txt

func _update_camera() -> void:
	var o := shake_dir * sin(time * 52.0) * shake
	cam.fov = 40.0 - zoom
	cam.position = Vector3(o.x, 23.5, 19.0 + o.y)
	cam.look_at(Vector3(0, 0, 0.6))

# ---------------- 介面 ----------------
func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var theme := Theme.new()
	theme.default_font = load("res://assets/fonts/NotoSansTC.ttf")
	theme.default_font_size = 28
	root.theme = theme
	layer.add_child(root)
	info = Label.new()
	info.position = Vector2(20, 16)
	info.add_theme_font_size_override("font_size", 24)
	info.add_theme_color_override("font_outline_color", Color.BLACK)
	info.add_theme_constant_override("outline_size", 8)
	root.add_child(info)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	box.grow_vertical = Control.GROW_DIRECTION_BEGIN
	box.offset_left = 12
	box.offset_right = -12
	box.offset_bottom = -12
	root.add_child(box)
	# 滑桿：名稱、− ＋ 按鈕、目前的數值
	for key in PARAMS:
		var P: Array = PARAMS[key]
		var row := HBoxContainer.new()
		box.add_child(row)
		rows[key] = row
		row.visible = P[6] == skill
		var name_lb := Label.new()
		name_lb.text = P[0]
		name_lb.custom_minimum_size.x = 70
		row.add_child(name_lb)
		var minus := Button.new()
		minus.text = "−"
		minus.custom_minimum_size = Vector2(64, 60)
		minus.focus_mode = Control.FOCUS_NONE
		row.add_child(minus)
		var sl := HSlider.new()
		sl.min_value = P[1]
		sl.max_value = P[2]
		sl.step = P[3]
		sl.value = val[key]
		sl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		sl.custom_minimum_size.y = 44
		sl.focus_mode = Control.FOCUS_NONE
		row.add_child(sl)
		var plus := Button.new()
		plus.text = "＋"
		plus.custom_minimum_size = Vector2(64, 60)
		plus.focus_mode = Control.FOCUS_NONE
		row.add_child(plus)
		var v_lb := Label.new()
		v_lb.custom_minimum_size.x = 130
		v_lb.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(v_lb)
		value_labels[key] = v_lb
		sl.value_changed.connect(_on_param.bind(key))
		minus.pressed.connect(func(): sl.value -= sl.step)
		plus.pressed.connect(func(): sl.value += sl.step)
		_on_param(val[key], key)
	var row2 := HBoxContainer.new()
	box.add_child(row2)
	# 技能按鈕獨立一排、比較大；按了會施放，下方的滑桿也切到那個技能
	var row_s := HBoxContainer.new()
	box.add_child(row_s)
	for item in [["震地", _cast_quake], ["穿透拳", _cast_pierce], ["連環拳", _cast_flurry], ["戰吼", _cast_roar], ["雷鏈", _cast_chain]]:
		var sb := Button.new()
		sb.text = item[0]
		sb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sb.custom_minimum_size.y = 90
		sb.add_theme_font_size_override("font_size", 34)
		sb.focus_mode = Control.FOCUS_NONE
		sb.pressed.connect(item[1])
		row_s.add_child(sb)
	box.move_child(row_s, 0)
	for item in [["重置", _reset], ["換隊形", _toggle_layout], ["走動", _toggle_walk], ["回遊戲", _back], ["重整", HeroRig.reload_page.bind(get_tree())]]:
		var b := Button.new()
		b.text = item[0]
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size.y = 70
		b.focus_mode = Control.FOCUS_NONE
		b.pressed.connect(item[1])
		row2.add_child(b)

func _on_param(v: float, key: String) -> void:
	val[key] = v
	(value_labels[key] as Label).text = "%.1f %s" % [v, PARAMS[key][5]]

func _show_skill(which: String) -> void:
	skill = which
	for key in rows: (rows[key] as Control).visible = PARAMS[key][6] == which

# 換隊形：三圈（測震地）和直排（測穿透拳）輪流
func _toggle_layout() -> void:
	layout = "line" if layout == "ring" else "ring"
	_reset()

func _toggle_walk() -> void:
	walking = not walking

func _back() -> void:
	Engine.time_scale = 1.0
	RenderingServer.render_loop_enabled = true
	get_tree().change_scene_to_file("res://main.tscn")

# ---------------- 測試用 ----------------
# 例：godot --path . res://skill_lab.tscn -- --cast=1.0 --shots=1.3,1.5,2.2 （--range= --dmg= --knock= 指定數值、--walk 讓敵人走動）
func _test_args() -> void:
	var shots: Array = []
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--cast="): get_tree().create_timer(float(a.split("=")[1])).timeout.connect(_cast_quake)
		elif a.begins_with("--pierce="): get_tree().create_timer(float(a.split("=")[1])).timeout.connect(_cast_pierce)
		elif a.begins_with("--chain="): get_tree().create_timer(float(a.split("=")[1])).timeout.connect(_cast_chain)
		elif a.begins_with("--roar="): get_tree().create_timer(float(a.split("=")[1])).timeout.connect(_cast_roar)
		elif a.begins_with("--flurry="): get_tree().create_timer(float(a.split("=")[1])).timeout.connect(_cast_flurry)
		elif a == "--line":
			layout = "line"
			_reset()
		elif a == "--walk": walking = true
		elif a.begins_with("--shots="):
			for s in a.split("=")[1].split(","): shots.append(float(s))
		else:
			for key in PARAMS:
				if a.begins_with("--%s=" % key): val[key] = float(a.split("=")[1])
	if shots.is_empty(): return
	var i := 0
	for s in shots:
		await get_tree().create_timer(s - (shots[i - 1] if i > 0 else 0.0)).timeout
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("user://lab_%d.png" % i)
		print("截圖 %.2f 秒：打到 %d 個、打倒 %d 個、場上 %d 個" % [s, last_hits, last_kills, enemies.size()])
		i += 1
	get_tree().quit()
