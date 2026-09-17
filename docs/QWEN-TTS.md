# Qwen3-TTS 红莉栖声音

## Modal 云端部署

2026-09-06 已部署到 `mmmmmohui` 工作区：[Modal 控制台](https://modal.com/apps/mmmmmohui/main/deployed/amadeus-kurisu-tts)。API Base URL 为 `https://mmmmmohui--amadeus-kurisu-tts-api.modal.run/v1`。

部署入口：[scripts/modal-qwen.py](../scripts/modal-qwen.py)，Windows 项目根目录执行 `npm run deploy:tts:modal`。云端复用 [qwen-api.py](../scripts/qwen-api.py) 的实际推理和编码接口。

| 项目 | 配置 |
|---|---|
| Modal 应用 | `amadeus-kurisu-tts` |
| 模型 | `starrydark/Kurisu_Qwen3_TTS` 1.7B，固定本机版本 `e70b20c9e08a08d516328b35feb9505972a6038b` |
| GPU / CPU / 内存 | 单张 L40S 48 GB / 2 vCPU / 8 GiB |
| 推理 | BF16、SDPA，PyTorch / torchaudio 2.8.0 CUDA 12.6 |
| 扩缩容 | 最少 0、最多 1 个容器；空闲窗口 60 秒，之后缩容到 0 |
| 请求 / 启动超时 | 300 / 600 秒 |
| 模型存储 | 权重和音频 tokenizer 预装在镜像，容器启动时离线加载 |
| 冷启动 | CPU 内存快照保存 PyTorch、Qwen、音频和 HTTP 依赖的导入状态；GPU 权重仍在启动时加载 |
| 鉴权 | Modal Proxy Token，未授权请求在边缘返回 401 |

接口仍为 `POST /v1/audio/speech`，`model`、`voice` 均填 `kurisu`；支持 `wav`、`mp3`、0.5–2 倍速，日语使用 `Auto`，中文使用 `Chinese`。`GET /health` 也需要鉴权。完整合成后才返回音频，缩容后的首次请求包含容器启动和模型加载时间。

独立部署环境位于 `.local/modal/venv`，使用 Python 3.11 与 `modal[api-proxy-support]==1.5.5`；不修改当前本机 TTS 的 Python 环境。重新安装时执行：

```powershell
uv venv .local/modal/venv --python 3.11
uv pip install --python .local/modal/venv/Scripts/python.exe 'modal[api-proxy-support]==1.5.5'
.local/modal/venv/Scripts/python.exe -X utf8 -m modal token new
npm run deploy:tts:modal
```

Modal CLI 的部署凭据由官方程序保存在用户目录 `.modal.toml`，不是语音接口密钥。语音调用使用单独的 Proxy Token：在 Modal 工作区设置中创建，或在自己的终端执行 `.local/modal/venv/Scripts/python.exe -X utf8 -m modal workspace proxy-tokens create`。将输出的 `wk-…` 和 `ws-…` 用句点连接，作为 OpenAI 兼容 API Key；请求头为 `Authorization: Bearer wk-….ws-…`。[官方鉴权说明](https://modal.com/docs/guide/webhook-proxy-auth)

应用声音页的高级设置选择「语音 API」和「OpenAI 兼容」格式，填写云端地址加 `/v1`、模型和声音 `kurisu`。已有 `qwen-tts` 配置继续保留其语言参数。API Key 与接口设置自动保存在此设备，Android 存入应用私有数据；不内置在 APK、不进入对话导出。此次云端部署不自动改写已保存的声音设置，本机服务入口继续保留。

L40S 官方价格为 $0.000542/秒，约 $1.9512/GPU 小时，另计 CPU 和内存；容器加载、推理及保持温热期间均可能计费，缩容为 0 后没有 GPU 运行费。仍保留空闲 60 秒、最少 0 个容器，不常驻 GPU。价格以 [Modal 官方页面](https://modal.com/pricing) 为准。

2026-09-06 首次 L4 部署通过云端 HTTPS 接口验证：无凭据请求返回 401；带临时 Proxy Token 的 `/health` 返回 `qwen3-tts`、`kurisu`、`/models/kurisu`，首次冷启动至完整健康响应为 31.714 秒。随后依次执行：

| 请求 | 合成及接收耗时 | 解码后的音频 |
|---|---:|---|
| 日文 Auto、WAV、1 倍速 | 23.853 秒 | 7.280 秒，24 kHz，单声道 |
| 中文 Chinese、MP3、1.1 倍速 | 14.792 秒 | 4.944 秒，24 kHz，单声道 |

这两次计时包含当前 Windows 网络与代理传输，不是纯 GPU 推理耗时，也不与历史本机单句计时作严格速度比较。两种文件均实际解码，未做本轮人耳音色评价、网页播放或手机实测。测试凭据只存在于测试进程内存，结束后已删除。结果和音频保存在 [.local/modal/smoke-results.json](../.local/modal/smoke-results.json)、[日文 WAV](../.local/modal/modal-ja.wav)、[中文 MP3](../.local/modal/modal-zh.mp3)。Windows 服务按项目入口重启后，网页、Qwen 和 Whisper 健康接口均通过。

### L40S 加速验证

随后按相同模型版本、BF16、SDPA、输入台词与 seed 42，在独立临时任务中对照两张 GPU。4 个 PyTorch CPU 线程时，L4 日语合成 15.145 秒、音频 6.56 秒，中文合成 12.327 秒、音频 5.76 秒；L40S 分别为 5.146 秒 / 5.68 秒，以及 4.694 秒 / 6.32 秒。这是容器内包含分词、生成及音频解码的计时，不含 HTTPS 传输。不同 GPU 在同一 seed 下仍产生不同长度音频；按每秒音频所需合成时间计算，L40S 在这两句上约快 2.55 和 2.88 倍。单线程没有显示一致收益，因此保留 4 线程。原始记录见 [GPU 对照](../.local/modal/gpu-comparison.json)。

正式服务已换成 L40S，同时开启 [Modal CPU 内存快照](https://modal.com/docs/guide/memory-snapshots)，不改变模型、采样参数、语音输出格式或接口地址。部署后实际 HTTPS 验证：

| 项目 | 首次 L4 部署 | L40S + 依赖快照 |
|---|---:|---:|
| 首次健康响应（包含启动） | 31.714 秒 | 15.794 秒 |
| 日文完整 WAV 收完 | 23.853 秒 / 7.28 秒音频 | 10.069 秒 / 6.64 秒音频 |
| 中文 1.1 倍速 MP3 收完 | 14.792 秒 / 4.944 秒音频 | 9.321 秒 / 5.664 秒音频 |

HTTPS 对照是同样台词的单次请求，未固定生成随机种子，包含当时的网络与代理开销，不是稳定延迟承诺。WAV 和 MP3 均实际解码；未授权仍返回 401。结果见 [加速后接口记录](../.local/modal/l40s-snapshot/smoke-results.json)。临时 GPU 对照任务已经结束，正式服务仍按原规则自动缩容。

另通过 Modal 统计确认容器数降到 0 后，再次请求 `/health`，耗时 23.359 秒；日志确认从内存快照恢复。随后日文 WAV 生成及接收耗时 11.235 秒，实际音频 6.56 秒，解码通过。见 [缩容后恢复记录](../.local/modal/l40s-snapshot/restored-results.json)。因此本轮两个冷启动样本约为 16–23 秒；未单独隔离 L40S 和快照各自对冷启动的贡献，不将首个 15.794 秒样本当作固定启动时间。

## 当前默认：starrydark 1.7B

已安装 [starrydark/Kurisu_Qwen3_TTS](https://huggingface.co/starrydark/Kurisu_Qwen3_TTS)，当前 Windows 后台入口 `npm run start:windows` 加载 `.local/qwen-tts/models/starrydark-kurisu`。旧 WSL `amadeus.service` 已停用；`npm run start:qwen` 保留为 Linux 手动入口，不与 Windows 服务同时启动。模型和音频 tokenizer 合计约 4.52 GB；权重留在电脑，手机通过现有密码网关调用，无需更换地址或登录信息。

作者标注底模为 Qwen3-TTS-12Hz-1.7B-Base，主要面向日语；配置为 `custom_voice`，说话人 ID 为 `kurisu`。作者没有给出可核实的完整训练数据规模，不把它称为全部原作录音训练的模型。中文可以试读，效果需单独验证。[模型配置](https://huggingface.co/starrydark/Kurisu_Qwen3_TTS/blob/main/config.json)

本机使用 RTX 4060 Laptop 8 GB、BF16、SDPA。接口仍为 `http://127.0.0.1:19882/v1/audio/speech`，`model` 和 `voice` 均为 `kurisu`，`/health` 返回实际加载的 checkpoint 路径。接口完整合成后返回 WAV 或 MP3，网页请求 MP3，尚未实现流式首包播放。Windows 使用 imageio-ffmpeg 附带的原生 FFmpeg 编码。

本次同一句日文对照：「だから、クリスティーナじゃないってば。まったく、あなたって本当に懲りないのね。」两次均经过本地 HTTP 接口，计时到完整 WAV 收完，使用 Auto；没有固定采样种子，是单次对照。

| 模型 | 合成及接收耗时 | 音频时长 |
|---|---:|---:|
| 之前的 0.6B LoRA | 8.398 秒 | 6.00 秒 |
| starrydark 1.7B | 12.118 秒 | 7.60 秒 |

新模型此句没有更快，输出也更长。显式 Chinese 的中文试读耗时 10.693 秒、音频 7.20 秒。两句完成后 `nvidia-smi` 读到全卡已用 6,666 MiB / 8,188 MiB，包含其他进程，不是该模型独占或峰值显存。本机 Whisper base 对新旧日文尾句均有错词，新模型中文末句也有错词；这些转写无法单独区分 ASR 错误和合成发音问题，更不能证明音色相似度。当前未做人耳盲听。

试听：[starrydark 日文](../public/generated-voice/starrydark-ja-chat.wav)、[旧版同句日文](../public/generated-voice/local-06b-vs-starrydark-ja.wav)、[starrydark 中文](../public/generated-voice/starrydark-zh-chat.wav)。原始计时见 [新版](../.local/qwen-tts/starrydark-comparison.json) 与 [旧版](../.local/qwen-tts/starrydark-baseline.json)，转写见 [ASR 结果](../.local/qwen-tts/starrydark-asr.json)。

新版 APK 已实际安装，并在无 ADB reverse 的 Android 16 模拟器上通过密码公网入口完成新模型 6.64 秒语音的完整播放；语音请求收完耗时 19.587 秒，包含公网传输。详见 [安卓实测](ANDROID.md#starrydark-17b-模型接入实测2026-09-05)。

旧 0.6B 模型保留在 `.local/qwen-tts/training/kurisu`。需要单独对照时，先停下运行中的千问入口，再用 `scripts/start-qwen.sh --model-path .local/qwen-tts/training/kurisu` 启动。下文的 144 条训练、loss、显存与历史对照均属于旧模型。

## 之前的 0.6B 本机训练

2026-09-05，已在本机 RTX 4060 8 GB 上完成 **Qwen3-TTS-12Hz-0.6B-Base 的 LoRA 迁移训练**：144 条日语自然对白训练、16 条独立于训练的验证录音，3 epoch、108 次优化器更新，耗时 128.56 秒。最优适配参数已合并导出到 `.local/qwen-tts/training/kurisu`。验证 loss 从 2.92565 降至 2.72626，模型重载、语音生成和真实网页播放均通过。训练前后对照已完成，但没有人耳盲听，不能把 loss 下降当成声音更像红莉栖的证明。

实际指标来自 [preparation-metrics.json](../.local/qwen-tts/data/preparation-metrics.json) 和 [training-metrics.json](../.local/qwen-tts/training/training-metrics.json)。这些是本次数据、脚本和硬件的实测结果，不是官方最低显存要求。

## 数据与结果

| 项目 | 实际结果 |
|---|---|
| 训练集 | `train.natural.jsonl`，144 条，747.813 秒（12.46 分钟），9,414 个音频 token 帧 |
| 留出验证集 | `holdout.checked.jsonl`，16 条，79.124 秒，998 个音频 token 帧 |
| 音频格式 | 24 kHz、单声道 PCM WAV；另存转换结果，原素材未改动 |
| 固定参考录音 | `.local/voice/reference/kurisu-ask.wav`，4.416375 秒；未进入留出集 |
| Tokenizer 准备 | batch 1，160 条合计 20.58 秒 |
| 可训练参数 | 1,351,680（约 1.35 M），占含 adapter 模型参数约 0.1476% |
| 训练设置 | BF16、SDPA、LoRA rank 8 / alpha 16 / dropout 0.05、学习率 2e-5 |
| Batch 与累积 | batch 1、梯度累积 4、非重入梯度 checkpoint |
| 完整训练 | 3 epoch，108 次优化器更新，128.56 秒 |
| PyTorch 峰值显存 | allocated 2,088.3 MiB；reserved 2,444.0 MiB |
| 最优 checkpoint | 第 3 epoch；已保存 adapter 并合并导出 |

上表显存是 PyTorch 统计，不包括其他进程及全部驱动开销。音频 tokens 在训练前单独提取，训练时释放 tokenizer，冻结底模和 speaker encoder，仅优化两级 Talker 注意力 q/v 层的 LoRA 参数。

| 阶段 | 累计优化器更新 | 训练 loss | 留出 main CE | 留出 sub CE | 留出 loss |
|---|---:|---:|---:|---:|---:|
| 训练前 | 0 | — | 1.42084 | 5.01601 | 2.92565 |
| Epoch 1 | 36 | 2.80809 | 1.32267 | 4.96660 | 2.81265 |
| Epoch 2 | 72 | 2.69520 | 1.28292 | 4.91418 | 2.75717 |
| Epoch 3 | 108 | 2.63140 | 1.26278 | 4.87826 | 2.72626 |

loss 定义为 `main_ce + 0.3 × sub_ce`，两项 CE 各按有效 token 数加权。训练 loss 是该轮更新过程的统计；验证 loss 在每轮结束后单独计算，并用于选择最佳 epoch，因此这 16 条是验证集，不是最后的盲测集。最佳 LoRA B 参数相对零初始化的 L1 变化为 402.88127，说明实际发生了参数更新。loss 和参数变化都不代表音色还原率。

## 实际语音对照

完成 GPT-SoVITS、Qwen Base、Qwen 微调版各 6 条对应日中台词（聊天、吐槽、安慰），另对 Base/微调版各补一条显式 Chinese 的中文诊断，共 20 个对照样本。Qwen 两阶段使用同一参考、seed 42、SDPA BF16 和相同采样参数；Base 使用参考音频+文字条件，微调版使用保存到模型的 kurisu 声音。原始结果见 [Base](../.local/qwen-tts/comparison-base.json)、[微调](../.local/qwen-tts/comparison-finetuned.json)、[Base 中文诊断](../.local/qwen-tts/comparison-base-chinese.json)、[微调中文诊断](../.local/qwen-tts/comparison-finetuned-chinese.json)。

| 同一日文聊天台词 | 输出时长 | 合成耗时 |
|---|---:|---:|
| GPT-SoVITS | 7.44 秒 | 3.467 秒 |
| Qwen Base | 8.56 秒 | 13.265 秒 |
| Qwen 微调版 | 6.64 秒 | 9.441 秒 |

Base 和微调版三条日文均能被本机 Whisper base 完整转写，少量词形差异不足以说明谁的声线更像。微调版生成的语音更短，不能把全部等待时间差解释为推理效率提升；GPT-SoVITS 的计时还包含 HTTP 与 WAV 保存，三者不是严格统一计时边界。

中文有明确的语种选择问题：Base 使用 Auto 的三条中文被 ASR 判成日语，默认中文转写全空；微调后的 Auto 能得到中文转写，但仍有错词。对同一中文聊天句显式指定 `Chinese` 后，Base 和微调版均得到完整、正确的中文转写。微调版该句为 5.44 秒音频、8.770 秒合成；这是一个短句诊断，不代表所有中文均通过。

应用因此对日文使用已验证的 `Auto`，对中文明确使用 `Chinese`。声音页展示的中文样例采用显式 Chinese，原始 Auto 样例仍保留供核对。没有新增中文训练数据；这次微调素材全部为日文。

另通过真实网页后端 `/api/speech` 验证中文转发及 1.1 倍速：输入「不用勉强自己装作没事。别着急，慢慢说，我在听。」，8.47 秒返回 5.24 秒 WAV；CPU Whisper 转写覆盖完整句子，末尾将同音的「在」写成「再」。该检查验证了中文参数和变速链路，不是人耳音色评价。见 [音频](../.local/qwen-tts/api-chinese-gentle.wav) 与 [转写](../.local/qwen-tts/api-chinese-gentle.json)。

真实手机尺寸网页已完成 Sol low 双语回复 → 本机 Qwen API → 浏览器实际音频 Blob 解码与播放：生成 8.72 秒日文，从发送消息至完成检查为 29.83 秒（不包括整段播放结束）。这是单次完整链路验证，文字不同，不能直接与另一次 GPT-SoVITS 网页运行作严格速度比较。

## 历史训练的复现与使用

以下历史训练命令在 Linux / WSL 项目根目录执行，使用已配置的 `.local/qwen-tts/venv`、已下载的底模和本地上游源码；不与当前 Windows 后台服务同时运行。Windows 日常使用只需 `npm run start:windows`。

启动当前默认的 starrydark 1.7B 声音：

```bash
npm run start:qwen
```

该入口同时启动网页 `http://localhost:3010` 与 Qwen 语音服务 `http://127.0.0.1:19882`。声音设置中可点击「使用本机配置」；首次打开默认采用此入口指定的本机声音。切回 GPT-SoVITS 时先停止当前入口，再运行 `npm run start:local`，并选对应预设。两套模型文件均保留。

以下命令重新准备数据并训练：

```bash
.local/qwen-tts/venv/bin/python scripts/prepare-qwen.py \
  --train-jsonl .local/kurisu-dataset/train.natural.jsonl \
  --holdout-jsonl .local/kurisu-dataset/holdout.checked.jsonl \
  --reference-audio .local/voice/reference/kurisu-ask.wav

.local/qwen-tts/venv/bin/python scripts/train-qwen.py
```

[prepare-qwen.py](../scripts/prepare-qwen.py) 的两个数据集路径就是上述默认值。它输出 `.local/qwen-tts/data/train-with-codes.jsonl`、`holdout-with-codes.jsonl`、固定的 `reference.wav` 及准备指标。[train-qwen.py](../scripts/train-qwen.py) 默认读取这些文件，执行上述完整 3 epoch，输出：

- `.local/qwen-tts/training/adapter-best/`：仅保留留出 loss 最优的 LoRA 适配参数。
- `.local/qwen-tts/training/kurisu/`：合并后的 `custom_voice` 模型、tokenizer 和配置。
- `.local/qwen-tts/training/training-metrics.json`：实际步数、各轮 loss、显存与导出位置。

训练的日语转写使用官方 collator 的 **Auto 语言前缀**。导出模型的日文调用方式如下；中文请设 `language="Chinese"`。

```python
import torch
from qwen_tts import Qwen3TTSModel

model = Qwen3TTSModel.from_pretrained(
    ".local/qwen-tts/training/kurisu",
    device_map="cuda:0",
    dtype=torch.bfloat16,
    attn_implementation="sdpa",
)
wavs, sample_rate = model.generate_custom_voice(
    text="助手って呼ばないで。私には牧瀬紅莉栖っていう名前があるの。",
    speaker="kurisu",
    language="Auto",
)
```

## 对官方训练实现的必要适配

本地脚本复用官方 `TTSDataset`，没有修改上游源码。当前官方 [sft_12hz.py](https://github.com/QwenLM/Qwen3-TTS/blob/main/finetuning/sft_12hz.py) 使用全参数 AdamW，未提供 LoRA 开关；这里通过 [PEFT 的自定义模型 LoRA 接口](https://huggingface.co/docs/peft/developer_guides/custom_models) 只训练适配参数。

- **文字维度投影。** 0.6B 的文字 embedding 为 2048 维，Talker 为 1024 维。本地先调用模型已有的 `text_projection`，再与音频 embedding 相加，与正常推理一致。[官方 0.6B 配置](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base/blob/main/config.json)
- **预测目标对齐。** 本地直接计算已移位目标的交叉熵，避免再经 causal loss 二次移位；sub-talker 使用上一时刻 Talker hidden 与当前帧 code0…14 预测 code1…15，与实际生成条件保持一致。[官方模型实现](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/core/models/modeling_qwen3_tts.py)
- **语言与说话人保存。** 官方 [dataset.py](https://github.com/QwenLM/Qwen3-TTS/blob/main/finetuning/dataset.py) 采用 Auto 前缀，本地训练与导出推理保持一致。最佳 adapter 在 CPU 合并；按官方保存逻辑写入说话人 ID 3000 与固定参考的 speaker embedding，去除不再使用的 speaker encoder，保留原始配置结构和 tokenizer。

除本次完整 GPU 训练和导出外，CPU 微型模型已通过前向、反向、LoRA 更新、非重入 checkpoint、adapter 保存恢复、合并及权重严格重载检查。它验证结构正确性，不代替完整模型语音生成与试听。

## 官方资源与适用范围

| 官方资源 | 地址 |
|---|---|
| 源码与模型能力 | [QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) |
| 本次底模 | [Qwen3-TTS-12Hz-0.6B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base) |
| 较大底模，本次未训练 | [Qwen3-TTS-12Hz-1.7B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) |
| 音频 tokenizer | [Qwen3-TTS-Tokenizer-12Hz](https://huggingface.co/Qwen/Qwen3-TTS-Tokenizer-12Hz) |
| 官方数据与 SFT 说明 | [finetuning/README.md](https://github.com/QwenLM/Qwen3-TTS/blob/main/finetuning/README.md) |

两种 Base 模型均支持日语、参考录音克隆和微调。这里选择 0.6B 完成本机训练；没有测试 1.7B 的训练显存或音色。24 kHz 是 WAV 采样率，12 Hz 是音频 token 帧率。原始 Base 的 `generate_voice_clone` 不更新权重；本次 LoRA 有反向传播和优化器更新，属于实际迁移训练。0.6B CustomVoice 会忽略 `instruct`，不能用它承诺独立的情绪指令控制。[官方推理接口](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/inference/qwen3_tts_model.py)

Qwen3-TTS 代码与官方模型标注 Apache-2.0；它不自动授予另外输入的游戏录音、角色素材或表演的商业使用许可。本页只记录本机训练与验证结果。[项目许可证](https://github.com/QwenLM/Qwen3-TTS/blob/main/LICENSE)
