# 接口与设备数据

适用任务：修改模块职责、聊天 API、Codex 接入、设备设置或记忆。返回 [AGENTS.md](../../AGENTS.md)。

除特别注明外，本文中的路径和命令均相对于项目根目录；Markdown 链接相对于本文文件。

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

## 接口、凭据与设备数据

- 聊天 API 仅有 OpenAI 兼容、Responses、Anthropic 三种协议。地址与模型由用户填写，不恢复模型自动获取或预填模型；保留已保存的自定义配置。
- Codex 登录由官方程序管理，不读取或复制 `auth.json`。对话使用独立临时会话，并保留环境、工具、插件、MCP 和记忆访问限制。
- 按用户要求，API Key 与接口设置自动保存在当前设备：Android 使用应用私有记录，网页使用当前来源的 localStorage。密钥不进入记忆、对话导出或日志，不内置进 APK。公网密码不得写入 APK、文档或公开资源。
- 记忆原文与来源证据归当前设备所有；现实资料与角色剧情分开，自动更正保留旧版本，不自动修改以前保存的手动记忆。仅保留自动记忆与查看、删除入口，不恢复手动添加、整理按钮或检索模式开关。删除记忆时必须取消未完成的整理，不能把删除的数据重新写回。
