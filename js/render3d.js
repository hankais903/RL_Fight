// ===== RL Fight：3D 畫面（Three.js） =====
// 只負責「畫」，每一格讀取遊戲狀態（run）同步到 3D 場景。
// 座標對應：遊戲的 x → 3D 的 x，遊戲的 y → 3D 的 z，高度為 3D 的 y。
(() => {
'use strict';

const R3D = {};
window.R3D = R3D;

let renderer, scene, camera, dirLight, hemiLight;
let ARENA = 300, PLAYER_R = 18;
let SW = 1, SH = 1, camDist = 800;
const TILT = 0.8;
const VIS = 1.3;            // 角色外觀放大倍率（不影響碰撞）          // 鏡頭與垂直線的夾角（弧度）
const FOV = 38;
const camTarget = new THREE.Vector3(0, 0, 12);
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpColor = new THREE.Color();

// 共用幾何
const GEO = {};
function buildGeometries() {
  GEO.body = new THREE.CylinderGeometry(0.62, 0.8, 1.25, 14);
  GEO.body.translate(0, 0.62, 0);
  GEO.head = new THREE.SphereGeometry(0.55, 16, 12);
  GEO.fist = new THREE.SphereGeometry(0.36, 12, 10);
  GEO.unitSphere = new THREE.SphereGeometry(1, 10, 7);
  GEO.arm = new THREE.CylinderGeometry(1, 1, 1, 10);
  GEO.ring = new THREE.RingGeometry(0.86, 1, 64);
  GEO.ringThin = new THREE.RingGeometry(0.975, 1, 96);
  GEO.disc = new THREE.CircleGeometry(1, 48);
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.cone = new THREE.ConeGeometry(1, 1, 10);
  GEO.cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
  GEO.torus = new THREE.TorusGeometry(0.56, 0.08, 6, 20);
}

const lambert = (color, o = {}) => new THREE.MeshLambertMaterial(Object.assign({ color }, o));
const basic = (color, o = {}) => new THREE.MeshBasicMaterial(Object.assign({ color, transparent: true, depthWrite: false }, o));

// ---------- 初始化 ----------
R3D.init = (canvas, cfg) => {
  ARENA = cfg.ARENA; PLAYER_R = cfg.PLAYER_R;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // 搭配 shadow.radius 做柔和邊緣
  renderer.outputEncoding = THREE.sRGBEncoding;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#07080b');
  scene.fog = new THREE.Fog('#07080b', 900, 1900);
  camera = new THREE.PerspectiveCamera(FOV, 1, 10, 5000);

  // 灰暗的夜晚：冷色環境光很弱、月光從斜上方打下（有影子）
  hemiLight = new THREE.HemisphereLight(0x5a6888, 0x120f0c, 0.2);
  scene.add(hemiLight);
  dirLight = new THREE.DirectionalLight(0x8fa6d6, 0.32);
  dirLight.position.set(-260, 620, 200);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  const sc = dirLight.shadow.camera;
  // 範圍要蓋到外圍建築，建築的影子才會落進打鬥區、蓋在角色身上
  sc.left = -ARENA - 520; sc.right = ARENA + 520; sc.top = ARENA + 520; sc.bottom = -ARENA - 520;
  sc.near = 50; sc.far = 2200;
  dirLight.shadow.bias = -0.0004;
  dirLight.shadow.normalBias = 1.2; // 角色也接收陰影，沿法線推開避免身上出現條紋
  dirLight.shadow.radius = 5;    // 陰影邊緣模糊程度
  scene.add(dirLight);
  // 環境反射（PBR 材質用；強度在各材質調低，保持灰暗）
  if (THREE.RoomEnvironment) {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  }

  setupComposer();
  buildGeometries();
  buildRigGeometries();
  buildStreet();
  collectOccluders();
  mergeStatic();
  buildPlayer();
  buildFx();
  loadHeroModel();
};

// 發光後處理（UnrealBloom）。效能不足時自動關閉，也可在暫停選單切換。
let composer = null, bloomPass = null, ssaoPass = null, gradePass = null, lastDpr = 1;
// 電影級最終調色：曝光 → 色差 → ACES 色調映射 → 轉 sRGB → 對比、飽和、分離色調 → 暗角 → 顆粒
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null }, exposure: { value: 1.0 }, contrast: { value: 1.08 }, saturation: { value: 1.0 },
    shadowTint: { value: new THREE.Vector3(0.0, 0.03, 0.06) }, highTint: { value: new THREE.Vector3(0.05, 0.02, -0.03) },
    vignette: { value: 0.35 }, grain: { value: 0.035 }, time: { value: 0 }, ca: { value: 0.0015 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float exposure, contrast, saturation, vignette, grain, time, ca;
    uniform vec3 shadowTint, highTint; varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + d * ca * 4.0 * r2 * 4.0).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - d * ca * 4.0 * r2 * 4.0).b;
      c = aces(c * exposure);
      c = pow(c, vec3(1.0/2.2));
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contrast + 0.5;
      c += shadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + highTint * smoothstep(0.45, 1.0, l);
      c *= 1.0 - vignette * smoothstep(0.15, 0.75, r2 * 2.0);
      c += (rnd(vUv * 977.0 + time) - 0.5) * grain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
R3D.quality = 'high';
function setupComposer() {
  if (!THREE.EffectComposer || !THREE.UnrealBloomPass) { R3D.quality = 'low'; return; }
  composer = new THREE.EffectComposer(renderer);
  // 環境光遮蔽（角落、接地處自然變暗）；不支援時退回一般繪製
  if (THREE.SSAOPass) {
    ssaoPass = new THREE.SSAOPass(scene, camera, 512, 512, 12); // 取樣數 12（預設 32，太吃效能）
    ssaoPass.kernelRadius = 26; ssaoPass.minDistance = 0.0008; ssaoPass.maxDistance = 0.06;
    ssaoPass.normalMaterial.skinning = true; // 主角是蒙皮網格，法線也要跟著動作
    composer.addPass(ssaoPass);
  } else composer.addPass(new THREE.RenderPass(scene, camera));
  bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.92);
  composer.addPass(bloomPass);
  gradePass = new THREE.ShaderPass(GRADE_SHADER);
  composer.addPass(gradePass);
  applyQuality();
}
function applyQuality() {
  const high = R3D.quality === 'high' && composer;
  renderer.outputEncoding = high ? THREE.LinearEncoding : THREE.sRGBEncoding;
  renderer.setPixelRatio(high ? Math.min(1.5, lastDpr) : Math.min(2, lastDpr));
  renderer.setSize(SW, SH, false);
  // 低品質時：直接用渲染器的色調映射（沒有後處理）
  renderer.toneMapping = high ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  if (composer) {
    composer.setPixelRatio(Math.min(1.5, lastDpr));
    composer.setSize(SW, SH);
    bloomPass.resolution.set(SW / 2, SH / 2);
    if (ssaoPass) ssaoPass.setSize(Math.floor(SW * Math.min(1.5, lastDpr)), Math.floor(SH * Math.min(1.5, lastDpr))); // 環境光遮蔽也輸出主畫面，必須全解析度
  }
}
R3D.setQuality = (q, manual) => {
  R3D.quality = composer ? q : 'low';
  if (manual) R3D.manualQuality = true;
  applyQuality();
};
// 前幾秒量畫面速度，太慢就自動降低特效
let perfFrames = 0, perfTime = 0;
function watchPerf(rdt) {
  if (R3D.manualQuality || R3D.quality !== 'high' || perfFrames < 0) return;
  if (rdt <= 0) return;
  perfFrames++; perfTime += rdt;
  if (perfFrames >= 120) {
    if (perfTime / perfFrames > 1 / 38) R3D.setQuality('low');
    perfFrames = -1;
  }
}

R3D.resize = (w, h, dpr) => {
  SW = w; SH = h;
  lastDpr = dpr || 1;
  renderer.setPixelRatio(Math.min(2, dpr || 1));
  renderer.setSize(w, h, false);
  applyQuality();
  camera.aspect = w / h;
  // 讓整個擂台塞進畫面（上下保留介面空間）
  const v = THREE.MathUtils.degToRad(FOV) / 2;
  const hHalf = Math.atan(Math.tan(v) * camera.aspect);
  const usableV = Math.max(0.45, (h - 200) / h);
  // 直式手機允許左右邊緣稍微出畫面，讓角色大一點
  const dW = (ARENA * (camera.aspect < 0.8 ? 0.92 : 1.12)) / Math.tan(hHalf);
  const dH = (ARENA * (0.45 + 0.6 * Math.cos(TILT))) / (Math.tan(v) * usableV);
  camDist = Math.max(dW, dH);
  scene.fog.near = camDist * 1.05;
  scene.fog.far = camDist * 2.4;
  // 介面上方比下方少一點，畫面中心稍微往下挪
  camTarget.set(0, 0, 12 + (8 / h) * camDist * Math.tan(v));
  camera.updateProjectionMatrix();
};

// 世界座標 → 螢幕座標（給 2D 介面用）
// 測試用：同時顯示背後的動作捕捉骨架（半透明積木）
R3D.debugShowProxy = on => { if (!hero) return; player.userData.lean.traverse(o => { if (o.isMesh && !isUnder(o, hero.model)) o.visible = on; }); };
R3D.debugFeet = () => hero && ["Left", "Right"].map(s => { const v = hero.B[s + "Foot"].getWorldPosition(new THREE.Vector3()); return [+v.x.toFixed(1), +v.y.toFixed(1), +v.z.toFixed(1)]; });
R3D.debugShadow = () => ({ enabled: renderer.shadowMap.enabled, cast: dirLight.castShadow, pos: dirLight.position.toArray().map(Math.round), map: !!dirLight.shadow.map, inten: +dirLight.intensity.toFixed(2), heroCast: !!(hero && hero.meshes.some(m => m.castShadow)), ground: scene.children.filter(o => o.isMesh && o.receiveShadow).length });
R3D.debugChest = () => { if (!hero) return null; const l = hero.B.LeftArm.getWorldPosition(new THREE.Vector3()), r = hero.B.RightArm.getWorldPosition(new THREE.Vector3()); const side = l.sub(r); const f = side.cross(new THREE.Vector3(0, 1, 0)).normalize(); return Math.round(Math.atan2(f.z, f.x) * 180 / Math.PI); };
R3D.debugElbow = () => { if (!hero) return null; const mx = player.userData.mxRig; const ang = (B, s) => { const a = B[s + "Arm"].getWorldPosition(new THREE.Vector3()), b = B[s + "ForeArm"].getWorldPosition(new THREE.Vector3()), c = B[s + "Hand"].getWorldPosition(new THREE.Vector3()); return Math.round(b.clone().sub(a).angleTo(c.clone().sub(b)) * 180 / Math.PI); }; const u = player.userData; return { clip: u.anim.cur, t: +(u.anim.t - (u.impactClipT || 0)).toFixed(3), prev: u.anim.prev, fade: +u.anim.fade.toFixed(2), src: [ang(mx.B, "Left"), ang(mx.B, "Right")], model: [ang(hero.B, "Left"), ang(hero.B, "Right")] }; };
R3D.debugWrist = () => { if (!hero) return null; const u = player.userData; const r = s => +hero.B[s + "Hand"].quaternion.angleTo(hero.rest[s + "Hand"].lq).toFixed(2); return { clip: u.anim.cur, t: +(u.anim.t - (u.impactClipT || 0)).toFixed(2), wrist: [r("Left"), r("Right")] }; };
R3D.debugWristAng = () => { if (!hero) return null; const g = n => hero.B[n].getWorldPosition(new THREE.Vector3()); const f = s => { const fd = g(s + "Hand").sub(g(s + "ForeArm")).normalize(); const hd = g(s + "HandMiddle1").sub(g(s + "Hand")).normalize(); return Math.round(fd.angleTo(hd) * 180 / Math.PI); }; return { clip: player.userData.anim.cur, L: f("Left"), R: f("Right") }; };
R3D.debugSash = () => hero && hero.sash && hero.sash.chains.map(c => ({ n: c.vs.length, tipY: c.p ? +c.p[SASH_SEG].y.toFixed(1) : null }));
// 測試用：某個位置是否被建築擋住主光（射線朝光源方向）
R3D.debugLit = (x, y, z) => {
  const o = new THREE.Vector3(x, y, z), d = dirLight.position.clone().normalize();
  const rc = new THREE.Raycaster(o, d, 1, 3000);
  const hits = rc.intersectObjects(scene.children.filter(m => m.isMesh && m.castShadow && !(hero && hero.meshes.includes(m))), false);
  return hits.length ? 'shadow' : 'lit';
};
R3D.debugLightDir = () => dirLight.position.clone().normalize().toArray();
R3D.debugHeroPos = () => { const v = new THREE.Vector3(); hero.meshes[0].getWorldPosition(v); return [v.x, v.y, v.z].map(Math.round); };
R3D.debugRecv = on => { for (const m of hero.meshes) { m.receiveShadow = on; for (const x of [].concat(m.material)) x.needsUpdate = true; } };
R3D.debugScene = () => {
  const c = {}; let lights = 0;
  scene.traverseVisible(o => {
    if (o.isLight) lights++;
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    const k = (o.isInstancedMesh ? 'inst' : o.isSkinnedMesh ? 'skin' : o.type) + (o.castShadow ? '+影' : '') + (o.material && o.material.transparent ? '+透' : '');
    c[k] = (c[k] || 0) + 1;
  });
  return { c, lights, calls: renderer.info.render.calls, batches: batches.size, programs: renderer.info.programs.length };
};
R3D.setTime = f => { todStart = performance.now() / 1000 - DAY_LEN * f; };
// 測試用：Mixamo 來源骨架與模型骨架，每根骨頭方向的角度誤差（度）
R3D.debugBoneErr = () => {
  const mx = player.userData.mxRig; if (!hero || !mx) return null;
  player.updateMatrixWorld(true);
  const out = {};
  for (const [tn, tc] of MX_MAP) {
    if (!tc || !mx.B[tc] || !hero.B[tc]) continue;
    const ds = mx.B[tc].getWorldPosition(new THREE.Vector3()).sub(mx.B[tn].getWorldPosition(new THREE.Vector3())).normalize();
    const dt = hero.B[tc].getWorldPosition(new THREE.Vector3()).sub(hero.B[tn].getWorldPosition(new THREE.Vector3())).normalize();
    out[tn] = Math.round(ds.angleTo(dt) * 180 / Math.PI);
  }
  return out;
};
// 測試用：手、腳、頭相對髖部的位置誤差（以腿長為 1）
R3D.debugEndErr = () => {
  const mx = player.userData.mxRig; if (!hero || !mx) return null;
  player.updateMatrixWorld(true);
  const leg = hero.B.LeftUpLeg.getWorldPosition(new THREE.Vector3()).distanceTo(hero.B.LeftLeg.getWorldPosition(new THREE.Vector3())) + hero.B.LeftLeg.getWorldPosition(new THREE.Vector3()).distanceTo(hero.B.LeftFoot.getWorldPosition(new THREE.Vector3()));
  const hs = mx.B.Hips.getWorldPosition(new THREE.Vector3()), ht = hero.B.Hips.getWorldPosition(new THREE.Vector3());
  const out = {};
  for (const n of ['LeftHand', 'RightHand', 'LeftForeArm', 'RightForeArm', 'Head', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) {
    const a = mx.B[n].getWorldPosition(new THREE.Vector3()).sub(hs), b = hero.B[n].getWorldPosition(new THREE.Vector3()).sub(ht);
    out[n] = +(a.distanceTo(b) / leg).toFixed(2);
  }
  return out;
};
R3D.debugLock = () => [FOOT_LOCK.Left ? 1 : 0, FOOT_LOCK.Right ? 1 : 0, hero && +(hero.ankle0 * PLAYER_R * RIG_SCALE).toFixed(1)];
R3D.debugSole = () => hero && Math.min(...["Left","Right"].flatMap(s => ["Foot","ToeBase","Toe_End"].map(p => hero.B[s+p] ? hero.B[s+p].getWorldPosition(new THREE.Vector3()).y - hero.sole0[p] * PLAYER_R * RIG_SCALE : 99))) ;
R3D.debugFootW = () => hero && ["Left", "Right"].map(s => hero.B[s + "Foot"].getWorldPosition(new THREE.Vector3()).toArray());
// 測試用：主角是否在飛踢中
R3D.debugPlayer = () => ({ cur: player.userData.anim.cur, f: player.userData.flight && { D: player.userData.flight.D, t0: player.userData.flight.t0, th: player.userData.flight.theta, name: player.userData.flight.name }, at: player.userData.anim.t, ti: player.userData.impactClipT, x: player.position.x, y: player.position.y, z: player.position.z, flying: !!player.userData.flight, tilt: 2 * Math.acos(Math.min(1, Math.abs(player.userData.lean.quaternion.w))) * 180 / Math.PI });
// 測試用：每格繪製次數與三角形數
R3D.stats = () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles });

R3D.project = (x, y, h = 0) => {
  tmpV.set(x, h, y).project(camera);
  return { x: (tmpV.x + 1) / 2 * SW, y: (1 - tmpV.y) / 2 * SH, visible: tmpV.z < 1 };
};

