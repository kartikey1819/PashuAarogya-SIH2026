/* PashuRaksha Government Portal — light Maharashtra-govt theme.
   Sections: Overview · Action Queue · Claims · Campaigns · Reports */
API.requireRole('block', 'district', 'state');
document.getElementById('who').textContent = `${API.user.name}`;

let map, layerGroup, trendChart, channelChart;
let section = 'overview';
let locCache = null;

setInterval(() => {
  document.getElementById('clock').textContent =
    new Date().toLocaleString('en-IN', { weekday: 'short', day: 'numeric',
      month: 'short', hour: '2-digit', minute: '2-digit' });
}, 1000);

const SECTIONS = [
  ['overview', '🗺️ Overview', 'निरीक्षण'],
  ['tasks', '📋 Action Queue', 'कार्य'],
  ['claims', '💰 Claims', 'नुकसान भरपाई'],
  ['campaigns', '💉 Campaigns', 'लसीकरण'],
  ['reports', '📄 Reports', 'अहवाल'],
];

init();
async function init() { renderNav(); render(); }

function renderNav(counts = {}) {
  const nav = document.getElementById('navtabs');
  nav.innerHTML = '';
  SECTIONS.forEach(([k, label]) => {
    const b = el('button', 'navtab' + (section === k ? ' active' : ''),
      label + (counts[k] ? ` <span class="ct">${counts[k]}</span>` : ''));
    b.onclick = () => { section = k; renderNav(counts); render(); };
    nav.appendChild(b);
  });
}

function render() {
  ({ overview, tasks, claims, campaigns, reports })[section]();
}

/* helpers */
const BAND_C = { high: '#C0392B', moderate: '#D98314', low: '#1E7A46' };
async function locations() {
  if (!locCache) locCache = await API.get('/api/locations');
  return locCache;
}

