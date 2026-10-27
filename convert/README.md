# 文件转换（loamly-convert v0.1）

浏览器内图片 / PDF 格式转换，部署到 `convert.loamly.cn`。  
产品名「文件转换」；页脚：栖于垄上（上海）网络科技有限公司 · 沪ICP备2026030604号。

v0.1 不含音视频转换（ffmpeg.wasm 未上线，待 v0.2 LGPL-only 构建）。

## 本地预览

```bash
npx serve -l 3090 .
```

## 部署

见 `nginx/`。上传 zip 内文件到 `/var/www/convert`。
