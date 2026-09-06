/* पशु मित्र — PashuAarogya voice assistant.
   Speech in (Web Speech API) · speech out (SpeechSynthesis) · rule-based intent
   router with page-specific "skills". Hindi by default, Marathi/English on toggle.
   No cloud LLM: works offline for navigation/help, uses the platform API for data. */
(function () {
  const LANGS = { hi: 'hi-IN', mr: 'mr-IN', en: 'en-IN' };
  const lang = () => (window.LANG || localStorage.getItem('pr_lang') || 'hi');

  /* ---------------------------------------------------------- speech out --- */
  window.speak = function speak(text) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window) || !text) return resolve(false);
      const want = lang();
      const voices = speechSynthesis.getVoices();
      let v = voices.find(x => x.lang.toLowerCase().startsWith(want));
      if (!v && want === 'mr') v = voices.find(x => x.lang.toLowerCase().startsWith('hi'));
      const u = new SpeechSynthesisUtterance(text);
      if (v) u.voice = v;
      u.lang = v ? v.lang : LANGS[want] || 'hi-IN';
      u.rate = 0.95;
      u.onend = () => resolve(true); u.onerror = () => resolve(false);
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    });
  };

  /* --------------------------------------------------------------- strings -- */
  const T = {
    hi: { title: 'पशु मित्र', sub: 'आवाज़ सहायक · बोलकर पूछें',
      hint: 'बोलिए — जैसे "मेरी गाय बीमार है", "टीकाकरण शिविर कब है", "मुआवजा"',
      listening: '🎧 सुन रहा हूँ…', type: 'या यहाँ लिखें…', ask: 'पूछें',
      nosr: 'इस ब्राउज़र में आवाज़ पहचान नहीं है — नीचे लिखकर पूछें।',
      greet: 'नमस्ते! मैं पशु मित्र हूँ। बताइए, कैसे मदद करूँ?',
      fallback: 'माफ़ कीजिए, समझ नहीं आया। आप ये कह सकते हैं:', mic: 'बोलें' },
    mr: { title: 'पशु मित्र', sub: 'आवाज सहाय्यक · बोलून विचारा',
      hint: 'बोला — जसे "माझी गाय आजारी आहे", "लसीकरण शिबिर कधी", "भरपाई"',
      listening: '🎧 ऐकत आहे…', type: 'किंवा इथे लिहा…', ask: 'विचारा',
      nosr: 'या ब्राउझरमध्ये आवाज ओळख नाही — खाली लिहून विचारा.',
      greet: 'नमस्कार! मी पशु मित्र. सांगा, कशी मदत करू?',
      fallback: 'माफ करा, समजले नाही. तुम्ही असे विचारू शकता:', mic: 'बोला' },
    en: { title: 'Pashu Mitra', sub: 'Voice assistant · just ask',
      hint: 'Say — "my cow is sick", "when is the vaccination camp", "compensation"',
      listening: '🎧 Listening…', type: 'or type here…', ask: 'Ask',
      nosr: 'Voice recognition is not available in this browser — type below.',
      greet: 'Namaste! I am Pashu Mitra. How can I help?',
      fallback: "Sorry, I didn't get that. You can say:", mic: 'Speak' },
  };
  const t = k => (T[lang()] || T.hi)[k];

  /* ------------------------------------------------------------------ CSS -- */
  const CSS = `
  .pm-fab{position:fixed;right:16px;z-index:1500;width:58px;height:58px;border-radius:50%;border:0;
    background:linear-gradient(135deg,#F4801F,#E8720C);color:#fff;font-size:26px;cursor:pointer;
    box-shadow:0 10px 26px -8px rgba(232,114,12,.65),0 2px 6px rgba(0,0,0,.15);
    display:flex;align-items:center;justify-content:center;transition:transform 160ms cubic-bezier(.23,1,.32,1)}
  .pm-fab:active{transform:scale(.94)}
  .pm-fab .lbl{position:absolute;right:66px;top:50%;transform:translateY(-50%);background:#123566;color:#fff;
    font-size:12px;font-weight:600;padding:5px 10px;border-radius:8px;white-space:nowrap;font-family:var(--f-b,sans-serif);
    opacity:0;transition:opacity 200ms;pointer-events:none}
  .pm-fab:hover .lbl,.pm-fab.show-lbl .lbl{opacity:1}
  .pm-fab.rec{animation:pmpulse 1.1s infinite}
  @keyframes pmpulse{50%{box-shadow:0 0 0 14px rgba(232,114,12,.18)}}
  .pm-bg{position:fixed;inset:0;background:rgba(11,42,84,.45);z-index:1600;opacity:0;visibility:hidden;
    transition:opacity 150ms,visibility 0s linear 150ms;display:flex;align-items:flex-end;justify-content:center}
  .pm-bg.open{opacity:1;visibility:visible;transition:opacity 200ms,visibility 0s}
  .pm-sheet{background:#fff;width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:16px 18px
    calc(16px + env(safe-area-inset-bottom));max-height:82vh;display:flex;flex-direction:column;gap:10px;
    transform:translateY(24px);transition:transform 150ms cubic-bezier(.23,1,.32,1);
    box-shadow:0 -12px 40px rgba(0,0,0,.25);font-family:var(--f-b,sans-serif);color:#1C2434}
  .pm-bg.open .pm-sheet{transform:translateY(0);transition:transform 280ms cubic-bezier(.32,.72,0,1)}
  .pm-hd{display:flex;align-items:center;gap:10px}
  .pm-hd .av{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#FCEDDD,#F8D9BC);
    display:flex;align-items:center;justify-content:center;font-size:22px;border:2px solid #E8720C}
  .pm-hd b{font-family:var(--f-d,sans-serif);font-size:18px;display:block;line-height:1.05}
  .pm-hd .s{font-size:11.5px;color:#5D6579}
  .pm-x{margin-left:auto;background:#F0EEE7;border:0;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer}
  .pm-log{overflow-y:auto;display:flex;flex-direction:column;gap:8px;min-height:120px;max-height:46vh;padding:4px 2px}
  .pm-m{max-width:88%;padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.45;
    animation:pmin 220ms cubic-bezier(.23,1,.32,1)}
  @keyframes pmin{from{opacity:0;transform:translateY(6px)}}
  .pm-m.u{align-self:flex-end;background:#1B4C8C;color:#fff;border-bottom-right-radius:4px}
  .pm-m.a{align-self:flex-start;background:#F0EEE7;border-bottom-left-radius:4px}
  .pm-m.a .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
  .pm-m.a .acts button{background:#fff;border:1.5px solid #1B4C8C;color:#1B4C8C;border-radius:99px;
    padding:5px 12px;font-size:13px;font-weight:600;cursor:pointer}
  .pm-m.a .acts button:active{transform:scale(.97)}
  .pm-hint{font-size:12px;color:#5D6579;text-align:center}
  .pm-row{display:flex;gap:8px;align-items:center}
  .pm-row input{flex:1;padding:11px 13px;border:1.5px solid #DDD9CE;border-radius:12px;font-size:14.5px;
    font-family:inherit}
  .pm-mic{width:52px;height:52px;border-radius:50%;border:0;background:linear-gradient(135deg,#F4801F,#E8720C);
    color:#fff;font-size:22px;cursor:pointer;flex:0 0 52px;transition:transform 160ms cubic-bezier(.23,1,.32,1)}
  .pm-mic:active{transform:scale(.92)}
  .pm-mic.rec{background:#B23A2C;animation:pmpulse 1.1s infinite}
  .pm-ex{display:flex;gap:6px;flex-wrap:wrap}
  .pm-ex button{background:#fff;border:1px solid #DDD9CE;border-radius:99px;padding:5px 11px;font-size:12.5px;cursor:pointer}
  @media(prefers-reduced-motion:reduce){.pm-fab,.pm-sheet,.pm-m{animation:none;transition:none}}`;

  /* ------------------------------------------------------------------ core -- */
  const A = {
    skills: [], page: 'farmer', examples: [], offsetBottom: 24, rec: null, greeted: false,

    init(opts = {}) {
      Object.assign(this, opts);
      const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      const fab = document.createElement('button');
      fab.className = 'pm-fab'; fab.id = 'pmFab';
      fab.style.bottom = this.offsetBottom + 'px';
      fab.innerHTML = `🎙️<span class="lbl">${t('title')}</span>`;
      fab.title = t('title');
      fab.onclick = () => this.open(true);
      document.body.appendChild(fab);
      setTimeout(() => { fab.classList.add('show-lbl'); setTimeout(() => fab.classList.remove('show-lbl'), 3200); }, 1200);

      const bg = document.createElement('div'); bg.className = 'pm-bg'; bg.id = 'pmBg';
      bg.innerHTML = `<div class="pm-sheet" role="dialog" aria-label="${t('title')}">
        <div class="pm-hd"><div class="av">🧑‍🌾</div><div><b>${t('title')}</b><span class="s">${t('sub')}</span></div>
          <button class="pm-x" id="pmClose">✕</button></div>
        <div class="pm-log" id="pmLog"></div>
        <div class="pm-ex" id="pmEx"></div>
        <div class="pm-row"><input id="pmIn" placeholder="${t('type')}">
          <button class="pm-mic" id="pmMic" title="${t('mic')}">🎤</button></div>
        <div class="pm-hint" id="pmHint">${this.hint || t('hint')}</div></div>`;
      document.body.appendChild(bg);
      bg.onclick = e => { if (e.target === bg) this.close(); };
      document.getElementById('pmClose').onclick = () => this.close();
      document.getElementById('pmMic').onclick = () => this.listen();
      const inp = document.getElementById('pmIn');
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && inp.value.trim()) { this.handle(inp.value.trim()); inp.value = ''; } });
      const ex = document.getElementById('pmEx');
      ex.innerHTML = this.examples.map(x => `<button>${x}</button>`).join('');
      ex.querySelectorAll('button').forEach(b => b.onclick = () => this.handle(b.textContent));
      if (location.hash === '#mitra') setTimeout(() => this.open(false), 700);   // deep-link
    },

    open(autoListen = false) {
      document.getElementById('pmBg').classList.add('open');
      if (!this.greeted) { this.greeted = true; this.reply(t('greet')); }
      if (autoListen && (window.SpeechRecognition || window.webkitSpeechRecognition)) setTimeout(() => this.listen(), 350);
    },
    close() { document.getElementById('pmBg').classList.remove('open'); if (this.rec) this.rec.stop(); speechSynthesis && speechSynthesis.cancel(); },

    say(m, cls = 'a', actions = []) {
      const log = document.getElementById('pmLog');
      const d = document.createElement('div'); d.className = 'pm-m ' + cls;
      d.innerHTML = m + (actions.length ? '<div class="acts"></div>' : '');
      if (actions.length) actions.forEach(a => {
        const b = document.createElement('button'); b.textContent = a.label;
        b.onclick = () => { a.run(); if (a.close !== false) this.close(); };
        d.querySelector('.acts').appendChild(b);
      });
      log.appendChild(d); log.scrollTop = log.scrollHeight;
    },
    reply(text, actions = [], spoken) { this.say(text, 'a', actions); return speak(spoken || text.replace(/<[^>]+>/g, '')); },

    listen() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const mic = document.getElementById('pmMic'), hint = document.getElementById('pmHint');
      if (!SR) { hint.textContent = t('nosr'); return; }
      if (this.rec) { this.rec.stop(); return; }
      speechSynthesis && speechSynthesis.cancel();
      const rec = new SR(); this.rec = rec;
      rec.lang = LANGS[lang()] || 'hi-IN'; rec.interimResults = false; rec.maxAlternatives = 1;
      mic.classList.add('rec'); document.getElementById('pmFab').classList.add('rec'); hint.textContent = t('listening');
      rec.onresult = e => { this.handle(e.results[0][0].transcript); };
      rec.onend = () => { mic.classList.remove('rec'); document.getElementById('pmFab').classList.remove('rec');
        hint.textContent = this.hint || t('hint'); this.rec = null; };
      rec.onerror = () => { rec.onend(); };
      rec.start();
    },

    async handle(q) {
      this.say(q, 'u');
      const ql = q.toLowerCase();
      for (const s of this.skills) {
        if (s.match(ql)) {
          try { const r = await s.run(q, ql); if (r) { await this.reply(r.text, r.actions || [], r.spoken); } }
          catch (e) { this.reply('⚠ ' + (e.message || 'error')); }
          return;
        }
      }
      this.reply(`${t('fallback')}<br>${this.examples.map(x => '• ' + x).join('<br>')}`, [], t('fallback'));
    },
  };

  /* keyword helper: any of the words appears in the query */
  A.kw = (ql, words) => words.some(w => ql.includes(w.toLowerCase()));
  window.PashuMitra = A;
})();
