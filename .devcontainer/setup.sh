#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
echo "==> 安装依赖"
npm ci || npm install
echo "==> 完成"
