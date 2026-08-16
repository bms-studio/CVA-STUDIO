/* CVA STUDIO — views: overview, history, permissions, keys, admin */
'use strict';

/* ================= OVERVIEW ================= */
async function renderOverview(isLangRefresh) {
  const body = $('#dashboardBody');
  const u = State.user || {};
  const cfgS = State.config || {};
  await Promise.allSettled([
    !('tools' in cfgS) ? loadConfig() : Promise.resolve(),
    !State.keys.length ? loadKeys() : Promise.resolve(),
    !State.history.length ? loadHistory() : Promise.resolve()
  ]);
  const keysList = State.keys || [];

  const rows = State.history || [];
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = rows.filter((r) => r.createdAt >= startOfDay.getTime()).length;
  const total = rows.length;
  const approved = rows.filter((r) => r.status === 'approved').length;
  const processing = rows.filter((r) => ['queued', 'processing', 'uploaded'].includes(r.status)).length;
  const realKeys = keysList.filter((k) => !k.isDemo).length;
  const dot = (ok) => `<span class="status-dot ${ok ? 'ok' : 'bad'}"></span>${esc(ok ? t('status.ok') : t('status.missing'))}`;

  let uptime = '';
  try { uptime = await getUptime(); } catch (e) {}

  const stat = (ic, count, label, extra) => `
    <div class="stat-tile ${extra || ''}">
      <span class="stat-ic">${icon(ic, 16)}</span>
      <strong data-count="${count}" data-duration="900">0</strong>
      <span class="stat-lb">${esc(label)}</span>
    </div>`;

  body.innerHTML = `
  <div class="overview-grid">
    <div class="ov-banner">
      <div class="ov-banner-glow"></div>
      <div class="ov-banner-inner">
        <div class="banner-tag ov-greet">${esc(t('ov.welcome'))}</div>
        <div class="ov-hello">${esc(u.username || 'CVA STUDIO')}</div>
        <div class="banner-subtitle">${esc(t('ov.welcomeSub'))}</div>
      </div>
      <div class="ov-banner-art">${icon('music', 40)}</div>
    </div>

    <div class="layout-card">
      <h3 class="card-title">${icon('chart', 18)} ${esc(t('ov.usageTitle'))}</h3>
      <div class="ov-stats">
        ${stat('clock', today, t('ov.today'))}
        ${stat('history', total, t('ov.total'))}
        ${stat('check', approved, t('ov.approved'))}
        ${stat('load', processing, t('ov.processing'), processing ? 'live' : '')}
      </div>
      <div class="flex mt-14" style="gap:8px;flex-wrap:wrap;">
        <button class="chip premium" onclick="switchTab('studio')">${icon('music', 15)} ${esc(t('ov.convertBtn'))}</button>
        <button class="chip" onclick="switchTab('history')">${esc(t('tab.history'))}</button>
        <button class="chip" onclick="switchTab('permissions')">${esc(t('tab.permissions'))}</button>
        <button class="chip" onclick="switchTab('keys')">${esc(t('tab.keys'))}</button>
      </div>
    </div>

    <div class="layout-card">
      <h3 class="card-title">${icon('user', 18)} ${esc(t('ov.sessTitle'))}</h3>
      <div class="session-row"><span>Username</span><strong>${esc(u.username || 'CVA STUDIO')}</strong></div>
      <div class="session-row"><span>User ID</span><strong class="mono">${esc(u.discordId || '-')}</strong></div>
      <div class="session-row"><span>${esc(t('status.keys'))}</span><strong>${realKeys} ${esc(t('status.realKeys'))}</strong></div>
      <div class="session-row"><span>${esc(t('status.access'))}</span><strong>${esc(t('status.openAccess'))}</strong></div>
    </div>

    <div class="layout-card">
      <h3 class="card-title">${icon('trend', 18)} ${esc(t('ov.howTitle'))}</h3>
      <ol class="steps">
        <li><b>1. ${esc(t('keys.addTitle'))}</b><div class="small-note">${esc(t('keys.addSub'))}</div></li>
        <li><b>2. ${esc(t('studio.title'))}</b><div class="small-note">${esc(t('ov.st2'))}</div></li>
        <li><b>3. ${esc(t('tab.history'))}</b><div class="small-note">${esc(t('ov.st3'))}</div></li>
      </ol>
      <button class="btn-primary btn-full mt-14" onclick="switchTab('studio')">${icon('rocket', 16)} ${esc(t('ov.convertBtn'))} →</button>
    </div>

    <div class="layout-card">
      <h3 class="card-title">${icon('server', 18)} ${esc(t('status.title'))}</h3>
      <div class="session-row"><span>Server</span><strong>${uptime ? 'Online · ' + esc(uptime) + ' up' : esc(t('status.ok'))}</strong></div>
      <div class="session-row"><span>FFmpeg</span>${dot(cfgS.tools && cfgS.tools.ffmpeg)}</div>
      <div class="session-row"><span>yt-dlp</span>${dot(cfgS.tools && cfgS.tools.ytdlp)}</div>
    </div>
  </div>`;

  initCounters();
}