// ---------- 場景：舊街區（PBR 材質，貼圖由 tools/textures/gen.py 產生） ----------
const TEXL = new THREE.TextureLoader();
const texCache = {};
function tex(name, rep = [1, 1], color = false) {
  const src = window.TEXTURES && TEXTURES[name];
  if (!src) return null;
  const key = name + rep.join(',');
  if (texCache[key]) return texCache[key];
  const t = TEXL.load(src);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep[0], rep[1]);
  t.anisotropy = 4;
  if (color) t.encoding = THREE.sRGBEncoding;
  return (texCache[key] = t);
}
// PBR 材質：顏色＋法線＋粗糙度（＋發光）
function pbr(name, rep = [1, 1], o = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: tex(name + '_color', rep, true), normalMap: tex(name + '_normal', rep), roughnessMap: tex(name + '_rough', rep),
    roughness: 1, metalness: o.metal ?? 0, envMapIntensity: o.env ?? 0.35, color: o.color || 0xffffff,
  });
  if (o.emit) { m.emissiveMap = tex(name + '_emit', rep, true); m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = o.emit; }
  m.normalScale.set(o.ns ?? 1, o.ns ?? 1);
  return m;
}
const neonList = [];
const windowMats = [];
function signTexture(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0b10'; g.fillRect(0, 0, 256, 96);
  g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(6, 6, 244, 84);
  g.font = '900 58px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 16; g.fillStyle = color; g.fillText(text, 128, 52);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}
function addMesh(geo, mat, x, y, z, ry = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m;
}

function buildStreet() {
  const R = ARENA;
  // 地面：舊柏油路
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), pbr('asphalt', [20, 20], { env: 0.35, color: 0x6a6a6a }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.4; outer.receiveShadow = true; scene.add(outer);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), pbr('groundbig', [1, 1], { env: 0.5, color: 0xa0a0a0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  // 斑駁的白色路面標線（打鬥圈外圍的舊停車格線）
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x8c8a80, roughness: 0.9, transparent: true, opacity: 0.35 });

  // 建築：北側一整排正對鏡頭，東西兩側各一排；建築之間留巷口讓敵人出來
  const mats = { brick: 'brick', plaster: 'plaster', brick2: 'brick2' };
  const blocks = [
    // [x, z, 寬, 高, 深, 朝向, 材質]
    [-470, -R - 210, 300, 330, 180, 0, 'brick'], [-120, -R - 230, 260, 420, 200, 0, 'plaster'], [210, -R - 215, 280, 290, 180, 0, 'brick2'], [540, -R - 200, 260, 380, 180, 0, 'brick'],
    [-R - 290, -150, 260, 300, 200, Math.PI / 2, 'brick2'], [-R - 280, 230, 300, 360, 200, Math.PI / 2, 'plaster'],
    [R + 290, -170, 280, 340, 200, -Math.PI / 2, 'plaster'], [R + 280, 220, 260, 280, 200, -Math.PI / 2, 'brick'],
  ];
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.95 });
  const signs = [['麵', '#ff4f6a'], ['當舖', '#3fe0c5'], ['酒', '#ffcf3a'], ['按摩', '#c86bff'], ['旅社', '#ff8a3c'], ['理髮', '#4fa3ff']];
  let si = 0;
  for (const [x, z, w, h, d, ry, mn] of blocks) {
    const tileW = mn === 'plaster' ? 180 : (mn === 'brick2' ? 300 : 240), tileH = mn === 'brick2' ? 275 : 220;
    const front = pbr(mn, [w / tileW, h / tileH], { emit: 1.6, color: 0x9a9a9a });
    windowMats.push(front);
    const side = pbr(mn, [d / tileW, h / tileH], { emit: 1.6, color: 0x9a9a9a });
    windowMats.push(side);
    const box = addMesh(new THREE.BoxGeometry(w, h, d), [side, side, roofMat, roofMat, front, front], x, h / 2, z, ry);
    // 正面（朝向擂台）的局部座標：+Z
    const fwd = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)), right = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
    const at = (u, y, out = 0) => new THREE.Vector3(x, y, z).addScaledVector(right, u).addScaledVector(fwd, d / 2 + out);
    // 一樓鐵捲門
    const nDoor = Math.max(1, Math.round(w / 110));
    for (let i = 0; i < nDoor; i++) {
      const u = -w / 2 + (i + 0.5) * (w / nDoor), p = at(u, 34, 1);
      addMesh(new THREE.PlaneGeometry(w / nDoor - 18, 64), pbr('shutter', [1, 1], { metal: 0.6, env: 0.5 }), p.x, p.y, p.z, ry, false);
    }
    // 冷氣機、雨遮、管線
    const acMat = pbr('paintmetal', [1, 1], { metal: 0.4, color: 0xb0b0b0 });
    for (let i = 0; i < 3; i++) {
      const p = at(-w / 2 + 30 + Math.random() * (w - 60), 110 + Math.random() * (h - 160), 10);
      addMesh(new THREE.BoxGeometry(34, 22, 20), acMat, p.x, p.y, p.z, ry);
    }
    const pipe = at(w / 2 - 14, h / 2, 6);
    addMesh(new THREE.CylinderGeometry(3, 3, h, 8), pbr('paintmetal', [1, 4], { metal: 0.5, color: 0x777777 }), pipe.x, pipe.y, pipe.z, 0);
    // 霓虹招牌（直立，凸出牆面）
    const [txt, col] = signs[si++ % signs.length];
    const sp = at(-w / 2 + 40 + Math.random() * (w - 80), 105, 22);
    const signMat = new THREE.MeshStandardMaterial({ map: signTexture(txt, col), emissiveMap: signTexture(txt, col), emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.5 });
    const sign = addMesh(new THREE.BoxGeometry(70, 26, 4), signMat, sp.x, sp.y, sp.z, ry, false);
    const nl = (neonList.length % 2) ? null : new THREE.PointLight(new THREE.Color(col), 1.3, 420, 1.5); if (nl) nl.position.copy(at(sp.clone().sub(new THREE.Vector3(x, 0, z)).dot(right), 105, 60)); if (nl) scene.add(nl);
    neonList.push({ mat: signMat, light: nl, base: 1.4, ph: Math.random() * 10, flicker: Math.random() < 0.35 });
    // 人行道（建築前）
    const sw = at(0, 3, 30);
    addMesh(new THREE.BoxGeometry(w + 30, 6, 60), pbr('concrete', [w / 120, 0.5]), sw.x, sw.y, sw.z, ry, false);
  }

  // 雜物：垃圾箱、垃圾袋、油桶、木箱、三角錐（放在打鬥圈外，不擋路）
  const ring = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
  const dumpMat = pbr('paintmetal', [1, 1], { metal: 0.5 }), woodMat = pbr('wood', [1, 1]), barrelMat = pbr('paintmetal', [1, 2], { metal: 0.5, color: 0x9a4a2a });
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.15 }); // 黑色塑膠垃圾袋
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xd8541e, roughness: 0.6 });
  const props = [[0.6, 'dump'], [2.1, 'dump'], [3.9, 'crate'], [4.4, 'barrel'], [5.2, 'bags'], [1.3, 'bags'], [2.8, 'barrel'], [5.8, 'cone'], [0.2, 'crate'], [3.3, 'cone']];
  for (const [a, k] of props) {
    const [px, pz] = ring(a, R + 70 + Math.random() * 40);
    if (k === 'dump') { addMesh(new THREE.BoxGeometry(70, 46, 40), dumpMat, px, 23, pz, a); addMesh(new THREE.BoxGeometry(74, 4, 44), dumpMat, px, 48, pz, a); }
    if (k === 'crate') { addMesh(new THREE.BoxGeometry(34, 34, 34), woodMat, px, 17, pz, a); addMesh(new THREE.BoxGeometry(28, 28, 28), woodMat, px + 10, 48, pz - 4, a + 0.4); }
    if (k === 'barrel') for (let i = 0; i < 2; i++) addMesh(new THREE.CylinderGeometry(13, 13, 40, 14), barrelMat, px + i * 28, 20, pz + i * 6, 0);
    if (k === 'bags') for (let i = 0; i < 4; i++) { const b = addMesh(new THREE.SphereGeometry(14, 10, 8), bagMat, px + (i % 2) * 22, 10, pz + (i >> 1) * 20, Math.random() * 3); b.scale.set(1, 0.75, 1.1); }
    if (k === 'cone') addMesh(new THREE.ConeGeometry(8, 26, 12), coneMat, px, 13, pz, 0);
  }

  // 路燈：只留燈桿當街景擺設（燈光、光圈、閃爍都拿掉，避免干擾畫面）
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.6, metalness: 0.7 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.4 });
  for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
    const [px, pz] = ring(a, R + 110);
    addMesh(new THREE.CylinderGeometry(3, 4, 230, 8), poleMat, px, 115, pz, 0);
    const toC = Math.atan2(-pz, -px);
    addMesh(new THREE.BoxGeometry(50, 4, 4), poleMat, px + Math.cos(toC) * 25, 228, pz + Math.sin(toC) * 25, -toC);
    addMesh(new THREE.SphereGeometry(7, 10, 8), bulbMat, px + Math.cos(toC) * 48, 222, pz + Math.sin(toC) * 48, 0, false);
  }
}

// 霓虹閃爍
// ---------- 日夜變化：一輪 3 分鐘（清晨 → 白天 → 黃昏 → 夜晚） ----------
const DAY_LEN = 180; // 一輪 3 分鐘
// 各時段的調色：[曝光, 飽和度, 暗部色調, 亮部色調]
const GRADE_DAY = [1.0, 1.08, [0.0, 0.01, 0.03], [0.04, 0.03, 0.0]], GRADE_NIGHT = [1.45, 0.9, [0.0, 0.04, 0.08], [0.07, 0.02, -0.03]], GRADE_DUSK = [1.3, 1.15, [0.03, 0.0, 0.05], [0.09, 0.03, -0.04]];
// 關鍵時刻：[時間 0~1, 太陽/月亮高度角, 主光顏色, 主光強度, 天空顏色, 地面反光色, 環境光強度, 背景/霧顏色, 夜晚程度]
const TOD_KEYS = [
  // [時間, 高度角, 主光色, 主光強度, 天空色, 地面反光色, 環境光強度, 背景/霧色, 夜晚程度, 霧遠近倍率]
  [0.00, 0.30, 0xff9a5c, 1.4, 0xb08ab0, 0x3a2418, 0.95, 0x6a5058, 0.45, 1.0],  // 清晨：粉橘
  [0.12, 0.95, 0xfff4e0, 2.0, 0xbcd4ff, 0x5a4a38, 1.2, 0xa8b8cc, 0.0, 1.6],  // 上午：明亮
  [0.38, 1.10, 0xffffff, 2.2, 0xc8dcff, 0x5a4a38, 1.3, 0xb4c4d8, 0.0, 1.8],  // 正午：最亮
  [0.52, 0.32, 0xff7a30, 1.6, 0xd08a6a, 0x3a2010, 0.85, 0x8a5040, 0.25, 1.1],  // 黃昏：濃橘
  [0.64, 0.75, 0x7f98d0, 0.55, 0x4a5c8c, 0x1a1820, 0.42, 0x0a0e1a, 1.0, 0.7],  // 入夜：很暗
  [0.92, 0.80, 0x7f98d0, 0.55, 0x4a5c8c, 0x1a1820, 0.42, 0x090c16, 1.0, 0.7],  // 深夜
  [1.00, 0.30, 0xff9a5c, 1.4, 0xb08ab0, 0x3a2418, 0.95, 0x6a5058, 0.45, 1.0],  // 回到清晨
];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
let envMats = null;
R3D.refreshEnvMats = () => { envMats = null; };
let todStart = performance.now() / 1000 - DAY_LEN * 0.6; // 一開始是黃昏快入夜
R3D.night = 0;
function lerpHex(a, b, k, out) { return out.set(a).lerp(_c2.set(b), k); }
function updateDayNight() {
  const now = performance.now() / 1000;
  const tod = (((now - todStart) / DAY_LEN) % 1 + 1) % 1;
  R3D.tod = tod;
  let i = 0; while (i < TOD_KEYS.length - 2 && TOD_KEYS[i + 1][0] <= tod) i++;
  const A = TOD_KEYS[i], B = TOD_KEYS[i + 1];
  const k = Math.min(1, Math.max(0, (tod - A[0]) / (B[0] - A[0])));
  const kk = k * k * (3 - 2 * k);
  const L = (j) => A[j] + (B[j] - A[j]) * kk;
  // 光的方向：白天太陽由東到西劃過天空，夜晚是月亮（同樣有影子）
  const night = L(8);
  const elev = L(1);
  const az = tod * Math.PI * 2 * 1.0 + 0.6;
  const dist = 700;
  dirLight.position.set(Math.cos(az) * Math.cos(elev) * dist, Math.sin(elev) * dist + 80, Math.sin(az) * Math.cos(elev) * dist);
  lerpHex(A[2], B[2], kk, dirLight.color);
  dirLight.intensity = L(3);
  lerpHex(A[4], B[4], kk, hemiLight.color);
  lerpHex(A[5], B[5], kk, hemiLight.groundColor);
  hemiLight.intensity = L(6);
  lerpHex(A[7], B[7], kk, scene.background);
  scene.fog.color.copy(scene.background);
  scene.fog.near = camDist * 0.9 * L(9); scene.fog.far = camDist * 2.2 * L(9);
  // 環境反射跟著亮度：白天強、夜晚很弱（否則夜晚地面會灰白）
  if (!envMats) { envMats = []; scene.traverse(o => { if (o.isMesh || o.isInstancedMesh) for (const m of [].concat(o.material)) if (m && m.isMeshStandardMaterial && !envMats.includes(m)) { m.userData.env0 = m.envMapIntensity; envMats.push(m); } }); }
  const day = 1 - night;
  shadeK = 0.4 + 0.6 * night * night; // 白天與黃昏都壓得夠暗，完全入夜才不壓
  for (const m of envMats) m.envMapIntensity = m.userData.env0 * (0.4 + 0.6 * day);
  // 調色跟著時段：白天乾淨、黃昏偏暖、夜晚暗部偏青
  const dusk = Math.max(0, 1 - Math.abs(tod - 0.54) / 0.08) + Math.max(0, 1 - Math.abs(tod - 0.02) / 0.06) * 0.6;
  const mixG = (j) => { const a = GRADE_DAY[j], b = GRADE_NIGHT[j], c = GRADE_DUSK[j];
    const blend = (x, y, k2) => (typeof x === 'number' ? x + (y - x) * k2 : x.map((v, i) => v + (y[i] - v) * k2));
    return blend(blend(a, b, night), c, Math.min(1, dusk)); };
  if (gradePass) {
    const U = gradePass.uniforms;
    U.exposure.value = mixG(0); U.saturation.value = mixG(1);
    U.shadowTint.value.fromArray(mixG(2)); U.highTint.value.fromArray(mixG(3));
    U.time.value = now % 100;
  }
  renderer.toneMappingExposure = mixG(0);
  // 夜晚程度：霓虹、亮著的窗
  R3D.night = night;
  for (const m of windowMats) m.emissiveIntensity = 1.6 * (0.15 + 0.85 * night);
  return night;
}
function updateStreet(t) {
  const night = updateDayNight();
  for (const n of neonList) {
    let k = 1;
    if (n.flicker) { const s = Math.sin(t * 13 + n.ph) + Math.sin(t * 31 + n.ph * 2); k = s > 1.6 ? 0.15 : (Math.random() < 0.02 ? 0.3 : 1); }
    const on = 0.25 + 0.75 * night; // 白天招牌還是亮但比較淡
    n.mat.emissiveIntensity = n.base * k * on;
    if (n.light) n.light.intensity = 2.0 * k * night;
  }
}

// ---------- 擂台（舊場景，已不使用） ----------
function octPoints(r) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(512, 512, 60, 512, 512, 520);
  grad.addColorStop(0, '#4a5060');
  grad.addColorStop(1, '#2c303b');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 3;
  for (let i = 0; i <= 1024; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke();
  }
  // 磨損痕跡
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    g.beginPath(); g.arc(Math.random() * 1024, Math.random() * 1024, Math.random() * 30 + 5, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(63,224,197,0.35)';
  g.lineWidth = 14;
  g.beginPath(); g.arc(512, 512, 120, 0, Math.PI * 2); g.stroke();
  g.font = '900 120px system-ui, sans-serif';
  g.fillStyle = 'rgba(63,224,197,0.22)';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('RL', 512, 518);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  return t;
}

function fenceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(200,210,220,0.85)';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let crowd = null, crowdBase = [];
function buildArena() {
  // 場外地面
  const ground = new THREE.Mesh(new THREE.CircleGeometry(2200, 48), new THREE.MeshBasicMaterial({ color: '#07060a' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -16;
  ground.receiveShadow = true;
  scene.add(ground);

  // 擂台平台（八角柱，頂面貼地板貼圖）
  const R = ARENA + 22;
  const plat = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R + 8, 16, 8, 1, false, Math.PI * 3 / 8),
    [lambert('#1b1b23'), lambert('#ffffff', { map: floorTexture() }), lambert('#111')]
  );
  plat.position.y = -8;
  plat.receiveShadow = true;
  scene.add(plat);

  // 圍欄：柱子、鐵絲網、上下欄杆
  const pts = octPoints(ARENA + 8);
  const postMat = lambert('#3a3f48');
  const neonMat = new THREE.MeshBasicMaterial({ color: '#3fe0c5' });
  const railMat = lambert('#6b737e');
  const fenceTex = fenceTexture();
  for (let i = 0; i < 8; i++) {
    const [x, z] = pts[i];
    const post = new THREE.Mesh(GEO.cyl, postMat);
    post.scale.set(6, 76, 6); post.position.set(x, 38, z);
    post.castShadow = true;
    scene.add(post);
    const pad = new THREE.Mesh(GEO.cyl, neonMat);
    pad.scale.set(7.5, 10, 7.5); pad.position.set(x, 78, z);
    scene.add(pad);
    const glow = new THREE.Mesh(GEO.disc, basic('#3fe0c5', { opacity: 0.18 }));
    glow.rotation.x = -Math.PI / 2; glow.scale.setScalar(26); glow.position.set(x, 0.6, z);
    scene.add(glow);
    const [x2, z2] = pts[(i + 1) % 8];
    const len = Math.hypot(x2 - x, z2 - z);
    const mid = new THREE.Vector3((x + x2) / 2, 0, (z + z2) / 2);
    const ang = Math.atan2(z2 - z, x2 - x);
    const tex = fenceTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(len / 14, 64 / 14);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 64),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    panel.position.set(mid.x, 34, mid.z);
    panel.rotation.y = -ang;
    scene.add(panel);
    for (const hgt of [3, 68]) {
      const rail = new THREE.Mesh(GEO.cyl, railMat);
      rail.scale.set(2.2, len, 2.2);
      rail.position.set(mid.x, hgt, mid.z);
      rail.quaternion.setFromUnitVectors(UP, new THREE.Vector3(x2 - x, 0, z2 - z).normalize());
      scene.add(rail);
    }
  }

  // 觀眾（場外的人頭與身體）
  const N = 520;
  const geo = new THREE.SphereGeometry(1, 8, 6);
  crowd = new THREE.InstancedMesh(geo, lambert('#5a5a66'), N);
  crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  let k = 0;
  for (let i = 0; i < N * 3 && k < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = ARENA + 90 + Math.random() * 520;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = 9 + Math.random() * 4;
    crowdBase.push({ x, z, s, ph: Math.random() * 10, y: -16 + s + (r - ARENA - 90) * 0.06 });
    tmpColor.setHSL(Math.random(), 0.2, 0.05 + Math.random() * 0.06);
    crowd.setColorAt(k, tmpColor);
    k++;
  }
  crowd.count = k;
  scene.add(crowd);
}

function buildStadiumLights() {
  const coneMat = new THREE.MeshBasicMaterial({ color: '#c9d4ff', transparent: true, opacity: 0.018, depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending });
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#fff8e8' });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const top = new THREE.Vector3(Math.cos(a) * (ARENA + 260), 620, Math.sin(a) * (ARENA + 260));
    const target = new THREE.Vector3(Math.cos(a) * ARENA * 0.15, 0, Math.sin(a) * ARENA * 0.15);
    const len = top.distanceTo(target);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(ARENA * 0.4, len, 24, 1, true), coneMat);
    cone.position.copy(top).lerp(target, 0.5);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target.clone().sub(top).normalize());
    scene.add(cone);
    const bulb = new THREE.Mesh(GEO.unitSphere, bulbMat);
    bulb.scale.setScalar(16);
    bulb.position.copy(top);
    scene.add(bulb);
  }
}

function updateCrowd(t, hype) {
  for (let i = 0; i < crowd.count; i++) {
    const c = crowdBase[i];
    const jump = Math.max(0, Math.sin(t * (4 + hype * 6) + c.ph)) * (2 + hype * 10);
    tmpM.makeScale(c.s, c.s * 1.25, c.s);
    tmpM.setPosition(c.x, c.y + jump, c.z);
    crowd.setMatrixAt(i, tmpM);
  }
  crowd.instanceMatrix.needsUpdate = true;
}

// ---------- 角色（真人動作捕捉骨架） ----------
// 骨架與動作來自 CMU 動作捕捉資料庫（js/mocap.js），身體零件掛在骨頭上。
// 片段已在轉檔時把出招方向轉成 +X；外層 Group 用 rotation.y = -facing 轉向。
const MC = window.MOCAP;
const SK = MC.skeleton;
const NJ = SK.names.length;
const JI = {};
SK.names.forEach((n, i) => { JI[n] = i; });
const UNIT = 2.45 / SK.height;   // 骨架單位 → 角色單位（約 2.45 高）
const RIG_SCALE = 1.75;          // 碰撞半徑 → 外觀大小
const ICE = new THREE.Color('#a8e4ff');
const GRAY_LOOK = { skin: '#8a8f9a', shirt: '#7b808c', pants: '#6a6f7a', hair: '#5d626c', shoe: '#55595f', gray: true };

// 各敵人外觀
const LOOKS = {
  grunt:   { skin: '#e0ac85', shirt: '#d9534f', pants: '#3b4a6b', hair: '#2b1d14' },
  runner:  { skin: '#c98d62', shirt: '#f0883e', pants: '#2f2f3a', hair: '#111111', band: '#ffffff', slim: 0.85, sleeve: true, shoe: '#f2f2f2' },
  tank:    { skin: '#d9a27a', shirt: '#8e5bd1', pants: '#3a2a50', hair: '#111111', wide: 1.45, baggy: true },
  bomber:  { skin: '#b07c5a', shirt: '#3a3a44', pants: '#22222a', hair: '#111111', bomb: true, sleeve: true },
  charger: { skin: '#a86c48', shirt: '#b5652f', pants: '#4a3020', hair: '#2b1d14', horns: true, wide: 1.15 },
  drummer: { skin: '#e6b896', shirt: '#3a7bd5', pants: '#20304f', hair: '#4a2a14', drum: true, sleeve: true },
  spore:   { skin: '#d6c9a8', shirt: '#8fbf3a', pants: '#4a5a2a', hair: '#d6c9a8', mushroom: true },
  goldie:  { skin: '#f0c090', shirt: '#f2c230', pants: '#7a5a10', hair: '#5a3a10', bag: true, slim: 0.9 },
  boss_slam:   { skin: '#d79b74', shirt: '#c0392b', pants: '#2a1a1a', hair: '#111111', wide: 1.35, crown: true, spikes: true },
  boss_charge: { skin: '#9a5f3e', shirt: '#a0522d', pants: '#3a2015', hair: '#111111', wide: 1.25, crown: true, horns: true },
  boss_summon: { skin: '#e0b090', shirt: '#2d2d3a', pants: '#1a1a22', hair: '#111111', wide: 1.2, crown: true, shades: true, chain: true },
};

function capsuleGeo(r, h, seg = 8) {
  const pts = [];
  const N = 3;
  for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 + (i / N) * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * r), -h / 2 + Math.sin(a) * r)); }
  for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * r), h / 2 + Math.sin(a) * r)); }
  return new THREE.LatheGeometry(pts, seg);
}
const geoCache = {};
function segGeo(key, r, len) {
  const k = key + r.toFixed(3);
  if (!geoCache[k]) { const g = capsuleGeo(r, Math.max(0.01, len - r * 1.2), 8); g.translate(0, len / 2, 0); geoCache[k] = g; }
  return geoCache[k];
}
function buildRigGeometries() {
  GEO.rhead = new THREE.SphereGeometry(1, 12, 9);
  GEO.hair = new THREE.SphereGeometry(1.05, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.42);
  GEO.eye = new THREE.SphereGeometry(1, 5, 4);
  GEO.cap = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  GEO.band = new THREE.TorusGeometry(1, 0.12, 6, 20);
  // ----- 街頭打手的共用零件（全部是「單位大小」，用縮放調長短粗細，所有敵人共用同一批次） -----
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(Math.max(0.001, p[0]), p[1])), seg);
  GEO.tLimb = lathe([[0, -0.07], [0.55, -0.05], [0.9, 0], [1, 0.1], [0.86, 0.88], [0.76, 1], [0.45, 1.05], [0, 1.07]], 10);   // 上粗下細：上臂、大腿
  GEO.tLimbR = lathe([[0, -0.07], [0.45, -0.05], [0.72, 0], [0.8, 0.1], [1, 0.82], [0.94, 0.97], [0.55, 1.04], [0, 1.06]], 10); // 末端粗：前臂、褲管
  GEO.tChest = lathe([[0, -0.03], [0.6, 0], [0.74, 0.12], [0.8, 0.35], [0.97, 0.66], [1, 0.82], [0.82, 0.94], [0.42, 1], [0, 1.03]], 12);  // 倒三角胸膛
  GEO.tBelly = lathe([[0, -0.12], [0.6, -0.07], [0.93, 0.1], [1, 0.5], [0.9, 0.88], [0.6, 1.04], [0, 1.1]], 12);
  GEO.tHead = lathe([[0, -1], [0.4, -0.95], [0.7, -0.68], [0.9, -0.25], [1, 0.2], [0.93, 0.6], [0.66, 0.9], [0.3, 0.99], [0, 1]], 12); // 有下巴的頭型
  { // 拳頭：圓角方塊
    const g = new THREE.BoxGeometry(1.5, 1.3, 1.5, 3, 3, 3), a = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i); const n = v.clone().normalize().multiplyScalar(0.95); v.lerp(n, 0.55); a.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); GEO.tFist = g;
  }
  { // 球鞋：前後拉長的圓頂、鞋底削平，鞋跟在原點、鞋尖朝 +Z
    const g = new THREE.SphereGeometry(1, 10, 7), a = g.attributes.position;
    for (let i = 0; i < a.count; i++) a.setXYZ(i, a.getX(i) * 0.56, Math.max(-0.2, a.getY(i) * 0.5) + 0.2, a.getZ(i) * (a.getZ(i) > 0 ? 1.05 : 0.8) + 0.35);
    g.computeVertexNormals(); GEO.tShoe = g;
  }
  GEO.tMohawk = new THREE.TorusGeometry(0.86, 0.2, 5, 10, Math.PI).rotateY(Math.PI / 2);   // 龐克頭
}

