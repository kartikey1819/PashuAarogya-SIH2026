/* Farmer mobile app — voice-first symptom reporting, offline queue, animals,
   advisories. Marathi default. */
API.requireRole('farmer', 'field');

let KB = null;
let state = { tab: 'home', step: 0,
  report: { species: null, symptoms: [], affected_count: 1, dead_count: 0, photo: null } };

const view = document.getElementById('view');
const nav = document.getElementById('nav');

const SPECIES = [
  { k: 'cattle', em: '🐄' }, { k: 'buffalo', em: '🐃' }, { k: 'goat', em: '🐐' },
  { k: 'sheep', em: '🐑' }, { k: 'poultry', em: '🐔' },
];

init();
async function init() {
  document.querySelectorAll('.langsel button').forEach(b => {
    b.classList.toggle('on', b.dataset.l === LANG);
    b.onclick = () => { setLang(b.dataset.l); location.reload(); };
  });
  if (!navigator.onLine) netbar(true);
  try { KB = await API.get('/api/kb'); localStorage.setItem('pr_kb', JSON.stringify(KB)); }
  catch (e) { KB = JSON.parse(localStorage.getItem('pr_kb') || 'null'); }
  renderNav(); render();
  document.addEventListener('pr-synced', () => { if (state.tab === 'home') render(); });
}

function renderNav() {
  nav.innerHTML = '';
  [['home', '🏠'], ['report', '📢'], ['animals', '🐄'], ['services', '🤝'],
   ['alerts', '🔔']].forEach(([k, em]) => {
    const b = el('button', state.tab === k ? 'on' : '',
      `<span class="em">${em}</span>${t(k)}`);
    b.onclick = () => { state.tab = k; if (k === 'report') resetReport(); renderNav(); render(); };
    nav.appendChild(b);
  });
}

function render() {
  ({ home, report, animals, services, alerts })[state.tab]();
}

/* ------------------------------------ HOME -------------------------------- */
async function home() {
  const pending = Queue.count();
  view.innerHTML = '';
  const hello = el('div', '', `<div style="font-family:var(--f-d);font-size:22px;
    font-weight:700;margin:6px 0 2px">🙏 ${esc(API.user.name)}</div>
    <div class="muted" style="margin-bottom:16px">${esc(API.user.location || '')}</div>`);
  view.appendChild(hello);

  if (pending) {
    view.appendChild(el('div', 'card', `<b>⏳ ${t('offline_pending')}: ${pending}</b>
      <div class="muted" style="font-size:13px">${t('report_saved_offline')}</div>`));
    view.lastChild.style.marginBottom = '12px';
  }

  // weather + camp strip
  const strip = el('div', '', '');
  strip.style.cssText = 'display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:13px';
  view.appendChild(strip);
  API.get('/api/myweather').then(w => {
    if (w.weather && w.weather.temp_c != null) {
      strip.appendChild(el('div', 'card', `<div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:30px">⛅</span>
        <div><b>${t('weather_today')}</b> — ${esc(w.village)}<br>
        <span class="muted" style="font-size:13px">🌡 ${Math.round(w.weather.temp_c)}°C ·
        💧 ${Math.round(w.weather.humidity)}% ·
        🌧 ${w.weather.rain_mm ?? 0} mm</span></div></div>`));
    }
  }).catch(() => {});
  API.get('/api/camps?mine=true').then(camps => {
    if (camps.length) {
      const c = camps[0];
      strip.appendChild(el('div', 'card', `<div style="display:flex;align-items:center;gap:12px;
        border-left:4px solid var(--green);margin:-18px;padding:16px 16px 16px 14px">
        <span style="font-size:30px">💉</span>
        <div><b style="color:var(--green)">${t('camp_near_you')}</b><br>
        <span style="font-size:13.5px">${esc(c.disease_name_mr || c.disease_name)} —
        📍 ${esc(c.village)} · 📅 ${esc(c.date)} · <b>${t('free')}</b></span></div></div>`));
    }
  }).catch(() => {});

  const btns = [
    ['report', '📢', t('report_sick'), 'report'],
    ['animals', '🐄', t('my_animals'), ''],
    ['services', '🤝', t('services') + ' — ' + t('claims') + ' · ' + t('camps'), ''],
    ['alerts', '🔔', t('advisories'), ''],
  ];
  btns.forEach(([tab, em, label, cls]) => {
    const b = el('button', 'bigbtn ' + cls, `<span class="ic">${em}</span><span>${label}</span>
      <span style="margin-left:auto;color:var(--muted)">›</span>`);
    b.onclick = () => { state.tab = tab; if (tab === 'report') resetReport(); renderNav(); render(); };
    view.appendChild(b);
  });

  view.appendChild(el('div', 'card', `<div style="font-size:13.5px">
     ☎️ <b>${t('ivr_hint')}</b>
     <div class="muted" style="margin-top:4px"><a href="/ivr.html">IVR डेमो →</a></div></div>`));

  // recent reports
  try {
    const mine = await API.get('/api/reports/mine');
    if (mine.length) {
      const c = el('div', 'card'); c.style.marginTop = '12px';
      c.innerHTML = `<h3>${t('my_reports')}</h3>`;
      mine.slice(0, 5).forEach(r => {
        const s = r.samples && r.samples[0];
        c.appendChild(el('div', '', `<div style="display:flex;justify-content:space-between;
          align-items:center;padding:7px 0;border-bottom:1px solid var(--surface-2)">
          <div><b>#${r.id}</b> ${t(r.species)} · <span class="mono" style="font-size:11px">${esc(r.status)}</span>
          ${s ? `<div class="mono" style="font-size:10.5px;color:var(--muted)">🧪 ${esc(s.code)} → ${esc(s.lab_result || s.status)}</div>` : ''}</div>
          <span class="chip ${r.triage_band}">${r.triage_band}</span></div>`));
      });
      view.appendChild(c);
    }
  } catch (e) {}
}

