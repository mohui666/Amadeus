# 本机红莉栖风格语音

本机使用官方 GPT-SoVITS v2ProPlus 基础模型，配现有红莉栖原声参考生成新台词。它是参考音色的合成声音，不是原作录音，也没有使用来源不明的第三方角色权重。

## 启动

在项目目录执行：

```bash
bash scripts/start-voice.sh
```

API 绑定 `http://127.0.0.1:19880`，由 Amadeus 后端转发请求。保留此终端运行，按 Ctrl+C 停止。手机浏览器访问 Amadeus 网页时，声音仍由这台电脑的 GPU 生成；电脑和语音进程需要保持运行。

重新安装时执行 `bash scripts/setup-voice.sh`。Python 3.11、虚拟环境、GPT-SoVITS 代码、基础模型、FFmpeg 和参考音频都放在项目的 `.local/voice` 下，不修改系统 Python。首次下载需要数 GB 空间与网络流量。环境针对 WSL Linux 和 NVIDIA GPU；本机是 RTX 4060 Laptop 8GB，已通过 PyTorch 2.7.0+cu126 的真实 GPU 运算，使用 CUDA 和半精度。中文发音的 G2PW 使用 CPU，给语音模型留出显存。

## 参考音频

- 文件：`.local/voice/reference/kurisu-ask.wav`
- 来源：现有 `public/assets/voice/ask_me_whatever.ogg`，4.416 秒；转换为 32kHz 单声道 WAV。
- 参考语言：`ja`
- 日文逐字稿：`どんなことでも聞いてください。可能な範囲でお答えしますから。`

日文前端另补了「牧瀬紅莉栖」「紅莉栖」专名字典；已验证输出读音为「マキセクリス」「クリス」，避免原词典把罕见汉字拆读。

逐字稿由本机 Whisper base 对原声转写得到，与原素材的邀请提问字幕语义一致；标点为整理加入，并非上游提供的日文字幕。原始转写见 `.local/voice/reference-transcripts.json`。素材详细出处见项目的 `ASSETS.md`。

同一日文参考可合成日文或中文。`text_lang` 决定输出语言，`prompt_lang` 必须保留 `ja`；不能因为输出中文而把参考语言改成中文。声线与情绪受到参考片段影响，仅更改提示词不能保证得到原作每一种表演语气。

## 实际试音

使用同一参考和随机种子，比较普通聊天、吐槽、安慰三组对应日文与中文文本；每次返回真实 WAV。样本保存在 `public/generated-voice/`，推理耗时、时长、采样率记录在 `.local/voice/synthesis-results.json`。本地 ASR 用于检查可懂度和漏读，不能代替人对角色相似度的试听。

2026-09-05 本机六组真实推理均返回 HTTP 200、32kHz 单声道 WAV：

| 样本 | 音频时长 | 请求耗时 |
| --- | ---: | ---: |
| 日文普通聊天 `kurisu-ja-chat.wav` | 7.44 秒 | 3.467 秒 |
| 中文普通聊天 `kurisu-zh-chat.wav` | 5.58 秒 | 6.098 秒 |
| 日文吐槽 `ja-teasing.wav` | 6.02 秒 | 1.754 秒 |
| 中文吐槽 `zh-teasing.wav` | 5.68 秒 | 1.806 秒 |
| 日文安慰 `ja-gentle.wav` | 7.04 秒 | 2.179 秒 |
| 中文安慰 `zh-gentle.wav` | 5.16 秒 | 1.672 秒 |

前两条包含对应语言的首次初始化，后四条是同一服务中的后续请求。不是完整聊天端到端延迟，也不是首个音频分块延迟。此轮固定 `seed=42`，没有调速或训练角色专用权重。

本地 Whisper base 转写中，三条日文都保留完整句子结构，出现个别汉字/词形识别差异；中文普通聊天和安慰句出现较多识别偏差，例如「直接问我」识别为「直接卖我」、「别着急，慢慢说」识别为「没了机，那么说」。不能仅凭小型 ASR 分清是合成发音偏差还是识别错误，因此不把它写成角色还原分数。当前建议先用日文语音配中文字幕，中文保留为可试听选项；最终音色偏好以实际试听为准。

此轮没有人耳盲听、没有微调、没有与 v4 比较。后续 Qwen3-TTS 的参考克隆或训练实验应独立报告，不能把这里的结果当作它的结果。

本机的 9880/9881 虽无可见 Linux 监听，绑定会返回 `EADDRINUSE`，因此固定使用已实测可绑定的 **19880**。`scripts/start-voice.sh` 和安装生成的客户端预设保持一致。

## 来源

- [GPT-SoVITS 官方代码与 v2Pro 系列说明](https://github.com/RVC-Boss/GPT-SoVITS#v2pro-release-notes)
- [官方基础模型](https://huggingface.co/lj1995/GPT-SoVITS)
- [官方安装脚本引用的字典和 G2PW 包](https://huggingface.co/XXXXRT/GPT-SoVITS-Pretrained)
- [本地转写工具 Faster Whisper](https://github.com/SYSTRAN/faster-whisper)

官方说明 v2Pro 系列保留接近 v2 的硬件开销和速度，并给出了 4060Ti 的推理数据。本机部署因此先选 v2ProPlus；未在本机对 v4 做对照，不把官方性能说明当成本机测试结果。角色素材与原声的来源约束仍按 `ASSETS.md` 记录。
