# Amadeus 项目协作说明

项目包含红莉栖手机竖屏界面、Android WebView 外壳，以及电脑端聊天、图像和语音服务。
入口保留共同边界；详细产品规则、素材要求与运行流程按任务读取。

## 始终适用的边界

- 源码修改、验证、服务运行和 APK 构建全部在当前 Windows 项目目录完成。不要调用 WSL，也不要向 WSL 副本同步文件。
- 保留用户已保存的自定义接口配置；聊天 API 仅有 OpenAI 兼容、Responses、Anthropic 三种协议，不恢复模型自动获取或预填模型。
- Codex 登录由官方程序管理，不读取或复制 `auth.json`；对话保留独立临时会话及环境、工具、插件、MCP 和记忆访问限制。
- API Key 与接口设置归当前设备：Android 应用私有记录、网页当前来源的 localStorage。密钥不进入记忆、导出、日志或 APK；公网密码不进入 APK、文档或公开资源。
- 记忆原文和来源证据归当前设备所有，现实资料与角色剧情分开；删除必须阻止未完成整理重新写回。
- `.local/` 的模型、环境和私有配置不放进公开资源或安装包。
- 后端默认仅监听 `127.0.0.1`；保留既有公网入口与登录配置，不随意扩大监听范围。

## 代码定位

- `src/`：界面、设置、对话、语音、Android 桥接与本地记忆。
- `server/`：HTTP 服务、Provider、Codex、记忆整理与密码网关。
- `prompts/kurisu.md`、`public/`：角色提示词与打包素材。
- `scripts/`、`android/`：Windows 服务管理与 APK 构建入口。

## 按任务加载

开始对应任务前读取链接文档；未涉及的专题不必提前加载。

| 任务 | 读取 |
| --- | --- |
| 接口、Codex、配置持久化、记忆或模块职责 | [接口与设备数据](docs/agents/product-and-data.md) |
| 生成或校准立绘、表情协议、声音、设置页或通话交互 | [角色、声音与界面](docs/agents/character-and-ui.md) |
| 启停 Windows 服务、端口、Qwen、Whisper、网关或公网连接 | [Windows 运行与 Android 交付](docs/agents/windows-and-android.md)，启动与构建 |
| 构建、交付或验证 APK | [Windows 运行与 Android 交付](docs/agents/windows-and-android.md)，Android 构建与最小验证 |
| 前端、接口或 UI 改动的验证；检查服务健康 | [Windows 运行与 Android 交付](docs/agents/windows-and-android.md)，最小验证与交付 |

## 交付边界

- 默认双语为日语声音、中文字幕；缺少日文段应报错，不自动改读错误语种。
- Android 包内资源可离线展示，聊天和合成仍依赖电脑服务。
- 夹具通过不能作为真实模型、声音或 Android 设备证据；APK 交付以本次 Gradle 构建为准。

## 路径约定

本文和配套文档中的路径、命令均相对于项目根目录，明确给出的外部绝对路径除外。
Markdown 链接按所在文档的位置解析。
