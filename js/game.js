// ===== RL Fight：主程式（俯視擂台、自動出拳、大量敵人） =====
(() => {
'use strict';

const ARENA = 300;        // 擂台半徑（世界座標）
const PLAYER_R = 18;
const WAVES_PER_CHAPTER = 10;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const pauseBtn = document.getElementById('pauseBtn');
const ultBtn = document.getElementById('ultBtn');

let SW = 0, SH = 0, S = 1, CX = 0, CY = 0;

// ---------- 畫面縮放 ----------
function resize() {
  SW = document.body.clientWidth || window.innerWidth;
  SH = document.body.clientHeight || window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(SW * dpr);
  canvas.height = Math.round(SH * dpr);
  canvas.style.width = SW + 'px';
  canvas.style.height = SH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const topUI = 96, botUI = 110;
  S = Math.min(SW / (ARENA * 2 + 50), (SH - topUI - botUI) / (ARENA * 2 + 50));
  CX = SW / 2;
  CY = topUI + (SH - topUI - botUI) / 2;
  document.getElementById('stage').style.fontSize = clamp(Math.min(SW, SH) / 40, 11, 18) + 'px';
  R3D.resize(SW, SH, window.devicePixelRatio || 1);
}

// ---------- 存檔 ----------
const SAVE_KEY = 'rlfight_save_v2';
function defaultSave() { return { bank: 0, best: 0, bestChapter: 0, bestWave: 0, meta: {} }; }
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s) return Object.assign(defaultSave(), s);
  } catch (e) { /* 使用預設 */ }
  return defaultSave();
}
function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 忽略 */ } }
let save = loadSave();
const metaLv = id => save.meta[id] || 0;

// ---------- 音效 ----------
let actx = null, muted = false, lastHitSound = 0, lastSwing = 0;
function ensureAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume();
}
function tone(freq, dur, type = 'square', vol = 0.05, slide = 0, delay = 0) {
  if (!actx || muted) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
let noiseBuf = null;
function noise(dur, vol = 0.1, filter = 0, ftype = 'lowpass') {
  if (!actx || muted) return;
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = actx.currentTime, s = actx.createBufferSource(), g = actx.createGain();
  s.buffer = noiseBuf;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (filter) {
    const f = actx.createBiquadFilter();
    f.type = ftype; f.frequency.value = filter;
    s.connect(f).connect(g).connect(actx.destination);
  } else s.connect(g).connect(actx.destination);
  s.start(t); s.stop(t + dur);
}
const SFX = {
  hit: () => {
    const n = performance.now(); if (n - lastHitSound < 30) return; lastHitSound = n;
    noise(0.09, 0.32, 900);            // 悶響
    tone(120, 0.12, 'sine', 0.3, -80);  // 低頻「砰」
    noise(0.03, 0.16, 3000, 'highpass'); // 皮革拍擊
    tone(60, 0.16, 'sine', 0.25, -25);   // 胸腔共鳴
  },
  crit: () => {
    noise(0.16, 0.4, 700);
    tone(95, 0.2, 'sine', 0.35, -60);
    tone(1800, 0.06, 'square', 0.05, -1200);
    noise(0.05, 0.2, 4000, 'highpass');
  },
  swing: () => { const n = performance.now(); if (n - lastSwing < 70) return; lastSwing = n; noise(0.08, 0.05, 1600, 'bandpass'); },
  hurt: () => { noise(0.15, 0.12); tone(110, 0.2, 'sawtooth', 0.07, -50); },
  boom: () => { noise(0.35, 0.35, 600); tone(60, 0.35, 'sine', 0.3, -30); },
  zap: () => tone(1400, 0.08, 'sawtooth', 0.03, -900),
  level: () => { tone(523, 0.1, 'square', 0.05); tone(659, 0.1, 'square', 0.05, 0, 0.08); tone(880, 0.18, 'square', 0.05, 0, 0.16); },
  pick: () => tone(660, 0.08, 'triangle', 0.05, 220),
  wave: () => { tone(392, 0.12, 'triangle', 0.07); tone(523, 0.18, 'triangle', 0.07, 0, 0.1); },
  boss: () => { tone(110, 0.5, 'sawtooth', 0.08, -30); tone(82, 0.6, 'sawtooth', 0.08, -20, 0.25); },
  ult: () => { noise(0.5, 0.25); tone(60, 0.6, 'sawtooth', 0.15, 200); },
  over: () => { tone(392, 0.2, 'triangle', 0.08); tone(311, 0.2, 'triangle', 0.08, 0, 0.18); tone(196, 0.5, 'triangle', 0.08, 0, 0.36); },
};

// ---------- 小工具 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
function weighted(list) {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = Math.random() * total;
  for (const [v, w] of list) { r -= w; if (r <= 0) return v; }
  return list[list.length - 1][0];
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}
function fmt(n) { return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n).toString(); }

// ---------- 遊戲狀態 ----------
// title | play | levelup | pause | chapter | gameover | shop
let state = 'title';
let run = null;
let time = 0;

function newPlayer() {
  return {
    x: 0, y: 0, hp: 100, maxHp: 100, baseDmg: 5, dmgMult: 1, rate: 0.3, range: 150,
    crit: 0.05, critDmg: 1.6, regen: 0, lifesteal: 0, kb: 1, xpGain: 1, skillDmg: 1, multi: 1,
    goldMult: 1, slots: 3, revives: 0, shield: 0, shieldT: 0,
    facing: -Math.PI / 2, punchT: 0, armSide: 1, punches: [], hurtT: 0,
  };
}
const pDmg = () => run.p.baseDmg * run.p.dmgMult;

function newRun() {
  const p = newPlayer();
  p.dmgMult += 0.08 * metaLv('atk');
  p.maxHp += 10 * metaLv('body'); p.hp = p.maxHp;
  p.rate *= Math.pow(0.97, metaLv('speed'));
  p.range += 5 * metaLv('reach');
  p.crit += 0.01 * metaLv('eye');
  p.goldMult += 0.08 * metaLv('luck');
  p.slots += metaLv('slot');
  p.revives = metaLv('revive');
  run = {
    p, chapter: 1, wave: 0, level: 1, xp: 0, xpNeed: 5, gold: 0, kills: 0, score: 0,
    combo: 0, comboIdle: 0, maxCombo: 0, ult: 0, ultMax: 60,
    enemies: [], projs: [], eprojs: [], fx: [], texts: [], bodies: [], zones: [], orbs: [], marks: [],
    skills: {}, stats: {}, syn: {}, rerolls: metaLv('reroll'),
    toSpawn: [], spawnT: 0, waveActive: false, waveDelay: 1.2, bossRef: null,
    shake: 0, shakeDir: 0, zoom: 0, slowmo: 0, comboPop: 0, hitstop: 0, flash: 0, banner: null, pendingLevels: 0, choices: [],
    skillFlash: {}, castCount: {},
  };
}

// 元素是否擁有
function hasElement(el) {
  for (const id in run.skills) if (SKILL_INFO[id].element === el) return true;
  return false;
}
const skillLv = id => (run.skills[id] ? run.skills[id].lv : 0);

// ---------- 連擊表 ----------
const COMBO_TIERS = [0, 10, 25, 50, 100];
function comboTier() {
  let t = 0;
  for (let i = 0; i < COMBO_TIERS.length; i++) if (run.combo >= COMBO_TIERS[i]) t = i;
  return t + 1; // 1~5
}
const COMBO_DMG = [1, 1, 1.1, 1.2, 1.3, 1.5];

// ---------- 波次 ----------
function scaling() {
  const c = run.chapter, w = run.wave;
  return {
    hp: Math.pow(1.75, c - 1) * (1 + 0.09 * (w - 1)),
    dmg: Math.pow(1.35, c - 1) * (1 + 0.05 * (w - 1)),
  };
}

function buildWave() {
  const c = run.chapter, w = run.wave;
  const q = [];
  if (w === WAVES_PER_CHAPTER) {
    q.push({ type: BOSS_ORDER[(c - 1) % BOSS_ORDER.length], delay: 1.2 });
    const n = 10 + c * 4;
    for (let i = 0; i < n; i++) q.push({ type: Math.random() < 0.7 ? 'grunt' : 'runner', delay: 0.6 });
    return q;
  }
  const pool = [['grunt', 10]];
  if (w >= 2 || c > 1) pool.push(['runner', 5]);
  if (w >= 4 || c > 1) pool.push(['tank', 2 + c]);
  if (w >= 5 || c > 1) pool.push(['bomber', 3]);
  if (w >= 6 || c > 1) pool.push(['charger', 2 + c * 0.5]);
  if (w >= 7 || c > 1) pool.push(['spore', 2.5]);
  if (w >= 8 || c > 1) pool.push(['drummer', 1.5 + c * 0.5]);
  const count = Math.round(14 + w * 5 + (c - 1) * 12);
  const base = Math.max(0.12, 0.7 - w * 0.04 - (c - 1) * 0.07);
  for (let i = 0; i < count; i++) {
    // 一次湧上一小群
    const group = Math.random() < 0.25 ? Math.floor(rand(3, 7)) : 1;
    const type = weighted(pool);
    for (let g = 0; g < group && i < count; g++, i++) q.push({ type, delay: g === 0 ? base * rand(0.5, 1.8) : 0.05 });
    i--;
  }
  if (Math.random() < 0.6) q.splice(Math.floor(q.length / 2), 0, { type: 'goldie', delay: 0.3 });
  return q;
}

