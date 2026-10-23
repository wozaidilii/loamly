#!/usr/bin/env bash
# ==============================================================================
# Loamly 双人同屏室 · 异地连麦同步播放器 (watch.loamly.cn)
# 阿里云 Ubuntu ECS 一键部署脚本 (零外部 npm 依赖 · 秒级启动)
# 用法: sudo bash deploy-on-ecs.sh
# ==============================================================================
set -euo pipefail

APP_DIR="/var/www/watch"
SERVICE_NAME="loamly-watch.service"
NGINX_CONF="/etc/nginx/conf.d/watch.conf"
DOMAIN="watch.loamly.cn"
EMAIL="contact@loamly.net"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "${SRC_DIR}/server.js" ] && [ -f "$(dirname "${SRC_DIR}")/server.js" ]; then
  SRC_DIR="$(dirname "${SRC_DIR}")"
fi

echo "==> [1/5] 检查基础运行环境 (Node.js / Nginx / Certbot)..."
export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nodejs
fi

if ! command -v nginx >/dev/null 2>&1 || ! command -v certbot >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nginx certbot python3-certbot-nginx
fi

echo "==> [2/5] 同步应用文件到 ${APP_DIR}..."
mkdir -p "${APP_DIR}/public"
if [ "${SRC_DIR}" != "${APP_DIR}" ]; then
  cp -rf "${SRC_DIR}/server.js" "${SRC_DIR}/package.json" "${APP_DIR}/"
  cp -rf "${SRC_DIR}/public/"* "${APP_DIR}/public/"
fi
chmod +x "${APP_DIR}/server.js"

NODE_BIN="$(command -v node)"
echo "==> [3/5] 配置 systemd 常驻服务 (${SERVICE_NAME})..."
cat > "/etc/systemd/system/${SERVICE_NAME}" <<SERVICE_EOF
[Unit]
Description=Loamly Watch P2P Sync & WebSocket Signaling Service (watch.loamly.cn)
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3080
ExecStart=${NODE_BIN} ${APP_DIR}/server.js
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "==> [4/5] 配置 Nginx 反向代理 (${NGINX_CONF})..."
cat > "${NGINX_CONF}" <<'NGINX_EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name watch.loamly.cn;

    client_max_body_size 20M;

    # WebSocket 房间信令反向代理
    location /ws {
        proxy_pass http://127.0.0.1:3080/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # 前端静态页面与健康检查接口
    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX_EOF

nginx -t
systemctl reload nginx

echo "==> [5/5] 签发并启用 Let's Encrypt HTTPS 证书 (Certbot)..."
if certbot --nginx -d loamly.cn -d www.loamly.cn -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}" --redirect --expand; then
  echo "==> [OK] 已成功为 loamly.cn / www.loamly.cn / ${DOMAIN} 启用 HTTPS！"
elif certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}" --redirect; then
  echo "==> [OK] 已成功为 ${DOMAIN} 启用 HTTPS！"
else
  echo "==> [提示] Certbot 自动签发暂未完成，请确认阿里云云解析 DNS 已添加 A 记录 watch -> 39.103.98.109 且安全组已放行 443 端口后，再次执行："
  echo "    certbot --nginx -d watch.loamly.cn --non-interactive --agree-tos -m ${EMAIL} --redirect"
fi

echo "=============================================================================="
echo "部署完成！"
echo "- 本地健康检查: $(curl -s http://127.0.0.1:3080/api/health || true)"
echo "- 线上访问地址: https://${DOMAIN}"
echo "=============================================================================="
