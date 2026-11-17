// ===== RL Fight：主程式 =====
(() => {
'use strict';

const W = 960, H = 540, GROUND = 430, PX = W / 2;
const PUNCH_TIME = 0.13;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const overlay = document.getElementById('overlay');
const pauseBtn = document.getElementById('pauseBtn');

// ---------- 畫面縮放 ----------
function resize() {
  const box = document.body;
  const scale = Math.min((box.clientWidth || window.innerWidth) / W, (box.clientHeight || window.innerHeight) / H);
  const dpr = window.devicePixelRatio || 1;
  stage.style.width = W * scale + 'px';
  stage.style.height = H * scale + 'px';
  stage.style.fontSize = 16 * scale + 'px';
  canvas.width = Math.round(W * scale * dpr);
  canvas.height = Math.round(H * scale * dpr);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ---------- 存檔 ----------
const SAVE_KEY = 'rlfight_save_v1';
function defaultSave() { return { bank: 0, best: 0, bestWave: 0, meta: {} }; }
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s) return Object.assign(defaultSave(), s);
  } catch (e) { /* 無法讀取時使用預設 */ }
  return defaultSave();
}
function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 忽略 */ }
}
let save = loadSave();

// ---------- 音效（WebAudio 合成） ----------
let actx = null;
let muted = false;
function ensureAudio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  }
  if (actx && actx.state === 'suspended') actx.resume();
}
function tone(freq, dur, type = 'square', vol = 0.06, slide = 0, delay = 0) {
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
function noise(dur, vol = 0.12) {
  if (!actx || muted) return;
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = actx.currentTime;
  const s = actx.createBufferSource(), g = actx.createGain();
  s.buffer = noiseBuf;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(g).connect(actx.destination);
  s.start(t); s.stop(t + dur);
}
const SFX = {
  punch: () => tone(220, 0.05, 'square', 0.03, -120),
  hit: () => { noise(0.07, 0.14); tone(140, 0.08, 'triangle', 0.12, -70); },
  crit: () => { noise(0.12, 0.2); tone(90, 0.16, 'sawtooth', 0.1, -50); tone(880, 0.08, 'square', 0.04, 400); },
  block: () => tone(1200, 0.08, 'triangle', 0.06, -600),
  miss: () => tone(360, 0.12, 'sine', 0.05, -240),
  hurt: () => { noise(0.2, 0.18); tone(110, 0.25, 'sawtooth', 0.1, -60); },
  boom: () => { noise(0.35, 0.25); tone(70, 0.35, 'sine', 0.2, -40); },
  coin: () => tone(1320, 0.06, 'square', 0.025, 300),
  upgrade: () => { tone(523, 0.1, 'square', 0.05); tone(659, 0.1, 'square', 0.05, 0, 0.08); tone(784, 0.16, 'square', 0.05, 0, 0.16); },
  wave: () => { tone(392, 0.12, 'triangle', 0.07); tone(523, 0.18, 'triangle', 0.07, 0, 0.1); },
  boss: () => { tone(110, 0.5, 'sawtooth', 0.08, -30); tone(82, 0.6, 'sawtooth', 0.08, -20, 0.25); },
  over: () => { tone(392, 0.2, 'triangle', 0.08); tone(311, 0.2, 'triangle', 0.08, 0, 0.18); tone(196, 0.5, 'triangle', 0.08, 0, 0.36); },
};

// ---------- 小工具 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function weighted(list) { // [[值, 權重], ...]
  let total = 0;
  for (const [, w] of list) total += w;
  let r = Math.random() * total;
  for (const [v, w] of list) { r -= w; if (r <= 0) return v; }
  return list[list.length - 1][0];
}

// ---------- 狀態 ----------
// title | play | upgrade | pause | gameover | shop
let state = 'title';
let run = null;
let time = 0;

function newPlayer() {
  return {
    x: PX, hp: 5, maxHp: 5, dmg: 1, reach: 95, crit: 0.05, critMult: 2,
    punchCd: 0.1, whiffCd: 0.4, kb: 280, doubleTap: 0, pierce: 0, vampire: 0,
    shockwave: 0, counter: 0, greed: 1, frenzy: 0, barrierMax: 0, barrier: 0,
    facing: 1, punchT: 0, punchDir: 1, punchReach: 0, cooldown: 0, invuln: 0, hurtT: 0,
  };
}

function newRun() {
  const p = newPlayer();
  run = {
    wave: 0, score: 0, gold: 0, combo: 0, maxCombo: 0, kills: 0, p,
    enemies: [], projectiles: [], particles: [], texts: [],
    spawnQueue: [], spawnTimer: 0, clearing: -1, taken: {}, rerolls: 0, headstart: false,
    shake: 0, hitstop: 0, flash: 0, banner: null, hintT: 6, choices: [],
  };
  for (const m of META_UPGRADES) {
    const lv = save.meta[m.id] || 0;
    if (lv > 0) m.apply(p, lv, run);
  }
}

