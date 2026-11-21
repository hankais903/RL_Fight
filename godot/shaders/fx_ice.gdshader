shader_type spatial;
render_mode unshaded, blend_mix, cull_back, shadows_disabled;
// 被凍住的敵人身上疊的一層冰：整體偏藍、輪廓邊緣是白色的霜
uniform float alpha = 1.0;

void fragment() {
	float f = pow(1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), 2.0);
	ALBEDO = mix(vec3(0.30, 0.58, 0.88), vec3(0.93, 0.98, 1.0), f);
	ALPHA = mix(0.66, 0.96, f) * alpha;
}
