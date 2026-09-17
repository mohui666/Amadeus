# 原立绘 Live2D 试作 01

2026-09-07：已通过 Windows Cubism Editor 5.3.04 FREE 完成网格、参数绑定、纹理集和运行时导出。

运行 `npm run live2d:serve`，打开 <http://127.0.0.1:3012/authored/index.html>。页面可播放 12 秒演示、眨眼、原作语音口型，也可分别调整双眼、嘴和侧头，并切换原立绘对照。

## 文件

- `Kurisu-original-v1.psd`：940 × 1674 的五层 PSD。
- `model/Kurisu-original-v1.cmo3`：可以在 Cubism 中继续修改的工程。
- `model/runtime/`：Cubism 导出的 `.moc3`、`.model3.json`、显示信息和一张 2048 × 2048 纹理。
- `sources/`、`prompts.json`、`head-correction-prompt.txt`：图像生成的拆分素材和提示词。
- `layers/`、`assembled-preview.png`、`alignment-review.png`：透明图层、组装预览和原图重叠对照。
- `prepare-layers.py`、`build-psd.mjs`：去除生成素材的棋盘格底，整层等比缩放和平移对齐，生成 PSD；不绘制五官。

参考为 `public/assets/kurisu/kurisu_normal1.png`，开口参考为 `kurisu_normal3.png`。素材由图像工具重新生成并对齐，局部五官与原图仍有差异。

## 当前绑定

| 参数 | 范围 | 实际效果 |
| --- | --- | --- |
| `ParamEyeLOpen` | 0–1 | 左眼网格纵向开合 |
| `ParamEyeROpen` | 0–1 | 右眼网格纵向开合 |
| `ParamMouthOpenY` | 0–1 | 嘴部网格纵向开合 |
| `ParamAngleZ` | -30–30 | `HeadZ` 旋转变形器，实际侧头 -3.5°–3.5° |

`HeadZ` 下有头、双眼、嘴，身体留在根节点。导出包含 27 个标准参数，只有上面 4 个绑定了变形。5 个 ArtMesh，无发丝物理、视线移动、眉毛表情或 X/Y 转脸。

闭眼目前将整只眼睛压成线，半闭时虹膜也会压扁，闭合线过直；嘴只有一组开合形状，闭口线偏淡。头发随头整体移动。此版用于评估原立绘的自制 Live2D 路线，尚不适合作为正式角色表现。

## 继续制作与验证

直接在 Cubism 打开 `.cmo3` 修改。纹理图集已经排好；通过“文件 → 导出运行时文件 → 导出为 moc3 文件”，选择“支持 SDK 5.0 / Cubism 5.0”，导出到 `model/runtime/`，与本机测试页使用的 Core 相匹配。参见 [官方纹理集说明](https://docs.live2d.com/en/cubism-editor-manual/texture-atlas-edit/)。

本次运行 `node tests/live2d-authored.browser.mjs` 的 5 组检查通过：真实 moc3/纹理加载、头与身体独立、双眼和嘴的网格变形、连续眨眼及语音口型/暂停、原图对照和 390px 视口。截图位于 `test-results/live2d-authored/`。这是本机浏览器验证，未接入正式人物、未构建或安装 APK。
