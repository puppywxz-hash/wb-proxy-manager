// WB代理管理器 - Electron 主进程
// 托盘常驻 + 管理 codex/zcode x cn/ai 四个代理子进程
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, fork } = require('child_process');
const http = require('http');

// protoGroup: 按协议分组（OpenAI / Anthropic），同一组下列出兼容的 agent 客户端
const INSTANCES = [
  { key: 'codex-cn', name: 'CODEX', flavor: 'codex', variant: 'cn', region: '国内版·WorkBuddy', port: 8401, protoGroup: 'openai', proto: 'OpenAI 协议 (Responses + Chat)', url: 'http://127.0.0.1:8401/v1', script: 'vendor/codex-proxy.mjs',
    clients: ['Codex CLI（cc-switch 切 WorkBuddy）', 'DSH（OpenAI 兼容模式）', '小米 / 任意 OpenAI 兼容客户端（Chat Completions）'] },
  { key: 'codex-ai', name: 'CODEX', flavor: 'codex', variant: 'ai', region: '国际版·WorkBuddy AI', port: 8403, protoGroup: 'openai', proto: 'OpenAI 协议 (Responses + Chat)', url: 'http://127.0.0.1:8403/v1', script: 'vendor/codex-proxy.mjs',
    clients: ['Codex CLI（cc-switch 切 WorkBuddy AI）', 'DSH（OpenAI 兼容模式 + 国际版账号）', '任意 OpenAI 兼容客户端'] },
  { key: 'zcode-cn', name: 'CLAUDE / ZCODE', flavor: 'zcode', variant: 'cn', region: '国内版·WorkBuddy', port: 8400, protoGroup: 'anthropic', proto: 'Anthropic 协议 (Messages)', url: 'http://127.0.0.1:8400', script: 'vendor/zcode-proxy.mjs',
    clients: ['Claude Code / cc-switch（anthropic provider）', 'DSH（Anthropic 协议模式）', '任意 Anthropic Messages 兼容客户端'] },
  { key: 'zcode-ai', name: 'CLAUDE / ZCODE', flavor: 'zcode', variant: 'ai', region: '国际版·WorkBuddy AI', port: 8402, protoGroup: 'anthropic', proto: 'Anthropic 协议 (Messages)', url: 'http://127.0.0.1:8402', script: 'vendor/zcode-proxy.mjs',
    clients: ['Claude Code / cc-switch（anthropic provider + 国际版账号）', '任意 Anthropic Messages 兼容客户端'] },
];

const procs = new Map(); // key -> ChildProcess
let win = null, tray = null;
const ROOT = path.resolve(__dirname, '..');
const WB_CONFIG_DIR = path.join(os.homedir(), '.codex-workbuddy-proxy');
const ACTIVE_MODEL_FILE = path.join(WB_CONFIG_DIR, 'active-model.json');
const RANK_CACHE_FILE = path.join(app.getPath('userData') || WB_CONFIG_DIR, 'ranking-cache.json');
const DEFAULT_ACTIVE = { cn: 'glm-5.3-flash', ai: 'glm-5.3' };

function ensureConfigDir() { try { fs.mkdirSync(WB_CONFIG_DIR, { recursive: true }); } catch {} }

function trayIconPath() {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets')
    : path.join(__dirname, 'assets');
  return path.join(dir, 'tray.png');
}
function loadTrayIcon() {
  const file = trayIconPath();
  if (fs.existsSync(file)) { try { return nativeImage.createFromPath(file); } catch {} }
  return nativeImage.createEmpty();
}

function logPath(flavor) {
  const dir = app.isPackaged ? path.join(app.getPath('userData'), 'logs') : path.join(ROOT, flavor);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return path.join(dir, flavor + '-proxy.log');
}

