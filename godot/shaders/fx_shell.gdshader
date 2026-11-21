shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;
// 一層薄薄的球殼（戰吼的寒氣衝擊波）：只有輪廓邊緣亮、正對鏡頭的地方幾乎透明，所以看起來是一圈空氣的波，不是實心的球
uniform vec4 color : source_color = vec4(0.45, 0.8, 1.0, 1.0);
uniform float alpha = 1.0;

void fragment() {
	float f = 1.0 - abs(dot(normalize(NORMAL), normalize(VIEW)));
	float rim = pow(f, 2.2);
	ALBEDO = mix(color.rgb, vec3(0.95, 0.99, 1.0), rim * 0.6);
	ALPHA = clamp((rim * 0.95 + 0.05) * alpha, 0.0, 1.0);
}