/* ================================ OVERVIEW ================================ */
async function overview() {
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="section-head">
      <h2>State Surveillance Overview <span class="mr">· राज्य पशुआरोग्य निरीक्षण</span></h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select id="level" style="width:auto;padding:8px 12px">
          <option value="village">Village view</option>
          <option value="block">Block view</option>
          <option value="district">District view</option>
        </select>
        <button class="btn sm outline" id="btnWeather">⛅ Live weather</button>
        <button class="btn sm outline" id="btnDetect">📡 Re-run radar</button>
        <button class="btn sm outline" id="btnKB">📖 Reload KB</button>
        <button class="btn sm saffron" id="btnDemo">▶ Simulate next day</button>
      </div>
    </div>
    <div class="kpis" id="kpis"></div>
    <div class="grid two-col" style="grid-template-columns:1.55fr 1fr;margin-top:16px">
      <div>
        <div class="card" style="padding:12px">
          <div id="map"></div>
          <div class="legend">
            <span><span class="sw" style="background:#C0392B"></span>High risk (≥60)</span>
            <span><span class="sw" style="background:#D98314"></span>Moderate (35–59)</span>
            <span><span class="sw" style="background:#1E7A46"></span>Low (&lt;35)</span>
            <span><span class="sw" style="background:none;border:2.5px dashed #C0392B;border-radius:50%"></span>Detected cluster (p&lt;0.05)</span>
            <span><span class="sw" style="background:none;border:2.5px dashed #7C3AED;border-radius:50%"></span>Zoonotic — One Health</span>
          </div>
        </div>
        <div class="grid g2" style="margin-top:14px">
          <div class="card"><h3>Case &amp; mortality — 21 days</h3>
            <canvas id="trend" height="130"></canvas></div>
          <div class="card"><h3>Reporting channels</h3>
            <div style="display:flex;align-items:center;gap:14px">
              <div style="width:140px;flex:0 0 140px"><canvas id="channels"></canvas></div>
              <div id="channelLegend" style="font-size:12.5px;flex:1"></div>
            </div>
            <div class="muted" style="font-size:11.5px;margin-top:8px">
              One case record, four channels — app · field worker · IVR&nbsp;1962 · SMS.</div>
          </div>
        </div>
      </div>
      <div>
        <div class="card"><h3>Outbreak Radar
          <span class="muted" style="font-size:10px;font-family:var(--f-m);font-weight:400;
          text-transform:none;letter-spacing:.02em">space-time scan · p-values</span></h3>
          <div id="clusters"></div></div>
        <div class="card" style="margin-top:14px"><h3>Why is it risky? —
          <span id="riskName" style="text-transform:none;color:var(--saffron)">click the map</span></h3>
          <div id="riskDetail" class="muted" style="font-size:13px">
            Click any circle: the score breaks into six weighted signals with
            plain-language reasons. No black boxes on this dashboard.</div></div>
        <div class="card" style="margin-top:14px"><h3>Alerts &amp; advisories</h3>
          <div id="alerts" style="max-height:320px;overflow-y:auto"></div></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px" id="tlCard" hidden>
      <h3>Outbreak timeline — <span id="tlName" style="text-transform:none;color:var(--saffron)"></span></h3>
      <div class="tl" id="timeline" style="max-height:320px;overflow-y:auto"></div>
    </div>`;

  document.getElementById('level').onchange = refreshMap;
  document.getElementById('btnDemo').onclick = demoAdvance;
  document.getElementById('btnDetect').onclick = async () => {
    const r = await API.post('/api/detect/run');
    toast(`📡 Radar re-run — ${r.clusters} active cluster(s)`, 'ok'); refreshOverview();
  };
  document.getElementById('btnWeather').onclick = async () => {
    toast('Fetching live weather (Open-Meteo)…');
    try {
      const r = await API.post('/api/weather/refresh');
      toast(`⛅ Updated ${r.blocks_updated.length} block(s); risk recomputed`, 'ok');
      refreshOverview();
    } catch (e) { toast('Weather fetch failed — risk unchanged', 'err'); }
  };
  document.getElementById('btnKB').onclick = async () => {
    const r = await API.post('/api/kb/reload');
    toast(`📖 Knowledge base reloaded — ${r.diseases.length} diseases`, 'ok');
  };

  map = L.map('map').setView([19.55, 74.9], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 17 }).addTo(map);
  layerGroup = L.layerGroup().addTo(map);
  refreshOverview();
}

async function refreshOverview() {
  refreshKPIs(); refreshMap(); refreshClusters(); refreshAlerts(); refreshTrends();
}

async function refreshKPIs() {
  const s = await API.get('/api/dashboard/summary');
  document.getElementById('kpis').innerHTML = `
    <div class="kpi"><div class="v">${s.total_animals.toLocaleString('en-IN')}</div>
      <div class="l">Registered animals · नोंदणीकृत जनावरे</div></div>
    <div class="kpi ${s.active_outbreaks ? 'crit' : 'ok'}"><div class="v">${s.active_outbreaks}</div>
      <div class="l">Detected clusters</div>
      <span class="sub2 ${s.active_outbreaks ? 'alert' : 'calm'}">${s.active_outbreaks ? 'RADAR ACTIVE' : 'ALL CLEAR'}</span></div>
    <div class="kpi warn"><div class="v">${s.cases_7d}</div><div class="l">Reports · 7 days</div></div>
    <div class="kpi ${s.deaths_7d ? 'crit' : 'ok'}"><div class="v">${s.deaths_7d}</div>
      <div class="l">Deaths · 7 days</div></div>
    <div class="kpi ${s.high_risk_villages ? 'warn' : 'ok'}"><div class="v">${s.high_risk_villages}</div>
      <div class="l">High-risk villages</div></div>
    <div class="kpi ${s.vaccination_coverage < .6 ? 'warn' : 'ok'}">
      <div class="v">${Math.round(s.vaccination_coverage * 100)}%</div>
      <div class="l">Vaccination coverage</div></div>
    <div class="kpi"><div class="v">${s.pending_lab}</div><div class="l">Samples in lab</div></div>`;
}

async function refreshMap() {
  const level = document.getElementById('level')?.value || 'village';
  const data = await API.get('/api/dashboard/map?level=' + level);
  layerGroup.clearLayers();
  data.units.forEach(u => {
    const base = level === 'village' ? 7 : (level === 'block' ? 13 : 20);
    const c = L.circleMarker([u.lat, u.lon], {
      radius: base + Math.min(8, u.score / 13),
      color: BAND_C[u.band], fillColor: BAND_C[u.band],
      fillOpacity: .55, weight: 1.6,
    }).addTo(layerGroup);
    c.bindTooltip(`<b>${esc(u.name)}</b> · risk <b>${u.score}</b> (${u.band})`);
    c.on('click', () => showRisk(u));
  });
  data.clusters.forEach(cl => {
    const color = cl.zoonotic ? '#7C3AED' : '#C0392B';
    L.circle([cl.lat, cl.lon], {
      radius: cl.radius_km * 1000, color, fillColor: color,
      fillOpacity: .05, weight: 2.4, dashArray: '9 7',
    }).addTo(layerGroup).bindPopup(`<b>📡 Suspected ${esc(cl.suspected)}</b><br>
      Center: ${esc(cl.center)}<br>
      Observed <b>${cl.cases_7d}</b> vs expected <b>${cl.expected}</b> / 7 d ·
      p = <b>${cl.p_value}</b>
      ${cl.zoonotic ? '<br><b style="color:#7C3AED">☣ ZOONOTIC — One Health notice issued</b>' : ''}<br>
      <a href="#" onclick="showTimeline(${cl.id},'${esc(cl.center)}');return false">Outbreak timeline →</a>`);
  });
}

function showRisk(u) {
  document.getElementById('riskName').textContent = u.name;
  const bd = u.breakdown || {};
  const MAX = { burden: 30, growth: 20, history: 15, vacc_gap: 15, cluster: 10, weather: 10 };
  const NAMES = { burden: 'Case burden', growth: 'Growth rate', history: 'Seasonal history',
                  vacc_gap: 'Vaccination gap', cluster: 'Cluster signal', weather: 'Weather signal' };
  let html = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
    <span class="risk-score-big" style="color:${BAND_C[u.band]}">${u.score}</span>
    <span class="chip ${u.band}" style="font-size:12px">${u.band}</span></div>`;
  html += Object.keys(MAX).map(k => {
    const v = bd[k] || 0, pc = Math.round(v / MAX[k] * 100);
    const cls = pc >= 70 ? 'crit' : (pc >= 40 ? 'warn' : '');
    return `<div class="bar-row"><span class="nm">${NAMES[k]}</span>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pc}%"></div></div>
      <span class="pc">${v}/${MAX[k]}</span></div>`;
  }).join('');
  html += (u.reasons || []).map(r => `<div class="risk-reason">${esc(r)}</div>`).join('');
  document.getElementById('riskDetail').innerHTML = html;
}

