/* Farmer mobile app — voice-first symptom reporting, offline queue, animals,
   advisories. Marathi default. */
API.requireRole('farmer', 'field');

let KB = null;
const _hash = (location.hash || '').slice(1);
let state = { tab: ['home', 'report', 'animals', 'services', 'alerts'].includes(_hash) ? _hash : 'home',
  step: 0,
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
  initAssistant();
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
  animView(view);
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

function shrinkPhoto(file, max = 640) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const scale = Math.min(1, max / img.width);
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
    const advice = adviceFor(res.suspected_names);
    const hc = homeCareText(state.report.species, state.report.symptoms, res.suspected_names);
    if (hc) {
      view.appendChild(el('div', 'card', `<h3>🏠 ${t('home_care')}</h3>
        <div style="font-size:15px;line-height:1.55">${esc(hc)}</div>
        <div class="muted" style="font-size:12px;margin-top:8px">${t('then_report')}</div>`));
    }
    if (res.suspected_names && res.suspected_names.length) {
      view.appendChild(el('div', 'card', `<h3>Triage (not a diagnosis)</h3>
        ${res.suspected_names.map(n => `<span class="chip medium" style="margin:2px">${esc(n)}?</span>`).join('')}
        ${res.zoonotic ? `<div style="margin-top:8px"><span class="chip zoo">☣ One Health — zoonotic risk</span></div>` : ''}
        ${advice ? `<div style="margin-top:10px;padding:10px 12px;background:var(--green-soft);border-radius:10px;font-size:14px">
          <b>${t('what_to_do')}:</b> ${esc(advice)}</div>` : ''}
        <div class="muted" style="font-size:12px;margin-top:8px">
          ${(res.triage_reasons || []).map(x => '• ' + esc(x)).join('<br>')}</div>`));
    }
    // Pashu Mitra: read the result aloud
    const spoken = [t('triage_' + band), band !== 'low' ? t('do_not_move') : '',
                    hc ? t('home_care') + ': ' + hc : advice].filter(Boolean).join('. ');
    const sp = el('button', 'btn outline', `🔊 ${t('listen')}`);
    sp.style.cssText = 'width:100%;margin-top:12px;padding:13px;font-size:16px';
    sp.onclick = () => speak(spoken);
    view.appendChild(sp);
    setTimeout(() => speak(spoken), 400);
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

  /* ---- Pashu Lens: AI breed/type identification (PashuPehchaan model) ---- */
  const lens = el('div', 'card');
  lens.style.cssText = 'margin-bottom:12px;border-color:#F2CBA8;background:linear-gradient(160deg,#FFF9F4,#fff 55%)';
  lens.innerHTML = `<h3 style="display:flex">📸 ${t('lens_title')}
      <span id="aiBadge" class="chip info" style="margin-left:auto;font-size:9px">…</span></h3>
    <div class="muted" style="font-size:12.5px;margin:-4px 0 10px">${t('lens_hint')}</div>
    <input type="file" accept="image/*" capture="environment" id="lensFile" hidden>
    <button class="btn saffron" id="lensBtn" style="width:100%;padding:14px;font-size:16px">📷 ${t('take_photo')}</button>
    <div id="lensOut"></div>`;
  view.appendChild(lens);
  API.get('/api/ai/status').then(s => {
    const b = document.getElementById('aiBadge'); if (!b) return;
    const ok = s.available && s.model_loaded;
    b.textContent = ok ? `AI ✓ ${s.labels || 50} ${t('breeds')}` : t('ai_offline');
    b.className = 'chip ' + (ok ? 'low' : 'medium');
    b.style.cssText = 'margin-left:auto;font-size:9px';
  }).catch(() => {});
  const fileIn = lens.querySelector('#lensFile');
  lens.querySelector('#lensBtn').onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; if (!f) return;
    const out = lens.querySelector('#lensOut');
    const dataUrl = await shrinkPhoto(f, 800);
    out.innerHTML = `<img src="${dataUrl}" style="width:100%;border-radius:12px;margin-top:12px">
      <div class="muted" style="text-align:center;padding:10px">🔎 ${t('identifying')}…</div>`;
    try { renderLens(out, await API.post('/api/ai/identify', { image: dataUrl }), dataUrl); }
    catch (e) { out.innerHTML += `<div style="color:var(--red)">${esc(e.message)}</div>`; }
  };

  let list = [];
  try { list = await API.get('/api/animals'); } catch (e) {}
  if (!list.length) view.appendChild(el('div', 'muted', 'No animals / इंटरनेट आवश्यक'));
  list.forEach(a => {
    const em = SPECIES.find(s => s.k === a.species)?.em || '🐄';
    const lastVacc = a.vaccinations[0];
    const pm = a.permit || {};
    const pmCls = { ALLOWED: 'low', BLOCKED: 'high', HOLD: 'medium' }[pm.status] || 'info';
    const card = el('div', 'card', `
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
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px">
        <span class="chip ${pmCls}">${pm.status === 'ALLOWED' ? '✅' : pm.status === 'BLOCKED' ? '⛔' : '⏸'}
          ${t('permit_' + (pm.status || 'ALLOWED'))}</span>
        ${a.withdrawal ? `<span class="chip high">🥛 ${t('milk_withdrawal')} · ${a.withdrawal.days_left} ${LANG === 'en' ? 'days' : 'दिवस'}</span>` : ''}
        <a class="btn sm outline" style="margin-left:auto;padding:5px 11px" target="_blank"
           href="/passport.html?tag=${encodeURIComponent(a.tag_id)}">🪪 ${t('passport')}</a>
      </div>`);
    card.style.marginBottom = '10px';
    view.appendChild(card);
  });
}

