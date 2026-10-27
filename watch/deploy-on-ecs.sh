#!/usr/bin/env bash
# ==============================================================================
# Loamly 双人同屏室 · 异地连麦同步播放器 (watch.loamly.cn)
# 阿里云 Ubuntu ECS 一键部署与热更新脚本 (零外部 npm 依赖 · 秒级启动)
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
echo "==> [3/5] 配置并重启 systemd 常驻服务 (${SERVICE_NAME})..."
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

# 开启 Linux TCP BBR 拥塞控制，大幅提升中日跨境与弱网下的视频流吞吐率
if ! sysctl net.ipv4.tcp_congestion_control 2>/dev/null | grep -q bbr; then
  modprobe tcp_bbr 2>/dev/null || true
  sysctl -w net.core.default_qdisc=fq >/dev/null 2>&1 || true
  sysctl -w net.ipv4.tcp_congestion_control=bbr >/dev/null 2>&1 || true
fi

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "==> [4/5] 配置 Nginx 反向代理 (${NGINX_CONF})..."
if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ] && [ -f "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" ]; then
  cat > "${NGINX_CONF}" <<NGINX_SSL_EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    client_max_body_size 4096M;

    # WebSocket 房间信令反向代理
    location /ws {
        proxy_pass http://127.0.0.1:3080/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # 房间片源流式上传与 HTTP Range 边下边播接口
    location /api/room-film {
        proxy_pass http://127.0.0.1:3080/api/room-film;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # 前端静态页面与健康检查接口
    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX_SSL_EOF
  nginx -t
  systemctl reload nginx
  echo "==> [5/5] 已复用现有 Let's Encrypt HTTPS 证书 (/etc/letsencrypt/live/${DOMAIN}/)！"
else
  cat > "${NGINX_CONF}" <<'NGINX_HTTP_EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name watch.loamly.cn;

    client_max_body_size 4096M;

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

    location /api/room-film {
        proxy_pass http://127.0.0.1:3080/api/room-film;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX_HTTP_EOF
  nginx -t
  systemctl reload nginx
  echo "==> [5/5] 签发并启用 Let's Encrypt HTTPS 证书 (Certbot)..."
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}" --redirect || true
fi

echo "=============================================================================="
echo "部署完成！"
echo "- 本地健康检查: $(curl -s http://127.0.0.1:3080/api/health || true)"
echo "- 线上访问地址: https://${DOMAIN}"
echo "=============================================================================="
