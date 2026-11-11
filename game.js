const W = 400, H = 720;
const TANK_TOP = 64, TANK_BOTTOM = H - 56;
const poles = [
  { x: 150, halfW: 6, height: 290, stack: 0, color: '#2ec4b6' },
  { x: 310, halfW: 6, height: 235, stack: 0, color: '#ff6b6b' },
];
for (const p of poles) { p.baseY = TANK_BOTTOM; p.topY = p.baseY - p.height; }
const RING_FLAT = 0.42;
// 环在水里的净下沉加速度：水阻让它缓慢下沉，而不是像石头一样落底。
// 配合下面的脉冲力度，一次点击能把池底的环顶到最高柱顶之上。
const RING_SINK = 200;
// 气流横向推动系数：点击点离环心越远，环被推开得越快，用来在空中把环“推”到柱顶上方
const PULSE_STEER = 3.4;

// 环档：孔越小越难套、分越高；颜色族辅助辨识
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

const params = {
  pulsePower: 1000,
  pulseSpread: 26,
  drag: 2.5,
};

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
// 烟花画在独立的结算层画布上：位于结算遮罩之上、结果卡片之下
const fxCanvas = document.getElementById('fx');
const fxCtx = fxCanvas.getContext('2d');
const stage = document.getElementById('stage');
const frame = document.getElementById('frame');
const scoreEl = document.getElementById('score');
const timerEl = document.getElementById('timer');
const toastEl = document.getElementById('toast');
const progressEl = document.getElementById('progress');
const sceneSwatches = document.getElementById('sceneSwatches');
const sceneButton = document.getElementById('btnScene');
const overlayEl = document.getElementById('overlay');
const cardEl = document.getElementById('card');
const cardKicker = document.getElementById('cardKicker');
const cardTitle = document.getElementById('cardTitle');
const cardStats = document.getElementById('cardStats');
const cardNote = document.getElementById('cardNote');
const cardCount = document.getElementById('cardCount');
const cardButtons = document.getElementById('cardButtons');

let scale = 1;
let dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const padding = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
  const availH = stage.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
  const targetAspect = W / H;
  let cw, ch;
  if (availW / availH > targetAspect) {
    ch = availH;
    cw = ch * targetAspect;
  } else {
    cw = availW;
    ch = cw / targetAspect;
  }
  frame.style.width = cw + 'px';
  frame.style.height = ch + 'px';
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  scale = (cw * dpr) / W;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // 烟花层与游戏画布同尺寸、同缩放
  fxCanvas.width = canvas.width;
  fxCanvas.height = canvas.height;
  fxCtx.setTransform(scale, 0, 0, scale, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ---------- 游戏状态 ----------

let rings = [];
let score = 0;
let timeLeft = 60;
let surfaceEnergy = 0;
let theme = 'day';
let nightMode = false;
let dragonMode = false;
let levelIndex = 0;
function readUnlockedCount() {
  try {
    const raw = Number(localStorage.getItem('water-ring-unlocked') || '1');
    return Number.isInteger(raw) ? Math.max(1, Math.min(LEVELS.length, raw)) : 1;
  } catch {
    return 1;
  }
}
let unlockedCount = readUnlockedCount();
// 开发者模式：仅 ?dev=1 进入时显示入口，正式上线不带参数即隐藏
const DEV_ENTRY = new URLSearchParams(location.search).has('dev');
let devMode = false;
let levelClearedThisRound = false;
let settledCount = 0;
let perfectMode = false;
const fireworks = [];
const fwFlashes = [];
let fwBurstsLeft = 0;
let fwNextAt = 0;
let scoreToastCount = 0;
let scoreToastTotal = 0;
let scoreToastTimer = 0;

// title 封面 / brief 关卡简报 / play 对局中 / paused 后台暂停 / result 结算
const BEST_KEY = 'water-ring-best';
let phase = 'title';
let bestScores = readBestScores();
let bestAtRoundStart = 0;
let unlockedNameThisRound = null;
let countdownTimer = 0;

function readBestScores() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
    const clean = {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return clean;
    const maxScore = RING_TIERS.reduce((sum, tier, i) => sum + tier.score * TIER_COUNTS[i], 0);
    for (const level of LEVELS) {
      const value = parsed[level.id];
      if (Number.isInteger(value) && value >= 0 && value <= maxScore && value % 5 === 0) clean[level.id] = value;
    }
    return clean;
  } catch {
    return {};
  }
}

// 隐私模式/配额满时写入会抛异常，不能让它打断结算流程
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 忽略写入失败
  }
}

function recordBest() {
  const id = LEVELS[levelIndex].id;
  if (score <= (bestScores[id] || 0)) return;
  bestScores[id] = score;
  safeSet(BEST_KEY, JSON.stringify(bestScores));
}

let bubbles = [];
const pulses = [];
const splashes = [];
let shakeT = 0;
const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function makeRings() {
  // 三条安全水道、每条两环；纵向分层保证间距，无重试或回退布局。
  const positions = [];
  for (const x of [76, 230, 354]) {
    for (const y of [504, 592]) {
      positions.push({ x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 24 });
    }
  }
  // 洗牌后分配环档，避免高分环总出现在固定水道。
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const specs = [];
  RING_TIERS.forEach((tier, ti) => {
    for (let i = 0; i < TIER_COUNTS[ti]; i++) {
      specs.push({
        tier: ti,
        score: tier.score,
        holeR: tier.holeR - LEVELS[levelIndex].holeShrink,
        color: tier.colors[i % tier.colors.length],
      });
    }
  });
  rings = positions.map((position, i) => ({
    x: position.x,
    y: position.y,
    vx: 0,
    vy: 0,
    r: 26,
    holeR: specs[i].holeR,
    score: specs[i].score,
    tier: specs[i].tier,
    color: specs[i].color,
    phase: Math.random() * Math.PI * 2,
    state: 'free',
    squash: 0,
    tilt: 0,
    flip: 0,
    flipV: 0,
    pole: null,
    threaded: false,
  }));
}

function resetGame() {
  makeRings();
  bubbles.length = 0;
  splashes.length = 0;
  shakeT = 0;
  for (const p of poles) p.stack = 0;
  score = 0;
  timeLeft = LEVELS[levelIndex].time;
  surfaceEnergy = 0;
  pulses.length = 0;
  fireworks.length = 0;
  fwFlashes.length = 0;
  fwBurstsLeft = 0;
  settledCount = 0;
  perfectMode = false;
  levelClearedThisRound = false;
  unlockedNameThisRound = null;
  for (const g of dragonGuards) {
    g.anger = 0;
    g.cool = 1;
    g.strike = 0;
    g.dashT = 0;
    g.dashX = 0;
    g.dashY = 0;
    g.dashCd = 0;
  }
  bestAtRoundStart = bestScores[LEVELS[levelIndex].id] || 0;
  clearTimeout(scoreToastTimer);
  scoreToastCount = 0;
  scoreToastTotal = 0;
  updateHUD();
}

function updateHUD() {
  scoreEl.textContent = '得分 ' + score;
  timerEl.textContent = Math.ceil(timeLeft) + 's';
  const level = LEVELS[levelIndex];
  progressEl.textContent = levelClearedThisRound ? '已通关' : `${score}/${level.target}`;
  progressEl.classList.toggle('done', levelClearedThisRound);
}

function showToast(text, color) {
  toastEl.textContent = text;
  toastEl.style.color = color || '#ff6b6b';
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
}

function announceScore(points) {
  scoreToastCount++;
  scoreToastTotal += points;
  showToast(scoreToastCount > 1 ? `连套 ${scoreToastCount} 环! +${scoreToastTotal}` : `套中! +${points}`);
  clearTimeout(scoreToastTimer);
  scoreToastTimer = setTimeout(() => {
    scoreToastCount = 0;
    scoreToastTotal = 0;
  }, 900);
}

// 达到本关通关线即通关；若因此解锁新关卡则返回其名称
function checkClear() {
  const level = LEVELS[levelIndex];
  if (levelClearedThisRound || score < level.target) return null;
  levelClearedThisRound = true;
  const next = LEVELS[levelIndex + 1];
  if (!next || levelIndex + 1 < unlockedCount) return { unlockedName: null };
  unlockedCount = levelIndex + 2;
  safeSet('water-ring-unlocked', String(unlockedCount));
  updateSwatchStates();
  unlockedNameThisRound = next.name;
  return { unlockedName: next.name };
}

function triggerPerfect() {
  perfectMode = true;
  fwBurstsLeft = REDUCED ? 3 : 9;
  fwNextAt = gameTime;
  endRound('perfect');
}

// ---------- 覆盖层：封面 / 简报 / 结算 ----------

function setText(el, text) {
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

function statRow(label, value, badge) {
  const row = document.createElement('div');
  row.className = 'statRow';
  const left = document.createElement('span');
  left.textContent = label;
  const right = document.createElement('span');
  right.className = 'statVal';
  const strong = document.createElement('b');
  strong.textContent = value;
  right.appendChild(strong);
  if (badge) {
    const tag = document.createElement('i');
    tag.className = 'badge';
    tag.textContent = badge;
    right.appendChild(tag);
  }
  row.append(left, right);
  return row;
}

function setStats(rows) {
  cardStats.textContent = '';
  for (const row of rows) cardStats.appendChild(row);
  cardStats.classList.toggle('hidden', rows.length === 0);
}

function setCardButtons(buttons) {
  cardButtons.textContent = '';
  for (const { label, primary, onClick } of buttons) {
    const btn = document.createElement('button');
    btn.className = primary ? 'cardBtn primary' : 'cardBtn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      sfx('click');
      onClick();
    });
    cardButtons.appendChild(btn);
  }
  cardButtons.classList.toggle('hidden', buttons.length === 0);
}

function showOverlay() {
  cardCount.classList.add('hidden');
  overlayEl.classList.remove('celebrate');
  overlayEl.classList.remove('hidden');
}

function hideOverlay() {
  overlayEl.classList.add('hidden');
}

function renderTitle() {
  setText(cardKicker, '');
  setText(cardTitle, '水压套圈');
  cardTitle.classList.remove('good', 'bad');
  setStats([]);
  setText(cardNote, '点击产生气流，把圆环套上珊瑚柱');
  setCardButtons([{ label: '开始游戏', primary: true, onClick: () => startBrief(levelIndex) }]);
  showOverlay();
}

function renderBrief() {
  const level = LEVELS[levelIndex];
  setText(cardKicker, `第 ${levelIndex + 1} 关`);
  setText(cardTitle, level.name);
  cardTitle.classList.remove('good', 'bad');
  setStats([
    statRow('通关分数', `${level.target} 分`),
    statRow('时限', `${level.time} 秒`),
    statRow('最高分', `${bestScores[level.id] || 0} 分`),
  ]);
  setText(cardNote, level.theme === 'dragon'
    ? '虾兵蟹将会弹开来犯的圆环'
    : level.holeShrink
      ? '环孔更小，更难套'
      : '孔越小分越高，全部套中即完美通关');
  setCardButtons([]);
  showOverlay();
}

function renderResult(reason) {
  const level = LEVELS[levelIndex];
  const perfect = reason === 'perfect';
  const cleared = perfect || levelClearedThisRound;
  const best = bestScores[level.id] || 0;
  setText(cardKicker, `第 ${levelIndex + 1} 关 · ${level.name}`);
  setText(cardTitle, perfect ? '完美通关!' : cleared ? '通关!' : '未通关');
  cardTitle.classList.toggle('good', cleared);
  cardTitle.classList.toggle('bad', !cleared);
  setStats([
    statRow('本局得分', `${score} 分`, score > bestAtRoundStart ? '新纪录' : ''),
    statRow('通关分数', `${level.target} 分`),
    statRow('最高分', `${best} 分`),
  ]);
  setText(cardNote, unlockedNameThisRound
    ? `解锁「${unlockedNameThisRound}」`
    : perfect
      ? '六环全套，漂亮!'
      : cleared
        ? ''
        : `还差 ${level.target - score} 分`);
  const next = LEVELS[levelIndex + 1];
  const buttons = [];
  if (cleared && next && levelIndex + 1 < unlockedCount) {
    buttons.push({ label: `下一关 · ${next.name}`, primary: true, onClick: () => startBrief(levelIndex + 1) });
  }
  buttons.push({
    label: cleared ? '再玩一次' : '再试一次',
    primary: !cleared || buttons.length === 0,
    onClick: () => startBrief(levelIndex),
  });
  setCardButtons(buttons);
  showOverlay();
}