function startWave() {
  run.wave++;
  run.toSpawn = buildWave();
  run.spawnT = run.toSpawn[0].delay;
  run.waveActive = true;
  if (run.wave === WAVES_PER_CHAPTER) { setBanner('頭目來襲！', '#ff5a4a'); SFX.boss(); }
  else { setBanner(`第 ${run.wave} 波`, '#ffd84a'); SFX.wave(); }
}

function setBanner(text, color, t = 1.5) { run.banner = { text, color, t, max: t }; }

function spawnEnemy(type, at) {
  const T = ENEMY_TYPES[type];
  const sc = scaling();
  const ang = at ? 0 : rand(0, Math.PI * 2);
  const R = ARENA + 30;
  const hp = Math.round(T.hp * sc.hp * (T.boss ? 1 + (run.chapter - 1) * 0.3 : 1));
  const e = {
    type, T, x: at ? at.x : Math.cos(ang) * R, y: at ? at.y : Math.sin(ang) * R,
    vx: 0, vy: 0, hp, maxHp: hp, shield: 0, r: T.r, dmg: Math.round(T.dmg * sc.dmg),
    speed: T.speed * rand(0.9, 1.1), atkT: rand(0.3, 0.8), anim: rand(0, 10), flash: 0,
    burn: null, slowT: 0, freezeT: 0, dead: false, face: 0,
    ability: rand(1, 3), state: 'walk', stateT: 0, life: 0, hitBy: {},
  };
  run.enemies.push(e);
  if (T.boss) run.bossRef = e;
  return e;
}

// ---------- 戰鬥 ----------
function nearestEnemies(range, n, from = run.p, exclude = null) {
  const list = [];
  for (const e of run.enemies) {
    if (e.dead || e === exclude) continue;
    const d = Math.sqrt(dist2(e, from)) - e.r;
    if (d <= range) list.push([d, e]);
  }
  list.sort((a, b) => a[0] - b[0]);
  return list.slice(0, n).map(x => x[1]);
}

function updatePlayer(dt) {
  const p = run.p;
  p.hurtT -= dt;
  if (p.regen) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
  // 連擊表：一陣子沒打倒敵人就開始流失
  run.comboIdle += dt;
  if (run.comboIdle > 2.2 && run.combo > 0) run.combo = Math.max(0, run.combo - dt * Math.max(8, run.combo * 0.6));
  const tier = comboTier();
  if (tier >= 3) {
    p.shieldT -= dt;
    if (p.shield === 0 && p.shieldT <= 0) { p.shield = 1; p.shieldT = 6; }
  }
  // 自動出拳
  p.punchT -= dt;
  const rate = p.rate * (tier >= 4 ? 0.75 : 1);
  if (p.punchT <= 0) {
    const targets = nearestEnemies(p.range, p.multi);
    if (targets.length) {
      p.punchT = rate;
      for (const t of targets) launchPunch(t, rate);
    }
  }
  for (const pu of p.punches) {
    pu.t += dt;
    if (!pu.target.dead) { pu.tx = pu.target.x; pu.ty = pu.target.y; }
    if (!pu.hit && pu.t >= pu.dur * pu.hitFrac) { pu.hit = true; pu.impact = true; punchHit(pu.target); }
  }
  p.punches = p.punches.filter(pu => pu.t < pu.dur);
}

function launchPunch(target, rate) {
  const p = run.p;
  p.armSide = -p.armSide;
  p.facing = Math.atan2(target.y, target.x);
  p.punches.push({ target, tx: target.x, ty: target.y, side: p.armSide, t: 0, dur: Math.min(0.32, rate * 0.9), hitFrac: 0.5, hit: false });
  SFX.swing();
}

function punchHit(e) {
  if (e.dead) return;
  if (e.bottle) {
    e.dead = true;
    spark(e.x, e.y, '#c8a070', 8);
    addText(e.x, e.y - 12, '打掉!', '#9be7ff', 14);
    SFX.hit();
    return;
  }
  const p = run.p;
  const dir = Math.atan2(e.y, e.x);
  let dmg = pDmg() * COMBO_DMG[comboTier()];
  let crit = Math.random() < p.crit + (comboTier() >= 5 ? 0.15 : 0);
  if (e.freezeT > 0 && run.syn.shatter) crit = true;
  if (crit) dmg *= p.critDmg;
  damageEnemy(e, dmg, { crit, dir, kb: 260 * p.kb, punch: true, show: true });
  // 被動技能
  if (run.skills.firePunch) applyBurn(e, pDmg() * (0.4 + 0.15 * skillLv('firePunch')), 2.5);
  if (run.skills.icePunch) {
    applySlow(e, 1.5);
    if (Math.random() < 0.08 + 0.05 * skillLv('icePunch')) applyFreeze(e, 1);
  }
  if (run.skills.thunderPunch && Math.random() < 0.15 + 0.08 * skillLv('thunderPunch')) {
    chainLightning(e, 2 + (run.syn.arc ? 2 : 0), pDmg() * 0.7, true);
  }
  if (run.skills.bounce) {
    const lv = skillLv('bounce');
    let from = e, hits = 1 + Math.floor(lv / 2);
    const done = new Set([e]);
    for (let i = 0; i < hits; i++) {
      const next = run.enemies.find(o => !o.dead && !done.has(o) && dist2(o, from) < 120 * 120);
      if (!next) break;
      done.add(next);
      run.fx.push({ kind: 'line', x1: from.x, y1: from.y, x2: next.x, y2: next.y, color: '#ffe08a', w: 5, life: 0.15, max: 0.15 });
      damageEnemy(next, pDmg() * (0.45 + 0.08 * lv), { dir: Math.atan2(next.y - from.y, next.x - from.x), kb: 80 });
      from = next;
    }
  }
}

function damageEnemy(e, amount, o = {}) {
  if (e.dead) return 0;
  let a = amount;
  if (e.burn && run.syn.fuel) a *= 1.3;
  if (e.slowT > 0 && run.syn.frostbite) a *= 1.25;
  if (e.shield > 0) { const ab = Math.min(e.shield, a); e.shield -= ab; a -= ab; }
  e.hp -= a;
  e.flash = 0.08;
  if (o.kb) {
    const k = o.kb / e.T.mass;
    e.vx += Math.cos(o.dir) * k;
    e.vy += Math.sin(o.dir) * k;
  }
  if (run.p.lifesteal && a > 0) run.p.hp = Math.min(run.p.maxHp, run.p.hp + a * run.p.lifesteal);
  if (o.show || o.crit || a >= pDmg() * 3) {
    if (run.texts.length < 70) addText(e.x + rand(-6, 6), e.y, o.crit ? fmt(a) + '!' : fmt(a), o.crit ? '#ffd23a' : '#ffffff', o.crit ? 30 : 20);
  }
  e.squash = 0.12;
  if (o.punch) {
    const hx = e.x - Math.cos(o.dir) * e.r, hy = e.y - Math.sin(o.dir) * e.r;
    const h = e.r * 2.2;
    const col = o.crit ? '#ffd23a' : ELEMENT_HIT();
    // 往出拳方向噴的火花
    for (let i = 0; i < (o.crit ? 22 : 12); i++) {
      const a = o.dir + rand(-0.55, 0.55), sp = rand(200, 560);
      run.fx.push({ kind: 'dot', x: hx, y: hy, z: h, vz: rand(-40, 260), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: rand(3, 7), color: Math.random() < 0.6 ? col : '#ffffff', life: rand(0.18, 0.4), max: 0.4 });
    }
    // 分層：白閃 → 星芒 → 速度線、貫穿震波 → 煙
    run.fx.push({ kind: 'flash', x: hx, y: hy, h, size: o.crit ? 1.8 : 1.1, life: 0.06, max: 0.06 });
    run.fx.push({ kind: 'impact', x: hx, y: hy, h, dir: o.dir, rot: rand(0, Math.PI * 2), size: o.crit ? 1.7 : 1, color: col, life: 0.16, max: 0.16 });
    run.fx.push({ kind: 'lines', x: hx, y: hy, h, dir: o.dir, n: o.crit ? 10 : 6, seed: Math.random() * 100, color: col, life: 0.18, max: 0.18 });
    run.fx.push({ kind: 'dring', x: e.x, y: e.y, h, dir: o.dir, r: 4, maxR: o.crit ? 60 : 36, color: col, life: 0.22, max: 0.22 });
    for (let i = 0; i < 4; i++) {
      const a = o.dir + rand(-1, 1);
      run.fx.push({ kind: 'smoke', x: e.x, y: e.y, h: rand(5, h), vx: Math.cos(a) * rand(30, 90), vy: Math.sin(a) * rand(30, 90), size: rand(12, 22), life: rand(0.35, 0.55), max: 0.55 });
    }
    if (o.crit && Math.random() < 0.45) addComic(e.x, e.y, o.dir);
    e.stun = Math.max(e.stun || 0, o.crit ? 0.35 : 0.2);
    run.hitstop = Math.max(run.hitstop, o.crit ? 0.08 : 0.04);
    run.shake = Math.max(run.shake, o.crit ? 13 : 6);
    run.shakeDir = o.dir;
    if (o.crit) run.zoom = Math.max(run.zoom, 0.035);
    if (o.crit) SFX.crit(); else SFX.hit();
  }
  if (e.hp <= 0) killEnemy(e, o);
  return a;
}

