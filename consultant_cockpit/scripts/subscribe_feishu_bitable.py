#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""飞书多维表格订阅脚本

根据设计文档 11.2.1 节前置条件：
- 开发者后台配置：事件与回调 → 订阅方式 → 使用长连接接收事件
- 添加事件：drive.file.bitable_record_changed_v1、drive.file.edit_v1
- 权限要求：bitable:app 或 drive:drive
- 调用订阅API：POST drive/v1/files/:file_token/subscribe?file_type=bitable

使用方法：
    python scripts/subscribe_feishu_bitable.py --app-token <token> --file-token <token>

注意：
    - 此脚本需要在启动 WebSocket 事件网关之前运行
    - 订阅成功后，飞书会向配置的长连接地址推送事件
    - 如果使用轮询降级方案，可以跳过此脚本
"""
import argparse
import subprocess
import json
import os
import sys
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv

load_dotenv()


def run_lark_cli(args: list) -> dict:
    """执行 lark-cli 命令"""
    cmd = ["lark-cli"] + args + ["--format", "json"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, encoding='utf-8')

    if result.returncode != 0:
        print(f"❌ lark-cli 执行失败: {result.stderr}")
        return {"success": False, "error": result.stderr}

    try:
        return {"success": True, "data": json.loads(result.stdout) if result.stdout else {}}
    except json.JSONDecodeError:
        return {"success": True, "data": {"raw": result.stdout}}


def subscribe_bitable(app_token: str, file_token: str) -> dict:
    """订阅多维表格变更事件

    Args:
        app_token: 多维表格的 app_token
        file_token: 要订阅的文件 token

    Returns:
        dict: 订阅结果
    """
    print(f"📡 正在订阅多维表格: {file_token}")

    # 使用 lark-cli 的 drive 命令订阅
    # 注意：lark-cli 可能没有直接的订阅命令，这里使用 HTTP API 方式
    # 实际实现需要根据 lark-cli 的最新功能调整

    # 方案1：如果 lark-cli 支持 drive subscribe
    result = run_lark_cli([
        "drive", "+subscribe",
        "--file-token", file_token,
        "--file-type", "bitable",
        "--app-token", app_token
    ])

    if result["success"]:
        print(f"✅ 订阅成功！事件将推送到配置的长连接地址")
        return result
    else:
        print(f"⚠️ lark-cli 可能不支持直接订阅，请使用以下替代方案：")
        print(f"   1. 在飞书开发者后台手动配置事件订阅")
        print(f"   2. 使用轮询降级方案（feishu_sync.py 已实现）")
        return result


def check_subscription_status(app_token: str, file_token: str) -> dict:
    """检查订阅状态"""
    print(f"🔍 检查订阅状态: {file_token}")

    result = run_lark_cli([
        "drive", "+subscription-list",
        "--app-token", app_token
    ])

    if result["success"]:
        subscriptions = result["data"].get("subscriptions", [])
        for sub in subscriptions:
            if sub.get("file_token") == file_token:
                print(f"✅ 已订阅，状态: {sub.get('status', 'unknown')}")
                return {"subscribed": True, "info": sub}

        print(f"❌ 未订阅此文件")
        return {"subscribed": False}

    return result


def main():
    parser = argparse.ArgumentParser(description="飞书多维表格订阅脚本")
    parser.add_argument("--app-token", default=os.getenv("FEISHU_BITABLE_APP_TOKEN"),
                        help="多维表格 app_token（默认从环境变量读取）")
    parser.add_argument("--file-token", default=os.getenv("FEISHU_BITABLE_TABLE_ID"),
                        help="要订阅的文件 token（默认从环境变量读取）")
    parser.add_argument("--check", action="store_true", help="仅检查订阅状态")

    args = parser.parse_args()

    if not args.app_token:
        print("❌ 缺少 app_token，请设置 FEISHU_BITABLE_APP_TOKEN 环境变量或使用 --app-token 参数")
        sys.exit(1)

    if not args.file_token:
        print("❌ 缺少 file_token，请设置 FEISHU_BITABLE_TABLE_ID 环境变量或使用 --file-token 参数")
        sys.exit(1)

    print("=" * 50)
    print("飞书多维表格订阅脚本")
    print("=" * 50)
    print(f"App Token: {args.app_token}")
    print(f"File Token: {args.file_token}")
    print("=" * 50)

    if args.check:
        check_subscription_status(args.app_token, args.file_token)
    else:
        subscribe_bitable(args.app_token, args.file_token)

    print("\n💡 提示：")
    print("   - 如果订阅失败，可以使用轮询降级方案（feishu_sync.py）")
    print("   - 轮询间隔默认 30 秒，可在 UI 中调整")
    print("   - WebSocket 主方案需要 Node.js 事件网关支持")


if __name__ == "__main__":
    main()