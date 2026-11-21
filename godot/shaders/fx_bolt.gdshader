shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;
// 閃電的一小段：中間一條白熱的細芯，兩側是指定顏色的柔光，邊緣漸漸淡掉（不是硬邊的實心條）
uniform vec4 color : source_color = vec4(0.66, 0.36, 1.0, 1.0);
uniform float alpha = 1.0;

void fragment() {
	float d = abs(UV.x - 0.5) * 2.0;
	float core = exp(-d * d * 90.0);
	float halo = exp(-d * d * 5.0) * 0.8;
	float ends = smoothstep(0.0, 0.04, UV.y) * smoothstep(1.0, 0.96, UV.y) * 0.25 + 0.75;
	ALBEDO = mix(color.rgb, vec3(1.0, 0.96, 1.0), clamp(core * 0.9, 0.0, 1.0));
	ALPHA = clamp((core + halo) * alpha * ends * (1.0 - smoothstep(0.75, 1.0, d)), 0.0, 1.0);
}
