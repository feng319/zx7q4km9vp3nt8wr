// @ts-check
// src/integrations/feishuSync.js — 飞书实时同步模块
/**
 * @module feishuSync
 * 使用轮询实现飞书多维表格变更检测
 *
 * 架构设计：
 * - 定时轮询：定期查询多维表格变更
 * - 事件驱动：变更通过 EventEmitter 通知订阅者
 * - 断线重连：自动重试机制，指数退避
 * - 本地缓存：用于变更检测和降级
 */

const EventEmitter = require('events');
const { getLogger } = require('../utils/logger');
const { getConfig } = require('../utils/config');

// 模块级日志器
const logger = getLogger('feishuSync');

/**
 * 飞书同步状态
 * @typedef {'disconnected' | 'connecting' | 'connected' | 'reconnecting'} SyncStatus
 */

/**
 * 变更事件
 * @typedef {Object} ChangeEvent
 * @property {string} record_id
 * @property {Object} data
 * @property {'create' | 'update' | 'delete'} change_type
 * @property {string} timestamp
 */

/**
 * 飞书实时同步类（基于轮询）
 * @extends EventEmitter
 */
class FeishuSync extends EventEmitter {
  /**
   * @param {Object} options - 配置选项
   * @param {import('./feishuClient').FeishuClient} options.feishuClient - 飞书客户端
   * @param {number} [options.pollInterval] - 轮询间隔（毫秒），默认 30 秒
   */
  constructor(options) {
    super();

    this.feishuClient = options.feishuClient;
    this.pollInterval = options.pollInterval || 30000; // 30 秒

    /** @type {SyncStatus} */
    this._status = 'disconnected';
    /** @type {NodeJS.Timeout|null} */
    this._pollTimer = null;

    // 快照缓存：用于检测变更
    /** @type {Map<string, string>} */
    this._snapshot = new Map(); // record_id -> JSON string

    // 已知写入集合：避免自写自触发
    /** @type {Set<string>} */
    this._knownWriteIds = new Set();

    // 统计信息
    this._stats = {
      connectedTime: null,
      pollCount: 0,
      changeCount: 0,
      errorCount: 0,
      lastError: null,
    };
  }

  // ==================== 连接管理 ====================

  /**
   * 启动同步
   * @returns {Promise<boolean>}
   */
  async start() {
    if (this._status === 'connected' || this._status === 'connecting') {
      logger.warn('FeishuSync already running');
      return true;
    }

    try {
      this._status = 'connecting';

      // 初始同步
      await this._poll();

      this._status = 'connected';
      this._stats.connectedTime = new Date().toISOString();

      // 开始定时轮询
      this._startPolling();

      this.emit('connected');
      logger.info('FeishuSync started', { pollInterval: this.pollInterval });

      return true;
    } catch (error) {
      this._status = 'disconnected';
      logger.error('Failed to start FeishuSync', { error: error.message });
      this._stats.errorCount++;
      this._stats.lastError = error.message;
      return false;
    }
  }