// 身體零件：從關節到子關節的一段，[起點, 終點, 半徑, 材質]
const SEGMENTS = [
  ['LeftUpLeg', 'LeftLeg', 0.15, 'pants'], ['LeftLeg', 'LeftFoot', 0.12, 'shin'],
  ['RightUpLeg', 'RightLeg', 0.15, 'pants'], ['RightLeg', 'RightFoot', 0.12, 'shin'],
  ['LHipJoint', 'LeftUpLeg', 0.16, 'pants'], ['RHipJoint', 'RightUpLeg', 0.16, 'pants'],
  ['LowerBack', 'Spine', 0.27, 'shirt'], ['Spine', 'Spine1', 0.3, 'shirt'], ['Spine1', 'Neck', 0.29, 'shirt'],
  ['Neck', 'Neck1', 0.09, 'skin'], ['Neck1', 'Head', 0.09, 'skin'],
  ['LeftShoulder', 'LeftArm', 0.13, 'shirt'], ['RightShoulder', 'RightArm', 0.13, 'shirt'],
  ['LeftArm', 'LeftForeArm', 0.105, 'skin'], ['LeftForeArm', 'LeftHand', 0.09, 'skin'],
  ['RightArm', 'RightForeArm', 0.105, 'skin'], ['RightForeArm', 'RightHand', 0.09, 'skin'],
];
const offVec = i => new THREE.Vector3(SK.offsets[i][0], SK.offsets[i][1], SK.offsets[i][2]).multiplyScalar(UNIT);
const endVec = i => SK.ends[i] ? new THREE.Vector3(SK.ends[i][0], SK.ends[i][1], SK.ends[i][2]).multiplyScalar(UNIT) : new THREE.Vector3(0, 0.1, 0);

// 街頭打手：跟主角同一種粗壯卡通比例（倒三角上身、粗前臂、大拳頭、球鞋）
const SKIN_TONES = ['#f0c39a', '#e0ac85', '#c98d62', '#a86c48', '#8a5636'];
const HAIR_COLS = ['#16110e', '#2b1d14', '#4a2a14', '#6b4a22', '#8a8a92', '#b03a2e', '#d9c27a'];
const _hsl = { h: 0, s: 0, l: 0 };
function jitter(mt, dh, dl) { mt.color.getHSL(_hsl); mt.color.setHSL((_hsl.h + (Math.random() - 0.5) * dh + 1) % 1, _hsl.s, Math.min(0.95, Math.max(0.05, _hsl.l + (Math.random() - 0.5) * dl))); mt.userData.base.copy(mt.color); }
function buildThug(look, bones, mat, M, mGlove, wide, HR) {
  const sw = Math.sqrt(wide);
  const boss = !!look.crown, special = look.mushroom || look.gray;
  // 每一隻都有一點個體差異：膚色、髮色、衣褲深淺
  if (!special && !boss) {
    mat.skin.color.set(pick(SKIN_TONES)); mat.skin.userData.base.copy(mat.skin.color);
    mat.hair.color.set(pick(HAIR_COLS)); mat.hair.userData.base.copy(mat.hair.color);
    jitter(mat.shirt, 0.03, 0.1); jitter(mat.pants, 0.04, 0.1);
  }
  if (mGlove !== mat.skin && !look.glove) { mGlove.color.copy(mat.skin.color); mGlove.userData.base.copy(mat.skin.color); }
  const dark = M(look.gray ? '#4a4d55' : '#17110f'), sole = M(look.gray ? '#9a9da5' : '#efefef'), belt = M(look.gray ? '#4a4d55' : '#1c1a1e');
  const seg = (a, v, geo, r, mt, sz = 1, from = null) => {
    const len = v.length(), m = new THREE.Mesh(geo, mt);
    m.quaternion.setFromUnitVectors(UP, v.clone().normalize());
    m.scale.set(r, len, r * sz);
    if (from) m.position.copy(from);
    bones[JI[a]].add(m); return m;
  };
  const ball = (a, mt, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(GEO.unitSphere, mt); m.position.set(x, y, z); m.scale.set(sx, sy, sz); (typeof a === 'string' ? bones[JI[a]] : a).add(m); return m; };
  const box = (parent, mt, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(GEO.box, mt); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m; };
  // 腿：牛仔褲 ＋ 大球鞋
  for (const S of ['Left', 'Right']) {
    seg(S[0] + 'HipJoint', offVec(JI[S + 'UpLeg']), GEO.tLimb, 0.18 * sw, mat.pants);
    seg(S + 'UpLeg', offVec(JI[S + 'Leg']), GEO.tLimb, 0.2 * sw, mat.pants);
    seg(S + 'Leg', offVec(JI[S + 'Foot']), look.baggy ? GEO.tLimbR : GEO.tLimb, (look.baggy ? 0.17 : 0.15) * sw, mat.shin);
    const toe = offVec(JI[S + 'ToeBase']), L = toe.length() + 0.16;
    const shoe = new THREE.Mesh(GEO.tShoe, mat.shoe);
    shoe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toe.clone().normalize());
    shoe.scale.set(0.2, 0.2, L * 0.72); shoe.position.set(0, -0.06, 0);
    bones[JI[S + 'Foot']].add(shoe);
    const so = new THREE.Mesh(GEO.box, sole);
    so.quaternion.copy(shoe.quaternion); so.scale.set(0.2, 0.035, L * 0.95);
    so.position.copy(toe.clone().normalize().multiplyScalar(L * 0.3)).add(new THREE.Vector3(0, -0.075, 0));
    bones[JI[S + 'Foot']].add(so);
  }
  // 骨盆 ＋ 皮帶
  ball('Hips', mat.pants, 0, 0, 0, 0.31 * wide, 0.24, 0.26 * wide);
  const bt = new THREE.Mesh(GEO.band, belt); bt.rotation.x = Math.PI / 2; bt.scale.set(0.265 * wide, 0.215 * wide, 0.42); bt.position.y = 0.17; bones[JI.Hips].add(bt);
  // 上身：肚子 ＋ 倒三角胸膛（胖子肚子大、胸膛不收腰）
  const vS = offVec(JI.Spine), vS1 = offVec(JI.Spine1), vN = offVec(JI.Neck);
  seg('LowerBack', vS.clone().multiplyScalar(1.7), GEO.tBelly, (wide > 1.3 ? 0.36 : 0.255) * wide, mat.shirt, wide > 1.3 ? 0.95 : 0.78);
  seg('Spine1', vN.clone().normalize().multiplyScalar(vN.length() + vS1.length() * 1.5), GEO.tChest, 0.36 * wide, mat.shirt, 0.66, vS1.clone().multiplyScalar(-1.5));
  // 脖子、頭
  seg('Neck', offVec(JI.Neck1).add(offVec(JI.Head)), GEO.tLimb, 0.1 * sw, mat.skin);
  const hb = bones[JI.Head], top = endVec(JI.Head);
  const head = new THREE.Group();
  head.position.copy(top.clone().multiplyScalar(0.55));
  hb.add(head);
  const skull = new THREE.Mesh(GEO.tHead, mat.skin);
  skull.scale.set(HR * 0.97, HR * 1.1, HR * 1.0); skull.position.y = -0.02;
  head.add(skull);
  for (const sd of [-1, 1]) {
    ball(head, mat.skin, sd * HR * 0.93, -0.02, 0, 0.05, 0.085, 0.06);            // 耳朵
    ball(head, dark, sd * 0.115, 0.02, HR * 0.9, 0.048, 0.055, 0.03);              // 眼睛
    const brow = box(head, dark, sd * 0.115, 0.1, HR * 0.9, 0.14, 0.035, 0.04);    // 兇狠的眉毛
    brow.rotation.z = sd * 0.5;   // 內側往下壓：生氣的表情
  }
  ball(head, mat.skin, 0, -0.055, HR * 0.97, 0.045, 0.05, 0.05);                   // 鼻子
  box(head, dark, 0, -0.18, HR * 0.8, 0.13, 0.028, 0.05);                          // 嘴
  // 髮型：短髮、龐克頭、平頭、光頭隨機
  const style = special ? 'short' : pick(['short', 'short', 'mohawk', 'beanie', 'bald']);
  let hair;
  if (style === 'mohawk') { hair = new THREE.Mesh(GEO.tMohawk, mat.hair); hair.scale.set(HR * 0.8, HR * 1.42, HR * 1.12); hair.position.y = 0.02; }
  else if (style === 'beanie') { hair = new THREE.Mesh(GEO.cap, mat.shirt); hair.scale.set(HR * 1.08, HR * 1.3, HR * 1.1); hair.position.y = 0.04; }   // 毛帽（跟衣服同色）
  else { hair = new THREE.Mesh(GEO.hair, mat.hair); hair.scale.set(HR * 1.06, HR * 1.24, HR * 1.1); hair.rotation.x = -0.28; if (style === 'bald') hair.visible = false; }
  head.add(hair);
  // 手臂：圓肩、上臂（有袖子的穿衣服顏色）、粗前臂、大拳頭
  for (const S of ['Left', 'Right']) {
    seg(S + 'Shoulder', offVec(JI[S + 'Arm']), GEO.tLimb, 0.14 * sw, mat.shirt);
    ball(S + 'Arm', mat.shirt, 0, 0, 0, 0.165 * sw, 0.165 * sw, 0.165 * sw);
    seg(S + 'Arm', offVec(JI[S + 'ForeArm']), GEO.tLimb, 0.135 * sw, look.sleeve ? mat.shirt : mat.skin);
    seg(S + 'ForeArm', offVec(JI[S + 'Hand']), GEO.tLimbR, 0.125 * sw, mat.skin);
    const f = new THREE.Mesh(GEO.tFist, mGlove);
    f.scale.setScalar(0.125 * sw); f.position.copy(endVec(JI[S + 'Hand']).multiplyScalar(0.55));
    bones[JI[S + 'Hand']].add(f);
  }
  return { head, hair };
}

function createRig(look, opt = {}) {
  const root = new THREE.Group();     // 位置、朝向、縮放
  const lean = new THREE.Group();     // 受擊後仰、倒地翻滾
  root.add(lean);
  const mats = [];
  const M = c => { const m = lambert(c); m.userData.base = new THREE.Color(c); mats.push(m); return m; };
  const mat = {
    shirt: M(look.shirt), skin: M(look.skin), pants: M(look.pants), hair: M(look.hair), shoe: M(look.shoe || '#26262c'),
  };
  mat.shin = look.shin ? M(look.shin) : mat.pants;
  const mGlove = opt.gloveMat || M(look.glove || look.skin);
  const wide = (look.wide || 1) * (look.slim || 1);
  // 骨頭
  const bones = [];
  for (let i = 0; i < NJ; i++) {
    const b = new THREE.Object3D();
    if (i > 0) b.position.copy(offVec(i));
    bones.push(b);
    const p = SK.parents[i];
    (p >= 0 ? bones[p] : lean).add(b);
  }
  const HR = 0.33;
  let head, hair;
  if (opt.crowd) ({ head, hair } = buildThug(look, bones, mat, M, mGlove, wide, HR));
  else {
    const shadowSet = new Set(['Spine', 'Spine1', 'LeftUpLeg', 'RightUpLeg']);
    for (const [a, b, r, mk] of SEGMENTS) {
      const ia = JI[a], ib = JI[b];
      const v = offVec(ib);
      const len = v.length();
      const isTorso = mk === 'shirt' && (a === 'Spine' || a === 'Spine1' || a === 'LowerBack');
      const rr = 1.22 * r * (isTorso ? wide : (mk === 'pants' || a.includes('Arm') ? Math.sqrt(wide) : 1));
      const m = new THREE.Mesh(segGeo(a, rr, len), mat[mk]);
      m.quaternion.setFromUnitVectors(UP, v.clone().normalize());
      if (isTorso) m.scale.set(1, 1, 0.75);
      if (shadowSet.has(a)) m.castShadow = true;
      bones[ia].add(m);
    }
    // 骨盆
    const pelvis = new THREE.Mesh(GEO.unitSphere, mat.pants);
    pelvis.scale.set(0.3 * wide, 0.22, 0.24 * wide);
    bones[JI.Hips].add(pelvis);
    // 頭：在 Head 關節往頭頂方向
    const hb = bones[JI.Head];
    const top = endVec(JI.Head);
    head = new THREE.Group();
    head.position.copy(top.clone().multiplyScalar(0.55));
    hb.add(head);
    const skull = new THREE.Mesh(GEO.rhead, mat.skin);
    skull.scale.setScalar(HR);
    skull.castShadow = true;
    head.add(skull);
    hair = new THREE.Mesh(GEO.hair, mat.hair);
    hair.scale.setScalar(HR);
    hair.rotation.x = -0.35; // 往後梳
    head.add(hair);
    // 臉朝 +Z（骨架靜止姿勢的正面）
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#111' });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(GEO.eye, eyeMat);
      eye.scale.setScalar(0.045);
      eye.position.set(s * 0.1, 0.0, HR * 0.93);
      head.add(eye);
      const brow = new THREE.Mesh(GEO.box, eyeMat);
      brow.scale.set(0.12, 0.03, 0.03);
      brow.position.set(s * 0.1, 0.075, HR * 0.94);
      brow.rotation.z = -s * 0.4;
      head.add(brow);
    }
    // 拳頭、腳
    for (const n of ['LeftHand', 'RightHand']) {
      const f = new THREE.Mesh(GEO.unitSphere, mGlove);
      f.scale.setScalar(opt.bigFists ? 0.17 : 0.12);
      f.position.copy(endVec(JI[n]).multiplyScalar(0.5));
      f.castShadow = true;
      bones[JI[n]].add(f);
    }
    for (const n of ['LeftFoot', 'RightFoot']) {
      const toe = offVec(JI[n.replace('Foot', 'ToeBase')]);
      const f = new THREE.Mesh(GEO.box, mat.shoe);
      f.scale.set(0.15, 0.1, toe.length() + 0.12);
      f.position.copy(toe.clone().multiplyScalar(0.5));
      f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toe.clone().normalize());
      bones[JI[n]].add(f);
    }
  }
  // 配件
  const acc = (geo, m, parent, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); parent.add(o); return o; };
  const chest = bones[JI.Spine1];
  if (look.band) { const b = acc(GEO.band, M(look.band), head, 0, 0.05, 0, HR * 1.02, HR * 1.02, HR * 1.02); b.rotation.x = Math.PI / 2; }
  if (look.bomb) {
    acc(GEO.unitSphere, M('#1e1e24'), chest, 0, 0.1, -0.32, 0.22, 0.22, 0.22);
    root.userData.fuse = acc(GEO.unitSphere, new THREE.MeshBasicMaterial({ color: '#ffb020' }), chest, 0, 0.36, -0.36, 0.06, 0.06, 0.06);
  }
  if (look.horns) for (const s of [-1, 1]) { const h = acc(GEO.cone, M('#efe6d0'), head, s * 0.2, 0.25, 0.05, 0.05, 0.22, 0.05); h.rotation.z = -s * 0.6; }
  if (look.drum) { const d = acc(GEO.cyl, M('#e8eef8'), chest, 0, -0.15, 0.36, 0.2, 0.16, 0.2); d.rotation.x = Math.PI / 2; }
  if (look.mushroom) {
    hair.visible = false;
    acc(GEO.cap, M('#d63a3a'), head, 0, 0.08, 0, 0.45, 0.36, 0.45).castShadow = true;
    for (const [a, r] of [[0, 0.22], [1.6, 0.26], [3.1, 0.2], [4.5, 0.27], [2.3, 0.1]]) acc(GEO.unitSphere, M('#f5f0e0'), head, Math.cos(a) * r, 0.08 + 0.36 * Math.sqrt(Math.max(0, 1 - (r / 0.45) ** 2)), Math.sin(a) * r, 0.05, 0.035, 0.05);
  }
  if (look.bag) acc(GEO.unitSphere, M('#c9952a'), chest, 0, 0, -0.36, 0.22, 0.22, 0.22);
  if (look.crown) {
    const mc = lambert('#ffd84a', { emissive: 0x553300 });
    const ring = acc(new THREE.CylinderGeometry(1, 0.9, 1, 6, 1, true), mc, head, 0, HR * 0.95, 0, 0.2, 0.1, 0.2);
    ring.material.side = THREE.DoubleSide;
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; acc(GEO.cone, mc, head, Math.cos(a) * 0.18, HR * 0.95 + 0.11, Math.sin(a) * 0.18, 0.04, 0.12, 0.04); }
  }
  if (look.spikes) for (const n of ['LeftArm', 'RightArm']) {
    acc(GEO.unitSphere, M('#444'), bones[JI[n]], 0, 0.05, 0, 0.17, 0.12, 0.17);
    for (let i = 0; i < 3; i++) acc(GEO.cone, M('#ddd'), bones[JI[n]], (i - 1) * 0.08, 0.17, 0, 0.035, 0.12, 0.035);
  }
  if (look.shades) acc(GEO.box, M('#050505'), head, 0, 0.04, HR * 0.92, 0.32, 0.08, 0.04);
  if (look.chain) { const c = acc(GEO.band, lambert('#ffd84a', { emissive: 0x443300 }), chest, 0, 0.15, 0.12, 0.2, 0.2, 0.2); c.rotation.x = 1.2; }

  root.userData = { bones, lean, head, mats, anim: newAnim(), hairMesh: hair };
  if (opt.crowd) {
    // 群體角色：零件不自己畫，改由實例化批次一起畫（見 crowdAdd）
    const parts = [];
    root.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      parts.push(o);
      o.userData.batchKey = o.geometry.uuid + (o.material.isMeshBasicMaterial ? '|b' : '|l');
      o.userData.shadow = o.castShadow;
      o.visible = false;
    });
    root.userData.parts = parts;
    root.userData.crowd = true;
  }
  scene.add(root);
  return root;
}

// ---------- 實例化批次：大量敵人只用少數幾次繪製 ----------
const CROWD_CAP = 600;
const batches = new Map();
const batchWhiteL = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0, envMapIntensity: 0.25 });
const batchWhiteB = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const BURN = new THREE.Color('#ff7a30'), DARK = new THREE.Color('#2a2833'), FLASH = new THREE.Color('#ffffff');
function getBatch(o) {
  let b = batches.get(o.userData.batchKey);
  if (!b) {
    const basicMat = o.material.isMeshBasicMaterial;
    const m = new THREE.InstancedMesh(o.geometry, basicMat ? batchWhiteB : batchWhiteL, CROWD_CAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; // 敵人每個部位都投影
    m.receiveShadow = true; // 也接收建築與彼此的影子
    m.frustumCulled = false;
    // 注意：setColorAt 會依「目前的 count」配置顏色空間，所以要先用最大容量建立
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CROWD_CAP * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    scene.add(m);
    envMats = null;
    b = { mesh: m, n: 0 };
    batches.set(o.userData.batchKey, b);
  }
  return b;
}
// 接觸陰影：敵人腳下的柔和暗影（實例化，一次畫完）
let blobMesh = null, blobN = 0;
function blobBegin() {
  if (!blobMesh) {
    blobMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: softTex(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }), CROWD_CAP);
    blobMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); blobMesh.frustumCulled = false; blobMesh.renderOrder = -1; scene.add(blobMesh);
  }
  blobN = 0;
}
function blobAdd(x, z, r) {
  if (blobN >= CROWD_CAP) return;
  tmpM.makeScale(r, 1, r); tmpM.setPosition(x, 0.5, z); blobMesh.setMatrixAt(blobN++, tmpM);
}
function blobEnd() { if (blobMesh) { blobMesh.count = blobN; blobMesh.instanceMatrix.needsUpdate = true; } }
function crowdBegin() { for (const b of batches.values()) b.n = 0; }
// ---------- 靜態街景合併：同材質的物件併成一個，繪製次數大幅減少 ----------
function mergeStatic() {
  scene.updateMatrixWorld(true);
  const groups = new Map();
  scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.children.length || o.userData.dynamic) return;
    const g = o.geometry;
    if (!g.attributes.position || !g.attributes.normal || o.matrixWorld.determinant() < 0) return;
    const k = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '') + (g.attributes.uv ? 'u' : '') + o.renderOrder;
    (groups.get(k) || groups.set(k, []).get(k)).push(o);
  });
  let before = 0, after = 0;
  for (const list of groups.values()) {
    before += list.length; after++;
    if (list.length < 2) continue;
    const hasUv = !!list[0].geometry.attributes.uv, P = [], Nn = [], U = [];
    for (const o of list) {
      let g = o.geometry.clone(); if (g.index) g = g.toNonIndexed();
      g.applyMatrix4(o.matrixWorld);
      P.push(g.attributes.position.array); Nn.push(g.attributes.normal.array); if (hasUv) U.push(g.attributes.uv.array);
      o.parent.remove(o);
    }
    const cat = arrs => { let n = 0; for (const a of arrs) n += a.length; const out = new Float32Array(n); let k = 0; for (const a of arrs) { out.set(a, k); k += a.length; } return out; };
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(cat(P), 3));
    mg.setAttribute('normal', new THREE.BufferAttribute(cat(Nn), 3));
    if (hasUv) mg.setAttribute('uv', new THREE.BufferAttribute(cat(U), 2));
    const m = new THREE.Mesh(mg, list[0].material);
    m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow; m.renderOrder = list[0].renderOrder;
    scene.add(m);
  }
  R3D.mergeInfo = { before, after };
}

