# Amadeus Android

版本以 `android/app/build.gradle.kts` 为准，包名 `dev.amadeus.kurisu`。运行构建命令后生成 `artifacts/android/Amadeus.apk`，为调试构建，安装包不随源码上传。

界面、57 张表情与口型帧、39 帧启动动画及原声片段随 APK 打包。聊天、OpenAI 账号接入和千问语音生成仍由电脑运行；APK 不包含语言模型或语音模型。Android 使用原生 WebView、系统麦克风权限、语音识别、图片选择器与文件导出。

## 本机启动与安装

先按 [远程连接](REMOTE.md) 准备电脑服务。已配置完整 Windows 运行环境时可在项目根目录启动：

```powershell
npm run start:windows
```

当前服务在 Windows 原生后台运行：网页 `http://127.0.0.1:3010`，千问 `http://127.0.0.1:19882`，Whisper `http://127.0.0.1:19883`。用 `npm run status:windows` 查看进程、`npm run stop:windows` 停止。源码修改、验证和 APK 构建也全部在当前 Windows 项目目录完成，不调用 WSL 或同步副本。不要在已运行的入口旁重复启动同端口服务。

构建 APK 需要兼容项目 Gradle 的 Windows JDK（Java 17 或以上）、Android SDK Platform 37 与 Build Tools。`JAVA_HOME` 指向 Windows JDK；自行创建 `android/local.properties`，将 `sdk.dir` 设置为自己的 SDK 绝对路径（使用正斜杠），该文件不提交 Git。在 Windows 项目根目录执行下列命令，`scripts/build-android.ps1` 会构建网页、调用 `android/gradlew.bat`，并复制 APK 到 `artifacts/android/Amadeus.apk`。

```powershell
npm run build:android
```

手机启用 USB 调试并连接电脑后，对所选设备执行：

```bash
adb -s <设备序列号> install -r artifacts/android/Amadeus.apk
adb -s <设备序列号> reverse tcp:3010 tcp:3010
adb -s <设备序列号> shell am start -n dev.amadeus.kurisu/.MainActivity
```

新安装默认连接 `http://127.0.0.1:3010`，配合上述 USB 转发。远程访问时在启动页齿轮 → 更改连接填写自己的 HTTPS 地址和登录信息，见 [远程连接](REMOTE.md)。已保存的连接设置继续使用。

## 使用

- CONNECT 进入通话，不自动播放自我介绍；原作自我介绍仍可从语音片段手动播放。点击人物展开或收起操作栏。
- 操作栏可发送文字、选图片、使用麦克风、切换自动朗读、查看历史和原声片段。
- 收起操作栏时也显示字幕；展开后人物和操作栏分区，长字幕与菜单可以滚动。正在朗读的句子在字幕与对话记录中高亮；双语回复要求中日文逐句对应。字幕旁可重播当前回复，优先复用本地语音片段。
- 安卓返回键依次关闭设置、历史或操作栏，随后挂断；待机时返回桌面。
- OpenAI 使用电脑当前 Codex 登录。语音默认采用本机 Qwen 预设，普通 API 接口仍可在设置切换。
- 前后台切换会停止录音、播放和正在生成的回复；权限申请中的麦克风请求会保留到用户选择完成。

## 原作对照