function endRound(reason) {
  phase = 'result';
  recordBest();
  renderResult(reason);
  overlayEl.classList.toggle('celebrate', reason === 'perfect');
  sfx(reason === 'perfect' || levelClearedThisRound ? 'clear' : 'fail');
}

function setCountdown(n) {
  cardCount.textContent = String(n);
  cardCount.classList.remove('hidden', 'pop');
  void cardCount.offsetWidth;
  cardCount.classList.add('pop');
}

function beginPlay() {
  clearInterval(countdownTimer);
  phase = 'play';
  hideOverlay();
  sfx('count', 0);
}

let countdownLeft = 0;
function startCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdownLeft -= 1;
    if (countdownLeft > 0) {
      setCountdown(countdownLeft);
      sfx('count', countdownLeft);
      return;
    }
    beginPlay();
  }, 750);
}

function canEnterLevel(idx) {
  return Number.isInteger(idx) && idx >= 0 && idx < LEVELS.length && (devMode || idx < unlockedCount);
}

function startBrief(idx) {
  if (!canEnterLevel(idx)) return;
  acc = 0;
  clearInterval(countdownTimer);
  closeSceneMenu();
  levelIndex = idx;
  setTheme(LEVELS[idx].theme);
  resetGame();
  updateSwatchStates();
  phase = 'brief';
  renderBrief();
  countdownLeft = 3;
  setCountdown(countdownLeft);
  sfx('count', countdownLeft);
  startCountdown();
}

// 后台冻结全部游戏时间；对局返回后由玩家主动继续。
document.addEventListener('visibilitychange', () => {
  lastTime = performance.now();
  if (document.hidden) {
    if (phase === 'brief') clearInterval(countdownTimer);
    if (phase === 'play') {
      phase = 'paused';
      setText(cardKicker, '');
      setText(cardTitle, '已暂停');
      cardTitle.classList.remove('good', 'bad');
      setStats([]);
      setText(cardNote, '准备好后继续，剩余时间已保留');
      setCardButtons([{ label: '继续游戏', primary: true, onClick: () => {
        if (document.hidden || phase !== 'paused') return;
        lastTime = performance.now();
        phase = 'play';
        hideOverlay();
      } }]);
      showOverlay();
    }
  } else if (phase === 'brief' && countdownLeft > 0) {
    startCountdown();
  }
});

overlayEl.addEventListener('pointerdown', () => {
  if (phase === 'brief') beginPlay();
});

// ---------- 音效：WebAudio 合成，音色随场景主题变化 ----------

let audioCtx = null;
let muted = false;
try {
  muted = localStorage.getItem('water-ring-muted') === '1';
} catch {
  muted = false;
}

function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      audioCtx = null;
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function tone(freq, dur, type, gain, slideTo, delay = 0) {
  if (muted || !audioCtx) return;
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function whoosh(dur, freq, gain, q) {
  if (muted || !audioCtx) return;
  const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = audioCtx.createGain();
  g.gain.value = gain;
  src.connect(filter);
  filter.connect(g);
  g.connect(audioCtx.destination);
  src.start();
}

// 经典=清亮水声，夜晚=低柔泛音，龙宫=五声拨弦 + 锣
const VOICES = {
  day: { wave: 'sine', whooshF: 700, whooshG: 0.1, base: 523, click: 880, clickWave: 'sine' },
  night: { wave: 'triangle', whooshF: 420, whooshG: 0.09, base: 440, click: 660, clickWave: 'triangle' },
  dragon: { wave: 'triangle', whooshF: 520, whooshG: 0.1, base: 587, click: 990, clickWave: 'square' },
};

function sfx(name, arg) {
  if (muted || !audioCtx) return;
  const v = VOICES[theme] || VOICES.day;
  if (name === 'pulse') {
    whoosh(0.22, v.whooshF, v.whooshG, 0.8);
    tone(v.base / 2, 0.16, v.wave, 0.05, v.base / 3);
  } else if (name === 'settle') {
    const f = v.base * (arg === 20 ? 1.5 : arg === 15 ? 1.25 : 1);
    if (theme === 'dragon') {
      tone(f, 0.3, 'triangle', 0.09, f * 0.94);
      tone(f * 2, 0.18, 'sine', 0.05, 0, 0.02);
    } else if (theme === 'night') {
      tone(f, 0.4, 'triangle', 0.07);
      tone(f * 1.005, 0.4, 'sine', 0.04);
    } else {
      tone(f, 0.25, 'sine', 0.1, f * 0.99);
      tone(f * 2, 0.12, 'sine', 0.04);
    }
  } else if (name === 'knock') {
    tone(120, 0.18, 'sine', 0.12, 70);
    whoosh(0.12, 300, 0.08, 0.6);
    tone(240, 0.12, 'square', 0.04, 180, 0.02);
  } else if (name === 'clear') {
    if (theme === 'dragon') {
      tone(196, 0.9, 'sine', 0.1, 192);
      [587, 659, 784, 880].forEach((f, i) => tone(f, 0.3, 'triangle', 0.08, 0, 0.06 + i * 0.11));
    } else if (theme === 'night') {
      [440, 523, 659].forEach((f, i) => tone(f, 0.45, 'triangle', 0.07, 0, i * 0.14));
    } else {
      [523, 659, 784].forEach((f, i) => tone(f, 0.3, 'sine', 0.09, 0, i * 0.11));
    }
  } else if (name === 'fail') {
    tone(330, 0.25, v.wave, 0.08, 262);
    tone(262, 0.4, v.wave, 0.07, 196, 0.18);
  } else if (name === 'click') {
    tone(v.click, 0.06, v.clickWave, 0.05);
  } else if (name === 'count') {
    tone(arg === 0 ? v.base * 1.5 : v.base, 0.12, v.wave, 0.07);
  }
}

document.addEventListener('pointerdown', ensureAudio, true);

// ---------- 输入 ----------

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width * W,
    y: (e.clientY - rect.top) / rect.height * H,
  };
}

canvas.addEventListener('pointerdown', e => {
  if (phase !== 'play') return;
  // 点击任意位置，从该处正下方喷出一股气流（一次点击 = 一股）
  const p = pointerPos(e);
  firePulse(p.x);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---------- 物理 ----------

function heightFactor(y) {
  const t = Math.max(0, Math.min(1, (y - 110) / (TANK_BOTTOM - 110)));
  return 0.3 + 0.7 * t;
}

function firePulse(x) {
  const nx = Math.max(30, Math.min(W - 30, x));
  pulses.push({ x: nx, flash: 1 });
  surfaceEnergy = Math.min(1, surfaceEnergy + 0.5);
  sfx('pulse');

  // 气流冲击：点击处附近的环被顶起，带随机翻转扰动
  for (const ring of rings) {
    if (ring.state !== 'free') continue;
    const dx = ring.x - nx;
    const ad = Math.abs(dx);
    if (ad > 75) continue;
    // 正对环心 14px 内给满横向推力，再向两侧衰减，避免差几像素就推不动
    const falloff = ad <= 14 ? 1 : Math.max(0, 1 - (ad - 14) / 61);
    // 落在环孔范围内（20px）都能吃满抬升，边缘快速衰减；侧向补气只推不抬
    const liftFalloff = ad <= 20 ? 1 : Math.max(0, 1 - (ad - 20) / 36);
    const strength = liftFalloff * liftFalloff * (0.45 + 0.55 * heightFactor(ring.y));
    ring.vy -= (params.pulsePower + Math.random() * 120) * strength;
    // 横向推动不随高度衰减，保证在空中也能把环推到柱顶上方
    ring.vx += (dx * PULSE_STEER + (Math.random() - 0.5) * params.pulseSpread) * falloff;
    // 气流会把环冲得侧翻、打转，不再是永远平躺
    ring.flipV += (Math.random() - 0.5) * 4 * strength;
  }

  // 一团上涌的气泡
  for (let k = 0; k < 22; k++) {
    bubbles.push({
      x: nx + (Math.random() - 0.5) * 40,
      y: TANK_BOTTOM - 6 - Math.random() * 14,
      r: 2 + Math.random() * 4,
      vy: -(240 + Math.random() * 220),
      phase: Math.random() * Math.PI * 2,
    });
  }
}

function resolvePoleContact(ring, nx, ny, eccentricity, restitution, tangentKeep) {
  const normalV = ring.vx * nx + ring.vy * ny;
  if (normalV >= 0) return;
  const impact = -normalV;
  const tangentX = ring.vx - normalV * nx;
  const tangentY = ring.vy - normalV * ny;
  const rebound = impact * restitution;
  ring.vx = tangentX * tangentKeep + rebound * nx;
  ring.vy = tangentY * tangentKeep + rebound * ny;
  ring.flipV += Math.min(2.2, impact / 160) * (0.35 + eccentricity);
}

function stepPhysics(dt, now) {
  for (let i = pulses.length - 1; i >= 0; i--) {
    pulses[i].flash -= dt * 3;
    if (pulses[i].flash <= 0) pulses.splice(i, 1);
  }
  surfaceEnergy = Math.max(0, surfaceEnergy - dt * 0.8);

  const g = 900;
  const t = now / 1000;

  for (const ring of rings) {
    if (ring.state === 'settled') continue;

    if (ring.state === 'threaded') {
      // 已套上杆：放平、沿杆滑落，叠到杆底已有的环堆上
      const pole = ring.pole;
      ring.x += (pole.x - ring.x) * Math.min(1, 12 * dt);
      ring.flip = Math.max(0, ring.flip - 5 * dt);
      ring.flipV = 0;
      ring.tilt *= Math.max(0, 1 - 8 * dt);
      ring.vy += g * dt;
      ring.vy *= Math.max(0, 1 - 8 * dt);
      ring.y += ring.vy * dt;
      const restY = pole.baseY - 4 - pole.stack * 7 - ring.r * RING_FLAT;
      if (ring.y >= restY) {
        ring.y = restY;
        ring.vy = 0;
        ring.state = 'settled';
        pole.stack++;
        settledCount++;
        score += ring.score;
        recordBest();
        announceScore(ring.score);
        sfx('settle', ring.score);
        ring.flash = 1;
        spawnSplash(ring.x, ring.y);
        const clearInfo = checkClear();
        if (settledCount === rings.length) {
          triggerPerfect();
        } else if (clearInfo) {
          showToast(clearInfo.unlockedName ? `通关! 解锁「${clearInfo.unlockedName}」` : `通关! ${score} 分`, '#ffd43b');
        }
        updateHUD();
      }
      continue;
    }

    let fx = 0, fy = 0;

    // 自由环只受很小的净下沉力（浮力抵消了大部分重力），在水里缓慢下沉
    fy += RING_SINK;

    ring.vx += fx * dt;
    ring.vy += fy * dt;

    // 水阻
    const damp = Math.max(0, 1 - params.drag * dt);
    ring.vx *= damp;
    ring.vy *= damp;

    ring.x += ring.vx * dt;
    ring.y += ring.vy * dt;

    ring.squash = Math.max(-0.25, Math.min(0.25, ring.vx / 600));
    ring.tilt = Math.sin(t * 1.6 + ring.phase) * 0.14;

    // 姿态：水里缓慢回平，气流造成的翻转转动能逐渐衰减
    ring.flipV += -ring.flip * 5 * dt;
    ring.flipV *= Math.max(0, 1 - 2.5 * dt);
    ring.flip += ring.flipV * dt;
    if (ring.flip < 0) { ring.flip = 0; ring.flipV *= -0.3; }
    if (ring.flip > 1) { ring.flip = 1; ring.flipV *= -0.3; }
    const rEff = ring.r * (RING_FLAT + (1 - RING_FLAT) * ring.flip);

    // 箱壁
    if (ring.x < 14 + ring.r) { ring.x = 14 + ring.r; ring.vx *= -0.4; }
    if (ring.x > W - 14 - ring.r) { ring.x = W - 14 - ring.r; ring.vx *= -0.4; }
    if (ring.y < TANK_TOP + rEff) { ring.y = TANK_TOP + rEff; ring.vy *= -0.3; }

    // 箱底
    if (ring.y > TANK_BOTTOM - rEff) {
      ring.y = TANK_BOTTOM - rEff;
      ring.vy *= -0.25;
      ring.vx *= 0.9;
    }

    // 套杆判定（逐杆检查）：位置对准 + 姿态够平才能穿入；侧着会被弹开
    const ringBottom = ring.y + rEff;
    for (const pole of poles) {
      const pdx = ring.x - pole.x;

      if (ring.vy > 0 && ringBottom >= pole.topY && ringBottom < pole.topY + 44) {
        if (Math.abs(pdx) < ring.holeR - pole.halfW - 2 && ring.flip < 0.35) {
          ring.state = 'threaded';
          ring.pole = pole;
          ring.vy = Math.max(ring.vy, 60);
          ring.vx = 0;
          break;
        } else if (Math.abs(pdx) < ring.r + pole.halfW) {
          const direction = pdx >= 0 ? 1 : -1;
          const edge = Math.min(0.65, Math.abs(pdx) / (ring.r + pole.halfW) * 0.75);
          ring.y = pole.topY - rEff - 0.5;
          resolvePoleContact(
            ring,
            direction * edge,
            -Math.sqrt(1 - edge * edge),
            Math.min(1, Math.abs(pdx) / ring.r),
            0.22,
            0.88
          );
        }
      }
      // 杆身侧碰
      if (ring.state === 'free' &&
          Math.abs(pdx) >= ring.holeR - pole.halfW &&
          Math.abs(pdx) < ring.r + pole.halfW &&
          ring.y > pole.topY && ring.y < pole.baseY) {
        const direction = pdx >= 0 ? 1 : -1;
        const overlap = ring.r + pole.halfW - Math.abs(pdx);
        ring.x += direction * (overlap + 0.5);
        resolvePoleContact(ring, direction, 0, 1, 0.18, 0.94);
      }
      if (ring.state === 'threaded') break;
    }
  }

  // 环之间简单推开
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const a = rings[i], b = rings[j];
      if (a.state !== 'free' || b.state !== 'free') continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = a.r + b.r - 14;
      if (dist > 0 && dist < minDist) {
        const push = (minDist - dist) / 2;
        const nx = dx / dist, ny = dy / dist;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          a.vx += nx * rel * 0.5; a.vy += ny * rel * 0.5;
          b.vx -= nx * rel * 0.5; b.vy -= ny * rel * 0.5;
        }
      }
    }
  }
}

