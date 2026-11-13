# F88Tivi — Ngữ cảnh dự án (đọc file này đầu tiên)

> File này giúp Claude hiểu nhanh dự án sau khi cài lại máy. Cập nhật lần cuối: 2026-11-08.
> Người dùng gọi Claude là "em", tự xưng "anh". **Luôn trả lời bằng tiếng Việt.**
> **Hỏi lại trước khi `git commit` / `git push`** (người dùng luôn duyệt từng lần đẩy). Không in thông tin bí mật (TURN, mật khẩu) ra chat.

## 1. Dự án là gì
**F88Tivi**: ứng dụng chiếu màn hình (máy tính / điện thoại) lên TV Android, có cả hình lẫn tiếng, dùng **WebRTC**.
Mỗi lần chỉ **1 người chiếu / 1 TV**. Ưu tiên chạy tốt trong **LAN**, nhưng đã hỗ trợ cả **khác mạng (4G)** qua TURN. Người dùng có ý định **thương mại hóa sau** (chưa làm).

Thứ tự phát triển do người dùng chọn: **Web (xong) → App TV (xong) → app Android gửi → app iPhone gửi** → thương mại.

Cách dùng: TV mở app F88Tivi, hiện **mã 6 số + QR**. Máy gửi mở trang gửi, nhập mã, chọn màn hình/tab, bấm chiếu.

## 2. Kiến trúc & địa chỉ đang chạy
```
[Máy gửi: trình duyệt]  ──WebRTC (video+audio, P2P trong LAN)──►  [TV: app F88Tivi (WebView)]
        │  WebSocket signaling (ghép cặp bằng mã 6 số)                    │
        └───────────────►  Render: screencast-signal  ◄───────────────────┘
        Trang web (HTML/JS tĩnh) host trên Netlify;  TURN của Metered cho trường hợp khác mạng
```
| Thành phần | Nơi chạy | Địa chỉ |
|---|---|---|
| Trang web gửi/nhận | **Netlify** | https://f88tivi.netlify.app (`/sender.html`, `/receiver.html`) |
| Server signaling (WebSocket) | **Render** (gói free, tự ngủ sau ~15 phút) | https://screencast-signal.onrender.com (`/healthz` trả `ok`) |
| TURN | **Cloudflare Realtime TURN** (thay Metered; Metered chỉ là gói Trial 500 MB, đã hết hạn mức 2026-11) | server tự xin credential tạm thời qua biến Render `CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN`; có thể thêm tài khoản dự phòng `CF_TURN_KEY_ID_2` + `CF_TURN_API_TOKEN_2` (chuyển sang khi tài khoản 1 bị từ chối cấp credential, thử lại tài khoản 1 sau 5 phút); `ICE_SERVERS_JSON` (Metered) là dự phòng cuối. **Không** nằm trong repo |
| Repo | GitHub | https://github.com/toannvmsb/F88Tivi.git (nhánh `main`) |
| TV thử nghiệm | Mi TV (Android 14), IP **192.168.0.199**, ADB cổng **5555** | gói app `vn.screencast.tv` |
| Máy dev | Windows 11, IP LAN 192.168.0.196 | server LAN chạy cổng 8443 |

Netlify tự deploy khi push `main` (đọc `netlify.toml`: base `screencast`, publish `public`). Render dùng `render.yaml` (Blueprint, `rootDir: screencast`).

### Biến môi trường trên Render (đã đặt)
- `CLOUD=1` — chế độ cloud (HTTP, Render lo HTTPS).
- `ALLOWED_ORIGINS=https://f88tivi.netlify.app` — chỉ nhận WebSocket từ trang Netlify.
- `ICE_SERVERS_JSON` — **mảng JSON** iceServers (STUN + TURN Metered). Phải là JSON thuần (dấu nháy kép), tên biến đúng chữ HOA. Server gửi danh sách này cho cả TV (lúc `registered`) và máy gửi (lúc `joined`) nên credential không lộ trong mã web. Credential TURN từng bị dán lên chat → nên tạo lại trên Metered rồi cập nhật biến này.