/* ---------------------------------- REPORT -------------------------------- */
function resetReport() {
  state.step = 0;
  state.report = { species: null, symptoms: [], affected_count: 1, dead_count: 0, photo: null };
}

function report() {
  const steps = [stepSpecies, stepSymptoms, stepCounts, stepConfirm];
  steps[state.step]();
}

function stepHeader(txt) {
  view.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin:4px 0 16px">
    ${state.step > 0 ? `<button class="btn outline sm" onclick="state.step--;render()">‹ ${t('back')}</button>` : ''}
    <div style="font-family:var(--f-d);font-size:19px;font-weight:700">${txt}</div></div>
    <div style="display:flex;gap:5px;margin-bottom:16px">${[0,1,2,3].map(i =>
      `<div style="flex:1;height:5px;border-radius:3px;background:${i <= state.step ? 'var(--saffron)' : 'var(--hair)'}"></div>`).join('')}</div>`;
}

function stepSpecies() {
  stepHeader(t('which_animal'));
  const g = el('div', 'spgrid');
  SPECIES.forEach(s => {
    const b = el('button', 'spbtn' + (state.report.species === s.k ? ' on' : ''),
      `<span class="em">${s.em}</span>${t(s.k)}`);
    b.onclick = () => { state.report.species = s.k; state.step = 1; render(); };
    g.appendChild(b);
  });
  view.appendChild(g);
}

function stepSymptoms() {
  stepHeader(t('what_symptoms'));

  // voice input
  const voice = el('div', '', `<button class="micbtn" id="mic">🎤</button>
    <div style="text-align:center;font-size:13px;margin:6px 0 14px" class="muted" id="micLabel">
    ${t('speak_symptoms')}</div>`);
  view.appendChild(voice);
  setupVoice();

  const syms = (KB && KB.symptoms) || {};
  const g = el('div', 'symgrid');
  Object.entries(syms).forEach(([code, s]) => {
    const on = state.report.symptoms.includes(code);
    const b = el('button', 'symbtn' + (on ? ' on' : ''),
      `<span class="em">${s.icon || '•'}</span>${esc(s[LANG] || s.en)}`);
    b.onclick = () => {
      const i = state.report.symptoms.indexOf(code);
      i >= 0 ? state.report.symptoms.splice(i, 1) : state.report.symptoms.push(code);
      render();
    };
    g.appendChild(b);
  });
  view.appendChild(g);

  const next = el('button', 'btn saffron', t('next') + ' ›');
  next.style.cssText = 'width:100%;margin-top:16px;padding:15px;font-size:17px';
  next.disabled = !state.report.symptoms.length;
  next.onclick = () => { state.step = 2; render(); };
  view.appendChild(next);
}

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = document.getElementById('mic');
  const label = document.getElementById('micLabel');
  if (!SR) { mic.style.display = 'none'; label.textContent = ''; return; }
  let rec = null;
  mic.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = LANG === 'hi' ? 'hi-IN' : (LANG === 'en' ? 'en-IN' : 'mr-IN');
    rec.interimResults = false; rec.maxAlternatives = 1;
    mic.classList.add('rec'); label.textContent = t('listening');
    rec.onresult = e => {
      const text = e.results[0][0].transcript;
      const found = parseVoice(text);
      found.forEach(s => { if (!state.report.symptoms.includes(s)) state.report.symptoms.push(s); });
      toast(found.length ? `🎤 "${text}" → ${found.length} ✓` : `🎤 "${text}" — ?`,
            found.length ? 'ok' : 'err');
      render();
    };
    rec.onend = () => { mic.classList.remove('rec'); label.textContent = t('speak_symptoms'); rec = null; };
    rec.onerror = () => { mic.classList.remove('rec'); rec = null; };
    rec.start();
  };
}

function stepCounts() {
  stepHeader(t('how_many'));
  const r = state.report;
  view.appendChild(el('div', 'card', `
    <div style="text-align:center;margin-bottom:8px">${t('how_many')}</div>
    <div class="stepper">
      <button onclick="bump('affected_count',-1)">−</button>
      <span class="n" id="ac">${r.affected_count}</span>
      <button onclick="bump('affected_count',1)">+</button>
    </div>
    <hr style="border:0;border-top:1px solid var(--hair);margin:18px 0">
    <div style="text-align:center;margin-bottom:8px">${t('any_deaths')} <b>(${t('deaths_count')})</b></div>
    <div class="stepper">
      <button onclick="bump('dead_count',-1)">−</button>
      <span class="n" id="dc" style="color:${r.dead_count ? 'var(--red)' : 'inherit'}">${r.dead_count}</span>
      <button onclick="bump('dead_count',1)">+</button>
    </div>`));
  const next = el('button', 'btn saffron', t('next') + ' ›');
  next.style.cssText = 'width:100%;margin-top:16px;padding:15px;font-size:17px';
  next.onclick = () => { state.step = 3; render(); };
  view.appendChild(next);
}
function bump(k, d) {
  state.report[k] = Math.max(k === 'affected_count' ? 1 : 0, state.report[k] + d);
  document.getElementById(k === 'affected_count' ? 'ac' : 'dc').textContent = state.report[k];
  if (k === 'dead_count')
    document.getElementById('dc').style.color = state.report[k] ? 'var(--red)' : 'inherit';
}

function stepConfirm() {
  stepHeader(t('submit_report'));
  const r = state.report;
  const syms = (KB && KB.symptoms) || {};
  const spEm = SPECIES.find(s => s.k === r.species)?.em || '';
  view.appendChild(el('div', 'card', `
    <div style="font-size:17px"><b>${spEm} ${t(r.species)}</b> × ${r.affected_count}
      ${r.dead_count ? `<span style="color:var(--red)"> · ☠ ${r.dead_count}</span>` : ''}</div>
    <div style="margin-top:8px">${r.symptoms.map(s =>
      `<span class="chip info" style="margin:2px">${(syms[s] || {}).icon || ''} ${esc((syms[s] || {})[LANG] || s)}</span>`).join('')}</div>
    <div style="margin-top:12px">
      <label class="muted" style="font-size:12.5px">📷 Photo (optional)</label>
      <input type="file" accept="image/*" capture="environment" id="photo" style="margin-top:4px">
    </div>`));

  const sms = `PR ${r.species.toUpperCase().slice(0,3)} S:${r.symptoms.map(s=>s.slice(0,3).toUpperCase()).join(',')} N:${r.affected_count} D:${r.dead_count}`;
  view.appendChild(el('div', '', `<div class="muted" style="font-size:12px;margin:10px 0 4px">
    ${t('sms_hint')}</div><div class="mono" style="background:var(--surface-2);padding:8px 10px;
    border-radius:8px;font-size:12.5px">${sms} → 1962</div>`));

  const btn = el('button', 'btn green', '📤 ' + t('submit_report'));
  btn.style.cssText = 'width:100%;margin-top:16px;padding:16px;font-size:18px';
  btn.onclick = submitReport;
  view.appendChild(btn);
}