[并排对照页面](../artifacts/android/comparison.html) · [对照图片](../artifacts/android/comparison.png) · [逐项来源](../ASSETS.md#本次手机实现的原作对照)

这次对照了科学 ADV 官方发布的游戏通话画面、游戏来电页截图和动画手机画面，据此修正人物比例、背景亮度、角落标志与启动页位置。高屏幕保留上下留边，原立绘不拉伸。

当前立绘是游戏画风，动画原片使用不同的原画；口型为离散图像切换，声音为本机模型生成。没有动画全部表情帧、官方完整 App 交互规范或逐场景的一致性证据，因此本版本不能称为“100% 动画复刻”。

## 历史验证记录

以下为历史版本结果，并非开源版本的本次验证。链接中的 `artifacts/` 与 `test-results/` 为本机证据，不随仓库上传。

### 2026-09-05 本地转发实测（0.2.0）

设备：Pixel 9 AVD，Android 16 / API 36.1，1080 × 2424。APK 实际安装并冷启动；交互通过 Android 输入事件操作，结果从真实 WebView、系统截图及媒体事件读取。下面的模型与语音测试没有替换响应。

| 检查 | 本次结果 |
| --- | --- |
| APK 构建、安装、启动 | Gradle `assembleDebug` 通过，ADB 安装 `Success`，冷启动成功 |
| 启动与人物 | 39 帧 Logo、CONNECT、人物、菜单、挂断均实际运行 |
| 原声与口型 | 自我介绍实际播放结束，7.536 秒，观察到口型 1 / 2 / 3 |
| OpenAI → Qwen → 安卓播放 | Sol low 双语回复与千问生成通过，10.48 秒音频实际播放结束 |
| 安卓图片输入 | 从系统 Downloads 选取 Logo PNG，返回 App 并发送；真实模型回复「这是 Amadeus 的标志」 |
| 麦克风 | 原生权限框、允许后进入 listening、静音输入后正常报告未识别到声音；没有完成真人口述转写验证 |
| 键盘与设置 | 实际输入框聚焦、输入与 IME 显示通过；本轮出现过完整键盘和 Gboard 浮动键盘，最终 APK 检查的是浮动键盘状态；设置可打开，系统返回可关闭 |
| 历史 | 四条真实问答消息跨安装更新、页面重载后保留；图片不持久保存 |
| 电脑服务断开 | 移除设备的 3010 转发、禁用 WebView 网络缓存并重载；API 不通时，包内 PNG 仍返回 200，原声仍完整播放结束；随后恢复转发并确认健康接口 200 |

单次延迟：文字聊天请求 **37.77 秒**，千问合成请求 **15.19 秒**，从发送至开始播放约 **52.98 秒**；图片问题约 **96.07 秒**。两条输入不同，不能用于文本与视觉模型的严格速度比较。当前链路可以运行，但等待时间仍然明显，声音相似度也未通过盲听验证。

证据：[真实文字与声音](../artifacts/android/real-conversation.json)、[真实图片回复](../artifacts/android/real-image-conversation.json)、[断开服务验证](../artifacts/android/offline-check.json)、[启动页](../artifacts/android/final-launch.png)、[人物](../artifacts/android/final-portrait.png)、[麦克风权限](../artifacts/android/09-microphone-permission.png)。文字和图片请求在本轮布局修正前已通过，最终布局修正后再次验证了安装、人物、原声、口型、菜单、IME、设置、返回和断开服务状态。

本轮既有 `npm test` 26 项与浏览器测试 9 组通过；这些是本地协议/页面夹具检查，与上述真实模拟器测试分别记录。未实测物理手机、iOS、未配置的第三方 API、新账号完整 OAuth/设备码提交或安卓文件导出。

## 0.3.0 公网连接实测

当时已配置自己的服务器中转；私有部署信息未公开。增加用户名、密码输入和私有保存；页面、API、录音权限检查支持这个路径。API 直接读取当前服务响应，避免复用域名配置前的旧静态网页缓存。

实际安装 0.3.0 后撤除 ADB reverse，完成公网 Sol low 回复、本机千问合成与安卓 6.56 秒音频完整播放。密码错误会被拒绝。配置方法、精确耗时及证据见 [远程连接](REMOTE.md)。

## starrydark 1.7B 模型接入实测（2026-09-05）

重新构建并安装 0.3.0 APK，声音设置显示 `starrydark · Qwen3-TTS 1.7B` 并提供这次生成的日中样例。电脑实际加载 `.local/qwen-tts/models/starrydark-kurisu`，现有密码与公网地址继续使用。

在同一 Pixel 9 Android 16 模拟器上，ADB reverse 列表为空，从 `当时配置的私有 HTTPS 入口` 完成真实聊天、电脑合成、安卓播放结束。聊天收完耗时 10.930 秒；语音请求收到响应头耗时 11.439 秒、完整音频收完 19.587 秒，生成音频长 6.64 秒。这是一次真实公网运行，语音下载时间计入，不代表稳定延迟。播放后 `/health` 确认使用 starrydark checkpoint。麦克风真人口述与物理手机未在本次新增验证。

证据：[真实调用与播放](../artifacts/android/starrydark-public-conversation.json)、[通话截图](../artifacts/android/starrydark-public-conversation.png)、[声音设置](../artifacts/android/starrydark-voice-settings.png)。同句新旧模型速度与试听见 [千问说明](QWEN-TTS.md)。

## 0.3.1 语音输入修复

修复无系统识别服务的手机无法输入语音，以及切到 OpenAI 识别后因缺少独立 API Key 返回 401。默认改用电脑上的 faster-whisper base（CPU INT8，端口 19883），随本机服务一起启动。手机录音通过已有用户名、密码和公网路径上传；不需要 OpenAI 语音密钥。旧默认识别配置自动修正，其他自定义 API 配置保留。

同时补齐 WebView 录音依赖的 `MODIFY_AUDIO_SETTINGS` 权限。此前 APK 只有 `RECORD_AUDIO`，实际设备日志报告缺少这两个权限组合，并出现 `Could not start audio source`。修复后模拟器能真正开启麦克风并上传 WebM Opus；静音录音由本地识别返回「没有听清」，没有调用系统识别或 OpenAI。录音点击开始，再次点击结束并发送。

本次最小验证：20 项接口/设置测试通过，9 组既有浏览器夹具检查通过，0.3.1 APK 构建、覆盖安装和启动通过。在无 ADB reverse 的 Android 16 模拟器上，先测试真实麦克风静音录音，再将一段已知中文音频注入 MediaStream，经真实 MediaRecorder 编码后走公网识别、自动发送聊天、千问合成和 9.04 秒语音完整播放。没有替换 API 响应，但已知语音输入是预录样本，未宣称真人口述或物理手机验证。

该样本公网识别请求完成耗时 5.083 秒，聊天 11.306 秒，合成及音频下载 26.161 秒；同一原样本转为 WebM 后直接通过本地接口识别耗时 0.589 秒。Whisper 将「我在听」转写成「我再听」，仍有同音字误差，单句不能代表普遍识别准确率或稳定延迟。

证据：[公网录音与完整对话](../artifacts/android/local-asr-public-conversation.json)、[本地 WebM 转写](../artifacts/android/local-asr-api.json)、[静音录音结果](../artifacts/android/local-asr-microphone-silence.png)、[本地识别设置](../artifacts/android/local-asr-settings.png)。


## 0.3.2 设置与通话界面修正

对话 API 仅提供 OpenAI 兼容、Responses、Anthropic；取消服务商地址/模型预设和模型列表自动获取。模型与可选推理强度留空，需要时手动填写，已保存的配置保留。修复手机下拉框文字裁切及设置标题、底栏被挤压的问题。展开菜单时人物与控件分区，长字幕和菜单可滚动；字幕旁可重播当前回复，不重新提交聊天。

千问朗读改用 MP3 减少传输量；语音请求或音频下载断线时显示中文原因和重播入口。31 项接口/后台测试通过后，针对新增 Codex 版本提示又运行了 9 项桥接测试并通过；9 组既有浏览器检查及新增安卓桥接布局夹具通过，后者覆盖 320–430 px 宽度、短视口、协议/模型填写、朗读失败及重播。APK 构建通过。本轮没有安装到模拟器或物理手机；安卓界面截图来自 Chromium 加安卓桥接夹具：[设置](../test-results/native-settings-fixed.png)、[通话](../test-results/native-call-fixed.png)。

本轮真实公网语音接口返回 `audio/mpeg`，短句音频 3,500 字节，请求约 6.37 秒，Chromium 完整播放 0.864 秒。公网隧道仍观察到间歇断线，完整公网对话检查未通过，不能宣称网络故障已彻底解决。另核实电脑 Codex 的默认 `gpt-6-astra` 报告需要更新 Codex；应用现在对此提示手动填写可用模型或更新 Codex，不自动改选模型。显式填写 `gpt-5.6-sol` / `low` 的本机真实调用已返回「我在听。」。
