# 红莉栖 Anime2.5DRig demo

本机预览：<http://127.0.0.1:3013/>。

这是基于 [852wa/Anime2.5DRig](https://github.com/852wa/Anime2.5DRig) 的独立 2.5D 网页样例，不是 Cubism 原生模型。没有修改 `live2d-authoring/fine` 工程，也没有替换正式应用人物。

本轮验证的是已有分层素材接入自动绑定的可行性，**没有运行 See-through**。复用已有身体、眼睛、嘴部与前发图层；从原有 HeadBase 提取同一张图的脸部像素，使用内置 image_gen 生成独立闭眼素材和完整后发。生成原件在 `assets/eyes-closed-source.png`、`assets/back-hair-source.png`，完整提示词在 `prompts.json`。

## 使用

```powershell
node experiments/anime25d-demo/server.mjs
```

点击“播放 12 秒动作”观看转头、眨眼和示意开口。固定姿态按钮会暂停待机与物理，便于观察中间形状。声音按钮使用项目已有的原作音频，实时分析实际播放音量驱动开口；它不是元音识别，也未接入实时聊天 TTS。

当前含 23 个输入图层及自动绑定结果。适配内容包括中文测试页、独立闭眼素材、嘴内遮罩、保守的头发摆动、短眨眼时序、固定姿态控制，以及音频停止后闭嘴。未使用默认通用五官素材。

## 验证

```powershell
node experiments/anime25d-demo/check-demo.mjs
```

浏览器检查 8 种固定姿态、完整 12 秒演示、网格实际移动、音频播放推进与开口响应、停止后闭口、390px 窄屏布局。截图与当前结果在 `qa/`。这是本机浏览器验证，未验证 Android 设备。

## 已知限制

- 头部转向采用图层视差和剪切，立体感有限；目前仅开放小幅范围。
- 头发顶部仍有素材重叠感，后发新增区域与原画纹理不完全一致。
- 口型仍是开合和简单形状变化，没有社区 Cubism 模型完整的二维口型关键形。
- 自动绑定使用规则网格，不能直接生成 `.cmo3` / `.moc3`。

`engine/` 为上游运行器的本地适配副本，保留其 MIT LICENSE。`prepare-engine.mjs` 记录具体适配，可从 `.local/anime25d/upstream` 重建；`prepare-assets.py` 记录素材打包与透明区域提取。所有路径均限于本机 demo，没有启动或修改 3010 上的托管服务。
