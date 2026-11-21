shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, depth_test_disabled, shadows_disabled;
// 一團柔和的能量光球（永遠面向鏡頭）：中心偏白、外圍是指定的顏色，邊緣漸漸淡掉。蓄力的光球、砲口的閃光都用它
uniform vec4 color : source_color = vec4(1.0, 0.75, 0.25, 1.0);
uniform float alpha = 1.0;

void vertex() {
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(
		INV_VIEW_MATRIX[0] * length(MODEL_MATRIX[0].xyz),
		INV_VIEW_MATRIX[1] * length(MODEL_MATRIX[1].xyz),
		INV_VIEW_MATRIX[2] * length(MODEL_MATRIX[2].xyz),
		MODEL_MATRIX[3]);
	MODELVIEW_NORMAL_MATRIX = mat3(MODELVIEW_MATRIX);
}

void fragment() {
	float r = length(UV * 2.0 - 1.0);
	float core = exp(-r * r * 16.0);
	float halo = exp(-r * r * 3.2) * 0.55;
	ALBEDO = mix(color.rgb, vec3(1.0, 0.98, 0.9), clamp(core * 1.3, 0.0, 1.0));
	ALPHA = clamp((core + halo) * alpha * (1.0 - smoothstep(0.7, 1.0, r)), 0.0, 1.0);
}
