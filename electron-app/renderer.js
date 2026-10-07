function cardHTML(i) {
  const regionTag = i.variant === 'cn' ? '🇨🇳 国内版' : '🌍 国际版';
  return `<span class="tag">${i.proto}</span>
    <h3><span class="dot ${i.running ? 'on' : 'off'}"></span>${i.name} <small>:${i.port}</small></h3>
    <div class="url"><code>${i.url}</code></div>
    <div class="region">${regionTag}</div>
    <div class="clients">${(i.clients || []).map(c => `<div>· ${c}</div>`).join('')}</div>
    <div class="row">
      <button data-a="start" data-k="${i.key}" ${i.running ? 'disabled' : ''}>启动</button>
      <button data-a="stop" data-k="${i.key}" ${i.running ? '' : 'disabled'}>停止</button>
    </div>`;
}

function renderGroup(elId, list) {
  const wrap = document.getElementById(elId);
  wrap.innerHTML = '';
  list.forEach(i => {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.key = i.key;
    el.innerHTML = cardHTML(i);
    wrap.appendChild(el);
  });
  wrap.querySelectorAll('button').forEach(b => b.onclick = async () => {
    if (b.dataset.a === 'start') await window.wb.start(b.dataset.k);
    else await window.wb.stop(b.dataset.k);
    setTimeout(refresh, 800);
  });
}

async function refresh() {
  const list = await window.wb.status();
  renderGroup('cards-openai', list.filter(i => i.protoGroup === 'openai'));
  renderGroup('cards-anthropic', list.filter(i => i.protoGroup === 'anthropic'));
}

// 积分余额（国内/国际）
document.getElementById('creditBtn').onclick = async () => {
  const box = document.getElementById('credits');
  box.textContent = '查询中…';
  const r = await window.wb.credits();
  if (r.error) { box.textContent = '失败: ' + r.error; return; }
  box.innerHTML = [['cn', '🇨🇳 国内版'], ['ai', '🌍 国际版']].map(([v, label]) => {
    const c = r[v];
    if (!c || c.error) return `<div><b>${label}</b>: ${c ? c.error : '无数据'}</div>`;
    const pkgs = (c.packages || []);
    const bars = pkgs.map(p => {
      const pct = p.size ? Math.min(100, Math.round(p.remain / p.size * 100)) : 0;
      const usedPct = 100 - pct;
      const exp = p.expiresAt ? ` · 到期 ${String(p.expiresAt).slice(0, 10)}` : (p.monthly ? ' · 每月重置' : '');
      return `<div class="pkg">
        <div class="pkg-head"><span>${p.packageName}</span><span class="num">剩 ${p.remain}/${p.size}${p.monthly ? '(月)' : ''}</span></div>
        <div class="pkg-bar"><i style="width:${usedPct}%"></i></div>
        <div class="pkg-note">已用 ${usedPct}%${exp}</div>
      </div>`;
    }).join('');
    const hiddenNote = c.hidden ? `<div class="hint">已隐藏 ${c.hidden} 个额度耗尽的包</div>` : '';
    return `<div><b>${label}</b>: 总剩 <b>${c.total}</b>${bars || '<div class="hint">（无剩余额度包）</div>'}${hiddenNote}</div>`;
  }).join('<hr>');
};

// ---------------- 模型目录：选择当前生效模型 + 实时排序 + 世界排名 + 限额 ----------------
const FAMILY_ALIASES = { hy: 'hunyuan', hy3: 'hunyuan', hy4: 'hunyuan', hunyuan: 'hunyuan', deepseek: 'deepseek', kimi: 'kimi', glm: 'glm', qwen: 'qwen', minimax: 'minimax', abab: 'minimax', gpt: 'gpt', gemini: 'gemini', claude: 'claude', grok: 'grok', doubao: 'doubao', yi: 'yi', mistral: 'mistral', llama: 'llama', ernie: 'ernie', step: 'step' };
function familyOf(name) {
  if (!name) return null;
  const parts = String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  for (const tok of parts) {
    if (FAMILY_ALIASES[tok]) return FAMILY_ALIASES[tok];
    const base = tok.replace(/[0-9.]/g, '');
    if (base && FAMILY_ALIASES[base]) return FAMILY_ALIASES[base];
  }
  for (const tok of parts) { if (/[a-z]/.test(tok)) return tok.replace(/[0-9.]/g, ''); }
  return null;
}