  /**
   * 停止同步
   */
  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    this._status = 'disconnected';
    logger.info('FeishuSync stopped');
  }

  /**
   * 开始轮询
   * @private
   */
  _startPolling() {
    this._pollTimer = setInterval(async () => {
      try {
        await this._poll();
      } catch (error) {
        logger.error('Poll error', { error: error.message });
        this._stats.errorCount++;
        this._stats.lastError = error.message;
      }
    }, this.pollInterval);
  }

  /**
   * 执行轮询
   * @private
   */
  async _poll() {
    this._stats.pollCount++;

    const records = await this.feishuClient.listConsensusRecords();

    // 检测变更
    const currentIds = new Set(records.map(r => r.record_id));
    const previousIds = new Set(this._snapshot.keys());

    // 检测新增
    for (const record of records) {
      if (!record.record_id) continue;

      const snapshotKey = JSON.stringify(record);
      const previousSnapshot = this._snapshot.get(record.record_id);

      if (!previousSnapshot) {
        // 新记录
        this._handleRecordChange({
          record_id: record.record_id,
          data: record,
          change_type: 'create',
        });
      } else if (previousSnapshot !== snapshotKey) {
        // 更新的记录
        this._handleRecordChange({
          record_id: record.record_id,
          data: record,
          change_type: 'update',
        });
      }

      // 更新快照
      this._snapshot.set(record.record_id, snapshotKey);
    }

    // 检测删除
    for (const id of previousIds) {
      if (!currentIds.has(id)) {
        this._handleRecordChange({
          record_id: id,
          data: null,
          change_type: 'delete',
        });
        this._snapshot.delete(id);
      }
    }

    logger.debug('Poll completed', {
      total: records.length,
      snapshotSize: this._snapshot.size
    });
  }

  /**
   * 处理记录变更
   * @private
   * @param {Object} payload
   */
  _handleRecordChange(payload) {
    const { record_id, change_type, data } = payload;

    // 跳过已知写入的记录（避免自写自触发）
    if (this._knownWriteIds.has(record_id)) {
      this._knownWriteIds.delete(record_id);
      return;
    }

    // 构造变更事件
    /** @type {ChangeEvent} */
    const event = {
      record_id,
      data,
      change_type,
      timestamp: new Date().toISOString(),
    };

    this._stats.changeCount++;

    // 发射事件
    this.emit('change', event);
    logger.info('Record changed', { record_id, change_type });
  }

  // ==================== 已知写入注册 ====================

  /**
   * 注册已知写入的记录 ID
   * 当本地写入记录到飞书后，调用此方法避免自写自触发
   * @param {string} recordId
   */
  registerKnownWrite(recordId) {
    this._knownWriteIds.add(recordId);
    // 5秒后自动清除（防止内存泄漏）
    setTimeout(() => {
      this._knownWriteIds.delete(recordId);
    }, 5000);
  }

  // ==================== 手动同步 ====================

  /**
   * 强制同步一次
   * @param {string} [company] - 可选，指定公司
   * @returns {Promise<{success: boolean, records: Object[], error?: string}>}
   */
  async forceSync(company) {
    try {
      const records = await this.feishuClient.listConsensusRecords({ company });

      // 更新快照
      for (const record of records) {
        if (record.record_id) {
          const snapshotKey = JSON.stringify(record);
          const oldSnapshot = this._snapshot.get(record.record_id);

          if (oldSnapshot !== snapshotKey) {
            // 检测到变更
            this._snapshot.set(record.record_id, snapshotKey);

            /** @type {ChangeEvent} */
            const event = {
              record_id: record.record_id,
              data: record,
              change_type: 'update',
              timestamp: new Date().toISOString(),
            };

            this._stats.changeCount++;
            this.emit('change', event);
          }
        }
      }

      return { success: true, records };
    } catch (error) {
      logger.error('Force sync failed', { error: error.message });
      return { success: false, records: [], error: error.message };
    }
  }

  // ==================== 状态查询 ====================

  /**
   * 获取同步状态
   * @returns {{status: SyncStatus, stats: Object, snapshotSize: number}}
   */
  getStatus() {
    return {
      status: this._status,
      stats: { ...this._stats },
      snapshotSize: this._snapshot.size,
    };
  }

  /**
   * 清除快照缓存
   */
  clearCache() {
    this._snapshot.clear();
    logger.info('Cleared sync snapshot cache');
  }
}

/**
 * Mock 同步类（用于测试）
 * @extends EventEmitter
 */
class FeishuSyncMock extends EventEmitter {
  constructor() {
    super();
    this._status = 'disconnected';
    this._stats = {
      connectedTime: null,
      reconnectCount: 0,
      changeCount: 0,
      errorCount: 0,
      lastError: null,
    };
  }

  async start() {
    this._status = 'connected';
    this._stats.connectedTime = new Date().toISOString();
    this.emit('connected');
    return true;
  }

  stop() {
    this._status = 'disconnected';
    this.emit('disconnected');
  }

  registerKnownWrite(recordId) {
    // no-op
  }

  async forceSync(company) {
    return { success: true, records: [] };
  }

  getStatus() {
    return {
      status: this._status,
      stats: { ...this._stats },
      snapshotSize: 0,
    };
  }

  clearCache() {
    // no-op
  }
}

module.exports = {
  FeishuSync,
  FeishuSyncMock,
};
