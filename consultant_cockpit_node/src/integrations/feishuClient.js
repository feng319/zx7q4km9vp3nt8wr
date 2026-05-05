// @ts-check
// src/integrations/feishuClient.js — 飞书 API 客户端封装
/**
 * @module feishuClient
 * 飞书开放平台 API 封装，使用 @larksuiteoapi/node-sdk
 *
 * 核心功能：
 * - 多维表格（Bitable）操作：共识链记录、客户档案
 * - 云文档操作：作战卡、备忘录
 * - 即时通讯：消息推送
 */

const lark = require('@larksuiteoapi/node-sdk');
const { getLogger } = require('../utils/logger');
const { getConfig } = require('../utils/config');
const {
  typeToFeishu,
  typeToCode,
  statusToFeishu,
  statusToCode,
  isValidType,
  toCustomerView,
  toCustomerViewBatch,
} = require('../config/fields');

// 模块级日志器
const logger = getLogger('feishuClient');

/**
 * 429 限流重试配置
 */
const RATE_LIMIT_CONFIG = {
  maxRetries: 3,           // 最大重试次数
  baseDelayMs: 1000,       // 基础延迟（毫秒）
  maxDelayMs: 10000,       // 最大延迟（毫秒）
};

/**
 * 解析 429 响应头中的重置时间
 * @param {Object} headers - 响应头
 * @returns {number|null} 重置时间（毫秒时间戳），无法解析时返回 null
 */
function parseRateLimitReset(headers) {
  if (!headers) return null;
  // x-ogw-ratelimit-reset 返回秒级时间戳
  const resetHeader = headers['x-ogw-ratelimit-reset'] || headers['X-Ogw-Ratelimit-Reset'];
  if (resetHeader) {
    const resetTime = parseInt(resetHeader, 10);
    if (!isNaN(resetTime)) {
      return resetTime * 1000; // 转换为毫秒
    }
  }
  return null;
}

/**
 * 计算 429 重试延迟
 * @param {number} attempt - 当前重试次数（从 0 开始）
 * @param {number|null} resetTime - 服务器返回的重置时间
 * @returns {number} 延迟毫秒数
 */
function calculateRetryDelay(attempt, resetTime) {
  if (resetTime && resetTime > Date.now()) {
    // 使用服务器返回的重置时间
    return Math.min(resetTime - Date.now(), RATE_LIMIT_CONFIG.maxDelayMs);
  }
  // 指数退避：1s, 2s, 4s
  const delay = RATE_LIMIT_CONFIG.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, RATE_LIMIT_CONFIG.maxDelayMs);
}

/**
 * 判断是否为 429 限流错误
 * @param {Error} error - 错误对象
 * @returns {boolean}
 */
function isRateLimitError(error) {
  // 检查 HTTP 状态码
  const err = /** @type {any} */ (error);
  if (err.status === 429 || err.statusCode === 429) {
    return true;
  }
  // 检查飞书 API 返回码
  if (err.code === 429) {
    return true;
  }
  // 检查响应体中的错误码
  const bodyCode = err.response?.data?.code || err.response?.body?.code;
  if (bodyCode === 429) {
    return true;
  }
  return false;
}

/**
 * 飞书客户端类
 */