let lastRanking = null;
let activeModels = { cn: '', ai: '' };
let limitedModels = {};

document.getElementById('modelBtn').onclick = refreshModels;

document.getElementById('probeBtn').onclick = async () => {
  const btn = document.getElementById('probeBtn');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '检测中…';
  const msgs = [];
  try {
    for (const v of ['cn', 'ai']) {
      const res = await window.wb.probeLimits(v);
      if (!res || res.error) { msgs.push(`${v}: ${res && res.error ? res.error : '失败'}`); continue; }
      const limited = Object.entries(res.results || {}).filter(([, r]) => !r.ok).map(([id, r]) => `${id}(${r.status || r.kind})`);
      msgs.push(`${v}: 检测 ${Object.keys(res.results || {}).length} 个模型` + (limited.length ? `，受限 ${limited.length} 个 → ${limited.join(', ')}` : '，均可用'));
    }
    alert(msgs.join('\n'));
  } catch (e) { alert('检测失败: ' + (e.message || e)); }
  btn.disabled = false; btn.textContent = old;
  refreshModels();
};

function modelBadges(m, limited) {
  const badges = [];
  const lim = limited[m.id];
  if (m.trial) {
    const tip = `试用模型 ${m.id}（付费版 ${m.targetId || '?'}）· 试用 ${m.trialDays || '?'} 天\n风险：仅在上游规定的免费时段/试用期内免费，超期后该 ID 可能失效或按原模型倍率计费；一旦上游停止免费会返回 402/429 并打上「限额」标记。到期时间以 WorkBuddy 官方提示为准。`;
    badges.push(`<span class="badge trial" title="${tip}">限时免费${m.trialDays ? ' ' + m.trialDays + '天' : ''}</span>`);
  } else if (m.mult === 0) {
    badges.push('<span class="badge free" title="当前倍率为 0。注意：部分免费是分时段（如夜间/闲时）的，倍率会随上游调整变化，不保证全天有效。">免费</span>');
  }
  if (lim) {
    const t = lim.t ? new Date(lim.t) : null;
    const when = t ? String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') : '';
    const kindTxt = lim.kind === 'hard_credit' ? '额度用尽' : '限流';
    badges.push(`<span class="badge limited" title="最近一次 ${kindTxt}：${when}">限额 ${when}</span>`);
  }
  return badges.join(' ');
}

function rankCell(m, rankMap) {
  const fam = familyOf(m.id);
  const r = fam && rankMap ? rankMap[fam] : null;
  if (!r || !r.rank) return '<td class="num">—</td>';
  return `<td class="num" title="${r.source || 'LMArena'} · ${r.name || fam} · ELO ${r.score || '—'}">#${r.rank}</td>`;
}