function killEnemy(e, o = {}) {
  e.dead = true;
  const p = run.p;
  run.kills++;
  run.combo = Math.floor(run.combo) + 1;
  run.comboIdle = 0;
  run.comboPop = 0.15;
  const CALL = { 10: ['不錯！', '#ffe14a'], 25: ['很猛！', '#ffb03a'], 50: ['無雙！', '#ff7a3c'], 100: ['拳神降臨！', '#ff4fd8'], 200: ['天下無敵！', '#ff4fd8'] };
  if (CALL[run.combo]) { setBanner(CALL[run.combo][0], CALL[run.combo][1], 1.1); SFX.level(); }
  run.maxCombo = Math.max(run.maxCombo, run.combo);
  run.ult = Math.min(run.ultMax, run.ult + (e.T.boss ? 20 : 1));
  run.score += Math.round(e.T.xp * 10 * COMBO_DMG[comboTier()]);
  // 經驗與金幣飛向主角
  run.orbs.push({ x: e.x, y: e.y, kind: 'xp', v: e.T.xp, t: 0, vx: rand(-60, 60), vy: rand(-60, 60) });
  const g = Math.max(1, Math.round(e.T.gold * p.goldMult));
  if (e.T.gold >= 3 || Math.random() < 0.35) run.orbs.push({ x: e.x, y: e.y, kind: 'gold', v: g, t: 0, vx: rand(-80, 80), vy: rand(-80, 80) });
  // 被揍飛的身體
  const dir = o.dir !== undefined ? o.dir : Math.atan2(e.y, e.x);
  const sp = rand(520, 780) / Math.sqrt(e.T.mass) * (e.T.boss ? 0.4 : 1);
  if (o.punch) {
    if (Math.random() < 0.18) addComic(e.x, e.y, dir);
    run.hitstop = Math.max(run.hitstop, 0.06);
    run.shake = Math.max(run.shake, 9);
    if (o.crit) { run.slowmo = 0.18; run.zoom = Math.max(run.zoom, 0.05); }
  }
  run.bodies.push({ x: e.x, y: e.y, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, z: 0, vz: rand(280, 420),
    rot: rand(0, 6), vr: rand(-12, 12), r: e.r, life: 2.2, type: e.type });
  if (run.bodies.length > 50) run.bodies.shift();
  if (e.T.explode) explosion(e.x, e.y, 70, pDmg() * 2.5, false, '#ff9a3c');
  if (e.burn && run.syn.combust) explosion(e.x, e.y, 60, pDmg() * 1.5, false, '#ff7a2a');
  if (e.T.poison) run.zones.push({ kind: 'poison', x: e.x, y: e.y, r: 42, t: 4, max: 4, tick: 0 });
  if (e.T.boss) {
    run.bossRef = null;
    run.shake = 18; run.hitstop = 0.3; run.flash = 0.35;
    setBanner('擊敗頭目！', '#ffd84a', 2);
    SFX.boom();
  }
}

function explosion(x, y, r, dmg, hurtsPlayer, color) {
  run.fx.push({ kind: 'ring', x, y, r: 8, maxR: r, life: 0.3, max: 0.3, color, w: 6 });
  spark(x, y, color, 16);
  run.shake = Math.max(run.shake, 6);
  SFX.boom();
  for (const o of run.enemies) {
    if (o.dead) continue;
    if (dist2(o, { x, y }) < (r + o.r) ** 2) damageEnemy(o, dmg, { dir: Math.atan2(o.y - y, o.x - x), kb: 150 });
  }
  if (hurtsPlayer && x * x + y * y < (r + PLAYER_R) ** 2) hurtPlayer(hurtsPlayer);
}

function applyBurn(e, dps, dur) {
  if (e.dead) return;
  dur *= run.syn.burnLong ? 1.6 : 1;
  if (!e.burn || e.burn.dps < dps) e.burn = { dps, t: dur, tick: 0.5 };
  else e.burn.t = Math.max(e.burn.t, dur);
}
function applySlow(e, dur) { e.slowT = Math.max(e.slowT, dur * (run.syn.freezeLong ? 1.6 : 1)); }
function applyFreeze(e, dur) {
  if (e.T.boss) dur *= 0.3;
  e.freezeT = Math.max(e.freezeT, dur * (run.syn.freezeLong ? 1.6 : 1));
  if (run.syn.frostfire) applyBurn(e, pDmg() * 0.6, 2.5);
}

function chainLightning(start, jumps, dmg, fromPunch) {
  let cur = start;
  const done = new Set();
  let prev = fromPunch ? start : run.p;
  if (fromPunch) done.add(start);
  for (let i = 0; i <= jumps; i++) {
    if (!cur) break;
    if (!(fromPunch && i === 0)) {
      lightningFx(prev.x, prev.y, cur.x, cur.y);
      let d = dmg * (run.syn.overload ? 1.4 : 1) * run.p.skillDmg;
      let crit = false;
      if (run.syn.overload && Math.random() < run.p.crit) { d *= run.p.critDmg; crit = true; }
      if (cur.freezeT > 0 && run.syn.supercond) d *= 2;
      damageEnemy(cur, d, { crit, dir: Math.atan2(cur.y - prev.y, cur.x - prev.x), kb: 40, show: true });
      spark(cur.x, cur.y, '#cfe6ff', 6);
      if (run.syn.stormfire) applyBurn(cur, pDmg() * 0.5, 2.5);
      done.add(cur);
    }
    prev = cur;
    let best = null, bd = 140 * 140;
    for (const o of run.enemies) {
      if (o.dead || done.has(o)) continue;
      const d2 = dist2(o, cur);
      if (d2 < bd) { bd = d2; best = o; }
    }
    cur = best;
  }
  SFX.zap();
}

function hurtPlayer(d) {
  const p = run.p;
  if (state !== 'play') return;
  if (p.shield > 0) {
    p.shield = 0; p.shieldT = 6;
    run.fx.push({ kind: 'ring', x: 0, y: 0, r: 10, maxR: 40, life: 0.25, max: 0.25, color: '#7cc8ff', w: 4 });
    return;
  }
  p.hp -= d;
  p.hurtT = 0.15;
  run.shake = Math.max(run.shake, 6);
  run.flash = Math.max(run.flash, 0.12);
  SFX.hurt();
  if (p.hp <= 0) {
    if (p.revives > 0) {
      p.revives--;
      p.hp = p.maxHp * 0.5;
      setBanner('不屈！', '#7cf0c8');
      shockwave(260, pDmg() * 8);
    } else gameOver();
  }
}

function shockwave(r, dmg) {
  run.fx.push({ kind: 'ring', x: 0, y: 0, r: 20, maxR: r, life: 0.45, max: 0.45, color: '#ffffff', w: 10 });
  run.shake = 16; run.flash = 0.2;
  for (const o of run.enemies) {
    if (o.dead) continue;
    if (o.x * o.x + o.y * o.y < (r + o.r) ** 2) damageEnemy(o, dmg, { dir: Math.atan2(o.y, o.x), kb: 500 });
  }
}

// 必殺技：連擊爆發
function useUlt() {
  if (state !== 'play' || run.ult < run.ultMax) return;
  run.ult = 0;
  SFX.ult();
  setBanner('連擊爆發！', '#ff7ae0', 1);
  shockwave(ARENA + 40, pDmg() * 12 + run.combo * 2);
  run.hitstop = 0.15;
}