// ---------- 波次 ----------
function buildWave(w) {
  const isBoss = w % 5 === 0;
  const count = isBoss ? 4 + w : 6 + Math.floor(w * 1.8);
  const pool = [['grunt', 10]];
  if (w >= 2) pool.push(['runner', 4 + w * 0.3]);
  if (w >= 3) pool.push(['shield', 3 + w * 0.3]);
  if (w >= 4) pool.push(['thrower', 2 + w * 0.2]);
  if (w >= 6) pool.push(['brute', 2 + w * 0.25]);
  if (w >= 7) pool.push(['bomber', 2 + w * 0.2]);
  const base = Math.max(0.36, 1.25 - w * 0.05);
  const q = [];
  for (let i = 0; i < count; i++) {
    // 偶爾來一波「連發」，兩隻幾乎同時出現
    const burst = w >= 3 && Math.random() < 0.15;
    q.push({ type: weighted(pool), side: Math.random() < 0.5 ? -1 : 1, delay: burst ? 0.12 : base * rand(0.6, 1.4) });
  }
  if (isBoss) q.splice(Math.min(2, q.length), 0, { type: 'boss', side: Math.random() < 0.5 ? -1 : 1, delay: 1.5 });
  q[0].delay = 1.0;
  return q;
}

function startWave() {
  run.wave++;
  const w = run.wave;
  run.p.barrier = run.p.barrierMax;
  run.spawnQueue = buildWave(w);
  run.spawnTimer = run.spawnQueue[0].delay;
  run.clearing = -1;
  if (w % 5 === 0) { setBanner('BOSS 來襲！', '#ff5a4a'); SFX.boss(); }
  else { setBanner(`第 ${w} 波`, '#ffcf4a'); SFX.wave(); }
  setState('play');
}

function setBanner(text, color) { run.banner = { text, color, t: 1.6 }; }

function spawnEnemy(entry) {
  const T = ENEMY_TYPES[entry.type];
  const w = run.wave;
  let hp = T.hp;
  if (T.boss) hp += Math.max(0, Math.floor(w / 5) - 1) * 15;
  else if (T.hp > 1) hp += Math.floor((w - 1) / 6);
  const off = T.r + 20;
  run.enemies.push({
    type: entry.type, T, hp, maxHp: hp, shield: T.shield || 0,
    x: entry.side < 0 ? -off : W + off,
    speed: T.speed * (1 + Math.min(0.6, (w - 1) * 0.025)) * rand(0.9, 1.1),
    kx: 0, flash: 0, stun: 0, anim: rand(0, 10), dead: false,
    throwT: (T.throwCd || 0) * 0.5, dashT: 3, dashing: 0,
  });
}

// ---------- 戰鬥 ----------
function punch(dir) {
  if (state !== 'play') return;
  const p = run.p;
  if (p.cooldown > 0) return;
  p.facing = dir; p.punchDir = dir; p.punchT = PUNCH_TIME; p.cooldown = p.punchCd;
  SFX.punch();

  // 找出該方向最近的目標（敵人或飛行物）
  let best = null, bestD = Infinity, kind = null;
  for (const e of run.enemies) {
    if (e.dead) continue;
    const dx = (e.x - p.x) * dir;
    if (dx < -5) continue;
    const d = dx - e.T.r;
    if (d < bestD) { bestD = d; best = e; kind = 'enemy'; }
  }
  for (const pr of run.projectiles) {
    if (pr.reflected) continue;
    const dx = (pr.x - p.x) * dir;
    if (dx < -5) continue;
    const d = dx - 10;
    if (d < bestD) { bestD = d; best = pr; kind = 'proj'; }
  }

  if (best && bestD <= p.reach) {
    p.punchReach = Math.max(20, bestD);
    if (kind === 'proj') {
      best.reflected = true;
      best.vx = dir * 620;
      spark(best.x, best.y, '#9be7ff', 10);
      addText(best.x, best.y - 20, '反彈!', '#9be7ff', 20);
      SFX.block();
      run.hitstop = Math.max(run.hitstop, 0.05);
    } else {
      hitEnemy(best, dir);
      if (p.pierce > 0) {
        const behind = run.enemies
          .filter(e => !e.dead && e !== best && (e.x - p.x) * dir > 0 && (e.x - p.x) * dir - e.T.r <= p.reach + 70)
          .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))
          .slice(0, p.pierce);
        for (const e of behind) dealDamage(e, p.dmg, dir, false);
      }
    }
    addCombo();
  } else {
    // 揮空：硬直、連擊中斷
    p.punchReach = p.reach;
    p.cooldown = p.whiffCd;
    if (run.combo >= 5) addText(p.x, GROUND - 150, '連擊中斷', '#ff8a65', 18);
    run.combo = 0;
    addText(p.x + dir * 60, GROUND - 110, 'MISS', '#aaaacc', 22);
    SFX.miss();
  }
}

function addCombo() {
  const p = run.p;
  run.combo++;
  run.maxCombo = Math.max(run.maxCombo, run.combo);
  if (p.vampire) {
    const every = p.vampire >= 2 ? 12 : 20;
    if (run.combo % every === 0 && p.hp < p.maxHp) {
      p.hp++;
      addText(p.x, GROUND - 170, '+1 ❤', '#ff6b8a', 24);
    }
  }
}

function hitEnemy(e, dir) {
  const p = run.p;
  let dmg = p.dmg + (p.frenzy && run.combo >= 15 ? p.frenzy : 0);
  const crit = Math.random() < p.crit;
  if (crit) dmg *= p.critMult;
  const hits = Math.random() < p.doubleTap ? 2 : 1;
  const ex = e.x;
  for (let i = 0; i < hits; i++) dealDamage(e, dmg, dir, crit, i > 0);
  if (crit && p.shockwave) shockwave(ex, p.shockwave);
}

