package dev.amadeus.kurisu;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.AtomicFile;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.*;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class MainActivity extends Activity {
    private WebView web;
    private String baseUrl;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest mediaPermission;
    private String pendingLanguage;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean ttsReady;
    private String exportContent;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        baseUrl = getPreferences(MODE_PRIVATE).getString("server", "http://127.0.0.1:3010");
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(9, 11, 12));
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(9, 11, 12));
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                android.graphics.Insets cutout = insets.getInsets(WindowInsets.Type.displayCutout());
                view.setPadding(cutout.left, 0, cutout.right, Math.max(ime.bottom, cutout.bottom));
                return insets;
            });
        }
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.addJavascriptInterface(new PhoneBridge(), "AmadeusAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                Uri service = Uri.parse(baseUrl);
                if (!Objects.equals(uri.getScheme(), service.getScheme()) || !Objects.equals(uri.getEncodedAuthority(), service.getEncodedAuthority())) return null;
                String prefix = service.getPath() == null ? "" : service.getPath();
                if (!uri.getPath().startsWith(prefix + "/")) return null;
                String path = uri.getPath().substring(prefix.length());
                if (path.startsWith("/api/")) return null;
                if (!request.getMethod().equals("GET") || path.contains("..")) return missingAsset();
                String asset = path.equals("/") ? "index.html" : path.substring(1);
                try {
                    String extension = MimeTypeMap.getFileExtensionFromUrl(asset);
                    String mime = extension.equals("js") ? "text/javascript" : MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                    return new WebResourceResponse(mime == null ? "application/octet-stream" : mime, "UTF-8", getAssets().open(asset));
                } catch (IOException error) { return missingAsset(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                openExternal(request.getUrl().toString());
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
                startActivityForResult(intent, 21);
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    Uri service = Uri.parse(baseUrl);
                    String origin = service.getScheme() + "://" + service.getEncodedAuthority() + "/";
                    if (!request.getOrigin().toString().equals(origin)) { request.deny(); return; }
                    if (!Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) { request.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else { mediaPermission = request; requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 20); }
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if (mediaPermission == request) mediaPermission = null; }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定", (d,w) -> result.confirm())
                    .setNegativeButton("取消", (d,w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show();
                return true;
            }
        });
        tts = new TextToSpeech(this, status -> ttsReady = status == TextToSpeech.SUCCESS);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            public void onStart(String id) { event("tts", "start"); }
            public void onDone(String id) { event("tts", "end"); }
            public void onRangeStart(String id, int start, int end, int frame) { event("tts-range", String.valueOf(start)); }
            public void onError(String id) { event("tts", "error"); }
        });
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::dispatchBack);
        web.loadUrl(baseUrl + "/");
        if (baseUrl.startsWith("https://") && getPreferences(MODE_PRIVATE).getString("remote-password", "").isEmpty()) {
            web.post(() -> new PhoneBridge().connect());
        }
    }

    private WebResourceResponse missingAsset() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Map.of(), new ByteArrayInputStream("Asset not found".getBytes(StandardCharsets.UTF_8)));
    }
    private void event(String type, String value) {
        runOnUiThread(() -> web.evaluateJavascript("window.dispatchEvent(new CustomEvent('amadeus-native',{detail:{type:" + JSONObject.quote(type) + ",value:" + JSONObject.quote(value) + "}}))", null));
    }
    private void dispatchBack() { event("back", ""); }
    @Override public void onBackPressed() { dispatchBack(); }
    @Override public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus && Build.VERSION.SDK_INT >= 30) {
            getWindow().getInsetsController().hide(WindowInsets.Type.systemBars());
            getWindow().getInsetsController().setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else if (focus) web.setSystemUiVisibility(5894);
    }
    @Override public void onPause() {
        super.onPause();
        // A permission dialog pauses the Activity; retain its pending microphone request.
        if (pendingLanguage != null || mediaPermission != null) return;
        event("pause", "");
        if (recognizer != null) recognizer.cancel();
        if (tts != null) tts.stop();
    }
    @Override public void onDestroy() {
        if (recognizer != null) recognizer.destroy();
        if (tts != null) tts.shutdown();
        web.destroy();
        super.onDestroy();
    }
    private void openExternal(String url) {
        Uri uri = Uri.parse(url);
        if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        }
    }
    private void startRecognition(String language) {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { event("speech-error", "此设备未安装系统语音识别服务，请在声音设置中选择「电脑本地识别」。"); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingLanguage = language;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 20);
            return;
        }
        if (recognizer != null) recognizer.destroy();
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            public void onReadyForSpeech(Bundle data) { event("speech-state", "listening"); }
            public void onBeginningOfSpeech() {}
            public void onRmsChanged(float rms) {}
            public void onBufferReceived(byte[] buffer) {}
            public void onEndOfSpeech() { event("speech-state", "processing"); }
            public void onError(int code) {
                String message = switch (code) {
                    case SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "没有听清，请再说一次。";
                    case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "请允许麦克风权限。";
                    case SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "系统语音识别无法连接网络。";
                    default -> "系统语音识别失败（" + code + "）。可在声音设置中选择语音识别 API。";
                };
                event("speech-error", message);
            }
            public void onResults(Bundle data) {
                ArrayList<String> texts = data.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                event("speech-result", texts == null || texts.isEmpty() ? "" : texts.get(0));
            }
            public void onPartialResults(Bundle data) {}
            public void onEvent(int type, Bundle data) {}
        });
        recognizer.startListening(new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language).putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1));
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != 20) return;
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (mediaPermission != null) {
            if (granted) mediaPermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}); else mediaPermission.deny();
            mediaPermission = null;
        }
        if (pendingLanguage != null) {
            String language = pendingLanguage; pendingLanguage = null;
            if (granted) startRecognition(language); else event("speech-error", "请允许麦克风权限。");
        }
    }
    @Override public void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 21 && fileCallback != null) {
            fileCallback.onReceiveValue(result == RESULT_OK && data != null ? new Uri[]{data.getData()} : null);
            fileCallback = null;
        }
        if (request == 22 && result == RESULT_OK && data != null) {
            try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                out.write(exportContent.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, "对话已导出", Toast.LENGTH_SHORT).show();
            } catch (IOException error) { Toast.makeText(this, "导出失败：" + error.getMessage(), Toast.LENGTH_LONG).show(); }
        }
        if (request == 22) exportContent = null;
    }

    private final class PhoneBridge {
        private AtomicFile recordFile(String key) {
            if (!key.matches("history|memories|audio-[a-fA-F0-9-]{36}")) throw new IllegalArgumentException("本地记录名称无效");
            return new AtomicFile(new File(getFilesDir(), "amadeus-" + key + ".json"));
        }

        @JavascriptInterface public synchronized String readRecord(String key) {
            try {
                AtomicFile file = recordFile(key);
                String value = null;
                try (InputStream input = file.openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    value = output.toString(StandardCharsets.UTF_8.name());
                } catch (FileNotFoundException missing) {
                    if (file.getBaseFile().exists()) throw missing;
                }
                return new JSONObject().put("value", value == null ? JSONObject.NULL : value).toString();
            } catch (Exception error) {
                return "{\"error\":" + JSONObject.quote("本地记录读取失败：" + error.getMessage()) + "}";
            }
        }

        @JavascriptInterface public synchronized String writeRecord(String key, String value) {
            AtomicFile file = null;
            FileOutputStream output = null;
            try {
                file = recordFile(key);
                output = file.startWrite();
                output.write(value.getBytes(StandardCharsets.UTF_8));
                file.finishWrite(output);
                return "";
            } catch (Exception error) {
                if (file != null && output != null) file.failWrite(output);
                return "本地记录保存失败：" + error.getMessage();
            }
        }

        @JavascriptInterface public String serverUrl() { return baseUrl; }
        @JavascriptInterface public String serverAuthorization() {
            if (!baseUrl.startsWith("https://")) return "";
            String user = getPreferences(MODE_PRIVATE).getString("remote-user", "");
            String password = getPreferences(MODE_PRIVATE).getString("remote-password", "");
            if (user.isEmpty() || password.isEmpty()) return "";
            return "Basic " + android.util.Base64.encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
        }
        @JavascriptInterface public void background() { runOnUiThread(() -> moveTaskToBack(true)); }
        @JavascriptInterface public void openUrl(String url) { runOnUiThread(() -> openExternal(url)); }
        @JavascriptInterface public void connect() {
            runOnUiThread(() -> {
                EditText input = new EditText(MainActivity.this);
                input.setText(baseUrl);
                input.setHint("服务地址");
                input.setSingleLine(true);
                input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
                int padding = (int) (24 * getResources().getDisplayMetrics().density);
                EditText user = new EditText(MainActivity.this);
                user.setHint("用户名");
                user.setSingleLine(true);
                user.setText(getPreferences(MODE_PRIVATE).getString("remote-user", "amadeus"));
                EditText password = new EditText(MainActivity.this);
                password.setHint("密码");
                password.setSingleLine(true);
                password.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
                password.setText(getPreferences(MODE_PRIVATE).getString("remote-password", ""));
                LinearLayout fields = new LinearLayout(MainActivity.this);
                fields.setOrientation(LinearLayout.VERTICAL);
                fields.setPadding(padding, 0, padding, padding);
                fields.addView(input); fields.addView(user); fields.addView(password);
                AlertDialog dialog = new AlertDialog.Builder(MainActivity.this).setTitle("连接 Amadeus 服务")
                    .setMessage("通过域名连接电脑，填写用户名和密码后即可使用。登录信息保存在此手机。USB 本地连接不需要密码。")
                    .setView(fields).setNegativeButton("取消", null).setPositiveButton("登录并连接", null).create();
                dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                    String value = input.getText().toString().trim().replaceAll("/+$", "");
                    Uri uri = Uri.parse(value);
                    if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) || uri.getHost() == null || (uri.getPath() != null && uri.getPath().contains("..")) || uri.getQuery() != null || uri.getUserInfo() != null || uri.getFragment() != null) {
                        input.setError("请输入完整服务地址，例如 http://127.0.0.1:3010"); return;
                    }
                    if (value.startsWith("https://") && (user.getText().toString().trim().isEmpty() || password.getText().toString().isEmpty())) {
                        password.setError("请填写用户名和密码。"); return;
                    }
                    getPreferences(MODE_PRIVATE).edit().putString("server", value)
                        .putString("remote-user", user.getText().toString().trim()).putString("remote-password", password.getText().toString()).apply();
                    dialog.dismiss(); recreate();
                }));
                dialog.show();
            });
        }
        @JavascriptInterface public void recognize(String language) { runOnUiThread(() -> startRecognition(language)); }
        @JavascriptInterface public void stopRecognition(boolean cancel) {
            runOnUiThread(() -> {
                pendingLanguage = null;
                if (recognizer != null) {
                    if (cancel) { recognizer.cancel(); recognizer.destroy(); recognizer = null; }
                    else recognizer.stopListening();
                }
            });
        }
        @JavascriptInterface public void speak(String text, String language, float speed) {
            runOnUiThread(() -> {
                if (!ttsReady || tts.setLanguage(Locale.forLanguageTag(language)) < 0) { event("tts", "error"); return; }
                tts.setSpeechRate(speed);
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "amadeus");
            });
        }
        @JavascriptInterface public void stopSpeaking() { runOnUiThread(() -> tts.stop()); }
        @JavascriptInterface public void exportHistory(String json) {
            runOnUiThread(() -> {
                exportContent = json;
                startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json")
                    .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, "amadeus-conversation.json"), 22);
            });
        }
    }
}