// ---------- 角色在建築影子裡要更暗 ----------
// 陰影貼圖只遮掉太陽直射光，天空環境光與反光照樣打在角色上，所以影子裡的人還是亮。
// 這裡朝太陽方向檢查角色有沒有被建築擋住，被擋住就把角色整體再壓暗（白天才作用）。
const occBoxes = [];
let shadeK = 1;                 // 完全在影子裡時的亮度倍率（每格依時段更新）
const _sRay = new THREE.Ray(), _sDir = new THREE.Vector3(), _sV = new THREE.Vector3();
function collectOccluders() {
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !o.castShadow) return;
    const bx = new THREE.Box3().setFromObject(o), sz = bx.getSize(_sV);
    if (sz.y > 60 && Math.min(sz.x, sz.z) > 25) occBoxes.push(bx); // 只算建築這種大塊頭
  });
}
// 回傳 0（完全被擋）～ 1（完全照到太陽）
function litAmount(x, z, hs) {
  _sDir.copy(dirLight.position).normalize();
  if (_sDir.y < 0.03) return 1;
  let lit = 0;
  for (const h of hs) {
    _sRay.origin.set(x, h, z); _sRay.direction.copy(_sDir);
    let hit = false;
    for (const b of occBoxes) if (_sRay.intersectsBox(b)) { hit = true; break; }
    if (!hit) lit++;
  }
  return lit / hs.length;
}
const HERO_SH = [12, 50, 92], ENEMY_SH = [14, 44];
let heroLit = 1, shadeDt = 1 / 60;
function shadeHero(dt) {
  if (!hero || !player) return;
  const target = litAmount(player.position.x, player.position.z, HERO_SH);
  heroLit += (target - heroLit) * Math.min(1, dt * 7);   // 進出影子平滑過渡
  const s = shadeK + (1 - shadeK) * heroLit;
  for (const m of hero.meshes) for (const mt of [].concat(m.material)) {
    if (!mt || !mt.color) continue;
    if (!mt.userData.c0) mt.userData.c0 = mt.color.clone();
    mt.color.copy(mt.userData.c0).multiplyScalar(s);
    // 日夜系統有管的材質每格會先重設，直接乘；沒管的用自己記的原始值
    if (envMats && envMats.includes(mt)) mt.envMapIntensity *= s;
    else { if (mt.userData.envH == null) mt.userData.envH = mt.envMapIntensity; mt.envMapIntensity = mt.userData.envH * s; }
  }
}
R3D.debugOcc = () => occBoxes.map(b => [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(Math.round));
R3D.debugEnemyLit = () => [...enemyMap.values()].map(g => [Math.round(g.matrixWorld.elements[12]), Math.round(g.matrixWorld.elements[14]), +(g.userData.lit || 0).toFixed(2)]);
R3D.debugHeroLit = () => ({ lit: +heroLit.toFixed(2), k: +shadeK.toFixed(2) });

function crowdAdd(g) {
  g.updateMatrixWorld(true);
  const t = g.userData.tint || {};
  const lt = litAmount(g.matrixWorld.elements[12], g.matrixWorld.elements[14], ENEMY_SH);
  const ud = g.userData; ud.lit = ud.lit == null ? lt : ud.lit + (lt - ud.lit) * Math.min(1, shadeDt * 7);
  const shade = shadeK + (1 - shadeK) * ud.lit;
  for (const o of g.userData.parts) {
    const b = getBatch(o);
    if (b.n >= CROWD_CAP) continue;
    b.mesh.setMatrixAt(b.n, o.matrixWorld);
    tmpColor.copy(o.material.userData.base || o.material.color);
    if (!o.material.isMeshBasicMaterial) {
      if (t.flash) tmpColor.lerp(FLASH, 0.6);   // 受擊閃白：偏白但還看得出是哪一種敵人
      else {
        if (t.frozen) tmpColor.lerp(ICE, 0.7);
        if (t.burn) tmpColor.lerp(BURN, 0.35 + Math.random() * 0.2);
      }
    } else if (o.material.color) tmpColor.copy(o.material.color);
    if (t.fade) tmpColor.lerp(DARK, t.fade);
    // 顏色是用螢幕色（sRGB）寫的，要先換成線性色再交給打光，不然深色會被洗成粉白
    if (!o.material.isMeshBasicMaterial) { tmpColor.convertSRGBToLinear(); if (!t.flash) tmpColor.multiplyScalar(shade); }
    b.mesh.setColorAt(b.n, tmpColor);
    b.n++;
  }
}
function crowdEnd() {
  for (const b of batches.values()) {
    b.mesh.count = b.n;
    b.mesh.instanceMatrix.needsUpdate = true;
    if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------- 動畫播放器（片段內插、交叉淡入） ----------
const CL = MC.clips;
const CLIPS_BY = {};
for (const k in CL) { const g = k.replace(/[RL]\d+$/, '').replace(/\d+$/, ''); const side = /R\d+$/.test(k) ? 'R' : (/L\d+$/.test(k) ? 'L' : ''); (CLIPS_BY[g + side] = CLIPS_BY[g + side] || []).push(k); }
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ---------- 主角的 Mixamo 動畫（js/hero_anims.js） ----------
const MXA = window.HERO_ANIMS || null;
const MXN = MXA ? MXA.bones.length : 0;
// 左右鏡像：把一個招式以身體中線對調，做出另一隻手（腳）的版本，招式數量加倍
// 做法：每格先算出各骨頭在骨架空間的旋轉 → 取相對 T 字站姿的變化量 → 左右翻轉後交給對側骨頭 → 換回各自父骨頭的座標
function mirrorMxClip(A, c) {
  const N = A.bones.length, par = A.parents;
  const qm = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qi = a => [-a[0], -a[1], -a[2], a[3]];
  const flip = a => [a[0], -a[1], -a[2], a[3]];
  const swap = n => n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n;
  const opp = A.bones.map(n => A.bones.indexOf(swap(n)));
  const restW = [];
  for (let j = 0; j < N; j++) restW[j] = par[j] < 0 ? A.restQuat[j].slice() : qm(restW[par[j]], A.restQuat[j]);
  const q = new Array(c.q.length), hips = c.hips.slice();
  const W = [], W2 = [];
  for (let i = 0; i < c.n; i++) {
    for (let j = 0; j < N; j++) { const o = (i * N + j) * 4, l = [c.q[o], c.q[o + 1], c.q[o + 2], c.q[o + 3]]; W[j] = par[j] < 0 ? l : qm(W[par[j]], l); }
    for (let j = 0; j < N; j++) { const m = opp[j]; W2[m] = qm(flip(qm(W[j], qi(restW[j]))), restW[m]); }
    for (let j = 0; j < N; j++) {
      const l = par[j] < 0 ? W2[j] : qm(qi(W2[par[j]]), W2[j]);
      const n = Math.hypot(l[0], l[1], l[2], l[3]) || 1, o = (i * N + j) * 4;
      for (let k = 0; k < 4; k++) q[o + k] = +(l[k] / n).toFixed(5);
    }
    hips[i * 3] = -hips[i * 3];
  }
  return { n: c.n, fps: c.fps, q, hips, impact: c.impact, limb: c.limb && swap(c.limb), limbVec: c.limbVec && [-c.limbVec[0], c.limbVec[1], c.limbVec[2]], hipsAtImpact: c.hipsAtImpact && [-c.hipsAtImpact[0], c.hipsAtImpact[1], c.hipsAtImpact[2]] };
}
if (MXA) {
  for (const k of Object.keys(MXA.clips)) if (MXA.clips[k].limb) MXA.clips[k + '_m'] = mirrorMxClip(MXA, MXA.clips[k]);
}
if (MXA) {
  for (const k in MXA.clips) {
    const c = MXA.clips[k];
    const h = c.hips, x0 = h[0], z0 = h[2];
    // 原地出招：水平位移只保留一點點，移動交給遊戲（衝刺）
    // 出拳原本就幾乎在原地：保留完整位移（步法才不會滑）；踢腿保留一半、飛踢保留三成
    const keep = /kick/.test(k) ? (/flying/.test(k) ? 0.3 : 0.5) : 1;
    for (let i = 0; i < c.n; i++) { h[i * 3] = (h[i * 3] - x0) * keep; h[i * 3 + 2] = (h[i * 3 + 2] - z0) * keep; }
    CL['mx:' + k] = { mx: true, n: c.n, fps: c.fps, q: c.q, root: h, impact: c.impact, limb: c.limb, limbVec: c.limbVec, hipsAtImpact: c.hipsAtImpact };
  }
}
const HERO_IDLE = CL['mx:fighting_idle'] ? 'mx:fighting_idle' : 'stance';
// 招式種類 → Mixamo 片段
// 每一招都有左右兩個版本（_m 是鏡像）；直拳多一組「前手刺拳／後手重拳」互換
const MXK = {
  straightL: ['punching', 'cross_punch_m'], straightR: ['cross_punch', 'punching_m'],
  hookR: ['hook_punch'], hookL: ['hook_punch_m'], upperL: ['uppercut'], upperR: ['uppercut_m'],
  roundR: ['roundhouse_kick'], roundL: ['roundhouse_kick_m'], sideR: ['side_kick'], sideL: ['side_kick_m'],
  frontR: ['side_kick'], frontL: ['side_kick_m'], flyL: ['flying_kick'], flyR: ['flying_kick_m'], fly: ['flying_kick', 'flying_kick_m'],
};
function mxMove(kind, s) {
  const list = (MXK[kind + s] || MXK[kind] || []).filter(k => CL['mx:' + k]);
  if (!list.length) return null;
  // 不連續兩次用同一個片段（有得選的時候）
  let k = pick(list);
  if (list.length > 1 && 'mx:' + k === mxMove.last) k = pick(list.filter(x => 'mx:' + x !== mxMove.last));
  return (mxMove.last = 'mx:' + k);
}

function newAnim() { return { cur: null, t: 0, speed: 1, loop: true, prev: null, pt: 0, pspeed: 1, ploop: true, fade: 0, fadeDur: 0.1, hold: false }; }
function play(a, name, o = {}) {
  if (!CL[name]) return;
  if (a.cur === name && !o.restart) { a.speed = o.speed ?? a.speed; return; }
  a.prev = a.cur; a.pt = a.t; a.pspeed = a.speed; a.ploop = a.loop;
  a.cur = name; a.t = o.t ?? 0; a.speed = o.speed ?? 1; a.loop = o.loop ?? true;
  a.fadeDur = o.fade ?? 0.12; a.fade = a.prev ? a.fadeDur : 0;
}
const QA = new Float32Array(NJ * 4), QB = new Float32Array(NJ * 4), RA = new Float32Array(3), RB = new Float32Array(3);
function sample(name, t, loop, outQ, outR) {
  const c = CL[name];
  const n = c.n;
  let f = t * c.fps;
  if (loop) { f %= n; if (f < 0) f += n; } else f = Math.min(Math.max(f, 0), n - 1);
  const i0 = Math.floor(f), i1 = loop ? (i0 + 1) % n : Math.min(i0 + 1, n - 1), w = f - i0;
  const q = c.q, r = c.root;
  for (let j = 0; j < NJ; j++) {
    const a = (i0 * NJ + j) * 4, b = (i1 * NJ + j) * 4;
    let s = (q[a] * q[b] + q[a + 1] * q[b + 1] + q[a + 2] * q[b + 2] + q[a + 3] * q[b + 3]) < 0 ? -1 : 1;
    for (let k = 0; k < 4; k++) outQ[j * 4 + k] = q[a + k] * (1 - w) + q[b + k] * w * s;
  }
  for (let k = 0; k < 3; k++) outR[k] = r[i0 * 3 + k] * (1 - w) + r[i1 * 3 + k] * w;
  if (loop) { outR[0] = r[i0 * 3] * (1 - w) + r[i1 * 3] * w; }
}
function clipLen(name) { const c = CL[name]; return c.n / c.fps; }
const QMA = new Float32Array(Math.max(1, MXN) * 4), QMB = new Float32Array(Math.max(1, MXN) * 4);
function sampleMx(name, t, loop, outQ, outR) {
  const c = CL[name], n = c.n;
  let f = t * c.fps;
  if (loop) { f %= n; if (f < 0) f += n; } else f = Math.min(Math.max(f, 0), n - 1);
  const i0 = Math.floor(f), i1 = loop ? (i0 + 1) % n : Math.min(i0 + 1, n - 1), w = f - i0;
  const q = c.q, r = c.root;
  for (let j = 0; j < MXN; j++) {
    const a = (i0 * MXN + j) * 4, b = (i1 * MXN + j) * 4;
    const s = (q[a] * q[b] + q[a + 1] * q[b + 1] + q[a + 2] * q[b + 2] + q[a + 3] * q[b + 3]) < 0 ? -1 : 1;
    for (let k = 0; k < 4; k++) outQ[j * 4 + k] = q[a + k] * (1 - w) + q[b + k] * w * s;
  }
  for (let k = 0; k < 3; k++) outR[k] = r[i0 * 3 + k] * (1 - w) + r[i1 * 3 + k] * w;
}
function stepMx(g, dt) {
  const a = g.userData.anim, rig = g.userData.mxRig;
  if (!a.hold) { a.t += dt * a.speed; if (a.prev) a.pt += dt * a.pspeed; }
  sampleMx(a.cur, a.t, a.loop, QMA, RA);
  if (a.prev && a.fade > 0 && CL[a.prev] && CL[a.prev].mx) {
    a.fade -= dt;
    const w = 1 - Math.max(0, a.fade) / a.fadeDur;
    sampleMx(a.prev, a.pt, a.ploop, QMB, RB);
    for (let j = 0; j < MXN; j++) {
      const o = j * 4;
      const s = (QMA[o] * QMB[o] + QMA[o + 1] * QMB[o + 1] + QMA[o + 2] * QMB[o + 2] + QMA[o + 3] * QMB[o + 3]) < 0 ? -1 : 1;
      for (let k = 0; k < 4; k++) QMA[o + k] = QMA[o + k] * w + QMB[o + k] * (1 - w) * s;
    }
    for (let k = 0; k < 3; k++) RA[k] = RA[k] * w + RB[k] * (1 - w);
    if (a.fade <= 0) a.prev = null;
  } else a.prev = null;
  // 檔案存的順序是 x, y, z, w（Three.js 四元數）
  for (let j = 0; j < MXN; j++) { const o = j * 4; rig.bones[j].quaternion.set(QMA[o], QMA[o + 1], QMA[o + 2], QMA[o + 3]).normalize(); }
  rig.bones[0].position.set(RA[0], RA[1], RA[2]);
}
function stepAnim(g, dt) {
  const a = g.userData.anim;
  if (!a.cur) return;
  if (CL[a.cur].mx) return stepMx(g, dt);
  if (!a.hold) { a.t += dt * a.speed; if (a.prev) a.pt += dt * a.pspeed; }
  sample(a.cur, a.t, a.loop, QA, RA);
  let w = 1;
  if (a.prev && a.fade > 0) {
    a.fade -= dt;
    w = 1 - Math.max(0, a.fade) / a.fadeDur;
    sample(a.prev, a.pt, a.ploop, QB, RB);
    for (let j = 0; j < NJ; j++) {
      const o = j * 4;
      const s = (QA[o] * QB[o] + QA[o + 1] * QB[o + 1] + QA[o + 2] * QB[o + 2] + QA[o + 3] * QB[o + 3]) < 0 ? -1 : 1;
      for (let k = 0; k < 4; k++) QA[o + k] = QA[o + k] * w + QB[o + k] * (1 - w) * s;
    }
    for (let k = 0; k < 3; k++) RA[k] = RA[k] * w + RB[k] * (1 - w);
    if (a.fade <= 0) a.prev = null;
  }
  const bones = g.userData.bones;
  for (let j = 0; j < NJ; j++) {
    const o = j * 4;
    bones[j].quaternion.set(QA[o + 1], QA[o + 2], QA[o + 3], QA[o]).normalize();
  }
  bones[0].position.set(RA[0] * UNIT, RA[1] * UNIT, RA[2] * UNIT);
}
function animDone(g) { const a = g.userData.anim; return !a.loop && a.t >= clipLen(a.cur); }

// 顏色與受擊閃光
function setRigLook(g, o) {
  for (const m of g.userData.mats) {
    if (o.frozen) m.color.copy(m.userData.base).lerp(ICE, 0.7);
    else m.color.copy(m.userData.base);
    if (o.flash) { m.emissive.setHex(0xffffff); m.emissiveIntensity = 1; }
    else if (o.burn) { m.emissive.setHex(0xff5a10); m.emissiveIntensity = 0.35 + Math.random() * 0.25; }
    else if (m.emissiveIntensity) { m.emissive.setHex(0); m.emissiveIntensity = 0; }
    if (o.opacity !== undefined) { m.transparent = o.opacity < 1; m.opacity = o.opacity; }
  }
}

// 敵人網格池
const enemyMap = new Map();
const enemyPool = {};
function getEnemyMesh(e) {
  let g = enemyMap.get(e);
  if (g) return g;
  const pool = enemyPool[e.type] || (enemyPool[e.type] = []);
  g = pool.pop();
  if (!g) {
    g = createRig(LOOKS[e.type] || LOOKS.grunt, { crowd: true });
    g.userData.type = e.type;
  }
  g.visible = true;
  const a = g.userData.anim;
  a.cur = null; a.prev = null; a.hold = false;
  play(a, 'walk', { t: Math.random() * clipLen('walk'), fade: 0 });
  g.userData.attackClip = null;
  g.userData.reacting = false; g.userData.attacking = false;
  g.userData.lastHitN = e.hitN || 0;
  enemyMap.set(e, g);
  return g;
}
function releaseEnemy(e, g) {
  g.visible = false;
  const u = g.userData;
  if (u.shieldMesh) u.shieldMesh.visible = false;
  if (u.warn) { u.warn.visible = false; u.warnStrip.visible = false; }
  if (u.slowRing) u.slowRing.visible = false;
  enemyMap.delete(e);
  enemyPool[u.type].push(g);
}

function updateEnemy(e, g, t, dt) {
  const r = e.r;
  const frozen = e.freezeT > 0;
  const S = r * RIG_SCALE;
  g.position.set(e.x, 0, e.y);
  g.rotation.y = -e.face;
  g.scale.setScalar(S);
  const u = g.userData;
  const a = u.anim;
  const hitK = e.squash > 0 ? e.squash / 0.12 : 0;
  const knocked = Math.hypot(e.vx, e.vy) > 60;
  const near = Math.hypot(e.x, e.y) < r + 24;
  const wind = e.state === 'wind';
  // 動作選擇
  a.hold = frozen;
  // 被打中：播放真人踉蹌（打斷攻擊）
  if ((e.hitN || 0) !== (u.lastHitN || 0)) {
    u.lastHitN = e.hitN || 0;
    if (!frozen && !e.T.boss && e.T.mass < 2) {
      u.reacting = true; u.attacking = false;
      play(a, Math.random() < 0.5 ? 'hit0' : 'hit1', { loop: false, speed: 1.5, fade: 0.04, restart: true });
    } else if (!frozen) {
      // 頭目與重型敵人：只短促地頓一下，不會被打斷攻擊
      u.reacting = true;
      play(a, 'hit1', { loop: false, speed: 2, fade: 0.05, restart: true, t: 0.1 });
    }
  }
  if (u.reacting && (animDone(g) || a.t > clipLen(a.cur) * 0.8)) u.reacting = false;
  if (e.lunge > 0 && !u.attacking && !u.reacting) {
    u.attacking = true;
    play(a, pick((CLIPS_BY.straightR || []).concat(CLIPS_BY.straightL || [], CLIPS_BY.hookR || [], CLIPS_BY.hookL || [])), { loop: false, speed: 1.6, fade: 0.06, t: 0.05 });
  }
  if (u.attacking && animDone(g)) u.attacking = false;
  if (!u.attacking && !u.reacting && !frozen) {
    if (e.state === 'dash') play(a, 'run', { speed: 2.2 });
    else if (near || knocked || e.stun > 0 || wind) play(a, 'idle', { speed: wind ? 0.3 : 1.1 });
    else if (e.type === 'runner' || e.type === 'goldie') play(a, 'run', { speed: (e.speed / 110) * 1.1 });
    else play(a, 'walk', { speed: Math.max(0.6, e.speed / 55) });
  }
  stepAnim(g, dt);
  // 受擊後仰（以腳為支點）
  u.lean.rotation.z = (u.reacting ? 0 : hitK * 0.3) - (wind ? 0.25 : 0);
  if (e.squash > 0) { const q = e.squash / 0.12; g.scale.set(S * (1 + 0.12 * q), S * (1 - 0.15 * q), S * (1 + 0.12 * q)); }
  u.tint = { frozen, burn: !!e.burn, flash: e.flash > 0 || (wind && Math.floor(t * 16) % 2 === 0) };
  if (u.fuse) u.fuse.material.color.set(Math.floor(t * 12) % 2 ? '#ffe14a' : '#ff5a1f');

  // 護盾
  if (e.shield > 0) {
    // 護盾：腳下的藍色光環（大批敵人時不會糊成一片）
    if (!u.shieldMesh) { u.shieldMesh = new THREE.Mesh(GEO.ring, basic('#5fa8ff', { opacity: 0.4 })); u.shieldMesh.rotation.x = -Math.PI / 2; scene.add(u.shieldMesh); }
    u.shieldMesh.visible = true;
    u.shieldMesh.position.set(e.x, 2, e.y);
    u.shieldMesh.scale.setScalar(r * 1.25);
  } else if (u.shieldMesh) u.shieldMesh.visible = false;
  // 減速圈
  if (e.slowT > 0 && !frozen) {
    if (!u.slowRing) { u.slowRing = new THREE.Mesh(GEO.ring, basic('#9be7ff', { opacity: 0.3 })); u.slowRing.rotation.x = -Math.PI / 2; scene.add(u.slowRing); }
    u.slowRing.visible = true;
    u.slowRing.position.set(e.x, 1.5, e.y);
    u.slowRing.scale.setScalar(r * 1.3);
  } else if (u.slowRing) u.slowRing.visible = false;
  // 頭目與蠻牛的預警
  const T = e.T;
  const chargeWarn = wind && (T.charge || T.boss === 'charge');
  const slamWarn = wind && T.boss === 'slam';
  if (chargeWarn || slamWarn) {
    if (!u.warn) {
      u.warn = new THREE.Mesh(GEO.disc, basic('#ff3c28', { opacity: 0.25 }));
      u.warn.rotation.x = -Math.PI / 2;
      u.warnStrip = new THREE.Mesh(GEO.box, basic('#ff3c28', { opacity: 0.3 }));
      scene.add(u.warn); scene.add(u.warnStrip);
    }
    if (slamWarn) {
      u.warn.visible = true; u.warnStrip.visible = false;
      u.warn.position.set(e.x, 1.2, e.y);
      u.warn.scale.setScalar(170 * Math.max(0.1, 1 - e.stateT));
    } else {
      u.warn.visible = false; u.warnStrip.visible = true;
      u.warnStrip.position.set(e.x + Math.cos(e.face) * 100, 1.2, e.y + Math.sin(e.face) * 100);
      u.warnStrip.rotation.set(0, -e.face, 0);
      u.warnStrip.scale.set(200, 0.5, r * 2);
    }
  } else if (u.warn) { u.warn.visible = false; u.warnStrip.visible = false; }
}

// 被打倒：沿著被打飛的軌跡，播放真人往後摔倒（或往前撲倒），最後躺在地上
const bodyMap = new Map();
const bodyPool = {};
const AX_X = new THREE.Vector3(1, 0, 0), AX_Z = new THREE.Vector3(0, 0, 1);
function updateBodies(bodies, dt) {
  const alive = new Set(bodies);
  for (const [b, g] of bodyMap) if (!alive.has(b)) { g.visible = false; bodyMap.delete(b); (bodyPool[g.userData.type] || (bodyPool[g.userData.type] = [])).push(g); }
  for (const b of bodies) {
    let g = bodyMap.get(b);
    if (!g) {
      const bp = bodyPool[b.type] || (bodyPool[b.type] = []);
      g = bp.pop() || createRig(LOOKS[b.type] || LOOKS.grunt, { crowd: true });
      g.userData.type = b.type;
      g.visible = true;
      bodyMap.set(b, g);
      const u = g.userData;
      u.dir = Math.atan2(b.vy, b.vx);
      const a = u.anim;
      a.cur = null; a.prev = null; a.hold = false;
      const fwd = Math.random() < 0.25;
      play(a, fwd ? 'fallF0' : 'fallB0', { loop: false, speed: 1.45, t: fwd ? 0.05 : 0.12, fade: 0 });
      // 片段的「摔出去方向」是 -X：轉到被打飛的方向
      u.yawOff = Math.PI;
      u.spin = Math.abs(b.vz) > 330 && Math.random() < 0.5 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      u.lean.rotation.set(0, 0, 0);
    }
    const u = g.userData;
    const S = b.r * RIG_SCALE;
    g.scale.setScalar(S);
    stepAnim(g, dt);
    g.rotation.set(0, -(u.dir - u.yawOff), 0);
    g.position.set(b.x, Math.max(0, b.z), b.y);
    // 打得特別重的會在空中多轉一圈
    if (u.spin && b.z > 1) u.lean.rotation.y += u.spin * dt * 12;
    // 消失前沉入地面並變暗（實例化無法個別透明）
    const fade = 1 - Math.min(1, b.life / 0.6);
    if (fade > 0) g.position.y -= fade * S * 0.8;
    u.tint = { fade: fade * 0.9 };
  }
}

// ---------- 主角：真人功夫招式 ----------
let player = null;
const qiFx = [];
function buildPlayer() {
  const gloveMat = lambert('#ff3b3b');
  gloveMat.userData.base = new THREE.Color('#ff3b3b');
  player = createRig({ skin: '#f1bd8a', shirt: '#f1bd8a', pants: '#e8453c', shin: '#f1bd8a', hair: '#2a1a10', shoe: '#f2f2f2' }, { gloveMat, bigFists: true });
  const u = player.userData;
  u.gloveMat = gloveMat;
  const bandMat = lambert('#e8453c');
  const band = new THREE.Mesh(GEO.band, bandMat);
  band.rotation.x = Math.PI / 2; band.position.y = 0.05; band.scale.setScalar(0.31);
  u.head.add(band);
  const tail = new THREE.Mesh(GEO.box, bandMat);
  tail.scale.set(0.05, 0.03, 0.3); tail.position.set(0.04, 0.05, -0.42);
  u.head.add(tail);
  u.tail = tail;
  player.scale.setScalar(PLAYER_R * RIG_SCALE);
  u.shield = new THREE.Mesh(GEO.unitSphere, basic('#7cc8ff', { opacity: 0.22 }));
  scene.add(u.shield);
  // 主角腳下的金色光環：大批敵人中也找得到主角
  u.marker = new THREE.Group();
  const mk1 = new THREE.Mesh(GEO.ring, basic('#ffd84a', { opacity: 0.9, blending: THREE.AdditiveBlending }));
  const mk2 = new THREE.Mesh(GEO.disc, basic('#ffb020', { opacity: 0.22, blending: THREE.AdditiveBlending }));
  for (const m of [mk1, mk2]) { m.rotation.x = -Math.PI / 2; u.marker.add(m); }
  mk1.position.y = 0.05; mk2.position.y = 0.045; // 群組會乘上角色大小，所以這裡用很小的值
  scene.add(u.marker);
  if (MXA) {
    const root = new THREE.Group();
    root.rotation.y = Math.PI / 2; // Mixamo 朝 +Z，遊戲的角色朝 +X
    const bones = MXA.bones.map((nm, i) => { const o = new THREE.Object3D(); o.name = nm; o.position.fromArray(MXA.restPos[i]); o.quaternion.fromArray(MXA.restQuat[i]); return o; });
    bones.forEach((o, i) => (MXA.parents[i] >= 0 ? bones[MXA.parents[i]] : root).add(o));
    const B = {}; bones.forEach(o => { B[o.name] = o; });
    const idx = n => MXA.bones.indexOf(n);
    const legMx = new THREE.Vector3().fromArray(MXA.restPos[idx('LeftLeg')]).length() + new THREE.Vector3().fromArray(MXA.restPos[idx('LeftFoot')]).length();
    const legP = offVec(JI.LeftLeg).length() + offVec(JI.LeftFoot).length();
    root.scale.setScalar(legP / legMx);
    u.lean.add(root);
    u.mxRig = { root, bones, B, scale: legP / legMx };
  }
  play(u.anim, HERO_IDLE, { fade: 0 });
  u.seen = new WeakSet();
  u.strikeLimb = JI.RightHand;
  u.faceYaw = Math.PI / 4; // 標題頁：從鏡頭看往右轉 45 度
  u.yaw = Math.PI / 4;
  u.count = 0;
}

// ---------- 主角 3D 模型（綁定好的 glb，每格用動作捕捉骨架重定向） ----------
// 動作捕捉骨架仍在背後播放動畫（隱藏不畫），模型的 Mixamo 骨架逐根對齊骨頭方向，
// 髖、胸、頭再對齊朝向；所以誇張化、架式、飛踢轉水平、命中拉伸都會自動套上。
let hero = null;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m1 = new THREE.Matrix4();
function loadHeroModel() {
  if (!window.MODELS || !MODELS.hero || !THREE.GLTFLoader) return;
  try {
    const bin = Uint8Array.from(atob(MODELS.hero), c => c.charCodeAt(0)).buffer;
    new THREE.GLTFLoader().parse(bin, '', g => setupHero(g.scene), e => console.error('主角模型載入失敗', e));
  } catch (e) { console.error('主角模型載入失敗', e); }
}
function basisQuat(a, b, out) {
  // 由兩個向量（a：側向或前方，b：上方）建立正交基底的旋轉
  const y = _v1.copy(b).normalize();
  const x = _v2.copy(a).addScaledVector(y, -a.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  _m1.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m1);
}
function isUnder(o, root) { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }
function setupHero(model) {
  const B = {}, meshes = [];
  model.traverse(o => {
    if (o.isBone) B[o.name.replace(/^mixamorig:?/, '')] = o;
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; meshes.push(o); if (o.material) o.material.envMapIntensity = 0.4; }
  });
  const need = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];
  const miss = need.filter(n => !B[n]);
  if (miss.length) { console.error('主角模型缺少骨頭：', miss); return; }
  model.updateMatrixWorld(true);
  const rest = {};
  for (const k in B) rest[k] = { lq: B[k].quaternion.clone(), wq: B[k].getWorldQuaternion(new THREE.Quaternion()), wp: B[k].getWorldPosition(new THREE.Vector3()) };
  // 腰帶下垂的兩條：加骨架並重新綁定（要在靜止姿勢、縮放前做）
  const sash = rigSash(model, B);
  // 手指骨頭不處理，維持模型原本的拳頭
  // 縮放：讓模型腿長和動作捕捉骨架一致
  const legM = rest.LeftUpLeg.wp.distanceTo(rest.LeftLeg.wp) + rest.LeftLeg.wp.distanceTo(rest.LeftFoot.wp);
  const legP = offVec(JI.LeftLeg).length() + offVec(JI.LeftFoot).length();
  const sc = legP / legM;
  const armQ = B.Hips.parent.getWorldQuaternion(new THREE.Quaternion());
  const armInv = new THREE.Matrix4().copy(B.Hips.parent.matrixWorld).invert();
  // 每根骨頭的固定修正：讓模型靜止時的骨頭方向，對齊動作捕捉骨架靜止時（T 字、朝 +Z）的方向。
  // 執行時：模型骨頭世界旋轉 = 動作捕捉骨頭世界旋轉 × 修正（扭轉也一起照搬，不會突然翻轉）
  const offs = {};
  for (const [tn, sn, srcDir, tc] of HERO_MAP) {
    const tgt = rest[tn];
    let fix = new THREE.Quaternion();
    if (srcDir && tc && rest[tc]) {
      const dS = srcDir().normalize();
      const dT = rest[tc].wp.clone().sub(tgt.wp).normalize();
      fix.setFromUnitVectors(dT, dS);
    }
    offs[tn] = fix.multiply(tgt.wq);
  }
  model.scale.setScalar(sc);
  player.userData.lean.add(model);
  // 隱藏原本的積木身體（骨架保留在背後播動畫）
  player.userData.lean.traverse(o => { if (o.isMesh && !isUnder(o, model)) o.visible = false; });
  // 元素拳的手部光暈
  const glows = ['LeftHand', 'RightHand'].map(n => {
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: '#ff8a3c', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.scale.setScalar(0.22); g.position.copy(B[n + 'Middle1'] ? B[n + 'Middle1'].position : new THREE.Vector3(0, 0.05, 0));
    g.visible = false; B[n].add(g); return g;
  });
  // Mixamo 來源骨架 → 模型的固定修正（都在世界座標量；靜止姿勢下對齊每根骨頭的方向）
  let offsMx = null;
  const mx = player.userData.mxRig;
  if (mx) {
    // 先把來源骨架放回靜止姿勢、暫時取消 90 度轉向（兩副骨架都朝 +Z）再量，量完再轉回去
    mx.bones.forEach((o, i) => { o.position.fromArray(MXA.restPos[i]); o.quaternion.fromArray(MXA.restQuat[i]); });
    mx.root.rotation.y = 0;
    player.updateMatrixWorld(true);
    offsMx = {};
    for (const [tn, tc] of MX_MAP) {
      const sb = mx.B[tn], tb = B[tn];
      if (!sb || !tb) continue;
      const sRW = sb.getWorldQuaternion(new THREE.Quaternion());
      const tRW = tb.getWorldQuaternion(new THREE.Quaternion());
      const fix = new THREE.Quaternion();
      if (tc && mx.B[tc] && B[tc]) {
        const dS = mx.B[tc].getWorldPosition(new THREE.Vector3()).sub(sb.getWorldPosition(new THREE.Vector3())).normalize();
        const dT = B[tc].getWorldPosition(new THREE.Vector3()).sub(tb.getWorldPosition(new THREE.Vector3())).normalize();
        fix.setFromUnitVectors(dT, dS);
      }
      offsMx[tn] = sRW.invert().multiply(fix).multiply(tRW);
    }
    mx.root.rotation.y = Math.PI / 2;
    player.updateMatrixWorld(true);
  }
  const ankle0 = rest.LeftFoot.wp.y * sc; // 靜止站立時腳踝離地高度（角色單位）
  const sole0 = { Foot: rest.LeftFoot.wp.y * sc, ToeBase: rest.LeftToeBase.wp.y * sc, Toe_End: rest.LeftToe_End ? rest.LeftToe_End.wp.y * sc : 0 };
  envMats = null;
  hero = { sash, ankle0, sole0, model, B, rest, offs, offsMx, armQ, armInv, meshes, glows, inv: new THREE.Matrix4(), W: {} };
}

// 模型骨頭 ← 動作捕捉骨頭；第三欄是動作捕捉骨架靜止時這根骨頭指向子骨頭的方向，第四欄是模型的子骨頭
const sOff = n => () => offVec(JI[n]);
const sEnd = n => () => endVec(JI[n]);
const HERO_MAP = [
  ['Hips', 'Hips', null, null],
  ['Spine', 'LowerBack', sOff('Spine'), 'Spine1'],
  ['Spine1', 'Spine', sOff('Spine1'), 'Spine2'],
  ['Spine2', 'Spine1', sOff('Neck1'), 'Neck'],
  ['Neck', 'Neck1', sOff('Head'), 'Head'],
  ['Head', 'Head', sEnd('Head'), 'HeadTop_End'],
  ['LeftShoulder', 'LeftShoulder', sOff('LeftArm'), 'LeftArm'],
  ['LeftArm', 'LeftArm', sOff('LeftForeArm'), 'LeftForeArm'],
  ['LeftForeArm', 'LeftForeArm', sOff('LeftHand'), 'LeftHand'],
  ['LeftHand', 'LeftHand', sOff('LeftHand'), 'LeftHandMiddle1'],
  ['RightShoulder', 'RightShoulder', sOff('RightArm'), 'RightArm'],
  ['RightArm', 'RightArm', sOff('RightForeArm'), 'RightForeArm'],
  ['RightForeArm', 'RightForeArm', sOff('RightHand'), 'RightHand'],
  ['RightHand', 'RightHand', sOff('RightHand'), 'RightHandMiddle1'],
  ['LeftUpLeg', 'LeftUpLeg', sOff('LeftLeg'), 'LeftLeg'],
  ['LeftLeg', 'LeftLeg', sOff('LeftFoot'), 'LeftFoot'],
  ['LeftFoot', 'LeftFoot', sOff('LeftToeBase'), 'LeftToeBase'],
  ['LeftToeBase', 'LeftToeBase', sEnd('LeftToeBase'), 'LeftToe_End'],
  ['RightUpLeg', 'RightUpLeg', sOff('RightLeg'), 'RightLeg'],
  ['RightLeg', 'RightLeg', sOff('RightFoot'), 'RightFoot'],
  ['RightFoot', 'RightFoot', sOff('RightToeBase'), 'RightToeBase'],
  ['RightToeBase', 'RightToeBase', sEnd('RightToeBase'), 'RightToe_End'],
];
// 腳步固定：來源的腳踩地時，把腳釘在踩下去那一刻的世界位置。
// 以下情況會逐漸放開（不瞬間跳）：抬腳、身體轉向超過約 20 度、主角移動太遠、動作要把腳放到離鎖定點太遠的地方。
const FOOT_LOCK = { Left: null, Right: null };
function footLock(h, side, src) {
  const S = PLAYER_R * RIG_SCALE;
  const ground = (h.ankle0 || 0.2) * S + S * 0.1; // 腳踝比靜止站立時高不到這麼多，就算踩地（ankle0 是角色單位，要乘上角色大小）
  const pp = player.position, yaw = player.rotation.y;
  let L = FOOT_LOCK[side];
  const contact = src.y < ground;
  if (L) {
    let dyaw = yaw - L.yaw; dyaw = Math.abs(Math.atan2(Math.sin(dyaw), Math.cos(dyaw)));
    const moved = Math.hypot(pp.x - L.px, pp.z - L.pz);
    const pull = Math.hypot(src.x - L.x, src.z - L.z);
    // 身體移動、轉向、或動作要把腳拉遠：立刻放開（不能讓腿被拉扯）
    if (dyaw > 0.6 || moved > S * 0.15 || pull > S * 0.8) { FOOT_LOCK[side] = L = null; }
    else {
      if (!contact) L.rel = true;             // 抬腳：漸漸放開
      L.w = L.rel ? Math.max(0, L.w - 0.34) : Math.min(1, L.w + 0.25);
      if (L.rel && L.w <= 0) { FOOT_LOCK[side] = L = null; }
    }
  }
  if (!L) {
    if (contact) FOOT_LOCK[side] = { x: src.x, z: src.z, px: pp.x, pz: pp.z, yaw, w: 0, rel: false };
    return src;
  }
  return new THREE.Vector3(src.x + (L.x - src.x) * L.w, src.y, src.z + (L.z - src.z) * L.w);
}
// 雙骨 IK（世界座標）：調整大腿、小腿，讓腳踝到達 target，腳掌世界方向不變
function legIK(h, side, target) {
  const U = h.B[side + 'UpLeg'], L = h.B[side + 'Leg'], F = h.B[side + 'Foot'];
  const H = U.getWorldPosition(new THREE.Vector3()), K = L.getWorldPosition(new THREE.Vector3()), A = F.getWorldPosition(new THREE.Vector3());
  const footW = F.getWorldQuaternion(new THREE.Quaternion());
  const l1 = H.distanceTo(K), l2 = K.distanceTo(A);
  const TH = target.clone().sub(H);
  const d = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, TH.length()));
  const u = TH.normalize();
  const perp = K.clone().sub(H); perp.addScaledVector(u, -perp.dot(u));
  if (perp.lengthSq() < 1e-10) return;
  perp.normalize();
  const ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const K2 = H.clone().addScaledVector(u, l1 * ca).addScaledVector(perp, l1 * Math.sqrt(Math.max(0, 1 - ca * ca)));
  const T2 = H.clone().addScaledVector(u, d);
  const rotTo = (bone, from, to) => {
    const q = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    const w = bone.getWorldQuaternion(new THREE.Quaternion());
    const pw = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(pw.invert().multiply(q.multiply(w)));
    bone.updateMatrixWorld(true);
  };
  rotTo(U, K.clone().sub(H), K2.clone().sub(H));
  const K3 = L.getWorldPosition(new THREE.Vector3()), A3 = F.getWorldPosition(new THREE.Vector3());
  rotTo(L, A3.sub(K3), T2.clone().sub(K3));
  const pw = F.parent.getWorldQuaternion(new THREE.Quaternion());
  F.quaternion.copy(pw.invert().multiply(footW));
}