async function submitReport() {
  const r = { ...state.report, channel: API.user.role === 'field' ? 'field' : 'app' };
  const photoInput = document.getElementById('photo');
  if (photoInput && photoInput.files[0]) {
    r.photo = await shrinkPhoto(photoInput.files[0]);
  }
  r.client_uuid = 'cx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  if (!navigator.onLine) {
    Queue.push(r);
    showResult(null, true);
    return;
  }
  try {
    const res = await API.post('/api/reports', r);
    showResult(res, false);
  } catch (e) {
    Queue.push(r);
    showResult(null, true);
  }
}

function shrinkPhoto(file) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const scale = Math.min(1, 640 / img.width);
      c.width = img.width * scale; c.height = img.height * scale;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

function showResult(res, offline) {
  view.innerHTML = '';
  if (offline) {
    view.appendChild(el('div', 'triage-banner medium',
      `<div class="big">💾 ${t('report_saved_offline')}</div>`));
  } else {
    const band = res.triage_band;
    view.appendChild(el('div', `triage-banner ${band}`, `
      <div class="big">${band === 'high' ? '🚨' : band === 'medium' ? '⚠️' : '✅'} ${t('triage_' + band)}</div>
      <div style="margin-top:6px;font-size:14.5px">${t('vet_notified')}</div>
      ${band !== 'low' ? `<div style="margin-top:4px;font-size:14.5px"><b>⛔ ${t('do_not_move')}</b></div>` : ''}
      <div class="mono" style="margin-top:10px;font-size:12px;opacity:.85">${t('case_id')}: #${res.id}</div>`));
    if (res.suspected_names && res.suspected_names.length) {
      view.appendChild(el('div', 'card', `<h3>Triage (not a diagnosis)</h3>
        ${res.suspected_names.map(n => `<span class="chip medium" style="margin:2px">${esc(n)}?</span>`).join('')}
        ${res.zoonotic ? `<div style="margin-top:8px"><span class="chip zoo">☣ One Health — zoonotic risk</span></div>` : ''}
        <div class="muted" style="font-size:12px;margin-top:8px">
          ${(res.triage_reasons || []).map(x => '• ' + esc(x)).join('<br>')}</div>`));
    }
  }
  const home = el('button', 'btn', '🏠 ' + t('home'));
  home.style.cssText = 'width:100%;margin-top:14px;padding:14px';
  home.onclick = () => { state.tab = 'home'; renderNav(); render(); };
  view.appendChild(home);
}

