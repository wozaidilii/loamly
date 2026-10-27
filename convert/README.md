# 文件转换（loamly-convert v0.3）

浏览器内图片 / PDF 格式转换（选择树交互），部署到 `convert.loamly.cn`。  
产品名「文件转换」；页脚含 `v0.3` 与公司主体、ICP。

Phase A：PDF 合并 / 拆页 / 抽页 / 压缩；图片 BMP·ICO·TIFF·灰度·缩放；AVIF 输出按浏览器能力显示。  
音视频转换未上线（待 LGPL-only ffmpeg.wasm）。

## 本地预览

```bash
node scripts/static-server.mjs . 3090
```

## 测试

```bash
node scripts/e2e.mjs
```