// Mixamo → 模型：[骨頭, 子骨頭]（同名一對一）
const MX_MAP = [
  ['Hips', 'Spine'], ['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck'], ['Neck', 'Head'], ['Head', null],
  ['LeftShoulder', 'LeftArm'], ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['LeftHand', null],
  ['RightShoulder', 'RightArm'], ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'], ['RightHand', null],
  ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['LeftFoot', 'LeftToeBase'], ['LeftToeBase', null],
  ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'], ['RightFoot', 'RightToeBase'], ['RightToeBase', null],
];
// 每格重定向：從隱藏的動作捕捉骨架讀取每根骨頭的完整旋轉，乘上固定修正後套到模型
const _qm = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qp = new THREE.Quaternion();
function retargetHero(elements, hurt) {
  const h = hero;
  if (!h) return;
  const pb = player.userData.bones;
  player.updateMatrixWorld(true);
  h.model.getWorldQuaternion(_qm).invert();
  const W = h.W;
  const mx = player.userData.mxRig;
  if (mx && h.offsMx && CL[player.userData.anim.cur].mx) {
    for (const [tn] of MX_MAP) {
      const bone = h.B[tn];
      if (!bone || !h.offsMx[tn]) continue;
      mx.B[tn].getWorldQuaternion(_qs);
      const nw = (W[tn] || (W[tn] = new THREE.Quaternion())).copy(_qm).multiply(_qs).multiply(h.offsMx[tn]);
      const pn = bone.parent.name.replace(/^mixamorig:?/, '');
      _qp.copy(W[pn] || h.armQ).invert();
      bone.quaternion.copy(_qp.multiply(nw));
    }
    h.inv.copy(h.model.matrixWorld).invert();
    mx.B.Hips.getWorldPosition(_v1).applyMatrix4(h.inv);
    h.B.Hips.position.copy(_v1).applyMatrix4(h.armInv);
    h.model.updateMatrixWorld(true);
    bodyReact(h, hurt);
    straightenPunch(h);
    straightWrists(h);
    simSash(h);
    // 腳步固定只在備戰待機時做；出招時照動作本身的步法（素材已有正確的踩地）
    const an = player.userData.anim;
    if (!R3D.noIK && an.cur === HERO_IDLE && !an.prev) {
      for (const side of ['Left', 'Right']) legIK(h, side, footLock(h, side, mx.B[side + 'Foot'].getWorldPosition(new THREE.Vector3())));
    } else { FOOT_LOCK.Left = FOOT_LOCK.Right = null; }
    groundClamp(h);
    heroFx(h, elements, hurt);
    return;
  }
  for (const [tn, sn] of HERO_MAP) {
    const bone = h.B[tn];
    if (!bone) continue;
    pb[JI[sn]].getWorldQuaternion(_qs);
    const nw = (W[tn] || (W[tn] = new THREE.Quaternion())).copy(_qm).multiply(_qs).multiply(h.offs[tn]);
    const pn = bone.parent.name.replace(/^mixamorig:?/, '');
    _qp.copy(W[pn] || h.armQ).invert();
    bone.quaternion.copy(_qp.multiply(nw));
  }
  // 髖部位置
  h.inv.copy(h.model.matrixWorld).invert();
  pb[JI.Hips].getWorldPosition(_v1).applyMatrix4(h.inv);
  h.B.Hips.position.copy(_v1).applyMatrix4(h.armInv);
  // 腳的 IK：腳踝釘在動作捕捉骨架的腳踝位置，避免滑步
  h.model.updateMatrixWorld(true);
  for (const side of ['Left', 'Right']) legIK(h, side, pb[JI[side + 'Foot']].getWorldPosition(new THREE.Vector3()));
  heroFx(h, elements, hurt);
}
// 身體反應（疊加在動作上）：衝刺時上身順著移動方向前傾、急停時回彈；被打中時上身往後縮再彈回
const REACT = { px: 0, pz: 0, has: false, lx: 0, lz: 0, fl: 0, fv: 0, hurt: false };
const _rq = new THREE.Quaternion(), _rw = new THREE.Quaternion(), _rp = new THREE.Quaternion(), _ra = new THREE.Vector3();
function tiltWorld(bone, ax, az, ang) {
  // 以世界座標的水平軸（ax, 0, az）旋轉這根骨頭
  if (Math.abs(ang) < 1e-4) return;
  _rq.setFromAxisAngle(_ra.set(ax, 0, az).normalize(), ang);
  bone.getWorldQuaternion(_rw); bone.parent.getWorldQuaternion(_rp);
  bone.quaternion.copy(_rp.invert().multiply(_rq.multiply(_rw)));
  bone.updateMatrixWorld(true);
}
function bodyReact(h, hurt) {
  const R = REACT, dt = Math.min(0.05, Math.max(0, simDt || 0)), u = player.userData;
  const x = player.position.x, z = player.position.z;
  if (dt > 0) {
    // 衝刺前傾：目標傾斜量跟速度成正比，用彈簧追，停下來時會自然晃回來
    let vx = R.has ? (x - R.px) / dt : 0, vz = R.has ? (z - R.pz) / dt : 0;
    const sp = Math.hypot(vx, vz), k = Math.min(1, sp / 900) * 0.3 / (sp || 1);
    R.lx += (vx * k - R.lx) * Math.min(1, dt * 14); R.lz += (vz * k - R.lz) * Math.min(1, dt * 14);
    R.px = x; R.pz = z; R.has = true;
    // 受擊後縮：受傷的瞬間給一個衝量，彈簧帶回
    if (hurt && !R.hurt) R.fv += 13;
    R.hurt = !!hurt;
    R.fv += (-160 * R.fl - 15 * R.fv) * dt; R.fl += R.fv * dt;
  }
  const lean = Math.hypot(R.lx, R.lz);
  if (lean > 0.004 && !u.flight) {
    // 朝 (lx, lz) 方向傾：轉軸 = 上 × 方向
    tiltWorld(h.B.Spine, R.lz, -R.lx, lean * 0.6);
    tiltWorld(h.B.Spine1, R.lz, -R.lx, lean * 0.4);
  }
  if (Math.abs(R.fl) > 0.004) {
    const fx = Math.cos(u.yaw || 0), fz = Math.sin(u.yaw || 0);
    tiltWorld(h.B.Spine1, fz, -fx, -R.fl * 0.55);
    tiltWorld(h.B.Neck, fz, -fx, -R.fl * 0.45);
  }
}
R3D.debugReact = () => ({ lean: +Math.hypot(REACT.lx, REACT.lz).toFixed(3), flinch: +REACT.fl.toFixed(3) });
// 腳不穿地板：腳踝、腳掌、腳尖各自不能低於「靜止站立時的高度」；有低於的話，整個人往上抬
function groundClamp(h) {
  const S = PLAYER_R * RIG_SCALE;
  let lift = 0;
  for (const side of ['Left', 'Right']) for (const part of ['Foot', 'ToeBase', 'Toe_End']) {
    const b = h.B[side + part]; if (!b) continue;
    const y = b.getWorldPosition(_v1).y;
    lift = Math.max(lift, h.sole0[part] * S - y);
  }
  if (lift > 0.01) { player.position.y += lift; player.updateMatrixWorld(true); }
}
// 出拳打直：命中前後把出拳手臂的前臂轉到和上臂同一直線（直拳完全打直，勾拳、上勾拳打直一部分）
const STRAIGHT_K = { punching: 1, cross_punch: 1, hook_punch: 0.55, uppercut: 0.6 };
function straightenPunch(h) {
  const u = player.userData, a = u.anim;
  if (a.loop || typeof u.strikeLimb !== 'string' || !/Hand$/.test(u.strikeLimb)) return;
  const kk = STRAIGHT_K[(a.cur || '').replace('mx:', '').replace(/_m$/, '')];
  if (!kk) return;
  const dt = a.t - (u.impactClipT || 0);
  // 命中前 0.15 秒開始伸直、命中後維持打直 0.12 秒，再用 0.15 秒收回
  const w = dt < 0 ? Math.max(0, 1 + dt / 0.15) : (dt < 0.12 ? 1 : Math.max(0, 1 - (dt - 0.12) / 0.15));
  if (w <= 0) return;
  const side = u.strikeLimb.replace('Hand', '');
  const A = h.B[side + 'Arm'], F = h.B[side + 'ForeArm'], H = h.B[side + 'Hand'];
  const pa = A.getWorldPosition(new THREE.Vector3()), pf = F.getWorldPosition(new THREE.Vector3()), ph = H.getWorldPosition(new THREE.Vector3());
  const d1 = pf.clone().sub(pa).normalize(), d2 = ph.clone().sub(pf).normalize();
  const target = d2.clone().lerp(d1, w * w * (3 - 2 * w) * kk).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(d2, target);
  const fw = F.getWorldQuaternion(new THREE.Quaternion());
  const pw = F.parent.getWorldQuaternion(new THREE.Quaternion());
  F.quaternion.copy(pw.invert().multiply(q.multiply(fw)));
  F.updateMatrixWorld(true);
}
// ---------- 腰帶下垂帶子：骨架 ＋ 物理 ----------
// 在模型的靜止姿勢裡找出腰帶下方、身體前面的頂點，分成左右兩條，各建一串骨頭掛在髖部
const SASH_SEG = 4;
function rigSash(model, B) {
  let mesh = null; model.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (!mesh) return null;
  model.updateMatrixWorld(true);
  const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  // 腰帶高度：髖部骨頭附近；帶子在身體前面、腰帶以下、大腿中段以上
  const hipsW = B.Hips.getWorldPosition(new THREE.Vector3());
  const toW = new THREE.Matrix4().copy(mesh.matrixWorld);
  const v = new THREE.Vector3(), cand = [];
  const top = 0.555, bot = 0.33;
  // 1. 讀貼圖顏色，找紅色頂點
  const img = mesh.material.map && mesh.material.map.image;
  let red = null;
  if (img) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
    const cx2 = cv.getContext('2d'); cx2.drawImage(img, 0, 0, 512, 512);
    const px = cx2.getImageData(0, 0, 512, 512).data, uv = g.attributes.uv;
    red = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const u = ((uv.getX(i) % 1) + 1) % 1, w = ((uv.getY(i) % 1) + 1) % 1;
      const o = ((Math.floor(w * 511)) * 512 + Math.floor(u * 511)) * 4; // glTF 貼圖不翻轉
      red[i] = px[o] > 115 && px[o + 1] < 64 && px[o + 2] < 64 ? 1 : 0;
    }
  }
  // 2. 網格連通塊：只要「含有腰帶以下紅色頂點」的那幾塊
  const par = new Int32Array(pos.count).map((_, i) => i);
  const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const idx = g.index.array;
  for (let k = 0; k < idx.length; k += 3) { const a = find(idx[k]); par[find(idx[k + 1])] = a; par[find(idx[k + 2])] = a; }
  const good = new Set();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toW);
    if ((!red || red[i]) && v.y > bot && v.y < top - 0.005 && v.z > 0.03 && Math.abs(v.x) < 0.11) good.add(find(i));
  }
  for (let i = 0; i < pos.count; i++) {
    if (!good.has(find(i))) continue;
    v.fromBufferAttribute(pos, i).applyMatrix4(toW);
    if (v.y < bot - 0.01 || v.y > top + 0.01 || Math.abs(v.x) > 0.11 || v.z < 0.045) continue;
    cand.push([i, v.x, v.y, v.z]);
  }
  if (cand.length < 40) return null;
  // 分成左右兩條：以 x 中間的空隙分開
  const xs = cand.filter(c => c[2] < 0.45).map(c => c[1]).sort((a, b) => a - b);
  let gap = 0, split = xs[(xs.length / 2) | 0];
  for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k - 1] > gap && k > xs.length * 0.2 && k < xs.length * 0.8) { gap = xs[k] - xs[k - 1]; split = (xs[k] + xs[k - 1]) / 2; }
  const chains = [];
  const oldBones = mesh.skeleton.bones.slice();
  const newBones = [];
  for (const sideSel of [c => c[1] < split, c => c[1] >= split]) {
    const vs = cand.filter(sideSel);
    if (vs.length < 10) continue;
    const cx = vs.reduce((a, c) => a + c[1], 0) / vs.length;
    const yTop = Math.max(...vs.map(c => c[2])), yBot = Math.min(...vs.map(c => c[2]));
    const zAt = y => { let sz = 0, n = 0; for (const c of vs) if (Math.abs(c[2] - y) < 0.03) { sz += c[3]; n++; } return n ? sz / n : 0.07; };
    // 骨頭節點（世界座標，靜止姿勢）
    const pts = [];
    for (let k = 0; k <= SASH_SEG; k++) { const y = yTop - (yTop - yBot) * k / SASH_SEG; pts.push(new THREE.Vector3(cx, y, zAt(y))); }
    const bones = [];
    let parent = B.Hips;
    for (let k = 0; k < SASH_SEG; k++) {
      const b = new THREE.Bone(); b.name = 'Sash' + chains.length + '_' + k;
      parent.add(b); parent.updateMatrixWorld(true);
      b.position.copy(parent.worldToLocal(pts[k].clone()));
      b.updateMatrixWorld(true);
      bones.push(b); newBones.push(b); parent = b;
    }
    // 末端（不綁頂點，用來算最後一節方向）
    const tip = new THREE.Object3D(); parent.add(tip); tip.position.copy(parent.worldToLocal(pts[SASH_SEG].clone()));
    chains.push({ bones, tip, vs, pts: pts.map(p => p.clone()), yTop, yBot });
  }
  if (!chains.length) return null;
  // 新骨架：舊骨頭＋帶子骨頭，重新計算綁定
  const all = oldBones.concat(newBones);
  const skel = new THREE.Skeleton(all);
  model.updateMatrixWorld(true);
  skel.calculateInverses();
  const base = oldBones.length;
  // 重新分配帶子頂點的權重：依高度落在哪兩節之間漸變；最上面一段和髖部混合
  const hipsIdx = oldBones.indexOf(B.Hips);
  let bi = 0;
  for (const ch of chains) {
    const segH = (ch.yTop - ch.yBot) / SASH_SEG;
    for (const [i, , y] of ch.vs) {
      const f = Math.min(SASH_SEG - 0.001, Math.max(0, (ch.yTop - y) / segH));
      const k = Math.floor(f), t = f - k;
      const a = base + bi + k, b = base + bi + Math.min(SASH_SEG - 1, k + 1);
      let wa = 1 - t, wb = t, wh = 0;
      if (f < 0.6) { wh = (0.6 - f) / 0.6; wa *= 1 - wh; wb *= 1 - wh; }
      si.setXYZW(i, a, b, hipsIdx, 0); sw.setXYZW(i, wa, wb, wh, 0);
    }
    bi += SASH_SEG;
  }
  si.needsUpdate = true; sw.needsUpdate = true;
  mesh.bind(skel, mesh.bindMatrix);
  return { mesh, chains, state: null };
}
const _sv = new THREE.Vector3(), _sv2 = new THREE.Vector3(), _sq = new THREE.Quaternion();
function simSash(h) {
  const S = h.sash; if (!S) return;
  const dt = Math.min(1 / 30, Math.max(0, simDt));
  const sc = h.model.getWorldScale(new THREE.Vector3()).x;   // 模型→世界的大小
  const G = -1150;                                           // 重力（世界單位）：加重，垂得更沉
  h.model.updateMatrixWorld(true);
  // 大腿（碰撞用膠囊）
  const leg = side => [h.B[side + 'UpLeg'].getWorldPosition(new THREE.Vector3()), h.B[side + 'Leg'].getWorldPosition(new THREE.Vector3())];
  const legs = [leg('Left'), leg('Right')];
  const legR = 0.1 * sc;
  const hips = h.B.Hips.getWorldPosition(new THREE.Vector3());
  // 身體正前方：(左大腿 − 右大腿) × 上，取水平方向
  const fwd = legs[0][0].clone().sub(legs[1][0]).cross(new THREE.Vector3(0, 1, 0)); fwd.y = 0; fwd.normalize();
  for (const ch of S.chains) {
    const n = SASH_SEG + 1;
    // 骨頭依序 0..SASH_SEG-1，末端 tip
    const nodes = ch.bones.concat([ch.tip]);
    if (!ch.p) {   // 初始化：用目前骨頭位置
      ch.p = nodes.map(o => o.getWorldPosition(new THREE.Vector3()));
      ch.q = ch.p.map(v => v.clone());
      ch.len = []; for (let k = 0; k < n - 1; k++) ch.len.push(ch.p[k].distanceTo(ch.p[k + 1]));
    }
    // 第 0 點固定在腰帶上（跟著身體）；身體移動的位移有 65% 直接帶著整條走（布料有重量，不會被甩很遠）
    const root = ch.bones[0].getWorldPosition(_sv);
    _sv2.copy(root).sub(ch.p[0]).multiplyScalar(0.65);
    for (let k = 1; k < n; k++) { ch.p[k].add(_sv2); ch.q[k].add(_sv2); }
    ch.p[0].copy(root); ch.q[0].copy(ch.p[0]);
    if (dt > 0) {
      for (let k = 1; k < n; k++) {
        const p = ch.p[k], q = ch.q[k];
        _sv.copy(p).sub(q).multiplyScalar(0.82);          // 慣性＋阻尼（阻尼加大，擺動很快停下）
        q.copy(p); p.add(_sv); p.y += G * dt * dt;
      }
    }
    for (let it = 0; it < 4; it++) {
      for (let k = 0; k < n - 1; k++) {                   // 長度約束
        const a = ch.p[k], b = ch.p[k + 1];
        _sv.copy(b).sub(a); const d = _sv.length() || 1e-6, L = ch.len[k];
        if (k === 0) b.copy(a).addScaledVector(_sv, L / d);
        else { const c = (d - L) / d * 0.5; a.addScaledVector(_sv, c); b.addScaledVector(_sv, -c); }
      }
      for (let k = 1; k < n; k++) {
        const p = ch.p[k];
        for (const [A, Bk] of legs) {                     // 不穿過大腿
          _sv.copy(Bk).sub(A); const t = Math.max(0, Math.min(1, _sv2.copy(p).sub(A).dot(_sv) / _sv.lengthSq()));
          const c = A.clone().addScaledVector(_sv, t); _sv2.copy(p).sub(c); const d = _sv2.length();
          if (d < legR) p.copy(c).addScaledVector(_sv2.normalize(), legR);
        }
        // 不穿進身體：保持在髖部前方
        _sv.copy(p).sub(hips); const f = _sv.dot(fwd), minF = 0.075 * sc;
        if (f < minF) p.addScaledVector(fwd, minF - f);
      }
    }
    // 依模擬結果轉動骨頭：每節指向下一個點
    for (let k = 0; k < SASH_SEG; k++) {
      const b = ch.bones[k], child = nodes[k + 1];
      b.updateMatrixWorld(true);
      const cur = child.getWorldPosition(_sv).sub(b.getWorldPosition(_sv2)).normalize();
      const tgt = ch.p[k + 1].clone().sub(ch.p[k]).normalize();
      _sq.setFromUnitVectors(cur, tgt);
      const bw = b.getWorldQuaternion(new THREE.Quaternion()), pw = b.parent.getWorldQuaternion(new THREE.Quaternion());
      b.quaternion.copy(pw.invert().multiply(_sq.multiply(bw)));
      b.updateMatrixWorld(true);
    }
  }
}
let simDt = 0;
// 手腕全程打直：每一格把拳頭方向（手腕→中指根部）轉到和前臂同一直線，只轉最小角度、保留扭轉
function straightWrists(h) {
  for (const side of ['Left', 'Right']) {
    const F = h.B[side + 'ForeArm'], H = h.B[side + 'Hand'], M = h.B[side + 'HandMiddle1'];
    if (!F || !H || !M) continue;
    H.updateMatrixWorld(true);
    const pf = F.getWorldPosition(new THREE.Vector3()), ph = H.getWorldPosition(new THREE.Vector3()), pm = M.getWorldPosition(new THREE.Vector3());
    const fd = ph.clone().sub(pf).normalize(), hd = pm.clone().sub(ph).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(hd, fd);
    const hw = H.getWorldQuaternion(new THREE.Quaternion()), hp = H.parent.getWorldQuaternion(new THREE.Quaternion());
    H.quaternion.copy(hp.invert().multiply(q.multiply(hw)));
    H.updateMatrixWorld(true);
  }
}
function heroFx(h, elements, hurt) {
  // 元素光暈、受傷閃紅
  const sk = elements || {};
  const gc = sk.firePunch ? '#ff7a2a' : sk.thunderPunch ? '#ffe14a' : sk.icePunch ? '#7cd8ff' : null;
  for (const g of h.glows) { g.visible = !!gc; if (gc) { g.material.color.set(gc); g.material.opacity = 0.6 + Math.random() * 0.4; } }
  for (const m of h.meshes) if (m.material.emissive) { m.material.emissive.setHex(hurt ? 0xff2020 : 0); m.material.emissiveIntensity = hurt ? 0.6 : 0; }
}