## 3. Cấu trúc thư mục
```
TrinhchieuTV/
├─ CLAUDE.md              ← file này
├─ DEPLOY.md              hướng dẫn deploy Netlify + Render (bước 1–6)
├─ netlify.toml, render.yaml, .gitignore
└─ screencast/
   ├─ server.js           server signaling + phục vụ web. 2 chế độ: LAN (HTTPS tự ký, cổng 8443) và cloud (CLOUD=1 / RENDER)
   ├─ package.json        phụ thuộc: ws, selfsigned, qrcode-generator (chạy `npm install`)
   ├─ assets/f88-logo.png logo F88 gốc (do người dùng cung cấp, 300x300, nền trong suốt)
   ├─ public/             web tĩnh (Netlify phục vụ thư mục này)
   │   ├─ index.html, sender.html, receiver.html, style.css
   │   ├─ config.js       WS_URL (đang trỏ Render) + STUN mặc định; có scWsUrl()/scWake()
   │   ├─ vendor/qrcode.js
   │   └─ logo.png, logo-white.png, favicon.png   (sinh tự động từ assets/f88-logo.png)
   ├─ tvapp/              app Android TV (không dùng Gradle)
       ├─ AndroidManifest.xml, src/vn/screencast/tv/MainActivity.java
       ├─ res/drawable-xhdpi/{icon,banner}.png    (sinh tự động)
       ├─ tools/gen_icons.py                      sinh logo web + icon/banner từ assets/f88-logo.png (cần Pillow)
       └─ build.sh                                build APK bằng aapt2+javac+d8+apksigner

winaudio/               app Windows "F88Tivi Audio" (.NET 8 WinForms): bắt tiếng của 1 ứng dụng (WASAPI process loopback) → WebSocket 127.0.0.1:48221 → sender.html. Xem winaudio/README.md. Build: `bash winaudio/build.sh` (cần .NET SDK 8)
```

## 4. Giao thức signaling (server.js)
JSON qua WebSocket `/ws`:
- TV → `{type:'register', code?}` ⇒ server `{type:'registered', code, iceServers}`; TV lưu mã trong `localStorage.sc_code`.
- **Nhiều máy gửi trong một phòng** (tối đa 8, `MAX_SENDERS`), TV chọn 1 người chiếu mỗi lần:
  - Máy gửi → `{type:'join', code, name}` ⇒ `{type:'joined', id, name, iceServers}` hoặc `{type:'error', reason:'not_found'|'full'|'rate_limited'}`. Máy gửi chọn màn hình **trước** (cần thao tác người dùng), vào phòng chờ, chưa gửi hình.
  - Server gửi TV `{type:'roster', list:[{id,name}], active}` mỗi khi phòng đổi.
  - Người **đầu tiên** vào phòng trống thì được chiếu luôn (server tự `activated`); từ người thứ hai mới phải chờ TV chọn.
  - TV → `{type:'select', id}` (chỉ khi chưa ai chiếu) ⇒ máy đó nhận `activated` rồi tạo offer; TV → `{type:'stop'}` ⇒ máy đó nhận `deactivated` (vẫn ở trong phòng); TV → `{type:'kick', id}` ⇒ máy đó nhận `kicked`. Máy gửi → `{type:'release'}` để tự dừng và về danh sách chờ.
  - `signal` chỉ được chuyển giữa TV và người đang `active`.
- Hai bên trao `{type:'signal', data:{sdp|candidate}}`; máy gửi (người active) tạo offer, TV trả answer.
- Sự kiện: `receiver-left` (TV thoát, mọi máy gửi bị ngắt).
- TV (`receiver.html`) tự tạo mã mới khi phòng trống sau khi từng có người; nút "Tạo mã mới" ngắt cả phòng. Trên TV: phím mũi tên chọn trong danh sách, OK để chiếu; khi đang chiếu bấm OK hiện thanh "Dừng chiếu".
- Chống dò mã: mỗi IP tối đa 8 lần sai/phút. `maxPayload` 64 KB. Origin kiểm tra qua `ALLOWED_ORIGINS`.