// ---------- 技能 ----------
const SKILLS = {
  rocket: {
    cd: lv => 3.2 - 0.25 * lv,
    cast(lv) {
      const t = nearestEnemies(9999, 1)[0];
      const n = 1 + Math.floor(lv / 2);
      const base = t ? Math.atan2(t.y, t.x) : run.p.facing;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.22;
        run.projs.push({ kind: 'rocket', x: 0, y: 0, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, r: 13, life: 1.2,
          dmg: pDmg() * (2 + 0.6 * lv) * run.p.skillDmg, hit: new Set() });
      }
    },
  },
  quake: {
    cd: lv => 5.5 - 0.35 * lv,
    cast(lv) {
      const r = 130 + 18 * lv;
      run.fx.push({ kind: 'ring', x: 0, y: 0, r: 20, maxR: r, life: 0.45, max: 0.45, color: '#e0b07a', w: 14 });
      run.fx.push({ kind: 'ring', x: 0, y: 0, r: 10, maxR: r * 0.6, life: 0.3, max: 0.3, color: '#ffffff', w: 8 });
      for (let i = 0; i < 40; i++) {
        const a = rand(0, Math.PI * 2), d = rand(30, r);
        run.fx.push({ kind: 'dot', x: Math.cos(a) * d, y: Math.sin(a) * d, z: 4, vz: rand(150, 380), vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, size: 6, color: '#b08a60', life: 0.6, max: 0.6 });
      }
      run.shake = Math.max(run.shake, 14); run.zoom = Math.max(run.zoom, 0.04);
      SFX.boom();
      for (const o of run.enemies) {
        if (o.dead) continue;
        if (o.x * o.x + o.y * o.y < (r + o.r) ** 2) damageEnemy(o, pDmg() * (1.6 + 0.5 * lv) * run.p.skillDmg, { dir: Math.atan2(o.y, o.x), kb: 320 });
      }
    },
  },
  meteor: {
    cd: lv => 4.6 - 0.25 * lv,
    cast(lv) {
      const alive = run.enemies.filter(e => !e.dead && e.x * e.x + e.y * e.y < ARENA * ARENA);
      const n = 2 + lv;
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), d = rand(60, ARENA * 0.8);
        const t = alive.length ? alive[Math.floor(Math.random() * alive.length)] : { x: Math.cos(a) * d, y: Math.sin(a) * d };
        run.marks.push({ x: t.x + rand(-10, 10), y: t.y + rand(-10, 10), r: 55, t: 0.6 + i * 0.08, max: 0.6 + i * 0.08,
          dmg: pDmg() * (2.4 + 0.7 * lv) * run.p.skillDmg });
      }
    },
  },
  orbit: {
    tick(lv, dt, s) {
      s.ang = (s.ang || 0) + dt * 3.2;
      const n = 2 + Math.floor((lv - 1) / 2);
      s.pos = [];
      for (let i = 0; i < n; i++) {
        const a = s.ang + i * Math.PI * 2 / n;
        const pos = { x: Math.cos(a) * 92, y: Math.sin(a) * 92 };
        s.pos.push(pos);
        for (const e of run.enemies) {
          if (e.dead) continue;
          if (dist2(e, pos) < (e.r + 14) ** 2 && (e.hitBy.orbit || 0) < run.time) {
            e.hitBy.orbit = run.time + 0.45;
            damageEnemy(e, pDmg() * (0.7 + 0.25 * lv) * run.p.skillDmg, { dir: Math.atan2(e.y, e.x), kb: 120 });
            SFX.hit();
          }
        }
      }
    },
  },
  fireZone: {
    cd: lv => 6.5 - 0.3 * lv,
    cast(lv) {
      const a = rand(0, Math.PI * 2);
      const c = densest(320) || { x: Math.cos(a) * 120, y: Math.sin(a) * 120 };
      run.zones.push({ kind: 'fire', x: c.x, y: c.y, r: 65 + 8 * lv, t: 3 + 0.4 * lv, max: 3 + 0.4 * lv, tick: 0,
        dmg: pDmg() * (0.5 + 0.2 * lv) * run.p.skillDmg });
    },
  },
  frostNova: {
    cd: lv => 7.5 - 0.4 * lv,
    cast(lv) {
      const r = 140 + 15 * lv;
      run.fx.push({ kind: 'ring', x: 0, y: 0, r: 20, maxR: r, life: 0.4, max: 0.4, color: '#9be7ff', w: 14 });
      run.fx.push({ kind: 'spikes', r, life: 0.9, max: 0.9 });
      run.shake = Math.max(run.shake, 6);
      for (const o of run.enemies) {
        if (o.dead) continue;
        if (o.x * o.x + o.y * o.y < (r + o.r) ** 2) {
          applyFreeze(o, 1.1 + 0.15 * lv);
          damageEnemy(o, pDmg() * (1 + 0.3 * lv) * run.p.skillDmg, { dir: Math.atan2(o.y, o.x), kb: 30 });
        }
      }
    },
  },
  chain: {
    cd: lv => 2.6 - 0.15 * lv,
    cast(lv) {
      const t = nearestEnemies(9999, 1)[0];
      if (!t) { const a = rand(0, Math.PI * 2); lightningFx(0, 0, Math.cos(a) * 200, Math.sin(a) * 200); SFX.zap(); return; }
      chainLightning(t, 2 + lv + (run.syn.arc ? 2 : 0), pDmg() * (1.2 + 0.35 * lv), false);
    },
  },
};

const ELEMENT_COLOR = { fire: '#ff8a3c', ice: '#9be7ff', lightning: '#ffe14a' };
function notifySkill(id) {
  run.skillFlash[id] = 0.4;
  run.castCount[id] = (run.castCount[id] || 0) + 1;
  // 前幾次施放顯示技能名稱，讓玩家認得
  if (run.castCount[id] <= 4) {
    const info = SKILL_INFO[id];
    run.texts.push({ x: 0, y: 0, h: 95, text: `${info.icon} ${info.name}`, color: ELEMENT_COLOR[info.element] || '#ffffff', size: 18, life: 1.1, max: 1.1, label: true });
  }
}

function densest(range) {
  let best = null, bc = -1;
  const cand = run.enemies.filter(e => !e.dead && e.x * e.x + e.y * e.y < range * range);
  for (let i = 0; i < Math.min(16, cand.length); i++) {
    const e = cand[Math.floor(Math.random() * cand.length)];
    let c = 0;
    for (const o of cand) if (dist2(o, e) < 70 * 70) c++;
    if (c > bc) { bc = c; best = e; }
  }
  return best;
}

function updateSkills(dt) {
  for (const id in run.skills) {
    const s = run.skills[id], def = SKILLS[id];
    if (!def) continue; // 被動技能
    if (def.tick) def.tick(s.lv, dt, s);
    if (def.cd) {
      s.t -= dt;
      if (s.t <= 0) {
        def.cast(s.lv);
        s.t = s.cd = def.cd(s.lv);
        notifySkill(id);
      }
    }
  }
}

// ---------- 敵人 ----------
function updateEnemies(dt) {
  const p = run.p;
  for (const e of run.enemies) {
    if (e.dead) continue;
    e.anim += dt; e.flash -= dt; e.life += dt;
    if (e.burn) {
      e.burn.t -= dt; e.burn.tick -= dt;
      if (e.burn.tick <= 0) { e.burn.tick = 0.5; damageEnemy(e, e.burn.dps * 0.5 * run.p.skillDmg, {}); }
      if (e.burn && e.burn.t <= 0) e.burn = null;
      if (e.dead) continue;
    }
    if (e.burn && Math.random() < 0.3) run.fx.push({ kind: 'dot', x: e.x + rand(-e.r, e.r), y: e.y + rand(-e.r, e.r), vx: 0, vy: -40, size: 4, color: Math.random() < 0.5 ? '#ff7a2a' : '#ffd23a', life: 0.35, max: 0.35 });
    e.slowT -= dt;
    e.freezeT -= dt;
    // 擊退
    e.x += e.vx * dt; e.y += e.vy * dt;
    const damp = Math.exp(-7 * dt);
    e.vx *= damp; e.vy *= damp;
    if (e.freezeT > 0) continue;
    if (e.squash > 0) e.squash -= dt;
    if (e.stun > 0) { e.stun -= dt; continue; }
    const knocked = Math.hypot(e.vx, e.vy) > 60;
    if (knocked && Math.random() < 0.35) run.fx.push({ kind: 'dot', x: e.x, y: e.y, z: 3, vz: rand(30, 90), vx: -e.vx * 0.1, vy: -e.vy * 0.1, size: 5, color: '#8a7a6a', life: 0.35, max: 0.35 });
    const d = Math.hypot(e.x, e.y);
    const nx = -e.x / (d || 1), ny = -e.y / (d || 1);
    e.face = Math.atan2(ny, nx);
    let spd = e.speed * (e.slowT > 0 ? 0.5 : 1);
    const reach = e.r + PLAYER_R + 2;
    let mx = 0, my = 0;
    const T = e.T;

    if (T.flee) {
      // 錢袋鼠：繞場跑，一陣子後溜走
      if (e.life > 11) {
        mx = -nx; my = -ny; // 時間到就往場外跑
        if (d > ARENA + 50) { e.dead = true; continue; }
      } else {
        const tang = Math.atan2(e.y, e.x) + 0.5;
        const targetR = ARENA * 0.55;
        const tx = Math.cos(tang) * targetR, ty = Math.sin(tang) * targetR;
        const dd = Math.hypot(tx - e.x, ty - e.y) || 1;
        mx = (tx - e.x) / dd; my = (ty - e.y) / dd;
      }
    } else if (T.ranged && d < T.ranged.range && d > reach) {
      e.ability -= dt;
      if (e.ability <= 0 && d < ARENA) {
        e.ability = T.ranged.cd;
        run.eprojs.push({ bottle: true, x: e.x, y: e.y, vx: nx * 210, vy: ny * 210, dmg: e.dmg, rot: 0, life: 3 });
      }
    } else if (T.charge || T.boss === 'charge') {
      if (e.state === 'walk') {
        e.ability -= dt;
        if (e.ability <= 0 && d < 300 && d > reach + 30) { e.state = 'wind'; e.stateT = 0.6; }
        if (d > reach) { mx = nx; my = ny; }
      } else if (e.state === 'wind') {
        e.stateT -= dt;
        if (e.stateT <= 0) { e.state = 'dash'; e.stateT = 0.5; e.dx = nx; e.dy = ny; }
      } else if (e.state === 'dash') {
        e.stateT -= dt;
        mx = e.dx; my = e.dy; spd = e.speed * 6;
        if (e.stateT <= 0 || d <= reach) { e.state = 'walk'; e.ability = T.boss ? 3.5 : rand(3, 5); }
      }
    } else if (d > reach) { mx = nx; my = ny; }

    if (T.buffer) {
      e.ability -= dt;
      if (e.ability <= 0) {
        e.ability = 4;
        run.fx.push({ kind: 'ring', x: e.x, y: e.y, r: 10, maxR: 140, life: 0.4, max: 0.4, color: '#5fa8ff', w: 4 });
        for (const o of run.enemies) if (!o.dead && o !== e && dist2(o, e) < 140 * 140) o.shield = Math.max(o.shield, o.maxHp * 0.5);
      }
    }
    if (T.boss === 'slam') {
      e.ability -= dt;
      if (e.ability <= 0 && e.state === 'walk') { e.state = 'wind'; e.stateT = 1.0; }
      if (e.state === 'wind') {
        mx = my = 0;
        e.stateT -= dt;
        if (e.stateT <= 0) {
          e.state = 'walk'; e.ability = 5;
          explosion(e.x, e.y, 170, pDmg() * 0, Math.round(e.dmg * 1.3), '#ff5a4a');
        }
      }
    }
    if (T.boss === 'summon') {
      e.ability -= dt;
      if (e.ability <= 0) {
        e.ability = 4;
        for (let i = 0; i < 3 + run.chapter; i++) {
          const a = rand(0, Math.PI * 2);
          spawnEnemy(Math.random() < 0.7 ? 'grunt' : 'runner', { x: e.x + Math.cos(a) * 50, y: e.y + Math.sin(a) * 50 });
        }
        run.fx.push({ kind: 'ring', x: e.x, y: e.y, r: 10, maxR: 80, life: 0.4, max: 0.4, color: '#c070ff', w: 5 });
      }
    }
    if (!knocked) { e.x += mx * spd * dt; e.y += my * spd * dt; }

    // 攻擊主角
    if (d <= reach + 4 && T.dmg > 0) {
      if (T.explode) { e.dead = true; explosion(e.x, e.y, 60, 0, e.dmg, '#ff9a3c'); run.kills++; continue; }
      e.atkT -= dt;
      if (e.atkT <= 0) {
        e.atkT = T.boss ? 1.2 : 1.0;
        e.lunge = 0.15;
        hurtPlayer(e.dmg);
        if (state !== 'play') return;
      }
    }
    if (e.lunge) e.lunge = Math.max(0, e.lunge - dt);
    // 不能穿過主角
    const minD = e.r + PLAYER_R;
    if (d < minD) { e.x = -nx * minD; e.y = -ny * minD; }
  }
  separate();
}