// 挑招式：出拳（直拳／勾拳／上勾拳）或踢腿（飛踢／迴旋踢／側踢／前踢）；回傳 [片段名, 出招的肢體]
function wpick(list) { let t = 0; for (const [, w] of list) t += w; let r = Math.random() * t; for (const [v, w] of list) { r -= w; if (r <= 0) return v; } return list[0][0]; }
function clipFor(kind, s) { return CLIPS_BY[kind + s] || CLIPS_BY[kind + (s === 'R' ? 'L' : 'R')]; }
// 連續出拳時依套路一招接一招，最後以飛踢收尾；一套打完換下一套
const COMBOS = [
  ['straightL', 'straightR', 'hookL', 'upperR', 'roundR'],
  ['hookR', 'hookL', 'upperR', 'straightL', 'sideR'],
  ['straightR', 'upperL', 'hookR', 'frontL', 'roundL'],
  ['straightL', 'hookR', 'upperL', 'straightR', 'sideL'],
  ['upperR', 'hookL', 'straightR', 'hookL', 'roundR'],
];
function comboMove(u, now, finisher) {
  if (!u.combo || now - u.combo.last > 1.4) u.combo = { route: pick(COMBOS), step: 0, last: now };
  const c = u.combo;
  if (finisher) {
    // 收尾：飛踢，然後換下一套
    c.last = now;
    c.route = pick(COMBOS.filter(r => r !== c.route)); c.step = 0;
    const mf = mxMove('fly', '');
    if (mf) return [mf, CL[mf].limb, true];
    const name = pick(CLIPS_BY['fly' + (Math.random() < 0.5 ? 'R' : 'L')]);
    return [name, /L\d+$/.test(name) ? JI.LeftFoot : JI.RightFoot, true];
  }
  if (c.step >= c.route.length) { c.route = pick(COMBOS.filter(r => r !== c.route)); c.step = 0; }
  const key = c.route[c.step++];
  c.last = now;
  const kind = key.slice(0, -1), s = key.slice(-1);
  const mn = mxMove(kind, s);
  if (mn) return [mn, CL[mn].limb, false];
  const name = pick(clipFor(kind, s));
  const foot = ['fly', 'round', 'side', 'front'].includes(kind);
  const left = /L\d+$/.test(name);
  return [name, foot ? (left ? JI.LeftFoot : JI.RightFoot) : (left ? JI.LeftHand : JI.RightHand), false];
}
function chooseMove(side, kickChance) {
  const s = side > 0 ? 'R' : 'L';
  if (Math.random() < kickChance) {
    const kind = wpick([['fly', 0.35], ['round', 0.25], ['side', 0.2], ['front', 0.2]]);
    const name = pick(clipFor(kind, s));
    return [name, /L\d+$/.test(name) ? JI.LeftFoot : JI.RightFoot];
  }
  const kind = wpick([['straight', 0.4], ['hook', 0.3], ['upper', 0.3]]);
  const name = pick(clipFor(kind, s));
  return [name, /L\d+$/.test(name) ? JI.LeftHand : JI.RightHand];
}

