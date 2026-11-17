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
const TILT = 0.62;
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
  const dW = (ARENA * 1.12) / Math.tan(hHalf);
  const dH = (ARENA * 1.02) / (Math.tan(v) * usableV);
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

// ---------- 角色 ----------
const WHITE = new THREE.Color(1, 1, 1);
function shadeHex(hex, f) {
  tmpColor.set(hex);
  if (f > 1) tmpColor.lerp(WHITE, f - 1); else tmpColor.multiplyScalar(f);
  return tmpColor.getHex();
}

function createFigure(color, headColor) {
  const g = new THREE.Group();
  const mBody = lambert(color), mHead = lambert(headColor || shadeHex(color, 1.2)), mFist = lambert(shadeHex(color, 0.7));
  const body = new THREE.Mesh(GEO.body, mBody);
  const head = new THREE.Mesh(GEO.head, mHead);
  head.position.y = 1.65;
  const fistL = new THREE.Mesh(GEO.fist, mFist), fistR = new THREE.Mesh(GEO.fist, mFist);
  fistL.position.set(0.7, 0.95, -0.72); fistR.position.set(0.7, 0.95, 0.72);
  for (const m of [body, head, fistL, fistR]) { m.castShadow = true; g.add(m); }
  g.userData = { body, head, fistL, fistR, mats: [mBody, mHead, mFist], color: new THREE.Color(color), headColor: mHead.color.clone(), fistColor: mFist.color.clone() };
  scene.add(g);
  return g;
}

function setFigureLook(g, o) {
  const u = g.userData;
  const [mb, mh, mf] = u.mats;
  if (o.frozen) {
    mb.color.set('#a8e4ff'); mh.color.set('#c8f0ff'); mf.color.set('#8fd0f0');
  } else {
    mb.color.copy(u.color); mh.color.copy(u.headColor); mf.color.copy(u.fistColor);
  }
  const em = o.flash ? 0xffffff : (o.burn ? 0xff5a10 : 0x000000);
  const ei = o.flash ? 0.9 : (o.burn ? 0.35 + Math.random() * 0.25 : 0);
  for (const m of u.mats) { m.emissive.setHex(em); m.emissiveIntensity = ei; }
  if (o.opacity !== undefined) {
    for (const m of u.mats) { m.transparent = o.opacity < 1; m.opacity = o.opacity; }
  }
}

function addExtras(g, type, T) {
  const ex = new THREE.Group();
  if (type === 'bomber') {
    const fuse = new THREE.Mesh(GEO.unitSphere, new THREE.MeshBasicMaterial({ color: '#ffb020' }));
    fuse.scale.setScalar(0.22); fuse.position.set(-0.3, 2.3, 0);
    ex.add(fuse); g.userData.fuse = fuse;
    const bomb = new THREE.Mesh(GEO.unitSphere, lambert('#22222a'));
    bomb.scale.setScalar(0.5); bomb.position.set(-0.75, 0.9, 0);
    ex.add(bomb);
  } else if (type === 'spore') {
    for (const [x, z] of [[0.2, -0.25], [-0.15, 0.25], [0.32, 0.22], [-0.25, -0.15]]) {
      const d = new THREE.Mesh(GEO.unitSphere, lambert('#eef7cc'));
      d.scale.setScalar(0.13); d.position.set(x, 2.15, z);
      ex.add(d);
    }
  } else if (type === 'drummer') {
    const drum = new THREE.Mesh(GEO.cyl, lambert('#d8e4f5'));
    drum.scale.set(0.45, 0.4, 0.45); drum.position.set(0.85, 0.75, 0);
    ex.add(drum);
  } else if (type === 'thrower') {
    const bottle = new THREE.Mesh(GEO.cyl, lambert('#6b4a2b'));
    bottle.scale.set(0.15, 0.6, 0.15); bottle.position.set(0.7, 1.3, 0.72);
    ex.add(bottle);
  } else if (type === 'goldie') {
    const bag = new THREE.Mesh(GEO.unitSphere, lambert('#c9952a'));
    bag.scale.set(0.55, 0.5, 0.55); bag.position.set(-0.75, 1.1, 0);
    ex.add(bag);
  } else if (type === 'runner') {
    const band = new THREE.Mesh(GEO.torus, lambert('#ffffff'));
    band.rotation.x = Math.PI / 2; band.position.y = 1.75;
    ex.add(band);
  } else if (type === 'tank' || type === 'charger') {
    const horns = type === 'charger';
    if (horns) for (const s of [-1, 1]) {
      const h = new THREE.Mesh(GEO.cone, lambert('#efe6d0'));
      h.scale.set(0.12, 0.45, 0.12); h.position.set(0.25, 2.1, s * 0.35); h.rotation.x = s * 0.5;
      ex.add(h);
    }
  }
  if (T.boss) {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.3, 5, 1, true), lambert('#ffd84a', { side: THREE.DoubleSide, emissive: 0x553300 }));
    crown.position.y = 2.25;
    ex.add(crown);
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(GEO.cone, lambert('#ffd84a', { emissive: 0x553300 }));
      const a = i * Math.PI * 2 / 5;
      sp.scale.set(0.09, 0.25, 0.09); sp.position.set(Math.cos(a) * 0.4, 2.5, Math.sin(a) * 0.4);
      ex.add(sp);
    }
  }
  ex.traverse(m => { if (m.isMesh) m.castShadow = true; });
  g.add(ex);
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
    g = createFigure(e.T.color);
    addExtras(g, e.type, e.T);
    g.userData.type = e.type;
  }
  g.visible = true;
  enemyMap.set(e, g);
  return g;
}
function releaseEnemy(e, g) {
  g.visible = false;
  if (g.userData.shieldMesh) g.userData.shieldMesh.visible = false;
  if (g.userData.warn) g.userData.warn.visible = false;
  if (g.userData.slowRing) g.userData.slowRing.visible = false;
  enemyMap.delete(e);
  enemyPool[g.userData.type].push(g);
}

