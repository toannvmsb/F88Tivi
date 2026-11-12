package vn.screencast.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;

/**
 * Màn hình nhận ScreenCast: một WebView toàn màn hình mở trang /receiver.html của máy chủ trong LAN.
 * BACK hoặc MENU trên remote: mở hộp thoại đổi địa chỉ máy chủ.
 * Có thể đặt địa chỉ từ xa bằng ADB:
 *   adb shell am start -n vn.screencast.tv/.MainActivity --es server https://192.168.0.196:8443
 */
public class MainActivity extends Activity {
    private static final String DEFAULT_SERVER = "https://f88tivi.netlify.app";
    private static final String PREFS = "screencast";
    private static final long RETRY_MS = 5000;

    private FrameLayout root;
    private WebView web;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private String server;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        server = prefs.getString("server", DEFAULT_SERVER);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // cho phép tự phát cả âm thanh
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler h, SslError error) {
                // Chỉ chấp nhận chứng chỉ tự ký của đúng máy chủ đã cấu hình.
                String host = Uri.parse(server).getHost();
                String errHost = Uri.parse(error.getUrl()).getHost();
                if (host != null && host.equals(errHost)) h.proceed(); else h.cancel();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback cb) {
                if (customView != null) { cb.onCustomViewHidden(); return; }
                customView = view; customCallback = cb;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.GONE);
            }

            @Override
            public void onHideCustomView() { hideCustomView(); }
        });

        handleIntent(getIntent());
        load();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
        load();
    }

    private void handleIntent(Intent i) {
        String s = i == null ? null : i.getStringExtra("server");
        if (s != null && !s.trim().isEmpty()) saveServer(s);
    }

    private String normalize(String in) {
        String s = in.trim();
        if (s.isEmpty()) return DEFAULT_SERVER;
        if (!s.contains("://")) s = "https://" + s;
        int slash = s.indexOf('/', s.indexOf("://") + 3);
        if (slash > 0) s = s.substring(0, slash);                 // bỏ đường dẫn
        String authority = s.substring(s.indexOf("://") + 3);
        // Chỉ thêm cổng mặc định cho địa chỉ IP trong LAN; tên miền (Netlify...) dùng cổng 443.
        if (!authority.contains(":") && authority.matches("\\d{1,3}(\\.\\d{1,3}){3}")) s += ":8443";
        return s;
    }

    private void saveServer(String s) {
        server = normalize(s);
        prefs.edit().putString("server", server).apply();
    }

    private void load() {
        handler.removeCallbacksAndMessages(null);
        web.loadUrl(server + "/receiver.html");
    }

    private void showOffline() {
        String html = "<html><body style='background:#0b0f1a;color:#eef2fa;font-family:sans-serif;text-align:center;padding-top:20vh'>"
                + "<h1>Không kết nối được máy chủ</h1>"
                + "<h2 style='color:#93a0bd'>" + server + "</h2>"
                + "<p style='font-size:28px;color:#93a0bd'>Đang thử lại… &nbsp; Nhấn BACK hoặc MENU để đổi địa chỉ máy chủ.</p>"
                + "</body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(new Runnable() { @Override public void run() { load(); } }, RETRY_MS);
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        if (customCallback != null) { customCallback.onCustomViewHidden(); customCallback = null; }
        web.setVisibility(View.VISIBLE);
    }

    private void showSettings() {
        final EditText input = new EditText(this);
        input.setText(server);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        new AlertDialog.Builder(this)
                .setTitle("Địa chỉ máy chủ ScreenCast")
                .setMessage("Ví dụ: https://192.168.0.196:8443 hoặc https://ten-ban.netlify.app")
                .setView(input)
                .setPositiveButton("Lưu & kết nối", (d, w) -> { saveServer(input.getText().toString()); load(); })
                .setNeutralButton("Thoát ứng dụng", (d, w) -> finish())
                .setNegativeButton("Hủy", null)
                .show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (customView != null) { hideCustomView(); return true; }
            showSettings();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) { showSettings(); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        web.destroy();
        super.onDestroy();
    }
}