function renderLens(out, r, dataUrl) {
  const img = `<img src="${dataUrl}" style="width:100%;border-radius:12px;margin-top:12px">`;
  if (!r.available) {
    out.innerHTML = img + `<div class="card" style="margin-top:10px;background:var(--amber-soft)">
      <b>⚠ ${t('ai_not_running')}</b>
      <div class="muted" style="font-size:12px;margin-top:4px">${esc(r.detail || '')}</div></div>`;
    return;
  }
  if (!r.success) {
    out.innerHTML = img + `<div class="card" style="margin-top:10px;background:var(--amber-soft)">
      <b>${r.not_animal ? '🚫' : '📷'} ${esc(r.error || '')}</b>
      ${r.quality ? `<div class="muted" style="font-size:12px;margin-top:4px">Photo quality ${r.quality.score}/100</div>` : ''}
      <button class="btn sm outline" style="margin-top:8px" onclick="document.getElementById('lensFile').click()">↻ ${t('retake')}</button></div>`;
    return;
  }
  const conf = Math.round((r.best_confidence || 0) * 100);
  const bandC = { high: 'var(--green)', medium: 'var(--amber)', low: 'var(--red)' }[r.band];
  const spEm = r.species_app === 'buffalo' ? '🐃' : '🐄';
  const name = LANG === 'en' ? r.best_label : r.best_label_mr;
  out.innerHTML = img + `
    <div class="card" style="margin-top:10px">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:36px">${spEm}</span>
        <div style="flex:1"><div style="font-family:var(--f-d);font-size:22px;font-weight:700;line-height:1.1">${esc(name)}</div>
          <div class="muted" style="font-size:13px">${t(r.species_app)} · ${esc(r.best_label)}</div></div>
        <div style="text-align:center"><div style="font-family:var(--f-d);font-size:26px;font-weight:700;color:${bandC}">${conf}%</div>
          <div class="muted" style="font-size:10px;letter-spacing:.06em">${t('confidence').toUpperCase()}</div></div>
      </div>
      <div class="bar-track" style="margin-top:10px"><div class="bar-fill ${r.band === 'high' ? '' : r.band === 'medium' ? 'warn' : 'crit'}" style="width:${conf}%"></div></div>
      <div style="margin-top:10px;display:flex;gap:5px;flex-wrap:wrap">${(r.top3 || []).map((c, i) =>
        `<span class="chip ${i ? 'info' : 'low'}">${esc(LANG === 'en' ? c.label : c.label_mr)} ${Math.round(c.confidence * 100)}%</span>`).join('')}</div>
      ${r.band === 'low' ? `<div class="muted" style="font-size:12px;margin-top:8px">⚠ ${t('ai_low_conf')}</div>` : ''}
      <div class="muted" style="font-size:10.5px;margin-top:8px;font-family:var(--f-m)">
        EfficientNetV2 · ${r.frames_analysed || 1} frame · ${r.latency_ms} ms · quality ${(r.quality || {}).score}/100 · subject gate ${((r.subject_gate || {}).confidence) || '—'}</div>
      <button class="btn green" id="lensReg" style="width:100%;margin-top:12px;padding:13px">✅ ${t('register_animal')}</button>
    </div>`;
  out.querySelector('#lensReg').onclick = async () => {
    try {
      const a = await API.post('/api/animals', { species: r.species_app, breed: r.best_label, sex: 'F', age_months: 36 });
      toast(`✅ ${t('registered')} · 🏷 ${a.tag_id}`, 'ok');
      render();
    } catch (e) { toast(e.message, 'err'); }
  };
}