function dealDamage(e, dmg, dir, crit, extra) {
  if (e.dead) return;
  const p = run.p;
  e.flash = 0.1;
  const hx = e.x - dir * e.T.r, hy = GROUND - e.T.r;
  if (e.shield > 0) {
    e.shield--;
    e.kx += dir * p.kb * 0.6 * e.T.kbRes;
    spark(hx, hy, '#7cc0ff', 14);
    addText(e.x, hy - e.T.r - 10, '破盾!', '#7cc0ff', 20);
    SFX.block();
    run.hitstop = Math.max(run.hitstop, 0.05);
    run.shake = Math.max(run.shake, 4);
    return;
  }
  e.hp -= dmg;
  e.kx += dir * p.kb * e.T.kbRes * (crit ? 1.6 : 1);
  e.stun = Math.max(e.stun, 0.15);
  spark(hx, hy, crit ? '#ffe14a' : '#ffffff', crit ? 18 : 9);
  addStar(hx, hy, crit ? 34 : 22, crit ? '#ffe14a' : '#fff');
  addText(e.x + rand(-10, 10), hy - e.T.r - 8 - (extra ? 20 : 0),
    crit ? `${dmg}!` : `${dmg}`, crit ? '#ffe14a' : '#ffffff', crit ? 30 : 20);
  run.hitstop = Math.max(run.hitstop, crit ? 0.09 : 0.045);
  run.shake = Math.max(run.shake, crit ? 10 : 5);
  if (crit) SFX.crit(); else SFX.hit();
  if (e.hp <= 0) killEnemy(e, dir);
}

function killEnemy(e, dir) {
  const p = run.p;
  e.dead = true;
  run.kills++;
  const pts = Math.round(e.T.score * (1 + run.combo * 0.05));
  run.score += pts;
  const g = Math.max(1, Math.round(e.T.gold * p.greed));
  run.gold += g;
  addText(e.x, GROUND - e.T.r * 2 - 30, `+${g}`, '#ffcf4a', 18);
  SFX.coin();
  // 屍體飛出去
  run.particles.push({
    kind: 'body', x: e.x, y: GROUND - e.T.r, vx: dir * rand(350, 550), vy: rand(-520, -380),
    rot: 0, vr: dir * rand(8, 14), r: e.T.r, color: e.T.color, life: 1.4, max: 1.4,
  });
  if (e.type === 'bomber') explode(e, false);
  if (e.T.boss) {
    run.shake = 22; run.hitstop = 0.25; run.flash = 0.4;
    setBanner('擊敗霸主！', '#ffcf4a');
    SFX.boom();
  }
}

function explode(e, hurtsPlayer) {
  e.dead = true;
  const R = 150;
  run.particles.push({ kind: 'ring', x: e.x, y: GROUND - 20, r: 10, maxR: R, life: 0.35, max: 0.35, color: '#ff9a3c' });
  spark(e.x, GROUND - 20, '#ff9a3c', 30);
  run.shake = Math.max(run.shake, 14);
  SFX.boom();
  for (const o of run.enemies) {
    if (o.dead || o === e) continue;
    if (Math.abs(o.x - e.x) < R) dealDamage(o, 3, Math.sign(o.x - e.x) || 1, false);
  }
  if (hurtsPlayer && Math.abs(run.p.x - e.x) < R) damagePlayer(e.T.dmg);
}

function shockwave(x, lv) {
  const R = 90 + 40 * lv;
  run.particles.push({ kind: 'ring', x, y: GROUND - 10, r: 10, maxR: R, life: 0.3, max: 0.3, color: '#7cf0ff' });
  for (const o of run.enemies) {
    if (o.dead) continue;
    if (Math.abs(o.x - x) < R) dealDamage(o, lv, Math.sign(o.x - run.p.x) || 1, false, true);
  }
}

function damagePlayer(d) {
  const p = run.p;
  if (p.invuln > 0 || state !== 'play') return;
  if (p.barrier > 0) {
    p.barrier--;
    p.invuln = 0.6;
    addText(p.x, GROUND - 160, '護身!', '#7cc0ff', 24);
    spark(p.x, GROUND - 70, '#7cc0ff', 16);
    SFX.block();
    return;
  }
  p.hp -= d;
  p.invuln = 0.9; p.hurtT = 0.3;
  if (run.combo >= 5) addText(p.x, GROUND - 150, '連擊中斷', '#ff8a65', 18);
  run.combo = 0;
  run.shake = Math.max(run.shake, 14);
  run.flash = 0.25;
  SFX.hurt();
  if (p.counter) {
    const R = 170;
    run.particles.push({ kind: 'ring', x: p.x, y: GROUND - 40, r: 20, maxR: R, life: 0.3, max: 0.3, color: '#ffffff' });
    for (const o of run.enemies) {
      if (o.dead) continue;
      if (Math.abs(o.x - p.x) < R) dealDamage(o, 2 * p.counter, Math.sign(o.x - p.x) || 1, false);
    }
  }
  if (p.hp <= 0) gameOver();
}

// ---------- 特效 ----------
function spark(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(120, 420);
    run.particles.push({ kind: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 100,
      size: rand(2, 5), color, life: rand(0.25, 0.5), max: 0.5 });
  }
}
function addStar(x, y, size, color) {
  run.particles.push({ kind: 'star', x, y, size, color, life: 0.12, max: 0.12, rot: rand(0, 1) });
}
function addText(x, y, text, color, size) {
  run.texts.push({ x, y, text, color, size, life: 0.9, max: 0.9 });
}