// ---------- 粒子 ----------

function stepFireworks(dt, now) {
  if (perfectMode && fwBurstsLeft > 0 && now >= fwNextAt) {
    fwBurstsLeft--;
    fwNextAt = now + 380;
    // 只在结果卡片上下的可见区域爆发：卡片中央会挡住烟花
    const cx = 70 + Math.random() * (W - 140);
    const upper = Math.random() < 0.55;
    const cy = upper ? 108 + Math.random() * 24 : 596 + Math.random() * 30;
    const palette = ['#ffd43b', '#ff6b6b', '#4cc9f0', '#51cf66', '#f783ac', '#ffe29a', '#ff9f43'];
    const color = palette[Math.floor(Math.random() * palette.length)];
    const count = REDUCED ? 22 : 36;
    fwFlashes.push({ x: cx, y: cy, life: 0.34, max: 0.34, color });
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.2;
      const sp = 70 + Math.random() * 85;
      const life = 1.15 + Math.random() * 0.55;
      fireworks.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life, max: life, color,
      });
    }
  }
  for (let i = fireworks.length - 1; i >= 0; i--) {
    const p = fireworks[i];
    p.life -= dt;
    if (p.life <= 0) { fireworks.splice(i, 1); continue; }
    p.vy += 150 * dt;
    p.vx *= Math.max(0, 1 - 1.2 * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  for (let i = fwFlashes.length - 1; i >= 0; i--) {
    fwFlashes[i].life -= dt;
    if (fwFlashes[i].life <= 0) fwFlashes.splice(i, 1);
  }
}

// 烟花单独画在结算层画布上，使用叠加混合，深色遮罩下更亮
function drawFireworks() {
  fxCtx.save();
  fxCtx.globalCompositeOperation = 'lighter';
  // 爆发中心的短促闪光
  for (const f of fwFlashes) {
    const k = Math.max(0, f.life / f.max);
    const [r, g, b] = hexToRgb(f.color);
    const radius = 26 + 46 * (1 - k);
    const grad = fxCtx.createRadialGradient(f.x, f.y, 0, f.x, f.y, radius);
    grad.addColorStop(0, `rgba(255, 255, 255, ${0.75 * k})`);
    grad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, ${0.5 * k})`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    fxCtx.globalAlpha = 1;
    fxCtx.fillStyle = grad;
    fxCtx.beginPath();
    fxCtx.arc(f.x, f.y, radius, 0, Math.PI * 2);
    fxCtx.fill();
  }
  for (const p of fireworks) {
    const a = Math.max(0, Math.min(1, p.life / p.max));
    const fade = a * a;
    fxCtx.globalAlpha = fade * 0.65;
    fxCtx.beginPath();
    fxCtx.moveTo(p.x, p.y);
    fxCtx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
    fxCtx.strokeStyle = p.color;
    fxCtx.lineWidth = 1.6;
    fxCtx.stroke();

    fxCtx.globalAlpha = fade * 0.22;
    fxCtx.beginPath();
    fxCtx.arc(p.x, p.y, 5.5 * a + 2, 0, Math.PI * 2);
    fxCtx.fillStyle = p.color;
    fxCtx.fill();

    fxCtx.globalAlpha = 0.35 + fade * 0.65;
    fxCtx.beginPath();
    fxCtx.arc(p.x, p.y, 2.3 * a + 0.9, 0, Math.PI * 2);
    fxCtx.fillStyle = p.color;
    fxCtx.fill();
  }
  fxCtx.restore();
  fxCtx.globalAlpha = 1;
  fxCtx.globalCompositeOperation = 'source-over';
}

function drawFx() {
  fxCtx.clearRect(0, 0, W, H);
  if (fireworks.length || fwFlashes.length) drawFireworks();
}

function stepBubbles(dt, now) {
  const t = now / 1000;
  if (bubbles.length < 60 && Math.random() < 0.5) {
    bubbles.push({
      x: 20 + Math.random() * (W - 40),
      y: TANK_BOTTOM - 5,
      r: 1.5 + Math.random() * 3,
      vy: -(20 + Math.random() * 40),
      phase: Math.random() * Math.PI * 2,
    });
  }
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.y += b.vy * dt;
    b.x += Math.sin(t * 2 + b.phase) * 12 * dt;
    if (b.y < TANK_TOP + 6) bubbles.splice(i, 1);
  }
}

// ---------- 渲染 ----------

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = amt < 0 ? (1 + amt) : 1;
  const add = amt > 0 ? 255 * amt : 0;
  return `rgb(${Math.round(r * f + add)},${Math.round(g * f + add)},${Math.round(b * f + add)})`;
}

// 三主题取色：经典 / 夜晚 / 龙宫
function pal(day, night, dragon) {
  return dragonMode ? dragon : nightMode ? night : day;
}

function tankClip() {
  roundRect(14, TANK_TOP, W - 28, TANK_BOTTOM - TANK_TOP + 16, 16);
}

const pebbles = [];
for (let i = 0; i < 12; i++) {
  pebbles.push({
    x: 24 + Math.random() * (W - 48),
    r: 3 + Math.random() * 5,
    dy: Math.random() * 6,
    light: Math.random() > 0.5,
  });
}

// 装饰与小鱼（点缀为主，不遮挡玩法区域）
const seaweeds = [
  { x: 42, blades: [{ h: 84, w: 5, phase: 0 }, { h: 62, w: 4, phase: 1.4 }, { h: 100, w: 5, phase: 2.8 }] },
  { x: 358, blades: [{ h: 76, w: 5, phase: 0.8 }, { h: 96, w: 5, phase: 2.1 }, { h: 58, w: 4, phase: 3.5 }] },
];
const rocks = [
  { x: 96, r: 13, squash: 0.62 },
  { x: 214, r: 10, squash: 0.6 },
];
const fishes = [
  { x: 90, y: 230, baseY: 230, dir: 1, speed: 26, phase: 0.5, color: '#ffa94d', state: 'swim', dashT: 0, dashVY: 0 },
  { x: 300, y: 340, baseY: 340, dir: -1, speed: 22, phase: 2.2, color: '#b197fc', state: 'swim', dashT: 0, dashVY: 0 },
];
const lanternFishes = [
  { x: 100, y: 210, baseY: 210, dir: 1, speed: 16, phase: 0.5, color: '#39788b', lightColor: '#8ff3d4', state: 'swim', dashT: 0, dashVY: 0 },
  { x: 295, y: 335, baseY: 335, dir: -1, speed: 13, phase: 2.2, color: '#565787', lightColor: '#ffe29a', state: 'swim', dashT: 0, dashVY: 0 },
];
const plankton = [];
for (let i = 0; i < 16; i++) {
  plankton.push({
    x: 28 + Math.random() * (W - 56),
    y: TANK_TOP + 30 + Math.random() * (TANK_BOTTOM - TANK_TOP - 70),
    r: 0.8 + Math.random() * 1.2,
    speed: 3 + Math.random() * 7,
    phase: Math.random() * Math.PI * 2,
    warm: i % 4 === 0,
  });
}

function stepFish(dt, now) {
  const t = now / 1000;
  const school = nightMode ? lanternFishes : fishes;
  for (const f of school) {
    if (f.state === 'dash') {
      f.dashT -= dt;
      f.x += f.dir * 240 * dt;
      f.y += f.dashVY * dt;
      if (f.dashT <= 0) {
        f.state = 'swim';
        f.baseY = Math.max(TANK_TOP + 40, Math.min(TANK_BOTTOM - 60, f.y));
      }
    } else {
      f.x += f.dir * f.speed * dt;
      f.y = f.baseY + Math.sin(t * 1.3 + f.phase) * 8;

      // 躲避：预判圆环 0.35s 后的位置，快撞上时朝反方向游走
      for (const ring of rings) {
        if (ring.state !== 'free') continue;
        const sp = Math.hypot(ring.vx, ring.vy);
        if (sp < 60) continue;
        const px = ring.x + ring.vx * 0.35;
        const py = ring.y + ring.vy * 0.35;
        const dPre = Math.hypot(px - f.x, py - f.y);
        const dNow = Math.hypot(ring.x - f.x, ring.y - f.y);
        if (dPre < 55 && dNow < 130) {
          f.state = 'dash';
          f.dashT = 0.6;
          f.dir = (f.x - px) >= 0 ? 1 : -1;
          f.dashVY = Math.max(-120, Math.min(120, (f.y - py) * 1.5));
          break;
        }
      }
    }
    if (f.x < 36) { f.x = 36; f.dir = 1; }
    if (f.x > W - 36) { f.x = W - 36; f.dir = -1; }
    f.y = Math.max(TANK_TOP + 30, Math.min(TANK_BOTTOM - 40, f.y));
  }
}

function drawDecor(now) {
  const t = now / 1000;
  const rootY = TANK_BOTTOM + 8;

  // 水草：三叶一组，叶尖随水流摇摆
  for (const weed of seaweeds) {
    for (const blade of weed.blades) {
      const sway = Math.sin(t * 1.4 + blade.phase) * (6 + surfaceEnergy * 6);
      ctx.beginPath();
      ctx.moveTo(weed.x, rootY);
      ctx.quadraticCurveTo(weed.x + sway * 0.4, rootY - blade.h * 0.55, weed.x + sway * 1.6, rootY - blade.h);
      ctx.strokeStyle = pal('#2fa587', '#237b78', '#1f8f74');
      ctx.lineWidth = blade.w;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(weed.x - 1, rootY);
      ctx.quadraticCurveTo(weed.x + sway * 0.4 - 1, rootY - blade.h * 0.55, weed.x + sway * 1.6 - 1, rootY - blade.h);
      ctx.strokeStyle = pal('rgba(120, 220, 180, 0.5)', 'rgba(74, 220, 190, 0.35)', 'rgba(255, 226, 154, 0.35)');
      ctx.lineWidth = blade.w * 0.4;
      ctx.stroke();
    }
  }

  // 珊瑚：中间一小株分枝（龙宫关为金色）
  const cx = 248, cy = rootY;
  ctx.strokeStyle = pal('#ff9db0', '#9c6c9e', '#e8b64c');
  ctx.lineCap = 'round';
  const branches = [
    [0, 0, -3, -20, -12, -30],
    [0, 0, 2, -22, 3, -38],
    [0, 0, 6, -16, 16, -26],
    [2, -20, -4, -26, -6, -32],
  ];
  for (const [x1, y1, x2, y2, x3, y3] of branches) {
    ctx.beginPath();
    ctx.moveTo(cx + x1, cy + y1);
    ctx.quadraticCurveTo(cx + x2, cy + y2, cx + x3, cy + y3);
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  ctx.fillStyle = pal('#ffc2cf', '#d5a4d4', '#ffe29a');
  if (nightMode || dragonMode) {
    ctx.shadowColor = nightMode ? 'rgba(183, 139, 255, 0.6)' : 'rgba(255, 214, 120, 0.6)';
    ctx.shadowBlur = 7;
  }
  for (const [, , , , x3, y3] of branches) {
    ctx.beginPath();
    ctx.arc(cx + x3, cy + y3, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // 龙宫关：沙地上一面斜插的龙旗
  if (dragonMode) {
    const fx = 72;
    ctx.strokeStyle = '#8a5a12';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fx, rootY);
    ctx.lineTo(fx + 4, rootY - 78);
    ctx.stroke();
    const flutter = Math.sin(t * 2.4) * 3;
    ctx.beginPath();
    ctx.moveTo(fx + 4, rootY - 78);
    ctx.quadraticCurveTo(fx + 18, rootY - 72 + flutter, fx + 28, rootY - 70 + flutter);
    ctx.lineTo(fx + 5, rootY - 60);
    ctx.closePath();
    ctx.fillStyle = '#d94848';
    ctx.fill();
    ctx.strokeStyle = '#ffd43b';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 石头（龙宫关换成珍珠堆、元宝堆等宝物山）
  if (dragonMode) {
    for (const [ri, rock] of rocks.entries()) {
      const cxr = rock.x;
      const layout = ri === 0
        ? [[0, 0, 0, 8], [-11, 2, 1, 7], [10, 2, 3, 7], [-5, -6, 0, 6], [6, -6, 2, 6], [0, -11, 4, 5]]
        : [[0, 0, 1, 7], [-9, 2, 0, 6], [9, 2, 2, 6], [-4, -6, 3, 5], [5, -6, 0, 5]];
      for (const [li, [dx, dy, kind, r]] of layout.entries()) {
        const bob = Math.sin(t * 1.3 + ri * 2 + li) * 0.7;
        drawTreasure(cxr + dx, rootY - 4 + dy + bob, r, kind, t, ri + li);
      }
    }
    return;
  }
  for (const rock of rocks) {
    ctx.beginPath();
    ctx.ellipse(rock.x, rootY, rock.r, rock.r * rock.squash, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal('#a9c3cf', '#54798a', '#4c7a72');
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(rock.x - rock.r * 0.25, rootY - rock.r * 0.25, rock.r * 0.55, rock.r * 0.3, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = pal('rgba(255, 255, 255, 0.45)', 'rgba(180, 235, 240, 0.2)', 'rgba(255, 226, 154, 0.18)');
    ctx.fill();
  }
}

function drawFish(now) {
  const t = now / 1000;
  const school = nightMode ? lanternFishes : fishes;
  for (const f of school) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.dir, 1);
    const wiggle = Math.sin(t * (f.state === 'dash' ? 18 : 7) + f.phase) * 0.3;

    // 尾巴
    ctx.save();
    ctx.translate(-11, 0);
    ctx.rotate(wiggle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-9, -6);
    ctx.lineTo(-9, 6);
    ctx.closePath();
    ctx.fillStyle = shade(f.color, -0.1);
    ctx.fill();
    ctx.restore();

    // 身体
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = f.color;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(1, 3, 9, 3.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = nightMode ? 'rgba(105, 210, 215, 0.22)' : 'rgba(255, 255, 255, 0.4)';
    ctx.fill();

    // 眼睛
    ctx.beginPath();
    ctx.arc(7, -2, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(7.6, -2, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = '#20303c';
    ctx.fill();

    if (nightMode) {
      ctx.beginPath();
      ctx.moveTo(5, -6);
      ctx.quadraticCurveTo(8, -19, 21, -17);
      ctx.strokeStyle = '#79aeb9';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.save();
      ctx.shadowColor = f.lightColor;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(22, -16, 4, 0, Math.PI * 2);
      ctx.fillStyle = f.lightColor;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(21, -17, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}

function drawPlankton(now) {
  const t = now / 1000;
  const span = TANK_BOTTOM - TANK_TOP - 40;
  ctx.save();
  tankClip();
  ctx.clip();
  for (const p of plankton) {
    const y = TANK_TOP + 20 + ((p.y - TANK_TOP - t * p.speed) % span + span) % span;
    const x = p.x + Math.sin(t * 0.5 + p.phase) * 6;
    const alpha = 0.3 + (Math.sin(t * 1.8 + p.phase) + 1) * 0.2;
    ctx.beginPath();
    ctx.arc(x, y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.warm ? `rgba(255, 226, 154, ${alpha})` : `rgba(143, 243, 212, ${alpha})`;
    ctx.shadowColor = p.warm ? '#ffe29a' : '#8ff3d4';
    ctx.shadowBlur = 6;
    ctx.fill();
  }
  ctx.restore();
}

function drawLanternLights(now) {
  const t = now / 1000;
  ctx.save();
  tankClip();
  ctx.clip();
  ctx.globalCompositeOperation = 'screen';
  for (const f of lanternFishes) {
    const x = f.x + f.dir * 22;
    const y = f.y - 16;
    const pulse = 0.88 + Math.sin(t * 2 + f.phase) * 0.12;
    const radius = 112 + Math.sin(t * 1.3 + f.phase) * 5;
    const [r, g, b] = hexToRgb(f.lightColor);
    const glow = ctx.createRadialGradient(x, y, 2, x, y, radius);
    glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.38 * pulse})`);
    glow.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, ${0.18 * pulse})`);
    glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

    const core = ctx.createRadialGradient(x, y, 0, x, y, 30);
    core.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.55)`);
    core.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = core;
    ctx.fillRect(x - 30, y - 30, 60, 60);
  }
  ctx.restore();
}

