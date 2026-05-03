// @ts-check
// src/utils/logger.js - 日志管理模块

const pino = require('pino');
const path = require('path');
const fs = require('fs');

/**
 * 日志级别类型
 * @typedef {'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'} LogLevel
 */

/**
 * 环境类型
 * @typedef {'development' | 'production' | 'test'} Environment
 */

/**
 * 获取当前环境
 * @returns {Environment}
 */
function getEnvironment() {
  return process.env.NODE_ENV || 'development';
}

/**
 * 获取日志级别
 * @returns {LogLevel}
 */
function getLogLevel() {
  const level = process.env.LOG_LEVEL || 'info';
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  return validLevels.includes(level) ? level : 'info';
}

/**
 * 确保日志目录存在
 * @param {string} logDir - 日志目录路径
 */
function ensureLogDirectory(logDir) {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * 创建日志传输配置
 * @returns {pino.TransportMultiOptions | pino.TransportSingleOptions | undefined}
 */
function createTransportConfig() {
  const env = getEnvironment();

  if (env === 'production') {
    // 生产环境：输出到文件
    const logDir = path.join(process.cwd(), 'logs');
    ensureLogDirectory(logDir);

    return {
      target: 'pino/file',
      options: {
        destination: path.join(logDir, 'app.jsonl'),
      },
    };
  }

  // 开发环境：输出到控制台，带美化格式
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
}

/**
 * 创建根日志器
 * @type {pino.Logger}
 */
let rootLogger = null;

/**
 * 初始化根日志器
 * @returns {pino.Logger}
 */
function initializeRootLogger() {
  if (rootLogger) {
    return rootLogger;
  }

  const transport = createTransportConfig();

  rootLogger = pino({
    level: getLogLevel(),
    name: 'consultant-cockpit',
    timestamp: pino.stdTimeFunctions.isoTime,
  }, transport ? pino.transport(transport) : undefined);

  return rootLogger;
}

/**
 * 获取子日志器
 *
 * 返回一个带有指定名称的子日志器，用于模块级别的日志记录。
 * 子日志器继承根日志器的配置，并自动添加模块名称标识。
 *
 * @param {string} name - 模块/组件名称，用于标识日志来源
 * @returns {pino.Logger} 子日志器实例
 *
 * @example
 * // 在模块中获取日志器
 * const logger = getLogger('knowledge-extractor');
 * logger.info('开始处理文档');
 * logger.error({ err: error }, '处理失败');
 *
 * @example
 * // 带结构化数据的日志
 * const logger = getLogger('llm-client');
 * logger.debug({ prompt: '...', tokens: 150 }, 'LLM 请求完成');
 */
function getLogger(name) {
  const root = initializeRootLogger();
  return root.child({ module: name });
}

/**
 * 关闭日志器（用于优雅关闭）
 *
 * 刷新所有待写入的日志并关闭日志器。
 * 通常在应用退出时调用。
 *
 * @returns {Promise<void>}
 */
async function closeLogger() {
  if (rootLogger) {
    return new Promise((resolve, reject) => {
      rootLogger.flush(() => {
        rootLogger = null;
        resolve();
      });
    });
  }
}

module.exports = {
  getLogger,
  closeLogger,
};