// 敵人互相推擠（格子分區）
function separate() {
  const cell = 48, grid = new Map();
  const list = run.enemies;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead) continue;
    const k = ((e.x / cell) | 0) * 1000 + ((e.y / cell) | 0);
    let b = grid.get(k);
    if (!b) grid.set(k, b = []);
    b.push(e);
  }
  for (const e of list) {
    if (e.dead) continue;
    const cx = (e.x / cell) | 0, cy = (e.y / cell) | 0;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const b = grid.get((cx + ox) * 1000 + cy + oy);
      if (!b) continue;
      for (const o of b) {
        if (o === e) continue;
        const dx = e.x - o.x, dy = e.y - o.y;
        const rr = e.r + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 0.01) {
          const d = Math.sqrt(d2), push = (rr - d) * 0.5;
          const wE = o.T.mass / (e.T.mass + o.T.mass);
          e.x += dx / d * push * wE; e.y += dy / d * push * wE;
        }
      }
    }
  }
}

function updateProjectiles(dt) {
  const p = run.p;
  for (const pr of run.projs) {
    pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
    if (Math.random() < 0.6) run.fx.push({ kind: 'dot', x: pr.x, y: pr.y, vx: rand(-30, 30), vy: rand(-30, 30), size: rand(3, 6), color: '#ff9a3c', life: 0.3, max: 0.3 });
    for (const e of run.enemies) {
      if (e.dead || pr.hit.has(e)) continue;
      if (dist2(e, pr) < (e.r + pr.r) ** 2) {
        pr.hit.add(e);
        damageEnemy(e, pr.dmg, { dir: Math.atan2(pr.vy, pr.vx), kb: 200, show: true });
      }
    }
    if (pr.life <= 0 || Math.abs(pr.x) > ARENA + 100 || Math.abs(pr.y) > ARENA + 100) pr.dead = true;
  }
  run.projs = run.projs.filter(x => !x.dead);
  for (const b of run.eprojs) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.rot += dt * 12; b.life -= dt;
    // 主角會自動把飛來的酒瓶揮掉（在出拳範圍內有機率）
    if (b.x * b.x + b.y * b.y < (PLAYER_R + 6) ** 2) { b.dead = true; hurtPlayer(b.dmg); }
    if (b.life <= 0) b.dead = true;
  }
  run.eprojs = run.eprojs.filter(x => !x.dead);
  // 天降鐵拳
  for (const m of run.marks) {
    m.t -= dt;
    if (m.t <= 0) {
      m.dead = true;
      run.fx.push({ kind: 'ring', x: m.x, y: m.y, r: 10, maxR: m.r, life: 0.25, max: 0.25, color: '#ffd84a', w: 8 });
      spark(m.x, m.y, '#ffd84a', 14);
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2);
        run.fx.push({ kind: 'dot', x: m.x, y: m.y, z: 4, vz: rand(120, 300), vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, size: 6, color: '#a08060', life: 0.5, max: 0.5 });
      }
      run.fx.push({ kind: 'impact', x: m.x, y: m.y, h: 15, size: 2.4, color: '#ffd84a', life: 0.16, max: 0.16 });
      run.shake = Math.max(run.shake, 9);
      SFX.boom();
      for (const e of run.enemies) {
        if (e.dead) continue;
        if (dist2(e, m) < (m.r + e.r) ** 2) damageEnemy(e, m.dmg, { dir: Math.atan2(e.y - m.y, e.x - m.x), kb: 220, show: true });
      }
    }
  }
  run.marks = run.marks.filter(m => !m.dead);
  // 區域
  for (const z of run.zones) {
    z.t -= dt; z.tick -= dt;
    if (z.kind === 'fire' && Math.random() < 0.9) {
      const a = rand(0, Math.PI * 2), d = Math.sqrt(Math.random()) * z.r;
      run.fx.push({ kind: 'dot', rise: true, x: z.x + Math.cos(a) * d, y: z.y + Math.sin(a) * d, z: 3, vz: rand(40, 90), vx: 0, vy: 0, size: 7, color: Math.random() < 0.5 ? '#ff6a28' : '#ffc23a', life: 0.6, max: 0.6 });
    }
    if (z.tick <= 0) {
      z.tick = 0.4;
      if (z.kind === 'fire') {
        for (const e of run.enemies) if (!e.dead && dist2(e, z) < (z.r + e.r) ** 2) { damageEnemy(e, z.dmg, {}); applyBurn(e, z.dmg, 2); }
      } else if (z.kind === 'poison') {
        if (z.x * z.x + z.y * z.y < (z.r + PLAYER_R) ** 2) hurtPlayer(Math.round(2 * scaling().dmg));
      }
    }
  }
  run.zones = run.zones.filter(z => z.t > 0);
  // 經驗、金幣
  for (const o of run.orbs) {
    o.t += dt;
    if (o.t < 0.25) { o.x += o.vx * dt; o.y += o.vy * dt; continue; }
    const d = Math.hypot(o.x, o.y) || 1;
    const sp = 300 + o.t * 900;
    o.x -= o.x / d * sp * dt; o.y -= o.y / d * sp * dt;
    if (d < 18) {
      o.dead = true;
      if (o.kind === 'xp') gainXp(o.v * p.xpGain);
      else run.gold += o.v;
    }
  }
  run.orbs = run.orbs.filter(o => !o.dead);
}

function gainXp(v) {
  run.xp += v;
  while (run.xp >= run.xpNeed) {
    run.xp -= run.xpNeed;
    run.level++;
    run.xpNeed = Math.round(4 + run.level * 3 + Math.pow(run.level, 1.5));
    run.pendingLevels++;
  }
}

// ---------- 特效 ----------
function spark(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(80, 300);
    run.fx.push({ kind: 'dot', x, y, z: 22, vz: rand(60, 280), vx: Math.cos(a) * s, vy: Math.sin(a) * s, size: rand(2, 5), color, life: rand(0.25, 0.45), max: 0.45 });
  }
}
function lightningFx(x1, y1, x2, y2) {
  const pts = [[x1, y1]];
  const n = 6;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    pts.push([x1 + (x2 - x1) * t + rand(-12, 12), y1 + (y2 - y1) * t + rand(-12, 12)]);
  }
  pts.push([x2, y2]);
  run.fx.push({ kind: 'bolt', pts, life: 0.18, max: 0.18 });
}
// 元素拳的命中顏色
function ELEMENT_HIT() {
  const sk = run.skills;
  return sk.firePunch ? '#ff9a3c' : sk.thunderPunch ? '#ffe14a' : sk.icePunch ? '#9be7ff' : '#ffffff';
}
// 狀聲字
const COMICS = [['砰！', '#ffd23a'], ['啪！', '#ffffff'], ['喝！', '#ff7a3c'], ['碰！', '#ffd23a'], ['哈！', '#ff9a3c']];
function addComic(x, y, dir) {
  const [t, c] = COMICS[Math.floor(Math.random() * COMICS.length)];
  run.texts.push({ x: x + Math.cos(dir) * 20, y: y + Math.sin(dir) * 20, h: 70, text: t, color: c, size: 40, life: 0.6, max: 0.6, comic: true, rot: rand(-0.35, 0.35) });
}
function addText(x, y, text, color, size) { run.texts.push({ x, y, text, color, size, life: 0.7, max: 0.7 }); }