function drawTank(now) {
  const t = now / 1000;

  // 白色机身（圆角卡片 + 柔和投影）
  ctx.save();
  ctx.shadowColor = pal('rgba(60, 130, 170, 0.25)', 'rgba(0, 5, 18, 0.5)', 'rgba(0, 10, 6, 0.5)');
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  roundRect(4, TANK_TOP - 10, W - 8, TANK_BOTTOM - TANK_TOP + 36, 24);
  ctx.fillStyle = pal('#ffffff', '#17344e', '#123c33');
  ctx.fill();
  ctx.restore();

  ctx.save();
  tankClip();
  ctx.clip();

  // 水体渐变
  const grad = ctx.createLinearGradient(0, TANK_TOP, 0, TANK_BOTTOM + 16);
  grad.addColorStop(0, pal('#c9f1fa', '#142b50', '#083038'));
  grad.addColorStop(0.4, pal('#8fdcf0', '#10465d', '#0d5450'));
  grad.addColorStop(1, pal('#4fb8dc', '#126371', '#177a62'));
  ctx.fillStyle = grad;
  ctx.fillRect(14, TANK_TOP, W - 28, TANK_BOTTOM - TANK_TOP + 16);

  // 天光光柱
  for (let i = 0; i < 3; i++) {
    const bx = 85 + i * 105 + Math.sin(t * 0.4 + i * 2) * 14;
    const wTop = 24, wBot = 58;
    ctx.beginPath();
    ctx.moveTo(bx - wTop / 2, TANK_TOP);
    ctx.lineTo(bx + wTop / 2, TANK_TOP);
    ctx.lineTo(bx + wBot / 2 + 18, TANK_BOTTOM);
    ctx.lineTo(bx - wBot / 2 + 18, TANK_BOTTOM);
    ctx.closePath();
    const rg = ctx.createLinearGradient(0, TANK_TOP, 0, TANK_BOTTOM);
    rg.addColorStop(0, pal('rgba(255, 255, 255, 0.22)', 'rgba(120, 210, 235, 0.08)', 'rgba(255, 214, 120, 0.10)'));
    rg.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = rg;
    ctx.fill();
  }

  // 水面（泡沫带 + 亮线）
  const surf = TANK_TOP + 12;
  const wave = x => surf + Math.sin(x * 0.05 + t * 2.2) * (2.5 + surfaceEnergy * 4)
    + Math.sin(x * 0.11 - t * 3.1) * 1.5;
  ctx.beginPath();
  ctx.moveTo(14, surf);
  for (let x = 14; x <= W - 14; x += 6) ctx.lineTo(x, wave(x));
  ctx.lineTo(W - 14, TANK_TOP);
  ctx.lineTo(14, TANK_TOP);
  ctx.closePath();
  ctx.fillStyle = pal('rgba(255, 255, 255, 0.55)', 'rgba(129, 202, 225, 0.18)', 'rgba(255, 226, 154, 0.22)');
  ctx.fill();
  ctx.beginPath();
  for (let x = 14; x <= W - 14; x += 6) {
    if (x === 14) ctx.moveTo(x, wave(x)); else ctx.lineTo(x, wave(x));
  }
  ctx.strokeStyle = pal('rgba(255, 255, 255, 0.85)', 'rgba(170, 232, 245, 0.5)', 'rgba(255, 226, 154, 0.55)');
  ctx.lineWidth = 2;
  ctx.stroke();

  // 龙宫关：主浪线下的回声涟漪，反向慢速漂移
  if (dragonMode) {
    ctx.beginPath();
    for (let x = 14; x <= W - 14; x += 6) {
      const yy = wave(x) + 5 + Math.sin(x * 0.08 - t * 1.7) * 1.6;
      if (x === 14) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = 'rgba(255, 226, 154, 0.3)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.beginPath();
    for (let x = 14; x <= W - 14; x += 6) {
      const yy = wave(x) + 10 + Math.sin(x * 0.06 + t * 1.2) * 2.2;
      if (x === 14) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = 'rgba(255, 226, 154, 0.16)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  ctx.restore();

  // 内缘细线
  tankClip();
  ctx.strokeStyle = pal('rgba(255, 255, 255, 0.9)', 'rgba(148, 236, 255, 0.5)', 'rgba(255, 226, 154, 0.45)');
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawCoralPoles() {
  if (dragonMode) {
    drawWeaponPoles();
    return;
  }
  for (const [index, pole] of poles.entries()) {
    ctx.save();
    ctx.shadowColor = 'rgba(20, 60, 75, 0.22)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = nightMode ? '#355f70' : '#8ea9b1';
    ctx.beginPath();
    ctx.ellipse(pole.x, pole.baseY + 5, 24, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = nightMode ? '#477787' : '#b5cbd0';
    ctx.beginPath();
    ctx.ellipse(pole.x - 8, pole.baseY + 1, 12, 7, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const firstSide = index === 0 ? -1 : 1;
    const branches = [
      { side: firstSide, at: 0.26, length: 18, rise: 16 },
      { side: -firstSide, at: 0.44, length: 16, rise: 15 },
      { side: firstSide, at: 0.62, length: 15, rise: 14 },
    ];
    const tips = [];
    ctx.lineCap = 'round';
    for (const branch of branches) {
      const y = pole.baseY - pole.height * branch.at;
      const tipX = pole.x + branch.side * branch.length;
      const tipY = y - branch.rise;
      tips.push([tipX, tipY]);
      ctx.beginPath();
      ctx.moveTo(pole.x + branch.side * 3, y);
      ctx.quadraticCurveTo(pole.x + branch.side * 10, y - 5, tipX, tipY);
      ctx.strokeStyle = shade(pole.color, -0.08);
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pole.x + branch.side * 10, y - 6);
      ctx.quadraticCurveTo(pole.x + branch.side * 10, y - 12, pole.x + branch.side * 9, y - 17);
      ctx.strokeStyle = pole.color;
      ctx.lineWidth = 3;
      ctx.stroke();
      tips.push([pole.x + branch.side * 9, y - 17]);
    }

    const grad = ctx.createLinearGradient(pole.x - 12, 0, pole.x + 12, 0);
    grad.addColorStop(0, shade(pole.color, -0.28));
    grad.addColorStop(0.42, pole.color);
    grad.addColorStop(0.72, shade(pole.color, 0.3));
    grad.addColorStop(1, shade(pole.color, -0.12));
    ctx.beginPath();
    ctx.moveTo(pole.x - 13, pole.baseY + 3);
    ctx.bezierCurveTo(pole.x - 12, pole.baseY - pole.height * 0.28, pole.x - 9, pole.baseY - pole.height * 0.62, pole.x - 7, pole.topY + 18);
    ctx.quadraticCurveTo(pole.x - 7, pole.topY + 4, pole.x, pole.topY);
    ctx.quadraticCurveTo(pole.x + 7, pole.topY + 4, pole.x + 7, pole.topY + 18);
    ctx.bezierCurveTo(pole.x + 9, pole.baseY - pole.height * 0.62, pole.x + 12, pole.baseY - pole.height * 0.28, pole.x + 13, pole.baseY + 3);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pole.x - 5, pole.baseY - 18);
    ctx.bezierCurveTo(pole.x - 5, pole.baseY - pole.height * 0.35, pole.x - 3, pole.baseY - pole.height * 0.7, pole.x - 2, pole.topY + 16);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = shade(pole.color, -0.35);
    ctx.globalAlpha = 0.24;
    for (let i = 0; i < 6; i++) {
      const y = pole.baseY - 34 - i * 31;
      if (y < pole.topY + 30) continue;
      ctx.beginPath();
      ctx.arc(pole.x + Math.sin(i * 2.1) * 3, y, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = shade(pole.color, 0.5);
    if (nightMode) {
      ctx.shadowColor = shade(pole.color, 0.4);
      ctx.shadowBlur = 6;
    }
    for (const [x, y] of tips) {
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

  }
}

// ---------- 龙宫关：兵器柱 / 龙宫剪影 / 宫灯 / 虾兵蟹将 ----------

// 柱子换成金箍棒与长枪，碰撞几何不变
function drawWeaponPoles() {
  for (const [index, pole] of poles.entries()) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 20, 12, 0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#4c6a60';
    ctx.beginPath();
    ctx.ellipse(pole.x, pole.baseY + 5, 22, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#6d8a7d';
    ctx.beginPath();
    ctx.ellipse(pole.x - 7, pole.baseY + 1, 11, 6, -0.2, 0, Math.PI * 2);
    ctx.fill();

    if (index === 0) drawStaff(pole);
    else drawSpear(pole);
  }
}

// 原著：「一段乌铁，两头是两个金箍」，金箍旁镌「如意金箍棒」
function drawStaff(pole) {
  const w = 13;
  ctx.save();
  ctx.shadowColor = 'rgba(255, 214, 120, 0.55)';
  ctx.shadowBlur = 10;
  const grad = ctx.createLinearGradient(pole.x - w / 2, 0, pole.x + w / 2, 0);
  grad.addColorStop(0, '#1c2026');
  grad.addColorStop(0.4, '#3a4148');
  grad.addColorStop(0.7, '#565f68');
  grad.addColorStop(1, '#22262c');
  roundRect(pole.x - w / 2, pole.topY, w, pole.height, w / 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255, 236, 190, 0.5)';
  for (let i = 0; i < 7; i++) {
    const y = pole.topY + 40 + i * 32;
    if (y > pole.baseY - 34) break;
    ctx.beginPath();
    ctx.arc(pole.x - 3 + (i % 3) * 3, y, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  hoop(pole.x, pole.topY + 9, w);
  hoop(pole.x, pole.topY + 27, w);
  hoop(pole.x, pole.baseY - 27, w);
  hoop(pole.x, pole.baseY - 9, w);

  ctx.save();
  ctx.fillStyle = '#f4c437';
  ctx.font = '6px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = '如意金箍棒';
  for (let i = 0; i < label.length; i++) {
    ctx.fillText(label[i], pole.x + 1.5, pole.topY + 44 + i * 6.5);
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(pole.x - 3.4, pole.topY + 34);
  ctx.lineTo(pole.x - 3.4, pole.baseY - 34);
  ctx.stroke();
}

function hoop(x, y, w) {
  const grad = ctx.createLinearGradient(x - w / 2 - 1.5, 0, x + w / 2 + 1.5, 0);
  grad.addColorStop(0, '#8a5a12');
  grad.addColorStop(0.4, '#f4c437');
  grad.addColorStop(0.7, '#ffe29a');
  grad.addColorStop(1, '#c98f1b');
  roundRect(x - w / 2 - 1.5, y - 6, w + 3, 12, 3);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(122, 74, 16, 0.55)';
  ctx.lineWidth = 0.8;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * 3, y - 5);
    ctx.lineTo(x + i * 3, y + 5);
    ctx.stroke();
  }
}

function drawSpear(pole) {
  const w = 7;
  const grad = ctx.createLinearGradient(pole.x - w / 2, 0, pole.x + w / 2, 0);
  grad.addColorStop(0, '#5a6a72');
  grad.addColorStop(0.45, '#cfd8dc');
  grad.addColorStop(0.75, '#ffffff');
  grad.addColorStop(1, '#8a9aa2');
  roundRect(pole.x - w / 2, pole.topY, w, pole.height, w / 2);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(pole.x, pole.topY - 26);
  ctx.lineTo(pole.x - 7, pole.topY - 8);
  ctx.lineTo(pole.x, pole.topY + 3);
  ctx.lineTo(pole.x + 7, pole.topY - 8);
  ctx.closePath();
  const hg = ctx.createLinearGradient(pole.x - 7, 0, pole.x + 7, 0);
  hg.addColorStop(0, '#9fb2ba');
  hg.addColorStop(0.5, '#ffffff');
  hg.addColorStop(1, '#7d919b');
  ctx.fillStyle = hg;
  ctx.fill();

  ctx.strokeStyle = '#d94848';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(pole.x, pole.topY + 4);
    ctx.quadraticCurveTo(pole.x + i * 5, pole.topY + 10, pole.x + i * 7, pole.topY + 18);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffd43b';
  ctx.beginPath();
  ctx.arc(pole.x, pole.topY + 4, 3, 0, Math.PI * 2);
  ctx.fill();
}

// 龙宫剪影：水晶宫阙 + 金脊珠帘 + 白玉阶，沉在玩法层后面
function drawPalace(now) {
  const t = now / 1000;
  ctx.save();
  tankClip();
  ctx.clip();

  const halo = ctx.createRadialGradient(200, 215, 20, 200, 215, 200);
  halo.addColorStop(0, 'rgba(255, 226, 154, 0.22)');
  halo.addColorStop(0.5, 'rgba(255, 200, 110, 0.09)');
  halo.addColorStop(1, 'rgba(255, 200, 110, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(10, 50, W - 20, 340);

  ctx.globalAlpha = 0.55;

  function eave(y, half, lift) {
    ctx.beginPath();
    ctx.moveTo(200 - half - 12, y - lift);
    ctx.quadraticCurveTo(200 - half * 0.6, y + 7, 200, y + 5);
    ctx.quadraticCurveTo(200 + half * 0.6, y + 7, 200 + half + 12, y - lift);
    ctx.quadraticCurveTo(200 + half * 0.5, y - 9, 200, y - 11);
    ctx.quadraticCurveTo(200 - half * 0.5, y - 9, 200 - half - 12, y - lift);
    ctx.closePath();
    ctx.fillStyle = '#6b2a24';
    ctx.fill();
    ctx.strokeStyle = '#e8b64c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(200 - half - 12, y - lift);
    ctx.quadraticCurveTo(200, y - 14, 200 + half + 12, y - lift);
    ctx.stroke();
    ctx.fillStyle = '#e8b64c';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(200 + s * (half + 12), y - lift);
      ctx.quadraticCurveTo(200 + s * (half + 18), y - lift - 6, 200 + s * (half + 13), y - lift - 12);
      ctx.quadraticCurveTo(200 + s * (half + 9), y - lift - 5, 200 + s * (half + 7), y - lift + 2);
      ctx.closePath();
      ctx.fill();
    }

    // 瓦垄
    ctx.strokeStyle = 'rgba(30, 8, 6, 0.35)';
    ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const dx = i * (half / 3.6);
      const yT = y - 10 + Math.abs(dx) / (half + 12) * 2;
      const yB = y + 6 - Math.abs(dx) / half * (6 + lift) * 0.9;
      ctx.beginPath();
      ctx.moveTo(200 + dx * 0.8, yT);
      ctx.lineTo(200 + dx * 1.06, yB);
      ctx.stroke();
    }

    // 斗拱
    ctx.fillStyle = 'rgba(232, 182, 76, 0.85)';
    for (let dx = -half * 0.72; dx <= half * 0.72; dx += 16) {
      ctx.fillRect(200 + dx - 2, y + 6, 4, 5);
      ctx.fillRect(200 + dx - 3.5, y + 5, 7, 2);
    }

    // 檐角风铎，随水轻摆
    for (const s of [-1, 1]) {
      const swing = Math.sin(t * 2.2 + s * 1.3 + y * 0.1) * 0.18;
      ctx.save();
      ctx.translate(200 + s * (half + 12), y - lift);
      ctx.rotate(swing);
      ctx.strokeStyle = '#e8b64c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 4);
      ctx.stroke();
      ctx.fillStyle = '#f4c437';
      ctx.beginPath();
      ctx.moveTo(-2.6, 8);
      ctx.quadraticCurveTo(0, 3, 2.6, 8);
      ctx.lineTo(1.8, 9.5);
      ctx.lineTo(-1.8, 9.5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 10.5, 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 两侧耳阙
  for (const s of [-1, 1]) {
    const cx = 200 + s * 132;
    ctx.fillStyle = '#5e2622';
    ctx.fillRect(cx - 13, 226, 26, 100);
    ctx.fillStyle = '#7a2f2a';
    ctx.fillRect(cx - 16, 220, 32, 8);
    ctx.fillStyle = 'rgba(255, 214, 120, 0.5)';
    ctx.fillRect(cx - 5, 244, 10, 14);
  }

  // 主殿三重檐
  eave(140, 74, 10);
  eave(186, 100, 12);
  eave(232, 122, 14);

  // 殿身与朱柱（柱头柱脚包金）
  ctx.fillStyle = '#5e2622';
  ctx.fillRect(110, 240, 180, 88);
  const cols = [122, 162, 200, 238, 278];
  for (const cx of cols) {
    ctx.fillStyle = '#7a2f2a';
    ctx.fillRect(cx - 5, 240, 10, 88);
    ctx.fillStyle = '#e8b64c';
    ctx.fillRect(cx - 6, 240, 12, 4);
    ctx.fillRect(cx - 6, 322, 12, 5);
  }

  // 盘龙柱：内侧一对朱柱缠金龙纹
  for (const cx of [162, 238]) {
    ctx.strokeStyle = 'rgba(244, 196, 55, 0.8)';
    ctx.lineWidth = 1.8;
    for (let k = 0; k < 5; k++) {
      const cy = 254 + k * 14;
      ctx.beginPath();
      ctx.arc(cx, cy, 5.5, Math.PI * 0.15, Math.PI * 0.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + 7, 5.5, Math.PI * 1.1, Math.PI * 1.95);
      ctx.stroke();
    }
    ctx.fillStyle = '#f4c437';
    ctx.beginPath();
    ctx.arc(cx + 2, 249, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d94848';
    ctx.beginPath();
    ctx.arc(cx + 2.8, 248.4, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // 珠帘：柱间垂落、随水微摆的珍珠串
  ctx.fillStyle = 'rgba(255, 240, 210, 0.75)';
  for (let i = 0; i < cols.length - 1; i++) {
    const mx = (cols[i] + cols[i + 1]) / 2;
    for (let k = 0; k < 7; k++) {
      const sway = Math.sin(t * 1.2 + i + k * 0.5) * 1.2;
      ctx.beginPath();
      ctx.arc(mx + sway, 248 + k * 10, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 暖窗 + 窗棂
  ctx.fillStyle = 'rgba(255, 190, 90, 0.55)';
  ctx.fillRect(140, 262, 14, 20);
  ctx.fillRect(246, 262, 14, 20);
  ctx.strokeStyle = 'rgba(90, 40, 20, 0.6)';
  ctx.lineWidth = 1;
  for (const wx of [140, 246]) {
    ctx.strokeRect(wx + 0.5, 262.5, 13, 19);
    ctx.beginPath();
    ctx.moveTo(wx + 7, 262);
    ctx.lineTo(wx + 7, 282);
    ctx.moveTo(wx, 269);
    ctx.lineTo(wx + 14, 269);
    ctx.moveTo(wx, 276);
    ctx.lineTo(wx + 14, 276);
    ctx.stroke();
  }

  // 匾额
  ctx.fillStyle = '#2a100c';
  roundRect(176, 196, 48, 16, 3);
  ctx.fill();
  ctx.strokeStyle = '#e8b64c';
  ctx.lineWidth = 1.5;
  roundRect(176, 196, 48, 16, 3);
  ctx.stroke();
  ctx.save();
  ctx.fillStyle = '#ffd43b';
  ctx.font = '9px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('东海龙宫', 200, 205);
  ctx.restore();
  ctx.fillStyle = '#f4c437';
  for (const [px, py] of [[179, 199], [221, 199], [179, 209], [221, 209]]) {
    ctx.beginPath();
    ctx.arc(px, py, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // 白玉阶
  ctx.fillStyle = 'rgba(232, 240, 236, 0.5)';
  ctx.fillRect(126, 328, 148, 7);
  ctx.fillRect(116, 336, 168, 7);
  ctx.fillRect(106, 344, 188, 7);

  // 白玉栏杆
  for (const s of [-1, 1]) {
    ctx.strokeStyle = 'rgba(240, 248, 244, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(200 + s * 74, 324);
    ctx.lineTo(200 + s * 94, 342);
    ctx.stroke();
    ctx.fillStyle = 'rgba(240, 248, 244, 0.6)';
    for (let k = 0; k < 3; k++) {
      const px = 200 + s * (74 + k * 10);
      const py = 324 + k * 9;
      ctx.fillRect(px - 1, py, 2, 8);
      ctx.beginPath();
      ctx.arc(px, py - 1.5, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

// 水波焦散光网：两层交叉波带慢速漂移，投在宫墙与水体上
function drawCaustics(now) {
  const t = now / 1000;
  ctx.save();
  tankClip();
  ctx.clip();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  for (let layer = 0; layer < 2; layer++) {
    const drift = t * (10 + layer * 7) * (layer ? -1 : 1);
    ctx.strokeStyle = `rgba(255, 236, 180, ${layer ? 0.055 : 0.085})`;
    ctx.lineWidth = layer ? 1.2 : 1.8;
    for (let y = TANK_TOP + 26 + layer * 14; y < TANK_BOTTOM + 8; y += 30 + layer * 8) {
      ctx.beginPath();
      for (let x = 14; x <= W - 14; x += 7) {
        const yy = y + Math.sin((x + drift * 6) * 0.043 + y * 0.31) * 4.5
          + Math.sin((x - drift * 4) * 0.091 + y * 0.11) * 2;
        if (x === 14) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    for (let x = 30 + layer * 18; x < W - 14; x += 44 + layer * 10) {
      ctx.beginPath();
      for (let y = TANK_TOP + 10; y <= TANK_BOTTOM + 8; y += 8) {
        const xx = x + Math.sin((y + drift * 5) * 0.05 + x * 0.27) * 4
          + Math.sin((y - drift * 3) * 0.1 + x * 0.09) * 1.8;
        if (y === TANK_TOP + 10) ctx.moveTo(xx, y); else ctx.lineTo(xx, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPalaceLights(now) {
  const t = now / 1000;
  ctx.save();
  tankClip();
  ctx.clip();
  [62, 338].forEach((lx, i) => {
    const sway = Math.sin(t * 1.1 + i * 2) * 4;
    const x = lx + sway, y = 112;
    ctx.strokeStyle = 'rgba(232, 182, 76, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lx, TANK_TOP);
    ctx.lineTo(x, y - 12);
    ctx.stroke();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const pulse = 0.85 + Math.sin(t * 2.2 + i) * 0.15;
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 90);
    glow.addColorStop(0, `rgba(255, 190, 90, ${0.34 * pulse})`);
    glow.addColorStop(0.4, `rgba(255, 170, 70, ${0.14 * pulse})`);
    glow.addColorStop(1, 'rgba(255, 170, 70, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 90, y - 90, 180, 180);
    ctx.restore();

    ctx.fillStyle = '#d94848';
    ctx.beginPath();
    ctx.ellipse(x, y, 10, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd43b';
    ctx.fillRect(x - 6, y - 16, 12, 4);
    ctx.fillRect(x - 6, y + 12, 12, 4);
    ctx.strokeStyle = 'rgba(255, 226, 154, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, 4.5, 13, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffd43b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 16);
    ctx.lineTo(x + sway * 0.4, y + 24);
    ctx.stroke();
  });
  ctx.restore();
}

// 虾兵蟹将：各守一根柱子。巡逻走椭圆/8 字，附近有环会短促扑击；
// 命中时朝圆环方向打开兵器，并把环沿来路打回去
const dragonGuards = [
  {
    poleIndex: 0, kind: 'shrimp', phase: 0.6, x: 150, y: 460, dir: 1,
    anger: 0, cool: 0, strike: 0, strikeAng: 0,
    dashT: 0, dashX: 0, dashY: 0, dashCd: 0,
    orbitSpeed: 0.92, rangeX: 40, rangeY: 18, hover: 88, wobble: 2.6,
  },
  {
    poleIndex: 1, kind: 'crab', phase: 2.4, x: 310, y: 520, dir: -1,
    anger: 0, cool: 0, strike: 0, strikeAng: 0,
    dashT: 0, dashX: 0, dashY: 0, dashCd: 0,
    orbitSpeed: 0.64, rangeX: 56, rangeY: 26, hover: 96, wobble: 4.2,
  },
];
const GUARD_ANGER = 1.0;
const GUARD_COOLDOWN = 1.2;
const GUARD_STRIKE = 0.3;
const GUARD_DASH = 0.36;
const GUARD_DASH_CD = 1.1;

function startGuardDash(g, target, baseX, baseY) {
  const dx = target.x - baseX;
  const dy = target.y - baseY;
  const d = Math.hypot(dx, dy) || 1;
  const reach = Math.min(20, d * 0.45);
  g.dashX = (dx / d) * reach;
  g.dashY = (dy / d) * reach;
  g.dashT = GUARD_DASH;
  g.dashCd = GUARD_DASH_CD;
  if (target.x !== undefined) g.dir = target.x >= g.x ? 1 : -1;
}

function stepGuards(dt, now) {
  const t = now / 1000;
  for (const g of dragonGuards) {
    const pole = poles[g.poleIndex];
    const orbit = t * g.orbitSpeed + g.phase;
    // 椭圆 + 纵向 Lissajous + 漂浮，不再是单调左右扫
    const baseX = pole.x + Math.cos(orbit) * g.rangeX;
    const baseY = pole.topY + g.hover
      + Math.sin(orbit * 1.55 + g.phase) * g.rangeY
      + Math.sin(t * 2.1 + g.phase * 1.7) * g.wobble;

    // 冲刺/命中期间保持朝向目标，不被轨道速度立刻改回来
    if (g.dashT <= 0) {
      const vx = -Math.sin(orbit) * g.rangeX * g.orbitSpeed;
      g.dir = vx >= 0 ? 1 : -1;
    }
    g.anger = Math.max(0, g.anger - dt);
    g.cool = Math.max(0, g.cool - dt);
    g.strike = Math.max(0, g.strike - dt);
    g.dashCd = Math.max(0, g.dashCd - dt);
    g.dashT = Math.max(0, g.dashT - dt);

    // 附近有圆环时探身扑一下（只叠加短位移，不改变基础巡逻）
    if (g.dashT <= 0 && g.dashCd <= 0 && g.cool <= 0) {
      let target = null;
      let best = 150;
      for (const r of rings) {
        if (r.state !== 'free') continue;
        const d = Math.hypot(r.x - g.x, r.y - g.y);
        if (d < best) { best = d; target = r; }
      }
      if (target) startGuardDash(g, target, baseX, baseY);
    }

    const dashK = g.dashT > 0 ? Math.sin((1 - g.dashT / GUARD_DASH) * Math.PI) : 0;
    g.x = baseX + g.dashX * dashK;
    g.y = baseY + g.dashY * dashK;

    if (g.cool > 0) continue;
    for (const ring of rings) {
      if (ring.state !== 'free') continue;
      if (Math.hypot(ring.x - g.x, ring.y - g.y) > ring.r + 16) continue;

      // 命中：把环沿着它来时的方向打回去
      const speed = Math.hypot(ring.vx, ring.vy);
      let nx, ny;
      if (speed > 30) {
        nx = -ring.vx / speed;
        ny = -ring.vy / speed;
      } else {
        const dx = ring.x - g.x;
        const dy = ring.y - g.y;
        const d = Math.hypot(dx, dy) || 1;
        nx = dx / d;
        ny = dy / d;
      }
      const power = Math.max(240, Math.min(430, 170 + speed * 0.75));
      ring.vx = nx * power;
      ring.vy = ny * power;
      ring.flipV += (Math.random() - 0.5) * 4;

      g.anger = GUARD_ANGER;
      g.cool = GUARD_COOLDOWN;
      g.strike = GUARD_STRIKE;
      g.strikeAng = Math.atan2(ring.y - g.y, ring.x - g.x);
      g.dir = ring.x >= g.x ? 1 : -1;
      if (g.dashT <= 0) startGuardDash(g, ring, baseX, baseY);

      sfx('knock');
      if (!REDUCED) shakeT = 0.25;
      break;
    }
  }
}

function drawGuards(now) {
  const t = now / 1000;
  for (const g of dragonGuards) {
    const shake = g.anger > 0 ? Math.sin(now / 25) * 2 : 0;
    // 打击弧画在守卫身后，先画出“张开”的方向，再让蟹钳/三股叉压在上面
    if (g.strike > 0) drawGuardStrike(g);
    ctx.save();
    ctx.translate(g.x + shake, g.y);
    if (g.kind === 'shrimp') drawShrimp(g, t);
    else drawCrab(g, t);
    ctx.restore();
    if (g.anger > 0) drawAngerMark(g.x + shake + 13, g.y - 22, g.anger);
  }
}

// 命中瞬间朝圆环方向张开的打击弧
function drawGuardStrike(g) {
  const k = Math.max(0, g.strike / GUARD_STRIKE);
  const open = Math.sin((1 - k) * Math.PI);
  if (open <= 0.01) return;
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(g.strikeAng);
  ctx.globalAlpha = Math.min(1, open * 1.5);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#ffd43b';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, 31 + (1 - k) * 15, -0.55, 0.55);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 246, 214, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, 39 + (1 - k) * 19, -0.38, 0.38);
  ctx.stroke();
  for (const a of [-0.34, 0, 0.34]) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 29, Math.sin(a) * 29);
    ctx.lineTo(Math.cos(a) * (41 + (1 - k) * 8), Math.sin(a) * (41 + (1 - k) * 8));
    ctx.stroke();
  }
  ctx.restore();
}

function drawShrimp(g, t) {
  const wig = Math.sin(t * 6 + g.phase) * 0.12;
  ctx.scale(g.dir, 1);
  ctx.rotate(wig);
  const c1 = g.anger > 0 ? '#e2695f' : '#3fae8c';
  const c2 = g.anger > 0 ? '#b34a2e' : '#2c8a6e';

  ctx.strokeStyle = c2;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(10, -4);
  ctx.quadraticCurveTo(22, -14, 30, -12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(10, -2);
  ctx.quadraticCurveTo(24, -6, 32, -2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-14, 5);
  ctx.lineTo(-24, 1);
  ctx.lineTo(-21, 11);
  ctx.closePath();
  ctx.fillStyle = c2;
  ctx.fill();

  ctx.fillStyle = c1;
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 8, -0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-9, 4, 8, 6, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // 甲片
  ctx.strokeStyle = c2;
  ctx.lineWidth = 1.2;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(i * 6 - 1, -2, 6, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 6, 6);
    ctx.lineTo(i * 6 - 2, 11);
    ctx.stroke();
  }

  // 兵盔 + 红缨
  ctx.fillStyle = '#c98f1b';
  ctx.beginPath();
  ctx.arc(8, -6, 4.6, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8b64c';
  ctx.fillRect(3.4, -6.8, 9.2, 1.6);
  ctx.strokeStyle = '#d94848';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(8, -10);
  ctx.quadraticCurveTo(9 + Math.sin(t * 7) * 1.5, -15, 7 + Math.sin(t * 7) * 2.5, -17);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(9, -3, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(9.7, -3, 1.2, 0, Math.PI * 2);
  ctx.fillStyle = '#20303c';
  ctx.fill();
  if (g.anger > 0) {
    ctx.strokeStyle = '#8f1d1d';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(6.8, -4.8);
    ctx.lineTo(11.2, -3.4);
    ctx.stroke();
  }

  // 手里的三股小叉：金箍 + 红缨；命中时向前递出
  const thrust = g.strike > 0 ? Math.sin((1 - g.strike / GUARD_STRIKE) * Math.PI) * 6 : 0;
  ctx.save();
  ctx.translate(thrust, 0);
  ctx.strokeStyle = '#8a5a12';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(15, 10);
  ctx.lineTo(17, -14);
  ctx.stroke();
  ctx.fillStyle = '#f4c437';
  ctx.fillRect(15.6, -4, 2.8, 3);
  ctx.strokeStyle = '#d94848';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(17, -13);
  ctx.quadraticCurveTo(20 + Math.sin(t * 8) * 1.2, -11, 21 + Math.sin(t * 8) * 2, -8);
  ctx.stroke();
  ctx.strokeStyle = '#cfd8dc';
  ctx.lineWidth = 1.6;
  for (const dx of [-3, 0, 3]) {
    ctx.beginPath();
    ctx.moveTo(17, -14);
    ctx.lineTo(17 + dx, -20);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCrab(g, t) {
  const wig = Math.sin(t * 5 + g.phase) * 0.1;
  ctx.scale(g.dir, 1);
  ctx.rotate(wig);
  const c1 = g.anger > 0 ? '#ff7043' : '#c94f43';
  const c2 = g.anger > 0 ? '#d84315' : '#9c3a30';

  // 背旗
  ctx.strokeStyle = '#8a5a12';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-9, -6);
  ctx.lineTo(-13, -26);
  ctx.stroke();
  const flutter = Math.sin(t * 3.2 + g.phase) * 2;
  ctx.beginPath();
  ctx.moveTo(-13, -26);
  ctx.quadraticCurveTo(-4, -24 + flutter, -2, -21 + flutter);
  ctx.lineTo(-12, -18);
  ctx.closePath();
  ctx.fillStyle = '#d94848';
  ctx.fill();
  ctx.strokeStyle = '#ffd43b';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.strokeStyle = c2;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const lx = -8 + i * 8;
    ctx.beginPath();
    ctx.moveTo(lx, 7);
    ctx.lineTo(lx - 4, 13);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-lx, 7);
    ctx.lineTo(-lx + 4, 13);
    ctx.stroke();
  }

  const open = g.strike > 0 ? Math.sin((1 - g.strike / GUARD_STRIKE) * Math.PI) : 0;
  const claw = (sx) => {
    ctx.beginPath();
    ctx.moveTo(sx * 12, 0);
    ctx.quadraticCurveTo(sx * 18, -2, sx * 19, -8);
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = c1;
    ctx.stroke();
    ctx.strokeStyle = '#e8b64c';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(sx * 19, -8, 3.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx * 20, -11, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = c1;
    ctx.fill();
    // 上下两片钳：命中时向圆环方向张开
    const spread = 0.12 + open * 0.64;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(sx * 20, -11);
      ctx.rotate(side * spread);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(sx * 8.5, -2.4);
      ctx.lineTo(sx * 6, 3);
      ctx.closePath();
      ctx.fillStyle = c2;
      ctx.fill();
      ctx.restore();
    }
  };
  claw(1);
  claw(-1);

  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = c1;
  ctx.fill();

  // 壳刺
  ctx.fillStyle = c2;
  for (const sx of [-9, 9]) {
    ctx.beginPath();
    ctx.moveTo(sx - 2.4, -7.2);
    ctx.lineTo(sx, -11.6);
    ctx.lineTo(sx + 2.4, -7.2);
    ctx.closePath();
    ctx.fill();
  }

  // 金护胸
  ctx.fillStyle = 'rgba(232, 182, 76, 0.85)';
  ctx.beginPath();
  ctx.ellipse(0, 5.5, 10, 4, 0, 0, Math.PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-3, -3, 7, 4, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fill();

  // 将盔 + 顶珠
  ctx.fillStyle = '#c98f1b';
  ctx.beginPath();
  ctx.arc(0, -7, 4.4, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8b64c';
  ctx.fillRect(-4.8, -7.8, 9.6, 1.6);
  ctx.fillStyle = '#f4c437';
  ctx.beginPath();
  ctx.arc(0, -12, 1.6, 0, Math.PI * 2);
  ctx.fill();

  for (const sx of [-1, 1]) {
    ctx.strokeStyle = c2;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(sx * 4, -8);
    ctx.lineTo(sx * 5, -14);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx * 5, -15, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx * 5.6, -15, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#20303c';
    ctx.fill();
  }
  if (g.anger > 0) {
    ctx.strokeStyle = '#8f1d1d';
    ctx.lineWidth = 1.4;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sx * 2.6, -17);
      ctx.lineTo(sx * 7.4, -15.6);
      ctx.stroke();
    }
  }
}

function drawAngerMark(x, y, anger) {
  ctx.save();
  ctx.globalAlpha = Math.min(1, anger * 2.5);
  ctx.strokeStyle = '#ff4d4f';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 2, y + Math.sin(a) * 2);
    ctx.lineTo(x + Math.cos(a) * 5.5, y + Math.sin(a) * 5.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPulses() {
  ctx.save();
  tankClip();
  ctx.clip();
  for (const pulse of pulses) {
    const h = 110 * pulse.flash;
    const grad = ctx.createLinearGradient(0, TANK_BOTTOM, 0, TANK_BOTTOM - h);
    grad.addColorStop(0, `rgba(255, 255, 255, ${0.45 * pulse.flash})`);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pulse.x - 18, TANK_BOTTOM);
    ctx.quadraticCurveTo(pulse.x - 11, TANK_BOTTOM - h * 0.6, pulse.x - 4, TANK_BOTTOM - h);
    ctx.lineTo(pulse.x + 4, TANK_BOTTOM - h);
    ctx.quadraticCurveTo(pulse.x + 11, TANK_BOTTOM - h * 0.6, pulse.x + 18, TANK_BOTTOM);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(pulse.x, TANK_BOTTOM - 4, 22 * pulse.flash, 8 * pulse.flash, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.4 * pulse.flash})`;
    ctx.fill();
  }
  ctx.restore();
}

function drawRingUnder(ring) {
  // 圆环下缘（画在杆后，制造厚度），随姿态从扁平渐变到竖立
  const sy = RING_FLAT + (1 - RING_FLAT) * ring.flip;
  ctx.save();
  ctx.translate(ring.x, ring.y + 6 * sy);
  ctx.rotate(ring.tilt);
  ctx.scale((1 + ring.squash * 0.3) * (1 - ring.flip * 0.15), sy);
  ctx.beginPath();
  ctx.arc(0, 0, ring.r, 0, Math.PI * 2);
  ctx.arc(0, 0, ring.holeR, 0, Math.PI * 2, true);
  ctx.fillStyle = shade(ring.color, -0.35);
  ctx.fill();
  ctx.restore();
}

function drawRingTop(ring, now) {
  const sy = RING_FLAT + (1 - RING_FLAT) * ring.flip;
  ctx.save();
  ctx.translate(ring.x, ring.y);
  ctx.rotate(ring.tilt);
  ctx.scale((1 + ring.squash * 0.3) * (1 - ring.flip * 0.15), sy);

  // 主体：左上受光的环形渐变
  const g = ctx.createLinearGradient(-ring.r, -ring.r * RING_FLAT, ring.r, ring.r * RING_FLAT);
  g.addColorStop(0, shade(ring.color, 0.45));
  g.addColorStop(0.45, ring.color);
  g.addColorStop(1, shade(ring.color, -0.22));
  ctx.beginPath();
  ctx.arc(0, 0, ring.r, 0, Math.PI * 2);
  ctx.arc(0, 0, ring.holeR, 0, Math.PI * 2, true);
  ctx.fillStyle = g;
  ctx.fill();

  // 上缘弧形反光
  const midR = (ring.r + ring.holeR) / 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, midR, midR * RING_FLAT, 0, -2.5, -0.6);
  ctx.lineWidth = ring.r - ring.holeR - 4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.stroke();

  // 高光点
  ctx.beginPath();
  ctx.ellipse(-midR * 0.62, -midR * 0.28, (ring.r - ring.holeR) * 0.16, (ring.r - ring.holeR) * 0.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fill();

  // 20 分金环：环带上流转的星芒
  if (ring.tier === 2) {
    const t = now / 1000;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 2; k++) {
      const a = t * 1.3 + k * Math.PI;
      const sx = Math.cos(a) * midR;
      const syk = Math.sin(a) * midR;
      const g = 2.6 + Math.sin(t * 6 + k) * 1.1;
      ctx.beginPath();
      ctx.moveTo(sx - g, syk);
      ctx.lineTo(sx + g, syk);
      ctx.moveTo(sx, syk - g);
      ctx.lineTo(sx, syk + g);
      ctx.stroke();
    }
  }

  if (ring.state === 'settled') {
    ctx.shadowColor = 'rgba(255, 213, 77, 0.9)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(0, 0, midR, 0, Math.PI * 2);
    ctx.lineWidth = ring.r - ring.holeR;
    ctx.strokeStyle = 'rgba(255, 224, 102, 0.6)';
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // 套中瞬间的扩散闪光
  if (ring.flash > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, ring.r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 244, 200, ${0.65 * ring.flash})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}

function drawRingShadows() {
  for (const ring of rings) {
    if (ring.state !== 'free') continue;
    const h = Math.max(0, TANK_BOTTOM - ring.y);
    const a = Math.max(0, 0.18 - h / 1200);
    if (a <= 0.02) continue;
    ctx.beginPath();
    ctx.ellipse(ring.x, TANK_BOTTOM + 8, ring.r * (0.7 + h / 500), ring.r * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(20, 90, 130, ${a})`;
    ctx.fill();
  }
}

// 龙宫地面：珍珠、元宝、玉钱、宝石、珊瑚枝（原著珍宝满地）
function drawTreasure(x, y, r, kind, t, i) {
  ctx.save();
  if (kind === 0) {
    ctx.shadowColor = 'rgba(255, 250, 240, 0.7)';
    ctx.shadowBlur = 6;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#f6e3e8');
    g.addColorStop(1, '#d9b8c4');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.36, r * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
  } else if (kind === 1) {
    ctx.fillStyle = '#f4c437';
    ctx.beginPath();
    ctx.moveTo(x - r, y + r * 0.4);
    ctx.quadraticCurveTo(x - r * 1.1, y - r * 0.5, x - r * 0.35, y - r * 0.35);
    ctx.quadraticCurveTo(x, y - r * 0.1, x + r * 0.35, y - r * 0.35);
    ctx.quadraticCurveTo(x + r * 1.1, y - r * 0.5, x + r, y + r * 0.4);
    ctx.quadraticCurveTo(x, y + r * 0.75, x - r, y + r * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffe29a';
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.2, r * 0.42, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 2) {
    ctx.fillStyle = '#7fd8b0';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d5450';
    ctx.fillRect(x - r * 0.28, y - r * 0.28, r * 0.56, r * 0.56);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, Math.PI * 1.05, Math.PI * 1.6);
    ctx.stroke();
  } else if (kind === 3) {
    ctx.fillStyle = i % 2 ? '#4cc9f0' : '#f783ac';
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + k * Math.PI * 2 / 5;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r * 0.9;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.7);
    ctx.lineTo(x - r * 0.3, y - r * 0.1);
    ctx.lineTo(x + r * 0.15, y - r * 0.15);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeStyle = '#e8875a';
    ctx.lineWidth = Math.max(1.6, r * 0.42);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.5);
    ctx.lineTo(x, y - r * 0.3);
    ctx.moveTo(x, y);
    ctx.lineTo(x - r * 0.7, y - r * 0.7);
    ctx.moveTo(x, y - r * 0.15);
    ctx.lineTo(x + r * 0.7, y - r * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFloor(now) {
  const y0 = TANK_BOTTOM + 4;
  const g = ctx.createLinearGradient(0, y0, 0, TANK_BOTTOM + 16);
  g.addColorStop(0, pal('#f7e8c8', '#487583', '#d8b878'));
  g.addColorStop(1, pal('#eed9ae', '#315d6d', '#b08c50'));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(14, y0 + 6);
  for (let x = 14; x <= W - 14; x += 16) {
    ctx.lineTo(x, y0 + Math.sin(x * 0.15) * 2);
  }
  ctx.lineTo(W - 14, TANK_BOTTOM + 16);
  ctx.lineTo(14, TANK_BOTTOM + 16);
  ctx.closePath();
  ctx.fill();

  if (dragonMode) {
    const t = now / 1000;
    for (const [i, p] of pebbles.entries()) {
      const bob = Math.sin(t * 1.4 + i) * 0.8;
      drawTreasure(p.x, y0 + 4 + p.dy + bob, p.r + 1, i % 5, t, i);
    }
    return;
  }

  for (const p of pebbles) {
    const py = y0 + 3 + p.dy;
    ctx.beginPath();
    ctx.ellipse(p.x, py, p.r, p.r * 0.62, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal(p.light ? '#e2d3b4' : '#d4c2a0', p.light ? '#527c86' : '#416b79', p.light ? '#e6cf9a' : '#c2a066');
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(p.x - p.r * 0.25, py - p.r * 0.2, p.r * 0.4, p.r * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = pal('rgba(255, 255, 255, 0.55)', 'rgba(200, 240, 245, 0.2)', 'rgba(255, 255, 255, 0.4)');
    ctx.fill();
  }
}

function drawGlassSheen() {
  ctx.save();
  tankClip();
  ctx.clip();
  ctx.fillStyle = pal('rgba(255, 255, 255, 0.10)', 'rgba(190, 235, 255, 0.06)', 'rgba(255, 236, 180, 0.08)');
  ctx.beginPath();
  ctx.moveTo(44, TANK_TOP);
  ctx.lineTo(96, TANK_TOP);
  ctx.lineTo(28, TANK_BOTTOM + 16);
  ctx.lineTo(-24, TANK_BOTTOM + 16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = pal('rgba(255, 255, 255, 0.07)', 'rgba(190, 235, 255, 0.04)', 'rgba(255, 236, 180, 0.05)');
  ctx.beginPath();
  ctx.moveTo(122, TANK_TOP);
  ctx.lineTo(150, TANK_TOP);
  ctx.lineTo(86, TANK_BOTTOM + 16);
  ctx.lineTo(58, TANK_BOTTOM + 16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBubbles() {
  for (const b of bubbles) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fill();
  }
}

// 套中水花：向上溅起再落回的小水珠
function spawnSplash(x, y) {
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const sp = 60 + Math.random() * 120;
    splashes.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.5 + Math.random() * 0.25,
      t: 0,
      r: 1.2 + Math.random() * 1.6,
    });
  }
}

function stepSplashes(dt) {
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i];
    s.t += dt;
    if (s.t >= s.life) {
      splashes.splice(i, 1);
      continue;
    }
    s.vy += 420 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
}

function drawSplashes() {
  for (const s of splashes) {
    const k = 1 - s.t / s.life;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * k + 0.4, 0, Math.PI * 2);
    ctx.fillStyle = pal(
      `rgba(255, 255, 255, ${0.7 * k})`,
      `rgba(190, 240, 255, ${0.6 * k})`,
      `rgba(255, 236, 180, ${0.65 * k})`
    );
    ctx.fill();
  }
}

function draw(now) {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shakeT > 0 && !REDUCED) {
    const k = (shakeT / 0.25) * 3;
    ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
  }
  drawTank(now);
  if (dragonMode) drawPalace(now);
  if (dragonMode && !REDUCED) drawCaustics(now);
  drawFloor(now);
  drawDecor(now);
  if (nightMode || dragonMode) drawPlankton(now);
  if (dragonMode) drawGuards(now);
  else drawFish(now);
  drawRingShadows();
  for (const ring of rings) drawRingUnder(ring);
  drawCoralPoles();
  drawBubbles();
  for (const ring of rings) drawRingTop(ring, now);
  drawSplashes();
  if (nightMode) drawLanternLights(now);
  if (dragonMode) drawPalaceLights(now);

  drawPulses();
  drawGlassSheen();
  ctx.restore();
}

// ---------- 主循环 ----------

let gameTime = 0;
let lastTime = performance.now();
let acc = 0;
const FIXED_DT = 1 / 120;

function loop(now) {
  const frameDt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (document.hidden || phase === 'paused') {
    requestAnimationFrame(loop);
    return;
  }
  gameTime += frameDt * 1000;
  now = gameTime;

  if (phase === 'play') {
    acc += frameDt;
    while (acc >= FIXED_DT && phase === 'play') {
      stepPhysics(FIXED_DT, now);
      acc -= FIXED_DT;
    }
    timeLeft = Math.max(0, timeLeft - frameDt);
    updateHUD();
    if (timeLeft === 0 && phase === 'play') endRound('time');
  }

  if (phase !== 'paused') {
    stepBubbles(frameDt, now);
    stepFireworks(frameDt, now);
    stepSplashes(frameDt);
    shakeT = Math.max(0, shakeT - frameDt);
    for (const r of rings) r.flash = Math.max(0, (r.flash || 0) - frameDt * 2.5);
    if (dragonMode) stepGuards(frameDt, now);
    else stepFish(frameDt, now);
  }
  draw(now);
  drawFx();
  requestAnimationFrame(loop);
}

// ---------- 调参面板 ----------

const debugPanel = document.getElementById('debugPanel');
const sliders = [
  ['pPulse', 'pulsePower'],
  ['pSpread', 'pulseSpread'],
  ['pDrag', 'drag'],
];
for (const [id, key] of sliders) {
  const el = document.getElementById(id);
  el.value = params[key];
  el.addEventListener('input', () => { params[key] = parseFloat(el.value); });
}

document.getElementById('btnDebug').addEventListener('click', () => {
  sfx('click');
  debugPanel.classList.toggle('hidden');
});

const btnDev = document.getElementById('btnDev');
btnDev.addEventListener('click', () => {
  sfx('click');
  devMode = !devMode;
  btnDev.classList.toggle('on', devMode);
  btnDev.setAttribute('aria-pressed', String(devMode));
  updateSwatchStates();
  showToast(devMode ? '开发者模式已开启：场景任意切换' : '开发者模式已关闭', devMode ? '#ffd43b' : '#94a3b8');
});

const btnSound = document.getElementById('btnSound');
function syncSoundBtn() {
  btnSound.classList.toggle('off', muted);
  btnSound.textContent = muted ? '静音' : '音效';
  btnSound.setAttribute('aria-pressed', String(!muted));
}
btnSound.addEventListener('click', () => {
  muted = !muted;
  safeSet('water-ring-muted', muted ? '1' : '0');
  syncSoundBtn();
  if (!muted) {
    ensureAudio();
    sfx('click');
  }
});
document.getElementById('btnReset').addEventListener('click', () => {
  sfx('click');
  startBrief(levelIndex);
});

function setTheme(id) {
  theme = id;
  nightMode = id === 'night';
  dragonMode = id === 'dragon';
  document.body.classList.toggle('night', nightMode);
  document.body.classList.toggle('dragon', dragonMode);
}

function updateSwatchStates() {
  for (const btn of sceneSwatches.querySelectorAll('.sceneSwatchBtn')) {
    const idx = LEVELS.findIndex(level => level.id === btn.dataset.scene);
    const locked = !canEnterLevel(idx);
    btn.classList.toggle('locked', locked);
    btn.classList.toggle('selected', idx === levelIndex);
    btn.setAttribute('aria-disabled', String(locked));
  }
}

function closeSceneMenu() {
  sceneSwatches.classList.add('hidden');
  sceneButton.setAttribute('aria-expanded', 'false');
}

sceneButton.addEventListener('click', event => {
  event.stopPropagation();
  sfx('click');
  const hidden = sceneSwatches.classList.toggle('hidden');
  sceneButton.setAttribute('aria-expanded', String(!hidden));
});
for (const option of sceneSwatches.querySelectorAll('.sceneSwatchBtn')) {
  option.addEventListener('pointerdown', event => {
    event.stopPropagation();
    const idx = LEVELS.findIndex(level => level.id === option.dataset.scene);
    if (!canEnterLevel(idx)) {
      if (idx < 1 || idx >= LEVELS.length) return;
      const prev = LEVELS[idx - 1];
      showToast(`需先通关「${prev.name}」${prev.target} 分`, '#ff6b6b');
      return;
    }
    sfx('click');
    startBrief(idx);
  });
}
document.addEventListener('pointerdown', event => {
  if (!sceneSwatches.classList.contains('hidden') && !sceneSwatches.contains(event.target)) closeSceneMenu();
});

// 打开页面先到封面，不直接开局
levelIndex = 0;
setTheme(LEVELS[0].theme);
resetGame();
updateSwatchStates();
if (DEV_ENTRY) btnDev.classList.remove('hidden');
else btnDebug.classList.add('hidden');
syncSoundBtn();
renderTitle();
requestAnimationFrame(loop);
