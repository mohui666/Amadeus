# 手机远程连接

本项目需要自行部署电脑后端，不提供公共聊天服务。实际域名、密码和隧道配置只保存在自己的设备。

## 本地与 USB 连接

运行 `npm ci`、`npm run build`、`npm start`，网页默认仅监听 `127.0.0.1:3010`。安卓通过 `adb reverse tcp:3010 tcp:3010` 使用相同地址，见 [Android 说明](ANDROID.md)。

## HTTPS 与密码网关

远程访问需要自己的域名、HTTPS 反向代理和到电脑的连接。不要将未鉴权的 3010 后端直接暴露到公网；它可以访问电脑上的聊天账号和模型服务。

创建本机 `.local/remote/access.json`（已被 Git 忽略）：

```json
{
  "origin": "https://amadeus.example.com",
  "username": "amadeus",
  "password": "REPLACE_WITH_YOUR_OWN_PASSWORD",
  "upstream": "http://127.0.0.1:3010"
}
```

替换示例域名和密码，再运行 `node server/remote.mjs`。网关仅监听 `127.0.0.1:3011`，验证用户名、密码及公开 Host / Origin，转发时移除入口 Authorization。反向代理须保留公开 Host，支持流式响应；若部署在 `/amadeus/` 下，应剥离该前缀再转发到网关。

安卓启动页齿轮 → 更改连接，填写自己的 HTTPS 地址、用户名和密码；浏览器访问时使用 HTTP Basic 登录框。APK 不包含密码，已有安装保存的连接设置继续使用。

## 可选 Chisel 隧道

`scripts/start-remote-tunnel.mjs` 读取上述私有配置，使用 `origin + /_tunnel` 建立连接。Windows 客户端位置为 `.local/remote/windows/chisel.exe`；服务端需要支持反向转发，并配置相同的认证信息。

脚本请求远端 `R:0.0.0.0:3011:127.0.0.1:3011`：远端 3011 应仅在内部网络供 HTTPS 反向代理访问，不映射为公网端口。客户端心跳为 10 秒。服务器和客户端需自行安装，仓库不含现有服务器的网络、容器或凭证配置。

## Windows 完整服务入口

`npm run start:windows` 同时启动网页、Qwen3-TTS、Whisper、密码网关和隧道。它要求提前配置好所有组件，不能在刚克隆后直接当作安装命令使用：

- 千问 Python：`.local/windows/venv/Scripts/python.exe`；模型与依赖见 [千问说明](QWEN-TTS.md)。
- Whisper Python：`.local/windows/asr-venv/Scripts/python.exe`；使用独立环境避免混用 OpenMP 运行库。
- Codex：PATH 中的 `codex.exe` 或 `CODEX_BIN`；账号由官方程序管理。
- 网关和隧道：上述私有配置、Chisel 客户端与自己的服务器。

`npm run status:windows` 查看进程，`npm run stop:windows` 停止。日志位于 `.local/windows/logs/`；没有注册开机启动。实际健康接口为网页 `3010/api/health`、千问 `19882/health`、Whisper `19883/health`。已有服务运行时，不重复启动同端口进程。

电脑关闭或服务停止后，聊天、合成和识别不可用；APK 中的素材和已经缓存的语音仍可离线使用。修改密码时同步网关、隧道服务端及手机设置。不要把这些配置、日志或聊天截图提交到仓库。
