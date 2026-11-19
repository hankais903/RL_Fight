shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_back;
// 積雪：疊在場景每個物體上的一層。只有朝上的表面會有雪，從零星斑塊逐漸長成一整片。

uniform float cover = 0.0;           // 0 沒有雪 → 1 積滿

varying vec3 wn;
varying vec3 wp;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void vertex() {
	wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float up = smoothstep(0.35, 0.7, normalize(wn).y);
	float n = noise(wp.xz * 0.9) * 0.6 + noise(wp.xz * 3.7) * 0.3 + noise(wp.xz * 13.0) * 0.1;
	float thr = 1.0 - cover * 1.02;    // 積滿時仍留一點點薄的地方透出底下的石板
	float a = up * smoothstep(thr, thr + 0.28, n);
	// 雪的顏色不能用純白：場景的燈光是照深色石材調的，純白會整片過曝、影子和地上的圈都看不見
	ALBEDO = vec3(0.52, 0.55, 0.6) * (0.9 + noise(wp.xz * 22.0) * 0.1);
	ROUGHNESS = 0.9;
	SPECULAR = 0.3;
	ALPHA = a * 0.9;
}