function updateFx(dt) {
  for (const f of run.fx) {
    f.life -= dt;
    if (f.kind === 'dot') {
      f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92;
      if (f.vz !== undefined) { f.z += f.vz * dt; f.vz -= (f.rise ? -60 : 700) * dt; if (f.z < 2) { f.z = 2; f.vz = 0; } }
    }
    else if (f.kind === 'ring' || f.kind === 'dring') f.r += (f.maxR - f.r) * Math.min(1, dt * 14);
    else if (f.kind === 'smoke') { f.x += f.vx * dt; f.y += f.vy * dt; f.h += 25 * dt; f.vx *= 0.94; f.vy *= 0.94; }
  }
  run.fx = run.fx.filter(f => f.life > 0);
  if (run.fx.length > 400) run.fx.splice(0, run.fx.length - 400);
  for (const t of run.texts) { t.life -= dt; t.y -= 40 * dt; }
  run.texts = run.texts.filter(t => t.life > 0);
  for (const b of run.bodies) {
    b.life -= dt;
    if (b.z > 0 || b.vz > 0) { b.z += b.vz * dt; b.vz -= 700 * dt; if (b.z <= 0) { b.z = 0; b.vz = b.vz < -120 ? -b.vz * 0.3 : 0; } }
    const f = b.z > 0 ? 0.995 : Math.exp(-5 * dt);
    b.vx *= f; b.vy *= f;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.z > 0) b.rot += b.vr * dt;
    if (b.z > 8 && Math.random() < 0.6) run.fx.push({ kind: 'dot', x: b.x, y: b.y, z: b.z + b.r, vz: 0, vx: 0, vy: 0, size: 5, color: '#ffffff', life: 0.25, max: 0.25 });
    if (b.z === 0 && b.vz === 0 && !b.landed) {
      b.landed = true;
      for (let i = 0; i < 6; i++) { const a = rand(0, Math.PI * 2); run.fx.push({ kind: 'dot', x: b.x, y: b.y, z: 3, vz: rand(40, 120), vx: Math.cos(a) * 80, vy: Math.sin(a) * 80, size: 6, color: '#8a7a6a', life: 0.4, max: 0.4 }); }
    }
  }
  run.bodies = run.bodies.filter(b => b.life > 0);
  run.shake = Math.max(0, run.shake - dt * 45);
  run.zoom = Math.max(0, run.zoom - dt * 0.25);
  run.comboPop = Math.max(0, run.comboPop - dt);
  for (const k in run.skillFlash) run.skillFlash[k] = Math.max(0, run.skillFlash[k] - dt);
  run.flash = Math.max(0, run.flash - dt);
  if (run.banner) { run.banner.t -= dt; if (run.banner.t <= 0) run.banner = null; }
}

// ---------- 主更新 ----------
function update(dt) {
  updateFx(dt);
  if (run.hitstop > 0) { run.hitstop -= dt; return; }
  if (run.slowmo > 0) { run.slowmo -= dt; dt *= 0.3; }
  run.time += dt;

  if (!run.waveActive) {
    run.waveDelay -= dt;
    if (run.waveDelay <= 0) startWave();
  } else {
    if (run.toSpawn.length) {
      run.spawnT -= dt;
      while (run.toSpawn.length && run.spawnT <= 0) {
        spawnEnemy(run.toSpawn.shift().type);
        run.spawnT += run.toSpawn.length ? run.toSpawn[0].delay : 0;
      }
    } else if (!run.enemies.length) {
      run.waveActive = false;
      if (run.wave >= WAVES_PER_CHAPTER) { chapterClear(); return; }
      run.waveDelay = 1.3;
      setBanner('清場！', '#7cf08a', 1);
    }
  }
  updatePlayer(dt);
  if (state !== 'play') return;
  updateSkills(dt);
  updateEnemies(dt);
  if (state !== 'play') return;
  updateProjectiles(dt);
  run.enemies = run.enemies.filter(e => !e.dead);
  if (state === 'play' && run.ult >= run.ultMax && run.enemies.length >= 3) useUlt();
  if (state === 'play' && run.pendingLevels > 0) openLevelUp();
}

// ---------- 升級三選一 ----------
function buildChoices() {
  const pool = [];
  const p = run.p;
  for (const u of STAT_UPGRADES) {
    const lv = run.stats[u.id] || 0;
    if (lv >= u.max) continue;
    if (u.id === 'heal' && p.hp >= p.maxHp * 0.8) continue;
    pool.push({ kind: 'stat', id: u.id, w: RARITY_WEIGHT[u.rarity] * 0.55, rarity: u.rarity });
  }
  const owned = Object.keys(run.skills).length;
  for (const id in SKILL_INFO) {
    const lv = skillLv(id);
    if (lv >= SKILL_MAX) continue;
    if (lv === 0 && owned >= p.slots) continue;
    pool.push({ kind: 'skill', id, w: lv === 0 ? 34 : 40, rarity: lv === 0 ? 'rare' : 'common' });
  }
  for (const s of SYNERGIES) {
    if (run.syn[s.id]) continue;
    if (!s.req.every(hasElement)) continue;
    pool.push({ kind: 'syn', id: s.id, w: 30, rarity: s.req.length > 1 ? 'epic' : 'rare' });
  }
  const out = [];
  let avail = pool.slice();
  while (out.length < 3 && avail.length) {
    const c = weighted(avail.map(x => [x, x.w]));
    out.push(c);
    avail = avail.filter(x => !(x.kind === c.kind && x.id === c.id));
  }
  return out;
}

function openLevelUp() {
  state = 'levelup';
  pauseBtn.classList.add('hidden');
  run.choices = buildChoices();
  SFX.level();
  renderLevelUp();
}

// 技能在某等級的具體說明
function skillText(id, lv) {
  const sd = run.p.skillDmg;
  const pct = v => `${Math.round(v * 100)}%`;
  const sec = v => `${(+v.toFixed(1))} 秒`;
  switch (id) {
    case 'rocket': return `每 ${sec(3.2 - 0.25 * lv)}朝最近的敵人射出 ${1 + Math.floor(lv / 2)} 顆飛拳，一路貫穿，每個敵人受到 ${pct((2 + 0.6 * lv) * sd)} 傷害`;
    case 'quake': return `每 ${sec(5.5 - 0.35 * lv)}捶地，半徑 ${130 + 18 * lv} 內的敵人受到 ${pct((1.6 + 0.5 * lv) * sd)} 傷害並被震飛`;
    case 'meteor': return `每 ${sec(4.6 - 0.25 * lv)}從天上砸下 ${2 + lv} 個巨拳，落點範圍造成 ${pct((2.4 + 0.7 * lv) * sd)} 傷害`;
    case 'orbit': return `${2 + Math.floor((lv - 1) / 2)} 個拳套一直繞著你轉，碰到敵人造成 ${pct((0.7 + 0.25 * lv) * sd)} 傷害`;
    case 'bounce': return `每一拳打中後，再彈去打附近 ${1 + Math.floor(lv / 2)} 個敵人，造成 ${pct(0.45 + 0.08 * lv)} 傷害`;
    case 'firePunch': return `出拳讓敵人著火，每秒燒掉 ${pct(0.4 + 0.15 * lv)} 出拳傷害，持續 2.5 秒`;
    case 'fireZone': return `每 ${sec(6.5 - 0.3 * lv)}在敵人最多的地方點燃火圈（半徑 ${65 + 8 * lv}），持續 ${sec(3 + 0.4 * lv)}，踩到的敵人每秒受到 ${pct((0.5 + 0.2 * lv) * 2.5 * sd)} 傷害並著火`;
    case 'icePunch': return `出拳讓敵人減速 50%，並有 ${pct(0.08 + 0.05 * lv)} 機率直接冰凍 1 秒`;
    case 'frostNova': return `每 ${sec(7.5 - 0.4 * lv)}冰凍身邊半徑 ${140 + 15 * lv} 內所有敵人 ${sec(1.1 + 0.15 * lv)}，並造成 ${pct((1 + 0.3 * lv) * sd)} 傷害`;
    case 'thunderPunch': return `每一拳有 ${pct(0.15 + 0.08 * lv)} 機率放出閃電，連續打附近 2 個敵人`;
    case 'chain': return `每 ${sec(2.6 - 0.15 * lv)}放出閃電，在 ${3 + lv} 個敵人之間跳躍，每下 ${pct((1.2 + 0.35 * lv) * sd)} 傷害`;
  }
  return '';
}
const ELEMENT_NAME = { fire: '火系', ice: '冰系', lightning: '雷系' };

function choiceView(c) {
  if (c.kind === 'stat') {
    const u = STAT_UPGRADES.find(x => x.id === c.id);
    const lv = run.stats[c.id] || 0;
    return { icon: u.icon, name: u.name, tag: '強化', lv: u.max < 99 ? `Lv ${lv} → ${lv + 1}` : '', desc: u.desc, rarity: u.rarity };
  }
  if (c.kind === 'skill') {
    const s = SKILL_INFO[c.id], lv = skillLv(c.id);
    const tag = s.element ? { fire: '火系技能', ice: '冰系技能', lightning: '雷系技能' }[s.element] : '技能';
    return { icon: s.icon, name: s.name, tag: lv === 0 ? `新${tag}` : tag, lv: `Lv ${lv} → ${lv + 1}`, desc: skillText(c.id, lv + 1), rarity: c.rarity, el: s.element };
  }
  const s = SYNERGIES.find(x => x.id === c.id);
  return { icon: s.icon, name: s.name, tag: `元素組合（${s.req.map(r => ELEMENT_NAME[r]).join('＋')}）`, lv: '', desc: s.desc, rarity: c.rarity, el: s.req.length === 1 ? s.req[0] : '' };
}

