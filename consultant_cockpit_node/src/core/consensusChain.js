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
   * @param {boolean} [syncToFeishu=true] - 是否同步到飞书
   * @returns {ConsensusRecord} 添加后的记录（含 id 和 timestamp）
   * @fires ConsensusChain#change
   */
  addRecord(record, syncToFeishu = false) {
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
      status: record.status || 'pending_client_confirm',
      confidence: record.confidence || null,
      replaces: record.replaces || null,
      superseded_by: record.superseded_by || null,
      feishu_record_id: record.feishu_record_id || null,
      recommendation: record.recommendation || null
    };

    this.records.push(newRecord);

    // 可选同步到飞书
    if (syncToFeishu && this.feishuClient) {
      this._syncToFeishu(newRecord).catch(err => {
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
   * 确认记录
   * @param {string} recordId - 记录 ID
   * @throws {Error} 记录不存在时抛出
   * @fires ConsensusChain#change
   */
  confirmRecord(recordId) {
    const record = this.getRecord(recordId);
    if (!record) {
      throw new Error(`找不到记录: ${recordId}`);
    }

    record.status = 'confirmed';

    // 触发 change 事件
    this.emit('change', { type: 'confirm', record });

    // 同步到飞书
    if (this.feishuClient) {
      this._syncToFeishu(record).catch(err => {
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
   * @param {RecordSource} [source='manual_correction'] - 修正来源
   * @returns {ConsensusRecord} 新创建的修正记录
   * @throws {Error} 记录不存在时抛出
   * @fires ConsensusChain#change
   * @fires ConsensusChain#invalidate-cache
   */
  correctRecord(recordId, newContent, source = 'manual_correction') {
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
    this.emit('invalidate-cache', { reason: 'record_corrected', originalId: recordId });

    // 触发 change 事件
    this.emit('change', { type: 'correct', record: newRecord, originalRecord: original });

    // 同步到飞书
    if (this.feishuClient) {
      this._syncToFeishu(newRecord).catch(err => {
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
   * @returns {Promise<void>}
   */
  async _syncToFeishu(record) {
    if (!this.feishuClient) return;

    try {
      // 使用 createConsensusRecord 方法（飞书客户端实际提供的方法）
      await this.feishuClient.createConsensusRecord(record);
    } catch (err) {
      throw err;
    }
  }
}

module.exports = { ConsensusChain };
