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

  scene.add(new THREE.HemisphereLight(0xc8d8ff, 0x1a1424, 0.5));
  dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
  dirLight.position.set(-220, 600, 260);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  const sc = dirLight.shadow.camera;
  sc.left = -ARENA - 80; sc.right = ARENA + 80; sc.top = ARENA + 80; sc.bottom = -ARENA - 80;
  sc.near = 100; sc.far = 1400;
  dirLight.shadow.bias = -0.0008;
  scene.add(dirLight);
  // 擂台頂上的聚光
  const spot = new THREE.SpotLight(0xfff1d6, 0.55, 1600, 0.6, 0.6);
  spot.position.set(0, 900, 0);
  scene.add(spot);

  buildGeometries();
  buildRigGeometries();
  buildArena();
  buildPlayer();
  buildFx();
};

R3D.resize = (w, h, dpr) => {
  SW = w; SH = h;
  renderer.setPixelRatio(Math.min(2, dpr || 1));
  renderer.setSize(w, h, false);
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

// ---------- 角色（人形骨架：身體、頭、手、腳） ----------
// 骨架以「單位大小」建立，面向 +x，原點在腳底；實際大小用 scale 調整。
const RIG_SCALE = 1.75;     // 碰撞半徑 → 外觀大小
const WHITE = new THREE.Color(1, 1, 1);
const ICE = new THREE.Color('#a8e4ff');
const GRAY_LOOK = { skin: '#8a8f9a', shirt: '#7b808c', pants: '#6a6f7a', hair: '#5d626c', shoe: '#55595f' };

// 各敵人外觀
const LOOKS = {
  grunt:   { skin: '#e0ac85', shirt: '#d9534f', pants: '#3b4a6b', hair: '#2b1d14' },
  runner:  { skin: '#c98d62', shirt: '#f0883e', pants: '#2f2f3a', hair: '#111111', band: '#ffffff', slim: 0.85 },
  tank:    { skin: '#d9a27a', shirt: '#8e5bd1', pants: '#3a2a50', hair: '#111111', wide: 1.4 },
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
  const N = 6;
  for (let i = 0; i <= N; i++) { const a = -Math.PI / 2 + (i / N) * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * r), -h / 2 + Math.sin(a) * r)); }
  for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * r), h / 2 + Math.sin(a) * r)); }
  return new THREE.LatheGeometry(pts, seg);
}
function buildRigGeometries() {
  GEO.torso = capsuleGeo(0.46, 0.38, 14);
  GEO.rhead = new THREE.SphereGeometry(0.42, 16, 12);
  GEO.hair = new THREE.SphereGeometry(0.445, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  GEO.eye = new THREE.SphereGeometry(0.065, 8, 6);
  GEO.limb = capsuleGeo(0.15, 0.4, 8);
  GEO.rfist = new THREE.SphereGeometry(0.23, 12, 10);
  GEO.foot = new THREE.BoxGeometry(0.32, 0.13, 0.19);
  GEO.shorts = new THREE.CylinderGeometry(0.43, 0.46, 0.34, 14);
  GEO.cap = new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  GEO.band = new THREE.TorusGeometry(0.43, 0.05, 6, 20);
}

const GUARD = 1.25; // 手臂舉起的防禦姿勢角度

function createRig(look, opt = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.85;
  root.add(body);
  const mats = [];
  const M = c => { const m = lambert(c); m.userData.base = new THREE.Color(c); mats.push(m); return m; };
  const mShirt = M(look.shirt), mSkin = M(look.skin), mPants = M(look.pants), mHair = M(look.hair), mShoe = M(look.shoe || '#26262c');
  const mGlove = opt.gloveMat || M(look.glove || look.skin);
  const wide = look.wide || 1, slim = look.slim || 1;
  const shadow = m => { m.castShadow = true; return m; };

  const torso = shadow(new THREE.Mesh(GEO.torso, mShirt));
  torso.position.y = 0.5;
  torso.scale.set(0.95 * wide * slim, 1, wide * slim);
  body.add(torso);
  const shorts = new THREE.Mesh(GEO.shorts, mPants);
  shorts.position.y = 0.06;
  shorts.scale.set(wide * slim, 1, wide * slim);
  body.add(shorts);

  const head = new THREE.Group();
  head.position.y = 1.33;
  body.add(head);
  const skull = shadow(new THREE.Mesh(GEO.rhead, mSkin));
  head.add(skull);
  const hair = new THREE.Mesh(GEO.hair, mHair);
  hair.rotation.z = 0.35;
  head.add(hair);
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#111' });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(GEO.eye, eyeMat);
    eye.position.set(0.37, 0.04, s * 0.15);
    head.add(eye);
  }
  // 生氣的眉毛
  const browMat = new THREE.MeshBasicMaterial({ color: '#1a1a1a' });
  for (const s of [-1, 1]) {
    const brow = new THREE.Mesh(GEO.box, browMat);
    brow.scale.set(0.04, 0.04, 0.16);
    brow.position.set(0.39, 0.15, s * 0.15);
    brow.rotation.x = s * 0.45;
    head.add(brow);
  }

  const arms = [], fists = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(0, 0.86, s * 0.5 * wide * slim);
    sh.rotation.z = GUARD;
    sh.rotation.x = -s * 0.25;
    body.add(sh);
    const limb = new THREE.Mesh(GEO.limb, mSkin);
    limb.position.y = -0.3;
    sh.add(limb);
    const fist = shadow(new THREE.Mesh(GEO.rfist, mGlove));
    fist.position.y = -0.62;
    if (opt.bigFists) fist.scale.setScalar(1.35);
    sh.add(fist);
    arms.push(sh); fists.push(fist);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0, s * 0.2 * wide * slim);
    body.add(hip);
    const leg = new THREE.Mesh(GEO.limb, mPants);
    leg.position.y = -0.4;
    leg.scale.set(1.15, 1, 1.15);
    hip.add(leg);
    const foot = new THREE.Mesh(GEO.foot, mShoe);
    foot.position.set(0.07, -0.8, 0);
    hip.add(foot);
    legs.push(hip);
  }

  // 配件
  const acc = (geo, mat, x, y, z, sx, sy, sz, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };
  if (look.band) { const b = new THREE.Mesh(GEO.band, M(look.band)); b.rotation.x = Math.PI / 2; b.position.y = 0.1; head.add(b); }
  if (look.bomb) {
    acc(GEO.unitSphere, M('#1e1e24'), -0.55, 0.65, 0, 0.36, 0.36, 0.36);
    root.userData.fuse = acc(GEO.unitSphere, new THREE.MeshBasicMaterial({ color: '#ffb020' }), -0.6, 1.08, 0, 0.09, 0.09, 0.09);
  }
  if (look.horns) for (const s of [-1, 1]) {
    const h = acc(GEO.cone, M('#efe6d0'), 0.05, 0.3, s * 0.3, 0.07, 0.32, 0.07, head);
    h.rotation.x = s * 0.6;
  }
  if (look.drum) { const d = acc(GEO.cyl, M('#e8eef8'), 0.5, 0.45, 0, 0.32, 0.28, 0.32); d.rotation.z = Math.PI / 2; }
  if (look.mushroom) {
    hair.visible = false;
    const cap = acc(GEO.cap, M('#d63a3a'), 0, 0.12, 0, 1, 0.85, 1, head);
    cap.castShadow = true;
    for (const [a, r] of [[0, 0.35], [1.6, 0.4], [3.1, 0.3], [4.5, 0.42], [2.3, 0.15]]) {
      acc(GEO.unitSphere, M('#f5f0e0'), Math.cos(a) * r, 0.12 + 0.5 * Math.sqrt(1 - (r / 0.62) ** 2) * 0.85, Math.sin(a) * r, 0.08, 0.05, 0.08, head);
    }
  }
  if (look.bag) acc(GEO.unitSphere, M('#c9952a'), -0.55, 0.6, 0, 0.34, 0.32, 0.34);
  if (look.crown) {
    const mc = lambert('#ffd84a', { emissive: 0x553300 });
    const ring = acc(new THREE.CylinderGeometry(0.28, 0.25, 0.16, 6, 1, true), mc, 0, 0.42, 0, 1, 1, 1, head);
    ring.material.side = THREE.DoubleSide;
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      acc(GEO.cone, mc, Math.cos(a) * 0.25, 0.58, Math.sin(a) * 0.25, 0.06, 0.16, 0.06, head);
    }
  }
  if (look.spikes) for (const s of [-1, 1]) {
    acc(GEO.unitSphere, M('#444'), 0, 0.95, s * 0.52 * wide, 0.22, 0.16, 0.22);
    for (let i = 0; i < 3; i++) acc(GEO.cone, M('#ddd'), (i - 1) * 0.12, 1.1, s * 0.55 * wide, 0.05, 0.16, 0.05);
  }
  if (look.shades) {
    const ms = new THREE.MeshBasicMaterial({ color: '#050505' });
    acc(GEO.box, ms, 0.33, 0.05, 0, 0.06, 0.1, 0.4, head);
  }
  if (look.chain) {
    const c = new THREE.Mesh(GEO.band, lambert('#ffd84a', { emissive: 0x443300 }));
    c.rotation.x = Math.PI / 2; c.rotation.y = 0.5; c.position.set(0.15, 0.8, 0); c.scale.setScalar(1.05);
    body.add(c);
  }

  root.userData = { body, head, arms, fists, legs, mats, torso };
  scene.add(root);
  return root;
}