/* --------------------------------- ANIMALS -------------------------------- */
async function animals() {
  view.innerHTML = `<div style="font-family:var(--f-d);font-size:20px;font-weight:700;
    margin:4px 0 14px">🐄 ${t('my_animals')}</div>`;
  let list = [];
  try { list = await API.get('/api/animals'); } catch (e) {}
  if (!list.length) view.appendChild(el('div', 'muted', 'No animals / इंटरनेट आवश्यक'));
  list.forEach(a => {
    const em = SPECIES.find(s => s.k === a.species)?.em || '🐄';
    const lastVacc = a.vaccinations[0];
    view.appendChild(el('div', 'card', `
      <div style="display:flex;gap:12px;align-items:center">
        <div style="font-size:32px">${em}</div>
        <div style="flex:1">
          <b>${t(a.species)}</b> · ${esc(a.breed || '')} · ${a.sex === 'F' ? '♀' : '♂'} ·
          ${Math.round(a.age_months / 12 * 10) / 10} yr
          <div class="mono" style="font-size:11px;color:var(--muted)">🏷 ${esc(a.tag_id)}</div>
        </div>
        <div style="text-align:right;font-size:12px">
          ${lastVacc ? `<span class="chip low">${t('vaccinated')}</span>
            <div class="mono" style="font-size:10px;margin-top:3px">${esc(lastVacc.disease)} · ${esc(lastVacc.given_on)}</div>`
          : `<span class="chip high">${t('due')}</span>`}
        </div>
      </div>`)).style.marginBottom = '10px';
  });
}

