// @ts-check
// src/utils/config.js - 配置管理模块

require('dotenv').config();

/**
 * 配置管理对象
 *
 * 从环境变量加载所有配置项，提供默认值。
 * 环境变量优先级高于默认值。
 *
 * @namespace Config
 */
const Config = {
  // ====================
  // LLM 配置
  // ====================

  /**
   * OpenAI API Key
   * @type {string}
   */
  LLM_API_KEY: process.env.OPENAI_API_KEY || '',

  /**
   * LLM API 基础 URL
   * @type {string}
   */
  LLM_BASE_URL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',

  /**
   * LLM 模型名称
   * @type {string}
   */
  LLM_MODEL: process.env.LLM_MODEL || 'gpt-4o-mini',

  /**
   * LLM 调用超时时间（秒）
   * @type {number}
   */
  LLM_TIMEOUT_SECONDS: 30,

  // ====================
  // 候选生成配置
  // ====================

  /**
   * 最大重生成次数
   * @type {number}
   */
  CANDIDATE_MAX_REGENERATE: 2,

  /**
   * 最少事实数
   * @type {number}
   */
  CANDIDATE_MIN_FACTS: 3,

  /**
   * 差异度阈值（相似度阈值）
   * @type {number}
   */
  CANDIDATE_SIMILARITY_THRESHOLD: 0.85,

  // ====================
  // 飞书配置
  // ====================

  /**
   * 飞书应用 ID
   * @type {string}
   */
  FEISHU_APP_ID: process.env.FEISHU_APP_ID || '',

  /**
   * 飞书应用密钥
   * @type {string}
   */
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET || '',

  /**
   * 飞书多维表格 App Token
   * @type {string}
   */
  FEISHU_BITABLE_APP_TOKEN: process.env.FEISHU_BITABLE_APP_TOKEN || '',

  /**
   * 飞书多维表格主表 ID
   * @type {string}
   */
  FEISHU_BITABLE_TABLE_ID: process.env.FEISHU_BITABLE_TABLE_ID || '',

  /**
   * 飞书多维表格共识表 ID
   * @type {string}
   */
  FEISHU_BITABLE_CONSENSUS_TABLE_ID: process.env.FEISHU_BITABLE_CONSENSUS_TABLE_ID || '',

  /**
   * 飞书文档模板 Token
   * @type {string}
   */
  FEISHU_DOC_TEMPLATE_TOKEN: process.env.FEISHU_DOC_TEMPLATE_TOKEN || '',

  // ====================
  // 服务配置
  // ====================

  /**
   * 服务端口
   * @type {number}
   */
  PORT: parseInt(process.env.PORT || '8501', 10),

  /**
   * 日志级别
   * @type {string}
   */
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // ====================
  // 知识库配置
  // ====================

  /**
   * 知识库路径
   * @type {string}
   */
  KNOWLEDGE_BASE_PATH: process.env.KNOWLEDGE_BASE_PATH || '../新能源/输出',

  /**
   * 关键词字典路径
   * @type {string}
   */
  KEYWORDS_DICT_PATH: process.env.KEYWORDS_DICT_PATH || 'config/keywords.json',

  // ====================
  // 服务包定价配置
  // ====================

  /**
   * 服务包定价配置
   * @type {Object.<string, {name: string, price: number}>}
   */
  SERVICE_PACKAGES: {
    deep_diagnosis: { name: '初步诊断深化', price: 599 },
    business_model: { name: '商业模式专项咨询', price: 1999 },
    strategy_workshop: { name: '战略主线确认工作坊', price: 19800 },
  },
};

/**
 * 验证必需的配置项
 *
 * 检查关键配置项是否已设置，返回缺失的配置项列表。
 *
 * @returns {string[]} 缺失的配置项名称数组
 *
 * @example
 * const missing = Config.validateRequired();
 * if (missing.length > 0) {
 *   console.error('Missing required config:', missing);
 * }
 */
Config.validateRequired = function() {
  const required = [
    'LLM_API_KEY',
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_BITABLE_APP_TOKEN',
    'FEISHU_BITABLE_TABLE_ID',
  ];

  return required.filter(key => !this[key]);
};

/**
 * 获取配置摘要（隐藏敏感信息）
 *
 * 返回配置的摘要信息，敏感字段会被掩码处理。
 *
 * @returns {Object} 配置摘要对象
 */
Config.getSummary = function() {
  return {
    LLM: {
      model: this.LLM_MODEL,
      baseURL: this.LLM_BASE_URL,
      timeout: this.LLM_TIMEOUT_SECONDS,
      apiKeyConfigured: !!this.LLM_API_KEY,
    },
    Feishu: {
      appId: this.FEISHU_APP_ID ? `${this.FEISHU_APP_ID.slice(0, 4)}***` : 'not set',
      appSecretConfigured: !!this.FEISHU_APP_SECRET,
      bitableConfigured: !!this.FEISHU_BITABLE_APP_TOKEN,
    },
    Server: {
      port: this.PORT,
      logLevel: this.LOG_LEVEL,
    },
    Candidate: {
      maxRegenerate: this.CANDIDATE_MAX_REGENERATE,
      minFacts: this.CANDIDATE_MIN_FACTS,
      similarityThreshold: this.CANDIDATE_SIMILARITY_THRESHOLD,
    },
  };
};

module.exports = Config;
