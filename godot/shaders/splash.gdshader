shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_add, world_vertex_coords, shadows_disabled;
// 雨滴打在地上：很小、很短促。先是落點一小點亮光（水珠濺起），接著一圈細小的漣漪很快擴開、消失。
// 每個小片每一輪換一個隨機位置，而且一輪裡只有前面一小段時間看得到，所以畫面上是零星閃現的，不是滿地的圈

uniform float amount = 1.0;
uniform float area = 40.0;
uniform float size = 0.19;       // 漣漪最大的半徑（公尺）

varying float ph;
varying float vis;

void vertex() {
	vec4 c = INSTANCE_CUSTOM;
	vec3 local = VERTEX;
	float cyc = TIME * (1.1 + c.a * 0.7) + c.b * 9.0;
	float id = floor(cyc);
	ph = fract(cyc) / 0.32;          // 只在每一輪的前三成出現
	vec2 rnd = fract(sin(vec2(id * 12.9898 + c.r * 78.233, id * 39.346 + c.g * 11.135)) * 43758.5453);
	vec3 base = vec3((rnd.x - 0.5) * area, 0.022, (rnd.y - 0.5) * area);
	vis = step(c.a, amount) * step(ph, 1.0);
	VERTEX = base + vec3(local.x, 0.0, local.z) * size * 2.0 * (0.75 + rnd.x * 0.5) * vis;
}

void fragment() {
	float d = length(UV - 0.5) * 2.0;
	// 落點的小亮點：一開始最亮，很快就沒了
	float dot_a = (1.0 - smoothstep(0.0, 0.16, d)) * (1.0 - smoothstep(0.0, 0.3, ph));
	// 漣漪：很細的一圈，半徑隨時間擴大，邊擴邊淡
	float r = 0.12 + ph * 0.8;
	float ring = (1.0 - smoothstep(0.0, 0.07, abs(d - r))) * (1.0 - ph) * (1.0 - ph);
	ALBEDO = vec3(0.82, 0.88, 0.98);
	ALPHA = (dot_a * 0.95 + ring * 0.42) * vis;
}
