shader_type sky;
// 天空球：漸層天空、太陽／月亮光暈、雲、星星，以及地平線上一圈遠方的城市剪影。
// 城市剪影把「世界的邊緣」蓋住，轉到任何角度都不會穿幫。

uniform vec3 top_color : source_color = vec3(0.22, 0.42, 0.8);
uniform vec3 horizon_color : source_color = vec3(0.66, 0.78, 0.92);
uniform vec3 ground_color : source_color = vec3(0.2, 0.2, 0.22);
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform vec3 sun_color : source_color = vec3(1.0, 0.95, 0.85);
uniform float sun_energy = 1.0;
uniform vec3 cloud_color : source_color = vec3(1.0);
uniform float cloud_amount = 0.45;
uniform float star = 0.0;
uniform vec3 city_color : source_color = vec3(0.45, 0.5, 0.6);
uniform float city_light = 0.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
	float a = 0.5, s = 0.0;
	for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
	return s;
}

void sky() {
	vec3 d = normalize(EYEDIR);
	float h = d.y;
	// 漸層：地平線 → 天頂；地平線以下漸漸變成地面色
	vec3 col = mix(horizon_color, top_color, pow(clamp(h, 0.0, 1.0), 0.45));
	if (h < 0.0) col = mix(horizon_color, ground_color, clamp(-h * 5.0, 0.0, 1.0));
	// 星星（只有夜晚）
	if (star > 0.01 && h > 0.0) {
		vec2 sp = d.xz / (h + 0.3) * 240.0;
		float s = step(0.988, hash(floor(sp))) * (0.4 + 0.6 * hash(floor(sp) + 7.0));
		s *= smoothstep(0.3, 0.05, length(fract(sp) - 0.5));   // 圓點，不是方塊
		col += vec3(s) * star * clamp(h * 3.0, 0.0, 1.0);
	}
	// 太陽／月亮：小亮盤 ＋ 大範圍光暈
	float sd = max(dot(d, normalize(sun_dir)), 0.0);
	col += sun_color * (pow(sd, 600.0) * 5.0 + pow(sd, 14.0) * 0.3) * sun_energy;
	// 雲：越靠近地平線越密、越淡
	if (h > 0.01) {
		vec2 cp = d.xz / (h + 0.14) * 1.25 + vec2(TIME * 0.004, 0.0);
		float c = smoothstep(1.0 - cloud_amount, 1.0 - cloud_amount + 0.22, fbm(cp));
		vec3 cc = cloud_color + sun_color * pow(sd, 6.0) * 0.25 * sun_energy;
		col = mix(col, cc, c * clamp(h * 6.0, 0.0, 1.0) * 0.85);
	}
	// 遠方城市剪影：兩層不同寬度的大樓，高度用雜湊決定
	float ang = atan(d.x, d.z) / 6.2831853 + 0.5;
	float b1 = floor(ang * 110.0);
	float b2 = floor(ang * 43.0);
	float hh = 0.035 + 0.075 * hash(vec2(b1, 3.0));
	hh = max(hh, (0.05 + 0.14 * hash(vec2(b2, 9.0))) * step(0.45, hash(vec2(b2, 1.0))));
	if (h < hh) {
		vec3 cc = mix(city_color, horizon_color, 0.25 * clamp(1.0 - h / hh, 0.0, 1.0));
		// 亮著的窗戶（黃昏、夜晚）
		vec2 wc = vec2(ang * 1300.0, h * 300.0);
		float win = step(0.8, hash(floor(wc))) * step(0.3, fract(wc.x)) * step(0.35, fract(wc.y)) * step(0.0, h);
		cc += vec3(1.0, 0.82, 0.5) * win * city_light;
		if (h < 0.0) cc = mix(cc, ground_color, clamp(-h * 8.0, 0.0, 1.0));
		col = cc;
	}
	COLOR = col;
}