## 5. Tính năng trang gửi (sender.html)
- `getDisplayMedia` (cần HTTPS) + âm thanh; chọn kiểu nội dung: *Slide/tài liệu* (`contentHint=detail`, maintain-resolution) hoặc *Video* (`motion`, balanced).
- Bitrate video tối đa 12 Mbps; **tự hạ 3 Mbps khi đi qua TURN** (`adaptBitrate`) và hiện "kết nối trực tiếp / qua máy chủ trung gian".
- Ô **"Tắt tiếng trên máy này"** dùng `suppressLocalAudioPlayback` (Chrome/Edge): chỉ có tác dụng khi chia sẻ **Tab**; chia sẻ toàn màn hình thì trình duyệt không tắt được loa máy gửi. Chưa kiểm chứng trên trình duyệt thật.
- Tự "đánh thức" Render (`scWake`) khi mở trang.

## 6. App TV (MainActivity.java)
WebView toàn màn hình mở `<server>/receiver.html`; giữ màn hình sáng; autoplay có tiếng; chỉ chấp nhận chứng chỉ tự ký của đúng host đã cấu hình; mất kết nối thì hiện thông báo và thử lại mỗi 5 giây. **BACK/MENU** trên remote mở hộp thoại đổi địa chỉ server. Tên app **F88Tivi**, có banner/icon logo F88.

Đặt địa chỉ server từ máy tính:
```bash
adb connect 192.168.0.199:5555
adb -s 192.168.0.199:5555 shell am start -n vn.screencast.tv/.MainActivity --es server https://f88tivi.netlify.app
```
(IP có số → tự thêm `:8443`; tên miền → cổng 443.)

## 7. Cài lại môi trường sau khi cài Win
Công cụ trước đây nằm ở ổ D (cần cài lại và đặt biến môi trường):
- **Node.js** (đã dùng v24) — chạy server/web, `npm install` trong `screencast/`.
- **JDK 17** (`JAVA_HOME`), **Android SDK** (`ANDROID_HOME`) với `platforms;android-34` và `build-tools;34.0.0`, `platform-tools` (adb).
- **Python 3 + Pillow** (`pip install pillow`) cho `gen_icons.py`.
- **Git Bash** (build.sh chạy bằng bash trên Windows).
- Lệnh:
```bash
cd screencast && npm install && npm start          # server LAN: https://<IP-máy>:8443 (chứng chỉ tự ký, tự sinh vào .cert/)
cd screencast/tvapp && bash build.sh               # ra screencast-tv.apk
adb -s 192.168.0.199:5555 install -r screencast-tv.apk
```
- **Không nằm trong git** (phải tạo lại / sao lưu trước khi đổi ổ): `node_modules/`, `.cert/`, `tvapp/debug.keystore`, `tvapp/*.apk`, `tvapp/build/`.
  - **`debug.keystore`**: build.sh tự tạo mới nếu thiếu, nhưng APK ký bằng khóa mới sẽ **không cài đè** được lên bản cũ trên TV → cần `adb uninstall vn.screencast.tv` rồi cài lại. Nên sao lưu file này nếu muốn giữ chữ ký.
- `build.sh` có đường dẫn mặc định `/d/dev/android-sdk` nếu không có `ANDROID_HOME`; sửa lại nếu SDK ở chỗ khác.
- TV phải bật **ADB qua mạng** (cổng 5555); sau khi khởi động lại TV có thể phải bật lại.