const tmpW = new THREE.Vector3();
function limbObj(u) { return typeof u.strikeLimb === 'string' ? u.mxRig.B[u.strikeLimb] : u.bones[u.strikeLimb]; }
// 每一招在命中瞬間，出招肢體相對身體的角度（用隱藏的骨架預先算一次）
let probe = null;
const limbAngle = {};
function strikeOffset(name, limb) {
  const key = name + ':' + limb;
  if (limbAngle[key] !== undefined) return limbAngle[key];
  if (CL[name].mx) {
    // Mixamo：直接用轉檔時算好的命中瞬間肢體向量（朝 +Z）→ 轉成朝 +X、換算成角色單位
    const c = CL[name], sc = player.userData.mxRig.scale;
    const v = c.limbVec, hp = c.hipsAtImpact, r = c.root, ii = c.impact * 3;
    const vec = new THREE.Vector3(v[2], v[1], -v[0]).multiplyScalar(sc);
    // 命中瞬間髖部的水平位置（出拳保留了身體移動）
    const hips = new THREE.Vector3(r[ii + 2], hp[1], -r[ii]).multiplyScalar(sc);
    const tip = hips.clone().add(vec);
    limbAngle[key] = Math.atan2(tip.z, tip.x);
    limbReach[key] = Math.hypot(tip.x, tip.z);
    limbPose[key] = { hips, vec };
    return limbAngle[key];
  }
  if (!probe) { probe = createRig(GRAY_LOOK); probe.visible = false; }
  const c = CL[name];
  sample(name, c.impact / c.fps, false, QA, RA);
  for (let j = 0; j < NJ; j++) probe.userData.bones[j].quaternion.set(QA[j * 4 + 1], QA[j * 4 + 2], QA[j * 4 + 3], QA[j * 4]).normalize();
  probe.userData.bones[0].position.set(RA[0] * UNIT, RA[1] * UNIT, RA[2] * UNIT);
  probe.position.set(0, 0, 0); probe.rotation.set(0, 0, 0); probe.scale.setScalar(1);
  probe.updateMatrixWorld(true);
  probe.userData.bones[limb].getWorldPosition(tmpW);
  limbAngle[key] = Math.atan2(tmpW.z, tmpW.x);
  limbReach[key] = Math.hypot(tmpW.x, tmpW.z);
  const hips = new THREE.Vector3();
  probe.userData.bones[JI.Hips].getWorldPosition(hips);
  limbPose[key] = { hips, vec: tmpW.clone().sub(hips) };
  return limbAngle[key];
}
const limbPose = {};
const limbReach = {};
const QI = new THREE.Quaternion();
const smooth = x => x * x * (3 - 2 * x);
// 限制旋轉角度（避免整個人翻過頭）
function clampTilt(q, maxDeg) {
  const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI;
  return ang <= maxDeg ? q : new THREE.Quaternion().slerp(q, maxDeg / ang);
}
function updatePlayer(p, t, hurt, elements, dt, run) {
  simDt = dt;
  const S = PLAYER_R * RIG_SCALE;
  const u = player.userData;
  const a = u.anim;
  setRigLook(player, { flash: false });
  if (hurt) for (const m of u.mats) { m.emissive.setHex(0xff2020); m.emissiveIntensity = 0.6; }
  u.tail.rotation.x = Math.sin(t * 9) * 0.4;
  // 元素拳套顏色
  const gm = u.gloveMat;
  const sk = elements || {};
  if (sk.firePunch) { gm.color.set('#ff7a2a'); gm.emissive.set('#ff4400'); gm.emissiveIntensity = 0.5 + Math.random() * 0.3; }
  else if (sk.thunderPunch) { gm.color.set('#ffe14a'); gm.emissive.set('#ffd000'); gm.emissiveIntensity = Math.random() < 0.3 ? 0.9 : 0.3; }
  else if (sk.icePunch) { gm.color.set('#9be7ff'); gm.emissive.set('#3fb8ff'); gm.emissiveIntensity = 0.35; }
  else { gm.color.set('#ff3b3b'); gm.emissive.set('#000000'); gm.emissiveIntensity = 0; }

  // 新的一拳：換招式，讓「打中」的那一格對上遊戲判定的時間
  for (const pu of p.punches) {
    if (u.seen.has(pu)) continue;
    u.seen.add(pu);
    // 飛踢在空中時不被打斷：之後的拳照樣命中、照樣放拳勁，但身體把飛踢做完
    if (u.flight) { pu.inFlight = true; continue; }
    u.count++;
    const crit = run && run.comboPop > 0.1 && Math.random() < 0.15;
    const [name, limb, finisher] = comboMove(u, t, !!pu.finisher);
    u.finisher = finisher;
    const c = CL[name];
    const ti = c.impact / c.fps;
    const hitAt = pu.dur * (pu.hitFrac || 0.5);
    // Mixamo 動作較長：從命中前一小段開始播，速度接近原速（不再 3 倍速硬塞）
    const t0 = c.mx ? Math.max(0, ti - Math.max(0.12, hitAt) * 1.25) : ti * 0.45;
    const speed = Math.max(1, (ti - t0) / Math.max(0.05, hitAt));
    play(a, name, { loop: false, t: t0, speed, fade: c.mx ? 0.12 : (a.loop ? 0.06 : 0.1), restart: true });
    a.recover = speed;
    u.strikeLimb = limb;
    u.impactClipT = ti;
    u.faceYaw = Math.atan2(pu.ty - (p.y || 0), pu.tx - (p.x || 0)) - strikeOffset(name, limb);
    u.reach = limbReach[name + ':' + limb] * S; // 這招打到最遠時，拳腳離身體的水平距離
    if (!c.mx) u.yaw = u.faceYaw; // 舊動作：瞬間轉到位；Mixamo：交給下面平滑轉向
    u.pending = pu;
    u.pendingName = name;
    u.strikeT0 = t0;
    u.flight = null;
    if (/fly/.test(name)) {
      strikeOffset(name, limb);
      const lp = limbPose[name + ':' + limb];
      const ang = limbAngle[name + ':' + limb];
      const dir = new THREE.Vector3(Math.cos(ang), -0.08, Math.sin(ang)).normalize();
      const dist = 0;
      const reach = lp.vec.length() * S;
      u.flight = {
        name, t0, theta: 0,
        D: Math.max(0, Math.min(170, dist - reach * 0.9 - (pu.target && pu.target.r ? pu.target.r : 15))),
        H: CL[name].mx ? 0 : 26, // Mixamo 飛踢本身就有跳躍高度
        R: clampTilt(new THREE.Quaternion().setFromUnitVectors(lp.vec.clone().normalize(), dir), 85),
        pivot: lp.hips.clone(),
      };
    }
  }
  // 命中前持續追蹤目標（敵人還在移動）
  if (u.pending && !u.pending.impact) {
    u.faceYaw = Math.atan2(u.pending.ty - (p.y || 0), u.pending.tx - (p.x || 0)) - strikeOffset(u.pendingName, u.strikeLimb);
    if (!CL[u.pendingName].mx) u.yaw = u.faceYaw;
  }
  // 打中之後放慢收招；招式結束回到待機
  if (!a.loop && a.t > (u.impactClipT || 0)) a.speed = CL[a.cur].mx ? (/punching|cross/.test(a.cur) && a.t < u.impactClipT + 0.1 ? 0.35 : 1.2) : Math.max(1.1, (a.recover || 1) * 0.55);
  if (!a.loop && (animDone(player) || (CL[a.cur].mx && a.t > (u.impactClipT || 0) + 0.45))) play(a, HERO_IDLE, { fade: 0.25 });
  // 沒在打、站在中央閒著時，慢慢轉回面向鏡頭
  if (run && a.loop && !p.punches.length && !p.ret && (p.idleT || 0) > 1.2) {
    u.faceYaw = Math.PI / 2;
    let d0 = u.faceYaw - u.yaw; d0 = Math.atan2(Math.sin(d0), Math.cos(d0));
    u.yaw += d0 * Math.min(1, dt * 4);
  }
  if (!run && a.loop && hero) {
    const l = hero.B.LeftArm.getWorldPosition(new THREE.Vector3()), r = hero.B.RightArm.getWorldPosition(new THREE.Vector3());
    const f = l.sub(r).cross(new THREE.Vector3(0, 1, 0));
    let off = Math.atan2(f.z, f.x) - u.yaw; off = Math.atan2(Math.sin(off), Math.cos(off));
    u.chestOff = u.chestOff === undefined ? off : u.chestOff + (off - u.chestOff) * 0.05;
    u.faceYaw = (window.TITLE_FACE ?? Math.PI / 4) - u.chestOff;
  }
  // 面向目標（平滑轉向）
  let dy = u.faceYaw - (u.yaw ?? u.faceYaw);
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  u.yaw = (u.yaw ?? u.faceYaw) + dy * Math.min(1, dt * (CL[a.cur] && CL[a.cur].mx ? 32 : 25));
  player.rotation.y = -u.yaw;
  stepAnim(player, dt);
  // 出招軌跡：從起手到命中後一小段
  {
    const striking = !a.loop && a.t < (u.impactClipT || 0) + 0.12;
    player.updateMatrixWorld(true);
    limbObj(u).getWorldPosition(tmpW);
    const sk2 = elements || {};
    const tc = sk2.firePunch ? '#ff8a3c' : sk2.thunderPunch ? '#ffe14a' : sk2.icePunch ? '#9be7ff' : '#fff1c8';
    updateTrail(dt > 0 ? dt : 0, striking && dt > 0, tmpW, tc, S * 0.11);
  }
  // 拳勁：打中瞬間，從出招的手或腳射出一道氣勁到目標
  for (const pu of p.punches) {
    if (pu.impact && !pu.qi) {
      pu.qi = true;
      // 命中瞬間把動作對齊到「打到最遠」的那一格（配合命中停頓，看起來像拳腳定格）
      if (u.pending === pu && !a.loop && a.t < u.impactClipT) { a.t = u.impactClipT; a.prev = null; stepAnim(player, 0); }
      player.updateMatrixWorld(true);
      if (pu.inFlight) tmpW.copy(player.position).add(_v2.set(0, S * 1.3, 0)); // 飛踢中命中的拳：拳勁從胸口發出
      else limbObj(u).getWorldPosition(tmpW);
      const tx = pu.tx, tz = pu.ty, ty = pu.target && pu.target.r ? pu.target.r * RIG_SCALE * 1.4 : 30;
      // 測試用：記錄出招肢體方向與目標方向的角度差
      if (R3D.debugAngles && !pu.inFlight) {
        let d = Math.atan2(tmpW.z - player.position.z, tmpW.x - player.position.x) - Math.atan2(tz - player.position.z, tx - player.position.x);
        R3D.debugAngles.push(Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180 / Math.PI);
        if (!pu.extra) (R3D.debugReach = R3D.debugReach || []).push(Math.round(Math.hypot(tmpW.x - tx, tmpW.z - tz) - (pu.target && pu.target.r ? pu.target.r : 0)));
        (R3D.debugInfo = R3D.debugInfo || []).push([u.pendingName, Math.round(Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180 / Math.PI), u.anim.cur, +(u.anim.t - u.impactClipT).toFixed(3)]);
      }
      qiFx.push({ x1: tmpW.x, y1: tmpW.y, z1: tmpW.z, x2: tx, y2: ty, z2: tz, life: 0.07, max: 0.07 });
    }
  }
  // 飛踢：整個人沿弧線飛向敵人、身體轉成水平，命中後飛回中央
  {
    const f = u.flight;
    let w = 0, off = 0, h = 0;
    if (f && a.cur === f.name) {
      const ti = u.impactClipT;
      if (a.t < ti) {
        const pr = Math.min(1, Math.max(0, (a.t - f.t0) / Math.max(0.01, ti - f.t0)));
        w = smooth(pr); off = f.D * (1 - (1 - pr) * (1 - pr)); h = f.H * Math.sin(pr * Math.PI / 2);
      } else {
        const r = Math.min(1, (a.t - ti) / 0.45);
        w = 1 - smooth(Math.min(1, r * 1.4)); off = f.D * (1 - smooth(r)); h = f.H * (1 - r) * (1 - r);
        if (r >= 1) u.flight = null;
      }
    } else if (f) u.flight = null;
    if (!isFinite(off) || !isFinite(h)) { off = 0; h = 0; w = 0; u.flight = null; }
    // 站位微調：遊戲邏輯以固定距離站在敵人面前，這裡依這一招的實際攻擊距離前後調整
    let cx = 0, cz = 0;
    const pu0 = u.pending;
    if (pu0 && !a.loop) {
      const gx = (p.x || 0), gz = (p.y || 0);
      const ddx = pu0.tx - gx, ddz = pu0.ty - gz, dd = Math.hypot(ddx, ddz) || 1;
      const stand = (pu0.target && pu0.target.r ? pu0.target.r : 15) + PLAYER_R + 6;
      const k = a.t < u.impactClipT ? smooth(Math.min(1, Math.max(0, (a.t - (u.strikeT0 || 0)) / Math.max(0.01, u.impactClipT - (u.strikeT0 || 0)))))
        : Math.max(0, 1 - (a.t - u.impactClipT) / 0.35);
      const tr = pu0.target && pu0.target.r ? pu0.target.r : 15;
      const adj = Math.max(-40, Math.min(40, stand - ((u.reach || stand) + tr * 1.0))) * k; // 拳腳落在敵人身體表面
      cx = ddx / dd * adj; cz = ddz / dd * adj;
    }
    player.position.set((p.x || 0) + cx, h, (p.y || 0) + cz);
    if (w > 0) {
      u.lean.quaternion.copy(QI).slerp(f.R, w);
      u.lean.position.copy(f.pivot).sub(f.pivot.clone().applyQuaternion(u.lean.quaternion));
    } else { u.lean.quaternion.copy(QI); u.lean.position.set(0, 0, 0); }
  }
  // 卡通式拉伸：起手時微微壓縮，命中瞬間沿出招方向拉長
  {
    const k = !a.loop ? (a.t - (u.impactClipT || 0)) : 9;
    let sx = 1, sy = 1;
    if (k > -0.12 && k < 0) { const q = 1 + k / 0.12; sx = 1 - 0.06 * q; sy = 1 + 0.05 * q; }
    else if (k >= 0 && k < 0.14) { const q = 1 - k / 0.14; sx = 1 + (u.finisher ? 0.28 : 0.18) * q; sy = 1 - 0.1 * q; }
    u.lean.scale.set(sx, sy, 1 / Math.sqrt(sx * sy));
  }
  // 閒置一秒後跳回中央：真人雙腳往前跳（蹲下蓄力 → 起跳 → 屈膝落地），動畫進度由跳回的進度驅動
  if (p.ret) {
    const k = Math.min(1, Math.max(0, p.ret.t) / p.ret.dur);
    if (u.retRef !== p.ret) {
      u.retRef = p.ret;
      u.retClip = 'jumpF0';
      play(a, u.retClip, { loop: false, fade: 0.08, restart: true });
    }
    u.flight = null;
    a.t = k * clipLen(u.retClip) * 0.999;
    a.speed = 0;
    stepAnim(player, 0);
    u.yaw = p.facing; u.faceYaw = p.facing;
    player.rotation.y = -p.facing;
    u.lean.quaternion.copy(QI); u.lean.position.set(0, 0, 0); u.lean.scale.set(1, 1, 1);
  } else if (u.retRef) {
    u.retRef = null;
    play(a, HERO_IDLE, { fade: 0.15 });
  }
  retargetHero(elements, hurt);
  u.marker.position.set(player.position.x, 0, player.position.z);
  u.marker.scale.setScalar(S * (1.05 + Math.sin(t * 5) * 0.06));
  u.marker.visible = false; // 使用者要求：主角腳下不要有圓圈
  u.shield.visible = false; // 使用者要求：不要白色透明球（護盾效果仍在，擋下時有光圈）
  u.shield.position.set(player.position.x, S * 1.2, player.position.z);
  u.shield.scale.setScalar(S * 1.5);
}

// 出招軌跡：記錄拳頭或腳的路徑，畫成會淡出的光帶
// 出招殘影：以主角為基準記錄拳頭／腳的路徑（衝刺不會把軌跡拉長），曲線補點，畫成柔邊細光痕
const TRAIL_PTS = 24, TRAIL_SUB = 4, TRAIL_MAX = TRAIL_PTS * TRAIL_SUB, TRAIL_LIFE = 0.1;
const trailPts = [];
let trailMesh = null;
function buildTrail() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const uv = new Float32Array(TRAIL_MAX * 2 * 2);
  for (let i = 0; i < TRAIL_MAX; i++) uv.set([0, 0, 0, 1], i * 4);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const idx = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setIndex(idx);
  // 寬度方向的柔邊：中間亮、兩側淡出
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 4, 64);
  trailMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  trailMesh.frustumCulled = false;
  scene.add(trailMesh);
}
const tcol = new THREE.Color();
const _crA = new THREE.Vector3(), _crB = new THREE.Vector3();
function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t;
  for (const k of ['x', 'y', 'z']) out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  return out;
}
function updateTrail(rdt, active, pos, color, width) {
  if (!trailMesh) buildTrail();
  const base = player.position;
  for (const p of trailPts) p.age += rdt;
  while (trailPts.length && trailPts[0].age > TRAIL_LIFE) trailPts.shift();
  if (active) {
    // 以主角位置為基準記錄（只保留拳頭相對身體的揮動）
    trailPts.push({ x: pos.x - base.x, y: pos.y - base.y, z: pos.z - base.z, age: 0 });
    if (trailPts.length > TRAIL_PTS) trailPts.shift();
  }
  const g = trailMesh.geometry, P = g.attributes.position.array, C = g.attributes.color.array;
  const n0 = trailPts.length;
  if (n0 < 2) { g.setDrawRange(0, 0); return; }
  // 曲線補點
  const pts = [];
  for (let i = 0; i < n0 - 1; i++) {
    const p0 = trailPts[Math.max(0, i - 1)], p1 = trailPts[i], p2 = trailPts[i + 1], p3 = trailPts[Math.min(n0 - 1, i + 2)];
    for (let k = 0; k < TRAIL_SUB; k++) {
      const t = k / TRAIL_SUB, o = catmull(p0, p1, p2, p3, t, {});
      o.age = p1.age + (p2.age - p1.age) * t; pts.push(o);
    }
  }
  const last = trailPts[n0 - 1]; pts.push({ x: last.x, y: last.y, z: last.z, age: last.age });
  const n = Math.min(TRAIL_MAX, pts.length);
  tcol.set(color);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, n - 1)], o = pts[Math.max(i - 1, 0)];
    const wx = p.x + base.x, wy = p.y + base.y, wz = p.z + base.z;
    const dx = q.x - o.x, dy = q.y - o.y, dz = q.z - o.z;
    const cx = camera.position.x - wx, cy = camera.position.y - wy, cz = camera.position.z - wz;
    let sx = dy * cz - dz * cy, sy = dz * cx - dx * cz, sz = dx * cy - dy * cx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    const life = Math.max(0, 1 - p.age / TRAIL_LIFE);
    const along = i / Math.max(1, n - 1);              // 0＝尾巴、1＝拳頭
    const w = width * Math.sin(Math.PI * Math.min(1, along * 1.15)) * (0.4 + 0.6 * life);
    sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
    P.set([wx + sx, wy + sy, wz + sz, wx - sx, wy - sy, wz - sz], i * 6);
    const b = 0.55 * life * along * along;              // 越靠尾巴越淡
    C.set([tcol.r * b, tcol.g * b, tcol.b * b, tcol.r * b, tcol.g * b, tcol.b * b], i * 6);
  }
  g.setDrawRange(0, Math.max(0, n - 1) * 6);
  g.attributes.position.needsUpdate = true;
  g.attributes.color.needsUpdate = true;
}