// ---------- 更新 ----------
function updateFx(dt) {
  for (const pt of run.particles) {
    pt.life -= dt;
    if (pt.kind === 'dot' || pt.kind === 'body') {
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 1400 * dt;
      if (pt.kind === 'body') pt.rot += pt.vr * dt;
      if (pt.kind === 'dot') { pt.vx *= 0.96; }
    } else if (pt.kind === 'ring') {
      pt.r += (pt.maxR - pt.r) * Math.min(1, dt * 14);
    }
  }
  run.particles = run.particles.filter(pt => pt.life > 0);
  for (const t of run.texts) { t.life -= dt; t.y -= 50 * dt; }
  run.texts = run.texts.filter(t => t.life > 0);
  run.shake = Math.max(0, run.shake - dt * 60);
  run.flash = Math.max(0, run.flash - dt);
  if (run.banner) { run.banner.t -= dt; if (run.banner.t <= 0) run.banner = null; }
}

function update(dt) {
  updateFx(dt);
  if (run.hitstop > 0) { run.hitstop -= dt; return; }
  const p = run.p;
  p.cooldown -= dt; p.punchT -= dt; p.invuln -= dt; p.hurtT -= dt;
  run.hintT -= dt;

  // 生怪
  if (run.spawnQueue.length) {
    run.spawnTimer -= dt;
    if (run.spawnTimer <= 0) {
      spawnEnemy(run.spawnQueue.shift());
      run.spawnTimer = run.spawnQueue.length ? run.spawnQueue[0].delay : 0;
    }
  }

  // 敵人
  for (const e of run.enemies) {
    if (e.dead) continue;
    e.anim += dt; e.flash -= dt;
    const dir = Math.sign(p.x - e.x) || 1;
    const dist = Math.abs(p.x - e.x);
    e.x += e.kx * dt;
    e.kx *= Math.exp(-7 * dt);
    let move = e.speed;
    if (e.stun > 0) { e.stun -= dt; move = 0; }
    if (e.type === 'thrower' && dist <= e.T.range) {
      move = 0;
      e.throwT -= dt;
      if (e.throwT <= 0) {
        e.throwT = e.T.throwCd;
        run.projectiles.push({ x: e.x + dir * 20, y: GROUND - 60, vx: dir * 270, reflected: false, rot: 0 });
      }
    }
    if (e.T.boss) {
      e.dashT -= dt;
      if (e.dashT <= 0 && dist > 200 && e.dashing <= 0) {
        e.dashing = 0.45;
        e.dashT = rand(3.2, 5);
        addText(e.x, GROUND - e.T.r * 2 - 20, '!!', '#ff5a4a', 34);
      }
      if (e.dashing > 0) { e.dashing -= dt; move = e.speed * 8; }
    }
    if (Math.abs(e.kx) > 60) move = 0;
    e.x += dir * move * dt;
    e.x = clamp(e.x, -150, W + 150);

    // 接觸玩家
    if (Math.abs(p.x - e.x) < e.T.r + 20) {
      if (e.type === 'bomber') { explode(e, true); continue; }
      damagePlayer(e.T.dmg);
      e.x = p.x - dir * (e.T.r + 21);
      e.kx = -dir * 380 * Math.max(0.35, e.T.kbRes);
      e.stun = 0.35;
      e.dashing = 0;
      if (state !== 'play') return;
    }
  }

  // 飛行物
  for (const pr of run.projectiles) {
    pr.x += pr.vx * dt;
    pr.rot += dt * 14;
    if (!pr.reflected) {
      if (Math.abs(pr.x - p.x) < 18) { pr.dead = true; damagePlayer(1); if (state !== 'play') return; }
    } else {
      const d = Math.sign(pr.vx);
      for (const e of run.enemies) {
        if (e.dead) continue;
        if (Math.abs(e.x - pr.x) < e.T.r + 6) { dealDamage(e, 2 + run.p.dmg, d, false); pr.dead = true; break; }
      }
    }
    if (pr.x < -60 || pr.x > W + 60) pr.dead = true;
  }
  run.projectiles = run.projectiles.filter(pr => !pr.dead);
  run.enemies = run.enemies.filter(e => !e.dead);

  // 清場判定
  if (run.clearing < 0 && !run.spawnQueue.length && !run.enemies.length && !run.projectiles.length) {
    run.clearing = 1.3;
    if (run.wave % 5 !== 0) setBanner('清場！', '#7cf08a');
  }
  if (run.clearing >= 0) {
    run.clearing -= dt;
    if (run.clearing < 0) openUpgrade();
  }
}

// ---------- 介面 ----------
function setState(s) {
  state = s;
  pauseBtn.classList.toggle('hidden', s !== 'play');
  if (s === 'play') overlay.classList.add('hidden');
}

function showOverlay(html) {
  overlay.innerHTML = html;
  overlay.classList.remove('hidden');
}

function showTitle() {
  setState('title');
  run = null;
  showOverlay(`
    <p class="sub">ROGUELIKE 拳擊</p>
    <h1>RL FIGHT</h1>
    <p>敵人從左右兩邊湧來，看準時機出拳！<br>揮空會露出破綻，被碰到就會受傷。每一波結束挑選強化，看你能撐到第幾波。</p>
    <div class="stats">
      <span>最高分</span><span>${save.best}</span>
      <span>最遠波數</span><span>${save.bestWave}</span>
      <span>金幣</span><span class="gold">${save.bank}</span>
    </div>
    <div class="row">
      <button class="btn" data-act="start">開始戰鬥</button>
      <button class="btn alt" data-act="shop">道場（永久強化）</button>
    </div>
    <p class="small">操作：← / A 左拳　→ / D 右拳　P 暫停　M 靜音　｜　手機：點左半邊或右半邊</p>
  `);
}