function renderLevelUp() {
  const cards = run.choices.map((c, i) => {
    const v = choiceView(c);
    return `<div class="card ${v.rarity} ${v.el || ''}" data-act="pick" data-i="${i}">
      <div class="tag">${v.tag}</div>
      <div class="icon">${v.icon}</div>
      <div class="name">${v.name}</div>
      <div class="lv">${v.lv}</div>
      <div class="desc">${v.desc}</div>
      <div class="key">按 ${i + 1}</div>
    </div>`;
  }).join('');
  const owned = Object.keys(run.skills).map(id => `${SKILL_INFO[id].icon}${run.skills[id].lv}`).join(' ') || '尚無';
  showOverlay(`
    <h2>升級！ Lv ${run.level - run.pendingLevels + 1}</h2>
    <p class="small">技能（${Object.keys(run.skills).length}/${run.p.slots}）：${owned}</p>
    <div class="cards">${cards}</div>
    <button class="btn alt" data-act="reroll" ${run.rerolls > 0 ? '' : 'disabled'}>🎲 重抽（剩 ${run.rerolls} 次）</button>
  `);
}

function applyChoice(c) {
  const p = run.p;
  if (c.kind === 'stat') {
    run.stats[c.id] = (run.stats[c.id] || 0) + 1;
    switch (c.id) {
      case 'dmg': p.dmgMult += 0.25; break;
      case 'rate': p.rate *= 0.88; break;
      case 'range': p.range += 18; break;
      case 'crit': p.crit += 0.06; break;
      case 'critDmg': p.critDmg += 0.3; break;
      case 'maxHp': p.maxHp += 20; p.hp += 20; break;
      case 'regen': p.regen += 1; break;
      case 'lifesteal': p.lifesteal += 0.03; break;
      case 'kb': p.kb += 0.35; break;
      case 'xp': p.xpGain += 0.2; break;
      case 'skillDmg': p.skillDmg += 0.2; break;
      case 'multi': p.multi += 1; break;
      case 'heal': p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.4); break;
    }
  } else if (c.kind === 'skill') {
    if (!run.skills[c.id]) run.skills[c.id] = { lv: 0, t: 0.5, cd: 1 };
    run.skills[c.id].lv++;
  } else run.syn[c.id] = true;
}

function pick(i) {
  const c = run.choices[i];
  if (!c) return;
  applyChoice(c);
  run.pendingLevels--;
  if (run.pendingLevels > 0) { run.choices = buildChoices(); renderLevelUp(); }
  else setState('play');
}

function reroll() {
  if (run.rerolls <= 0) return;
  run.rerolls--;
  run.choices = buildChoices();
  renderLevelUp();
}

// ---------- 章節 ----------
function chapterClear() {
  state = 'chapter';
  pauseBtn.classList.add('hidden');
  const bonus = Math.round((40 + run.chapter * 30) * run.p.goldMult);
  run.gold += bonus;
  save.bestChapter = Math.max(save.bestChapter, run.chapter);
  showOverlay(`
    <h2>第 ${run.chapter} 章 通關！</h2>
    <div class="stats">
      <span>章節獎勵</span><span class="gold">+${bonus} 金幣</span>
      <span>本局金幣</span><span class="gold">${run.gold}</span>
      <span>擊倒數</span><span>${run.kills}</span>
    </div>
    <p>下一章敵人會更強，主角回復 30% 生命。</p>
    <div class="row">
      <button class="btn" data-act="nextChapter">挑戰第 ${run.chapter + 1} 章</button>
      <button class="btn alt" data-act="retreat">帶著金幣撤退</button>
    </div>
  `);
}
function nextChapter() {
  run.chapter++;
  run.wave = 0;
  run.waveDelay = 1.5;
  run.p.hp = Math.min(run.p.maxHp, run.p.hp + run.p.maxHp * 0.3);
  setState('play');
  setBanner(`第 ${run.chapter} 章`, '#ffd84a', 2);
}

// ---------- 介面 ----------
function setState(s) {
  state = s;
  pauseBtn.classList.toggle('hidden', s !== 'play');
  ultBtn.classList.toggle('hidden', !(s === 'play' || s === 'pause' || s === 'levelup'));
  if (s === 'play') overlay.classList.add('hidden');
}
function showOverlay(html) { overlay.innerHTML = html; overlay.classList.remove('hidden'); }

function showTitle() {
  run = null;
  setState('title');
  ultBtn.classList.add('hidden');
  showOverlay(`
    <p class="sub">ROGUELIKE 拳擊</p>
    <h1>RL FIGHT</h1>
    <p>站在八角籠中央，用真人功夫拳腳把範圍內的敵人揍飛。<br>打倒敵人升級、挑技能、組元素，撐過一章又一章。</p>
    <div class="stats">
      <span>最高分</span><span>${save.best}</span>
      <span>最遠進度</span><span>第 ${save.bestChapter || 1} 章 第 ${save.bestWave} 波</span>
      <span>金幣</span><span class="gold">${save.bank}</span>
    </div>
    <div class="row">
      <button class="btn" data-act="start">開始戰鬥</button>
      <button class="btn alt" data-act="shop">道場</button>
    </div>
    <p class="small">全自動戰鬥：出拳、技能、爆發都會自己放｜升級時選強化（1 2 3）｜P 暫停　M 靜音</p>
    <p class="small" style="opacity:.55">動作捕捉資料：CMU Graphics Lab Motion Capture Database（mocap.cs.cmu.edu）</p>
  `);
}

function showShop() {
  setState('shop');
  const items = META_UPGRADES.map(m => {
    const lv = metaLv(m.id), maxed = lv >= m.max, cost = metaCost(m, lv);
    return `<div class="shop-item">
      <div class="info"><div class="name">${m.name} <span class="small">Lv ${lv}/${m.max}</span></div>
      <div class="desc">${m.desc}</div></div>
      <button class="btn" data-act="buy" data-id="${m.id}" ${maxed || save.bank < cost ? 'disabled' : ''}>${maxed ? '已滿級' : `💰 ${cost}`}</button>
    </div>`;
  }).join('');
  showOverlay(`
    <h2>道場</h2>
    <p>持有金幣：<span class="gold">${save.bank}</span></p>
    <div class="shop">${items}</div>
    <button class="btn alt" data-act="title">返回</button>
  `);
}

function pause() {
  if (state !== 'play') return;
  setState('pause');
  const p = run.p;
  const owned = Object.keys(run.skills).map(id => `${SKILL_INFO[id].icon} ${SKILL_INFO[id].name} Lv${run.skills[id].lv}`).join('<br>') || '尚無技能';
  const syn = Object.keys(run.syn).map(id => SYNERGIES.find(s => s.id === id).name).join('、') || '無';
  showOverlay(`
    <h2>暫停</h2>
    <div class="stats">
      <span>出拳傷害</span><span>${fmt(pDmg())}</span>
      <span>出拳間隔</span><span>${p.rate.toFixed(2)} 秒</span>
      <span>出拳範圍</span><span>${Math.round(p.range)}</span>
      <span>暴擊</span><span>${Math.round(p.crit * 100)}% × ${p.critDmg.toFixed(1)}</span>
    </div>
    <p class="small">${owned}<br>元素組合：${syn}</p>
    <div class="row">
      <button class="btn" data-act="resume">繼續</button>
      <button class="btn alt" data-act="quit">放棄這局</button>
    </div>
  `);
}

function gameOver(retreat) {
  setState('gameover');
  ultBtn.classList.add('hidden');
  if (!retreat) SFX.over();
  const newBest = run.score > save.best;
  save.bank += run.gold;
  save.best = Math.max(save.best, run.score);
  if (run.chapter > save.bestChapter || (run.chapter === save.bestChapter && run.wave > save.bestWave)) {
    save.bestChapter = run.chapter; save.bestWave = run.wave;
  }
  writeSave();
  showOverlay(`
    <h2>${retreat ? '撤退成功' : '倒下了…'}</h2>
    ${newBest ? '<p class="gold">★ 新紀錄！ ★</p>' : ''}
    <div class="stats">
      <span>進度</span><span>第 ${run.chapter} 章 第 ${run.wave} 波</span>
      <span>等級</span><span>${run.level}</span>
      <span>分數</span><span>${run.score}</span>
      <span>擊倒數</span><span>${run.kills}</span>
      <span>最高連擊</span><span>${run.maxCombo}</span>
      <span>獲得金幣</span><span class="gold">+${run.gold}</span>
    </div>
    <div class="row">
      <button class="btn" data-act="start">再來一局</button>
      <button class="btn alt" data-act="shop">道場</button>
      <button class="btn alt" data-act="title">標題</button>
    </div>
  `);
}

function startRun() {
  newRun();
  setState('play');
}

