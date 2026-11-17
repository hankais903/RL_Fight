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
let bgCanvas = document.createElement('canvas');

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
  buildBackground(dpr);
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
let actx = null, muted = false, lastHitSound = 0;
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
function noise(dur, vol = 0.1) {
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
  s.connect(g).connect(actx.destination);
  s.start(t); s.stop(t + dur);
}
const SFX = {
  hit: () => { const n = performance.now(); if (n - lastHitSound < 45) return; lastHitSound = n; noise(0.05, 0.08); tone(150, 0.06, 'triangle', 0.07, -70); },
  crit: () => { noise(0.1, 0.14); tone(90, 0.12, 'sawtooth', 0.07, -40); },
  hurt: () => { noise(0.15, 0.12); tone(110, 0.2, 'sawtooth', 0.07, -50); },
  boom: () => { noise(0.3, 0.2); tone(70, 0.3, 'sine', 0.15, -40); },
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
    shake: 0, hitstop: 0, flash: 0, banner: null, pendingLevels: 0, choices: [],
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
    hp: Math.pow(1.75, c - 1) * (1 + 0.13 * (w - 1)),
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
  if (w >= 3 || c > 1) pool.push(['thrower', 3]);
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
    // 飛來的酒瓶優先打掉
    const bottle = run.eprojs.find(b => !b.dead && !b.swatted && b.x * b.x + b.y * b.y < (p.range * 0.7) ** 2);
    if (bottle) { bottle.swatted = true; p.punchT = rate * 0.6; launchPunch(bottle, rate); }
    const targets = bottle ? [] : nearestEnemies(p.range, p.multi);
    if (targets.length) {
      p.punchT = rate;
      for (const t of targets) launchPunch(t, rate);
    }
  }
  for (const pu of p.punches) {
    pu.t += dt;
    if (!pu.target.dead) { pu.tx = pu.target.x; pu.ty = pu.target.y; }
    if (!pu.hit && pu.t >= pu.dur * 0.45) { pu.hit = true; punchHit(pu.target); }
  }
  p.punches = p.punches.filter(pu => pu.t < pu.dur);
}