/* --------------------------------- SERVICES ------------------------------- */
async function services() {
  view.innerHTML = `<div style="font-family:var(--f-d);font-size:20px;font-weight:700;
    margin:4px 0 14px">🤝 ${t('services')}</div>`;

  /* ---- compensation claims ---- */
  const claimCard = el('div', 'card');
  claimCard.style.marginBottom = '12px';
  claimCard.innerHTML = `<h3>💰 ${t('claims')}</h3>`;
  view.appendChild(claimCard);
  try {
    const [claims, reports] = await Promise.all([
      API.get('/api/claims/mine'), API.get('/api/reports/mine')]);
    const claimedCases = new Set(claims.map(c => c.case_id));
    // existing claims
    if (claims.length) {
      claims.forEach(cl => {
        const st = { FILED: ['📨', 'var(--navy)'], UNDER_REVIEW: ['🔎', 'var(--amber)'],
                     APPROVED: ['✅', 'var(--green)'], PAID: ['💸', 'var(--green)'],
                     REJECTED: ['❌', 'var(--red)'] }[cl.status] || ['•', 'var(--muted)'];
        claimCard.appendChild(el('div', '', `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;
            border-bottom:1px solid var(--surface-2)">
            <span style="font-size:22px">${st[0]}</span>
            <div style="flex:1"><b>₹${cl.amount.toLocaleString('en-IN')}</b> ·
              ${t(cl.species)} · ${t('case_id')} #${cl.case_id}
              <div class="mono" style="font-size:10.5px;color:var(--muted)">${fmtDT(cl.filed_at)}</div></div>
            <b style="color:${st[1]};font-size:12.5px">${cl.status.replace('_', ' ')}</b>
          </div>`));
      });
    } else {
      claimCard.appendChild(el('div', 'muted', t('no_claims')));
    }
    // eligible unclaimed cases (deaths or confirmed)
    const eligible = reports.filter(r =>
      (r.dead_count > 0 || r.status === 'CONFIRMED') && !claimedCases.has(r.id));
    eligible.slice(0, 3).forEach(r => {
      const row = el('div', '', `
        <div style="display:flex;align-items:center;gap:10px;padding:10px;margin-top:9px;
          background:var(--saffron-soft);border-radius:10px">
          <div style="flex:1;font-size:13.5px"><b>${t('claim_eligible')}</b> —
            ${t(r.species)} · #${r.id}
            ${r.dead_count ? `· ☠ ${r.dead_count}` : ''}</div>
        </div>`);
      const b = el('button', 'btn saffron sm', t('file_claim'));
      b.onclick = async () => {
        try {
          const cl = await API.post('/api/claims', { case_id: r.id });
          toast(`✅ ${t('claim_filed')} ₹${cl.amount.toLocaleString('en-IN')}`, 'ok');
          render();
        } catch (e) { toast(e.message, 'err'); }
      };
      row.firstElementChild.appendChild(b);
      claimCard.appendChild(row);
    });
  } catch (e) { claimCard.appendChild(el('div', 'muted', '—')); }

  /* ---- vaccination camps ---- */
  const campCard = el('div', 'card');
  campCard.style.marginBottom = '12px';
  campCard.innerHTML = `<h3>💉 ${t('camps')}</h3>`;
  view.appendChild(campCard);
  try {
    const camps = await API.get('/api/camps?mine=true');
    if (!camps.length) campCard.appendChild(el('div', 'muted', '—'));
    camps.forEach(c => {
      campCard.appendChild(el('div', '', `
        <div style="display:flex;gap:10px;align-items:center;padding:9px 0;
          border-bottom:1px solid var(--surface-2)">
          <span style="font-size:22px">💉</span>
          <div style="flex:1"><b>${esc(c.disease_name_mr || c.disease_name)}</b>
            <div style="font-size:12.5px" class="muted">📍 ${esc(c.village)} ·
              📅 ${esc(c.date)}</div></div>
          <span class="chip low">${t('free')}</span></div>`));
    });
  } catch (e) { campCard.appendChild(el('div', 'muted', '—')); }

  /* ---- disease guide from the KB ---- */
  const guideCard = el('div', 'card');
  guideCard.style.marginBottom = '12px';
  guideCard.innerHTML = `<h3>📖 ${t('guide')}</h3>`;
  view.appendChild(guideCard);
  const syms = (KB && KB.symptoms) || {};
  Object.entries((KB && KB.diseases) || {}).forEach(([k, d]) => {
    const det = el('details');
    det.style.cssText = 'border-bottom:1px solid var(--surface-2);padding:8px 0';
    const signs = Object.keys(d.signs || {}).slice(0, 4)
      .map(s => `${(syms[s] || {}).icon || ''} ${esc((syms[s] || {})[LANG] || s)}`).join(' · ');
    det.innerHTML = `
      <summary style="cursor:pointer;font-weight:700;font-size:15px;list-style:none;
        display:flex;align-items:center;gap:8px">
        <span>${d.zoonotic ? '☣' : '🦠'}</span>
        <span style="flex:1">${esc((d.name || {})[LANG] || d.name.en)}</span>
        <span class="chip ${d.severity === 'critical' || d.severity === 'high' ? 'high' : 'medium'}"
          style="font-size:9px">${esc(d.severity)}</span></summary>
      <div style="font-size:13px;margin:8px 0 4px;padding-left:28px">
        <div class="muted">${signs}</div>
        <div style="margin-top:7px;padding:9px 11px;background:var(--green-soft);
          border-radius:8px"><b>${t('what_to_do')}:</b>
          ${esc((d.action || {})[LANG] || (d.action || {}).en || '')}</div>
        ${d.zoonotic ? `<div style="margin-top:6px;color:var(--red);font-weight:600;
          font-size:12.5px">☣ ${LANG === 'mr' ? 'हा रोग माणसांनाही होऊ शकतो — काळजी घ्या!' :
          LANG === 'hi' ? 'यह रोग मनुष्यों में भी फैल सकता है!' :
          'This disease can spread to humans!'}</div>` : ''}
      </div>`;
    guideCard.appendChild(det);
  });

  /* ---- helpline ---- */
  view.appendChild(el('div', 'card', `<h3>☎️ ${t('helpline')}</h3>
    <div style="display:flex;gap:12px;align-items:center">
      <div style="font-family:var(--f-d);font-size:34px;font-weight:700;color:var(--saffron)">1962</div>
      <div style="font-size:13px" class="muted">${t('ivr_hint')}<br>
        <a href="/ivr.html">IVR डेमो →</a></div></div>`));
}

/* ---------------------------------- ALERTS -------------------------------- */
async function alerts() {
  view.innerHTML = `<div style="font-family:var(--f-d);font-size:20px;font-weight:700;
    margin:4px 0 14px">🔔 ${t('advisories')}</div>`;
  let list = [];
  try { list = await API.get('/api/alerts?role=farmer&lang=' + LANG); } catch (e) {}
  if (!list.length) view.appendChild(el('div', 'muted', '—'));
  list.forEach(a => {
    view.appendChild(el('div', `alert-item ${a.severity}`, `
      <div class="t">${esc(a.title.replace(/^\[\w+\]\s*/, ''))}</div>
      <div class="b">${esc(a.body)}</div>
      <div class="meta">${a.village ? '📍 ' + esc(a.village) + ' · ' : ''}${fmtDT(a.created_at)}</div>`));
  });
}
