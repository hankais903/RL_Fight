// ===== 遊戲資料：敵人、數值強化、技能說明、元素組合、道場 =====
'use strict';

// 敵人種類（數值為第 1 章第 1 波的基準，之後依章節與波次成長）
// hp 血量 / speed 移動速度 / dmg 每次攻擊傷害 / r 體型 / mass 越重越難擊退
const ENEMY_TYPES = {
  grunt:   { name: '小嘍囉', hp: 5,   speed: 58,  dmg: 2,  r: 15, color: '#d9534f', xp: 1, gold: 1,  mass: 1 },
  runner:  { name: '快腿仔', hp: 4,   speed: 112, dmg: 2,  r: 13, color: '#f0883e', xp: 1, gold: 1,  mass: 0.8 },
  tank:    { name: '肉盾',   hp: 24,  speed: 36,  dmg: 6, r: 24, color: '#8e5bd1', xp: 4, gold: 3,  mass: 3 },
  bomber:  { name: '炸彈客', hp: 5,   speed: 76,  dmg: 10, r: 15, color: '#44444f', xp: 2, gold: 2,  mass: 1, explode: true },
  charger: { name: '蠻牛',   hp: 18,  speed: 46,  dmg: 6, r: 18, color: '#b5652f', xp: 3, gold: 2,  mass: 2, charge: true },
  drummer: { name: '鼓手',   hp: 12,  speed: 42,  dmg: 2,  r: 16, color: '#3a7bd5', xp: 3, gold: 2,  mass: 1, buffer: true },
  spore:   { name: '毒菇頭', hp: 10,  speed: 48,  dmg: 2,  r: 16, color: '#8fbf3a', xp: 2, gold: 2,  mass: 1, poison: true },
  goldie:  { name: '錢袋鼠', hp: 14,  speed: 95,  dmg: 0,  r: 14, color: '#f2c230', xp: 3, gold: 20, mass: 1, flee: true },
  // 每章第 10 波的頭目
  boss_slam:   { name: '鐵拳大王', hp: 600, speed: 30, dmg: 10, r: 44, color: '#c0392b', xp: 40, gold: 60, mass: 25, boss: 'slam' },
  boss_charge: { name: '暴走牛王', hp: 520, speed: 34, dmg: 12, r: 39, color: '#a0522d', xp: 40, gold: 60, mass: 25, boss: 'charge' },
  boss_summon: { name: '幫派老大', hp: 560, speed: 26, dmg: 8, r: 41, color: '#6c3483', xp: 40, gold: 60, mass: 25, boss: 'summon' },
};
const BOSS_ORDER = ['boss_slam', 'boss_charge', 'boss_summon'];

// 數值強化（升級三選一時出現）
const STAT_UPGRADES = [
  { id: 'dmg',      icon: '👊', name: '重拳',     max: 10, rarity: 'common', desc: '出拳傷害 +25%' },
  { id: 'rate',     icon: '⚡', name: '快拳',     max: 8,  rarity: 'common', desc: '出拳速度 +12%' },
  { id: 'range',    icon: '📏', name: '長臂',     max: 6,  rarity: 'common', desc: '出拳範圍 +18' },
  { id: 'crit',     icon: '🎯', name: '會心',     max: 8,  rarity: 'common', desc: '暴擊率 +6%' },
  { id: 'critDmg',  icon: '💥', name: '致命',     max: 6,  rarity: 'rare',   desc: '暴擊傷害 +30%' },
  { id: 'maxHp',    icon: '❤️', name: '鐵布衫',   max: 8,  rarity: 'common', desc: '最大生命 +20，並回復 20' },
  { id: 'regen',    icon: '💚', name: '調息',     max: 5,  rarity: 'common', desc: '每秒回復生命 +1' },
  { id: 'lifesteal',icon: '🩸', name: '吸血拳',   max: 5,  rarity: 'rare',   desc: '造成傷害的 3% 轉為生命' },
  { id: 'kb',       icon: '🌪️', name: '震退',     max: 4,  rarity: 'common', desc: '擊退距離 +35%' },
  { id: 'xp',       icon: '📘', name: '悟性',     max: 5,  rarity: 'common', desc: '經驗獲得 +20%' },
  { id: 'skillDmg', icon: '✨', name: '氣功',     max: 8,  rarity: 'common', desc: '技能傷害 +20%' },
  { id: 'multi',    icon: '🤜', name: '多重拳',   max: 3,  rarity: 'epic',   desc: '每次出拳多打 1 個敵人' },
  { id: 'heal',     icon: '🍗', name: '大吃一頓', max: 99, rarity: 'common', desc: '回復 40% 生命' },
];