class FeishuClient {
  /**
   * @param {Object} options - 配置选项
   * @param {string} [options.appId] - 飞书应用 ID
   * @param {string} [options.appSecret] - 飞书应用 Secret
   * @param {string} [options.bitableToken] - 多维表格 Token
   * @param {string} [options.consensusTableId] - 共识链记录表 ID
   * @param {string} [options.profileTableId] - 客户档案表 ID
   */
  constructor(options = {}) {
    const config = getConfig();

    this.appId = options.appId || config.feishu.appId;
    this.appSecret = options.appSecret || config.feishu.appSecret;
    this.bitableToken = options.bitableToken || config.feishu.bitableToken;
    this.consensusTableId = options.consensusTableId || config.feishu.consensusTableId;
    this.profileTableId = options.profileTableId || config.feishu.profileTableId;

    // 初始化 lark 客户端
    // 使用 Domain.Feishu（中国版飞书），而非 Domain.Lark（国际版）
    this.client = new lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });

    // 本地缓存（用于降级）
    /** @type {Map<string, Object>} */
    this._recordCache = new Map();
    /** @type {Map<string, Object>} */
    this._profileCache = new Map();

    logger.info('FeishuClient initialized', {
      bitableToken: this.bitableToken ? 'configured' : 'missing',
      consensusTableId: this.consensusTableId ? 'configured' : 'missing',
    });
  }

  /**
   * 带限流重试的 API 调用包装器
   * @param {Function} apiCall - 要执行的 API 调用函数
   * @param {string} operationName - 操作名称（用于日志）
   * @returns {Promise<any>} API 响应
   * @private
   */
  async _withRateLimitRetry(apiCall, operationName) {
    let lastError = /** @type {Error|null} */ (null);

    for (let attempt = 0; attempt < RATE_LIMIT_CONFIG.maxRetries; attempt++) {
      try {
        return await apiCall();
      } catch (error) {
        lastError = /** @type {Error} */ (error);

        if (isRateLimitError(lastError)) {
          const err = /** @type {any} */ (lastError);
          const headers = err.response?.headers || err.headers;
          const resetTime = parseRateLimitReset(headers);
          const delay = calculateRetryDelay(attempt, resetTime);

          logger.warn('Rate limited, retrying', {
            operation: operationName,
            attempt: attempt + 1,
            delayMs: delay,
            resetTime: resetTime ? new Date(resetTime).toISOString() : null,
          });

          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // 非 429 错误直接抛出
        throw lastError;
      }
    }

    // 重试耗尽，抛出最后一个错误
    logger.error('Rate limit retries exhausted', {
      operation: operationName,
      maxRetries: RATE_LIMIT_CONFIG.maxRetries,
    });
    throw lastError;
  }

  // ==================== 共识链记录操作 ====================

  /**
   * 创建共识链记录
   * @param {Object} record - 记录数据
   * @returns {Promise<{success: boolean, record_id?: string, error?: string}>}
   */
  async createConsensusRecord(record) {
    try {
      const response = await this._withRateLimitRetry(
        () => this.client.bitable.appTableRecord.create({
          path: {
            app_token: this.bitableToken,
            table_id: this.consensusTableId,
          },
          params: {
            user_id_type: 'open_id',
          },
          data: {
            fields: this._recordToFields(record),
          },
        }),
        'createConsensusRecord'
      );

      if (response.code !== 0) {
        throw new Error(`Lark API error: ${response.msg}`);
      }

      const recordId = response.data?.record?.record_id;
      logger.info('Created consensus record', { recordId, type: record.type });

      // 更新缓存
      this._recordCache.set(recordId, record);

      return { success: true, record_id: recordId };
    } catch (error) {
      // 增强错误日志，输出完整错误详情（pino API: 第一个参数是 object，第二个是 message）
      logger.error({
        message: error.message,
        code: error.code,
        status: error.response?.status,
        body: error.response?.data ?? error.response?.body,
        record: JSON.stringify(record).slice(0, 200),
        bitableToken: this.bitableToken ? 'configured' : 'missing',
        consensusTableId: this.consensusTableId ? 'configured' : 'missing',
      }, 'Failed to create consensus record');
      return { success: false, error: error.message };
    }
  }

  /**
   * 更新共识链记录
   * @param {string} recordId - 记录 ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async updateConsensusRecord(recordId, updates) {
    try {
      const response = await this._withRateLimitRetry(
        () => this.client.bitable.appTableRecord.update({
          path: {
            app_token: this.bitableToken,
            table_id: this.consensusTableId,
            record_id: recordId,
          },
          params: {
            user_id_type: 'open_id',
          },
          data: {
            fields: this._recordToFields(updates),
          },
        }),
        'updateConsensusRecord'
      );

      if (response.code !== 0) {
        throw new Error(`Lark API error: ${response.msg}`);
      }

      logger.info('Updated consensus record', { recordId });

      // 更新缓存
      const cached = this._recordCache.get(recordId) || {};
      this._recordCache.set(recordId, { ...cached, ...updates });

      return { success: true };
    } catch (error) {
      logger.error('Failed to update consensus record', { recordId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取共识链记录
   * @param {string} recordId - 记录 ID
   * @returns {Promise<Object|null>}
   */
  async getConsensusRecord(recordId) {
    try {
      const response = await this.client.bitable.appTableRecord.get({
        path: {
          app_token: this.bitableToken,
          table_id: this.consensusTableId,
          record_id: recordId,
        },
        params: {
          user_id_type: 'open_id',
        },
      });

      if (response.code !== 0) {
        if (response.code === 1250004) { // 记录不存在
          return null;
        }
        throw new Error(`Lark API error: ${response.msg}`);
      }

      return this._fieldsToRecord(response.data?.record?.fields || {});
    } catch (error) {
      logger.error('Failed to get consensus record', { recordId, error: error.message });
      // 尝试从缓存获取
      return this._recordCache.get(recordId) || null;
    }
  }

  /**
   * 获取客户档案记录（根据 record_id）
   * @param {string} recordId - 记录 ID
   * @returns {Promise<Object|null>}
   */
  async getProfileRecord(recordId) {
    try {
      const response = await this.client.bitable.appTableRecord.get({
        path: {
          app_token: this.bitableToken,
          table_id: this.profileTableId,
          record_id: recordId,
        },
        params: {
          user_id_type: 'open_id',
        },
      });

      if (response.code !== 0) {
        if (response.code === 1250004) { // 记录不存在
          return null;
        }
        throw new Error(`Lark API error: ${response.msg}`);
      }

      const fields = response.data?.record?.fields || {};
      return {
        record_id: recordId,
        ...this._fieldsToProfile(fields),
      };
    } catch (error) {
      logger.error('Failed to get profile record', { recordId, error: error.message });
      return null;
    }
  }

  /**
   * 列出所有共识链记录
   * @param {Object} options - 查询选项
   * @param {string} [options.company] - 按公司筛选
   * @param {string} [options.stage] - 按阶段筛选
   * @param {number} [options.pageSize] - 每页数量
   * @returns {Promise<Object[]>}
   */
  async listConsensusRecords(options = {}) {
    try {
      /** @type {Object[]} */
      const allRecords = [];

      // 使用 list 方法获取记录
      const response = await this.client.bitable.appTableRecord.list({
        path: {
          app_token: this.bitableToken,
          table_id: this.consensusTableId,
        },
        params: {
          user_id_type: 'open_id',
          page_size: options.pageSize || 100,
        },
      });

      if (response.code !== 0) {
        throw new Error('Lark API error: ' + response.code + ' - ' + response.msg);
      }

      const records = response.data?.items || [];
      for (const record of records) {
        if (record && record.record_id) {
          allRecords.push({
            record_id: record.record_id,
            ...this._fieldsToRecord(record.fields),
          });
        }
      }

      logger.info('Listed consensus records', { count: allRecords.length });

      // 更新缓存
      for (const record of allRecords) {
        if (record.record_id) {
          this._recordCache.set(record.record_id, record);
        }
      }

      return allRecords;
    } catch (error) {
      logger.error('Failed to list consensus records', {
        error: error.message,
        stack: error.stack,
        bitableToken: this.bitableToken,
        consensusTableId: this.consensusTableId,
      });
      // 返回缓存数据
      return Array.from(this._recordCache.values());
    }
  }

  /**
   * 列出共识链记录（客户视图格式）
   * PRD 4.4 节：只返回 3 列（发现内容、确认时间、建议方向）
   * 用于投屏、客户可见场景
   * @param {Object} options - 查询选项（同 listConsensusRecords）
   * @returns {Promise<Object[]>} 客户视图记录数组（只有 3 列）
   */
  async listConsensusRecordsForCustomer(options = {}) {
    const internalRecords = await this.listConsensusRecords(options);
    return toCustomerViewBatch(internalRecords);
  }

  // ==================== 客户档案操作 ====================

  /**
   * 获取客户档案
   * @param {string} company - 公司名称
   * @returns {Promise<Object|null>}
   */
  async getClientProfile(company) {
    try {
      // 使用 search API 支持 filter 功能
      // 飞书 Node SDK 的 list 方法不支持 filter，需要使用 search
      const response = await this.client.bitable.appTableRecord.search({
        path: {
          app_token: this.bitableToken,
          table_id: this.profileTableId,
        },
        params: {
          user_id_type: 'open_id',
          page_size: 10,
        },
        data: {
          filter: {
            conjunction: 'and',
            conditions: [{
              field_name: '客户公司名',
              operator: 'is',
              value: [company],
            }],
          },
        },
      });

      if (response.code !== 0) {
        throw new Error(`Lark API error: ${response.msg}`);
      }

      const records = response.data?.items || [];
      if (records.length === 0) {
        return null;
      }

      // 找到匹配的记录（可能有多个，取第一个有客户公司名的）
      const matchedRecord = records.find(r => r.fields?.['客户公司名'] === company) || records[0];
      const profile = {
        record_id: matchedRecord.record_id,
        ...this._fieldsToProfile(matchedRecord.fields),
      };

      // 更新缓存
      this._profileCache.set(company, profile);

      return profile;
    } catch (error) {
      logger.error('Failed to get client profile', { company, error: error.message });
      // 尝试从缓存获取
      return this._profileCache.get(company) || null;
    }
  }

  /**
   * 更新客户档案
   * @param {string} company - 公司名称
   * @param {Object} updates - 更新数据
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async updateClientProfile(company, updates) {
    try {
      // 先查找记录
      const existing = await this.getClientProfile(company);

      if (existing && existing.record_id) {
        // 更新现有记录
        const response = await this._withRateLimitRetry(
          () => this.client.bitable.appTableRecord.update({
            path: {
              app_token: this.bitableToken,
              table_id: this.profileTableId,
              record_id: existing.record_id,
            },
            params: {
              user_id_type: 'open_id',
            },
            data: {
              fields: this._profileToFields(updates),
            },
          }),
          'updateClientProfile'
        );

        if (response.code !== 0) {
          throw new Error(`Lark API error: ${response.msg}`);
        }

        logger.info('Updated client profile', { company });
      } else {
        // 创建新记录
        const response = await this._withRateLimitRetry(
          () => this.client.bitable.appTableRecord.create({
            path: {
              app_token: this.bitableToken,
              table_id: this.profileTableId,
            },
            params: {
              user_id_type: 'open_id',
            },
            data: {
              fields: this._profileToFields({ 客户公司名: company, ...updates }),
            },
          }),
          'createClientProfile'
        );

        if (response.code !== 0) {
          throw new Error(`Lark API error: ${response.msg}`);
        }

        logger.info('Created client profile', { company });
      }

      // 更新缓存
      const cached = this._profileCache.get(company) || {};
      this._profileCache.set(company, { ...cached, ...updates });

      return { success: true };
    } catch (error) {
      logger.error('Failed to update client profile', { company, error: error.message });
      return { success: false, error: error.message };
    }
  }

  // ==================== 云文档操作 ====================

  /**
   * 创建云文档
   * @param {string} title - 文档标题
   * @param {string} content - 文档内容（Markdown 格式）
   * @returns {Promise<{success: boolean, doc_id?: string, url?: string, error?: string}>}
   */
  async createDocument(title, content) {
    try {
      // 创建文档
      const createResponse = await this.client.docx.document.create({
        data: {
          title: title,
        },
      });

      if (createResponse.code !== 0) {
        throw new Error(`Lark API error: ${createResponse.msg}`);
      }

      const docId = createResponse.data?.document?.document_id;

      // 写入内容
      await this.client.docx.documentBlockChildren.create({
        path: {
          document_id: docId,
          block_id: docId, // 根节点
        },
        data: {
          children: [{
            block_type: 2, // Text block
            text: {
              elements: [{
                text_run: {
                  content: content,
                },
              }],
            },
          }],
        },
      });

      const url = `https://feishu.cn/docx/${docId}`;

      logger.info('Created document', { docId, title });

      return { success: true, doc_id: docId, url };
    } catch (error) {
      logger.error('Failed to create document', { title, error: error.message });
      return { success: false, error: error.message };
    }
  }

  // ==================== 消息推送 ====================

  /**
   * 发送消息给用户
   * @param {string} openId - 用户 Open ID
   * @param {string} message - 消息内容
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async sendMessage(openId, message) {
    try {
      const response = await this.client.im.message.create({
        params: {
          receive_id_type: 'open_id',
        },
        data: {
          receive_id: openId,
          msg_type: 'text',
          content: JSON.stringify({ text: message }),
        },
      });

      if (response.code !== 0) {
        throw new Error(`Lark API error: ${response.msg}`);
      }

      logger.info('Sent message', { openId });
      return { success: true };
    } catch (error) {
      logger.error('Failed to send message', { openId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  // ==================== 字段映射 ====================

  /**
   * 将记录对象转换为多维表格字段
   * @private
   * @param {Object} record - 记录对象
   * @returns {Object}
   */
  _recordToFields(record) {
    const fields = {};

    // 使用统一字段映射模块（仅支持 PRD 定义的 fact/consensus）
    if (record.id) fields['记录ID'] = record.id;
    if (record.timestamp) fields['时间戳'] = record.timestamp;
    if (record.type) fields['类型'] = typeToFeishu(record.type);
    if (record.stage) fields['阶段'] = record.stage;
    if (record.content) fields['内容'] = record.content;
    if (record.source) fields['来源'] = record.source;
    if (record.evidence_sku) fields['关联SKU'] = record.evidence_sku.join('\n');
    if (record.status) fields['状态'] = statusToFeishu(record.status);
    if (record.confidence) fields['置信度'] = record.confidence;
    if (record.replaces) fields['替代记录'] = record.replaces;
    if (record.superseded_by) fields['被替代'] = record.superseded_by;
    // 仅 consensus 类型才写入建议方向
    if (record.recommendation && record.type === 'consensus') {
      fields['建议方向'] = record.recommendation;
    }

    return fields;
  }

  /**
   * 将多维表格字段转换为记录对象
   * @private
   * @param {Object} fields - 字段对象
   * @returns {Object}
   */
  _fieldsToRecord(fields) {
    const record = {};

    // 使用统一字段映射模块
    if (fields['记录ID']) record.id = fields['记录ID'];
    if (fields['时间戳']) record.timestamp = fields['时间戳'];
    if (fields['类型']) record.type = typeToCode(fields['类型']);
    if (fields['阶段']) record.stage = fields['阶段'];
    if (fields['内容']) record.content = fields['内容'];
    if (fields['来源']) record.source = fields['来源'];
    if (fields['关联SKU']) record.evidence_sku = fields['关联SKU'].split('\n').filter(Boolean);
    if (fields['状态']) record.status = statusToCode(fields['状态']);
    if (fields['置信度']) record.confidence = fields['置信度'];
    if (fields['替代记录']) record.replaces = fields['替代记录'];
    if (fields['被替代']) record.superseded_by = fields['被替代'];
    if (fields['建议方向']) record.recommendation = fields['建议方向'];

    return record;
  }

  /**
   * 将档案对象转换为多维表格字段
   * @private
   * @param {Object} profile - 档案对象
   * @returns {Object}
   */
  _profileToFields(profile) {
    const fields = {};

    if (profile['客户公司名']) fields['客户公司名'] = profile['客户公司名'];
    if (profile['产品线']) fields['产品线'] = profile['产品线'];
    if (profile['客户群体']) fields['客户群体'] = profile['客户群体'];
    if (profile['收入结构']) fields['收入结构'] = profile['收入结构'];
    if (profile['毛利结构']) fields['毛利结构'] = profile['毛利结构'];
    if (profile['交付情况']) fields['交付情况'] = profile['交付情况'];
    if (profile['资源分布']) fields['资源分布'] = profile['资源分布'];
    if (profile['战略目标']) fields['战略目标'] = profile['战略目标'];
    if (profile['显性诉求']) fields['显性诉求'] = profile['显性诉求'];
    if (profile['隐性痛点']) fields['隐性痛点'] = profile['隐性痛点'];
    if (profile['当前追问']) fields['当前追问'] = profile['当前追问'];
    if (profile['诊断进度']) fields['诊断进度'] = profile['诊断进度'];
    // 注意：完整度字段已移除，PRD 未定义此字段，避免内部状态泄漏给客户

    return fields;
  }

  /**
   * 将多维表格字段转换为档案对象
   * @private
   * @param {Object} fields - 字段对象
   * @returns {Object}
   */
  _fieldsToProfile(fields) {
    const profile = {};

    const fieldNames = [
      '客户公司名', '产品线', '客户群体', '收入结构', '毛利结构',
      '交付情况', '资源分布', '战略目标', '显性诉求', '隐性痛点', '当前追问', '诊断进度'
    ];

    for (const name of fieldNames) {
      if (fields[name]) {
        // 处理飞书返回的富文本格式 [{ text: '...', type: 'text' }]
        const value = fields[name];
        if (Array.isArray(value) && value[0]?.text) {
          profile[name] = value[0].text;
        } else {
          profile[name] = value;
        }
      }
    }

    // 注意：完整度字段已移除，PRD 未定义此字段，避免内部状态泄漏给客户

    return profile;
  }

  // ==================== 缓存管理 ====================

  /**
   * 清除所有缓存
   */
  clearCache() {
    this._recordCache.clear();
    this._profileCache.clear();
    logger.info('Cleared all caches');
  }

  /**
   * 获取缓存状态
   * @returns {{recordCount: number, profileCount: number}}
   */
  getCacheStatus() {
    return {
      recordCount: this._recordCache.size,
      profileCount: this._profileCache.size,
    };
  }
}

