// ScreenCast: server signaling (WebSocket) + phục vụ file web tĩnh.
//  - Chế độ LAN (mặc định, chạy `npm start`): HTTPS chứng chỉ tự ký, cổng 8443.
//  - Chế độ cloud (Render đặt biến RENDER, hoặc CLOUD=1): HTTP thường, nền tảng tự lo HTTPS.
// Biến môi trường (cloud):
//  PORT                cổng (Render tự đặt)
//  ALLOWED_ORIGINS     danh sách origin được phép kết nối WebSocket, cách nhau bằng dấu phẩy
//                      vd: https://ten-ban.netlify.app,https://ten-ban.netlify.app
//  ICE_SERVERS_JSON    mảng JSON iceServers gửi cho client (STUN/TURN), giữ bí mật thông tin TURN ở đây
//  CF_TURN_KEY_ID, CF_TURN_API_TOKEN   Cloudflare Realtime TURN (ưu tiên hơn ICE_SERVERS_JSON; server tự xin credential tạm thời)
//  CF_TURN_KEY_ID_2, CF_TURN_API_TOKEN_2   (tùy chọn) tài khoản Cloudflare thứ hai, dùng khi tài khoản 1 lỗi
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const CLOUD = process.env.CLOUD === '1' || !!process.env.RENDER;
const PORT = Number(process.env.PORT) || 8443;
const PUBLIC = path.join(__dirname, 'public');
const CERT_DIR = path.join(__dirname, '.cert');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

let ICE_SERVERS = null;
if (process.env.ICE_SERVERS_JSON) {
  try { ICE_SERVERS = JSON.parse(process.env.ICE_SERVERS_JSON); }
  catch { console.error('ICE_SERVERS_JSON không phải JSON hợp lệ, bỏ qua.'); }
}

// Cloudflare Realtime TURN: server tự xin credential tạm thời (hết hạn sau CF_TTL giây) bằng Key ID + API Token.
// Có thể khai báo 2 tài khoản (CF_TURN_KEY_ID/_API_TOKEN và CF_TURN_KEY_ID_2/_API_TOKEN_2): dùng tài khoản 1 trước,
// nếu tài khoản 1 từ chối cấp credential thì chuyển sang tài khoản 2, rồi mới tới ICE_SERVERS_JSON (nếu có).
// Tài khoản bị lỗi được tạm nghỉ CF_RETRY_MS rồi thử lại (tự quay về tài khoản 1 khi nó phục hồi).
const CF_BASE = process.env.CF_TURN_API_BASE || 'https://rtc.live.cloudflare.com';
const CF_TTL = 86400;
const CF_RETRY_MS = Number(process.env.CF_TURN_RETRY_MS) || 5 * 60 * 1000;
const CF_ACCOUNTS = [['', ''], ['_2', '_2']]
  .map(([k, t], i) => ({ n: i + 1, keyId: process.env['CF_TURN_KEY_ID' + k] || '', token: process.env['CF_TURN_API_TOKEN' + t] || '', cache: null, retryAt: 0 }))
  .filter((a) => a.keyId && a.token);
const CF_ENABLED = CF_ACCOUNTS.length > 0;
let cfLastUsed = 0;

