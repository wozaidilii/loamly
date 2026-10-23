# Loamly 双人同屏室 · 异地连麦同步播放器 (`watch.loamly.cn`)

栖于垄上（上海）网络科技有限公司 (`沪ICP备2026030604号`) 旗下浏览器端到端（P2P）本地视频同步播放与双人视频连麦工具。

## 1. 核心特性
- **零外部重依赖后端 (`server.js`)**：基于 Node.js 原生 `http` 与 RFC6455 WebSocket 协议实现，在阿里云国内 ECS 上无需 `npm install` 即可直接秒起服务（默认监听 `127.0.0.1:3080`）。
- **双模式 P2P 视频同屏引擎**：
  - **智能同文件秒切（0 流量模式）**：双方选择同名同大小本地视频文件时自动识别，0 缓冲毫秒级同步。
  - **WebRTC `DataChannel` 本地视频分片直传（一人选片模式）**：支持 `64KB` 高吞吐分块 + `bufferedAmountLowThreshold` 流控，接收端优先走 `MediaSource` (MSE) 流式追加或内存/OPFS Blob URL 缓存，并配备 `captureStream()` 备用轨道降级，兼容 iOS Safari 与 Android 浏览器。
- **WebRTC 双人视频连麦可拖拽悬浮小窗 (PiP) + 智能语音闪避 (Auto Audio Ducking)**：
  - 基于 `AudioContext` + `AnalyserNode` 实时监测本地与远端人声能量，任一方开口说话时 `0.2s` 内将电影音量平滑压低至 `25%`，停顿 `1.0s` 后平滑恢复至 `100%`。
- **移动端专项优化**：
  - `MicroMessenger` 微信内置浏览器自动识别与右上角 `···` 默认浏览器打开引导。
  - `navigator.wakeLock` 屏幕常亮锁，防止房主手机锁屏断流。

## 2. 阿里云 Ubuntu ECS 一键部署
1. 确保阿里云「云解析 DNS」已添加 `A` 记录：`watch` -> `39.103.98.109`，且 ECS 安全组入方向已放行 `80` 与 `443` 端口。
2. 上传 `/workspace/watch-loamly-deploy.zip` 到服务器并解压执行：
```bash
unzip -o watch-loamly-deploy.zip -d /var/www/watch
cd /var/www/watch && sudo bash deploy-on-ecs.sh
```
