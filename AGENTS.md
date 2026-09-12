# Amadeus 项目协作说明

## 工作范围

- 源码修改、验证、服务运行和 APK 构建全部在当前 Windows 项目目录完成。不要调用 WSL，也不要向 WSL 副本同步文件。

## 项目结构

- `src/`：React 手机竖屏界面、设置、对话、语音与 Android 桥接。
- `src/memory.js`、`src/useMemory.js`、`server/memory.mjs`：设备本地记忆、后台事实整理与语义检索，设计和参考项目见 `docs/MEMORY.md`。
- `server/index.mjs`、`server/providers.mjs`：本机 HTTP 服务及聊天、图像、语音接口。
- `server/codex.mjs`：官方 Codex App Server 接入。
- `server/remote.mjs`：用户名、密码网关；`scripts/start-remote-tunnel.mjs`：公网隧道。
- `prompts/kurisu.md`：红莉栖基础人格提示词；相关研究见 `docs/PERSONA.md` 与 `docs/KURISU-DIALOGUE-STUDY.md`。
- `public/`：随网页和 APK 打包的素材；素材来源见 `ASSETS.md`。
- `android/`：原生 WebView 外壳；`dist/`：网页构建产物；`artifacts/android/Amadeus.apk`：交付安装包。
- `.local/`：本机模型、Python 环境及私有配置，不放进公开资源或安装包。

## 保留的产品契约

- 新增表情直接以原版立绘为参考调用图像生成工具，只改表情；闭眼同样由图像工具生成。禁止脚本画眼皮、拼接五官或套用身体。用户要求用原版和相邻帧重叠核对头发、衣领、领带、肩线；对齐只允许整张立绘等比缩放和平移，不拉伸、旋转或剪切五官。去底保留浅色衣物，完整检查底边和两个下角，不能把衣服缺失误判成定位偏差。各帧以原版统一亮度和色调，校准时排除表情变化区域，检查连续切换是否出现明暗闪动。旧错位草稿不用于构建。
- 表情控制支持句中 `[emotion:名称]`；标签不进入字幕、合成台词或记忆台词，双语模式在对应日语位置重复。按播放进度切换表情，保留缓存重播；协议见 `docs/EXPRESSIONS.md`。
- 默认双语模式为日语声音、中文字幕；缺少日文朗读段时显示具体错误，不自动朗读错误语种。
- 聊天 API 仅有 OpenAI 兼容、Responses、Anthropic 三种协议。地址与模型由用户填写，不恢复模型自动获取或预填模型；保留已保存的自定义配置。
- Codex 登录由官方程序管理，不读取或复制 `auth.json`。对话使用独立临时会话，并保留环境、工具、插件、MCP 和记忆访问限制。
- 按用户要求，API Key 与接口设置自动保存在当前设备：Android 使用应用私有记录，网页使用当前来源的 localStorage。密钥不进入记忆、对话导出或日志，不内置进 APK。公网密码不得写入 APK、文档或公开资源。
- 记忆原文与来源证据归当前设备所有；现实资料与角色剧情分开，自动更正保留旧版本，不自动修改以前保存的手动记忆。仅保留自动记忆与查看、删除入口，不恢复手动添加、整理按钮或检索模式开关。删除记忆时必须取消未完成的整理，不能把删除的数据重新写回。
- 设置维持对话、声音、角色、记忆四页；声音页默认仅显示自动朗读、语速与输入语言，服务与接口配置统一放入默认折叠的“高级声音设置”，不放试听样例或重复预设卡片；对话推理强度默认折叠。
- 保留 CONNECT／CANCEL、点击人物展开操作栏、人物与控件分区、字幕重播及返回键行为。挂断应取消生成、播放、录音与识别。
- 默认语音识别使用本机 Whisper；Android 包内资源可离线展示，聊天和合成仍依赖电脑服务。

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
