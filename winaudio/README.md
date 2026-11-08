# F88Tivi Audio (app Windows)

Gửi riêng tiếng của MỘT ứng dụng (Chrome, Edge, VLC…) sang TV, nên tắt hoặc hạ loa máy tính xuống 0 thì TV vẫn có tiếng.

## Cách hoạt động
- Dùng WASAPI *process loopback* (Windows 10 bản 2004 trở lên) để bắt âm thanh của một ứng dụng và tiến trình con của nó.
  Âm thanh lấy ở mức ứng dụng, nên không phụ thuộc âm lượng hay nút tắt tiếng của loa (đã đo thử: mức tín hiệu giữ nguyên khi tắt tiếng và khi kéo âm lượng về 0).
  Ngược lại, chia sẻ "Toàn bộ màn hình" của trình duyệt lấy tiếng sau âm lượng loa, nên hạ loa xuống 0 là TV mất tiếng.
- App mở WebSocket chỉ ở `127.0.0.1:48221` và gửi PCM 16-bit, 48 kHz, stereo. Chỉ nhận Origin
  `https://f88tivi.netlify.app`, `localhost`, `127.0.0.1` và địa chỉ mạng nội bộ; trang web lạ bị từ chối (403).
- Trang gửi (`sender.html`), khi tích "Dùng app F88Tivi Audio", kết nối vào đó, đưa PCM qua AudioWorklet thành một track
  âm thanh (không nối ra loa) và gửi cùng hình sang TV bằng WebRTC. Khi đó không lấy tiếng từ `getDisplayMedia`.

## Dùng
1. Mở `F88TiviAudio.exe`, chọn ứng dụng đang phát tiếng, bấm **Bắt đầu**.
2. Mở trang gửi, nhập mã TV, tích **Dùng app F88Tivi Audio**, chiếu bình thường (nên chia sẻ cả màn hình).
3. Tắt loa máy tính tùy ý; TV vẫn có tiếng.

Chrome mới có thể hỏi quyền "truy cập thiết bị trong mạng cục bộ" khi trang kết nối tới app: chọn **Cho phép**.

## Build
```bash
bash winaudio/build.sh        # ra winaudio/publish/F88TiviAudio.exe (chạy độc lập, không commit vào git)
```
Kiểm tra mức âm của một tiến trình: `F88TiviAudio.exe --probe <pid> <file.txt>` (ghi 14 giây).

## Giới hạn
- Chỉ Windows 10 2004+/11. Chọn đúng ứng dụng phát tiếng; ứng dụng phải đang chạy khi bấm Bắt đầu (bấm Làm mới nếu mới mở).
- Âm thanh có thể lệch hình khoảng 0,1 giây, chưa có chỉnh độ trễ.
- Chưa thử với TV thật trong phiên làm việc này.
