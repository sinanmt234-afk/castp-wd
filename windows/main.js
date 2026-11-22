const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { Bonjour } = require('bonjour-service');

const CONTROL_PORT = 48555;
const MEDIA_PORT = 48556;
const ffprobe = require('ffprobe-static').path.replace('app.asar', 'app.asar.unpacked');

let win, sock = null, buf = '', myIp = '';
let media = null, sub = null, subMime = 'application/x-subrip';

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.ts': 'video/mp2t',
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.srt': 'application/x-subrip', '.vtt': 'text/vtt', '.ass': 'text/x-ssa', '.ssa': 'text/x-ssa'
};

// ---------- media server (Range support so the TV can seek) ----------
http.createServer((req, res) => {
  const file = req.url.startsWith('/s') ? sub : media;
  if (!file) { res.writeHead(404); return res.end(); }
  fs.stat(file, (e, st) => {
    if (e) { res.writeHead(404); return res.end(); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    let start = 0, end = st.size - 1;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      if (m[1] !== '') { start = +m[1]; if (m[2] !== '') end = Math.min(+m[2], end); }
      else if (m[2] !== '') start = Math.max(0, st.size - +m[2]);
    }
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 };
    if (m) h['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    res.writeHead(m ? 206 : 200, h);
    if (req.method === 'HEAD') return res.end();
    const rs = fs.createReadStream(file, { start, end });
    rs.on('error', () => res.destroy());
    res.on('close', () => rs.destroy());
    rs.pipe(res);
  });
}).listen(MEDIA_PORT, '0.0.0.0');

// ---------- discovery ----------
const bonjour = new Bonjour();
const tvs = new Map();
function pushTvs() { if (win && !win.isDestroyed()) win.webContents.send('tvs', [...tvs.values()]); }
function startDiscovery() {
  const b = bonjour.find({ type: 'castpro' });
  b.on('up', s => {
    const ip = (s.addresses || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a));
    if (ip) { tvs.set(s.name, { name: s.name, host: ip, port: s.port }); pushTvs(); }
  });
  b.on('down', s => { tvs.delete(s.name); pushTvs(); });
}

// ---------- control connection ----------
function send(o) { if (sock) sock.write(JSON.stringify(o) + '\n'); }

ipcMain.handle('connect', (e, host, port) => new Promise(resolve => {
  if (sock) sock.destroy();
  const s = new net.Socket();
  let ok = false; buf = '';
  s.setTimeout(4000);
  s.connect(port || CONTROL_PORT, host, () => {
    ok = true; s.setTimeout(0); s.setNoDelay(true); sock = s; myIp = s.localAddress;
    resolve({ ok: true, ip: myIp });
  });
  s.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      try { win.webContents.send('state', JSON.parse(line)); } catch (err) { }
    }
  });
  s.on('timeout', () => s.destroy());
  s.on('error', () => { });
  s.on('close', () => {
    if (ok) { if (sock === s) sock = null; if (win && !win.isDestroyed()) win.webContents.send('closed'); }
    else resolve({ ok: false });
  });
}));

ipcMain.on('cmd', (e, o) => send(o));
ipcMain.on('disconnect', () => { if (sock) sock.destroy(); });

ipcMain.handle('cast', (e, o) => {
  media = o.file;
  sub = o.sub || null;
  if (sub) subMime = MIME[path.extname(sub).toLowerCase()] || 'application/x-subrip';
  const base = `http://${myIp}:${MEDIA_PORT}`;
  const msg = { t: 'load', url: base + '/m', title: o.title, audio: o.audio, text: o.text };
  if (sub) { msg.sub = base + '/s'; msg.submime = subMime; }
  send(msg);
  return true;
});

// ---------- file picking + track probing ----------
const filters = {
  media: [{ name: 'Video / Audio', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'ts', 'mp3', 'flac', 'm4a', 'aac', 'wav', 'ogg', 'opus'] }],
  sub: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }]
};
ipcMain.handle('pick', async (e, kind) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filters[kind] });
  return r.canceled ? null : r.filePaths[0];
});

function langName(code) {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code); } catch (e) { return code; }
}
function label(s, n, audio) {
  const t = s.tags || {};
  const lang = t.language && t.language !== 'und' ? langName(t.language) : null;
  const base = t.title || lang || `Track ${n + 1}`;
  let extra = null;
  if (audio && s.channels) extra = { 1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1' }[s.channels] || s.channels + 'ch';
  return [base, extra].filter(Boolean).join(' · ');
}

ipcMain.handle('probe', (e, file) => new Promise(resolve => {
  execFile(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    { maxBuffer: 20 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve({ audio: [], text: [], duration: 0 });
      const j = JSON.parse(out);
      const st = j.streams || [];
      const audio = st.filter(s => s.codec_type === 'audio').map((s, i) => ({ label: label(s, i, true), index: i }));
      const text = st.filter(s => s.codec_type === 'subtitle').map((s, i) => ({ label: label(s, i, false), index: i }));
      resolve({ audio, text, duration: Math.round(parseFloat((j.format || {}).duration || 0) * 1000) });
    });
}));

// ---------- window ----------
app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 480, height: 820, minWidth: 420, backgroundColor: '#161B2F', autoHideMenuBar: true, title: 'CastPro',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => { startDiscovery(); pushTvs(); });
});
app.on('window-all-closed', () => { bonjour.destroy(); app.quit(); });
