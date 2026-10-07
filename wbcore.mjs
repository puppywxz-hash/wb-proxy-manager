// wbcore.mjs — WorkBuddy 凭据解密 + 积分/模型倍率查询（零依赖）
// 解密算法参照 dingminhua/dsh-connect-workbuddy src/at-rest.ts（MIT）
import { execFile } from 'node:child_process';
import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';

const CN_CHAT_BASE = 'https://copilot.tencent.com';
const CN_BILLING_BASE = 'https://www.codebuddy.cn';
const GLOBAL_BASE = 'https://www.workbuddy.ai';
const CLIENT_UA = 'CLI/2.63.2 CodeBuddy/2.63.2';
const T = 30000;

export function authFile(variant = 'cn') {
  const name = variant === 'ai' ? 'workbuddy-desktop-ai.info' : 'workbuddy-desktop.info';
  return join(homedir(), 'AppData', 'Local', 'CodeBuddyExtension', 'Data', 'Public', 'auth', name);
}

export function findApp() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const c = [process.env.WORKBUDDY_APP_EXECUTABLE,
    win32.join(local, 'Programs', 'WorkBuddy', 'WorkBuddy.exe'),
    win32.join(local, 'WorkBuddy', 'WorkBuddy.exe'),
    process.env.ProgramFiles && win32.join(process.env.ProgramFiles, 'WorkBuddy', 'WorkBuddy.exe')];
  return c.find(p => p && existsSync(p));
}

let cachedKey;
function fetchPayload(exe) {
  return new Promise((res, rej) => {
    const src = "try{process.stdout.write(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet())}catch(e){process.exitCode=3;process.stderr.write(String(e&&e.message||e))}";
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    execFile(exe, ['-e', src], { env, timeout: 15000, windowsHide: true, maxBuffer: 1 << 20 },
      (err, out, se) => err ? rej(new Error('取密钥失败: ' + (se || err.message))) : res(out.trim()));
  });
}
export async function atRestKey() {
  if (cachedKey) return cachedKey;
  const exe = findApp();
  if (!exe) throw new Error('未找到 WorkBuddy.exe');
  const payload = JSON.parse(await fetchPayload(exe));
  if (!payload.atRestSecretKey) throw new Error('载荷无 atRestSecretKey');
  cachedKey = createHash('sha256').update(payload.atRestSecretKey, 'utf8').digest();
  return cachedKey;
}

const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const lp = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([u32(b.length), b]); };
function fieldAad(keyId, suite) {
  return Buffer.concat([Buffer.from('WB-AAD\0', 'ascii'), Buffer.from([1]), lp('WBEV1'), lp('sym-v1'),
    u32(suite), lp(keyId), Buffer.from([2]), Buffer.from([0]), Buffer.from([0])]);
}
const isEnc = v => v && typeof v === 'object' && v.$wbEncrypted === 1 && typeof v.envelope === 'string';
export function openField(field, key) {
  const env = JSON.parse(Buffer.from(field.envelope, 'base64').toString('utf8'));
  const kid = createHash('sha256').update(key).digest('hex').slice(0, 16);
  if (env.keyId !== kid) throw new Error('keyId 不匹配');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(env.nonce, 'base64'));
  d.setAAD(fieldAad(env.keyId, env.suite));
  d.setAuthTag(Buffer.from(env.authTag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(env.ciphertext, 'base64')), d.final()]).toString('utf8');
}
const dec = (v, key) => {
  if (typeof v === 'string') return v;
  if (isEnc(v) && key) { try { return openField(v, key); } catch { return undefined; } }
  return undefined;
};

export async function loadCredential(variant = 'cn') {
  const key = await atRestKey();
  const doc = JSON.parse(readFileSync(authFile(variant), 'utf8'));
  const auth = doc.auth || doc;
  const acct = doc.account || {};
  const accessToken = dec(auth.accessToken, key);
  if (!accessToken) throw new Error('无法解密 accessToken');
  return {
    accessToken,
    refreshToken: dec(auth.refreshToken, key) || '',
    domain: dec(auth.domain, key) || auth.domain || '',
    uid: dec(acct.uid, key) || acct.uid || '',
    enterpriseId: dec(acct.enterpriseId, key) || undefined,
    nickname: dec(acct.nickname, key) || undefined,
    expiresAtMs: typeof auth.expiresAt === 'number' ? auth.expiresAt : 0,
  };
}