// 顏色與受擊閃光
function setRigLook(g, o) {
  const mats = g.userData.mats;
  for (const m of mats) {
    if (o.frozen) m.color.copy(m.userData.base).lerp(ICE, 0.7);
    else m.color.copy(m.userData.base);
    if (o.flash) { m.emissive.setHex(0xffffff); m.emissiveIntensity = 1; }
    else if (o.burn) { m.emissive.setHex(0xff5a10); m.emissiveIntensity = 0.35 + Math.random() * 0.25; }
    else if (m.emissiveIntensity) { m.emissive.setHex(0); m.emissiveIntensity = 0; }
    if (o.opacity !== undefined) { m.transparent = o.opacity < 1; m.opacity = o.opacity; }
  }
}

// 走路、攻擊、受擊姿勢
function poseRig(g, o) {
  const u = g.userData;
  const ph = o.walk || 0;
  const sw = Math.sin(ph);
  const amp = o.moving ? 1 : 0.15;
  u.legs[0].rotation.z = sw * 0.75 * amp;
  u.legs[1].rotation.z = -sw * 0.75 * amp;
  u.body.position.y = 0.85 + Math.abs(Math.cos(ph)) * 0.06 * amp - (o.crouch ? 0.15 : 0);
  // 身體前傾 / 受擊後仰
  u.body.rotation.z = (o.hit || 0) * 0.6 - (o.lean || 0);
  u.head.rotation.z = (o.hit || 0) * 0.5;
  const guardL = GUARD + sw * 0.18 * amp, guardR = GUARD - sw * 0.18 * amp;
  u.arms[0].rotation.z = o.punchL ? 1.6 : guardL;
  u.arms[1].rotation.z = o.punchR ? 1.65 : guardR;
  u.arms[1].position.x = o.punchR ? 0.12 : 0;
  if (o.hit) { u.arms[0].rotation.z = 2.4; u.arms[1].rotation.z = 2.5; }
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

function updateEnemy(e, g, t) {
  const r = e.r;
  const frozen = e.freezeT > 0;
  const S = r * RIG_SCALE;
  g.position.set(e.x, 0, e.y);
  g.rotation.y = -e.face;
  g.scale.setScalar(S);
  const u = g.userData;
  const hitK = e.squash > 0 ? e.squash / 0.12 : (e.stun > 0 ? 0.5 : 0);
  const moving = !frozen && !(e.stun > 0) && Math.hypot(e.vx, e.vy) < 60;
  const wind = e.state === 'wind';
  if (!frozen) u.walk = (u.walk || 0) + 0.18 * (e.T.speed / 60) * (e.state === 'dash' ? 3 : 1);
  poseRig(g, {
    walk: u.walk, moving, hit: hitK,
    punchR: e.lunge > 0, lean: e.state === 'dash' ? 0.5 : (wind ? 0.35 : 0), crouch: wind,
  });
  if (e.squash > 0) { const q = e.squash / 0.12; g.scale.set(S * (1 + 0.15 * q), S * (1 - 0.2 * q), S * (1 + 0.15 * q)); }
  setRigLook(g, { frozen, burn: !!e.burn, flash: e.flash > 0 || (wind && Math.floor(t * 16) % 2 === 0) });
  if (u.fuse) u.fuse.material.color.set(Math.floor(t * 12) % 2 ? '#ffe14a' : '#ff5a1f');

  // 護盾
  if (e.shield > 0) {
    if (!u.shieldMesh) {
      u.shieldMesh = new THREE.Mesh(GEO.unitSphere, basic('#5fa8ff', { opacity: 0.28 }));
      scene.add(u.shieldMesh);
    }
    u.shieldMesh.visible = true;
    u.shieldMesh.position.set(e.x, S * 1.2, e.y);
    u.shieldMesh.scale.setScalar(S * 1.25);
  } else if (u.shieldMesh) u.shieldMesh.visible = false;

  // 減速圈
  if (e.slowT > 0 && !frozen) {
    if (!u.slowRing) {
      u.slowRing = new THREE.Mesh(GEO.ring, basic('#9be7ff', { opacity: 0.6 }));
      u.slowRing.rotation.x = -Math.PI / 2;
      scene.add(u.slowRing);
    }
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

// 被揍飛的身體：手腳攤開、空中翻滾、倒地
const bodyMap = new Map();
const bodyPool = [];
function updateBodies(bodies) {
  const alive = new Set(bodies);
  for (const [b, g] of bodyMap) if (!alive.has(b)) { g.visible = false; bodyMap.delete(b); bodyPool.push(g); }
  for (const b of bodies) {
    let g = bodyMap.get(b);
    if (!g) {
      g = bodyPool.pop() || createRig(GRAY_LOOK);
      g.visible = true;
      bodyMap.set(b, g);
      g.userData.dir = Math.atan2(b.vy, b.vx);
      g.userData.flail = Math.random() * 10;
    }
    const S = b.r * RIG_SCALE;
    g.scale.setScalar(S);
    const u = g.userData;
    const airborne = b.z > 0.5;
    u.flail += 0.3;
    // 手腳攤開亂揮
    u.arms[0].rotation.z = 2.6 + Math.sin(u.flail) * 0.5;
    u.arms[1].rotation.z = 2.4 + Math.cos(u.flail * 1.3) * 0.5;
    u.legs[0].rotation.x = 0.5; u.legs[1].rotation.x = -0.5;
    u.legs[0].rotation.z = airborne ? Math.sin(u.flail) * 0.6 : 0.2;
    u.legs[1].rotation.z = airborne ? -Math.sin(u.flail) * 0.6 : -0.2;
    u.body.rotation.z = 0; u.head.rotation.z = 0.3;
    if (airborne) {
      g.position.set(b.x, b.z, b.y);
      g.rotation.set(b.rot * 0.6, -u.dir, -b.rot); // 往後翻
    } else {
      g.position.set(b.x, S * 0.25, b.y);
      g.rotation.set(0, -u.dir, Math.PI / 2); // 仰躺在地上
    }
    setRigLook(g, { opacity: Math.min(1, b.life / 0.6) });
  }
}

// ---------- 主角 ----------
let player = null;
const armPool = [];
function buildPlayer() {
  const gloveMat = lambert('#ff3b3b');
  gloveMat.userData.base = new THREE.Color('#ff3b3b');
  player = createRig({ skin: '#f1bd8a', shirt: '#f1bd8a', pants: '#e8453c', hair: '#2a1a10', shoe: '#ffffff' }, { gloveMat, bigFists: true });
  const u = player.userData;
  u.gloveMat = gloveMat;
  u.skinMat = lambert('#f1bd8a');
  // 頭帶與飄帶
  const bandMat = lambert('#e8453c');
  const band = new THREE.Mesh(GEO.band, bandMat);
  band.rotation.x = Math.PI / 2; band.position.y = 0.1;
  u.head.add(band);
  const tail = new THREE.Mesh(GEO.box, bandMat);
  tail.scale.set(0.45, 0.05, 0.1); tail.position.set(-0.55, 0.1, 0.05);
  u.head.add(tail);
  u.tail = tail;
  // 短褲白邊
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.465, 0.47, 0.06, 14), lambert('#ffffff'));
  stripe.position.y = 0.2;
  u.body.add(stripe);
  player.scale.setScalar(PLAYER_R * RIG_SCALE);
  u.shield = new THREE.Mesh(GEO.unitSphere, basic('#7cc8ff', { opacity: 0.22 }));
  scene.add(u.shield);
}

function getArm(i) {
  if (!armPool[i]) {
    const arm = new THREE.Mesh(GEO.arm, player.userData.skinMat);
    const glove = new THREE.Mesh(GEO.unitSphere, player.userData.gloveMat);
    const streak = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    arm.castShadow = glove.castShadow = true;
    scene.add(arm); scene.add(glove); scene.add(streak);
    armPool[i] = { arm, glove, streak };
  }
  return armPool[i];
}

function updatePlayer(p, t, hurt, elements) {
  const S = PLAYER_R * RIG_SCALE;
  const u = player.userData;
  player.rotation.y = -p.facing;
  setRigLook(player, { flash: false });
  if (hurt) for (const m of u.mats) { m.emissive.setHex(0xff2020); m.emissiveIntensity = 0.6; }
  u.tail.rotation.y = Math.sin(t * 9) * 0.4;
  // 元素拳套顏色
  const gm = u.gloveMat;
  const sk = elements || {};
  if (sk.firePunch) { gm.color.set('#ff7a2a'); gm.emissive.set('#ff4400'); gm.emissiveIntensity = 0.5 + Math.random() * 0.3; }
  else if (sk.thunderPunch) { gm.color.set('#ffe14a'); gm.emissive.set('#ffd000'); gm.emissiveIntensity = Math.random() < 0.3 ? 0.9 : 0.3; }
  else if (sk.icePunch) { gm.color.set('#9be7ff'); gm.emissive.set('#3fb8ff'); gm.emissiveIntensity = 0.35; }
  else { gm.color.set('#ff3b3b'); gm.emissive.set('#000000'); gm.emissiveIntensity = 0; }

  const shoulderY = (0.85 + 0.86) * S;
  const busy = { '-1': false, '1': false };
  let ai = 0, lean = 0;
  for (const pu of p.punches) {
    const k = pu.t / pu.dur;
    // 快速打出 → 停住 → 收回
    let ext;
    if (k < 0.28) { const q = k / 0.28; ext = 1 - Math.pow(1 - q, 3); }
    else if (k < 0.5) ext = 1;
    else { const q = (k - 0.5) / 0.5; ext = 1 - q * q; }
    const impact = k >= 0.28 && k < 0.5;
    lean = Math.max(lean, ext);
    busy[pu.side] = true;
    const sa = p.facing + pu.side * Math.PI / 2;
    const sx = Math.cos(sa) * S * 0.5, sz = Math.sin(sa) * S * 0.5;
    const tgtY = pu.target && pu.target.r ? pu.target.r * RIG_SCALE * 1.7 : shoulderY;
    const gx = sx + (pu.tx - sx) * ext, gz = sz + (pu.ty - sz) * ext;
    const gy = shoulderY + (tgtY - shoulderY) * ext;
    const { arm, glove, streak } = getArm(ai++);
    arm.visible = glove.visible = true;
    const dir = new THREE.Vector3(gx - sx, gy - shoulderY, gz - sz);
    const len = dir.length();
    arm.position.set((sx + gx) / 2, (shoulderY + gy) / 2, (sz + gz) / 2);
    arm.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    arm.scale.set(S * 0.14, Math.max(1, len), S * 0.14);
    glove.position.set(gx, gy, gz);
    glove.scale.setScalar(S * (impact ? 0.48 : 0.34));
    // 出拳殘影
    const sOp = k < 0.45 ? (1 - k / 0.45) * 0.55 : 0;
    streak.visible = sOp > 0.02 && len > 20;
    if (streak.visible) {
      streak.position.copy(arm.position);
      streak.rotation.set(0, -Math.atan2(gz - sz, gx - sx), 0);
      streak.scale.set(len, S * 0.12, S * 0.5);
      streak.material.opacity = sOp;
    }
  }
  for (let i = ai; i < armPool.length; i++) { armPool[i].arm.visible = false; armPool[i].glove.visible = false; armPool[i].streak.visible = false; }
  // 出拳中的那隻手藏起來（由伸長的手臂取代）
  u.arms[0].visible = !busy['-1'];
  u.arms[1].visible = !busy['1'];
  poseRig(player, { walk: t * 6, moving: false, lean: lean * 0.25 });
  player.position.set(Math.cos(p.facing) * lean * 6, 0, Math.sin(p.facing) * lean * 6);
  u.shield.visible = !!p.shield;
  u.shield.position.set(0, S * 1.2, 0);
  u.shield.scale.setScalar(S * 1.5);
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
  points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 8, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
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
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8, rr = i % 2 ? 22 : 64;
    g.lineTo(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
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
    pointCol[n * 3] = tmpColor.r * a + 0.1; pointCol[n * 3 + 1] = tmpColor.g * a + 0.05; pointCol[n * 3 + 2] = tmpColor.b * a;
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
      m.scale.setScalar((44 + k * 40) * f.size);
      m.material.color.set(f.color);
      m.material.opacity = a;
      m.material.rotation = f.x * 0.1;
      const sh = take('shock', mkShock);
      sh.position.copy(m.position);
      sh.scale.setScalar((20 + k * 90) * f.size);
      sh.material.color.set(f.color);
      sh.material.opacity = a * 0.9;
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
R3D.render = (run, demo, t, shake) => {
  beginPools();
  const p = run ? run.p : demo;
  // 鏡頭
  let sx = 0, sz = 0;
  if (shake) {
    const osc = Math.sin(t * 70) * shake;
    const d = run ? run.shakeDir || 0 : 0;
    sx = Math.cos(d) * osc + (Math.random() * 2 - 1) * shake * 0.3;
    sz = Math.sin(d) * osc + (Math.random() * 2 - 1) * shake * 0.3;
  }
  const dist = camDist * (1 - (run ? run.zoom || 0 : 0));
  camera.position.set(camTarget.x + sx, camTarget.y + Math.cos(TILT) * dist, camTarget.z + Math.sin(TILT) * dist + sz);
  camera.lookAt(camTarget.x + sx, camTarget.y, camTarget.z + sz);

  updatePlayer(p, t, run && p.hurtT > 0, run && run.skills);
  rangeRing.visible = !!run;
  if (run) {
    rangeRing.scale.setScalar(p.range);
    // 敵人
    const alive = new Set();
    for (const e of run.enemies) {
      if (e.dead) continue;
      alive.add(e);
      updateEnemy(e, getEnemyMesh(e), t);
    }
    for (const [e, g] of enemyMap) if (!alive.has(e)) releaseEnemy(e, g);
    updateBodies(run.bodies);
    syncFx(run, t);
    updateCrowd(t, Math.min(1, run.combo / 60));
  } else {
    for (const [e, g] of enemyMap) releaseEnemy(e, g);
    updateBodies([]);
    points.geometry.setDrawRange(0, 0);
    orbXp.count = orbGold.count = 0;
    updateCrowd(t, 0.2);
  }
  endPools();
  renderer.render(scene, camera);
};
})();
