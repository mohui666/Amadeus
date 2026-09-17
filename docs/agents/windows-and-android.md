# Windows 运行与 Android 交付

适用任务：启动或修改服务、构建网页/APK，或验证改动。返回 [AGENTS.md](../../AGENTS.md)。

除特别注明外，本文中的路径和命令均相对于项目根目录；Markdown 链接相对于本文文件。

## 工作范围

- 源码修改、验证、服务运行和 APK 构建全部在当前 Windows 项目目录完成。不要调用 WSL，也不要向 WSL 副本同步文件。

## 启动与构建

需要 Node.js 22.13+。网页构建为 `npm run build`，单独后端为 `npm start`，开发入口为 `npm run dev`。

当前服务在本项目的 Windows 目录原生运行。PowerShell 中使用：

```powershell
npm run start:windows
npm run status:windows
npm run stop:windows
```

入口 `scripts/windows-services.ps1` 在后台启动网页、Qwen3-TTS、Whisper、密码网关和隧道；日志位于 `.local/windows/logs/`。千问使用 `.local/windows/venv`，复用本机 Conda `base310` 的 CUDA PyTorch；Whisper 使用独立的 `.local/windows/asr-venv`，避免混用 OpenMP 运行库。隧道使用 `.local/remote/windows/chisel.exe`，MP3 编码使用 `imageio-ffmpeg` 的 Windows 程序。

WSL 副本 `/home/codex/projects/generalprojects/amadeus` 的 `amadeus.service`、`amadeus-remote.service`、`amadeus-tunnel.service` 已停止并禁用自动启动，不重新启动它们。Windows 服务运行时不要再执行 `npm start`、`npm run start:qwen` 或 `npm run start:local`，避免争用端口。修改服务代码或基础提示词后，用 Windows 停止、启动命令重启。当前入口是后台进程，不注册开机启动任务。

本机端口：网页 `3010`、密码网关 `3011`、千问 `19882`、Whisper `19883`。后端默认仅监听 `127.0.0.1`，手机公网入口为 `https://phone-ai-app.mahui.site/amadeus/`；连接说明见 `docs/REMOTE.md`，不随意改变监听范围或登录配置。

Android 构建在当前 Windows 项目目录的 PowerShell 执行：

```powershell
npm run build:android
```

入口 `scripts/build-android.ps1` 先构建网页，再通过 Windows `android/gradlew.bat` 执行 `assembleDebug`，最后复制安装包到本项目的 `artifacts/android/Amadeus.apk`。需要兼容项目 Gradle 的 Windows JDK（Java 17 或以上）和 Android SDK Platform 37；`JAVA_HOME` 指向 Windows JDK，`android/local.properties` 的 `sdk.dir` 当前为 `C:/Users/mohui666/AppData/Local/Android/Sdk`。版本以 `android/app/build.gradle.kts` 为准，安装包是调试签名构建。构建成功后提供 APK 可点击链接，不使用 WSL 构建或跨副本同步流程。

## 最小验证与交付

- 前端改动运行 `npm run build`；接口或协议改动运行相关既有测试，统一入口为 `npm test`。
- UI 改动按需运行 `npm run test:ui`，需要运行中的本机服务和 Playwright Chromium。夹具通过不能作为真实模型、声音或安卓设备证据。
- 启动服务检查实际健康接口：网页 `/api/health`，千问和 Whisper `/health`。公网使用已有私有配置验证，不在命令输出中显示密码。
- 安装包交付以本次 Gradle 构建结果为准。