function launchPunch(target, rate) {
  const p = run.p;
  p.armSide = -p.armSide;
  p.facing = Math.atan2(target.y, target.x);
  p.punches.push({ target, tx: target.x, ty: target.y, side: p.armSide, t: 0, dur: Math.min(0.2, rate * 0.85), hit: false });
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
  damageEnemy(e, dmg, { crit, dir, kb: 160 * p.kb, punch: true, show: true });
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
    if (run.texts.length < 70) addText(e.x + rand(-6, 6), e.y - e.r - 8, fmt(a), o.crit ? '#ffe14a' : '#ffffff', o.crit ? 22 : 15);
  }
  if (o.punch) {
    spark(e.x - Math.cos(o.dir) * e.r, e.y - Math.sin(o.dir) * e.r, o.crit ? '#ffe14a' : '#ffffff', o.crit ? 10 : 5);
    run.hitstop = Math.max(run.hitstop, o.crit ? 0.04 : 0.015);
    run.shake = Math.max(run.shake, o.crit ? 5 : 2);
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
  run.maxCombo = Math.max(run.maxCombo, run.combo);
  run.ult = Math.min(run.ultMax, run.ult + (e.T.boss ? 20 : 1));
  run.score += Math.round(e.T.xp * 10 * COMBO_DMG[comboTier()]);
  // 經驗與金幣飛向主角
  run.orbs.push({ x: e.x, y: e.y, kind: 'xp', v: e.T.xp, t: 0, vx: rand(-60, 60), vy: rand(-60, 60) });
  const g = Math.max(1, Math.round(e.T.gold * p.goldMult));
  if (e.T.gold >= 3 || Math.random() < 0.35) run.orbs.push({ x: e.x, y: e.y, kind: 'gold', v: g, t: 0, vx: rand(-80, 80), vy: rand(-80, 80) });
  // 被揍飛的身體
  const dir = o.dir !== undefined ? o.dir : Math.atan2(e.y, e.x);
  const sp = rand(380, 560) / Math.sqrt(e.T.mass) * (e.T.boss ? 0.4 : 1);
  run.bodies.push({ x: e.x, y: e.y, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, z: 0, vz: rand(160, 260),
    rot: rand(0, 6), vr: rand(-12, 12), r: e.r, life: 2.2, type: e.type });
  if (run.bodies.length > 90) run.bodies.shift();
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
      damageEnemy(cur, d, { crit, dir: Math.atan2(cur.y - prev.y, cur.x - prev.x), kb: 40 });
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
      if (!t) return false;
      const n = 1 + Math.floor(lv / 2);
      const base = Math.atan2(t.y, t.x);
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
      if (!nearestEnemies(150 + 15 * lv, 1).length) return false;
      const r = 130 + 18 * lv;
      run.fx.push({ kind: 'ring', x: 0, y: 0, r: 20, maxR: r, life: 0.35, max: 0.35, color: '#e0b07a', w: 12 });
      run.shake = Math.max(run.shake, 8);
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
      if (!alive.length) return false;
      const n = 2 + lv;
      for (let i = 0; i < n; i++) {
        const t = alive[Math.floor(Math.random() * alive.length)];
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
      const c = densest(320);
      if (!c) return false;
      run.zones.push({ kind: 'fire', x: c.x, y: c.y, r: 65 + 8 * lv, t: 3 + 0.4 * lv, max: 3 + 0.4 * lv, tick: 0,
        dmg: pDmg() * (0.5 + 0.2 * lv) * run.p.skillDmg });
    },
  },
  frostNova: {
    cd: lv => 7.5 - 0.4 * lv,
    cast(lv) {
      const r = 140 + 15 * lv;
      if (!nearestEnemies(r, 1).length) return false;
      run.fx.push({ kind: 'ring', x: 0, y: 0, r: 20, maxR: r, life: 0.4, max: 0.4, color: '#9be7ff', w: 14 });
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
      const t = nearestEnemies(330, 1)[0];
      if (!t) return false;
      chainLightning(t, 2 + lv + (run.syn.arc ? 2 : 0), pDmg() * (1.2 + 0.35 * lv), false);
    },
  },
};

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
        if (def.cast(s.lv) === false) s.t = 0.3;
        else s.t = s.cd = def.cd(s.lv);
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
    e.slowT -= dt;
    e.freezeT -= dt;
    // 擊退
    e.x += e.vx * dt; e.y += e.vy * dt;
    const damp = Math.exp(-7 * dt);
    e.vx *= damp; e.vy *= damp;
    if (e.freezeT > 0) continue;
    const knocked = Math.hypot(e.vx, e.vy) > 60;
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
      spark(m.x, m.y, '#ffd84a', 12);
      run.shake = Math.max(run.shake, 5);
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
    run.fx.push({ kind: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, size: rand(2, 5), color, life: rand(0.2, 0.4), max: 0.4 });
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
function addText(x, y, text, color, size) { run.texts.push({ x, y, text, color, size, life: 0.7, max: 0.7 }); }

function updateFx(dt) {
  for (const f of run.fx) {
    f.life -= dt;
    if (f.kind === 'dot') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92; }
    else if (f.kind === 'ring') f.r += (f.maxR - f.r) * Math.min(1, dt * 14);
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
  }
  run.bodies = run.bodies.filter(b => b.life > 0);
  run.shake = Math.max(0, run.shake - dt * 40);
  run.flash = Math.max(0, run.flash - dt);
  if (run.banner) { run.banner.t -= dt; if (run.banner.t <= 0) run.banner = null; }
}