## 8. Bộ nhận diện F88 (đã áp dụng)
Xanh đậm `#18745C` (chủ đạo), xanh rừng `#1C5658`, lime `#62E222`, vàng `#FFC000`, chữ `#222222`, xám `#455F51`, nền `#F2F2F2`. Font Montserrat/Open Sans/Arial. Logo gốc ở `assets/f88-logo.png` (xanh `#158349`); trên nền tối dùng bản trắng. Muốn đổi logo: thay file đó rồi chạy `bash screencast/tvapp/build.sh` (sinh lại toàn bộ). Có skill `f88-style` trong Claude nếu cần làm tài liệu/slide theo thương hiệu.

## 9. Việc đã xong
- Web gửi/nhận qua LAN (đã test OK), app Android TV, deploy Netlify + Render, TURN Metered (**đã test chiếu qua 4G bằng iPhone hotspot: chạy tốt**), đổi tên & logo F88Tivi, tùy chọn tắt tiếng máy gửi.

## 10. Việc tiếp theo (theo thứ tự người dùng đã chọn)
1. **App Android gửi màn hình** (MediaProjection + foreground service; có thể Flutter + `flutter_webrtc` để dùng chung cho cả iOS, Windows, macOS).
2. **App iPhone gửi** (ReplayKit *Broadcast Upload Extension*; Safari iOS **không** hỗ trợ `getDisplayMedia`). Cần tài khoản Apple Developer.
3. ~~App Windows để máy gửi im lặng~~ — **đã làm** (`winaudio/`, 2026-11-09): đã đo trên máy dev là process loopback giữ nguyên tín hiệu khi tắt tiếng/hạ âm lượng về 0, nhưng **chưa thử cả chuỗi với TV thật**; chưa có chỉnh độ trễ âm/hình, chưa có trình cài đặt.
4. Sửa nhỏ: mã trên TV đổi sau khi tắt hẳn app (localStorage WebView chưa kịp ghi) ⇒ lưu mã bền hơn (SharedPreferences qua cầu nối JS hoặc server nhớ theo thiết bị).
5. **Thương mại hóa** (chưa bắt đầu): license theo TV, gói doanh nghiệp, chiếu khác mạng là tính năng trả phí, quản lý nhiều TV; chuyển Render sang gói Starter (không ngủ) và TURN trả phí/coturn; gỡ nhãn "Powered by Netlify" (gói miễn phí hiện ở góc TV).

## 11. Lưu ý kỹ thuật & bẫy đã gặp
- Chia sẻ màn hình chỉ chạy trên **HTTPS**; LAN dùng chứng chỉ tự ký (lần đầu trình duyệt cảnh báo → "Tiếp tục"). Dùng Netlify thì không còn cảnh báo.
- Netlify **không** chạy được WebSocket ⇒ signaling bắt buộc ở Render.
- Render free ngủ sau ~15 phút ⇒ lần đầu có thể chờ 30–60 giây.
- `ICE_SERVERS_JSON` sai định dạng ⇒ server ghi log "không phải JSON hợp lệ, bỏ qua" và không gửi TURN ⇒ 4G báo "Không kết nối được tới TV".
- DRM (Netflix…) sẽ đen màn hình khi chiếu.
- Chia sẻ Toàn bộ màn hình trên Windows: tiếng lấy sau âm lượng loa ⇒ hạ loa về 0 thì TV mất tiếng (đã đo). Muốn tắt loa máy mà TV vẫn có tiếng: chia sẻ Tab, hoặc dùng app `winaudio/`.
- macOS chỉ chia sẻ được tiếng của Tab; Windows (Chrome/Edge) chia sẻ được tiếng hệ thống.
- Một số WebView TV có thể không phân giải ICE candidate mDNS `.local` ⇒ rơi sang STUN/TURN; nếu chậm trong LAN thì kiểm tra lại.
- `192.168.0.196` là IP **máy tính**, không phải TV (từng nhầm). IP máy có thể đổi ⇒ nên đặt IP tĩnh trong router.
- Biến `CLOUD`/`RENDER` quyết định chế độ server; `selfsigned` chỉ load lười ở chế độ LAN.
