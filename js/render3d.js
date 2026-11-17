// ===== RL Fight：3D 畫面（Three.js） =====
// 只負責「畫」，每一格讀取遊戲狀態（run）同步到 3D 場景。
// 座標對應：遊戲的 x → 3D 的 x，遊戲的 y → 3D 的 z，高度為 3D 的 y。
(() => {
'use strict';

const R3D = {};
window.R3D = R3D;

let renderer, scene, camera, dirLight;
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
  GEO.unitSphere = new THREE.SphereGeometry(1, 12, 10);
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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0910');
  scene.fog = new THREE.Fog('#0a0910', 900, 1900);
  camera = new THREE.PerspectiveCamera(FOV, 1, 10, 4000);

  scene.add(new THREE.HemisphereLight(0xd8e4ff, 0x2a2238, 0.62));
  scene.add(new THREE.AmbientLight(0x404058, 0.25));
  dirLight = new THREE.DirectionalLight(0xfff4e6, 0.8);
  dirLight.position.set(-220, 600, 260);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  const sc = dirLight.shadow.camera;
  sc.left = -ARENA - 80; sc.right = ARENA + 80; sc.top = ARENA + 80; sc.bottom = -ARENA - 80;
  sc.near = 100; sc.far = 1400;
  dirLight.shadow.bias = -0.0008;
  scene.add(dirLight);
  // 擂台頂上的聚光
  const spot = new THREE.SpotLight(0xfff1d6, 0.45, 1800, 0.55, 0.6);
  spot.position.set(0, 900, 0);
  scene.add(spot);
  // 兩側彩色輪廓光：青色、洋紅
  const rimA = new THREE.PointLight(0x3fe0c5, 0.9, 1400, 1.2);
  rimA.position.set(-ARENA * 1.2, 260, -ARENA * 0.8);
  const rimB = new THREE.PointLight(0xff4fd8, 0.75, 1400, 1.2);
  rimB.position.set(ARENA * 1.2, 260, ARENA * 0.6);
  scene.add(rimA); scene.add(rimB);

  setupComposer();
  buildGeometries();
  buildRigGeometries();
  buildArena();
  buildStadiumLights();
  buildPlayer();
  buildFx();
};

// 發光後處理（UnrealBloom）。效能不足時自動關閉，也可在暫停選單切換。
let composer = null, bloomPass = null, lastDpr = 1;
R3D.quality = 'high';
function setupComposer() {
  if (!THREE.EffectComposer || !THREE.UnrealBloomPass) { R3D.quality = 'low'; return; }
  composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));
  bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.35, 0.97);
  composer.addPass(bloomPass);
  composer.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader));
  applyQuality();
}
function applyQuality() {
  const high = R3D.quality === 'high' && composer;
  renderer.outputEncoding = high ? THREE.LinearEncoding : THREE.sRGBEncoding;
  renderer.setPixelRatio(high ? Math.min(1.5, lastDpr) : Math.min(2, lastDpr));
  renderer.setSize(SW, SH, false);
  if (composer) {
    composer.setPixelRatio(Math.min(1.5, lastDpr));
    composer.setSize(SW, SH);
    bloomPass.resolution.set(SW / 2, SH / 2);
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
R3D.project = (x, y, h = 0) => {
  tmpV.set(x, h, y).project(camera);
  return { x: (tmpV.x + 1) / 2 * SW, y: (1 - tmpV.y) / 2 * SH, visible: tmpV.z < 1 };
};

// ---------- 擂台 ----------
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
const GRAY_LOOK = { skin: '#8a8f9a', shirt: '#7b808c', pants: '#6a6f7a', hair: '#5d626c', shoe: '#55595f' };

// 各敵人外觀
const LOOKS = {
  grunt:   { skin: '#e0ac85', shirt: '#d9534f', pants: '#3b4a6b', hair: '#2b1d14' },
  runner:  { skin: '#c98d62', shirt: '#f0883e', pants: '#2f2f3a', hair: '#111111', band: '#ffffff', slim: 0.85 },
  tank:    { skin: '#d9a27a', shirt: '#8e5bd1', pants: '#3a2a50', hair: '#111111', wide: 1.45 },
  bomber:  { skin: '#b07c5a', shirt: '#3a3a44', pants: '#22222a', hair: '#111111', bomb: true },
  charger: { skin: '#a86c48', shirt: '#b5652f', pants: '#4a3020', hair: '#2b1d14', horns: true, wide: 1.15 },
  drummer: { skin: '#e6b896', shirt: '#3a7bd5', pants: '#20304f', hair: '#4a2a14', drum: true },
  spore:   { skin: '#d6c9a8', shirt: '#8fbf3a', pants: '#4a5a2a', hair: '#d6c9a8', mushroom: true },
  goldie:  { skin: '#f0c090', shirt: '#f2c230', pants: '#7a5a10', hair: '#5a3a10', bag: true, slim: 0.9 },
  boss_slam:   { skin: '#d79b74', shirt: '#c0392b', pants: '#2a1a1a', hair: '#111111', wide: 1.35, crown: true, spikes: true },
  boss_charge: { skin: '#9a5f3e', shirt: '#a0522d', pants: '#3a2015', hair: '#111111', wide: 1.25, crown: true, horns: true },
  boss_summon: { skin: '#e0b090', shirt: '#2d2d3a', pants: '#1a1a22', hair: '#111111', wide: 1.2, crown: true, shades: true, chain: true },
};

function capsuleGeo(r, h, seg = 12) {
  const pts = [];
  const N = 5;
  for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 + (i / N) * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * r), -h / 2 + Math.sin(a) * r)); }
  for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * r), h / 2 + Math.sin(a) * r)); }
  return new THREE.LatheGeometry(pts, seg);
}
const geoCache = {};
function segGeo(key, r, len) {
  const k = key + r.toFixed(3);
  if (!geoCache[k]) { const g = capsuleGeo(r, Math.max(0.01, len - r * 1.2), 10); g.translate(0, len / 2, 0); geoCache[k] = g; }
  return geoCache[k];
}
function buildRigGeometries() {
  GEO.rhead = new THREE.SphereGeometry(1, 16, 12);
  GEO.hair = new THREE.SphereGeometry(1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
  GEO.eye = new THREE.SphereGeometry(1, 8, 6);
  GEO.cap = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  GEO.band = new THREE.TorusGeometry(1, 0.12, 6, 20);
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
  const head = new THREE.Group();
  head.position.copy(top.clone().multiplyScalar(0.55));
  hb.add(head);
  const HR = 0.33;
  const skull = new THREE.Mesh(GEO.rhead, mat.skin);
  skull.scale.setScalar(HR);
  skull.castShadow = true;
  head.add(skull);
  const hair = new THREE.Mesh(GEO.hair, mat.hair);
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
  if (look.shades) acc(GEO.box, new THREE.MeshBasicMaterial({ color: '#050505' }), head, 0, 0.04, HR * 0.92, 0.32, 0.08, 0.04);
  if (look.chain) { const c = acc(GEO.band, lambert('#ffd84a', { emissive: 0x443300 }), chest, 0, 0.15, 0.12, 0.2, 0.2, 0.2); c.rotation.x = 1.2; }

  root.userData = { bones, lean, head, mats, anim: newAnim(), hairMesh: hair };
  scene.add(root);
  return root;
}

// ---------- 動畫播放器（片段內插、交叉淡入） ----------
const CL = MC.clips;
const CLIPS_BY = {};
for (const k in CL) { const g = k.replace(/[RL]\d+$/, '').replace(/\d+$/, ''); const side = /R\d+$/.test(k) ? 'R' : (/L\d+$/.test(k) ? 'L' : ''); (CLIPS_BY[g + side] = CLIPS_BY[g + side] || []).push(k); }
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

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
function stepAnim(g, dt) {
  const a = g.userData.anim;
  if (!a.cur) return;
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
    g = createRig(LOOKS[e.type] || LOOKS.grunt);
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
    if (!frozen && !e.T.boss) {
      u.reacting = true; u.attacking = false;
      play(a, Math.random() < 0.5 ? 'hit0' : 'hit1', { loop: false, speed: 1.5, fade: 0.04, restart: true });
    } else if (e.T.boss) {
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
  setRigLook(g, { frozen, burn: !!e.burn, flash: e.flash > 0 || (wind && Math.floor(t * 16) % 2 === 0) });
  if (u.fuse) u.fuse.material.color.set(Math.floor(t * 12) % 2 ? '#ffe14a' : '#ff5a1f');

  // 護盾
  if (e.shield > 0) {
    if (!u.shieldMesh) { u.shieldMesh = new THREE.Mesh(GEO.unitSphere, basic('#5fa8ff', { opacity: 0.28 })); scene.add(u.shieldMesh); }
    u.shieldMesh.visible = true;
    u.shieldMesh.position.set(e.x, S * 1.2, e.y);
    u.shieldMesh.scale.setScalar(S * 1.25);
  } else if (u.shieldMesh) u.shieldMesh.visible = false;
  // 減速圈
  if (e.slowT > 0 && !frozen) {
    if (!u.slowRing) { u.slowRing = new THREE.Mesh(GEO.ring, basic('#9be7ff', { opacity: 0.6 })); u.slowRing.rotation.x = -Math.PI / 2; scene.add(u.slowRing); }
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
const bodyPool = [];
const AX_X = new THREE.Vector3(1, 0, 0), AX_Z = new THREE.Vector3(0, 0, 1);
function updateBodies(bodies, dt) {
  const alive = new Set(bodies);
  for (const [b, g] of bodyMap) if (!alive.has(b)) { g.visible = false; bodyMap.delete(b); bodyPool.push(g); }
  for (const b of bodies) {
    let g = bodyMap.get(b);
    if (!g) {
      g = bodyPool.pop() || createRig(GRAY_LOOK);
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
    setRigLook(g, { opacity: Math.min(1, b.life / 0.6) });
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
  play(u.anim, 'stance', { fade: 0 });
  u.seen = new WeakSet();
  u.strikeLimb = JI.RightHand;
  u.faceYaw = 0;
  u.count = 0;
}

// 挑招式：出拳（直拳／勾拳／上勾拳）或踢腿（飛踢／迴旋踢／側踢／前踢）；回傳 [片段名, 出招的肢體]
function wpick(list) { let t = 0; for (const [, w] of list) t += w; let r = Math.random() * t; for (const [v, w] of list) { r -= w; if (r <= 0) return v; } return list[0][0]; }
function clipFor(kind, s) { return CLIPS_BY[kind + s] || CLIPS_BY[kind + (s === 'R' ? 'L' : 'R')]; }
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
// 每一招在命中瞬間，出招肢體相對身體的角度（用隱藏的骨架預先算一次）
let probe = null;
const limbAngle = {};
function strikeOffset(name, limb) {
  const key = name + ':' + limb;
  if (limbAngle[key] !== undefined) return limbAngle[key];
  if (!probe) { probe = createRig(GRAY_LOOK); probe.visible = false; }
  const c = CL[name];
  sample(name, c.impact / c.fps, false, QA, RA);
  for (let j = 0; j < NJ; j++) probe.userData.bones[j].quaternion.set(QA[j * 4 + 1], QA[j * 4 + 2], QA[j * 4 + 3], QA[j * 4]).normalize();
  probe.userData.bones[0].position.set(RA[0] * UNIT, RA[1] * UNIT, RA[2] * UNIT);
  probe.position.set(0, 0, 0); probe.rotation.set(0, 0, 0); probe.scale.setScalar(1);
  probe.updateMatrixWorld(true);
  probe.userData.bones[limb].getWorldPosition(tmpW);
  limbAngle[key] = Math.atan2(tmpW.z, tmpW.x);
  return limbAngle[key];
}
function updatePlayer(p, t, hurt, elements, dt, run) {
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
    u.count++;
    const crit = run && run.comboPop > 0.1 && Math.random() < 0.15;
    const [name, limb] = chooseMove(pu.side, 0.32);
    const c = CL[name];
    const ti = c.impact / c.fps;
    const hitAt = pu.dur * (pu.hitFrac || 0.5);
    const t0 = ti * 0.45;
    const speed = Math.max(1, (ti - t0) / Math.max(0.05, hitAt));
    play(a, name, { loop: false, t: t0, speed, fade: 0.06, restart: true });
    a.recover = speed;
    u.strikeLimb = limb;
    u.impactClipT = ti;
    u.faceYaw = Math.atan2(pu.ty, pu.tx) - strikeOffset(name, limb);
    u.yaw = u.faceYaw; // 出招瞬間直接轉到位
    u.pending = pu;
    u.pendingName = name;
  }
  // 命中前持續追蹤目標（敵人還在移動）
  if (u.pending && !u.pending.impact) {
    u.faceYaw = Math.atan2(u.pending.ty, u.pending.tx) - strikeOffset(u.pendingName, u.strikeLimb);
    u.yaw = u.faceYaw;
  }
  // 打中之後放慢收招；招式結束回到待機
  if (!a.loop && a.t > (u.impactClipT || 0)) a.speed = Math.max(1.1, (a.recover || 1) * 0.55);
  if (!a.loop && animDone(player)) play(a, 'stance', { fade: 0.18 });
  // 面向目標（平滑轉向）
  let dy = u.faceYaw - (u.yaw ?? u.faceYaw);
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  u.yaw = (u.yaw ?? u.faceYaw) + dy * Math.min(1, dt * 25);
  player.rotation.y = -u.yaw;
  stepAnim(player, dt);
  // 出招軌跡：從起手到命中後一小段
  {
    const striking = !a.loop && a.t < (u.impactClipT || 0) + 0.12;
    player.updateMatrixWorld(true);
    u.bones[u.strikeLimb].getWorldPosition(tmpW);
    const sk2 = elements || {};
    const tc = sk2.firePunch ? '#ff8a3c' : sk2.thunderPunch ? '#ffe14a' : sk2.icePunch ? '#9be7ff' : '#fff1c8';
    updateTrail(dt > 0 ? dt : 0, striking && dt > 0, tmpW, tc, S * 0.22);
  }
  // 拳勁：打中瞬間，從出招的手或腳射出一道氣勁到目標
  for (const pu of p.punches) {
    if (pu.impact && !pu.qi) {
      pu.qi = true;
      // 命中瞬間把動作對齊到「打到最遠」的那一格（配合命中停頓，看起來像拳腳定格）
      if (u.pending === pu && !a.loop && a.t < u.impactClipT) { a.t = u.impactClipT; a.prev = null; stepAnim(player, 0); }
      player.updateMatrixWorld(true);
      u.bones[u.strikeLimb].getWorldPosition(tmpW);
      const tx = pu.tx, tz = pu.ty, ty = pu.target && pu.target.r ? pu.target.r * RIG_SCALE * 1.4 : 30;
      // 測試用：記錄出招肢體方向與目標方向的角度差
      if (R3D.debugAngles) {
        let d = Math.atan2(tmpW.z - player.position.z, tmpW.x - player.position.x) - Math.atan2(tz, tx);
        R3D.debugAngles.push(Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180 / Math.PI);
        (R3D.debugInfo = R3D.debugInfo || []).push([u.pendingName, Math.round(Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180 / Math.PI), u.anim.cur, +(u.anim.t - u.impactClipT).toFixed(3)]);
      }
      qiFx.push({ x1: tmpW.x, y1: tmpW.y, z1: tmpW.z, x2: tx, y2: ty, z2: tz, life: 0.12, max: 0.12 });
    }
  }
  u.shield.visible = !!p.shield;
  u.shield.position.set(0, S * 1.2, 0);
  u.shield.scale.setScalar(S * 1.5);
}

// 出招軌跡：記錄拳頭或腳的路徑，畫成會淡出的光帶
const TRAIL_MAX = 48, TRAIL_LIFE = 0.16;
const trailPts = [];
let trailMesh = null;
function buildTrail() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setIndex(idx);
  trailMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  trailMesh.frustumCulled = false;
  scene.add(trailMesh);
}
const tcol = new THREE.Color();
function updateTrail(rdt, active, pos, color, width) {
  if (!trailMesh) buildTrail();
  for (const p of trailPts) p.age += rdt;
  while (trailPts.length && trailPts[0].age > TRAIL_LIFE) trailPts.shift();
  if (active) { trailPts.push({ x: pos.x, y: pos.y, z: pos.z, age: 0 }); if (trailPts.length > TRAIL_MAX) trailPts.shift(); }
  const g = trailMesh.geometry, P = g.attributes.position.array, C = g.attributes.color.array;
  const n = trailPts.length;
  tcol.set(color);
  for (let i = 0; i < n; i++) {
    const p = trailPts[i];
    const q = trailPts[Math.min(i + 1, n - 1)], o = trailPts[Math.max(i - 1, 0)];
    const dx = q.x - o.x, dy = q.y - o.y, dz = q.z - o.z;
    // 帶子寬度方向：垂直於路徑與鏡頭方向
    const cx = camera.position.x - p.x, cy = camera.position.y - p.y, cz = camera.position.z - p.z;
    let sx = dy * cz - dz * cy, sy = dz * cx - dx * cz, sz = dx * cy - dy * cx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    const life = Math.max(0, 1 - p.age / TRAIL_LIFE);
    const w = width * life * (0.3 + 0.7 * (i / Math.max(1, n - 1)));
    sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
    P.set([p.x + sx, p.y + sy, p.z + sz, p.x - sx, p.y - sy, p.z - sz], i * 6);
    const b = life * life;
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
      m.scale.set(len, (w === 1 ? 26 : 12) * (0.6 + a * 0.6), 1);
      m.material.color.set(w === 1 ? color : '#ffffff');
      m.material.opacity = a;
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
        m.position.set(Math.cos(ang) * d, h / 2, Math.sin(ang) * d);
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
R3D.render = (run, demo, t, shake) => {
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
    const osc = Math.sin(t * 70) * shake;
    const d = run ? run.shakeDir || 0 : 0;
    sx = Math.cos(d) * osc + (Math.random() * 2 - 1) * shake * 0.3;
    sz = Math.sin(d) * osc + (Math.random() * 2 - 1) * shake * 0.3;
  }
  const dist = camDist * (1 - (run ? run.zoom || 0 : 0)) * (R3D.debugZoom || 1); // debugZoom 僅測試用
  camera.position.set(camTarget.x + sx, camTarget.y + Math.cos(TILT) * dist, camTarget.z + Math.sin(TILT) * dist + sz);
  camera.lookAt(camTarget.x + sx, camTarget.y, camTarget.z + sz);

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
    const sk = run.skills;
    syncQi(rdt, sk.firePunch ? '#ff8a3c' : sk.thunderPunch ? '#ffe14a' : sk.icePunch ? '#9be7ff' : '#ffe9b0');
    syncFx(run, t);
    updateCrowd(t, Math.min(1, run.combo / 60));
  } else {
    for (const [e, g] of enemyMap) releaseEnemy(e, g);
    updateBodies([], dt);
    syncQi(rdt, '#ffe9b0');
    points.geometry.setDrawRange(0, 0);
    orbXp.count = orbGold.count = 0;
    updateCrowd(t, 0.2);
  }
  endPools();
  if (R3D.quality === 'high' && composer) composer.render(); else renderer.render(scene, camera);
  watchPerf(rdt);
};
})();