/* ================= HISTORY ================= */
function modPill(state) {
  const s = String(state || '');
  return `<span class="mod ${esc(s === 'Approved' ? 'Approved' : s === 'Rejected' ? 'Rejected' : 'Reviewing')}">${esc(s || 'Pending')}</span>`;
}

function jobActive(status) {
  return ['queued', 'processing', 'uploaded'].includes(status);
}

async function renderHistory(isLangRefresh) {
  let data;
  try {
    data = await api('/api/history');
  } catch (e) {
    $('#dashboardBody').innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('alert', 44)}</div><h3>${esc(e.message)}</h3></div>`;
    return;
  }
  State.history = data.history || [];
  const rows = State.history;

  clearInterval(State.historyTimer);
  State.historyTimer = null;
  if (rows.some((r) => jobActive(r.status))) {
    State.historyTimer = setInterval(() => { if (State.tab === 'history') renderHistory(true); }, 8000);
  }
  updateNavBadge(rows.filter((r) => r.status === 'processing').length);

  const body = $('#dashboardBody');
  if (!rows.length) {
    body.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">${icon('music', 44)}</div>
      <h3>${esc(t('hist.empty'))}</h3>
      <p class="small-note">${esc(t('hist.emptySub'))}</p>
      <button class="btn-primary" onclick="switchTab('studio')">${icon('music', 16)} ${esc(t('ov.convertBtn'))} →</button>
    </div>`;
    return;
  }

  const nProcessing = rows.filter((r) => jobActive(r.status)).length;
  const nApproved = rows.filter((r) => r.status === 'approved').length;
  const allIds = rows.flatMap((r) => (r.parts || []).map((p) => p.assetId).filter(Boolean));

  body.innerHTML = `
  <div class="hist-summary">
    <h3 class="card-title mb-0">${icon('history', 18)} ${esc(t('tab.history'))} <span class="sub">${rows.length}</span></h3>
    <div class="hist-filters">
      ${nProcessing ? `<span class="chip stat pulsing">${icon('load', 13)} ${nProcessing} processing</span>` : ''}
      ${nApproved ? `<span class="chip stat">${icon('check', 13)} ${nApproved} approved</span>` : ''}
      <button class="chip" id="copyAllIdsBtn" ${allIds.length ? '' : 'disabled'} title="${esc(t('history.copyAll'))}">${icon('copy', 14)} ${esc(t('history.copyAll'))}</button>
      <button class="chip" title="Refresh" onclick="renderHistory(true)">${icon('refresh', 14)}</button>
    </div>
  </div>
  <div class="history-list">
    ${rows.map(renderHistRow).join('')}
  </div>`;

  $('#copyAllIdsBtn')?.addEventListener('click', () => {
    if (allIds.length) copyText(allIds.join('\n'));
  });

  rows.forEach((r) => bindHistRow(r));
}

