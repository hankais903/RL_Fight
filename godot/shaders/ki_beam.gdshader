shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, depth_test_disabled, shadows_disabled;
// 氣功砲的光柱：中心是白熱的芯，往外是一圈有顏色的能量，最外面是柔和的光暈；表面有往前流動的能量紋路。
// 網格：UV.x 橫向、UV.y 從砲口 0 到最遠端 1。
// head：光柱的頭端射到哪裡（0～1）；tail：尾端從哪裡開始（收尾時尾端往前追）；width：粗細（收尾時變細）
uniform vec4 color : source_color = vec4(1.0, 0.62, 0.15, 1.0);
uniform float head = 1.0;
uniform float tail = 0.0;
uniform float width = 1.0;
uniform float alpha = 1.0;

void fragment() {
	float x = abs(UV.x * 2.0 - 1.0);
	float y = UV.y;
	// 頭尾都收圓、不是一刀切
	float span = smoothstep(head, head - 0.05, y) * smoothstep(tail, tail + 0.04, y);
	// 往前流動的紋路，讓光柱看起來是在噴的，不是一根靜止的棒子
	float flow = 0.5 + 0.5 * sin(y * 46.0 - TIME * 55.0 + sin(y * 13.0 + TIME * 11.0) * 2.2);
	float w = max(width * (0.88 + 0.12 * flow), 0.001);
	float core = smoothstep(w * 0.30, w * 0.10, x);
	float body = smoothstep(w * 0.58, w * 0.30, x);
	float halo = exp(-pow(x / w, 2.0) * 2.6) * 0.5;
	vec3 c = mix(color.rgb, vec3(1.0, 0.98, 0.88), core);
	c = mix(c, color.rgb * vec3(1.0, 0.7, 0.45), (1.0 - body) * 0.5);
	ALBEDO = c * (1.0 + core * 0.5 + flow * body * 0.25);
	ALPHA = clamp((core + body * 0.75 + halo) * span * alpha, 0.0, 1.0);
}
