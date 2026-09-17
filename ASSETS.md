# Amadeus 素材来源

本地素材来自已经存在的 Amadeus 爱好者项目；原始角色、Logo 和原作语音未重新生成，后续 AI 衍生表情单独列出。原始素材清单记录了 114 个文件；后续生成表情另见文末。逐文件来源、像素尺寸和本地路径记录在 [`public/assets/manifest.json`](public/assets/manifest.json)。

## 角色与界面

主要来源：[Yink/Amadeus](https://github.com/Yink/Amadeus)。该项目明确以《命运石之门 0》中的手机 Amadeus 为复刻对象，其 README 将素材整理鸣谢给 Davixxa，将原作语音整理鸣谢给 8-Bit☆Asian 和 EPK。角色、商标、美术和原作声音仍属于各自权利人；仓库的软件许可证不等于这些素材的单独授权。本项目是非官方个人复刻。

| 本地路径 | 内容 | 尺寸或数量 | 上游路径 |
| --- | --- | --- | --- |
| `public/assets/kurisu/kurisu_{emotion}{frame}.png` | 透明背景红莉栖白大褂立绘 | 19 个表情 × 3 个口型；每张 1213 × 2160 | [`app/src/main/res/drawable-xxxhdpi`](https://github.com/Yink/Amadeus/tree/master/app/src/main/res/drawable-xxxhdpi) |
| `public/assets/interface/bg1.png` | 深色网格与二进制背景 | 1477 × 2580 | 同上 |
| `public/assets/interface/amadeus_icon_smaller.png` | 金色 Amadeus 小标志 | 438 × 306 | 同上 |
| `public/assets/interface/subtitle_frame_big.png` | 原风格字幕框 | 2564 × 430 | 同上 |
| `public/assets/interface/connect_{select,unselect}.png` | 连接按钮两种状态 | 440 × 100 | 同上 |
| `public/assets/interface/cancel_{select,unselect}.png` | 取消按钮两种状态 | 440 × 100 | 同上 |
| `public/assets/interface/incoming_call.png` | 来电图标 | 96 × 96 | 同上 |
| `public/assets/interface/logo1.png` 至 `logo39.png` | 金色 Logo 启动序列 | 39 帧，920 × 800 | [`app/src/main/res/drawable-xxhdpi`](https://github.com/Yink/Amadeus/tree/master/app/src/main/res/drawable-xxhdpi) |

可用 `emotion` 名称：`normal`、`happy`、`angry`、`annoyed`、`blush`、`disappointed`、`eyes_closed`、`indifferent`、`pissed`、`sad`、`side`、`sided_angry`、`sided_blush`、`sided_eyes_closed`、`sided_pleasant`、`sided_surprised`、`sided_thinking`、`sided_worried`、`winking`。

`frame` 为 `1`、`2`、`3`：第 1 帧闭口，后两帧为不同张口口型。所有帧尺寸一致，可直接替换同一个 `<img>` 的地址。上游的 [`kurisu_normal.xml`](https://github.com/Yink/Amadeus/blob/master/app/src/main/res/drawable/kurisu_normal.xml) 为每帧设置 150 毫秒；实际 [`Amadeus.java`](https://github.com/Yink/Amadeus/blob/master/app/src/main/java/com/example/yink/amadeus/Amadeus.java) 根据音频波形切换口型，并在播放结束后回到第 1 帧。`eyes_closed1` 和 `sided_eyes_closed1` 可用于正面与侧面短暂闭眼；这是已有闭眼表情，不是专门的逐帧眨眼或 Live2D 模型。

Logo 序列按编号播放一次。上游 [`logo_animation.xml`](https://github.com/Yink/Amadeus/blob/master/app/src/main/res/drawable/logo_animation.xml) 与 [`integers.xml`](https://github.com/Yink/Amadeus/blob/master/app/src/main/res/values/integers.xml) 指定每帧 40 毫秒，总时长约 1.56 秒。

## 已有语音片段

来源目录：[`Yink/Amadeus/app/src/main/res/raw`](https://github.com/Yink/Amadeus/tree/master/app/src/main/res/raw)。这些是已有片段，只能表达其原本的短句；任意新回复需要另接 TTS API。

| 本地路径 | 用途 | 时长 |
| --- | --- | --- |
| `public/assets/voice/hello.ogg` | 简短问候 | 0.629 秒 |
| `public/assets/voice/pleased_to_meet_you.ogg` | 自我介绍 | 7.544 秒 |
| `public/assets/voice/dont_add_tina.ogg` | 对昵称的抗议 | 0.928 秒 |
| `public/assets/voice/ask_me_whatever.ogg` | 邀请提问 | 4.416 秒 |
| `public/assets/voice/humans_software.ogg` | 人与软件话题 | 5.494 秒 |
| `public/assets/voice/memory_complex.ogg` | 记忆话题 | 4.220 秒 |
| `public/assets/voice/ok.ogg` | 简短回应 | 0.611 秒 |
| `public/assets/voice/tone.ogg` | 提示音 | 1.129 秒 |

时长从本地 Ogg Vorbis 音频头与最后一页采样数读取。片段的情绪映射可参考上游 [`VoiceLine.java`](https://github.com/Yink/Amadeus/blob/master/app/src/main/java/com/example/yink/amadeus/VoiceLine.java)。

以下五项的文件、情绪、字幕键映射已逐项核对 `VoiceLine.java`；简体中文字幕来自上游 [`values-zh-rCN/strings.xml`](https://github.com/Yink/Amadeus/blob/master/app/src/main/res/values-zh-rCN/strings.xml)，保留其原始用字与标点。标题是本项目的展示标签。

| 展示标题 | 文件名 | 上游字幕键 | 上游简体中文字幕 | 上游表情 |
| --- | --- | --- | --- | --- |
| 初次见面 | `pleased_to_meet_you.ogg` | `line_pleased_to_meet_you` | 说起来，还没正式自我介绍过。我叫牧瀬红莉栖，初次见面，请多关照。 | `sided_pleasant` |
| 打个招呼 | `hello.ogg` | `line_hello` | 你好。 | `happy` |
| 昵称抗议 | `dont_add_tina.ogg` | `line_dont_add_tina` | 缇娜 禁止！！ | `angry` |
| 尽管问我 | `ask_me_whatever.ogg` | `line_ask_me_whatever` | 尽管问我吧，我会尽力回答你的。 | `happy` |
| 关于记忆 | `memory_complex.ogg` | `line_memory_complex` | 但是记忆数据和其他数据不同，是很复杂的。 | `indifferent` |

上游 [`values-ja/strings.xml`](https://github.com/Yink/Amadeus/blob/master/app/src/main/res/values-ja/strings.xml) 中这五个字幕键实际仍是英文，与默认 `values/strings.xml` 相同，未提供对应的日文逐字稿。因此不能将根据含义编写的日文短句标记为已经核实的原声台词。

## 界面参考

- [`public/assets/reference/mobile-screen.png`](public/assets/reference/mobile-screen.png)：来自 [Yink/Amadeus 的 Kurisuscreen.png](https://github.com/Yink/Amadeus/blob/master/Screenshots/Kurisuscreen.png)。胸像铺满手机主视口，背后为深色网格，金色标志位于右下角。
- [`public/assets/reference/desktop-screen.jpg`](public/assets/reference/desktop-screen.jpg)：来自 [senkuuuuu/Amadeus 的 screenshot_3.jpg](https://github.com/senkuuuuu/Amadeus/blob/main/sneak_peeks/screenshot_3.jpg)。该爱好者项目以动画第 2 集的大学桌面版为参考，使用中央人物、数字背景、麦克风与终端切换。这里只保存该截图作为布局参考，没有下载其模型或应用实现。

参考截图属于爱好者复刻的截图，不是用于证明与动画每一帧完全一致的原始设定图。

## 本次手机实现的原作对照

2026-09-05 补充了真正出现在游戏、动画中的画面，保存在 `references/original/`，不打入 APK。

| 文件 | 来源 | 用途 |
| --- | --- | --- |
| `official-game-phone.jpg` | [科学 ADV 官方账号发布的游戏画面](https://x.com/kagakuadv/status/828576454707343360) | 白大褂、交叉手臂、人物留白、深色网格和右下角小标志 |
| `game-incoming-call.jpg` | [God is a Geek 游戏评测中的实机截图](https://godisageek.com/reviews/steins-gate-0-review/) | 金色 Logo、Call from Kurisu.、CONNECT 的相对位置 |
| `anime-phone.png` | [Anime UK News 动画评测中的原片截图](https://animeuknews.net/2019/08/steinsgate-0-part-1-review/) | 核对动画的正面构图、暗色数字背景及其与游戏立绘的画风差异 |
| `anime-episode02.jpg` | [巴哈姆特第 2 集讨论中的截图](https://forum.gamer.com.tw/C.php?bsn=17358&snA=2176) | 核对动画中交叉手臂的手机通话场景 |

Android 据此缩小人物、压暗背景、缩小角落标志、移动启动页元素，并取消通话中覆盖人物的大字幕框。字幕和文字输入在点击人物后展开。高屏幕保留竖屏画幅上下留边，未拉伸原素材。

原片中的手机外壳、屏幕反光、操作系统状态栏、游戏画面外部的对白框均不属于手机 App 的界面层。当前 CANCEL 与设置入口是可用性补充，不能声称已由该来电截图逐项验证。现有角色文件是游戏画风的离散表情，仍与动画原画不同；这些截图只支持具体视觉对照，不支持“100% 还原”或全场景验证的结论。实际并排图见 [模拟器对照](artifacts/android/comparison.html)。

## 已撤下的生成表情

2026-09-06 的三组生成表情在拼接对齐后出现五官错位，已从界面与安装包撤下。草稿和处理脚本保留在 `.local/persona-research/rejected-expressions/`，不再用于构建。原版立绘继续保留，修复后的新增素材见下节；控制符映射见 [表情说明](docs/EXPRESSIONS.md)；[生成提示词](docs/expression-generation-prompts.json) 仅为历史记录。

## 以原版重新生成的表情

`public/assets/kurisu/expressions-v3/{skeptical,tender,amused}{1,2,3,4}.png` 分别以原版 `kurisu_normal1/2/3.png` 为参考，通过内置 image_gen 生成，包含闭口、两种口型与闭眼。后处理包括去底、整张图等比缩放和平移，以及以原版为基准的亮度与色调校准；不拼接五官、头发或身体。按用户要求与原版和相邻帧重叠核对，检查完整衣服及底边。最终提示词与每帧来源见 [生成提示词与输入路径示例](docs/expression-original-prompts.example.json)，处理脚本为 `scripts/align-original-expressions.py`。这是生成的衍生素材，不是官方新增原画。

重新处理表情时，将示例复制为 `docs/expression-original-prompts.json`，把 `source` 改为自己的生成图路径后运行处理脚本。实际生成源图与含本机路径的清单不上传。源码 MIT 许可证不覆盖角色、Logo、原声、参考截图或基于原作生成的衍生图像，这些素材的权利仍归各自权利人。

## 阶段一眨眼测试素材

`public/assets/kurisu/animation-phase1/{half,closed}{1,2,3}.png` 为本轮通过内置 image_gen 逐张生成的 6 张衍生立绘，直接参考对应的原版 `kurisu_normal1/2/3.png`，只要求改变眼睛开合。去底、整图等比缩放和平移、排除表情区域的色调校准由现有对齐脚本完成；没有拼接五官或套用身体。与原版和相邻帧进行重叠检查，检查底边及两个下角；一张偏移明显的初稿已重新生成，旧稿仅留在 `.local/animation-phase1/sources/`。

最终 PNG 为 1213 × 2160 RGBA，用于独立的阶段一表情 testcase。提示词与每帧原版参考见 [生成清单](docs/animation-phase1-prompts.json)，测试入口与验证方式见 [表情说明](docs/EXPRESSIONS.md#阶段一表情-testcase)。这些是 AI 衍生补帧，仍存在细微绘制差异，沿用上述角色素材权利说明。
