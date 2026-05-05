// @ts-check
const { EventEmitter } = require('events');
const crypto = require('crypto');

/**
 * @typedef {import('../types').ConsensusRecord} ConsensusRecord
 * @typedef {import('../types').ConsensusType} ConsensusType
 * @typedef {import('../types').Stage} Stage
 * @typedef {import('../types').RecordSource} RecordSource
 * @typedef {import('../types').RecordStatus} RecordStatus
 * @typedef {import('../types').ConfidenceLevel} ConfidenceLevel
 */

/**
 * 共识链管理器
 * @extends EventEmitter
 *
 * 事件：
 * - 'change' - 记录变更时触发，payload: { type: 'add'|'confirm'|'correct', record }
 * - 'invalidate-cache' - 缓存需要失效时触发
 */
class ConsensusChain extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {Object} [options.feishuClient] - 飞书客户端（可选）
   */
  constructor(options = {}) {
    super();
    /** @type {ConsensusRecord[]} */
    this.records = [];
    /** @type {Object|null} */
    this.feishuClient = options.feishuClient || null;
  }

  /**
   * 添加记录
   * @param {Omit<ConsensusRecord, 'id'|'timestamp'>} record - 记录数据（不含 id 和 timestamp）
   * @param {Object} [options] - 可选参数
   * @param {boolean} [options.syncToFeishu=false] - 是否同步到飞书
   * @param {string} [options.company] - 客户公司名（用于同步到客户档案表）
   * @returns {ConsensusRecord} 添加后的记录（含 id 和 timestamp）
   * @fires ConsensusChain#change
   */
  addRecord(record, options = {}) {
    // 兼容旧的调用方式：addRecord(record, syncToFeishu)
    const syncToFeishu = typeof options === 'boolean' ? options : (options.syncToFeishu || false);
    const company = typeof options === 'boolean' ? undefined : options.company;

    const now = new Date().toISOString();

    // 使用 crypto.randomUUID() 生成唯一 ID（修复 Python 版本的数组长度 Bug）
    const id = `record_${crypto.randomUUID().split('-')[0]}`;

    /** @type {ConsensusRecord} */
    const newRecord = {
      id,
      timestamp: now,
      type: record.type,
      stage: record.stage,
      content: record.content,
      source: record.source,
      evidence_sku: record.evidence_sku || [],
      status: record.status || 'recorded',
      confidence: record.confidence || null,
      replaces: record.replaces || null,
      superseded_by: record.superseded_by || null,
      feishu_record_id: record.feishu_record_id || null,
      recommendation: record.recommendation || null,
      target_field: record.target_field || null
    };

    this.records.push(newRecord);

    // 可选同步到飞书（传递 company 用于同步到客户档案表）
    if (syncToFeishu && this.feishuClient) {
      this._syncToFeishu(newRecord, company).catch(err => {
        // 飞书同步失败不影响本地记录
        console.warn(`飞书同步失败: ${err.message}`);
      });
    }

    // 触发 change 事件
    this.emit('change', { type: 'add', record: newRecord });

    return newRecord;
  }

  /**
   * 获取记录
   * @param {string} recordId - 记录 ID
   * @returns {ConsensusRecord|null} 找到的记录，或 null
   */
  getRecord(recordId) {
    return this.records.find(r => r.id === recordId) || null;
  }

  /**
   * 设置记录为待确认状态（候选选中时调用）
   * @param {string} recordId - 记录 ID
   * @throws {Error} 记录不存在或状态不正确时抛出
   * @fires ConsensusChain#change
   */
  setCandidateRecordPending(recordId) {
    const record = this.getRecord(recordId);
    if (!record) {
      throw new Error(`找不到记录: ${recordId}`);
    }
    if (record.status !== 'recorded') {
      throw new Error(`记录状态不正确: ${record.status}，应为 recorded`);
    }

    record.status = 'pending_client_confirm';

    // 触发 change 事件
    this.emit('change', { type: 'pending', record });

    // 此时不同步飞书，等 confirmed 后再同步
  }

  /**
   * 确认记录（顾问点确认按钮时调用，两条路径共用）
   * @param {string} recordId - 记录 ID
   * @param {string} [company] - 客户公司名（用于同步到客户档案表）
   * @throws {Error} 记录不存在或状态不正确时抛出
   * @fires ConsensusChain#change
   */
  confirmRecord(recordId, company) {
    const record = this.getRecord(recordId);
    if (!record) {
      throw new Error(`找不到记录: ${recordId}`);
    }
    if (!['recorded', 'pending_client_confirm'].includes(record.status)) {
      throw new Error(`记录状态不正确: ${record.status}，应为 recorded 或 pending_client_confirm`);
    }

    record.status = 'confirmed';

    // 触发 change 事件
    this.emit('change', { type: 'confirm', record });

    // 同步到飞书
    if (this.feishuClient) {
      this._syncToFeishu(record, company).catch(err => {
        console.warn(`飞书同步失败: ${err.message}`);
      });
    }
  }

  /**
   * 修正记录（不覆盖原记录，新增修正记录）
   *
   * 设计文档要求：
   * - 原记录标记为 superseded
   * - 新记录 source=manual_correction，replaces 指向原记录
   *
   * @param {string} recordId - 要修正的记录 ID
   * @param {string} newContent - 修正后的内容
   * @param {Object} [options] - 可选参数
   * @param {RecordSource} [options.source='manual_correction'] - 修正来源
   * @param {string} [options.company] - 客户公司名（用于同步到客户档案表）
   * @returns {ConsensusRecord} 新创建的修正记录
   * @throws {Error} 记录不存在时抛出
   * @fires ConsensusChain#change
   * @fires ConsensusChain#invalidate-cache
   */
  correctRecord(recordId, newContent, options = {}) {
    // 兼容旧的调用方式：correctRecord(recordId, newContent, source)
    const source = typeof options === 'string' ? options : (options.source || 'manual_correction');
    const company = typeof options === 'string' ? undefined : options.company;

    const original = this.getRecord(recordId);
    if (!original) {
      throw new Error(`找不到记录: ${recordId}`);
    }

    // 使用 crypto.randomUUID() 生成修正记录 ID
    const correctionId = `${recordId}_corr_${crypto.randomUUID().split('-')[0]}`;
    const now = new Date().toISOString();

    /** @type {ConsensusRecord} */
    const newRecord = {
      id: correctionId,
      timestamp: now,
      type: original.type,
      stage: original.stage,
      content: newContent,
      source: source,
      evidence_sku: [...original.evidence_sku], // 复制原记录的 SKU
      status: 'confirmed', // 修正记录默认为已确认
      confidence: original.confidence,
      replaces: recordId, // 指向原记录
      superseded_by: null,
      feishu_record_id: null,
      recommendation: original.recommendation
    };

    // 标记原记录为已替代
    original.status = 'superseded';
    original.superseded_by = correctionId;

    // 添加新记录
    this.records.push(newRecord);

    // 触发 invalidate-cache 事件（修正会影响候选缓存）
    // 使用 source: 'manual_correction' 以便 candidateGen 识别并跳过防抖
    this.emit('invalidate-cache', { source: 'manual_correction', originalId: recordId });

    // 触发 change 事件
    this.emit('change', { type: 'correct', record: newRecord, originalRecord: original });

    // 同步到飞书（传递 company 用于同步到客户档案表）
    if (this.feishuClient) {
      this._syncToFeishu(newRecord, company).catch(err => {
        console.warn(`飞书同步失败: ${err.message}`);
      });
    }

    return newRecord;
  }

  /**
   * 获取已确认的事实（排除 superseded）
   * @returns {ConsensusRecord[]}
   */
  getConfirmedFacts() {
    return this.records.filter(
      r => r.type === 'fact' && r.status === 'confirmed'
    );
  }

  /**
   * 获取已确认的判断（排除 superseded）
   * @returns {ConsensusRecord[]}
   */
  getConfirmedConsensus() {
    return this.records.filter(
      r => r.type === 'consensus' && r.status === 'confirmed'
    );
  }

  /**
   * 获取待确认的判断
   * @returns {ConsensusRecord[]}
   */
  getPendingConsensus() {
    return this.records.filter(
      r => r.status === 'pending_client_confirm'
    );
  }

  /**
   * 获取修正历史
   * @param {string} recordId - 原始记录 ID
   * @returns {ConsensusRecord[]} 修正记录列表（按时间正序）
   */
  getCorrectionHistory(recordId) {
    /** @type {ConsensusRecord[]} */
    const history = [];
    let current = this.getRecord(recordId);

    while (current && current.superseded_by) {
      const corrected = this.getRecord(current.superseded_by);
      if (corrected) {
        history.push(corrected);
        current = corrected;
      } else {
        break;
      }
    }

    return history;
  }

  /**
   * 获取所有有效记录（排除 superseded）
   * @returns {ConsensusRecord[]}
   */
  getActiveRecords() {
    return this.records.filter(r => r.status !== 'superseded');
  }

  /**
   * 导出所有记录（用于持久化）
   * @returns {ConsensusRecord[]}
   */
  exportRecords() {
    return JSON.parse(JSON.stringify(this.records));
  }

  /**
   * 导入记录（用于恢复）
   * @param {ConsensusRecord[]} records - 要导入的记录数组
   */
  importRecords(records) {
    this.records = JSON.parse(JSON.stringify(records));
    // 触发 invalidate-cache 事件
    this.emit('invalidate-cache', { reason: 'records_imported' });
  }

  /**
   * 异步同步到飞书
   * @private
   * @param {ConsensusRecord} record
   * @param {string} [company] - 客户公司名
   * @returns {Promise<void>}
   */
  async _syncToFeishu(record, company) {
    if (!this.feishuClient) return;

    try {
      // 同步到诊断共识表
      await this.feishuClient.createConsensusRecord(record);

      // 如果有公司名，同步到客户档案表
      if (company) {
        await this._syncToProfile(record, company);
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * 同步到客户档案表
   * @private
   * @param {ConsensusRecord} record
   * @param {string} company
   * @returns {Promise<void>}
   */
  async _syncToProfile(record, company) {
    if (!this.feishuClient || !company) return;

    try {
      // 从共识链记录中提取客户档案字段
      const profileData = this._extractProfileData(record);
      if (Object.keys(profileData).length > 0) {
        await this.feishuClient.updateClientProfile(company, profileData);
        console.log(`同步到客户档案表: ${company}`, profileData);
      }
    } catch (err) {
      console.warn(`同步客户档案失败: ${err.message}`);
    }
  }

  /**
   * 从共识链记录中提取客户档案数据
   * @private
   * @param {ConsensusRecord} record
   * @returns {Object} 客户档案字段数据
   */
  _extractProfileData(record) {
    const profileData = {};
    const content = record.content || '';

    // 11 个静态字段的精确匹配（格式：字段名：值）
    const fieldNames = [
      '产品线', '客户群体', '收入结构', '毛利结构',
      '交付情况', '资源分布', '战略目标', '显性诉求',
      '当前追问', '诊断进度'
    ];

    for (const field of fieldNames) {
      // 匹配格式：字段名：值 或 字段名: 值
      const regex = new RegExp(`${field}[:：]\\s*(.+?)(?:[。\\n]|$)`, 's');
      const match = content.match(regex);
      if (match && match[1]) {
        profileData[field] = match[1].trim();
      }
    }

    return profileData;
  }

  /**
   * 从内容中提取字段值（已废弃，保留兼容）
   * @private
   * @param {string} content
   * @param {string[]} keywords
   * @returns {string|null}
   */
  _extractFieldValue(content, keywords) {
    for (const keyword of keywords) {
      const index = content.indexOf(keyword);
      if (index !== -1) {
        // 提取关键词后面的内容，直到句号、换行或下一个字段关键词
        const afterKeyword = content.substring(index + keyword.length);
        const match = afterKeyword.match(/^[:：\s]*(.+?)(?:[。\n]|$)/);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
    }
    return null;
  }

  /**
   * 根据内容推断字段名（已废弃，保留兼容）
   * @private
   * @param {string} content
   * @returns {string|null}
   */
  _inferField(content) {
    // 简单的启发式规则
    if (/^(新能源|电池|光伏|风电|储能)/.test(content)) {
      return '产品线';
    }
    if (/^(工厂|企业|公司|厂商)/.test(content)) {
      return '客户群体';
    }
    return null;
  }
}

module.exports = { ConsensusChain };
