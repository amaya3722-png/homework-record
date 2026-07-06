#!/bin/bash
# push_homework.sh — Hermes 旺财调用的作业录入脚本
# 用法: bash push_homework.sh "语文：背诵静夜思 数学：课本P32第3-5题"
#       bash push_homework.sh --date 2026-07-08 "明天的作业：..."

set -e

REPO_DIR="$HOME/homework-record"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 如果脚本在仓库内就用仓库目录，否则用 $HOME/homework-record
if [ -f "$SCRIPT_DIR/../data.json" ]; then
    REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

cd "$REPO_DIR"

# 拉取最新
echo "[GIT] Pulling latest..."
git pull origin main

# 解析参数并传递给 Python
echo "[AI] Parsing homework..."
python3 scripts/update_homework.py "$@"

# 提交并推送
echo "[GIT] Committing and pushing..."
git add data.json
if git diff --cached --quiet; then
    echo "[GIT] No changes, skipping push"
else
    git commit -m "Update homework via Hermes"
    git push origin main
    echo "[SUCCESS] Homework updated! URL: https://amaya3722-png.github.io/homework-record/"
fi