function startInst(inst) {
  if (procs.has(inst.key)) return { ok: true, msg: 'already running' };
  const script = path.resolve(__dirname, inst.script);
  // 打包后 script 在 asar 包内:cwd 不能指向包内目录,用 userData 实目录;
  // 子进程用 Electron 自身以纯 Node 模式运行脚本(绿色版无系统 node 也可用)
  const cwd = app.isPackaged ? app.getPath('userData') : path.dirname(script);
  try { fs.mkdirSync(cwd, { recursive: true }); } catch {}
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(inst.port),
    WB_VARIANT: inst.variant === 'ai' ? 'ai' : '',
  };
  const child = spawn(process.execPath, [script], { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.set(inst.key, child);
  const log = fs.createWriteStream(logPath(inst.flavor), { flags: 'a' });
  child.stdout.on('data', d => log.write(d));
  child.stderr.on('data', d => log.write(d));
  child.on('exit', () => { procs.delete(inst.key); if (tray) tray.setContextMenu(buildMenu()); sendStatus(); });
  if (tray) tray.setContextMenu(buildMenu());
  return { ok: true, pid: child.pid };
}

function stopInst(key) {
  const child = procs.get(key);
  if (!child) return { ok: true, msg: 'not running' };
  child.kill();
  procs.delete(key);
  if (tray) tray.setContextMenu(buildMenu());
  return { ok: true };
}

function healthCheck(port) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 2000 }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ ok: res.statusCode === 200 }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.on('error', () => resolve({ ok: false }));
  });
}

async function collectStatus() {
  const out = [];
  for (const i of INSTANCES) {
    const h = await healthCheck(i.port);
    out.push({ ...i, running: h.ok || procs.has(i.key), pid: procs.get(i.key)?.pid || null });
  }
  return out;
}

function sendStatus() {
  if (!win || win.isDestroyed()) return;
  collectStatus().then(s => win.webContents.send('status', s));
}

function buildMenu() {
  const items = INSTANCES.map(i => ({
    label: `${procs.has(i.key) ? '●' : '○'} ${i.key} (:${i.port})`,
    click: () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } },
  }));
  items.push({ type: 'separator' });
  items.push({ label: '显示面板', click: () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } } });
  items.push({ label: '退出', click: () => { for (const k of [...procs.keys()]) stopInst(k); app.quit(); } });
  return Menu.buildFromTemplate(items);
}

