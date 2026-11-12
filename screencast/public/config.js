// Cấu hình dùng chung cho trang gửi/nhận.
// - Chạy LAN (npm start): để WS_URL trống, trang sẽ kết nối tới chính máy chủ đã mở nó.
// - Khi đưa trang lên Netlify: điền địa chỉ server signaling trên Render, ví dụ
//   WS_URL: 'wss://screencast-signal.onrender.com/ws'
window.SC_CONFIG = {
  WS_URL: 'wss://screencast-signal.onrender.com/ws',
  // STUN mặc định. Thông tin TURN (nếu có) nên đặt ở biến ICE_SERVERS_JSON trên server, không ghi vào file này.
  ICE_SERVERS: [{ urls: 'stun:stun.l.google.com:19302' }],
};

window.scWsUrl = function () {
  return window.SC_CONFIG.WS_URL || ('wss://' + location.host + '/ws');
};

// Chẩn đoán kết nối: đếm các loại địa chỉ (host / srflx / relay) mà máy này thu được và ghi lại lỗi TURN.
// relay = 0 nghĩa là máy này không tới được máy chủ TURN (mạng chặn). Gọi scDiagAttach(pc) ngay sau khi tạo RTCPeerConnection.
window.scDiagAttach = function (pc) {
  const d = { host: 0, srflx: 0, relay: 0, prflx: 0, errors: [] };
  pc._diag = d;
  pc.addEventListener('icecandidate', function (e) {
    if (!e.candidate) return;
    const t = e.candidate.type || ((/ typ (\w+)/.exec(e.candidate.candidate) || [])[1]);
    if (t in d) d[t]++;
  });
  pc.addEventListener('icecandidateerror', function (e) {
    const u = String(e.url || '').replace(/^(turns?|stuns?):/, '').replace(/\?.*/, '');
    const s = (u || '?') + ' (' + e.errorCode + ')';
    if (d.errors.indexOf(s) < 0 && d.errors.length < 4) d.errors.push(s);
  });
};
window.scDiagText = function (pc) {
  const d = pc && pc._diag;
  if (!d) return '';
  return '[host ' + d.host + ' · srflx ' + d.srflx + ' · relay ' + d.relay + (d.errors.length ? ' · lỗi: ' + d.errors.join(', ') : '') + ']';
};

// Đánh thức server signaling (Render gói miễn phí tự ngủ khi không dùng).
window.scWake = function () {
  try {
    const u = new URL(window.scWsUrl());
    fetch('https://' + u.host + '/healthz', { mode: 'no-cors', cache: 'no-store' }).catch(function () {});
  } catch (e) {}
};