async function refreshClusters() {
  const data = await API.get('/api/dashboard/map?level=village');
  const box = document.getElementById('clusters');
  if (!data.clusters.length) {
    box.innerHTML = '<div class="muted" style="font-size:13px">No significant clusters. ' +
      'The radar re-scans on every incoming report.</div>'; return;
  }
  box.innerHTML = data.clusters.map(cl => `
    <div class="radar-card${cl.zoonotic ? ' zoo' : ''}">
      <div class="t">${esc(cl.suspected)} — ${esc(cl.center)}
        ${cl.zoonotic ? ' <span class="chip-onehealth">☣ One Health</span>' : ''}</div>
      <div class="stats">
        <div><b>${cl.cases_7d}</b><span>observed</span></div>
        <div><b>${cl.expected}</b><span>expected</span></div>
        <div><b>${cl.p_value < 0.001 ? '<0.001' : cl.p_value}</b><span>p-value</span></div>
        <div><b>${cl.radius_km}</b><span>km</span></div></div>
      <div class="act"><b>Prescribed:</b> MVU verify → samples → ring-vaccination check
        → movement advisory${cl.zoonotic ? ' → <b style="color:#7C3AED">notify district health (IDSP)</b>' : ''}.
        <i>Tasks auto-created in the Action Queue.</i></div>
      <div class="meta">Detected ${fmtDT(cl.detected_at)} ·
        <a href="#" onclick="showTimeline(${cl.id},'${esc(cl.center)}');return false">timeline →</a></div>
    </div>`).join('');
}

