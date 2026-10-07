// WorkBuddy Proxy - 图形管理面板 (零依赖, 纯 Node.js 内置模块)
// 管理 codex / zcode 的 cn / ai 四个代理实例: start / stop / status / health / log
// 并提供 DSH / 任意 OpenAI 兼容客户端的接入配置。
//
// 用法:
//   node gui.mjs            # 默认监听 127.0.0.1:8500, 并自动打开浏览器
//   node gui.mjs --no-open  # 不自动打开浏览器
//   node gui.mjs --port 8600
//
// 注意: 本面板只是调用仓库自带的 proxy.ps1, 与在 PowerShell 里手动跑等价。
// 不要在 WorkBuddy / DSH 会话内部启动代理(会拿到受限令牌), 用本面板(独立进程)即可。

import { createServer, get } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;                 // gui.mjs 放在仓库根目录, 与 codex/ zcode/ 同级
const HTML_PAGE = readFileSync(join(REPO_ROOT, 'gui.html'), 'utf8');
const GUI_PORT = Number(process.env.GUI_PORT || (process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8500));
const AUTO_OPEN = !process.argv.includes('--no-open');
const CONFIG_FILE = join(REPO_ROOT, 'gui-config.json');

// --- 四个代理实例定义 ---
const INSTANCES = [
  { key: 'codex-cn', flavor: 'codex', variant: 'cn', port: 8401,
    proto: 'OpenAI Responses + Chat Completions', url: 'http://127.0.0.1:8401/v1',
    ps1: 'codex/proxy.ps1', dshHint: 'DSH / OpenAI 兼容客户端首选' },
  { key: 'zcode-cn', flavor: 'zcode', variant: 'cn', port: 8400,
    proto: 'Anthropic Messages', url: 'http://127.0.0.1:8400',
    ps1: 'zcode/proxy.ps1', dshHint: 'ZCode / Claude 兼容客户端' },
  { key: 'codex-ai', flavor: 'codex', variant: 'ai', port: 8403,
    proto: 'OpenAI Responses + Chat Completions', url: 'http://127.0.0.1:8403/v1',
    ps1: 'codex/proxy.ps1', dshHint: '国际版 WorkBuddy AI' },
  { key: 'zcode-ai', flavor: 'zcode', variant: 'ai', port: 8402,
    proto: 'Anthropic Messages', url: 'http://127.0.0.1:8402',
    ps1: 'zcode/proxy.ps1', dshHint: '国际版 WorkBuddy AI / ZCode' },
];

// --- 配置(记录哪些实例随面板启动自动拉起) ---
async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf8');
    const c = JSON.parse(raw);
    if (!Array.isArray(c.autostart)) c.autostart = ['codex-cn'];
    return c;
  } catch {
    return { autostart: ['codex-cn'] };
  }
}
async function saveConfig(c) {
  await writeFile(CONFIG_FILE, JSON.stringify(c, null, 2), 'utf8');
}

// --- 调用 proxy.ps1 ---
function ps1Path(inst) { return resolve(REPO_ROOT, inst.ps1); }

function runProxy(inst, action) {
  return new Promise((resolveRes, reject) => {
    const ps1 = ps1Path(inst);
    if (!existsSync(ps1)) { reject(new Error('找不到 ' + inst.ps1 + ' (请在仓库根目录运行本面板)')); return; }
    const env = { ...process.env };
    if (inst.variant === 'ai') env.WB_VARIANT = 'ai'; else env.WB_VARIANT = '';
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, action], {
      env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => reject(e));
    child.on('close', code => {
      if (code === 0) resolveRes({ ok: true, out: out.trim() });
      else reject(new Error((err || out || 'exit ' + code).trim()));
    });
  });
}

// --- 健康检查 ---
function healthCheck(port) {
  return new Promise(resolveRes => {
    const req = get({ host: '127.0.0.1', port, path: '/healthz', timeout: 2500 }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolveRes({ ok: res.statusCode === 200, body: body.trim(), code: res.statusCode }));
    });
    req.on('timeout', () => { req.destroy(); resolveRes({ ok: false, body: 'timeout' }); });
    req.on('error', () => resolveRes({ ok: false, body: 'not listening' }));
  });
}

// --- 读取日志尾部 ---
async function tailLog(flavor, lines = 60) {
  const logPath = join(REPO_ROOT, flavor, 'proxy.log');
  if (!existsSync(logPath)) return '(无日志)';
  try {
    const buf = await readFile(logPath, 'utf8');
    const arr = buf.split(/\r?\n/).filter(Boolean);
    return arr.slice(-lines).join('\n');
  } catch { return '(无法读取日志)'; }
}

// --- 启动时的自动拉起 ---
async function autoStart() {
  const cfg = await loadConfig();
  for (const key of cfg.autostart || []) {
    const inst = INSTANCES.find(i => i.key === key);
    if (!inst) continue;
    const h = await healthCheck(inst.port);
    if (!h.ok) {
      try { await runProxy(inst, 'start'); } catch (e) { /* 忽略, UI 会显示状态 */ }
    }
  }
}

// --- HTTP 服务 ---
const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const setJson = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

  try {
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML_PAGE);
      return;
    }

    if (url === '/api/status' && req.method === 'GET') {
      const cfg = await loadConfig();
      const result = [];
      for (const inst of INSTANCES) {
        const h = await healthCheck(inst.port);
        result.push({ key: inst.key, flavor: inst.flavor, variant: inst.variant, port: inst.port,
          proto: inst.proto, url: inst.url, dshHint: inst.dshHint, running: h.ok, health: h.body });
      }
      setJson(200, { instances: result, autostart: cfg.autostart });
      return;
    }

    if (url === '/api/start' && req.method === 'POST') {
      const { key } = await readJson(req);
      const inst = INSTANCES.find(i => i.key === key);
      if (!inst) return setJson(400, { error: 'unknown key' });
      const r = await runProxy(inst, 'start');
      await sleep(1200);
      const h = await healthCheck(inst.port);
      setJson(200, { ok: true, start: r.out, running: h.ok, health: h.body });
      return;
    }

    if (url === '/api/stop' && req.method === 'POST') {
      const { key } = await readJson(req);
      const inst = INSTANCES.find(i => i.key === key);
      if (!inst) return setJson(400, { error: 'unknown key' });
      const r = await runProxy(inst, 'stop');
      setJson(200, { ok: true, stop: r.out });
      return;
    }

    if (url === '/api/log' && req.method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const flavor = u.searchParams.get('flavor') || 'codex';
      setJson(200, { log: await tailLog(flavor) });
      return;
    }

    if (url === '/api/config' && req.method === 'POST') {
      const body = await readJson(req);
      const cfg = await loadConfig();
      if (Array.isArray(body.autostart)) cfg.autostart = body.autostart;
      await saveConfig(cfg);
      setJson(200, { ok: true, autostart: cfg.autostart });
      return;
    }

    setJson(404, { error: 'not found' });
  } catch (e) {
    setJson(500, { error: String(e && e.message || e) });
  }
});

function readJson(req) {
  return new Promise((resolveRes, reject) => {
    let data = '';
    req.on('data', d => data += d);
    req.on('end', () => { try { resolveRes(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- 启动 ---
server.listen(GUI_PORT, '127.0.0.1', async () => {
  console.log(`[gui] WorkBuddy Proxy 管理面板: http://127.0.0.1:${GUI_PORT}`);
  await autoStart();
  if (AUTO_OPEN) openBrowser(`http://127.0.0.1:${GUI_PORT}`);
});

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  cmd.on('error', () => {});
}