function updateEnemy(e, g, t) {
  const r = e.r;
  const frozen = e.freezeT > 0;
  const step = frozen ? 0 : Math.sin(e.anim * 10);
  g.position.set(e.x, Math.abs(step) * r * 0.12, e.y);
  g.rotation.y = -e.face;
  g.scale.setScalar(r * VIS);
  const u = g.userData;
  const lunge = e.lunge > 0 ? 0.6 : 0;
  u.fistL.position.x = 0.7 + step * 0.25 + lunge;
  u.fistR.position.x = 0.7 - step * 0.25;
  const wind = e.state === 'wind';
  if (wind) { u.body.scale.set(1.1, 0.85, 1.1); } else u.body.scale.set(1, 1, 1);
  setFigureLook(g, { frozen, burn: !!e.burn, flash: e.flash > 0 || (wind && Math.floor(t * 16) % 2 === 0) });
  if (u.fuse) u.fuse.material.color.set(Math.floor(t * 12) % 2 ? '#ffe14a' : '#ff5a1f');

  // 護盾
  if (e.shield > 0) {
    if (!u.shieldMesh) {
      u.shieldMesh = new THREE.Mesh(GEO.unitSphere, basic('#5fa8ff', { opacity: 0.28 }));
      scene.add(u.shieldMesh);
    }
    u.shieldMesh.visible = true;
    u.shieldMesh.position.set(e.x, r * 1.1, e.y);
    u.shieldMesh.scale.setScalar(r * 1.45);
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
    u.slowRing.scale.setScalar(r * 1.25);
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

// 被揍飛的身體
const bodyMap = new Map();
const bodyPool = [];
function updateBodies(bodies) {
  const alive = new Set(bodies);
  for (const [b, g] of bodyMap) if (!alive.has(b)) { g.visible = false; bodyMap.delete(b); bodyPool.push(g); }
  for (const b of bodies) {
    let g = bodyMap.get(b);
    if (!g) {
      g = bodyPool.pop() || createFigure('#7b808c', '#959aa6');
      g.visible = true;
      bodyMap.set(b, g);
      g.userData.dir = Math.atan2(b.vy, b.vx);
    }
    g.scale.setScalar(b.r * VIS);
    const airborne = b.z > 0.5;
    g.position.set(b.x, b.z + (airborne ? b.r * 0.6 : b.r * 0.35), b.y);
    if (airborne) g.rotation.set(b.rot, -g.userData.dir, b.rot * 0.7);
    else g.rotation.set(0, -g.userData.dir, Math.PI / 2); // 倒在地上
    setFigureLook(g, { opacity: Math.min(1, b.life / 0.6) });
  }
}

// ---------- 主角 ----------
let player = null;
const armPool = [];
function buildPlayer() {
  player = createFigure('#ffc83d', '#3a2618');
  player.remove(player.userData.fistL); player.remove(player.userData.fistR);
  const band = new THREE.Mesh(GEO.torus, lambert('#e8453c'));
  band.rotation.x = Math.PI / 2; band.position.y = 1.72;
  player.add(band);
  const tail = new THREE.Mesh(GEO.box, lambert('#e8453c'));
  tail.scale.set(0.7, 0.08, 0.16); tail.position.set(-0.75, 1.72, 0.1);
  player.add(tail);
  player.userData.tail = tail;
  // 臉（朝前的膚色）
  const face = new THREE.Mesh(GEO.unitSphere, lambert('#f4c38f'));
  face.scale.set(0.3, 0.38, 0.42); face.position.set(0.32, 1.62, 0);
  player.add(face);
  player.scale.setScalar(PLAYER_R * VIS);
  // 待命的拳套
  const gloveMat = lambert('#ff4d4d');
  player.userData.idleGloves = [-1, 1].map(() => {
    const m = new THREE.Mesh(GEO.unitSphere, gloveMat);
    m.castShadow = true;
    scene.add(m);
    return m;
  });
  player.userData.gloveMat = gloveMat;
  player.userData.skinMat = lambert('#f4c38f');
  // 護盾
  player.userData.shield = new THREE.Mesh(GEO.unitSphere, basic('#7cc8ff', { opacity: 0.22 }));
  scene.add(player.userData.shield);
}

function getArm(i) {
  if (!armPool[i]) {
    const arm = new THREE.Mesh(GEO.arm, player.userData.skinMat);
    const glove = new THREE.Mesh(GEO.unitSphere, player.userData.gloveMat);
    arm.castShadow = glove.castShadow = true;
    scene.add(arm); scene.add(glove);
    armPool[i] = { arm, glove };
  }
  return armPool[i];
}

function updatePlayer(p, t, hurt) {
  const R = PLAYER_R * VIS;
  player.position.set(0, 0, 0);
  player.rotation.y = -p.facing;
  setFigureLook(player, { flash: false });
  if (hurt) for (const m of player.userData.mats) { m.emissive.setHex(0xff2020); m.emissiveIntensity = 0.6; }
  player.userData.tail.rotation.y = Math.sin(t * 9) * 0.4;
  const shoulderY = R * 1.0;
  const busy = { '-1': false, '1': false };
  let ai = 0;
  for (const pu of p.punches) {
    const k = pu.t / pu.dur;
    const ext = k < 0.45 ? k / 0.45 : 1 - (k - 0.45) / 0.55;
    busy[pu.side] = true;
    const sa = p.facing + pu.side * Math.PI / 2;
    const sx = Math.cos(sa) * R * 0.7, sz = Math.sin(sa) * R * 0.7;
    const tgtY = pu.target && pu.target.r ? pu.target.r * VIS * 1.1 : R;
    const gx = sx + (pu.tx - sx) * ext, gz = sz + (pu.ty - sz) * ext;
    const gy = shoulderY + (tgtY - shoulderY) * ext + Math.sin(ext * Math.PI) * 10;
    const { arm, glove } = getArm(ai++);
    arm.visible = glove.visible = true;
    const from = tmpV.set(sx, shoulderY, sz);
    const dir = new THREE.Vector3(gx - sx, gy - shoulderY, gz - sz);
    const len = dir.length();
    arm.position.set((sx + gx) / 2, (shoulderY + gy) / 2, (sz + gz) / 2);
    arm.quaternion.setFromUnitVectors(UP, dir.normalize());
    arm.scale.set(R * 0.17, Math.max(1, len), R * 0.17);
    glove.position.set(gx, gy, gz);
    glove.scale.setScalar(R * (0.48 + ext * 0.12));
  }
  for (let i = ai; i < armPool.length; i++) { armPool[i].arm.visible = false; armPool[i].glove.visible = false; }
  const sides = [-1, 1];
  player.userData.idleGloves.forEach((m, i) => {
    const side = sides[i];
    m.visible = !busy[side];
    const a = p.facing + side * 0.8;
    m.position.set(Math.cos(a) * R * 1.05, R * 1.05 + Math.sin(t * 6 + i) * 1.5, Math.sin(a) * R * 1.05);
    m.scale.setScalar(R * 0.46);
  });
  const sh = player.userData.shield;
  sh.visible = !!p.shield;
  sh.position.set(0, R * 1.1, 0);
  sh.scale.setScalar(R * 1.9);
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
  points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 6, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
  points.frustumCulled = false;
  scene.add(points);
  orbXp = new THREE.InstancedMesh(GEO.unitSphere, new THREE.MeshBasicMaterial({ color: '#5ef2a0' }), 400);
  orbGold = new THREE.InstancedMesh(GEO.unitSphere, new THREE.MeshBasicMaterial({ color: '#ffd84a' }), 200);
  orbXp.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  orbGold.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  orbXp.frustumCulled = orbGold.frustumCulled = false;
  scene.add(orbXp); scene.add(orbGold);
}

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
    const s = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#cfe6ff', transparent: true }));
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
    pointPos[n * 3] = f.x; pointPos[n * 3 + 1] = 18 + (1 - a) * 14; pointPos[n * 3 + 2] = f.y;
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
        s.scale.set(len, 3, 3);
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
  const sx = shake ? (Math.random() * 2 - 1) * shake : 0, sz = shake ? (Math.random() * 2 - 1) * shake : 0;
  camera.position.set(camTarget.x + sx, camTarget.y + Math.cos(TILT) * camDist, camTarget.z + Math.sin(TILT) * camDist + sz);
  camera.lookAt(camTarget.x + sx, camTarget.y, camTarget.z + sz);

  updatePlayer(p, t, run && p.hurtT > 0);
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
