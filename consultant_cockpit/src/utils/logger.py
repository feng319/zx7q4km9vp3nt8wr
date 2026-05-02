# src/utils/logger.py
"""统一日志配置

提供项目级别的日志配置，替代 print() 语句。
"""
import logging
import sys
from pathlib import Path
from datetime import datetime


def setup_logger(name: str = "consultant_cockpit", level: int = logging.INFO) -> logging.Logger:
    """创建或获取日志记录器

    Args:
        name: 日志记录器名称
        level: 日志级别

    Returns:
        配置好的日志记录器
    """
    logger = logging.getLogger(name)

    # 避免重复添加 handler
    if logger.handlers:
        return logger

    logger.setLevel(level)

    # 控制台输出
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_format = logging.Formatter(
        '%(asctime)s | %(levelname)-8s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(console_format)
    logger.addHandler(console_handler)

    # 文件输出
    log_dir = Path("logs")
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"app_{datetime.now().strftime('%Y%m%d')}.log"

    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(level)
    file_format = logging.Formatter(
        '%(asctime)s | %(levelname)-8s | %(name)s | %(filename)s:%(lineno)d | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler.setFormatter(file_format)
    logger.addHandler(file_handler)

    return logger


# 全局日志记录器
logger = setup_logger()


def get_logger(module_name: str = None) -> logging.Logger:
    """获取日志记录器

    Args:
        module_name: 模块名称（可选）

    Returns:
        日志记录器
    """
    if module_name:
        return logging.getLogger(f"consultant_cockpit.{module_name}")
    return logger
