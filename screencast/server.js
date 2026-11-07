// ScreenCast: server signaling (WebSocket) + phục vụ file web tĩnh.
//  - Chế độ LAN (mặc định, chạy `npm start`): HTTPS chứng chỉ tự ký, cổng 8443.
//  - Chế độ cloud (Render đặt biến RENDER, hoặc CLOUD=1): HTTP thường, nền tảng tự lo HTTPS.
// Biến môi trường (cloud):
//  PORT                cổng (Render tự đặt)
//  ALLOWED_ORIGINS     danh sách origin được phép kết nối WebSocket, cách nhau bằng dấu phẩy
//                      vd: https://ten-ban.netlify.app,https://ten-ban.netlify.app
//  ICE_SERVERS_JSON    mảng JSON iceServers gửi cho client (STUN/TURN), giữ bí mật thông tin TURN ở đây
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
// rooms: code -> { receiver: ws, sender: ws|null }
const rooms = new Map();
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

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

    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }

      if (m.type === 'register' && !ws.role) {
        let code = /^\d{6}$/.test(m.code || '') ? m.code : null;
        const existing = code && rooms.get(code);
        if (existing && existing.receiver.readyState === 1) code = null; // đang bị dùng
        if (!code) code = newCode();
        const old = rooms.get(code);
        rooms.set(code, { receiver: ws, sender: old ? old.sender : null });
        ws.role = 'receiver'; ws.code = code;
        send(ws, { type: 'registered', code, iceServers: ICE_SERVERS });
        if (old && old.sender) send(ws, { type: 'sender-joined' });
        return;
      }

      if (m.type === 'join' && !ws.role) {
        if (tooManyFails(ws.ip)) return send(ws, { type: 'error', reason: 'rate_limited' });
        const room = rooms.get(String(m.code || ''));
        if (!room || room.receiver.readyState !== 1) { addFail(ws.ip); return send(ws, { type: 'error', reason: 'not_found' }); }
        if (room.sender && room.sender.readyState === 1) return send(ws, { type: 'error', reason: 'busy' });
        room.sender = ws; ws.role = 'sender'; ws.code = String(m.code);
        send(ws, { type: 'joined', iceServers: ICE_SERVERS });
        send(room.receiver, { type: 'sender-joined' });
        return;
      }

      if (m.type === 'signal' && ws.role) {
        const room = rooms.get(ws.code);
        if (!room) return;
        send(ws.role === 'sender' ? room.receiver : room.sender, { type: 'signal', data: m.data });
      }
    });

    ws.on('close', () => {
      const room = rooms.get(ws.code);
      if (!room) return;
      if (ws.role === 'sender' && room.sender === ws) {
        room.sender = null;
        send(room.receiver, { type: 'sender-left' });
      } else if (ws.role === 'receiver' && room.receiver === ws) {
        send(room.sender, { type: 'receiver-left' });
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
      console.log(`ALLOWED_ORIGINS: ${ALLOWED_ORIGINS.join(', ') || '(không giới hạn)'}; TURN/STUN từ server: ${ICE_SERVERS ? 'có' : 'không'}`);
      return;
    }
    console.log('\n=== ScreenCast LAN đang chạy ===');
    console.log(`Trên máy này : https://localhost:${PORT}`);
    for (const ip of lanIPs()) console.log(`Trong mạng LAN: https://${ip}:${PORT}   <- mở địa chỉ này trên TV / điện thoại`);
    console.log('\nLần đầu trình duyệt sẽ cảnh báo chứng chỉ tự ký: chọn "Nâng cao" -> "Tiếp tục truy cập".\n');
  });
})();