const regionOf = domain => {
  const d = String(domain || '').trim().toLowerCase();
  if (d === 'workbuddy.ai' || d.endsWith('.workbuddy.ai')) return 'global';
  if (d === 'codebuddy.ai' || d.endsWith('.codebuddy.ai')) return 'global';
  return 'cn';
};
const chatBase = c => regionOf(c.domain) === 'global' ? 'https://www.workbuddy.ai' : CN_CHAT_BASE;
const billBase = c => regionOf(c.domain) === 'global' ? 'https://www.workbuddy.ai' : CN_BILLING_BASE;
const billingHeaders = c => ({
  Authorization: 'Bearer ' + c.accessToken,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  ...(c.uid ? { 'X-User-Id': c.uid } : {}),
  ...(c.enterpriseId ? { 'X-Enterprise-Id': c.enterpriseId, 'X-Tenant-Id': c.enterpriseId } : {}),
  ...(c.domain ? { 'X-Domain': c.domain } : {}),
});
async function readEnv(res) {
  const t = await res.text();
  let doc;
  try { doc = JSON.parse(t); } catch { throw new Error('上游非 JSON (http ' + res.status + '): ' + t.slice(0, 160)); }
  if (!res.ok || (typeof doc.code === 'number' && doc.code !== 0))
    throw new Error('上游错误 http=' + res.status + ' code=' + doc.code + ' msg=' + (doc.msg || '').slice(0, 200));
  return doc.data;
}

export async function fetchCredits(c) {
  const now = new Date();
  const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
  const res = await fetch(billBase(c) + '/v2/billing/meter/get-user-resource', {
    method: 'POST', headers: billingHeaders(c),
    body: JSON.stringify({ PageNumber: 1, PageSize: 100, ProductCode: 'p_tcaca', Status: [0, 3], PackageEndTimeRangeBegin: fmt(now), PackageEndTimeRangeEnd: fmt(new Date(now.getTime() + 365 * 101 * 24 * 3600 * 1000)) }),
    signal: AbortSignal.timeout(T),
  });
  const data = await readEnv(res);
  const inner = (data && data.Response && data.Response.Data) || {};
  const accts = Array.isArray(inner.Accounts) ? inner.Accounts : [];
  let total = 0;
  const packages = [];
  for (const a of accts) {
    const monthly = a.CapacityType === 4;
    const size = monthly ? (a.CycleCapacitySize || 0) : (a.CapacitySize || 0);
    const remain = monthly ? (a.CycleCapacityRemain || 0) : (a.CapacityRemain || 0);
    const r = remain < 0 ? 0 : remain;
    const exp = !monthly ? (a.ExpiredTime || a.CycleEndTime) : undefined;
    if (!monthly && r <= 0) continue;
    total += r;
    packages.push({ packageName: a.PackageName || '(unnamed)', remain: r, size, monthly, ...(exp ? { expiresAt: exp } : {}) });
  }
  return { total, packages };
}

const parseMult = v => {
  if (typeof v !== 'string') return undefined;
  const m = /x\s*([0-9]*\.?[0-9]+)/iu.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export async function fetchModels(c) {
  const ctrl = AbortSignal.timeout(T);
  const tryPath = async (base, path, ua) => {
    const res = await fetch(base + path, {
      headers: { Authorization: 'Bearer ' + c.accessToken, Accept: 'application/json', Origin: billBase(c), Referer: billBase(c) + '/', 'User-Agent': ua },
      signal: ctrl,
    });
    const data = await readEnv(res);
    return data || {};
  };
  let data;
  try {
    data = await tryPath(chatBase(c), '/v3/config', CLIENT_UA);
  } catch {
    data = await tryPath(chatBase(c), '/v2/enterprises/personal/models', CLIENT_UA);
  }
  const rawModels = Array.isArray(data.models) ? data.models : [];
  let cliIds;
  for (const a of (Array.isArray(data.agents) ? data.agents : [])) {
    if (a && a.name === 'cli' && Array.isArray(a.models)) { cliIds = a.models.filter(x => typeof x === 'string'); break; }
  }
  const byId = new Map();
  for (const m of rawModels) {
    if (!m || typeof m.id !== 'string' || !m.id || m.disabled === true) continue;
    if (!(m.maxInputTokens > 0) || !(m.maxOutputTokens > 0)) continue;
    byId.set(m.id, {
      id: m.id, name: m.name || m.id,
      multiplier: parseMult(m.credits),
      creditsRaw: typeof m.credits === 'string' ? m.credits : undefined,
    });
  }
  const ids = (cliIds && cliIds.length) ? cliIds : [...byId.keys()];
  return ids.map(id => byId.get(id)).filter(Boolean);
}