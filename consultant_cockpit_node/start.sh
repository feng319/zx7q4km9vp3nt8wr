#!/bin/bash

# 顾问现场作战系统启动脚本 (Linux/Mac)

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 打印带颜色的消息
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查 Node.js
check_node() {
    if ! command -v node &> /dev/null; then
        print_error "Node.js 未安装，请先安装 Node.js 18+"
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js 版本过低，需要 18+，当前版本: $(node -v)"
        exit 1
    fi
    print_info "Node.js 版本: $(node -v)"
}

# 检查依赖
check_dependencies() {
    if [ ! -d "node_modules" ]; then
        print_info "正在安装依赖..."
        npm install
        if [ $? -ne 0 ]; then
            print_error "依赖安装失败"
            exit 1
        fi
    fi
}

# 检查环境变量
check_env() {
    if [ ! -f ".env" ]; then
        print_warn ".env 文件不存在，正在从 .env.example 复制..."
        if [ -f ".env.example" ]; then
            cp .env.example .env
            print_warn "请编辑 .env 文件填写真实配置"
        else
            print_error ".env.example 文件不存在"
            exit 1
        fi
    fi
}

# 创建必要目录
create_dirs() {
    mkdir -p data/sessions
    mkdir -p logs
    print_info "已创建必要目录"
}

# 启动服务
start_server() {
    print_info "正在启动服务..."

    # 检查端口是否被占用
    PORT=${PORT:-8501}
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        print_warn "端口 $PORT 已被占用"
        print_info "正在尝试停止占用进程..."
        lsof -Pi :$PORT -sTCP:LISTEN -t | xargs kill -9 2>/dev/null
        sleep 1
    fi

    print_info "服务启动在 http://localhost:$PORT"
    print_info "按 Ctrl+C 停止服务"
    echo ""

    # 启动
    node server.js
}

# 主流程
main() {
    echo ""
    echo "======================================"
    echo "   顾问现场作战系统 · Node.js 版"
    echo "======================================"
    echo ""

    check_node
    check_dependencies
    check_env
    create_dirs
    start_server
}

# 捕获退出信号
trap 'print_info "服务已停止"; exit 0' INT TERM

# 执行主流程
main
