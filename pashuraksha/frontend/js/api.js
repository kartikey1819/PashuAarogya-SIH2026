/* PashuRaksha shared API client + offline report queue + helpers */
const API = {
  base: '',
  token: localStorage.getItem('pr_token') || '',
  user: JSON.parse(localStorage.getItem('pr_user') || 'null'),

  async call(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    const res = await fetch(this.base + path, { ...opts, headers });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).detail || msg; } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  },
  get(p) { return this.call(p); },
  post(p, body) { return this.call(p, { method: 'POST', body: JSON.stringify(body || {}) }); },

  setSession(token, user) {
    this.token = token; this.user = user;
    localStorage.setItem('pr_token', token);
    localStorage.setItem('pr_user', JSON.stringify(user));
  },
  logout() {
    localStorage.removeItem('pr_token'); localStorage.removeItem('pr_user');
    location.href = '/';
  },
  requireRole(...roles) {
    if (!this.user || !roles.includes(this.user.role)) location.href = '/';
  },
};

/* ------------------------- offline queue (farmer reports) ------------------ */
const Queue = {
  KEY: 'pr_queue',
  all() { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); },
  save(q) { localStorage.setItem(this.KEY, JSON.stringify(q)); },
  push(report) {
    const q = this.all();
    report.client_uuid = report.client_uuid ||
      ('cx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    q.push(report); this.save(q);
    return report.client_uuid;
  },
  async flush() {
    let q = this.all();
    if (!q.length) return 0;
    let sent = 0;
    for (const r of [...q]) {
      try {
        await API.post('/api/reports', r);
        q = q.filter(x => x.client_uuid !== r.client_uuid);
        this.save(q); sent++;
      } catch (e) {
        if (!navigator.onLine) break;   // still offline — stop trying
        // server rejected (validation) — drop so the queue can't jam
        q = q.filter(x => x.client_uuid !== r.client_uuid);
        this.save(q);
      }
    }
    return sent;
  },
  count() { return this.all().length; },
};

window.addEventListener('online', async () => {
  netbar(false);
  const n = await Queue.flush();
  if (n) toast(`✅ ${n} report(s) synced to server`, 'ok');
  document.dispatchEvent(new CustomEvent('pr-synced'));
});
window.addEventListener('offline', () => netbar(true));

function netbar(off) {
  const el = document.getElementById('netbar');
  if (el) el.classList.toggle('off', off);
}

/* -------------------------------- UI helpers ------------------------------ */
function toast(msg, cls = '') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'show ' + cls;
  clearTimeout(t._h); t._h = setTimeout(() => t.className = '', 3200);
}
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function fmtDT(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ' +
         d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function bandColor(b) {
  return { high: '#B23A2C', moderate: '#C97B18', medium: '#C97B18', low: '#1B7A46' }[b] || '#1B7A46';
}

/* service worker registration (offline shell) */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