function sortModels(list, limited, rankMap) {
  return [...list].sort((a, b) => {
    const aLim = limited[a.id] ? 1 : 0;
    const bLim = limited[b.id] ? 1 : 0;
    if (aLim !== bLim) return aLim - bLim; // 限额模型置底
    const aMult = (typeof a.mult === 'number') ? a.mult : Infinity;
    const bMult = (typeof b.mult === 'number') ? b.mult : Infinity;
    if (aMult !== bMult) return aMult - bMult; // 倍率从便宜→贵
    const ar = rankMap ? rankMap[familyOf(a.id)] : null;
    const br = rankMap ? rankMap[familyOf(b.id)] : null;
    const arank = ar && ar.rank ? ar.rank : Infinity;
    const brank = br && br.rank ? br.rank : Infinity;
    if (arank !== brank) return arank - brank; // 同倍率按世界排名更好者在前
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
}

function renderModelBlock(v, list, activeId, limited, rankMap, label) {
  if (!list) return `<div class="model-block"><b>${label}</b>: 无数据</div>`;
  if (list.error) return `<div class="model-block"><b>${label}</b>: ${list.error}</div>`;
  if (!list.length) return `<div class="model-block"><b>${label}</b>: 无可用模型</div>`;
  const sorted = sortModels(list, limited, rankMap);
  const rows = sorted.map(m => {
    const isActive = activeId === m.id;
    const multStr = m.mult === null ? '—' : (m.mult === 0 ? 'x0.00' : 'x' + m.mult);
    return `<tr class="${isActive ? 'active-row' : ''}">
      <td class="sel"><input type="radio" name="active-${v}" value="${m.id}" ${isActive ? 'checked' : ''} title="设为当前生效模型"></td>
      <td><b>${m.name}</b><br><code>${m.id}</code></td>
      <td class="num">${multStr}</td>
      ${rankCell(m, rankMap)}
      <td>${modelBadges(m, limited)}</td>
    </tr>`;
  }).join('');
  const active = sorted.find(m => m.id === activeId);
  const activeName = active ? `${active.name}（${active.id}）` : (activeId || '未选择');
  const activeWarn = active && active.trial
    ? ` <span class="badge trial" title="当前生效的是试用模型：仅在上游规定的免费时段/试用期内免费，超期后可能失效或按原模型倍率计费。">⚠️ 试用期内免费</span>`
    : '';
  return `<div class="model-block">
    <div class="model-head"><b>${label}</b> · 共 ${list.length} 个 · 当前生效：<code class="active-name">${activeName}</code>${activeWarn}</div>
    <div class="tbl-wrap"><table class="tbl model-tbl">
      <thead><tr><th>当前</th><th>模型</th><th>倍率</th><th>世界排名</th><th>状态</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

async function refreshModels() {
  const box = document.getElementById('models');
  box.innerHTML = '查询中…';
  try {
    const [r, active, limits, ranking] = await Promise.all([
      window.wb.models(),
      window.wb.getActive(),
      window.wb.limits(),
      window.wb.ranking().catch(() => null)
    ]);
    activeModels = active || {};
    limitedModels = limits || {};
    if (ranking && ranking.map) lastRanking = ranking;
    if (r.error) { box.textContent = '失败: ' + r.error; return; }
    const labels = { cn: '🇨🇳 国内版 WorkBuddy', ai: '🌍 国际版 WorkBuddy AI' };
    const parts = [];
    for (const v of ['cn', 'ai']) {
      parts.push(renderModelBlock(v, r[v], activeModels[v], limitedModels, lastRanking && lastRanking.map, labels[v]));
    }
    const src = lastRanking ? `<div class="hint">世界排名来源：${lastRanking.source} · 缓存时间：${new Date(lastRanking.fetchedAt).toLocaleString()}</div>` : '';
    box.innerHTML = parts.join('<hr>') + src;
    // 绑定选择事件
    box.querySelectorAll('input[type=radio]').forEach(radio => {
      radio.onchange = async () => {
        const variant = radio.name.replace('active-', '');
        const id = radio.value;
        const res = await window.wb.setActive(variant, id);
        if (res.error) { alert('设置失败: ' + res.error); return; }
        activeModels[variant] = id;
        refreshModels();
      };
    });
  } catch (e) {
    box.textContent = '失败: ' + (e.message || e);
  }
}

// ---------------- 时间范围工具 ----------------
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function rangeFromSelect(sel, fromEl, toEl) {
  const now = Date.now();
  const tod0 = startOfToday();
  switch (sel) {
    case 'today': return { from: tod0, to: 0, label: '今天 0:00 起' };
    case 'yesterday': return { from: tod0 - 86400000, to: tod0, label: '昨天 0:00–24:00' };
    case '7d': return { from: tod0 - 6 * 86400000, to: 0, label: '近 7 天' };
    case '30d': return { from: tod0 - 29 * 86400000, to: 0, label: '近 30 天' };
    case '90d': return { from: tod0 - 89 * 86400000, to: 0, label: '近 90 天' };
    case 'custom': {
      const f = fromEl && fromEl.value ? new Date(fromEl.value + 'T00:00:00').getTime() : 0;
      const t = toEl && toEl.value ? new Date(toEl.value + 'T23:59:59').getTime() : 0;
      return { from: f, to: t, label: (fromEl && fromEl.value ? fromEl.value : '不限') + ' ~ ' + (toEl && toEl.value ? toEl.value : '不限') };
    }
    default: return { from: 0, to: 0, label: '全部' };
  }
}
function bindRange(selectId, customId, onChange) {
  const sel = document.getElementById(selectId);
  const cust = document.getElementById(customId);
  const sync = () => { cust.style.display = sel.value === 'custom' ? 'inline-block' : 'none'; onChange(); };
  sel.onchange = sync;
  cust.querySelectorAll('input').forEach(i => i.onchange = onChange);
  return sync;
}

// ---------------- 各模型积分消耗 ----------------
document.getElementById('usageBtn').onclick = () => refreshUsage();
function usageRange() {
  return rangeFromSelect(
    document.getElementById('usageRange').value,
    document.getElementById('usageFrom'),
    document.getElementById('usageTo')
  );
}
async function refreshUsage() {
  const box = document.getElementById('usage');
  const rg = usageRange();
  document.getElementById('usageRangeNote').textContent = '（' + rg.label + '）';
  const r = await window.wb.usage({ from: rg.from, to: rg.to });
  if (r.error) { box.textContent = '失败: ' + r.error; return; }
  if (!r.rows || !r.rows.length) {
    box.innerHTML = `<div class="hint">该时间范围内暂无用量记录（${rg.label}）。启动代理并用 Codex / Claude Code / DSH 等客户端对话后，这里会实时显示每个模型消耗的 tokens 与积分。</div>`;
    return;
  }
  const rows = r.rows.map(x => `<tr>
    <td>${x.model}</td>
    <td class="num">${x.count}</td>
    <td class="num">${x.in.toLocaleString()}</td>
    <td class="num">${x.out.toLocaleString()}</td>
    <td class="num">${x.mult === null ? '—' : 'x' + x.mult}</td>
    <td class="num">${x.estCredits === null ? '—' : x.estCredits.toFixed(2)}</td>
  </tr>`).join('');
  const unknownNote = r.unknownMult ? `<br><b>注意</b>：${r.unknownMult} 个模型的倍率未在账号目录中找到（多为已下架/试用 ID），其估算积分按 0 计入合计，可能低估。` : '';
  box.innerHTML = `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>模型</th><th>请求数</th><th>输入tokens</th><th>输出tokens</th><th>倍率</th><th>估算积分</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td><b>合计</b></td>
      <td class="num"><b>${(r.totalCount || 0).toLocaleString()}</b></td>
      <td class="num"><b>${(r.totalIn || 0).toLocaleString()}</b></td>
      <td class="num"><b>${(r.totalOut || 0).toLocaleString()}</b></td>
      <td></td>
      <td class="num"><b>${(r.totalCredits || 0).toFixed(2)}</b></td>
    </tr></tfoot>
  </table></div>
  <div class="hint">估算积分 = (输入+输出)tokens ÷ 1000 × 倍率（参考：1 积分 ≈ 2000 输出 tokens）。WorkBuddy 实际计费可能有输入/输出差异化加权，数值仅供参考。${unknownNote}</div>`;
}

// ---------------- 历史每日消耗柱状图 ----------------
document.getElementById('dailyBtn').onclick = () => refreshDaily();
function dailyRange() {
  return rangeFromSelect(
    document.getElementById('dailyRange').value,
    document.getElementById('dailyFrom'),
    document.getElementById('dailyTo')
  );
}
function metricOf(d, metric) {
  if (metric === 'tokens') return d.in + d.out;
  if (metric === 'count') return d.count;
  return d.credits;
}
function fmtMetric(v, metric) {
  if (metric === 'tokens') return v >= 10000 ? (v / 1000).toFixed(1) + 'k' : String(v);
  if (metric === 'count') return String(v);
  return v >= 100 ? v.toFixed(0) : v.toFixed(2);
}
async function refreshDaily() {
  const box = document.getElementById('dailyChart');
  const rg = dailyRange();
  const metric = document.getElementById('dailyMetric').value;
  const r = await window.wb.daily({ from: rg.from, to: rg.to });
  if (r.error) { box.textContent = '失败: ' + r.error; return; }
  const days = r.days || [];
  if (!days.length) { box.innerHTML = `<div class="hint">该范围内暂无用量记录（${rg.label}）。</div>`; return; }
  const vals = days.map(d => metricOf(d, metric));
  const max = Math.max(...vals, 1);
  const unit = metric === 'credits' ? '积分' : (metric === 'tokens' ? 'tokens' : '次');
  const bars = days.map((d, i) => {
    const v = vals[i];
    const h = Math.max(v > 0 ? 3 : 0, Math.round(v / max * 100));
    const sub = metric === 'credits'
      ? `${((d.in + d.out) / 1000).toFixed(1)}k tk · ${d.count}次`
      : (metric === 'tokens' ? `${d.credits.toFixed(1)} 分 · ${d.count}次` : `${d.credits.toFixed(1)} 分 · ${((d.in + d.out) / 1000).toFixed(1)}k tk`);
    return `<div class="bar-col" title="${d.day}｜积分 ${d.credits.toFixed(2)}｜输入 ${d.in.toLocaleString()}｜输出 ${d.out.toLocaleString()}｜请求 ${d.count}">
      <div class="bar-val">${v > 0 ? fmtMetric(v, metric) : ''}</div>
      <div class="bar-track"><i class="bar-fill" style="height:${h}%"></i></div>
      <div class="bar-label">${d.day.slice(5)}</div>
      <div class="bar-sub">${sub}</div>
    </div>`;
  }).join('');
  const sumTxt = metric === 'credits'
    ? `合计 ${(r.totalCredits || 0).toFixed(2)} 积分`
    : (metric === 'tokens' ? `合计 ${((r.totalIn || 0) + (r.totalOut || 0)).toLocaleString()} tokens` : `合计 ${(r.totalCount || 0).toLocaleString()} 次请求`);
  box.innerHTML = `<div class="chart-head"><span>${rg.label} · ${days.length} 天 · ${sumTxt}</span><span class="grp-note">单位：${unit}</span></div>
    <div class="chart">${bars}</div>
    <div class="hint">柱状图按本机 <code>usage.log</code> 的自然日聚合（0:00–24:00）。估算积分 = 当日(输入+输出)tokens ÷ 1000 × 该模型倍率，仅供参考。</div>`;
}

bindRange('usageRange', 'usageCustom', () => refreshUsage());
bindRange('dailyRange', 'dailyCustom', () => refreshDaily());
document.getElementById('dailyMetric').onchange = () => refreshDaily();

document.getElementById('logBtn').onclick = async () => {
  const f = document.getElementById('logFlavor').value;
  document.getElementById('logView').textContent = await window.wb.log(f);
};

window.wb.onStatus(list => {
  const oa = document.getElementById('cards-openai');
  const an = document.getElementById('cards-anthropic');
  if (!oa.children.length || !an.children.length) return refresh();
  list.forEach(i => {
    const host = document.getElementById(i.protoGroup === 'openai' ? 'cards-openai' : 'cards-anthropic');
    const el = host.querySelector(`[data-key="${i.key}"]`);
    if (!el) return;
    const dot = el.querySelector('.dot');
    if (dot) dot.className = 'dot ' + (i.running ? 'on' : 'off');
    const [s, t] = el.querySelectorAll('button');
    if (s) s.disabled = i.running;
    if (t) t.disabled = !i.running;
  });
});

refresh();
refreshModels();
refreshUsage();
refreshDaily();
setInterval(refreshUsage, 5000); // 每 5 秒自动刷新用量
setInterval(refreshModels, 60000); // 每 60 秒自动刷新模型（夜间免费等实时倍率）
