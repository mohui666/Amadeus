# Live2D 本机试验

访问 `http://127.0.0.1:3012/`，可以连续转头、抬头低头、眨眼、切换六种表情，播放项目已有的原作语音测试开口；模型自带头发、领带和衣服物理。滑块可以手动控制角度和张嘴程度，支持暂停、复位与全身视图。手机宽度支持触摸跟随。

这是独立的真实 Cubism 网格模型原型，使用 WebGL 渲染。默认半身构图，姿态和情绪使用指数平滑；眨眼连续闭合再张开，声音用 Web Audio 实时音量驱动嘴巴。音量驱动尚未区分元音口型。

## 运行

在项目的 Windows PowerShell 中：

```powershell
npm run live2d:setup  # 首次下载社区模型和浏览器运行库到 .local/live2d
npm run live2d:serve  # 前台启动独立本机服务，端口 3012
```

保持服务运行，在另一终端验证：

```powershell
npm run test:live2d
```

浏览器测试加载实际 `.moc3`、纹理、物理和声音，检查网格顶点变化、连续参数、表情、音频口型、暂停复位，以及窄屏布局；截图保存在 `test-results/live2d/`。这不等同于安卓设备性能验证。

## 素材与实现范围

- 模型来源：[FrancescoCaracciolo/Amadeus 的 New Live2D avatar](https://github.com/FrancescoCaracciolo/Amadeus#1-live2d-avatar)，实际下载 [Kurisu.zip](https://nyarchlinux.moe/Kurisu.zip)。本轮使用现有社区模型，没有重新绘制、拆分或绑定原版立绘。模型包未附作者和授权说明，当前仅用于本机试验。
- 运行库：[Live2D Cubism Core 官方 Web 入口](https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js)（本次载入为 5.1.0）；PixiJS 6.5.10；pixi-live2d-display 0.4.0。Core 官方入口是滚动版本，重新下载后可能改变。
- 模型含 72 个参数、114 个可绘制网格。本试验直接控制 `ParamAngleX/Y/Z`、眼睛、嘴巴、呼吸和模型自定义表情参数；`Surprissed` 是模型实际参数名。保留物理计算，关闭包内预制动作，避免与手动参数争用。
- 二进制模型和运行库仅在已忽略的 `.local/live2d/`，独立服务只开放固定的模型、运行库和语音资源目录。未接入正式人物组件、聊天表情时间线或 Android 包。
- 本模型的造型和衣服与现有游戏立绘有差异。要让原版立绘获得同等变形，需要分层素材、遮挡区域补绘及 Cubism Editor 绑定；只导入一张 PNG 不能获得这些变形参数。