async function showTimeline(obId, name) {
  const data = await API.get('/api/dashboard/timeline/' + obId);
  document.getElementById('tlCard').hidden = false;
  document.getElementById('tlName').textContent = `${name} (${data.outbreak.suspected || '?'})`;
  document.getElementById('timeline').innerHTML = data.events.map(e => `
    <div class="tl-item ${e.kind}"><span class="at">${fmtDT(e.at)}</span><br>${esc(e.text)}</div>`).join('');
  document.getElementById('tlCard').scrollIntoView({ behavior: 'smooth' });
}
window.showTimeline = showTimeline;

async function refreshAlerts() {
  const list = await API.get('/api/alerts');
  document.getElementById('alerts').innerHTML = list.slice(0, 18).map(a => `
    <div class="alert-item ${a.severity}">
      <div class="t">${a.kind === 'onehealth' ? '☣ ' : ''}${esc(a.title)}</div>
      <div class="b">${esc(a.body)}</div>
      <div class="meta">→ ${esc(a.target_role)} ${a.village ? '· 📍 ' + esc(a.village) : ''} ·
        ${fmtDT(a.created_at)}</div></div>`).join('') || '<div class="muted">No alerts</div>';
}

Chart.defaults.color = '#5D6579';
Chart.defaults.font.family = 'Mukta';
async function refreshTrends() {
  const data = await API.get('/api/dashboard/trends');
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById('trend'), {
    data: { labels: data.daily.map(d => d.date),
      datasets: [
        { type: 'bar', label: 'Case reports', data: data.daily.map(d => d.cases),
          backgroundColor: '#1B4C8C', borderRadius: 3 },
        { type: 'bar', label: 'Deaths', data: data.daily.map(d => d.deaths),
          backgroundColor: '#C0392B', borderRadius: 3 }] },
    options: { responsive: true,
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
                y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
  const CH = { app: ['#1B4C8C', '📱 Mobile app'], field: ['#1E7A46', '🚶 Field worker'],
               ivr: ['#E8720C', '☎ IVR 1962'], sms: ['#7C3AED', '✉ SMS'] };
  const ch = data.channels || {};
  const labels = Object.keys(ch);
  if (channelChart) channelChart.destroy();
  channelChart = new Chart(document.getElementById('channels'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: labels.map(l => ch[l]),
      backgroundColor: labels.map(l => (CH[l] || ['#999'])[0]),
      borderColor: '#fff', borderWidth: 3 }] },
    options: { cutout: '66%', plugins: { legend: { display: false } } },
  });
  const total = labels.reduce((s, l) => s + ch[l], 0) || 1;
  document.getElementById('channelLegend').innerHTML = labels
    .sort((a, b) => ch[b] - ch[a]).map(l => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="width:10px;height:10px;border-radius:3px;background:${(CH[l]||['#999'])[0]}"></span>
        <span style="flex:1">${(CH[l] || [0, l])[1]}</span>
        <b class="mono" style="font-size:12px">${Math.round(ch[l] / total * 100)}%</b></div>`).join('');
}

async function demoAdvance() {
  const b = document.getElementById('btnDemo');
  b.disabled = true; b.textContent = '⏳ Ingesting…';
  try {
    const r = await API.post('/api/demo/advance');
    await API.post('/api/detect/run');
    toast(`▶ +${r.new_cases} simulated field reports — radar & risk recomputed`, 'ok');
    refreshOverview();
  } finally { b.disabled = false; b.textContent = '▶ Simulate next day'; }
}

/* ============================== ACTION QUEUE ============================== */
const TASK_IC = { mvu_dispatch: '🚑', sample_collection: '🧪',
                  ring_vaccination: '💉', verification: '🔍' };
async function tasks() {
  const view = document.getElementById('view');
  const rows = await API.get('/api/tasks');
  const open = rows.filter(t => t.status !== 'DONE').length;
  view.innerHTML = `
    <div class="section-head"><h2>Action Queue <span class="mr">· कार्य सूची</span></h2>
      <span class="chip ${open ? 'high' : 'low'}" style="font-size:12px">${open} open</span></div>
    <div class="panel-note">Every detected outbreak automatically creates owned, dated tasks —
      an alert is never just a dot on a map. Completing tasks here is the containment record.</div>
    <div id="tasklist"></div>`;
  const list = document.getElementById('tasklist');
  if (!rows.length) list.innerHTML = '<div class="muted">No tasks.</div>';
  rows.forEach(t => {
    const d = el('div', 'task' + (t.status === 'DONE' ? ' done' : ''), `
      <div class="tk-ic">${TASK_IC[t.kind] || '📌'}</div>
      <div style="flex:1">
        <div class="tt">${esc(t.title)}</div>
        <div class="tm">→ ${esc(t.assigned_role)} · 📍 ${esc(t.village || '')} ·
          ${fmtDT(t.created_at)} · <span class="chip ${t.status === 'DONE' ? 'low' :
            t.status === 'IN_PROGRESS' ? 'medium' : 'info'}">${t.status}</span></div>
      </div>
      <div class="actions"></div>`);
    const act = d.querySelector('.actions');
    if (t.status === 'OPEN') {
      const b = el('button', 'btn sm outline', 'Start');
      b.onclick = () => setTask(t.id, 'IN_PROGRESS'); act.appendChild(b);
    }
    if (t.status !== 'DONE') {
      const b = el('button', 'btn sm green', '✓ Done');
      b.onclick = () => setTask(t.id, 'DONE'); act.appendChild(b);
    }
    list.appendChild(d);
  });
}
async function setTask(id, status) {
  await API.post('/api/tasks/' + id, { status });
  toast(`Task → ${status}`, 'ok'); tasks();
}

/* ================================= CLAIMS ================================= */
async function claims() {
  const view = document.getElementById('view');
  const rows = await API.get('/api/claims');
  const pending = rows.filter(c => ['FILED', 'UNDER_REVIEW'].includes(c.status)).length;
  view.innerHTML = `
    <div class="section-head"><h2>Compensation Claims <span class="mr">· नुकसान भरपाई दावे</span></h2>
      <span class="chip ${pending ? 'medium' : 'low'}" style="font-size:12px">${pending} pending</span></div>
    <div class="panel-note">💡 <b>Why this matters:</b> compensation is the incentive that makes
      farmers report deaths instead of hiding them. The case record — symptoms, GPS, photos,
      lab status — <b>is</b> the claim evidence. Faster payouts → more reporting → earlier detection.</div>
    <div class="card"><div style="overflow-x:auto"><table>
      <thead><tr><th>#</th><th>Farmer</th><th>Village</th><th>Species</th>
        <th>Case</th><th>Amount</th><th>Status</th><th>Filed</th><th>Action</th></tr></thead>
      <tbody id="claimrows"></tbody></table></div></div>`;
  const tb = document.getElementById('claimrows');
  if (!rows.length) tb.innerHTML = '<tr><td colspan="9" class="muted">No claims yet</td></tr>';
  rows.forEach(cl => {
    const tr = el('tr', '', `
      <td class="mono">${cl.id}</td>
      <td><b>${esc(cl.farmer || '—')}</b></td>
      <td>${esc(cl.village || '')}</td>
      <td>${esc(cl.species)}</td>
      <td class="mono">#${cl.case_id} <span class="muted" style="font-size:10.5px">${esc(cl.case_status || '')}</span></td>
      <td class="mono"><b>₹${cl.amount.toLocaleString('en-IN')}</b></td>
      <td><span class="chip ${cl.status}">${cl.status.replace('_', ' ')}</span></td>
      <td class="mono" style="font-size:11px">${fmtDT(cl.filed_at)}</td>
      <td></td>`);
    const act = tr.lastElementChild;
    if (cl.status === 'FILED') {
      const b = el('button', 'btn sm outline', 'Review');
      b.onclick = () => decideClaim(cl.id, 'UNDER_REVIEW'); act.appendChild(b);
    }
    if (['FILED', 'UNDER_REVIEW'].includes(cl.status)) {
      const a = el('button', 'btn sm green', '✓ Approve');
      a.style.marginLeft = '4px';
      a.onclick = () => decideClaim(cl.id, 'APPROVED');
      const r = el('button', 'btn sm danger', '✕');
      r.style.marginLeft = '4px';
      r.onclick = () => decideClaim(cl.id, 'REJECTED');
      act.append(a, r);
    }
    if (cl.status === 'APPROVED') {
      const p = el('button', 'btn sm', '₹ Mark paid');
      p.onclick = () => decideClaim(cl.id, 'PAID'); act.appendChild(p);
    }
    tb.appendChild(tr);
  });
}
async function decideClaim(id, decision) {
  await API.post(`/api/claims/${id}/decide`, { decision });
  toast(`Claim #${id} → ${decision}. The farmer sees this instantly in their app.`, 'ok');
  claims();
}