function createWindow() {
  win = new BrowserWindow({
    width: 900, height: 700, title: 'WB代理管理器',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('close', e => { if (!app.quitting) { e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  createWindow();
  tray = new Tray(loadTrayIcon());
  tray.setToolTip('WB代理管理器');
  tray.setContextMenu(buildMenu());
  tray.on('click', () => { if (win) { win.show(); win.focus(); } });
  // 默认拉起 codex-cn
  startInst(INSTANCES[0]);
  setInterval(sendStatus, 3000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { app.quitting = true; });
app.on('window-all-closed', () => { /* 托盘常驻,不退出 */ });

ipcMain.handle('status', () => collectStatus());
ipcMain.handle('start', (e, key) => { const i = INSTANCES.find(x => x.key === key); return i ? startInst(i) : { ok: false }; });
ipcMain.handle('stop', (e, key) => stopInst(key));
async function loadWbCore() {
  const corePath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'vendor', 'wbcore.mjs').replace(/\\/g, '/')
    : path.join(ROOT, 'wbcore.mjs').replace(/\\/g, '/');
  return import('file:///' + corePath.replace(/^([A-Za-z]:)/, m => m.toLowerCase()));
}

ipcMain.handle('credits', async () => {
  try {
    const mod = await loadWbCore();
    const out = {};
    for (const v of ['cn', 'ai']) {
      try { const c = await mod.loadCredential(v); out[v] = await mod.fetchCredits(c); }
      catch (e) { out[v] = { error: String(e.message || e).slice(0, 120) }; }
    }
    return out;
  } catch (e) { return { error: String(e.message || e).slice(0, 200) }; }
});

ipcMain.handle('models', async () => {
  try {
    const mod = await loadWbCore();
    const out = {};
    for (const v of ['cn', 'ai']) {
      try {
        const c = await mod.loadCredential(v);
        const ms = await mod.fetchModels(c);
        const items = ms.map(m => ({ id: m.id, name: m.name, mult: (typeof m.multiplier === 'number' ? m.multiplier : null), creditsRaw: m.creditsRaw || null }));
        // 限时免费（试用）变体：来自 /v3/config 的 ModelTrialBanner，例如 hy4-preview-f → 付费模型 hy4-preview
        let trials = [];
        try { trials = await mod.fetchTrialBanners(c); } catch {}
        for (const t of (trials || [])) {
          if (!t || !t.modelId || items.some(x => x.id === t.modelId)) continue;
          const target = items.find(x => x.id === t.targetModelId);
          items.push({
            id: t.modelId,
            name: (target ? target.name : (t.targetModelId || t.modelId)) + '（限时免费）',
            mult: 0,
            creditsRaw: 'x0.00',
            trial: true,
            trialDays: t.trialDays || 0,
            targetId: t.targetModelId || '',
          });
        }
        out[v] = items;
      } catch (e) { out[v] = { error: String(e.message || e).slice(0, 160) }; }
    }
    return out;
  } catch (e) { return { error: String(e.message || e).slice(0, 200) }; }
});

// 聚合所有代理写入的用量日志（彼此都在 ~/.codex-workbuddy-proxy/usage.log）
// from/to 为毫秒时间戳；0 或 undefined 表示不限
function readUsageLogs(from, to) {
  const rows = {};
  for (const d of ['.codex-workbuddy-proxy', '.zcode-workbuddy-proxy']) {
    const p = path.join(os.homedir(), d, 'usage.log');
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const ln of lines) {
      try {
        const r = JSON.parse(ln);
        const t = Number(r.t) || 0;
        if (from && t && t < from) continue;
        if (to && t && t > to) continue;
        const id = r.model || 'unknown';
        if (!rows[id]) rows[id] = { model: id, count: 0, in: 0, out: 0 };
        rows[id].count++; rows[id].in += Number(r.in) || 0; rows[id].out += Number(r.out) || 0;
      } catch {}
    }
  }
  return rows;
}

// 倍率表缓存 60 秒（daily/usage 都要用，避免重复打上游）
let _multCache = { t: 0, map: {} };
async function getMultMap() {
  if (Date.now() - _multCache.t < 60000 && Object.keys(_multCache.map).length) return _multCache.map;
  const mult = {};
  try {
    const mod = await loadWbCore();
    for (const v of ['cn', 'ai']) {
      try {
        const c = await mod.loadCredential(v);
        const ms = await mod.fetchModels(c);
        for (const m of ms) if (typeof m.multiplier === 'number') mult[m.id] = m.multiplier;
      } catch {}
    }
  } catch {}
  _multCache = { t: Date.now(), map: mult };
  return mult;
}

const normRange = r => ({
  from: r && r.from ? Number(r.from) : 0,
  to: r && r.to ? Number(r.to) : 0,
});

ipcMain.handle('usage', async (e, range) => {
  try {
    const { from, to } = normRange(range);
    const mult = await getMultMap();
    const rows = readUsageLogs(from, to);
    const arr = Object.values(rows).map(r => {
      const m = mult[r.model];
      const est = (typeof m === 'number') ? (r.in + r.out) / 1000 * m : null;
      return { ...r, mult: (typeof m === 'number' ? m : null), estCredits: est };
    }).sort((a, b) => (b.out - a.out) || (b.in - a.in));
    const totalCredits = arr.reduce((s, r) => s + (r.estCredits || 0), 0);
    const unknown = arr.filter(r => r.estCredits === null).length;
    return {
      rows: arr,
      totalIn: arr.reduce((s, r) => s + r.in, 0),
      totalOut: arr.reduce((s, r) => s + r.out, 0),
      totalCount: arr.reduce((s, r) => s + r.count, 0),
      totalCredits,
      unknownMult: unknown,
      mult,
    };
  } catch (e) { return { error: String(e.message || e).slice(0, 200) }; }
});

// 按天聚合：用于历史柱状图
ipcMain.handle('daily', async (e, range) => {
  try {
    const { from, to } = normRange(range);
    const mult = await getMultMap();
    const byDay = {};
    for (const d of ['.codex-workbuddy-proxy', '.zcode-workbuddy-proxy']) {
      const p = path.join(os.homedir(), d, 'usage.log');
      if (!fs.existsSync(p)) continue;
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const ln of lines) {
        try {
          const r = JSON.parse(ln);
          const t = Number(r.t) || 0;
          if (!t) continue;
          if (from && t < from) continue;
          if (to && t > to) continue;
          const dt = new Date(t);
          const day = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
          if (!byDay[day]) byDay[day] = { day, count: 0, in: 0, out: 0, credits: 0 };
          const i = Number(r.in) || 0, o = Number(r.out) || 0;
          byDay[day].count++; byDay[day].in += i; byDay[day].out += o;
          const m = mult[r.model || ''];
          if (typeof m === 'number') byDay[day].credits += (i + o) / 1000 * m;
        } catch {}
      }
    }
    const days = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
    return { days, totalCredits: days.reduce((s, d) => s + d.credits, 0), totalIn: days.reduce((s, d) => s + d.in, 0), totalOut: days.reduce((s, d) => s + d.out, 0), totalCount: days.reduce((s, d) => s + d.count, 0) };
  } catch (e) { return { error: String(e.message || e).slice(0, 200) }; }
});
ipcMain.handle('log', (e, flavor) => {
  try {
    const p = logPath(flavor);
    if (!fs.existsSync(p)) return '(无日志)';
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-60).join('\n');
  } catch { return '(无法读取日志)'; }
});

ipcMain.handle('getActive', () => {
  try { return { ...DEFAULT_ACTIVE, ...JSON.parse(fs.readFileSync(ACTIVE_MODEL_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_ACTIVE }; }
});

ipcMain.handle('setActive', (e, variant, modelId) => {
  try {
    ensureConfigDir();
    const cur = (() => { try { return JSON.parse(fs.readFileSync(ACTIVE_MODEL_FILE, 'utf8')); } catch { return {}; } })();
    cur[variant] = modelId;
    fs.writeFileSync(ACTIVE_MODEL_FILE, JSON.stringify(cur, null, 2), 'utf8');
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err.message || err).slice(0, 120) }; }
});

ipcMain.handle('limits', () => {
  const p = path.join(WB_CONFIG_DIR, 'limits.log');
  const out = {};
  if (!fs.existsSync(p)) return out;
  const now = Date.now(), CUT = 24 * 60 * 60 * 1000; // 24 小时内出现过限额即标记
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const ln of lines) {
    try {
      const r = JSON.parse(ln);
      if (!r.t || !r.model) continue;
      if (now - r.t > CUT) continue;
      if (r.kind !== 'soft_rate' && r.kind !== 'hard_credit' && r.kind !== 'probe') continue;
      // 保留最近一次
      if (!out[r.model] || r.t > out[r.model].t) out[r.model] = { t: r.t, kind: r.kind };
    } catch {}
  }
  return out;
});

// 手动探测：对每个模型发一条极小请求，把被限额的写入 limits.log
ipcMain.handle('probeLimits', async (e, variant) => {
  try {
    const mod = await loadWbCore();
    const c = await mod.loadCredential(variant);
    const ms = await mod.fetchModels(c);
    let trials = [];
    try { trials = await mod.fetchTrialBanners(c); } catch {}
    const ids = ms.map(m => m.id);
    for (const t of (trials || [])) if (t && t.modelId && !ids.includes(t.modelId)) ids.push(t.modelId);
    ensureConfigDir();
    const p = path.join(WB_CONFIG_DIR, 'limits.log');
    const results = {};
    for (const id of ids) {
      const r = await mod.probeModel(c, id);
      results[id] = r;
      if (!r.ok && (r.kind === 'soft_rate' || r.kind === 'hard_credit')) {
        try { fs.appendFileSync(p, JSON.stringify({ t: Date.now(), model: id, kind: r.kind, via: 'probe' }) + '\n'); } catch {}
      }
      await new Promise(r2 => setTimeout(r2, 150));
    }
    return { ok: true, results };
  } catch (e2) { return { ok: false, error: String(e2.message || e2).slice(0, 200) }; }
});

const RANK_TTL_MS = 6 * 60 * 60 * 1000;
const FAMILY_ALIASES = { hy: 'hunyuan', hy3: 'hunyuan', hy4: 'hunyuan', hunyuan: 'hunyuan', deepseek: 'deepseek', kimi: 'kimi', glm: 'glm', qwen: 'qwen', minimax: 'minimax', abab: 'minimax', gpt: 'gpt', gemini: 'gemini', claude: 'claude', grok: 'grok', doubao: 'doubao', yi: 'yi', mistral: 'mistral', llama: 'llama', ernie: 'ernie', step: 'step' };
function familyOf(name) {
  if (!name) return null;
  const parts = String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  for (const tok of parts) {
    const base = tok.replace(/[0-9.]/g, '');
    if (FAMILY_ALIASES[tok]) return FAMILY_ALIASES[tok];
    if (base && FAMILY_ALIASES[base]) return FAMILY_ALIASES[base];
  }
  for (const tok of parts) { if (/[a-z]/.test(tok)) return tok.replace(/[0-9.]/g, ''); }
  return null;
}
const CURATED_RANK = {
  gpt: { rank: 1, score: 1408, name: 'GPT-5 family' },
  gemini: { rank: 2, score: 1385, name: 'Gemini 2.5 family' },
  claude: { rank: 3, score: 1375, name: 'Claude 3.5/4 family' },
  grok: { rank: 4, score: 1350, name: 'Grok family' },
  deepseek: { rank: 8, score: 1312, name: 'DeepSeek-V3/V4 family' },
  qwen: { rank: 10, score: 1290, name: 'Qwen3 family' },
  kimi: { rank: 12, score: 1275, name: 'Kimi K2/K3 family' },
  glm: { rank: 14, score: 1260, name: 'GLM-5 family' },
  hunyuan: { rank: 16, score: 1245, name: 'Hunyuan family' },
  minimax: { rank: 18, score: 1230, name: 'MiniMax family' },
  doubao: { rank: 20, score: 1210, name: 'Doubao family' },
  yi: { rank: 22, score: 1200, name: 'Yi family' },
  llama: { rank: 24, score: 1190, name: 'Llama 4 family' },
  ernie: { rank: 26, score: 1178, name: 'Ernie family' },
  mistral: { rank: 28, score: 1170, name: 'Mistral family' },
  step: { rank: 30, score: 1160, name: 'Step family' },
};
async function getRanking(force = false) {
  const now = Date.now();
  try {
    const cached = JSON.parse(fs.readFileSync(RANK_CACHE_FILE, 'utf8'));
    if (!force && cached.fetchedAt && now - cached.fetchedAt < RANK_TTL_MS) return cached;
  } catch {}
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch('https://api.wulong.dev/arena-ai-leaderboards/v1/leaderboard?name=text', { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(to);
    if (res.ok) {
      const doc = await res.json();
      const map = {};
      for (const m of (doc.models || [])) {
        const fam = familyOf(m.model);
        if (!fam) continue;
        const rank = Number(m.rank), score = Number(m.score);
        if (!map[fam] || (Number.isFinite(rank) && rank < map[fam].rank)) {
          map[fam] = { rank: Number.isFinite(rank) ? rank : 999, score: Number.isFinite(score) ? score : 0, name: m.model };
        }
      }
      const result = { source: 'LMArena 每日快照 (api.wulong.dev)', fetchedAt: now, map };
      try { fs.mkdirSync(path.dirname(RANK_CACHE_FILE), { recursive: true }); fs.writeFileSync(RANK_CACHE_FILE, JSON.stringify(result)); } catch {}
      return result;
    }
  } catch {}
  try {
    const cached = JSON.parse(fs.readFileSync(RANK_CACHE_FILE, 'utf8'));
    if (cached) return cached;
  } catch {}
  return { source: '内置 LMArena 快照（离线）', fetchedAt: now, map: CURATED_RANK };
}
ipcMain.handle('ranking', () => getRanking(false));