function renderHistRow(r) {
  const pad = r.parts && r.parts.length ? r.parts : [];
  const first = pad[0];
  const status = r.status || 'queued';
  const src = r.sourceUrl && r.sourceUrl.length > 44 ? r.sourceUrl.slice(0, 44) + '…' : (r.sourceUrl || r.sourceType);
  const thumb = r.thumbnail || 'assets/logo.jpg';
  const statusLabel = {
    queued: 'Queued', processing: 'Processing', uploaded: 'Uploaded',
    approved: 'Approved', rejected: 'Rejected', error: 'Error'
  }[status] || status;
  const statusIconName = {
    queued: 'clock', processing: 'load', uploaded: 'upload',
    approved: 'check', rejected: 'x', error: 'alert'
  }[status] || 'clock';

  return `
  <div class="history-card">
    <div class="hist-main">
      <div class="hist-thumbwrap">
        <img src="${esc(thumb)}" class="hist-thumb" alt="" onerror="this.src='assets/logo.jpg';">
      </div>
      <div class="hist-body">
        <div class="hist-head">
          <div class="hist-title">${esc(r.assetName || r.title || 'Untitled')}</div>
          <span class="status-pill ${esc(status)}">${icon(statusIconName, 13)} ${esc(statusLabel)}</span>
        </div>
        <div class="hist-meta">
          <span class="meta-chip">#${esc(r.id)}</span>
          <span class="meta-chip mono">${esc(src)}</span>
          <span class="meta-chip">${esc(r.sourceType)}</span>
          <span class="meta-chip">${fmtDate(r.createdAt)}</span>
        </div>
        ${r.error ? `<div class="hist-error">${icon('alert', 14)} ${esc(r.error)}</div>` : ''}
        ${pad.length ? `<div class="hist-parts">${pad.map((p) => `
          <div class="hist-part">
            <span class="part-idx">P${p.index}</span>
            <span class="asset-id" onclick="copyText('${p.assetId}')" title="Klik untuk salin">${p.assetId}</span>
            ${modPill(p.moderationState)}
            ${p.durationSec ? `<span class="part-dur">${fmtDur(p.durationSec)}</span>` : ''}
          </div>`).join('')}</div>` : '<div class="hist-meta">—</div>'}
        <div class="hist-actions">
          <button class="chip" data-act="copy-${r.id}" ${first && first.assetId ? '' : 'disabled'}>${icon('copy', 14)} Copy</button>
          <button class="chip" data-act="open-${r.id}" ${first && first.assetId ? '' : 'disabled'}>${icon('open', 14)} Open</button>
          <button class="chip" data-act="dl-${r.id}" ${r.hasOutput ? '' : 'disabled'}>${icon('dl', 14)} ${esc(t('hist.dl'))}</button>
          <button class="chip" data-act="reid-${r.id}" title="${esc(t('history.refreshTitle'))}">${icon('refresh', 14)} ${esc(t('history.refreshId'))}</button>
          <button class="chip" data-act="console-${r.id}" ${jobActive(status) || status === 'error' ? '' : 'disabled'}>${icon('terminal', 14)} Console</button>
          <button class="chip" data-act="wl-${r.id}" ${first && first.assetId ? '' : 'disabled'}>${icon('shield', 14)} ${esc(t('hist.wl'))}</button>
          <button class="chip icon-btn danger" data-act="del-${r.id}">${icon('trash', 15)}</button>
        </div>
      </div>
    </div>
    <div class="console-card" id="consoleBox-${r.id}" style="display:none;">
      <div class="process-console"><span class="info">Loading console…</span></div>
    </div>
  </div>`;
}