overlay.addEventListener('click', ev => {
  ensureAudio();
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (act === 'start') startRun();
  else if (act === 'shop') showShop();
  else if (act === 'title') showTitle();
  else if (act === 'pick') pick(+el.dataset.i);
  else if (act === 'reroll') reroll();
  else if (act === 'resume') setState('play');
  else if (act === 'quit') gameOver();
  else if (act === 'nextChapter') nextChapter();
  else if (act === 'retreat') gameOver(true);
  else if (act === 'buy') {
    const m = META_UPGRADES.find(x => x.id === el.dataset.id);
    const lv = metaLv(m.id), cost = metaCost(m, lv);
    if (lv < m.max && save.bank >= cost) {
      save.bank -= cost;
      save.meta[m.id] = lv + 1;
      writeSave();
      SFX.level();
      showShop();
    }
  }
});
pauseBtn.addEventListener('click', () => pause());
ultBtn.addEventListener('click', () => { ensureAudio(); useUlt(); });

window.addEventListener('keydown', ev => {
  if (ev.repeat) return;
  ensureAudio();
  const k = ev.key.toLowerCase();
  if (k === 'm') { muted = !muted; return; }
  if (state === 'play') {
    if (k === ' ') { useUlt(); ev.preventDefault(); }
    else if (k === 'p' || k === 'escape') pause();
  } else if (state === 'pause') {
    if (k === 'p' || k === 'escape') setState('play');
  } else if (state === 'levelup') {
    if (k === '1' || k === '2' || k === '3') pick(+k - 1);
    else if (k === 'r') reroll();
  } else if (state === 'title' || state === 'gameover') {
    if (k === 'enter') startRun();
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('resize', resize);

// ---------- 2D 介面繪圖（3D 場景由 render3d.js 負責） ----------
function outlineText(text, x, y, size, color, align = 'left') {
  ctx.font = `900 ${size}px system-ui, sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function bar(x, y, w, h, ratio, color, bg = 'rgba(0,0,0,0.55)') {
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * clamp(ratio, 0, 1), h);
}

function drawHUD() {
  const p = run.p;
  const pad = 14, top = 12;
  const fs = clamp(Math.min(SW, SH) / 32, 12, 20);
  // 經驗條（最上方）
  bar(0, 0, SW, 6, run.xp / run.xpNeed, '#5ef2a0');
  // 生命
  const hw = Math.min(260, SW * 0.34);
  bar(pad, top + 6, hw, 14, p.hp / p.maxHp, '#ff4a5e');
  outlineText(`❤ ${Math.ceil(p.hp)} / ${p.maxHp}`, pad + 6, top + 13, fs * 0.7, '#fff');
  outlineText(`Lv ${run.level}`, pad, top + 36, fs, '#5ef2a0');
  // 進度
  outlineText(`第 ${run.chapter} 章`, SW / 2, top + 12, fs * 0.8, '#c9c9d6', 'center');
  outlineText(`${run.wave} / ${WAVES_PER_CHAPTER} 波`, SW / 2, top + 34, fs * 1.1, '#ffd84a', 'center');
  outlineText(`💰 ${run.gold}`, SW - pad - 50, top + 13, fs * 0.9, '#ffd84a', 'right');
  outlineText(`擊倒 ${run.kills}`, SW - pad - 50, top + 36, fs * 0.75, '#c9c9d6', 'right');
  // 連擊表
  if (run.combo >= 1) {
    const tier = comboTier();
    const col = ['#ffffff', '#ffe14a', '#ffb03a', '#ff7a3c', '#ff4fd8'][tier - 1];
    const next = COMBO_TIERS[tier] || null;
    const cx = SW / 2, cy = top + 70;
    const pop = 1 + run.comboPop * 2.5;
    outlineText(`x${tier}`, cx - 8, cy, fs * 1.6 * pop, col, 'right');
    outlineText(`${Math.floor(run.combo)} 連擊`, cx, cy, fs * pop, col, 'left');
    if (next) bar(cx - 60, cy + 16, 120, 4, (run.combo - COMBO_TIERS[tier - 1]) / (next - COMBO_TIERS[tier - 1]), col);
    const idleRatio = clamp(1 - run.comboIdle / 2.2, 0, 1);
    bar(cx - 60, cy + 22, 120, 2, idleRatio, 'rgba(255,255,255,0.6)', 'rgba(0,0,0,0.3)');
  }
  // 技能列
  const ids = Object.keys(run.skills);
  const sz = clamp(Math.min(SW, SH) / 14, 34, 52);
  const total = ids.length * (sz + 8) - 8;
  let x = SW / 2 - total / 2;
  const y = SH - sz - 70;
  for (const id of ids) {
    const s = run.skills[id], info = SKILL_INFO[id];
    const fl = run.skillFlash[id] || 0;
    ctx.fillStyle = fl > 0 ? `rgba(255,255,255,${0.25 + fl})` : 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, sz, sz);
    ctx.strokeStyle = ELEMENT_COLOR[info.element] || 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, sz - 2, sz - 2);
    ctx.font = `${sz * 0.55}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(info.icon, x + sz / 2, y + sz / 2);
    if (SKILLS[id] && SKILLS[id].cd && s.cd) {
      const r = clamp(s.t / s.cd, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, y + sz * (1 - r), sz, sz * r);
    }
    outlineText(`${s.lv}`, x + sz - 4, y + sz - 6, sz * 0.32, '#ffd84a', 'right');
    x += sz + 8;
  }
  // 頭目血條
  const boss = run.bossRef;
  if (boss && !boss.dead) {
    const bw = Math.min(420, SW * 0.8), bx = SW / 2 - bw / 2, by = top + 96;
    outlineText(boss.T.name, SW / 2, by - 6, fs * 0.8, '#ffd84a', 'center');
    bar(bx, by + 4, bw, 10, boss.hp / boss.maxHp, '#c0392b');
  }
  // 橫幅
  if (run.banner) {
    const b = run.banner;
    const a = Math.min(1, b.t / 0.3);
    const s = 1 + Math.max(0, b.t - (b.max - 0.2)) * 2.5;
    ctx.globalAlpha = a;
    ctx.save(); ctx.translate(SW / 2, CY - ARENA * S * 0.45); ctx.scale(s, s);
    outlineText(b.text, 0, 0, fs * 2.4, b.color, 'center');
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  // 必殺鍵狀態
  const ready = run.ult >= run.ultMax;
  ultBtn.style.setProperty('--fill', `${Math.round(run.ult / run.ultMax * 100)}%`);
  ultBtn.textContent = ready ? '爆發！' : `爆發蓄力 ${Math.round(run.ult / run.ultMax * 100)}%`;
  ultBtn.classList.toggle('ready', ready);
}

// 標題畫面用的展示主角
const demo = { facing: 0, punches: [], hurtT: 0, range: 150 };
let demoT = 0;

// 傷害數字與血條（投影到 3D 位置上）
function drawWorldOverlay() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const e of run.enemies) {
    if (e.dead || e.T.boss || e.hp >= e.maxHp || e.maxHp <= pDmg() * 2.5) continue;
    const s = R3D.project(e.x, e.y, e.r * 2.6);
    const w = e.r * 1.6;
    bar(s.x - w / 2, s.y, w, 4, e.hp / e.maxHp, '#ff5a4a', 'rgba(0,0,0,0.6)');
  }
  for (const t of run.texts) {
    const k = (t.max - t.life) / 0.12;
    const pop = k < 1 ? 1.7 - 0.7 * k : 1;
    const s = R3D.project(t.x, t.y, (t.h || 40) + (1 - t.life / t.max) * 30);
    ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
    if (t.comic) {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(t.rot);
      ctx.font = `900 ${t.size * pop}px system-ui, sans-serif`;
      ctx.lineWidth = 7; ctx.strokeStyle = '#1a0a0a';
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color; ctx.fillText(t.text, 0, 0);
      ctx.restore();
      continue;
    }
    ctx.font = `900 ${t.size * pop}px system-ui, sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(t.text, s.x, s.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, s.x, s.y);
  }
  ctx.globalAlpha = 1;
}

function render(dt) {
  if (!run) {
    // 標題：主角對空揮拳
    demoT -= dt;
    if (demoT <= 0) {
      demoT = 0.7;
      const a = rand(0, Math.PI * 2);
      demo.facing = a;
      demo.punches.push({ tx: Math.cos(a) * 130, ty: Math.sin(a) * 130, side: Math.random() < 0.5 ? 1 : -1, t: 0, dur: 0.3, hitFrac: 0.5 });
    }
    for (const pu of demo.punches) pu.t += dt;
    demo.punches = demo.punches.filter(pu => pu.t < pu.dur);
  }
  R3D.render(run, demo, time, run ? run.shake * 0.8 : 0);
  ctx.clearRect(0, 0, SW, SH);
  if (run && (state === 'play' || state === 'pause' || state === 'levelup')) {
    drawWorldOverlay();
    drawHUD();
  }
  if (run && run.flash > 0) { ctx.fillStyle = `rgba(255,40,40,${run.flash * 0.8})`; ctx.fillRect(0, 0, SW, SH); }
}

// ---------- 主迴圈 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  if (state === 'play') update(dt);
  else if (run && (state === 'gameover' || state === 'chapter')) updateFx(dt);
  render(dt);
  requestAnimationFrame(frame);
}

// 測試用掛鉤
window.__rlfight = { get state() { return state; }, get run() { return run; }, startRun, pick, useUlt };

R3D.init(document.getElementById('world'), { ARENA, PLAYER_R });
resize();
showTitle();
requestAnimationFrame(frame);
})();
