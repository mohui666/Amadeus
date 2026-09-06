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

系统声音按词/字符范围事件更新表情；合成音频没有逐字时间戳，按每句播放时长与控制符字符位置估算句内切换。控制符不会切碎合成请求；音频与表情位置一起缓存，重播不需要重新合成。静音阅读时按已收到正文的最后一个标签更新。

角色在说话、思考和倾听时继续以不固定的间隔眨眼，侧身立绘使用对应闭眼姿势。表情由控制符和倾听、思考状态驱动，不自动轮换姿态；倾听开始时轻微点头，通话中有微弱呼吸起伏；系统减少动态效果设置会关闭这些位移动画。

怀疑、温柔、忍笑使用 `public/assets/kurisu/expressions-v3/` 的新表情，每组 1–4 帧分别对应闭口、小口、大口、闭眼。12 帧分别以原版 `kurisu_normal1/2/3.png` 为参考调用内置 image_gen，要求只改表情；不沿用旧生成图，不拼接五官、头发或身体。

`scripts/align-original-expressions.py` 去除生成背景，并用原版的头发、衣领、领带和衣服特征对整张立绘做等比缩放和平移；不允许旋转、剪切或局部拉伸。核对原版与相邻帧的半透明重叠图，并检查衣服底边和两个下角的完整性。对齐后以原版校准各帧的大范围明暗与色调，同时匹配 Lab 的亮度和颜色通道，改善部分帧肤色偏淡发白的问题。眼睛和嘴不参与校准估计，保留表情线条和透明轮廓；亮度仍以原版为基准，避免与原版表情切换时产生新的明暗差。生成图仍有细微笔触差异，重叠对齐不等于逐像素相同。

最终提示词、原版参考与生成输出见 [生成记录](expression-original-prompts.json)。旧版图集和拼接草稿保留在 `.local/persona-research/rejected-expressions/`，不打入 APK。
