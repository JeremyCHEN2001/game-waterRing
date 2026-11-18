// Canonical source lives in water-ring/shared-core.js. Sync with scripts/sync-wechat.cjs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaterRingCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';
const RING_TIERS = [
  { holeR: 18, score: 10, colors: ['#4cc9f0', '#51cf66', '#b197fc'] },
  { holeR: 15, score: 15, colors: ['#ff6b6b', '#f783ac'] },
  { holeR: 12, score: 20, colors: ['#ffd43b'] },
];
const TIER_COUNTS = [3, 2, 1];

// 关卡（场景即关卡）：后续新场景在此追加配置
const LEVELS = [
  { id: 'day', name: '经典', theme: 'day', target: 50, time: 60, holeShrink: 0 },
  { id: 'night', name: '夜晚', theme: 'night', target: 60, time: 50, holeShrink: 1 },
  { id: 'dragon', name: '龙宫', theme: 'dragon', target: 70, time: 45, holeShrink: 1 },
];


const MAX_SCORE = RING_TIERS.reduce((sum, tier, i) => sum + tier.score * TIER_COUNTS[i], 0);
function normalizeUnlocked(raw) {
  const n = Number(raw);
  return Number.isInteger(n) ? Math.max(1, Math.min(LEVELS.length, n)) : 1;
}
function normalizeScores(raw) {
  const result = {};
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return result; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
  for (const level of LEVELS) {
    const n = parsed[level.id];
    if (Number.isInteger(n) && n >= 0 && n <= MAX_SCORE && n % 5 === 0) result[level.id] = n;
  }
  return result;
}
function canEnterLevel(index, unlocked, dev = false) {
  return Number.isInteger(index) && index >= 0 && index < LEVELS.length && (dev || index < normalizeUnlocked(unlocked));
}
function makePositions(random = Math.random) {
  const positions = [];
  for (const x of [76, 230, 354]) for (const y of [504, 592]) {
    positions.push({ x: x + (random() - 0.5) * 6, y: y + (random() - 0.5) * 24 });
  }
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions;
}
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = amount < 0 ? 1 + amount : 1;
  const add = amount > 0 ? 255 * amount : 0;
  const channel = v => Math.max(0, Math.min(255, Math.round(v * f + add)));
  return 'rgb(' + [n >> 16 & 255, n >> 8 & 255, n & 255].map(channel).join(',') + ')';
}
const THEMES = {
  day: { background: ['#eaf7fc','#d8eef7','#cfe8f3'], card:'#ffffff', text:'#14506b', muted:'#5b7c8f', surface:'#e7f3f8', accent:'#17a99c', accentText:'#ffffff', overlay:'rgba(206,238,248,0.6)' },
  night: { background: ['#071426','#0b2741','#103c50'], card:'#0a1e34', text:'#e6f7ff', muted:'#a9cfe0', surface:'#183c54', accent:'#35d6bd', accentText:'#04222c', overlay:'rgba(4,17,33,0.65)' },
  dragon: { background: ['#04211f','#073b33','#14563f'], card:'#082c28', text:'#eafff0', muted:'#b9dcc4', surface:'#12463a', accent:'#ffd43b', accentText:'#4a2c00', overlay:'rgba(4,33,31,0.65)' }
};
return { RING_TIERS, TIER_COUNTS, LEVELS, THEMES, normalizeUnlocked, normalizeScores, canEnterLevel, makePositions, shade };
});
