// Cấu hình dùng chung cho trang gửi/nhận.
// - Chạy LAN (npm start): để WS_URL trống, trang sẽ kết nối tới chính máy chủ đã mở nó.
// - Khi đưa trang lên Netlify: điền địa chỉ server signaling trên Render, ví dụ
//   WS_URL: 'wss://screencast-signal.onrender.com/ws'
window.SC_CONFIG = {
  WS_URL: '',
  // STUN mặc định. Thông tin TURN (nếu có) nên đặt ở biến ICE_SERVERS_JSON trên server, không ghi vào file này.
  ICE_SERVERS: [{ urls: 'stun:stun.l.google.com:19302' }],
};

window.scWsUrl = function () {
  return window.SC_CONFIG.WS_URL || ('wss://' + location.host + '/ws');
};

// Đánh thức server signaling (Render gói miễn phí tự ngủ khi không dùng).
window.scWake = function () {
  try {
    const u = new URL(window.scWsUrl());
    fetch('https://' + u.host + '/healthz', { mode: 'no-cors', cache: 'no-store' }).catch(function () {});
  } catch (e) {}
};