/**
 * Mock 客户端（用于测试）
 */
class FeishuClientMock {
  constructor() {
    /** @type {Map<string, Object>} */
    this._records = new Map();
    /** @type {Map<string, Object>} */
    this._profiles = new Map();
  }

  async createConsensusRecord(record) {
    const recordId = `mock_record_${Date.now()}`;
    this._records.set(recordId, { ...record, record_id: recordId });
    return { success: true, record_id: recordId };
  }

  async updateConsensusRecord(recordId, updates) {
    const existing = this._records.get(recordId);
    if (existing) {
      this._records.set(recordId, { ...existing, ...updates });
    }
    return { success: true };
  }

  async getConsensusRecord(recordId) {
    return this._records.get(recordId) || null;
  }

  async listConsensusRecords(options = {}) {
    let records = Array.from(this._records.values());
    if (options.company) {
      records = records.filter(r => r.company === options.company);
    }
    return records;
  }

  async getClientProfile(company) {
    return this._profiles.get(company) || null;
  }

  async updateClientProfile(company, updates) {
    const existing = this._profiles.get(company) || {};
    this._profiles.set(company, { ...existing, ...updates });
    return { success: true };
  }

  async createDocument(title, content) {
    return { success: true, doc_id: `mock_doc_${Date.now()}`, url: 'https://mock.feishu.cn/doc' };
  }

  async sendMessage(openId, message) {
    return { success: true };
  }

  clearCache() {
    this._records.clear();
    this._profiles.clear();
  }

  getCacheStatus() {
    return {
      recordCount: this._records.size,
      profileCount: this._profiles.size,
    };
  }
}

module.exports = {
  FeishuClient,
  FeishuClientMock,
};