// 拳勁特效
let qiTex = null;
const mkQi = () => {
  if (!qiTex) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 32;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 128, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, 14); g.lineTo(110, 2); g.lineTo(128, 16); g.lineTo(110, 30); g.lineTo(0, 18); g.fill();
    qiTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: qiTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  scene.add(m);
  return m;
};
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
function syncQi(dt, color) {
  for (const f of qiFx) f.life -= dt;
  for (let i = qiFx.length - 1; i >= 0; i--) if (qiFx[i].life <= 0) qiFx.splice(i, 1);
  for (const f of qiFx) {
    const a = f.life / f.max;
    for (const w of [1, 0.45]) {
      const m = take('qi', mkQi);
      tmpA.set(f.x1, f.y1, f.z1); tmpB.set(f.x2, f.y2, f.z2);
      const len = tmpA.distanceTo(tmpB);
      m.position.copy(tmpA).lerp(tmpB, 0.5);
      // 面向鏡頭的長條
      m.lookAt(camera.position);
      const dir = tmpB.clone().sub(tmpA).normalize();
      const right = new THREE.Vector3().subVectors(camera.position, m.position).normalize().cross(dir).normalize();
      const up = new THREE.Vector3().crossVectors(dir, right);
      const mtx = new THREE.Matrix4().makeBasis(dir, up, right);
      m.quaternion.setFromRotationMatrix(mtx);
      m.scale.set(len, (w === 1 ? 9 : 4) * (0.6 + a * 0.6), 1);
      m.material.color.set(w === 1 ? color : '#ffffff');
      m.material.opacity = a * 0.45;
    }
  }
}

// ---------- 特效、投射物、掉落物 ----------
let rangeRing, points, pointPos, pointCol;
const MAX_POINTS = 700;
let orbXp, orbGold;
const pools = {};
function pool(name, make) {
  const p = pools[name] || (pools[name] = { items: [], used: 0, make });
  return p;
}
function take(name, make) {
  const p = pool(name, make);
  let m = p.items[p.used];
  if (!m) { m = make(); p.items.push(m); }
  p.used++;
  m.visible = true;
  return m;
}
function beginPools() { for (const k in pools) pools[k].used = 0; }
function endPools() { for (const k in pools) { const p = pools[k]; for (let i = p.used; i < p.items.length; i++) p.items[i].visible = false; } }

function buildFx() {
  rangeRing = new THREE.Mesh(GEO.ringThin, basic('#ffd84a', { opacity: 0.4 }));
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.position.y = 0.8;
  scene.add(rangeRing);
  const geo = new THREE.BufferGeometry();
  pointPos = new Float32Array(MAX_POINTS * 3);
  pointCol = new Float32Array(MAX_POINTS * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pointPos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(pointCol, 3).setUsage(THREE.DynamicDrawUsage));
  points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 11, map: softTex(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }));
  points.frustumCulled = false;
  scene.add(points);
  orbXp = new THREE.InstancedMesh(GEO.unitSphere, new THREE.MeshBasicMaterial({ color: '#5ef2a0' }), 400);
  orbGold = new THREE.InstancedMesh(GEO.unitSphere, new THREE.MeshBasicMaterial({ color: '#ffd84a' }), 200);
  orbXp.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  orbGold.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  orbXp.frustumCulled = orbGold.frustumCulled = false;
  scene.add(orbXp); scene.add(orbGold);
}

let starTex = null;
function getStarTex() {
  if (starTex) return starTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  // 柔光底 + 長短交錯的尖刺 + 亮核心
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)'); glow.addColorStop(0.3, 'rgba(255,255,255,0.25)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 128, 128);
  g.fillStyle = grad;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6 + (i % 2) * 0.12, len = i % 3 === 0 ? 63 : (i % 2 ? 34 : 48), wd = i % 3 === 0 ? 0.09 : 0.13;
    g.beginPath();
    g.moveTo(64 + Math.cos(a - wd) * 8, 64 + Math.sin(a - wd) * 8);
    g.lineTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len);
    g.lineTo(64 + Math.cos(a + wd) * 8, 64 + Math.sin(a + wd) * 8);
    g.closePath(); g.fill();
  }
  g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 10, 0, Math.PI * 2); g.fill();
  starTex = new THREE.CanvasTexture(c);
  return starTex;
}
const mkImpact = () => {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: getStarTex(), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  scene.add(m);
  return m;
};
let shockTex = null;
const mkShock = () => {
  if (!shockTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = '#ffffff'; g.lineWidth = 10;
    g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.stroke();
    shockTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: shockTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  scene.add(m);
  return m;
};
let flashTex = null;
const softTex = () => {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  flashTex = new THREE.CanvasTexture(c);
  return flashTex;
};
const mkFlash = () => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })); scene.add(m); return m; };
const mkSmoke = () => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: '#9a8f86', transparent: true, depthWrite: false })); scene.add(m); return m; };
const mkSline = () => { const m = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(m); return m; };
const mkDring = () => { const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); scene.add(m); return m; };
const mkShard = () => { const m = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(m); return m; };
let crackTex = null;
const mkCrack = () => {
  if (!crackTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.35, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(10,8,8,0.9)'; g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      let a = i / 9 * Math.PI * 2 + Math.random() * 0.4, x = 128, y = 128, w = 6;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { a += (Math.random() - 0.5) * 0.8; const l = 12 + Math.random() * 14; x += Math.cos(a) * l; y += Math.sin(a) * l; g.lineWidth = w; g.lineTo(x, y); w *= 0.75; }
      g.stroke();
    }
    crackTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false }));
  scene.add(m);
  return m;
};
const mkSpike = () => {
  const m = new THREE.Mesh(GEO.cone, lambert('#bfefff', { emissive: 0x2a6f8f, transparent: true }));
  m.castShadow = true;
  scene.add(m);
  return m;
};
const mkRing = () => { const m = new THREE.Mesh(GEO.ring, basic('#fff')); m.rotation.x = -Math.PI / 2; scene.add(m); return m; };
const mkDisc = () => { const m = new THREE.Mesh(GEO.disc, basic('#fff')); m.rotation.x = -Math.PI / 2; scene.add(m); return m; };
const mkLine = () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true }));
  l.frustumCulled = false;
  scene.add(l);
  return l;
};
const mkBolt = () => {
  // 閃電：用細長方塊串起來，比線條更明顯
  const grp = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#dff0ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    grp.add(s);
  }
  scene.add(grp);
  return grp;
};
const mkRocket = () => {
  const g = new THREE.Group();
  const fist = new THREE.Mesh(GEO.unitSphere, lambert('#ff4d4d', { emissive: 0x400000 }));
  fist.scale.set(15, 11, 11);
  const flame = new THREE.Mesh(GEO.cone, new THREE.MeshBasicMaterial({ color: '#ffb040' }));
  flame.scale.set(7, 22, 7); flame.rotation.z = Math.PI / 2; flame.position.x = -20;
  g.add(fist); g.add(flame);
  scene.add(g);
  return g;
};
const mkBottle = () => { const m = new THREE.Mesh(GEO.cyl, lambert('#7a5530')); m.scale.set(3.5, 14, 3.5); m.castShadow = true; scene.add(m); return m; };
const mkGlove = () => { const m = new THREE.Mesh(GEO.unitSphere, lambert('#ff4d4d', { emissive: 0x300000 })); m.castShadow = true; scene.add(m); return m; };

function syncFx(run, t) {
  // 粒子
  let n = 0;
  for (const f of run.fx) {
    if (f.kind !== 'dot' || n >= MAX_POINTS) continue;
    const a = Math.max(0, f.life / f.max);
    pointPos[n * 3] = f.x; pointPos[n * 3 + 1] = f.z !== undefined ? f.z : 18 + (1 - a) * 14; pointPos[n * 3 + 2] = f.y;
    tmpColor.set(f.color);
    const br = 1.3 * a;
    pointCol[n * 3] = tmpColor.r * br; pointCol[n * 3 + 1] = tmpColor.g * br; pointCol[n * 3 + 2] = tmpColor.b * br;
    n++;
  }
  points.geometry.setDrawRange(0, n);
  points.geometry.attributes.position.needsUpdate = true;
  points.geometry.attributes.color.needsUpdate = true;

  for (const f of run.fx) {
    const a = Math.max(0, f.life / f.max);
    if (f.kind === 'ring') {
      const m = take('ring', mkRing);
      m.position.set(f.x, 2 + (f.y * 0), f.y);
      m.scale.setScalar(Math.max(1, f.r));
      m.material.color.set(f.color);
      m.material.opacity = a * 0.85;
    } else if (f.kind === 'impact') {
      const m = take('impact', mkImpact);
      const k = 1 - a;
      m.position.set(f.x, f.h || 20, f.y);
      if (f.dir !== undefined) {
        // 星芒沿出拳方向拉長（換算成螢幕上的角度）
        const p1 = R3D.project(f.x, f.y, f.h), p2 = R3D.project(f.x + Math.cos(f.dir) * 20, f.y + Math.sin(f.dir) * 20, f.h);
        m.material.rotation = -Math.atan2(p2.y - p1.y, p2.x - p1.x) + (f.rot || 0) * 0.15;
        const sz = (40 + Math.pow(k, 0.5) * 50) * f.size;
        m.scale.set(sz * 1.5, sz * 0.75, 1);
      } else {
        m.scale.setScalar((44 + k * 40) * f.size);
        m.material.rotation = f.x * 0.1;
      }
      m.material.color.set(f.color);
      m.material.opacity = a;
      if (f.dir === undefined) {
        const sh = take('shock', mkShock);
        sh.position.copy(m.position);
        sh.scale.setScalar((20 + k * 90) * f.size);
        sh.material.color.set(f.color);
        sh.material.opacity = a * 0.9;
      }
    } else if (f.kind === 'shard') {
      const m = take('shard', mkShard);
      m.position.set(f.x, f.z, f.y);
      tmpV.set(f.vx, f.vz, f.vy);
      const sp = tmpV.length();
      m.quaternion.setFromUnitVectors(AX_X, tmpV.normalize());
      m.scale.set(Math.min(40, 8 + sp * 0.04) * a, 2.2, 2.2);
      m.material.color.set(f.color);
      m.material.opacity = Math.min(1, a * 1.5);
    } else if (f.kind === 'crack') {
      const m = take('crack', mkCrack);
      m.position.set(f.x, 0.9, f.y);
      m.rotation.set(-Math.PI / 2, 0, f.rot);
      m.scale.setScalar(f.size * (1 + (1 - a) * 0.15));
      m.material.opacity = Math.min(1, a * 2) * 0.8;
    } else if (f.kind === 'flash') {
      const m = take('flash', mkFlash);
      m.position.set(f.x, f.h, f.y);
      m.scale.setScalar(70 * f.size * (1 + (1 - a) * 0.6));
      m.material.opacity = a;
    } else if (f.kind === 'lines') {
      // 速度線：從命中點往後噴出
      const k = 1 - a;
      for (let i = 0; i < f.n; i++) {
        const m = take('sline', mkSline);
        const r1 = Math.sin(f.seed + i * 12.9898) * 43758.5453; const rr = r1 - Math.floor(r1);
        const ang = f.dir + (rr - 0.5) * 1.6;
        const d0 = 10 + k * (50 + rr * 40), len = (1 - k) * (30 + rr * 30) + 6;
        const cx = f.x + Math.cos(ang) * (d0 + len / 2), cz = f.y + Math.sin(ang) * (d0 + len / 2);
        m.position.set(cx, f.h + (rr - 0.5) * 18, cz);
        m.rotation.set(0, -ang, 0);
        m.scale.set(len, 2.5, 2.5);
        m.material.color.set(i % 3 === 0 ? '#ffffff' : f.color);
        m.material.opacity = a;
      }
    } else if (f.kind === 'dring') {
      // 垂直於出拳方向的貫穿震波
      const m = take('dring', mkDring);
      const dist = 8 + (1 - a) * 30;
      m.position.set(f.x + Math.cos(f.dir) * dist, f.h, f.y + Math.sin(f.dir) * dist);
      tmpV.set(m.position.x + Math.cos(f.dir), f.h, m.position.z + Math.sin(f.dir));
      m.lookAt(tmpV);
      m.scale.setScalar(f.r);
      m.material.color.set(f.color);
      m.material.opacity = a * 0.9;
    } else if (f.kind === 'smoke') {
      const m = take('smoke', mkSmoke);
      m.position.set(f.x, f.h, f.y);
      m.scale.setScalar(f.size * (1 + (1 - a) * 1.5));
      m.material.opacity = a * 0.45;
    } else if (f.kind === 'spikes') {
      // 冰霜爆發：地上冒出一圈冰刺
      const k = 1 - a;
      const up = k < 0.2 ? k / 0.2 : (a < 0.3 ? a / 0.3 : 1);
      const n = 18;
      for (let i = 0; i < n; i++) {
        const ang = i * Math.PI * 2 / n + (i % 2) * 0.15;
        const d = f.r * (i % 2 ? 0.55 : 0.85);
        const m = take('spike', mkSpike);
        const h = (i % 2 ? 34 : 46) * up;
        m.position.set((f.x || 0) + Math.cos(ang) * d, h / 2, (f.y || 0) + Math.sin(ang) * d);
        m.scale.set(9, Math.max(0.1, h), 9);
        m.rotation.set(Math.sin(ang) * 0.25, 0, -Math.cos(ang) * 0.25);
        m.material.opacity = Math.min(1, a * 3);
      }
    } else if (f.kind === 'line') {
      const l = take('line', mkLine);
      const pa = l.geometry.attributes.position;
      pa.setXYZ(0, f.x1, 20, f.y1); pa.setXYZ(1, f.x2, 20, f.y2);
      l.geometry.setDrawRange(0, 2);
      pa.needsUpdate = true;
      l.material.color.set(f.color);
      l.material.opacity = a;
    } else if (f.kind === 'bolt') {
      const grp = take('bolt', mkBolt);
      for (let i = 0; i < grp.children.length; i++) {
        const s = grp.children[i];
        const p1 = f.pts[i], p2 = f.pts[i + 1];
        if (!p2) { s.visible = false; continue; }
        s.visible = true;
        const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
        const len = Math.hypot(dx, dz);
        s.position.set((p1[0] + p2[0]) / 2, 24, (p1[1] + p2[1]) / 2);
        s.rotation.set(0, -Math.atan2(dz, dx), 0);
        s.scale.set(len + 3, 5, 5);
        s.material.opacity = a;
      }
    }
  }
  // 區域
  for (const z of run.zones) {
    const m = take('zone', mkDisc);
    const a = Math.min(1, z.t / 0.5) * (0.5 + Math.sin(t * 10) * 0.1);
    m.position.set(z.x, 1, z.y);
    m.scale.setScalar(z.r);
    m.material.color.set(z.kind === 'fire' ? '#ff6a28' : '#8cc83c');
    m.material.opacity = 0.45 * a;
  }
  // 天降鐵拳：預警圈與落下的拳頭
  for (const mk of run.marks) {
    const k = 1 - mk.t / mk.max;
    const ring = take('ring', mkRing);
    ring.position.set(mk.x, 2, mk.y); ring.scale.setScalar(mk.r);
    ring.material.color.set('#ffd84a'); ring.material.opacity = 0.8;
    const d = take('zone', mkDisc);
    d.position.set(mk.x, 1.5, mk.y); d.scale.setScalar(mk.r * k);
    d.material.color.set('#ffd84a'); d.material.opacity = 0.25;
    const g = take('glove', mkGlove);
    g.position.set(mk.x, 20 + (1 - k) * 420, mk.y);
    g.scale.setScalar(26);
  }
  // 我方飛拳
  for (const pr of run.projs) {
    const g = take('rocket', mkRocket);
    g.position.set(pr.x, 22, pr.y);
    g.rotation.set(0, -Math.atan2(pr.vy, pr.vx), 0);
  }
  // 敵方酒瓶
  for (const b of run.eprojs) {
    const m = take('bottle', mkBottle);
    m.position.set(b.x, 26, b.y);
    m.rotation.set(b.rot, 0, b.rot * 0.6);
  }
  // 迴旋拳套
  if (run.skills.orbit && run.skills.orbit.pos) {
    for (const pos of run.skills.orbit.pos) {
      const g = take('glove', mkGlove);
      g.position.set(pos.x, 22, pos.y);
      g.scale.setScalar(12);
    }
  }
  // 經驗與金幣
  let nx = 0, ng = 0;
  for (const o of run.orbs) {
    const bob = 10 + Math.sin(t * 8 + o.x) * 3;
    if (o.kind === 'xp' && nx < 400) { tmpM.makeScale(4.5, 4.5, 4.5); tmpM.setPosition(o.x, bob, o.y); orbXp.setMatrixAt(nx++, tmpM); }
    else if (o.kind === 'gold' && ng < 200) { tmpM.makeScale(6, 2.5, 6); tmpM.setPosition(o.x, bob, o.y); orbGold.setMatrixAt(ng++, tmpM); }
  }
  orbXp.count = nx; orbGold.count = ng;
  orbXp.instanceMatrix.needsUpdate = true; orbGold.instanceMatrix.needsUpdate = true;
}

// ---------- 每格渲染 ----------
let lastRenderT = null;
let titleBlend = 1;
const camFollow = new THREE.Vector3();
R3D.render = (run, demo, t, shake) => {
  renderer.info.autoReset = false;
  renderer.info.reset(); // 統計整格（含後處理）的繪製次數
  beginPools();
  let dt = lastRenderT === null ? 0 : Math.min(0.05, t - lastRenderT);
  lastRenderT = t;
  const rdt = dt;
  // 命中停頓時動作也停住，慢動作時動作變慢
  if (run && run.hitstop > 0) dt = 0;
  else if (run && run.slowmo > 0) dt *= 0.3;
  const p = run ? run.p : demo;
  // 鏡頭
  let sx = 0, sz = 0;
  if (shake) {
    // 沿著出拳方向來回晃、頻率放慢，不加隨機抖動（隨機抖動最容易讓人不舒服）
    const osc = Math.sin(t * 46) * shake, side = Math.sin(t * 31 + 1.3) * shake * 0.2;
    const d = run ? run.shakeDir || 0 : 0;
    sx = Math.cos(d) * osc - Math.sin(d) * side;
    sz = Math.sin(d) * osc + Math.cos(d) * side;
  }
  const dist = camDist * (1 - (run ? run.zoom || 0 : 0)) * (R3D.debugZoom || 1); // debugZoom 僅測試用
  // 飛踢時鏡頭跟過去一部分
  camFollow.lerp(tmpV.set(player.position.x * 0.35, 0, player.position.z * 0.35), Math.min(1, rdt * 6));
  sx += camFollow.x; sz += camFollow.z;
  // 主選單時鏡頭拉近看主角練拳；開始遊戲後平滑拉回擂台全景
  titleBlend += ((run ? 0 : 1) - titleBlend) * Math.min(1, rdt * (run ? 3 : 8));
  const TT = 1.22, TD = SH > SW ? 330 : 270;
  const gx = camTarget.x + sx, gy = camTarget.y + Math.cos(TILT) * dist, gz = camTarget.z + Math.sin(TILT) * dist + sz;
  const hx = 0, hy = 34 + Math.cos(TT) * TD, hz = Math.sin(TT) * TD;
  const w = titleBlend;
  camera.position.set(gx + (hx - gx) * w, gy + (hy - gy) * w, gz + (hz - gz) * w);
  tmpV.set(camTarget.x + sx, camTarget.y, camTarget.z + sz).lerp(_v2.set(0, SH > SW ? 62 : 58, 0), w); // 看高一點，主角就落在畫面中下方
  camera.lookAt(tmpV);
  if (R3D.debugCam) { const c = R3D.debugCam; camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); } // 僅測試用

  updatePlayer(p, t, run && p.hurtT > 0, run && run.skills, dt, run);
  rangeRing.visible = !!run;
  if (run) {
    rangeRing.scale.setScalar(p.range);
    // 敵人
    const alive = new Set();
    for (const e of run.enemies) {
      if (e.dead) continue;
      alive.add(e);
      updateEnemy(e, getEnemyMesh(e), t, dt);
    }
    for (const [e, g] of enemyMap) if (!alive.has(e)) releaseEnemy(e, g);
    updateBodies(run.bodies, dt);
    blobBegin();
    for (const [e] of enemyMap) blobAdd(e.x, e.y, e.r * 3.2);
    blobAdd(player.position.x, player.position.z, PLAYER_R * 3.6);
    blobEnd();
    crowdBegin();
    shadeDt = rdt;
    for (const g of enemyMap.values()) crowdAdd(g);
    for (const g of bodyMap.values()) crowdAdd(g);
    crowdEnd();
    const sk = run.skills;
    syncQi(rdt, sk.firePunch ? '#ff8a3c' : sk.thunderPunch ? '#ffe14a' : sk.icePunch ? '#9be7ff' : '#ffe9b0');
    syncFx(run, t);
    updateStreet(t);
  } else {
    for (const [e, g] of enemyMap) releaseEnemy(e, g);
    updateBodies([], dt);
    blobBegin(); blobAdd(player.position.x, player.position.z, PLAYER_R * 3.6); blobEnd();
    crowdBegin(); crowdEnd();
    syncQi(rdt, '#ffe9b0');
    points.geometry.setDrawRange(0, 0);
    orbXp.count = orbGold.count = 0;
    updateStreet(t);
  }
  shadeHero(rdt);
  endPools();
  if (R3D.quality === 'high' && composer) composer.render(); else renderer.render(scene, camera);
  watchPerf(rdt);
};
})();
