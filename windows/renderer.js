const app = document.getElementById('app');
const S = {
  step: 'home', tvs: [], tv: null, connecting: false, note: '',
  file: null, name: '', probe: null, probing: false, audio: 0, text: -1,
  subPath: null, subName: '', playing: false, pos: 0, dur: 0, drag: false
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const base = p => p.split(/[\\/]/).pop();
const fmt = ms => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/></svg>';

function opt(label, sel, a, i, sub) {
  return `<div class="opt ${sel ? 'sel' : ''}" data-a="${a}" data-i="${i}"><div>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;
}

function tracks() {
  const p = S.probe || { audio: [], text: [] };
  let h = '';
  if (p.audio.length) h += '<h2>Audio</h2>' + p.audio.map(t => opt(t.label, S.audio === t.index, 'audio', t.index)).join('') + '<div class="gap"></div>';
  h += '<h2>Subtitles</h2>' + opt('Off', S.text === -1, 'text', -1);
  h += p.text.map(t => opt(t.label, S.text === t.index, 'text', t.index)).join('');
  if (S.subPath) h += opt(S.subName, S.text === -2, 'text', -2);
  if (S.step === 'prepare') h += '<div class="ghost" data-a="addsub">Add subtitle file…</div>';
  return h;
}

function render() {
  let h = '<h1>CastPro</h1>';
  if (S.step === 'home') {
    h += '<h2>Your TV</h2>';
    if (S.tv) {
      h += `<div class="card">Connected · ${esc(S.tv.name)}</div><div class="gap"></div>`;
      h += '<div class="btn" data-a="pick">Choose video or audio</div>';
      h += '<div class="drop">or drop a file here</div>';
      h += '<div class="ghost" data-a="disconnect">Disconnect</div>';
    } else {
      if (!S.tvs.length) h += '<div class="dim">Searching for CastPro TVs on this WiFi…</div>';
      h += S.tvs.map((t, i) => opt(t.name, false, 'tv', i, t.host)).join('');
      h += '<div class="gap"></div><div class="dim">Not showing up? Enter the IP shown on the TV</div><div style="height:8px"></div>';
      h += `<div class="row"><input type="text" id="ip" placeholder="192.168.1.20"><div class="btn" data-a="ip">${S.connecting ? '…' : 'Connect'}</div></div>`;
    }
    if (S.note) h += `<div class="dim" style="margin-top:14px">${esc(S.note)}</div>`;
  } else if (S.step === 'prepare') {
    h += '<h2>Before you play</h2>';
    h += `<div class="card">${esc(S.name)}${S.probe && S.probe.duration ? `<div class="dim" style="margin-top:4px">${fmt(S.probe.duration)}</div>` : ''}</div><div class="gap"></div>`;
    h += S.probing ? '<div class="dim">Reading audio and subtitle tracks…</div>' : tracks();
    h += '<div class="gap"></div>';
    h += `<div class="btn ${S.probing || !S.tv ? 'off' : ''}" data-a="cast">Cast to TV</div>`;
    h += '<div class="ghost" data-a="back">Back</div>';
  } else {
    h += '<h2>Now playing</h2>';
    h += `<div class="card">${esc(S.name.replace(/\.[^.]+$/, ''))}</div>`;
    h += `<input type="range" id="seek" min="0" max="${S.dur || 1}" value="${S.pos}">`;
    h += `<div class="times"><span id="t1">${fmt(S.pos)}</span><span id="t2" style="opacity:.7">${fmt(S.dur)}</span></div>`;
    h += `<div class="ctrl"><div class="round" data-a="skip" data-i="-10000">−10</div><div class="big" id="pp" data-a="pp">${S.playing ? ICON_PAUSE : ICON_PLAY}</div><div class="round" data-a="skip" data-i="10000">+10</div></div>`;
    h += tracks();
    h += '<div class="ghost" data-a="stop">Stop casting</div>';
  }
  app.innerHTML = h;
}

function tick() {
  if (S.step !== 'playing') return;
  const seek = document.getElementById('seek');
  if (!S.drag && seek) { seek.max = S.dur || 1; seek.value = S.pos; }
  const t1 = document.getElementById('t1'), t2 = document.getElementById('t2'), pp = document.getElementById('pp');
  if (t1 && !S.drag) t1.textContent = fmt(S.pos);
  if (t2) t2.textContent = fmt(S.dur);
  if (pp) pp.innerHTML = S.playing ? ICON_PAUSE : ICON_PLAY;
}

async function connect(host, port, name) {
  S.connecting = true; S.note = ''; render();
  const r = await cp.connect(host, port);
  S.connecting = false;
  if (r.ok) S.tv = { name, host, port }; else S.note = 'Could not reach the TV';
  render();
}

async function mediaPicked(p) {
  S.file = p; S.name = base(p); S.probe = null; S.probing = true; S.audio = 0; S.text = -1;
  S.subPath = null; S.subName = ''; S.step = 'prepare'; render();
  S.probe = await cp.probe(p); S.probing = false; render();
}

app.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a, i = +el.dataset.i;
  if (a === 'tv') { const t = S.tvs[i]; connect(t.host, t.port, t.name); }
  else if (a === 'ip') { const v = document.getElementById('ip').value.trim(); if (v && !S.connecting) connect(v, 48555, v); }
  else if (a === 'disconnect') { cp.disconnect(); S.tv = null; render(); }
  else if (a === 'pick') { const p = await cp.pick('media'); if (p) mediaPicked(p); }
  else if (a === 'addsub') { const p = await cp.pick('sub'); if (p) { S.subPath = p; S.subName = base(p); S.text = -2; render(); } }
  else if (a === 'audio') { S.audio = i; if (S.step === 'playing') cp.cmd({ t: 'audio', i }); render(); }
  else if (a === 'text') { S.text = i; if (S.step === 'playing') cp.cmd({ t: 'text', i }); render(); }
  else if (a === 'back') { S.step = 'home'; render(); }
  else if (a === 'cast') {
    if (S.probing || !S.tv) return;
    await cp.cast({ file: S.file, title: S.name.replace(/\.[^.]+$/, ''), audio: S.audio, text: S.text, sub: S.subPath });
    S.playing = true; S.pos = 0; S.dur = (S.probe && S.probe.duration) || 0; S.step = 'playing'; render();
  }
  else if (a === 'pp') { cp.cmd({ t: S.playing ? 'pause' : 'play' }); S.playing = !S.playing; tick(); }
  else if (a === 'skip') cp.cmd({ t: 'seek', ms: Math.max(0, S.pos + i) });
  else if (a === 'stop') { cp.cmd({ t: 'stop' }); S.step = 'home'; render(); }
});

app.addEventListener('input', e => {
  if (e.target.id === 'seek') { S.drag = true; document.getElementById('t1').textContent = fmt(+e.target.value); }
});
app.addEventListener('change', e => {
  if (e.target.id === 'seek') { cp.cmd({ t: 'seek', ms: +e.target.value }); S.drag = false; }
});

document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && S.tv && S.step !== 'playing') mediaPicked(cp.pathOf(f));
});

cp.onTvs(v => { S.tvs = v; if (S.step === 'home' && !S.tv && document.activeElement.id !== 'ip') render(); });
cp.onClosed(() => { S.tv = null; S.note = 'Disconnected'; if (S.step === 'playing') S.step = 'home'; render(); });
cp.onState(o => {
  if (o.t !== 'state') return;
  if (o.active === false || o.ended) { if (S.step === 'playing') { S.step = 'home'; render(); } return; }
  S.playing = o.playing; S.pos = o.pos; S.dur = o.dur;
  if (o.audio !== undefined && (o.audio !== S.audio || o.text !== S.text) && !S.drag) { S.audio = o.audio; S.text = o.text; render(); }
  else tick();
});

render();