/* speak() is provided by assistant.js (shared voice engine) */

/* Client-side suspicion from the KB (same weighted-signs logic as the server
   triage) — lets the assistant give home care before the report is filed. */
function suspectDiseases(species, symptoms) {
  const out = [];
  for (const [k, d] of Object.entries((KB && KB.diseases) || {})) {
    if (species && d.species && !d.species.includes(species)) continue;
    const score = (symptoms || []).reduce((s, c) => s + ((d.signs || {})[c] || 0), 0);
    if (score >= (d.min_score || 6)) out.push([k, d, score]);
  }
  return out.sort((a, b) => b[2] - a[2]);
}
function homeCareText(species, symptoms, names) {
  // 1) disease-level home care for the best suspicion (by names or by symptoms)
  const ds = (KB && KB.diseases) || {};
  let d = null;
  for (const n of names || []) {
    d = Object.values(ds).find(x => x.name && (x.name.en === n || x.name[LANG] === n)) || d;
    if (d) break;
  }
  if (!d) { const s = suspectDiseases(species, symptoms); if (s.length) d = s[0][1]; }
  const hc = d && d.home_care && (d.home_care[LANG] || d.home_care.en);
  if (hc) return hc;
  // 2) symptom-level first aid
  const fa = (KB && KB.symptom_first_aid) || {};
  const tips = (symptoms || []).map(c => fa[c] && (fa[c][LANG] || fa[c].en)).filter(Boolean);
  return tips.length ? tips.join('. ') + '.' : '';
}
function adviceFor(names) {
  const ds = (KB && KB.diseases) || {};
  for (const n of names || []) {
    for (const d of Object.values(ds)) {
      const nm = d.name || {};
      if (nm.en === n || nm[LANG] === n) return (d.action || {})[LANG] || (d.action || {}).en || '';
    }
  }
  return '';
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

  /* ---- disease guide from the KB — grouped like the 1962 Farmers App ---- */
  const guideCard = el('div', 'card');
  guideCard.style.marginBottom = '12px';
  guideCard.innerHTML = `<h3>📖 ${t('guide')}</h3>
    <div class="muted" style="font-size:11.5px;margin:-6px 0 8px">
      ${LANG === 'mr' ? 'राष्ट्रीय पशुरोग नियंत्रण कार्यक्रमातील (LHDCP) प्रमुख रोग' :
        LANG === 'hi' ? 'राष्ट्रीय पशुरोग नियंत्रण कार्यक्रम (LHDCP) के प्रमुख रोग' :
        'Major diseases under the national LHDCP programme'}</div>`;
  view.appendChild(guideCard);
  const syms = (KB && KB.symptoms) || {};
  const CATS = {
    cattle_buffalo: { em: '🐄🐃', mr: 'गाय-म्हैस रोग', hi: 'गाय-भैंस रोग', en: 'Cattle & Buffalo' },
    sheep_goat:     { em: '🐐🐑', mr: 'शेळ्या-मेंढ्या रोग', hi: 'बकरी-भेड़ रोग', en: 'Goat & Sheep' },
    poultry:        { em: '🐔',   mr: 'कुक्कुट रोग', hi: 'मुर्गी रोग', en: 'Poultry' },
    pig:            { em: '🐖',   mr: 'वराह रोग', hi: 'सूअर रोग', en: 'Pig' },
    zoonotic:       { em: '☣️',   mr: 'माणसांनाही होणारे रोग', hi: 'मनुष्यों में फैलने वाले', en: 'Zoonotic — spread to humans' },
    general:        { em: '🩹',   mr: 'सर्वसाधारण', hi: 'सामान्य', en: 'General' },
  };
  const byCat = {};
  Object.entries((KB && KB.diseases) || {}).forEach(([k, d]) => {
    (byCat[d.category || 'general'] = byCat[d.category || 'general'] || []).push([k, d]);
  });
  Object.keys(CATS).filter(c => byCat[c]).forEach(cat => {
    guideCard.appendChild(el('div', '', `
      <div style="font-family:var(--f-d);font-weight:700;font-size:13.5px;color:var(--navy);
        letter-spacing:.05em;text-transform:uppercase;margin:14px 0 2px;display:flex;
        align-items:center;gap:7px"><span>${CATS[cat].em}</span>
        ${esc(CATS[cat][LANG] || CATS[cat].en)}
        <span style="flex:1;height:1px;background:var(--hair)"></span></div>`));
    byCat[cat].forEach(([k, d]) => renderDisease(guideCard, k, d, syms));
  });
  function renderDisease(guideCard, k, d) {
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
        ${d.home_care ? `<div style="margin-top:6px;padding:9px 11px;background:var(--saffron-soft);
          border-radius:8px"><b>🏠 ${t('home_care')}:</b>
          ${esc(d.home_care[LANG] || d.home_care.en || '')}</div>` : ''}
        ${d.zoonotic ? `<div style="margin-top:6px;color:var(--red);font-weight:600;
          font-size:12.5px">☣ ${LANG === 'mr' ? 'हा रोग माणसांनाही होऊ शकतो — काळजी घ्या!' :
          LANG === 'hi' ? 'यह रोग मनुष्यों में भी फैल सकता है!' :
          'This disease can spread to humans!'}</div>` : ''}
      </div>`;
    guideCard.appendChild(det);
  }

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
    const item = el('div', `alert-item ${a.severity}`, `
      <div class="t">${esc(a.title.replace(/^\[\w+\]\s*/, ''))}</div>
      <div class="b">${esc(a.body)}</div>
      <div class="meta" style="display:flex;align-items:center;gap:8px">
        <span>${a.village ? '📍 ' + esc(a.village) + ' · ' : ''}${fmtDT(a.created_at)}</span>
        <button class="btn sm outline" style="margin-left:auto;padding:3px 10px">🔊 ${t('listen')}</button></div>`);
    item.querySelector('button').onclick = () => speak(a.title.replace(/^\[\w+\]\s*/, '') + '. ' + a.body);
    view.appendChild(item);
  });
}

/* ------------------------------ PASHU MITRA -------------------------------- */
/* Voice assistant skills for the farmer app. Each skill: match(ql) + run(q, ql)
   returning {text, actions?, spoken?}. Keywords cover Hindi, Marathi, English. */
window.PR = {
  goTab(tab) { state.tab = tab; if (tab === 'report') resetReport(); renderNav(); render(); },
  startReport(species, symptoms) {
    resetReport(); state.tab = 'report';
    if (species) { state.report.species = species; state.step = 1; }
    if (symptoms && symptoms.length) { state.report.symptoms = symptoms; state.step = species ? 2 : 1; }
    renderNav(); render();
  },
};

function initAssistant() {
  const L = (hi, mr, en) => (LANG === 'mr' ? mr : LANG === 'en' ? en : hi);
  const kw = PashuMitra.kw;
  const SPK = { cattle: ['गाय', 'गाई', 'गायी', 'cow', 'cattle', 'बैल', 'बछड़', 'वासरू'],
                buffalo: ['भैंस', 'भैस', 'म्हैस', 'म्हशी', 'buffalo', 'रेडा'],
                goat: ['बकरी', 'बकर', 'शेळी', 'शेळ्या', 'goat'],
                sheep: ['भेड़', 'भेड', 'मेंढी', 'मेंढ्या', 'sheep'],
                poultry: ['मुर्गी', 'मुर्गा', 'कोंबडी', 'कोंबड्या', 'poultry', 'chicken', 'hen'] };
  const findSpecies = ql => Object.keys(SPK).find(k => kw(ql, SPK[k]));
  const kbDisease = ql => {
    for (const [k, d] of Object.entries((KB && KB.diseases) || {})) {
      const names = Object.values(d.name || {}).map(x => String(x).toLowerCase());
      if (names.some(n => n && ql.includes(n.split(' ')[0]) && n.split(' ')[0].length > 2)) return [k, d];
    }
    return null;
  };

  const skills = [
    { // report a sick animal (optionally with species + symptoms in the sentence)
      match: ql => kw(ql, ['बीमार', 'बिमार', 'आजारी', 'तक्रार', 'शिकायत', 'रिपोर्ट', 'report', 'sick', 'दर्ज', 'मर गई', 'मर गया', 'मेली', 'मेला', 'died']),
      run: (q, ql) => {
        const sp = findSpecies(ql);
        const syms = (typeof parseVoice === 'function') ? parseVoice(q) : [];
        const spName = sp ? t(sp) : '';
        // home care first — what to do right now — then the report
        const hc = syms.length ? homeCareText(sp, syms, []) : '';
        const sus = syms.length ? suspectDiseases(sp, syms) : [];
        const susName = sus.length ? ((sus[0][1].name || {})[LANG] || sus[0][1].name.en) : '';
        let text;
        if (sp && hc) {
          text = L(`${spName} के लक्षण ${susName ? '<b>' + esc(susName) + '</b> जैसे लगते हैं। ' : ''}<b>🏠 घर पर अभी:</b> ${esc(hc)}<br><b>${t('then_report')}</b>`,
                   `${spName}ची लक्षणे ${susName ? '<b>' + esc(susName) + '</b> सारखी वाटतात. ' : ''}<b>🏠 घरी आत्ता:</b> ${esc(hc)}<br><b>${t('then_report')}</b>`,
                   `${spName}'s signs look ${susName ? 'consistent with <b>' + esc(susName) + '</b>. ' : 'concerning. '}<b>🏠 Home care now:</b> ${esc(hc)}<br><b>${t('then_report')}</b>`);
        } else if (sp) {
          text = L(`ठीक है — ${spName} की शिकायत दर्ज करते हैं। अब लक्षण चुनिए, फिर मैं घर पर करने योग्य उपाय बताऊँगा।`,
                   `ठीक — ${spName}ची तक्रार नोंदवूया. आता लक्षणे निवडा, मग घरगुती उपाय सांगतो.`,
                   `Okay — filing a report for ${spName}. Pick the symptoms and I'll suggest home care.`);
        } else {
          text = L('कौन सा जानवर बीमार है? नीचे चुनिए।', 'कोणते जनावर आजारी आहे? खाली निवडा.', 'Which animal is sick? Choose below.');
        }
        return { text, actions: [{ label: L('📢 शिकायत दर्ज करें', '📢 तक्रार नोंदवा', '📢 File report'),
                                    run: () => PR.startReport(sp, syms) }] };
      } },
    { // vaccination camps
      match: ql => kw(ql, ['शिविर', 'टीका', 'टीकाकरण', 'लसीकरण', 'लस ', 'camp', 'vaccin', 'लसी']),
      run: async () => {
        const camps = await API.get('/api/camps?mine=true');
        if (!camps.length) return { text: L('अभी आपके क्षेत्र में कोई शिविर नहीं है।', 'सध्या तुमच्या भागात शिबिर नाही.', 'No camp scheduled in your area right now.') };
        const c = camps[0];
        const nm = LANG === 'en' ? c.disease_name : (c.disease_name_mr || c.disease_name);
        return { text: L(`आपके क्षेत्र में <b>${esc(nm)}</b> टीकाकरण शिविर <b>${esc(c.village)}</b> में <b>${esc(c.date)}</b> को है — मुफ़्त। कुल ${camps.length} शिविर।`,
                         `तुमच्या भागात <b>${esc(nm)}</b> लसीकरण शिबिर <b>${esc(c.village)}</b> येथे <b>${esc(c.date)}</b> रोजी — मोफत. एकूण ${camps.length} शिबिरे.`,
                         `A free <b>${esc(nm)}</b> camp is at <b>${esc(c.village)}</b> on <b>${esc(c.date)}</b>. ${camps.length} camp(s) in total.`),
                 actions: [{ label: L('💉 सभी शिविर देखें', '💉 सर्व शिबिरे', '💉 See all camps'), run: () => PR.goTab('services') }] };
      } },
    { // compensation claims
      match: ql => kw(ql, ['मुआवजा', 'मुआवज़ा', 'भरपाई', 'दावा', 'claim', 'पैसा', 'पैसे', 'compensation', 'नुकसान']),
      run: async () => {
        const cl = await API.get('/api/claims/mine');
        if (!cl.length) return { text: L('अभी कोई दावा नहीं है। मृत्यु की रिपोर्ट के बाद "सेवा" में दावा करें।', 'सध्या दावा नाही. मृत्यूची तक्रार केल्यावर "सेवा" मध्ये दावा करा.', 'No claims yet. After reporting a death, file one under Services.'),
                                 actions: [{ label: L('🤝 सेवा', '🤝 सेवा', '🤝 Services'), run: () => PR.goTab('services') }] };
        const c = cl[0];
        const st = { FILED: L('दर्ज', 'दाखल', 'filed'), UNDER_REVIEW: L('जाँच में', 'तपासणीत', 'under review'),
                     APPROVED: L('मंज़ूर ✅', 'मंजूर ✅', 'approved ✅'), PAID: L('भुगतान हो गया 💸', 'रक्कम जमा 💸', 'paid 💸'),
                     REJECTED: L('अस्वीकृत', 'नाकारला', 'rejected') }[c.status] || c.status;
        return { text: L(`आपका दावा #${c.id} — ₹${c.amount.toLocaleString('en-IN')} — <b>${st}</b> है।`,
                         `तुमचा दावा #${c.id} — ₹${c.amount.toLocaleString('en-IN')} — <b>${st}</b>.`,
                         `Your claim #${c.id} for ₹${c.amount.toLocaleString('en-IN')} is <b>${st}</b>.`),
                 actions: [{ label: L('💰 दावे देखें', '💰 दावे पहा', '💰 View claims'), run: () => PR.goTab('services') }] };
      } },
    { // weather
      match: ql => kw(ql, ['मौसम', 'हवामान', 'weather', 'बारिश', 'पाऊस', 'तापमान', 'गर्मी']),
      run: async () => {
        const w = await API.get('/api/myweather');
        const x = w.weather || {};
        return { text: L(`${esc(w.village)} में आज ${Math.round(x.temp_c)}°C, नमी ${Math.round(x.humidity)}%, बारिश ${x.rain_mm || 0} मिमी। ${x.humidity > 70 ? 'नमी ज़्यादा है — मक्खी-मच्छर बढ़ेंगे, जानवरों को साफ़ रखें।' : ''}`,
                         `${esc(w.village)} येथे आज ${Math.round(x.temp_c)}°C, आर्द्रता ${Math.round(x.humidity)}%, पाऊस ${x.rain_mm || 0} मिमी. ${x.humidity > 70 ? 'आर्द्रता जास्त — माश्या वाढतील, गोठा स्वच्छ ठेवा.' : ''}`,
                         `${esc(w.village)} today: ${Math.round(x.temp_c)}°C, humidity ${Math.round(x.humidity)}%, rain ${x.rain_mm || 0} mm.`) };
      } },
    { // disease info from the knowledge base
      match: ql => !!kbDisease(ql),
      run: (q, ql) => {
        const [k, d] = kbDisease(ql);
        const syms = (KB && KB.symptoms) || {};
        const signs = Object.keys(d.signs || {}).slice(0, 4).map(s => (syms[s] || {})[LANG] || s).join(', ');
        const nm = (d.name || {})[LANG] || d.name.en;
        return { text: `<b>${esc(nm)}</b>${d.zoonotic ? ' ☣' : ''}<br>${L('लक्षण', 'लक्षणे', 'Signs')}: ${esc(signs)}<br>${L('क्या करें', 'काय करावे', 'What to do')}: ${esc((d.action || {})[LANG] || d.action.en)}`,
                 actions: [{ label: L('📢 शिकायत करें', '📢 तक्रार करा', '📢 Report'), run: () => PR.startReport(null, []) }] };
      } },
    { // my animals
      match: ql => kw(ql, ['मेरे जानवर', 'जानवर', 'पशु', 'माझी जनावरे', 'जनावरे', 'animals', 'कितनी गाय', 'passport', 'पासपोर्ट']),
      run: async () => {
        const list = await API.get('/api/animals');
        const due = list.filter(a => !a.vaccinations.length).length;
        const blocked = list.filter(a => (a.permit || {}).status === 'BLOCKED').length;
        return { text: L(`आपके ${list.length} जानवर दर्ज हैं। ${due ? due + ' का टीका बाकी है। ' : ''}${blocked ? blocked + ' की आवाजाही अभी बंद है (रोग क्षेत्र)।' : ''}`,
                         `तुमची ${list.length} जनावरे नोंदली आहेत. ${due ? due + ' ची लस बाकी. ' : ''}${blocked ? blocked + ' ची वाहतूक सध्या बंद (रोग क्षेत्र).' : ''}`,
                         `You have ${list.length} animals registered. ${due ? due + ' need vaccination. ' : ''}${blocked ? blocked + ' are movement-blocked (containment zone).' : ''}`),
                 actions: [{ label: L('🐄 जानवर देखें', '🐄 जनावरे पहा', '🐄 View animals'), run: () => PR.goTab('animals') }] };
      } },
    { // latest advisory
      match: ql => kw(ql, ['सूचना', 'अलर्ट', 'alert', 'सलाह', 'सल्ला', 'advisory', 'खबर', 'बातमी']),
      run: async () => {
        const list = await API.get('/api/alerts?role=farmer&lang=' + LANG);
        if (!list.length) return { text: L('अभी कोई नई सूचना नहीं।', 'सध्या नवीन सूचना नाही.', 'No new advisories.') };
        const a = list[0];
        return { text: `<b>${esc(a.title.replace(/^\[\w+\]\s*/, ''))}</b><br>${esc(a.body)}`,
                 actions: [{ label: L('🔔 सभी सूचनाएं', '🔔 सर्व सूचना', '🔔 All alerts'), run: () => PR.goTab('alerts') }] };
      } },
    { // help / doctor / 1962
      match: ql => kw(ql, ['मदद', 'हेल्प', 'help', '1962', 'डॉक्टर', 'डाक्टर', 'पशुवैद्य', 'vet', 'फोन', 'नंबर']),
      run: () => ({ text: L('पशु एम्बुलेंस के लिए <b>1962</b> पर मुफ़्त कॉल करें — पशु चिकित्सक आपके दरवाज़े आएंगे। ऐप से रिपोर्ट करने पर भी डॉक्टर को तुरंत सूचना जाती है।',
                             'पशु रुग्णवाहिकेसाठी <b>1962</b> वर मोफत कॉल करा — पशुवैद्य दारात येतील. ॲपने तक्रार केल्यासही डॉक्टरांना लगेच कळते.',
                             'Call <b>1962</b> (free) for the animal ambulance — a vet comes to your door. Reporting in the app also alerts the vet instantly.'),
                    actions: [{ label: '☎️ IVR 1962', run: () => location.href = '/ivr.html' }] }) },
    { // navigation
      match: ql => kw(ql, ['होम', 'घर', 'मुख्य', 'home', 'वापस', 'back']),
      run: () => { PR.goTab('home'); return { text: L('मुख्य पृष्ठ खोल दिया।', 'मुख्य पान उघडले.', 'Opened home.') }; } },
  ];

  PashuMitra.init({
    page: 'farmer', offsetBottom: 92, skills,
    onAction: act => {
      if (!act) return;
      if (act.type === 'report') PR.startReport(act.species || null, act.symptoms || []);
      else if (act.type === 'tab' && act.tab) PR.goTab(act.tab);
    },
    examples: [L('मेरी गाय बीमार है, बुखार और गांठें हैं', 'माझी गाय आजारी आहे, ताप आणि गाठी', 'My cow is sick, fever and nodules'),
               L('टीकाकरण शिविर कब है?', 'लसीकरण शिबिर कधी?', 'When is the vaccination camp?'),
               L('मेरे मुआवजे का क्या हुआ?', 'माझ्या भरपाईचे काय झाले?', 'What happened to my claim?'),
               L('लम्पी रोग क्या है?', 'लम्पी रोग म्हणजे काय?', 'What is lumpy skin disease?'),
               L('आज का मौसम', 'आजचे हवामान', "Today's weather")],
  });
}
