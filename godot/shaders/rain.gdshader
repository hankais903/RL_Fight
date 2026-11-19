shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_mix, world_vertex_coords, shadows_disabled;
// 雨絲：一大批細長的小片，位置和下落全部在這裡用時間算出來（不佔用運算資源去逐顆更新）。
// 每顆的資料放在 INSTANCE_CUSTOM：r、g 是水平位置（0～1），b 是下落的起始相位，a 是亂數（也用來控制雨量）

uniform float amount = 1.0;          // 雨量 0～1：亂數比它大的雨絲不畫
uniform vec3 wind = vec3(1.6, 0.0, 0.8);
uniform float speed = 14.0;          // 下落速度（公尺／秒）
uniform float height = 18.0;         // 從多高開始落
uniform float area = 46.0;           // 涵蓋的水平範圍（公尺見方）
uniform vec4 color : source_color = vec4(0.82, 0.87, 0.96, 0.26);

varying float vis;

void vertex() {
	vec4 c = INSTANCE_CUSTOM;
	vec3 local = VERTEX;
	float t = fract(c.b + TIME * speed / height * (0.85 + c.a * 0.3));   // 0 剛出現在高處 → 1 落到地面
	float fall_time = t * height / speed;
	vec3 base = vec3((c.r - 0.5) * area, height * (1.0 - t), (c.g - 0.5) * area) + vec3(wind.x, 0.0, wind.z) * fall_time;
	vec3 dir = normalize(vec3(wind.x, -speed, wind.z));                 // 雨絲的方向（被風吹斜）
	vec3 side = normalize(cross(dir, CAMERA_POSITION_WORLD - base));    // 讓細片永遠正對鏡頭
	vis = step(c.a, amount);
	VERTEX = base + (side * local.x * 0.02 + dir * local.y * (0.22 + c.a * 0.5)) * vis;
}

void fragment() {
	ALBEDO = color.rgb;
	ALPHA = color.a * (1.0 - abs(UV.x - 0.5) * 2.0) * vis;
}
