# Đưa ScreenCast lên mạng (Netlify + Render)

Kiến trúc: **Netlify** chứa trang web gửi/nhận, **Render** chạy server ghép cặp (WebSocket). Hình ảnh đi thẳng giữa máy gửi và TV (P2P); trong LAN không tốn băng thông cloud.

## Bước 1. Đẩy mã lên GitHub
Thư mục `TrinhchieuTV` là gốc repo (đã có `render.yaml`, `netlify.toml`, `.gitignore`).
```bash
git init && git add . && git commit -m "ScreenCast"
# tạo repo rỗng trên GitHub rồi:
git remote add origin https://github.com/<tên-bạn>/screencast.git
git push -u origin main
```

## Bước 2. Render (server signaling)
1. Render → **New → Blueprint** → chọn repo vừa push. Render đọc `render.yaml` và tạo dịch vụ `screencast-signal`.
2. Khi tạo xong, ghi lại địa chỉ, ví dụ `https://screencast-signal.onrender.com`.
3. Kiểm tra: mở `https://screencast-signal.onrender.com/healthz` thấy chữ `ok`.

> Gói free của Render tự ngủ sau ~15 phút không dùng, lần đầu kết nối lại có thể chậm 30–60 giây (trang đã tự đánh thức server khi mở). Dùng thương mại nên chuyển gói Starter (~7 USD/tháng) để không bị ngủ.

## Bước 3. Netlify (trang web)
1. Sửa `screencast/public/config.js`:
   ```js
   WS_URL: 'wss://screencast-signal.onrender.com/ws',
   ```
   rồi commit và push.
2. Netlify → **Add new site → Import from Git** → chọn repo. Netlify đọc `netlify.toml` (base `screencast`, publish `public`), không cần lệnh build.
   (Cách nhanh khác: kéo thả thư mục `screencast/public` vào Netlify Drop.)
3. Ghi lại địa chỉ, ví dụ `https://ten-ban.netlify.app`.

## Bước 4. Khóa server chỉ nhận trang của anh
Render → dịch vụ `screencast-signal` → **Environment** → đặt:
- `ALLOWED_ORIGINS` = `https://ten-ban.netlify.app` (nhiều địa chỉ thì cách nhau dấu phẩy)

## Bước 5. Cho TV dùng địa chỉ Netlify
```bash
adb connect 192.168.0.199:5555
adb shell am start -n vn.screencast.tv/.MainActivity --es server https://ten-ban.netlify.app
```
(hoặc nhấn BACK/MENU trên remote để nhập địa chỉ). Từ lúc này không cần bật server trên máy tính nữa.

## Bước 6. TURN cho trường hợp khác mạng
Trong LAN thì không cần. Khi máy gửi và TV ở hai mạng khác nhau, nhiều khi cần TURN. Lấy thông tin TURN từ nhà cung cấp (Metered, Cloudflare, Twilio...) hoặc tự cài coturn, rồi đặt biến trên Render:
```
ICE_SERVERS_JSON=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:<host>:443?transport=tcp","username":"<user>","credential":"<pass>"}]
```
Server sẽ gửi danh sách này cho cả TV và máy gửi, nên thông tin TURN không nằm trong mã web công khai.

## Chạy LAN như cũ
```bash
cd screencast && npm install && npm start     # https://<IP-máy-tính>:8443
```
Để trống `WS_URL` trong `config.js` khi dùng chế độ LAN (trang tự kết nối về chính server đã mở nó).
