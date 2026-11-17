// ===== 遊戲資料：敵人、強化、永久強化 =====
'use strict';

// 敵人種類
// hp: 血量, speed: 移動速度(px/s), dmg: 接觸傷害, r: 體型半徑, kbRes: 被擊退係數(越小越難推)
const ENEMY_TYPES = {
  grunt:   { name: '小混混', hp: 1, speed: 110, dmg: 1, r: 22, color: '#e0a458', score: 10,  gold: 1,  kbRes: 1 },
  runner:  { name: '飛毛腿', hp: 1, speed: 215, dmg: 1, r: 18, color: '#e05858', score: 15,  gold: 1,  kbRes: 1 },
  shield:  { name: '盾兵',   hp: 1, shield: 1, speed: 90, dmg: 1, r: 24, color: '#5aa0d8', score: 25, gold: 2, kbRes: 0.8 },
  thrower: { name: '投擲手', hp: 1, speed: 100, dmg: 1, r: 20, color: '#58c08a', score: 25,  gold: 2,  kbRes: 1, range: 330, throwCd: 2.4 },
  brute:   { name: '壯漢',   hp: 3, speed: 65,  dmg: 2, r: 32, color: '#8a6bd1', score: 30,  gold: 3,  kbRes: 0.55 },
  bomber:  { name: '自爆客', hp: 1, speed: 135, dmg: 2, r: 20, color: '#3a3a44', score: 20,  gold: 2,  kbRes: 1 },
  boss:    { name: '擂台霸主', hp: 25, speed: 45, dmg: 2, r: 56, color: '#c0392b', score: 500, gold: 30, kbRes: 0.15, boss: true },
};

// 局內強化（每波結束三選一）
// rarity: common / rare / epic, max: 可疊加次數, cond: 出現條件
const UPGRADES = [
  { id: 'iron_fist', icon: '👊', name: '鐵拳', rarity: 'rare', max: 5,
    desc: '拳頭傷害 +1', apply: p => { p.dmg += 1; } },
  { id: 'long_arm', icon: '💪', name: '長臂', rarity: 'common', max: 5,
    desc: '出拳距離 +18', apply: p => { p.reach += 18; } },
  { id: 'crit', icon: '🎯', name: '會心一擊', rarity: 'common', max: 5,
    desc: '暴擊率 +12%', apply: p => { p.crit += 0.12; } },
  { id: 'crit_dmg', icon: '💥', name: '致命打擊', rarity: 'rare', max: 3,
    desc: '暴擊傷害倍率 +1', apply: p => { p.critMult += 1; } },
  { id: 'double', icon: '✌️', name: '連打', rarity: 'rare', max: 4,
    desc: '每拳有 20% 機率多打一下', apply: p => { p.doubleTap += 0.2; } },
  { id: 'pierce', icon: '➰', name: '貫穿拳', rarity: 'rare', max: 3,
    desc: '拳勁貫穿，額外擊中後方 1 名敵人', apply: p => { p.pierce += 1; } },
  { id: 'vampire', icon: '🩸', name: '吸血拳', rarity: 'epic', max: 2,
    desc: '每達成 20 連擊回復 1 點生命（第二級改為每 12 連擊）', apply: p => { p.vampire += 1; } },
  { id: 'shock', icon: '🌊', name: '震地波', rarity: 'epic', max: 3,
    desc: '暴擊時產生衝擊波，傷害周圍敵人', apply: p => { p.shockwave += 1; } },
  { id: 'counter', icon: '🛡️', name: '反擊架勢', rarity: 'rare', max: 3,
    desc: '受傷時震開並傷害周圍敵人', apply: p => { p.counter += 1; } },
  { id: 'focus', icon: '🧘', name: '專注', rarity: 'common', max: 2,
    desc: '揮空後的硬直時間 -40%', apply: p => { p.whiffCd *= 0.6; } },
  { id: 'knock', icon: '🥊', name: '重拳', rarity: 'common', max: 3,
    desc: '擊退距離大幅提升', apply: p => { p.kb += 130; } },
  { id: 'tough', icon: '❤️', name: '鐵布衫', rarity: 'common', max: 5,
    desc: '最大生命 +1，並回復 1 點', apply: p => { p.maxHp += 1; p.hp += 1; } },
  { id: 'heal', icon: '🍙', name: '喘口氣', rarity: 'common', max: 99,
    desc: '回復 2 點生命', cond: p => p.hp < p.maxHp, apply: p => { p.hp = Math.min(p.maxHp, p.hp + 2); } },
  { id: 'greed', icon: '💰', name: '招財拳', rarity: 'common', max: 3,
    desc: '金幣獲得量 +50%', apply: p => { p.greed += 0.5; } },
  { id: 'frenzy', icon: '🔥', name: '狂熱', rarity: 'epic', max: 2,
    desc: '連擊數達 15 以上時，傷害 +1', apply: p => { p.frenzy += 1; } },
  { id: 'barrier', icon: '🔰', name: '護身氣', rarity: 'rare', max: 2,
    desc: '每波開始獲得 1 層護盾，可抵擋一次傷害', apply: p => { p.barrierMax += 1; p.barrier += 1; } },
  { id: 'speed', icon: '⚡', name: '快拳', rarity: 'common', max: 3,
    desc: '出拳冷卻 -20%', apply: p => { p.punchCd *= 0.8; } },
];

const RARITY_WEIGHT = { common: 60, rare: 30, epic: 10 };
const RARITY_NAME = { common: '普通', rare: '稀有', epic: '史詩' };

// 永久強化（道場），用累積的金幣購買
const META_UPGRADES = [
  { id: 'vitality', name: '強健體魄', desc: '起始最大生命 +1', costs: [40, 100, 200],
    apply: (p, lv) => { p.maxHp += lv; p.hp += lv; } },
  { id: 'reach', name: '臂展訓練', desc: '起始出拳距離 +10', costs: [30, 80, 160],
    apply: (p, lv) => { p.reach += 10 * lv; } },
  { id: 'power', name: '眼明手快', desc: '起始暴擊率 +4%', costs: [50, 120, 240],
    apply: (p, lv) => { p.crit += 0.04 * lv; } },
  { id: 'reroll', name: '幸運星', desc: '每局可重抽強化 +1 次', costs: [60, 150],
    apply: (p, lv, run) => { run.rerolls += lv; } },
  { id: 'headstart', name: '起手式', desc: '開局先獲得一次強化三選一', costs: [120],
    apply: (p, lv, run) => { run.headstart = lv > 0; } },
];
