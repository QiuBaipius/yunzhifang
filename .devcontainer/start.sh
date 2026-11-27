#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
if ! curl -sf http://127.0.0.1:5174/ >/dev/null 2>&1; then
  nohup npm run dev -- --host 0.0.0.0 > /tmp/yunzhifang.log 2>&1 &
fi
echo "云智仿已启动： http://localhost:5174"
echo "日志：/tmp/yunzhifang.log"