function showShop() {
  setState('shop');
  const items = META_UPGRADES.map(m => {
    const lv = save.meta[m.id] || 0;
    const maxed = lv >= m.costs.length;
    const cost = maxed ? 0 : m.costs[lv];
    return `<div class="shop-item">
      <div class="info"><div class="name">${m.name} <span class="small">Lv ${lv}/${m.costs.length}</span></div>
      <div class="desc">${m.desc}</div></div>
      <button class="btn" data-act="buy" data-id="${m.id}" ${maxed || save.bank < cost ? 'disabled' : ''}>
        ${maxed ? '已滿級' : `💰 ${cost}`}</button>
    </div>`;
  }).join('');
  showOverlay(`
    <h2>道場</h2>
    <p>持有金幣：<span class="gold">${save.bank}</span>（每局獲得的金幣會存進來）</p>
    <div class="shop">${items}</div>
    <button class="btn alt" data-act="title">返回</button>
  `);
}

function rollUpgrades(n) {
  const p = run.p;
  let avail = UPGRADES.filter(u => (run.taken[u.id] || 0) < u.max && (!u.cond || u.cond(p)));
  const out = [];
  while (out.length < n && avail.length) {
    const u = weighted(avail.map(u => [u, RARITY_WEIGHT[u.rarity]]));
    out.push(u);
    avail = avail.filter(x => x !== u);
  }
  return out;
}

function openUpgrade() {
  setState('upgrade');
  run.choices = rollUpgrades(3);
  renderUpgrade();
}

function renderUpgrade() {
  const p = run.p;
  const cards = run.choices.map((u, i) => {
    const lv = run.taken[u.id] || 0;
    return `<div class="card ${u.rarity}" data-act="pick" data-i="${i}">
      <div class="icon">${u.icon}</div>
      <div class="name">${u.name}</div>
      <div class="lv">${RARITY_NAME[u.rarity]}${u.max < 99 ? `・Lv ${lv} → ${lv + 1}` : ''}</div>
      <div class="desc">${u.desc}</div>
      <div class="key">按 ${i + 1}</div>
    </div>`;
  }).join('');
  const title = run.wave === 0 ? '起手式：選一個強化' : `第 ${run.wave} 波完成！選擇強化`;
  showOverlay(`
    <h2>${title}</h2>
    <p class="small">❤ ${p.hp}/${p.maxHp}　👊 ${p.dmg}　📏 ${Math.round(p.reach)}　🎯 ${Math.round(p.crit * 100)}%　💰 ${run.gold}　連擊最高 ${run.maxCombo}</p>
    <div class="cards">${cards}</div>
    <button class="btn alt" data-act="reroll" ${run.rerolls > 0 ? '' : 'disabled'}>🎲 重抽（剩 ${run.rerolls} 次，按 R）</button>
  `);
}

function pickUpgrade(i) {
  const u = run.choices[i];
  if (!u) return;
  u.apply(run.p);
  run.taken[u.id] = (run.taken[u.id] || 0) + 1;
  SFX.upgrade();
  startWave();
}

function reroll() {
  if (run.rerolls <= 0) return;
  run.rerolls--;
  run.choices = rollUpgrades(3);
  renderUpgrade();
}

function startRun() {
  newRun();
  if (run.headstart) openUpgrade();
  else startWave();
}

function pause() {
  if (state !== 'play') return;
  setState('pause');
  showOverlay(`
    <h2>暫停</h2>
    <div class="row">
      <button class="btn" data-act="resume">繼續</button>
      <button class="btn alt" data-act="quit">放棄這局</button>
    </div>
  `);
}

