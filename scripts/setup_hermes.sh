#!/bin/bash
# setup_hermes.sh — Hermes 服务器初始化脚本
# 在 Hermes 服务器上运行一次即可

set -e

echo "=== Hermes Homework Bot 初始化 ==="
echo ""

# 1. 检查 git
if ! command -v git &> /dev/null; then
    echo "[1/4] 安装 git..."
    sudo apt-get update && sudo apt-get install -y git
else
    echo "[1/4] git 已安装: $(git --version)"
fi

# 2. 检查 python3
if ! command -v python3 &> /dev/null; then
    echo "[2/4] 安装 python3..."
    sudo apt-get install -y python3
else
    echo "[2/4] python3 已安装: $(python3 --version)"
fi

# 3. Clone 仓库
if [ -d "$HOME/homework-record" ]; then
    echo "[3/4] 仓库已存在，更新..."
    cd "$HOME/homework-record"
    git pull origin main
else
    echo "[3/4] 克隆仓库..."
    cd "$HOME"
    git clone https://github.com/amaya3722-png/homework-record.git
    cd homework-record
fi

# 4. 配置 git
echo "[4/4] 配置 git 用户..."
git config user.name "Hermes Wangcai"
git config user.email "wangcai@hermes.local"

echo ""
echo "=== 初始化完成 ==="
echo ""
echo "⚠️  还需要做一件事：设置 GitHub 推送权限"
echo ""
echo "方法：在服务器上运行："
echo "  cd $HOME/homework-record"
echo "  git remote set-url origin https://<GITHUB_TOKEN>@github.com/amaya3722-png/homework-record.git"
echo ""
echo "测试："
echo "  bash scripts/push_homework.sh \"语文：背诵课文 数学：P32第3题\""