async function fetchCf(acc) {
  const r = await fetch(`${CF_BASE}/v1/turn/keys/${encodeURIComponent(acc.keyId)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${acc.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: CF_TTL }),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const servers = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : null;
  if (!servers || !servers.length) throw new Error('phản hồi không có iceServers');
  return servers;
}

async function getIceServers() {
  if (!CF_ENABLED) return ICE_SERVERS;
  const now = Date.now();
  const fresh = (a) => a.cache && now - a.cache.at < (CF_TTL * 1000) / 2;
  let pick = null;
  for (const acc of CF_ACCOUNTS) {
    if (fresh(acc)) { pick = acc; break; }
    if (acc.retryAt > now) continue;                // đang tạm nghỉ vì vừa lỗi
    try {
      acc.cache = { servers: await fetchCf(acc), at: now };
      acc.retryAt = 0; pick = acc; break;
    } catch (e) {
      acc.retryAt = now + CF_RETRY_MS;
      console.error(`Cloudflare TURN tài khoản ${acc.n} không cấp được credential (${e.message}); tạm nghỉ ${CF_RETRY_MS / 60000} phút.`);
    }
  }
  if (!pick) pick = CF_ACCOUNTS.find((a) => a.cache);   // đều lỗi: dùng tạm credential cũ chưa hết hạn
  if (!pick) return ICE_SERVERS;
  if (pick.n !== cfLastUsed) { console.log(`Cloudflare TURN: đang dùng tài khoản ${pick.n}`); cfLastUsed = pick.n; }
  return pick.cache.servers;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

async function loadCert(ips) {
  const selfsigned = require('selfsigned'); // chỉ cần ở chế độ LAN
  const key = path.join(CERT_DIR, 'key.pem'), crt = path.join(CERT_DIR, 'cert.pem'), meta = path.join(CERT_DIR, 'ips.json');
  const sig = JSON.stringify(ips);
  if (fs.existsSync(key) && fs.existsSync(crt) && fs.existsSync(meta) && fs.readFileSync(meta, 'utf8') === sig) {
    return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
  }
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7, ip }))];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'ScreenCast LAN' }], {
    days: 825, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(key, pems.private); fs.writeFileSync(crt, pems.cert); fs.writeFileSync(meta, sig);
  return { key: pems.private, cert: pems.cert };
}

function handleHttp(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }).end('ok');
    return;
  }
  if (p === '/') p = '/index.html';
  const file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---- Signaling ----
// rooms: code -> { receiver: ws, senders: Map<id, ws>, active: id|null }
// Nhiều máy gửi cùng vào một phòng (tối đa MAX_SENDERS); TV (receiver) chọn 1 người được chiếu mỗi lần.
const rooms = new Map();
const MAX_SENDERS = 8;
let nextSenderId = 1;
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function pushRoster(room) {
  send(room.receiver, {
    type: 'roster',
    list: [...room.senders].map(([id, w]) => ({ id, name: w.name })),
    active: room.active,
  });
}

function cleanName(raw, room) {
  let n = String(raw || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
  if (!n) n = 'Khách';
  const taken = new Set([...room.senders.values()].map((w) => w.name));
  if (!taken.has(n)) return n;
  for (let i = 2; ; i++) { const c = `${n} (${i})`; if (!taken.has(c)) return c; }
}

function newCode() {
  let c;
  do { c = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(c));
  return c;
}

// Chống dò mã 6 số: mỗi IP tối đa 8 lần nhập sai mỗi phút.
const fails = new Map();
const MAX_FAILS = 8, WINDOW_MS = 60_000;
function tooManyFails(ip) {
  const f = fails.get(ip);
  return !!f && f.reset > Date.now() && f.count >= MAX_FAILS;
}
function addFail(ip) {
  const now = Date.now(), f = fails.get(ip);
  if (!f || f.reset <= now) fails.set(ip, { count: 1, reset: now + WINDOW_MS });
  else f.count++;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of fails) if (v.reset <= n) fails.delete(k); }, WINDOW_MS).unref();

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (CLOUD && xff ? String(xff).split(',')[0].trim() : req.socket.remoteAddress) || '?';
}

function attach(wss) {
  wss.on('connection', (ws, req) => {
    ws.alive = true;
    ws.ip = clientIp(req);
    ws.on('pong', () => { ws.alive = true; });

    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      // Lấy danh sách STUN/TURN trước khi đụng tới trạng thái phòng (thường lấy từ bộ nhớ đệm, rất nhanh).
      const ice = (m.type === 'register' || m.type === 'join') && !ws.role ? await getIceServers() : null;
      if (ws.readyState !== 1) return;

      if (m.type === 'register' && !ws.role) {
        let code = /^\d{6}$/.test(m.code || '') ? m.code : null;
        const existing = code && rooms.get(code);
        if (existing && existing.receiver.readyState === 1) code = null; // đang bị dùng
        if (!code) code = newCode();
        const old = rooms.get(code);
        const room = { receiver: ws, senders: old ? old.senders : new Map(), active: old ? old.active : null };
        rooms.set(code, room);
        ws.role = 'receiver'; ws.code = code;
        send(ws, { type: 'registered', code, iceServers: ice });
        pushRoster(room);
        return;
      }

      if (m.type === 'join' && !ws.role) {
        if (tooManyFails(ws.ip)) return send(ws, { type: 'error', reason: 'rate_limited' });
        const room = rooms.get(String(m.code || ''));
        if (!room || room.receiver.readyState !== 1) { addFail(ws.ip); return send(ws, { type: 'error', reason: 'not_found' }); }
        if (room.senders.size >= MAX_SENDERS) return send(ws, { type: 'error', reason: 'full' });
        ws.role = 'sender'; ws.code = String(m.code);
        ws.id = String(nextSenderId++);
        ws.name = cleanName(m.name, room);
        room.senders.set(ws.id, ws);
        send(ws, { type: 'joined', id: ws.id, name: ws.name, iceServers: ice });
        // Chỉ có một người và chưa ai chiếu: chiếu luôn, không cần TV chọn. Từ người thứ hai trở đi mới phải chờ.
        if (room.senders.size === 1 && !room.active) {
          room.active = ws.id;
          send(ws, { type: 'activated' });
        }
        pushRoster(room);
        return;
      }

      const room = ws.role ? rooms.get(ws.code) : null;
      if (!room) return;

      if (ws.role === 'receiver' && room.receiver === ws) {
        // TV chọn người được chiếu / dừng người đang chiếu / mời người ra khỏi phòng.
        if (m.type === 'select') {
          const s = room.senders.get(String(m.id));
          if (!s || room.active) return;            // chỉ chọn khi chưa có ai đang chiếu
          room.active = s.id;
          send(s, { type: 'activated' });
          pushRoster(room);
        } else if (m.type === 'stop') {
          const s = room.active && room.senders.get(room.active);
          room.active = null;
          if (s) send(s, { type: 'deactivated' });
          pushRoster(room);
        } else if (m.type === 'kick') {
          const s = room.senders.get(String(m.id));
          if (!s) return;
          room.senders.delete(s.id);
          if (room.active === s.id) room.active = null;
          send(s, { type: 'kicked' });
          pushRoster(room);
          s.close();
        } else if (m.type === 'signal') {
          send(room.active && room.senders.get(room.active), { type: 'signal', data: m.data });
        }
      } else if (ws.role === 'sender' && room.senders.get(ws.id) === ws) {
        if (m.type === 'release') {                 // người chiếu tự dừng, quay lại danh sách chờ
          if (room.active === ws.id) { room.active = null; pushRoster(room); }
        } else if (m.type === 'signal') {
          if (room.active === ws.id) send(room.receiver, { type: 'signal', data: m.data });
        }
      }
    });

    ws.on('close', () => {
      const room = rooms.get(ws.code);
      if (!room) return;
      if (ws.role === 'sender' && room.senders.get(ws.id) === ws) {
        room.senders.delete(ws.id);
        if (room.active === ws.id) room.active = null;
        pushRoster(room);
      } else if (ws.role === 'receiver' && room.receiver === ws) {
        for (const s of room.senders.values()) send(s, { type: 'receiver-left' });
        rooms.delete(ws.code);
      }
    });
  });

  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
  }, 15000);
}

function verifyClient(info) {
  if (!ALLOWED_ORIGINS.length) return true;
  return ALLOWED_ORIGINS.includes(info.origin);
}

(async () => {
  let server;
  if (CLOUD) server = http.createServer(handleHttp);
  else server = require('https').createServer(await loadCert(lanIPs()), handleHttp);

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024, verifyClient });
  attach(wss);

  server.listen(PORT, '0.0.0.0', () => {
    if (CLOUD) {
      console.log(`ScreenCast signaling (cloud) lắng nghe cổng ${PORT}`);
      console.log(`ALLOWED_ORIGINS: ${ALLOWED_ORIGINS.join(', ') || '(không giới hạn)'}; TURN/STUN từ server: ${CF_ENABLED ? `Cloudflare TURN (${CF_ACCOUNTS.length} tài khoản)` : ICE_SERVERS ? 'ICE_SERVERS_JSON' : 'không'}`);
      if (CF_ENABLED) getIceServers().then((s) => { if (!s || s === ICE_SERVERS) console.log('Cloudflare TURN: LỖI hết các tài khoản, đang dùng ICE_SERVERS_JSON (nếu có)'); });
      return;
    }
    console.log('\n=== ScreenCast LAN đang chạy ===');
    console.log(`Trên máy này : https://localhost:${PORT}`);
    for (const ip of lanIPs()) console.log(`Trong mạng LAN: https://${ip}:${PORT}   <- mở địa chỉ này trên TV / điện thoại`);
    console.log('\nLần đầu trình duyệt sẽ cảnh báo chứng chỉ tự ký: chọn "Nâng cao" -> "Tiếp tục truy cập".\n');
  });
})();
