shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_mix, world_vertex_coords, shadows_disabled;
// 雪花：一大批正對鏡頭的小圓點，慢慢飄落、左右搖擺。位置全部用時間算。
// INSTANCE_CUSTOM：r、g 水平位置，b 起始相位，a 亂數（也控制數量）

uniform float amount = 1.0;
uniform float speed = 1.7;           // 下落速度（公尺／秒）
uniform float height = 16.0;
uniform float area = 46.0;

varying float vis;

void vertex() {
	vec4 c = INSTANCE_CUSTOM;
	vec3 local = VERTEX;
	float t = fract(c.b + TIME * speed / height * (0.7 + c.a * 0.6));
	vec3 base = vec3((c.r - 0.5) * area, height * (1.0 - t), (c.g - 0.5) * area);
	// 飄：兩個不同頻率的搖擺，加上一點固定的風
	base.x += sin(TIME * (0.6 + c.a) + c.b * 40.0) * 0.45 + t * 2.0;
	base.z += cos(TIME * (0.5 + c.r) + c.g * 40.0) * 0.45;
	vec3 to_cam = normalize(CAMERA_POSITION_WORLD - base);
	vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), to_cam));
	vec3 up = cross(to_cam, side);
	vis = step(c.a, amount);
	float sz = (0.035 + c.r * 0.04) * vis;
	VERTEX = base + (side * local.x + up * local.y) * sz * 2.0;
}

void fragment() {
	float d = length(UV - 0.5) * 2.0;
	ALBEDO = vec3(0.96, 0.97, 1.0);
	ALPHA = (1.0 - smoothstep(0.3, 1.0, d)) * 0.85 * vis;
}