// ---------- 主更新 ----------
function update(dt) {
  updateFx(dt);
  if (run.hitstop > 0) { run.hitstop -= dt; return; }
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

function choiceView(c) {
  if (c.kind === 'stat') {
    const u = STAT_UPGRADES.find(x => x.id === c.id);
    const lv = run.stats[c.id] || 0;
    return { icon: u.icon, name: u.name, tag: '強化', lv: u.max < 99 ? `Lv ${lv} → ${lv + 1}` : '', desc: u.desc, rarity: u.rarity };
  }
  if (c.kind === 'skill') {
    const s = SKILL_INFO[c.id], lv = skillLv(c.id);
    const tag = s.element ? { fire: '火系技能', ice: '冰系技能', lightning: '雷系技能' }[s.element] : '技能';
    return { icon: s.icon, name: s.name, tag: lv === 0 ? `新${tag}` : tag, lv: `Lv ${lv} → ${lv + 1}`, desc: lv === 0 ? s.desc : s.up, rarity: c.rarity, el: s.element };
  }
  const s = SYNERGIES.find(x => x.id === c.id);
  return { icon: s.icon, name: s.name, tag: '元素組合', lv: '', desc: s.desc, rarity: c.rarity };
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
      case 'dmg': p.dmgMult += 0.2; break;
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
    <p>站在八角籠中央，橡皮鐵臂會自動揍飛範圍內的敵人。<br>打倒敵人升級、挑技能、組元素，撐過一章又一章。</p>
    <div class="stats">
      <span>最高分</span><span>${save.best}</span>
      <span>最遠進度</span><span>第 ${save.bestChapter || 1} 章 第 ${save.bestWave} 波</span>
      <span>金幣</span><span class="gold">${save.bank}</span>
    </div>
    <div class="row">
      <button class="btn" data-act="start">開始戰鬥</button>
      <button class="btn alt" data-act="shop">道場</button>
    </div>
    <p class="small">自動出拳｜升級時選強化（1 2 3）｜連擊表滿了按 空白鍵 或「爆發」放必殺｜P 暫停　M 靜音</p>
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

// ---------- 繪圖 ----------
function octagon(c, r) {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
}

function buildBackground(dpr) {
  bgCanvas.width = Math.round(SW * dpr);
  bgCanvas.height = Math.round(SH * dpr);
  const b = bgCanvas.getContext('2d');
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 場外：暗色觀眾席
  const g = b.createRadialGradient(CX, CY, ARENA * S * 0.5, CX, CY, Math.max(SW, SH) * 0.8);
  g.addColorStop(0, '#1d1a26');
  g.addColorStop(1, '#09080d');
  b.fillStyle = g;
  b.fillRect(0, 0, SW, SH);
  // 觀眾（頭頂的小圓點）
  const rng = mulberry(7);
  for (let i = 0; i < 420; i++) {
    const a = rng() * Math.PI * 2, rr = ARENA * S * (1.12 + rng() * 1.6);
    const x = CX + Math.cos(a) * rr, y = CY + Math.sin(a) * rr;
    if (x < -10 || x > SW + 10 || y < -10 || y > SH + 10) continue;
    b.fillStyle = `hsla(${(rng() * 360) | 0}, 18%, ${11 + rng() * 8}%, 1)`;
    b.beginPath(); b.arc(x, y, (4 + rng() * 2.5) * S, 0, Math.PI * 2); b.fill();
  }
  b.save();
  b.translate(CX, CY);
  b.scale(S, S);
  // 地板
  octagon(b, ARENA + 18);
  b.fillStyle = '#16161c';
  b.fill();
  octagon(b, ARENA);
  const fg = b.createRadialGradient(0, 0, 40, 0, 0, ARENA);
  fg.addColorStop(0, '#3a3f4a');
  fg.addColorStop(1, '#262a33');
  b.fillStyle = fg;
  b.fill();
  // 地板紋路
  b.save();
  octagon(b, ARENA);
  b.clip();
  b.strokeStyle = 'rgba(255,255,255,0.035)';
  b.lineWidth = 2;
  for (let i = -ARENA; i < ARENA; i += 40) {
    b.beginPath(); b.moveTo(i, -ARENA); b.lineTo(i, ARENA); b.stroke();
    b.beginPath(); b.moveTo(-ARENA, i); b.lineTo(ARENA, i); b.stroke();
  }
  // 中央標誌
  b.strokeStyle = 'rgba(63,224,197,0.18)';
  b.lineWidth = 6;
  b.beginPath(); b.arc(0, 0, 70, 0, Math.PI * 2); b.stroke();
  b.font = '900 34px system-ui, sans-serif';
  b.fillStyle = 'rgba(63,224,197,0.12)';
  b.textAlign = 'center'; b.textBaseline = 'middle';
  b.fillText('RL', 0, 0);
  b.restore();
  // 鐵絲網圍欄
  octagon(b, ARENA + 6);
  b.strokeStyle = '#555c66';
  b.lineWidth = 10;
  b.stroke();
  octagon(b, ARENA + 6);
  b.setLineDash([3, 5]);
  b.strokeStyle = '#8a929c';
  b.lineWidth = 4;
  b.stroke();
  b.setLineDash([]);
  // 霓虹柱
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    const x = Math.cos(a) * (ARENA + 6), y = Math.sin(a) * (ARENA + 6);
    b.fillStyle = 'rgba(63,224,197,0.25)';
    b.beginPath(); b.arc(x, y, 18, 0, Math.PI * 2); b.fill();
    b.fillStyle = '#3fe0c5';
    b.beginPath(); b.arc(x, y, 8, 0, Math.PI * 2); b.fill();
  }
  b.restore();
}
function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// 俯視角色：肩膀、頭、兩個拳頭
function drawFighter(x, y, r, color, face, anim, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  // 影子
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(3, 5, r * 1.1, r * 0.95, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(face);
  const step = Math.sin(anim * 10) * r * 0.25;
  const lunge = o.lunge ? r * 0.6 : 0;
  // 拳頭
  const fistC = o.flash ? '#fff' : shade(color, -35);
  if (!o.noFists) {
    ctx.fillStyle = fistC;
    ctx.beginPath(); ctx.arc(r * 0.75 + step + lunge, -r * 0.8, r * 0.38, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.75 - step, r * 0.8, r * 0.38, 0, Math.PI * 2); ctx.fill();
  }
  // 肩膀
  ctx.fillStyle = o.flash ? '#fff' : color;
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.75, r * 1.05, 0, 0, Math.PI * 2); ctx.fill();
  // 頭
  ctx.fillStyle = o.flash ? '#fff' : (o.head || shade(color, 25));
  ctx.beginPath(); ctx.arc(r * 0.1, 0, r * 0.55, 0, Math.PI * 2); ctx.fill();
  if (o.extra) o.extra(r);
  ctx.restore();
}

function drawEnemy(e) {
  const T = e.T;
  let color = T.color;
  if (e.freezeT > 0) color = '#a8e4ff';
  const wind = e.state === 'wind' && Math.floor(time * 16) % 2 === 0;
  drawFighter(e.x, e.y, e.r, color, e.face, e.freezeT > 0 ? 0 : e.anim, {
    flash: e.flash > 0 || wind, lunge: e.lunge > 0,
    extra: r => {
      if (e.type === 'bomber') {
        ctx.fillStyle = Math.floor(time * 12) % 2 ? '#ffe14a' : '#ff5a1f';
        ctx.beginPath(); ctx.arc(-r * 0.3, 0, r * 0.22, 0, Math.PI * 2); ctx.fill();
      } else if (e.type === 'spore') {
        ctx.fillStyle = '#e7f5c0';
        for (const [a, b] of [[0.2, -0.25], [-0.15, 0.2], [0.3, 0.25]]) { ctx.beginPath(); ctx.arc(r * a, r * b, r * 0.12, 0, Math.PI * 2); ctx.fill(); }
      } else if (e.type === 'drummer') {
        ctx.strokeStyle = '#cfe3ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(r * 0.1, 0, r * 0.35, 0, Math.PI * 2); ctx.stroke();
      } else if (e.type === 'goldie') {
        ctx.fillStyle = '#7a5a10';
        ctx.font = `900 ${r * 0.9}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('$', r * 0.1, 0);
      } else if (T.boss) {
        ctx.fillStyle = '#ffd84a';
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = i * Math.PI * 2 / 5;
          ctx.lineTo(r * 0.1 + Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
          ctx.lineTo(r * 0.1 + Math.cos(a + 0.6) * r * 0.25, Math.sin(a + 0.6) * r * 0.25);
        }
        ctx.closePath(); ctx.fill();
      }
    },
  });
  if (e.burn) {
    if (Math.random() < 0.3) run.fx.push({ kind: 'dot', x: e.x + rand(-e.r, e.r), y: e.y + rand(-e.r, e.r), vx: 0, vy: -40, size: rand(3, 5), color: Math.random() < 0.5 ? '#ff7a2a' : '#ffd23a', life: 0.35, max: 0.35 });
  }
  if (e.slowT > 0 && e.freezeT <= 0) {
    ctx.strokeStyle = 'rgba(155,231,255,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 3, 0, Math.PI * 2); ctx.stroke();
  }
  if (e.shield > 0) {
    ctx.strokeStyle = '#5fa8ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 5, 0, Math.PI * 2); ctx.stroke();
  }
  if (e.state === 'wind' && (T.charge || T.boss === 'charge')) {
    ctx.strokeStyle = 'rgba(255,80,60,0.5)'; ctx.lineWidth = e.r;
    ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.face) * 200, e.y + Math.sin(e.face) * 200); ctx.stroke();
  }
  if (e.state === 'wind' && T.boss === 'slam') {
    ctx.fillStyle = 'rgba(255,60,40,0.18)';
    ctx.beginPath(); ctx.arc(e.x, e.y, 170 * (1 - e.stateT), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,60,40,0.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(e.x, e.y, 170, 0, Math.PI * 2); ctx.stroke();
  }
  if (e.maxHp > pDmg() * 2.5 && e.hp < e.maxHp && !T.boss) {
    const w = e.r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w, 4);
    ctx.fillStyle = '#ff5a4a';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w * Math.max(0, e.hp / e.maxHp), 4);
  }
}

function drawBody(b) {
  const a = Math.min(1, b.life / 0.6);
  ctx.globalAlpha = a * 0.9;
  const s = 1 + b.z / 250;
  ctx.save();
  ctx.translate(b.x, b.y - b.z * 0.4);
  ctx.scale(s, s);
  drawFighter(0, 0, b.r, '#7b808c', b.rot, 0, { head: '#959aa6' });
  ctx.restore();
  ctx.globalAlpha = 1;
}

// 主角與橡皮鐵臂
function drawPlayer() {
  const p = run ? run.p : demo;
  const skin = '#f4c38f', glove = '#ff4d4d';
  const face = p.facing;
  const shoulder = side => ({ x: Math.cos(face + side * Math.PI / 2) * 12, y: Math.sin(face + side * Math.PI / 2) * 12 });
  // 伸長的手臂（畫在身體下層）
  const busy = { '-1': false, '1': false };
  for (const pu of p.punches) {
    const t = pu.t / pu.dur;
    const ext = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
    const sh = shoulder(pu.side);
    busy[pu.side] = true;
    const tx = sh.x + (pu.tx - sh.x) * ext, ty = sh.y + (pu.ty - sh.y) * ext;
    // 稍微彎曲的橡皮手臂
    const mx = (sh.x + tx) / 2 + Math.cos(face) * 0 - (ty - sh.y) * 0.12 * pu.side;
    const my = (sh.y + ty) / 2 + (tx - sh.x) * 0.12 * pu.side;
    ctx.strokeStyle = shade(skin, -30); ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.quadraticCurveTo(mx, my, tx, ty); ctx.stroke();
    ctx.strokeStyle = skin; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.quadraticCurveTo(mx, my, tx, ty); ctx.stroke();
    ctx.fillStyle = glove;
    ctx.beginPath(); ctx.arc(tx, ty, 9 + ext * 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(tx - 3, ty - 3, 3, 0, Math.PI * 2); ctx.fill();
  }
  const hurt = p.hurtT > 0;
  drawFighter(0, 0, PLAYER_R, hurt ? '#ff8a8a' : '#ffc83d', face, time * 0.3, {
    noFists: true, head: '#3a2618',
    extra: r => {
      // 頭帶
      ctx.strokeStyle = '#e8453c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r * 0.1, 0, r * 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.4, 0); ctx.lineTo(-r * 1.2, Math.sin(time * 9) * 5 + 3); ctx.stroke();
    },
  });
  // 待命的拳套
  for (const side of [-1, 1]) {
    if (busy[side]) continue;
    const a = face + side * 0.75;
    ctx.fillStyle = glove;
    ctx.beginPath(); ctx.arc(Math.cos(a) * 20, Math.sin(a) * 20, 8, 0, Math.PI * 2); ctx.fill();
  }
  if (run && p.shield > 0) {
    ctx.strokeStyle = 'rgba(124,200,255,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawWorld() {
  const p = run.p;
  // 出拳範圍
  ctx.strokeStyle = 'rgba(255,216,74,0.22)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.arc(0, 0, p.range, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // 區域
  for (const z of run.zones) {
    const a = Math.min(1, z.t / 0.5) * (0.5 + Math.sin(time * 10) * 0.1);
    ctx.fillStyle = z.kind === 'fire' ? `rgba(255,110,40,${0.3 * a})` : `rgba(140,200,60,${0.3 * a})`;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = z.kind === 'fire' ? `rgba(255,170,60,${0.7 * a})` : `rgba(170,230,80,${0.6 * a})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke();
  }
  // 天降鐵拳的預警圈
  for (const m of run.marks) {
    const k = 1 - m.t / m.max;
    ctx.strokeStyle = 'rgba(255,216,74,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,216,74,0.2)';
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * k, 0, Math.PI * 2); ctx.fill();
    // 落下中的拳頭（越來越小 = 越來越近）
    const s = 1 + (1 - k) * 2;
    ctx.globalAlpha = 0.4 + k * 0.6;
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath(); ctx.arc(m.x, m.y - (1 - k) * 60, 16 * s, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  for (const b of run.bodies) if (b.z <= 0) drawBody(b);
  // 經驗與金幣
  for (const o of run.orbs) {
    ctx.fillStyle = o.kind === 'xp' ? '#5ef2a0' : '#ffd84a';
    ctx.beginPath(); ctx.arc(o.x, o.y, o.kind === 'xp' ? 4 : 5, 0, Math.PI * 2); ctx.fill();
  }
  const sorted = run.enemies.slice().sort((a, b) => a.y - b.y);
  for (const e of sorted) if (!e.dead) drawEnemy(e);
  drawPlayer();
  if (run.skills.orbit && run.skills.orbit.pos) {
    for (const pos of run.skills.orbit.pos) {
      ctx.fillStyle = 'rgba(255,77,77,0.25)';
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 11, 0, Math.PI * 2); ctx.fill();
    }
  }
  for (const b of run.bodies) if (b.z > 0) drawBody(b);
  for (const pr of run.projs) {
    ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(Math.atan2(pr.vy, pr.vx));
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath(); ctx.ellipse(0, 0, 15, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath(); ctx.moveTo(-12, -6); ctx.lineTo(-28, 0); ctx.lineTo(-12, 6); ctx.fill();
    ctx.restore();
  }
  for (const b of run.eprojs) {
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-4, -8, 8, 16);
    ctx.fillStyle = '#a07850'; ctx.fillRect(-2.5, -12, 5, 5);
    ctx.restore();
  }
  // 特效
  for (const f of run.fx) {
    const a = Math.max(0, f.life / f.max);
    ctx.globalAlpha = a;
    if (f.kind === 'dot') { ctx.fillStyle = f.color; ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size); }
    else if (f.kind === 'ring') { ctx.strokeStyle = f.color; ctx.lineWidth = f.w * a + 1; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke(); }
    else if (f.kind === 'line') { ctx.strokeStyle = f.color; ctx.lineWidth = f.w; ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke(); }
    else if (f.kind === 'bolt') {
      for (const [w, c] of [[7, 'rgba(120,180,255,0.5)'], [3, '#ffffff']]) {
        ctx.strokeStyle = c; ctx.lineWidth = w;
        ctx.beginPath(); f.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const t of run.texts) {
    ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
    ctx.font = `900 ${t.size}px system-ui, sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

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
    outlineText(`x${tier}`, cx - 8, cy, fs * 1.6, col, 'right');
    outlineText(`${Math.floor(run.combo)} 連擊`, cx, cy, fs, col, 'left');
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
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, sz, sz);
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
  ultBtn.classList.toggle('ready', ready);
}

// 標題畫面用的展示主角
const demo = { facing: 0, punches: [], hurtT: 0 };
let demoT = 0;

function render(dt) {
  ctx.drawImage(bgCanvas, 0, 0, SW, SH);
  ctx.save();
  if (run && run.shake > 0) ctx.translate(rand(-1, 1) * run.shake, rand(-1, 1) * run.shake);
  ctx.translate(CX, CY);
  ctx.scale(S, S);
  if (run) drawWorld();
  else {
    // 標題：主角對空揮拳
    demoT -= dt;
    if (demoT <= 0) {
      demoT = 0.35;
      const a = rand(0, Math.PI * 2);
      demo.facing = a;
      demo.punches.push({ tx: Math.cos(a) * 130, ty: Math.sin(a) * 130, side: demo.punches.length % 2 ? 1 : -1, t: 0, dur: 0.22 });
    }
    for (const pu of demo.punches) pu.t += dt;
    demo.punches = demo.punches.filter(pu => pu.t < pu.dur);
    drawPlayer();
  }
  ctx.restore();
  if (run && (state === 'play' || state === 'pause' || state === 'levelup')) drawHUD();
  if (run && run.flash > 0) { ctx.fillStyle = `rgba(255,40,40,${run.flash})`; ctx.fillRect(0, 0, SW, SH); }
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

resize();
showTitle();
requestAnimationFrame(frame);
})();