/* =============================== CAMPAIGNS ================================ */
async function campaigns() {
  const view = document.getElementById('view');
  const [camps, vacc, locs, kb] = await Promise.all([
    API.get('/api/camps'), API.get('/api/dashboard/vaccination'),
    locations(), API.get('/api/kb')]);
  const villages = locs.filter(l => l.level === 'village')
                       .sort((a, b) => a.name.localeCompare(b.name));
  view.innerHTML = `
    <div class="section-head"><h2>Vaccination Campaigns <span class="mr">· लसीकरण मोहीम</span></h2></div>
    <div class="grid two-col" style="grid-template-columns:1.2fr 1fr">
      <div>
        <div class="card"><h3>Coverage by block (LHDCP · last 12 months)</h3><div id="vaccbars"></div></div>
        <div class="card" style="margin-top:14px"><h3>Scheduled camps</h3><div id="camplist"></div></div>
      </div>
      <div class="card" style="align-self:start"><h3>Schedule a camp</h3>
        <div class="panel-note" style="margin-top:2px">Scheduling instantly notifies every farmer
          in the village — in Marathi — through their app, SMS and IVR callback.</div>
        <label class="muted" style="font-size:12.5px">Village</label>
        <select id="campVillage" style="margin:5px 0 12px">${villages.map(v =>
          `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
        <label class="muted" style="font-size:12.5px">Vaccine / disease</label>
        <select id="campDisease" style="margin:5px 0 12px">${Object.entries(kb.diseases).map(([k, d]) =>
          `<option value="${k}">${esc(d.name.en)}</option>`).join('')}</select>
        <label class="muted" style="font-size:12.5px">Date</label>
        <input type="date" id="campDate" style="margin:5px 0 16px">
        <button class="btn saffron" style="width:100%" id="campGo">📢 Schedule &amp; notify farmers</button>
      </div>
    </div>`;
  document.getElementById('vaccbars').innerHTML = vacc.map(r => {
    const pc = Math.round(r.coverage * 100);
    const cls = pc < 50 ? 'crit' : (pc < 70 ? 'warn' : '');
    return `<div class="bar-row"><span class="nm" style="width:170px;flex-basis:170px">
      ${esc(r.block)} <span class="muted" style="font-size:10px">(${esc(r.district)})</span></span>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pc}%"></div></div>
      <span class="pc">${pc}%</span></div>`;
  }).join('');
  renderCamps(camps);
  const dateInput = document.getElementById('campDate');
  dateInput.value = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
  document.getElementById('campGo').onclick = async () => {
    try {
      const r = await API.post('/api/camps', {
        village_id: +document.getElementById('campVillage').value,
        disease_key: document.getElementById('campDisease').value,
        camp_date: dateInput.value });
      toast(`💉 ${r.name} scheduled — farmers notified in Marathi`, 'ok');
      campaigns();
    } catch (e) { toast(e.message, 'err'); }
  };
}
function renderCamps(camps) {
  document.getElementById('camplist').innerHTML = camps.length ? camps.map(c => `
    <div class="task"><div class="tk-ic">💉</div>
      <div style="flex:1"><div class="tt">${esc(c.name)}</div>
        <div class="tm">📍 ${esc(c.village)} (${esc(c.block)}) · 📅 ${esc(c.date)} ·
          ${esc(c.disease_name)}${c.disease_name_mr ? ' · ' + esc(c.disease_name_mr) : ''}</div></div>
      <span class="chip info">${esc(c.status)}</span></div>`).join('')
    : '<div class="muted">No camps scheduled</div>';
}

/* ================================ REPORTS ================================= */
async function reports() {
  const view = document.getElementById('view');
  const [tr, audit] = await Promise.all([
    API.get('/api/dashboard/trends'), API.get('/api/audit')]);
  const entries = Object.entries(tr.suspected).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  view.innerHTML = `
    <div class="section-head"><h2>Reports &amp; Evidence <span class="mr">· अहवाल व पुरावे</span></h2>
      <button class="btn sm outline" onclick="window.print()">🖨 Print this page</button></div>
    <div class="grid g3">
      <div class="card"><h3>Export datasets (CSV)</h3>
        <p class="muted" style="font-size:13px">For DAHD reporting, WOAH submissions and
          evidence-based budget planning.</p>
        <a class="btn outline sm" style="display:block;text-align:center;margin-bottom:8px"
           href="/api/export/cases.csv">⬇ Case reports</a>
        <a class="btn outline sm" style="display:block;text-align:center;margin-bottom:8px"
           href="/api/export/claims.csv">⬇ Compensation claims</a>
        <a class="btn outline sm" style="display:block;text-align:center"
           href="/api/export/vaccination.csv">⬇ Vaccination coverage</a></div>
      <div class="card"><h3>Suspected disease mix — 21 d</h3><div>${entries.map(([n, v]) => {
        const pc = Math.round(v / total * 100);
        return `<div class="bar-row"><span class="nm" style="width:150px;flex-basis:150px">${esc(n)}</span>
          <div class="bar-track"><div class="bar-fill ${pc > 50 ? 'crit' : pc > 20 ? 'warn' : ''}"
            style="width:${pc}%"></div></div><span class="pc">${v}</span></div>`;
      }).join('')}</div></div>
      <div class="card"><h3>Audit trail 🔏</h3>
        <div class="mono" style="font-size:11px;max-height:280px;overflow-y:auto">
          ${audit.map(r => `<div style="padding:3px 0;border-bottom:1px solid var(--surface-2)">
            ${fmtDT(r.at)} · ${esc(r.user)} · <b>${esc(r.action)}</b> ${esc(r.detail)}</div>`).join('')}
        </div></div>
    </div>`;
}