// 技能（自動施放或被動，最多 5 級）。element：fire 火 / ice 冰 / lightning 雷
const SKILL_INFO = {
  rocket:  { icon: '🚀', name: '火箭飛拳', desc: '定時朝最近的敵人射出貫穿的飛拳', up: '飛拳數量與傷害提升' },
  quake:   { icon: '🌋', name: '震地拳',   desc: '定時捶地，震傷並擊退周圍敵人', up: '範圍與傷害提升' },
  meteor:  { icon: '☄️', name: '天降鐵拳', desc: '巨大拳頭從天而降砸向敵人', up: '拳頭數量與傷害提升' },
  orbit:   { icon: '🥊', name: '迴旋拳套', desc: '拳套環繞身邊，碰到敵人就打', up: '拳套數量與傷害提升' },
  bounce:  { icon: '🔁', name: '彈射拳',   desc: '出拳後彈到附近另一個敵人', up: '彈射次數與傷害提升' },
  firePunch:   { icon: '🔥', name: '烈焰拳',   element: 'fire',      desc: '出拳使敵人燃燒，持續受傷', up: '燃燒傷害提升' },
  fireZone:    { icon: '♨️', name: '烈焰陣',   element: 'fire',      desc: '在敵人最密集處燃起火陣', up: '範圍、時間與傷害提升' },
  icePunch:    { icon: '🧊', name: '寒霜拳',   element: 'ice',       desc: '出拳使敵人減速，有機率冰凍', up: '冰凍機率提升' },
  frostNova:   { icon: '❄️', name: '冰霜爆發', element: 'ice',       desc: '定時冰凍周圍所有敵人', up: '範圍與冰凍時間提升' },
  thunderPunch:{ icon: '⚡', name: '雷電拳',   element: 'lightning', desc: '出拳有機率放出閃電打附近敵人', up: '觸發機率提升' },
  chain:       { icon: '🌩️', name: '雷霆鏈',   element: 'lightning', desc: '定時放出在敵人間跳躍的閃電', up: '跳躍次數與傷害提升' },
};
const SKILL_MAX = 5;

// 元素組合強化（擁有對應元素技能時才會出現）
const SYNERGIES = [
  { id: 'burnLong',  icon: '🔥', name: '餘燼',     req: ['fire'],             desc: '燃燒時間 +60%' },
  { id: 'fuel',      icon: '🛢️', name: '火上加油', req: ['fire'],             desc: '燃燒中的敵人受到傷害 +30%' },
  { id: 'combust',   icon: '💣', name: '爆燃',     req: ['fire'],             desc: '燃燒中的敵人倒下時爆炸' },
  { id: 'freezeLong',icon: '🧊', name: '永凍',     req: ['ice'],              desc: '冰凍與減速時間 +60%' },
  { id: 'shatter',   icon: '💎', name: '碎冰',     req: ['ice'],              desc: '打中冰凍的敵人必定暴擊' },
  { id: 'frostbite', icon: '🥶', name: '凍傷',     req: ['ice'],              desc: '減速中的敵人受到傷害 +25%' },
  { id: 'arc',       icon: '➰', name: '感電跳躍', req: ['lightning'],        desc: '閃電多跳 2 個敵人' },
  { id: 'overload',  icon: '🔋', name: '超載',     req: ['lightning'],        desc: '閃電傷害 +40%，且可以暴擊' },
  { id: 'stormfire', icon: '🌋', name: '雷火',     req: ['fire', 'lightning'],desc: '閃電會點燃敵人' },
  { id: 'frostfire', icon: '🌀', name: '霜火',     req: ['fire', 'ice'],      desc: '冰凍敵人時同時點燃' },
  { id: 'supercond', icon: '🔷', name: '超導',     req: ['ice', 'lightning'], desc: '閃電對冰凍敵人造成雙倍傷害' },
];

const RARITY_WEIGHT = { common: 60, rare: 28, epic: 12 };
const RARITY_NAME = { common: '普通', rare: '稀有', epic: '史詩' };

// 道場（永久強化，可以一直升級，價格逐級上漲）
const META_UPGRADES = [
  { id: 'atk',    name: '拳力訓練', desc: '出拳傷害 +8%',      base: 20, max: 50 },
  { id: 'body',   name: '體能訓練', desc: '最大生命 +10',      base: 20, max: 50 },
  { id: 'speed',  name: '手速訓練', desc: '出拳速度 +3%',      base: 30, max: 15 },
  { id: 'reach',  name: '臂展訓練', desc: '出拳範圍 +5',       base: 30, max: 10 },
  { id: 'eye',    name: '眼力訓練', desc: '暴擊率 +1%',        base: 25, max: 20 },
  { id: 'luck',   name: '財運',     desc: '金幣獲得 +8%',      base: 25, max: 20 },
  { id: 'reroll', name: '幸運星',   desc: '每局可重抽升級 +1 次', base: 80, max: 3 },
  { id: 'slot',   name: '技能欄',   desc: '技能欄位 +1（起始 3 格）', base: 150, max: 2 },
  { id: 'revive', name: '不屈',     desc: '每局可以復活 1 次', base: 200, max: 1 },
];
function metaCost(m, lv) { return Math.round(m.base * Math.pow(1.35, lv)); }
