# 表情控制

回复首行给出初始表情。情绪转折时可以在句中插入 `[emotion:名称]`，只影响后面的台词，例如：

```text
[emotion:neutral]
等等，[emotion:skeptical]这个结论还缺证据。[emotion:tender]我们一起核对吧。
[speech:ja]
待って、[emotion:skeptical]その結論にはまだ証拠が足りない。[emotion:tender]一緒に確かめよう。
```

控制符不会进入字幕、TTS 请求或提取记忆的台词。双语模式在日语段的对应语义位置重复控制符，中文和日语仍保持逐句对应。

支持 `neutral happy angry sad surprised thinking blush annoyed pleasant indifferent worried disappointed wink skeptical tender amused`。表情跟随当前播放的台词，不跟随提前到达的网络文本跳到后半段。

系统声音按词/字符范围事件更新表情。API 语音在回复完成后将朗读文本整段合成，避免每句重新生成声音上下文；双语模式仍只合成日语段。合成音频没有逐字时间戳，按整段播放时长与文字位置估算表情切换和当前朗读句，字幕高亮不是精确的音频对齐。控制符不会切碎合成请求；音频与表情位置一起缓存，重播不需要重新合成。旧分句缓存继续原样播放，未完成缓存的剩余文本整段合成。静音阅读时按已收到正文的最后一个标签更新。

角色在说话、思考和倾听时继续以不固定的间隔眨眼，侧身立绘使用对应闭眼姿势。表情由控制符和倾听、思考状态驱动，不自动轮换姿态；倾听开始时轻微点头，通话中有微弱呼吸起伏；系统减少动态效果设置会关闭这些位移动画。

怀疑、温柔、忍笑使用 `public/assets/kurisu/expressions-v3/` 的新表情，每组 1–4 帧分别对应闭口、小口、大口、闭眼。12 帧分别以原版 `kurisu_normal1/2/3.png` 为参考调用内置 image_gen，要求只改表情；不沿用旧生成图，不拼接五官、头发或身体。

`scripts/align-original-expressions.py` 去除生成背景，并用原版的头发、衣领、领带和衣服特征对整张立绘做等比缩放和平移；不允许旋转、剪切或局部拉伸。核对原版与相邻帧的半透明重叠图，并检查衣服底边和两个下角的完整性。对齐后以原版校准各帧的大范围明暗与色调，同时匹配 Lab 的亮度和颜色通道，改善部分帧肤色偏淡发白的问题。眼睛和嘴不参与校准估计，保留表情线条和透明轮廓；亮度仍以原版为基准，避免与原版表情切换时产生新的明暗差。生成图仍有细微笔触差异，重叠对齐不等于逐像素相同。

最终提示词、原版参考与生成输出见 [生成记录](expression-original-prompts.json)。旧版图集和拼接草稿保留在 `.local/persona-research/rejected-expressions/`，不打入 APK。

## 阶段一表情 testcase

独立测试入口为 `/animation-phase1/index.html`，本机运行时打开 `http://127.0.0.1:3010/animation-phase1/index.html`。本阶段先验证正面平静表情，主界面的 `Character` 尚未切换到这套实现。

- 3 张原版睁眼帧，加上 `public/assets/kurisu/animation-phase1/` 中 6 张半闭眼、闭眼补帧，组成眼睛状态 × 口型的 9 种组合。补帧逐张直接参考对应原版口型，通过内置 image_gen 生成；[提示词与来源](animation-phase1-prompts.json) 保留每帧记录。
- `public/animation-phase1/motion.js` 平滑音量包络，张嘴响应 32 毫秒、收嘴响应 90 毫秒，使用不同的张开/闭合阈值及 45 毫秒最短换帧间隔。眨眼为半闭 45 毫秒、闭眼 65 毫秒、半闭 80 毫秒；眼睛与口型独立选择完整帧。身体仅做整图等比缩放和平移，呼吸相位跨状态连续。
- 测试页并排比较原有方式与阶段一动画，共用原作 OGG 语音，提供完整状态演示、暂停、停止、重播、慢放、逐帧选择、脸部放大和原版重叠检查。不调用聊天或 TTS 接口。

运行 `npm run build`、`npm run test:animation`、`npm run test:animation:ui`；浏览器测试需要本机网页服务，支持通过 `AMADEUS_URL` 指定其他测试地址。`tests/animation-phase1-assets.py` 使用 Pillow 和 NumPy 检查尺寸、透明背景及相对原版的衣服下角覆盖，生成原版与相邻帧的检查图，输出在 `test-results/animation-phase1/`。

重做素材时，按提示词清单放置本机原始生成图，再运行 `scripts/align-original-expressions.py --manifest docs/animation-phase1-prompts.json --output public/assets/kurisu/animation-phase1 --report-prefix test-results/animation-phase1`。本组仍有细微笔触及眼睑形状差异；浏览器播放、素材检查与手机宽度检查不等于精确音素同步或 Android 实机验证。