function gameOver() {
  setState('gameover');
  SFX.over();
  const newBest = run.score > save.best;
  save.bank += run.gold;
  save.best = Math.max(save.best, run.score);
  save.bestWave = Math.max(save.bestWave, run.wave);
  writeSave();
  showOverlay(`
    <h2>倒下了…</h2>
    ${newBest ? '<p class="gold">★ 新紀錄！ ★</p>' : ''}
    <div class="stats">
      <span>到達波數</span><span>${run.wave}</span>
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

overlay.addEventListener('click', ev => {
  ensureAudio();
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (act === 'start') startRun();
  else if (act === 'shop') showShop();
  else if (act === 'title') showTitle();
  else if (act === 'pick') pickUpgrade(+el.dataset.i);
  else if (act === 'reroll') reroll();
  else if (act === 'resume') setState('play');
  else if (act === 'quit') gameOver();
  else if (act === 'buy') {
    const m = META_UPGRADES.find(x => x.id === el.dataset.id);
    const lv = save.meta[m.id] || 0;
    if (lv < m.costs.length && save.bank >= m.costs[lv]) {
      save.bank -= m.costs[lv];
      save.meta[m.id] = lv + 1;
      writeSave();
      SFX.upgrade();
      showShop();
    }
  }
});

pauseBtn.addEventListener('click', () => pause());

// ---------- 輸入 ----------
window.addEventListener('keydown', ev => {
  if (ev.repeat) return;
  ensureAudio();
  const k = ev.key.toLowerCase();
  if (k === 'm') { muted = !muted; return; }
  if (state === 'play') {
    if (k === 'arrowleft' || k === 'a' || k === 'j') { punch(-1); ev.preventDefault(); }
    else if (k === 'arrowright' || k === 'd' || k === 'l') { punch(1); ev.preventDefault(); }
    else if (k === 'p' || k === 'escape') pause();
  } else if (state === 'pause') {
    if (k === 'p' || k === 'escape') setState('play');
  } else if (state === 'upgrade') {
    if (k === '1' || k === '2' || k === '3') pickUpgrade(+k - 1);
    else if (k === 'r') reroll();
  } else if (state === 'title' || state === 'gameover') {
    if (k === 'enter' || k === ' ') startRun();
  }
});

canvas.addEventListener('pointerdown', ev => {
  ensureAudio();
  if (state !== 'play') return;
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) / rect.width * W;
  punch(x < W / 2 ? -1 : 1);
  ev.preventDefault();
});

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- 繪圖 ----------
// 背景城市剪影（預先畫好）
const bgCanvas = document.createElement('canvas');
bgCanvas.width = W; bgCanvas.height = H;
(function drawBgOnce() {
  const b = bgCanvas.getContext('2d');
  const g = b.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, '#1a1036');
  g.addColorStop(0.6, '#4a1f4f');
  g.addColorStop(1, '#c2484a');
  b.fillStyle = g;
  b.fillRect(0, 0, W, GROUND);
  // 月亮
  b.fillStyle = 'rgba(255,220,180,.85)';
  b.beginPath(); b.arc(760, 110, 46, 0, Math.PI * 2); b.fill();
  // 兩層建築
  const layers = [{ c: '#2b1838', h: [120, 230], y: GROUND - 40 }, { c: '#170d22', h: [60, 170], y: GROUND }];
  for (const L of layers) {
    let x = -10;
    while (x < W) {
      const bw = rand(40, 90), bh = rand(L.h[0], L.h[1]);
      b.fillStyle = L.c;
      b.fillRect(x, L.y - bh, bw, bh);
      b.fillStyle = 'rgba(255,200,120,.25)';
      for (let wy = L.y - bh + 10; wy < L.y - 10; wy += 16)
        for (let wx = x + 6; wx < x + bw - 8; wx += 12)
          if (Math.random() < 0.3) b.fillRect(wx, wy, 5, 7);
      x += bw + rand(2, 10);
    }
  }
  // 地面
  const gg = b.createLinearGradient(0, GROUND, 0, H);
  gg.addColorStop(0, '#3b2a2a');
  gg.addColorStop(1, '#1a1212');
  b.fillStyle = gg;
  b.fillRect(0, GROUND, W, H - GROUND);
  b.fillStyle = '#e8453c';
  b.fillRect(0, GROUND, W, 4);
  b.strokeStyle = 'rgba(255,255,255,.05)';
  for (let i = -20; i < 40; i++) {
    b.beginPath(); b.moveTo(i * 40, GROUND); b.lineTo(i * 40 - 120, H); b.stroke();
  }
})();

function drawReach(p) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,207,74,.25)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  for (const d of [-1, 1]) {
    const x = p.x + d * (p.reach + 20);
    ctx.beginPath(); ctx.moveTo(x, GROUND - 6); ctx.lineTo(x, GROUND + 20); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,207,74,.06)';
  ctx.fillRect(p.x - p.reach - 20, GROUND + 4, (p.reach + 20) * 2, 16);
  ctx.restore();
}

function drawShadow(x, r) {
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(x, GROUND + 4, r, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
}

function drawPlayer(p) {
  const x = p.x;
  if (p.invuln > 0 && Math.floor(time * 20) % 2 === 0) return;
  drawShadow(x, 30);
  const bob = Math.sin(time * 8) * 2;
  const f = p.facing;
  ctx.save();
  ctx.translate(x, 0);
  ctx.lineCap = 'round';
  // 腿
  ctx.strokeStyle = '#2d3a6b'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(-8, GROUND - 40); ctx.lineTo(-14, GROUND); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, GROUND - 40); ctx.lineTo(14, GROUND); ctx.stroke();
  // 身體
  ctx.fillStyle = p.hurtT > 0 ? '#ff6b6b' : '#f2c79a';
  roundRect(-17, GROUND - 92 + bob, 34, 56, 12); ctx.fill();
  ctx.fillStyle = '#e8453c';
  roundRect(-18, GROUND - 52 + bob, 36, 16, 5); ctx.fill(); // 短褲
  // 頭
  const hy = GROUND - 110 + bob;
  ctx.fillStyle = '#f2c79a';
  ctx.beginPath(); ctx.arc(0, hy, 17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2a1a12';
  ctx.beginPath(); ctx.arc(0, hy - 4, 17, Math.PI, Math.PI * 2); ctx.fill();
  // 頭帶與飄帶
  ctx.fillStyle = '#e8453c';
  ctx.fillRect(-17, hy - 8, 34, 6);
  ctx.strokeStyle = '#e8453c'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-f * 16, hy - 5);
  ctx.quadraticCurveTo(-f * 30, hy - 10 + Math.sin(time * 10) * 4, -f * 42, hy - 2 + Math.sin(time * 12) * 5);
  ctx.stroke();
  // 眼睛
  ctx.fillStyle = '#111';
  ctx.fillRect(f * 5 - 2, hy, 4, 5);
  // 手套
  const shoulderY = GROUND - 80 + bob;
  let ext = 0;
  if (p.punchT > 0) {
    const t = 1 - p.punchT / PUNCH_TIME;
    ext = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65;
  }
  const maxExt = Math.min(70, p.punchReach);
  // 後手
  drawGlove(-p.punchDir * 14 + (p.punchT > 0 ? 0 : f * 18), shoulderY + 6, '#b3261e');
  // 出拳手
  const gx = p.punchT > 0 ? p.punchDir * (22 + ext * maxExt) : f * 24;
  ctx.strokeStyle = '#f2c79a'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(0, shoulderY); ctx.lineTo(gx, shoulderY); ctx.stroke();
  drawGlove(gx, shoulderY, '#e8453c');
  // 拳風
  if (p.punchT > 0 && ext > 0.3) {
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * ext})`;
    ctx.lineWidth = 3;
    for (const dy of [-8, 0, 8]) {
      ctx.beginPath();
      ctx.moveTo(gx + p.punchDir * 14, shoulderY + dy);
      ctx.lineTo(gx + p.punchDir * (14 + p.punchReach * 0.4 * ext), shoulderY + dy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawGlove(x, y, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath(); ctx.arc(x - 4, y - 4, 4, 0, Math.PI * 2); ctx.fill();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function drawEnemyBody(T, x, cy, r, face, anim, flash, e) {
  const squash = 1 + Math.sin(anim * 12) * 0.05;
  ctx.save();
  ctx.translate(x, cy);
  ctx.scale(1 / squash, squash);
  // 身體
  ctx.fillStyle = flash ? '#ffffff' : T.color;
  ctx.strokeStyle = shade(T.color, -60);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // 眼睛與眉毛（朝向玩家）
  const ex = face * r * 0.35, ey = -r * 0.2, es = Math.max(3, r * 0.14);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(ex - es * 1.3, ey, es, 0, Math.PI * 2); ctx.arc(ex + es * 1.3, ey, es, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(ex - es * 1.3 + face * 1.5, ey, es * 0.5, 0, Math.PI * 2); ctx.arc(ex + es * 1.3 + face * 1.5, ey, es * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(ex - es * 2.4, ey - es * 1.6); ctx.lineTo(ex - es * 0.3, ey - es * 1.0);
  ctx.moveTo(ex + es * 2.4, ey - es * 1.6); ctx.lineTo(ex + es * 0.3, ey - es * 1.0);
  ctx.stroke();

  if (e) {
    if (e.type === 'runner') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(-r, -r * 0.65, r * 2, 4);
    } else if (e.type === 'thrower') {
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(face * (r + 2) - 4, -r * 0.6, 8, 16);
    } else if (e.type === 'bomber') {
      ctx.strokeStyle = '#c9a26b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(-face * 8, -r - 10, -face * 4, -r - 16); ctx.stroke();
      ctx.fillStyle = Math.floor(anim * 16) % 2 ? '#ffe14a' : '#ff5a1f';
      ctx.beginPath(); ctx.arc(-face * 4, -r - 17, 4, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'brute') {
      ctx.fillStyle = shade(T.color, -30);
      ctx.beginPath(); ctx.arc(face * r * 0.9, r * 0.35, r * 0.35, 0, Math.PI * 2); ctx.fill();
    } else if (e.T.boss) {
      ctx.fillStyle = '#ffcf4a';
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.8); ctx.lineTo(-r * 0.5, -r * 1.25); ctx.lineTo(-r * 0.25, -r * 1.02);
      ctx.lineTo(0, -r * 1.35); ctx.lineTo(r * 0.25, -r * 1.02); ctx.lineTo(r * 0.5, -r * 1.25); ctx.lineTo(r * 0.5, -r * 0.8);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(T.color, -40);
      ctx.beginPath(); ctx.arc(face * r * 0.95, r * 0.3, r * 0.32, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawEnemy(e) {
  const r = e.T.r;
  const face = Math.sign(run.p.x - e.x) || 1;
  drawShadow(e.x, r);
  const hop = e.type === 'runner' ? Math.abs(Math.sin(e.anim * 14)) * 6 : Math.abs(Math.sin(e.anim * 8)) * 3;
  drawEnemyBody(e.T, e.x, GROUND - r - hop, r, face, e.anim, e.flash > 0, e);
  if (e.shield > 0) {
    ctx.fillStyle = '#4a8fd8'; ctx.strokeStyle = '#cfe6ff'; ctx.lineWidth = 3;
    roundRect(e.x + face * (r + 2) - 6, GROUND - r * 2 - 10, 12, r * 2 + 4, 5);
    ctx.fill(); ctx.stroke();
  }
  // 多血量敵人顯示血條
  if (e.maxHp > 1 && !e.T.boss) {
    const w = r * 1.6;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(e.x - w / 2, GROUND - r * 2 - 18, w, 5);
    ctx.fillStyle = '#ff5a4a';
    ctx.fillRect(e.x - w / 2, GROUND - r * 2 - 18, w * Math.max(0, e.hp / e.maxHp), 5);
  }
}

function drawProjectile(pr) {
  ctx.save();
  ctx.translate(pr.x, pr.y);
  ctx.rotate(pr.rot);
  ctx.fillStyle = pr.reflected ? '#9be7ff' : '#6b4a2b';
  ctx.fillRect(-5, -9, 10, 18);
  ctx.fillStyle = pr.reflected ? '#fff' : '#a07850';
  ctx.fillRect(-3, -13, 6, 5);
  ctx.restore();
}

function drawParticles() {
  for (const pt of run.particles) {
    const a = Math.max(0, pt.life / pt.max);
    if (pt.kind === 'dot') {
      ctx.globalAlpha = a;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    } else if (pt.kind === 'ring') {
      ctx.globalAlpha = a;
      ctx.strokeStyle = pt.color; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(pt.x, pt.y, pt.r, pt.r * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (pt.kind === 'star') {
      ctx.globalAlpha = a;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const ang = pt.rot + i * Math.PI / 8;
        const rr = i % 2 ? pt.size * 0.35 : pt.size;
        ctx.lineTo(pt.x + Math.cos(ang) * rr, pt.y + Math.sin(ang) * rr);
      }
      ctx.closePath(); ctx.fill();
    } else if (pt.kind === 'body') {
      ctx.globalAlpha = Math.min(1, a * 2);
      ctx.save();
      ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(0, 0, pt.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
      const s = pt.r * 0.25;
      ctx.beginPath();
      ctx.moveTo(-s * 2, -s * 1.5); ctx.lineTo(-s * 0.6, -s * 0.1); ctx.moveTo(-s * 0.6, -s * 1.5); ctx.lineTo(-s * 2, -s * 0.1);
      ctx.moveTo(s * 0.6, -s * 1.5); ctx.lineTo(s * 2, -s * 0.1); ctx.moveTo(s * 2, -s * 1.5); ctx.lineTo(s * 0.6, -s * 0.1);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

function drawTexts() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of run.texts) {
    const a = Math.min(1, t.life / t.max * 2);
    const pop = 1 + Math.max(0, (t.life - t.max + 0.12) / 0.12) * 0.5;
    ctx.globalAlpha = a;
    ctx.font = `900 ${t.size * pop}px system-ui, sans-serif`;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

function drawHeart(x, y, s, filled) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.65, x, y + s * 0.8, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.65, x + s * 0.5, y + s * 0.35);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.35);
  ctx.fillStyle = filled ? '#ff4a5e' : 'rgba(255,255,255,.15)';
  ctx.fill();
}

function outlineText(text, x, y, size, color, align = 'left') {
  ctx.font = `900 ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.6)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawHUD() {
  const p = run.p;
  for (let i = 0; i < p.maxHp; i++) drawHeart(30 + i * 30, 18, 24, i < p.hp);
  for (let i = 0; i < p.barrier; i++) {
    const x = 26 + i * 22, y = 58;
    ctx.fillStyle = '#7cc0ff';
    ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.closePath(); ctx.fill();
  }
  outlineText(`${run.score}`, W / 2, 30, 30, '#ffffff', 'center');
  outlineText(`第 ${run.wave} 波`, W - 20, 26, 22, '#ffcf4a', 'right');
  outlineText(`💰 ${run.gold}`, W - 20, 54, 18, '#ffcf4a', 'right');
  const remain = run.spawnQueue.length + run.enemies.length;
  if (remain > 0) outlineText(`剩餘 ${remain}`, W / 2, 58, 15, '#c9c9d6', 'center');

  if (run.combo >= 3) {
    const pulse = 1 + Math.max(0, 0.15 - (time % 0.3)) * 1.5;
    const col = run.combo >= 30 ? '#ff5aff' : run.combo >= 15 ? '#ff7a3c' : '#ffe14a';
    ctx.save();
    ctx.translate(W / 2, 110);
    ctx.scale(pulse, pulse);
    outlineText(`${run.combo}`, 0, 0, 44, col, 'center');
    outlineText('COMBO', 0, 30, 16, col, 'center');
    ctx.restore();
  }

  const boss = run.enemies.find(e => e.T.boss);
  if (boss) {
    const bw = 420, bx = W / 2 - bw / 2, by = H - 34;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx - 3, by - 3, bw + 6, 18);
    ctx.fillStyle = '#c0392b'; ctx.fillRect(bx, by, bw * Math.max(0, boss.hp / boss.maxHp), 12);
    outlineText(boss.T.name, W / 2, by - 14, 16, '#ffcf4a', 'center');
  }

  if (run.banner) {
    const b = run.banner;
    const a = Math.min(1, b.t / 0.3);
    const s = 1 + Math.max(0, b.t - 1.3) * 2;
    ctx.globalAlpha = a;
    ctx.save(); ctx.translate(W / 2, H / 2 - 60); ctx.scale(s, s);
    outlineText(b.text, 0, 0, 56, b.color, 'center');
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  if (run.wave === 1 && run.hintT > 0) {
    ctx.globalAlpha = Math.min(1, run.hintT);
    outlineText('◀  A / ← / 點左邊', 30, H - 40, 18, '#ffffff', 'left');
    outlineText('D / → / 點右邊  ▶', W - 30, H - 40, 18, '#ffffff', 'right');
    ctx.globalAlpha = 1;
  }
}

// 標題畫面的展示角色
const demoPlayer = newPlayer();
let demoT = 0;

function render() {
  ctx.save();
  if (run && run.shake > 0) ctx.translate(rand(-1, 1) * run.shake, rand(-1, 1) * run.shake);
  ctx.drawImage(bgCanvas, 0, 0, W, H);
  if (run) {
    drawReach(run.p);
    for (const e of run.enemies) drawEnemy(e);
    for (const pr of run.projectiles) drawProjectile(pr);
    drawPlayer(run.p);
    drawParticles();
    drawTexts();
  } else {
    // 標題畫面：角色左右空揮
    demoT -= 1 / 60;
    if (demoT <= 0) {
      demoT = 0.45;
      demoPlayer.punchDir = demoPlayer.facing = Math.random() < 0.5 ? -1 : 1;
      demoPlayer.punchT = PUNCH_TIME;
      demoPlayer.punchReach = 60;
    }
    demoPlayer.punchT -= 1 / 60;
    drawPlayer(demoPlayer);
  }
  ctx.restore();
  if (run && state !== 'gameover') drawHUD();
  if (run && run.flash > 0) {
    ctx.fillStyle = `rgba(255,40,40,${run.flash})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ---------- 主迴圈 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  if (state === 'play') update(dt);
  else if (run && state === 'gameover') updateFx(dt);
  render();
  requestAnimationFrame(frame);
}

// 測試用掛鉤
window.__rlfight = { get state() { return state; }, get run() { return run; }, punch, startRun };

showTitle();
requestAnimationFrame(frame);
})();