function bindHistRow(r) {
  const first = r.parts && r.parts.length ? r.parts[0] : null;
  $('#dashboardBody').querySelector(`[data-act="copy-${r.id}"]`)?.addEventListener('click', () => first && copyText(first.assetId));
  $('#dashboardBody').querySelector(`[data-act="open-${r.id}"]`)?.addEventListener('click', () => {
    if (first) window.open('https://www.roblox.com/library/' + first.assetId, '_blank');
  });
  $('#dashboardBody').querySelector(`[data-act="dl-${r.id}"]`)?.addEventListener('click', () => {
    if (r.hasOutput) window.open('/api/history/' + r.id + '/download', '_blank');
  });
  $('#dashboardBody').querySelector(`[data-act="wl-${r.id}"]`)?.addEventListener('click', () => {
    if (!first) return;
    State._wlPrefill = String(first.assetId);
    switchTab('permissions');
  });
  $('#dashboardBody').querySelector(`[data-act="reid-${r.id}"]`)?.addEventListener('click', async () => {
    try {
      const d = await api('/api/history/' + r.id + '/getid', { method: 'POST' });
      if (d && d.error) { toast(d.error, 'warning'); return; }
      if (d && d.requeued) { toast(d.message || t('history.noMatch'), 'warning'); renderHistory(true); return; }
      const n = (d.matches || []).length;
      if (n > 0) {
        toast(`${t('history.foundIds')} ${n} — ${d.query}`, 'success');
        renderHistory(true);
      } else {
        toast(t('history.noMatch'), 'warning');
      }
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#dashboardBody').querySelector(`[data-act="del-${r.id}"]`)?.addEventListener('click', async () => {
    if (!confirm(t('hist.delConfirm'))) return;
    try {
      await api('/api/history/' + r.id, { method: 'DELETE' });
      toast('🗑 ' + t('hist.deleted'), 'success');
      renderHistory(true);
    } catch (e) { toast(e.message, 'error'); }
  });
  const consoleBox = $('#consoleBox-' + r.id);
  $('#dashboardBody').querySelector(`[data-act="console-${r.id}"]`)?.addEventListener('click', () => {
    if (!consoleBox) return;
    const open = consoleBox.style.display === 'block';
    consoleBox.style.display = open ? 'none' : 'block';
    if (!open) pollHistoryConsole(r.id, consoleBox);
  });
}

function pollHistoryConsole(jobId, box) {
  clearInterval(State.consoleTimer);
  State.consoleTimer = null;
  const render = async () => {
    let data;
    try { data = await api('/api/history/' + jobId + '/console'); }
    catch (e) { return; }
    box.innerHTML = `<div class="process-console">${(data.log || []).map((line) => {
      let cls = 'info';
      if (/gagal|error|✗|⚠|500/i.test(line)) cls = 'err';
      else if (/selesai|berhasil|✓|approved|done|Asset ID/i.test(line)) cls = 'ok';
      else if (/menunggu|moderasi|demo|poller/i.test(line)) cls = 'warn';
      return `<span class="${cls}">${esc(line)}</span>`;
    }).join('\n') || '<span class="info">(kosong)</span>'}</div>`;
    box.querySelector('.process-console').scrollTop = 99999;
    if (['approved', 'rejected', 'error'].includes(data.status)) {
      clearInterval(State.consoleTimer);
      State.consoleTimer = null;
    }
  };
  render();
  State.consoleTimer = setInterval(render, 1400);
}

function updateNavBadge(processingCount) {
  const badge = $('#historyBadge');
  if (badge) {
    badge.style.display = processingCount ? 'flex' : 'none';
    badge.textContent = processingCount > 9 ? '9+' : String(processingCount);
  }
}

/* ================= PERMISSIONS ================= */
async function renderPermissions(isLangRefresh) {
  const body = $('#dashboardBody');
  body.innerHTML = `
  <div class="dashboard-grid-1" style="max-width:860px;margin:0 auto;">
    <div class="layout-card">
      <h3 class="card-title">${icon('shield', 18)} ${esc(t('perm.title'))}</h3>
      <p class="small-note">${esc(t('perm.sub'))}</p>
      <label class="field-label">Universe ID</label>
      <input type="text" id="permUniverse" class="input-control" placeholder="123456789">
      <label class="field-label mt-14">${esc(t('perm.ids'))}</label>
      <textarea id="permAssetIds" class="input-control batch-input" placeholder="9000000000&#10;9000000001&#10;9000000002">${esc(State._wlPrefill || '')}</textarea>
      <label class="field-label mt-14">${esc(t('keys.select'))}</label>
      <select id="permKeySelect" class="input-control">${keyOptionsHtml()}</select>
      <button class="btn-primary btn-full mt-20" id="grantPermBtn">${icon('check', 15)} ${esc(t('perm.grant'))}</button>
      <div id="grantResult" class="mt-14"></div>
      <div class="small-note mt-8 warn">${esc(t('perm.warn'))}</div>
    </div>
  </div>`;
  State._wlPrefill = '';

  $('#grantPermBtn').addEventListener('click', async () => {
    const universeId = $('#permUniverse').value.trim();
    const assetIds = $('#permAssetIds').value;
    const apiKeyId = $('#permKeySelect').value;
    if (!/^\d+$/.test(universeId)) return toast(t('perm.badUni'), 'error');
    if (!assetIds.trim()) return toast(t('perm.ids'), 'warning');
    if (!apiKeyId) return toast(t('keys.select') + '!', 'warning');
    resultRow(`${icon('load', 15)} ${t('ov.loading')}…`, '');
    busy(true);
    try {
      const d = await api('/api/permissions/grant', {
        method: 'POST',
        body: JSON.stringify({ universeId, assetIds, apiKeyId })
      });
      resultRow(
        `${icon('check', 15)} ${d.successCount} ${t('perm.applied')}${d.demo ? ' (demo)' : ''}`,
        (d.failed && d.failed.length) ? d.failed.map((f) => `${f.assetId}: ${f.code || 'err'}`).join('<br>') : ''
      );
    } catch (e) {
      resultRow(`${icon('x', 15)} ${esc(e.message)}`, '');
    } finally {
      busy(false);
    }
  });

  function resultRow(main, sub) {
    const el = $('#grantResult');
    if (el) el.innerHTML = `<div class="result-card">${main}${sub ? `<div class="small-note mt-8">${sub}</div>` : ''}</div>`;
  }
}

/* ================= KEYS ================= */
function keyOptionsHtml(selected) {
  const keys = State.keys || [];
  return `<option value="">-- ${esc(t('keys.select'))} --</option>` + keys.map((k) =>
    `<option value="${esc(k.id)}" ${selected === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
}

async function renderKeys(isLangRefresh) {
  const body = $('#dashboardBody');
  await loadKeys();
  const keys = State.keys || [];
  body.innerHTML = `
  <div class="dashboard-grid-1" style="max-width:860px;margin:0 auto;">
    <div class="layout-card">
      <div class="flex-between">
        <h3 class="card-title mb-0">${icon('key', 18)} ${esc(t('keys.yourKeys'))} <span class="sub">${keys.length}</span></h3>
        <div class="flex" style="gap:8px;">
          <button class="chip premium" onclick="openModal('addKeyModal')">+ ${esc(t('keys.add'))}</button>
        </div>
      </div>
      <div class="small-note mt-8">${esc(t('keys.addSub'))}</div>
      <div class="keys-grid mt-20">
        ${keys.length ? keys.map((k) => `
          <div class="key-card" data-id="${esc(k.id)}">
            <div class="key-card-header">
              <div>
                <span class="key-name">${esc(k.name)}</span>
                <span class="creator-badge ${esc(k.creatorType)}">${esc(k.creatorType)}</span>
              </div>
              <div class="flex" style="gap:6px;">
                <button class="chip" data-act="test" style="color:var(--brand-2);">${icon('beaker', 14)} ${esc(t('keys.test'))}</button>
                <button class="icon-btn danger" title="Hapus">${icon('trash', 15)}</button>
              </div>
            </div>
            <div class="key-masked mono">${esc(k.masked || k.id)}</div>
            <div class="key-value-row"><span>Creator ID</span><strong>${esc(k.creatorId || '-')}</strong></div>
            <div class="key-value-row"><span>${esc(t('keys.added'))}</span><strong>${fmtDate(k.createdAt)}</strong></div>
          </div>`).join('')
        : `<div class="small-note">${esc(t('keys.empty'))}</div>`}
      </div>
    </div>
  </div>`;

  keys.forEach((k) => {
    const card = body.querySelector(`.key-card[data-id="${k.id}"]`);
    if (!card) return;
    card.querySelector('.icon-btn').addEventListener('click', async () => {
      if (!confirm(t('hist.delConfirm'))) return;
      try {
        await api('/api/keys/' + k.id, { method: 'DELETE' });
toast(t('hist.deleted'), 'success');
        renderKeys();
      } catch (e) { toast(e.message, 'error'); }
    });
    card.querySelector('[data-act="test"]')?.addEventListener('click', async () => {
      busy(true);
      toast(t('keys.testing'), 'info');
      try {
        const r = await api('/api/keys/' + k.id + '/test', { method: 'POST' });
        const msg = t('keys.testOk').replace('{0}', r.assetId) + (r.archived ? ' ' + t('keys.testArchived') : ' — ' + t('keys.testNotArchived'));
        toast(msg, 'success');
        renderKeys();
      } catch (e) { toast(e.message, 'error'); }
      finally { busy(false); }
    });
  });
}

/* ================= DONATION ================= */
async function renderDonation(isLangRefresh) {
  const body = $('#dashboardBody');
  const captionHtml = esc(t('donate.caption')).split('\n').join('<br>');
  body.innerHTML = `
  <div class="dashboard-grid-1" style="max-width:760px;margin:0 auto;">
    <div class="layout-card" style="text-align:center;">
      <h3 class="card-title">${icon('heart', 18)} ${esc(t('donate.title'))}</h3>
      <p class="small-note" style="max-width:560px;margin:18px auto 0;line-height:1.8;">${captionHtml}</p>
      <div style="margin:28px auto 0;width:min(300px,100%);">
        <div class="donation-image-frame" id="donationImage"></div>
        <div class="small-note" style="margin-top:12px;">${icon('star', 16)} ${esc(t('donate.thanks'))}</div>
      </div>
    </div>
  </div>`;

  const frame = $('#donationImage');
  const img = new Image();
  img.alt = 'Donation QR';
  img.style.cssText = 'width:100%;height:auto;border-radius:14px;display:block;';
  img.onload = () => { frame.innerHTML = ''; frame.appendChild(img); };
  img.onerror = () => {
    frame.innerHTML = `<div class="donation-placeholder">${icon('image', 42)}<br><span>${esc(t('donate.comingSoon'))}</span></div>`;
  };
  img.src = 'assets/donation.png?t=' + Date.now();
}