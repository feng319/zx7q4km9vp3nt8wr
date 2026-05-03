// @ts-check
// src/integrations/feishuSync.js — 飞书实时同步模块
/**
 * @module feishuSync
 * 使用 WebSocket 实现飞书多维表格变更实时同步
 *
 * 架构设计：
 * - WebSocket 连接：监听飞书多维表格变更事件
 * - 事件驱动：变更通过 EventEmitter 通知订阅者
 * - 断线重连：自动重连机制，指数退避
 * - 本地缓存：用于变更检测和降级
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
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
 * 飞书实时同步类
 * @extends EventEmitter
 */
class FeishuSync extends EventEmitter {
  /**
   * @param {Object} options - 配置选项
   * @param {import('./feishuClient').FeishuClient} options.feishuClient - 飞书客户端
   * @param {number} [options.reconnectDelay] - 重连延迟（毫秒）
   * @param {number} [options.maxReconnectDelay] - 最大重连延迟
   * @param {number} [options.heartbeatInterval] - 心跳间隔
   */
  constructor(options) {
    super();

    this.feishuClient = options.feishuClient;
    this.reconnectDelay = options.reconnectDelay || 1000;
    this.maxReconnectDelay = options.maxReconnectDelay || 30000;
    this.heartbeatInterval = options.heartbeatInterval || 30000;

    const config = getConfig();

    /** @type {SyncStatus} */
    this._status = 'disconnected';
    /** @type {WebSocket|null} */
    this._ws = null;
    /** @type {NodeJS.Timeout|null} */
    this._heartbeatTimer = null;
    /** @type {NodeJS.Timeout|null} */
    this._reconnectTimer = null;
    /** @type {number} */
    this._currentReconnectDelay = this.reconnectDelay;

    // 快照缓存：用于检测变更
    /** @type {Map<string, string>} */
    this._snapshot = new Map(); // record_id -> JSON string

    // 已知写入集合：避免自写自触发
    /** @type {Set<string>} */
    this._knownWriteIds = new Set();

    // 统计信息
    this._stats = {
      connectedTime: null,
      reconnectCount: 0,
      changeCount: 0,
      errorCount: 0,
      lastError: null,
    };

    // WebSocket URL（飞书开放平台 WebSocket 端点）
    this._wsUrl = `wss://open.feishu.cn/open-apis/bitable/v1/apps/${config.feishu.bitableToken}/watch`;
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
      await this._connect();
      return true;
    } catch (error) {
      logger.error('Failed to start FeishuSync', { error: error.message });
      return false;
    }
  }

  /**
   * 停止同步
   */
  stop() {
    this._clearTimers();

    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }

    this._status = 'disconnected';
    logger.info('FeishuSync stopped');
  }

  /**
   * 建立 WebSocket 连接
   * @private
   */
  async _connect() {
    this._status = 'connecting';

    return new Promise((resolve, reject) => {
      try {
        // 获取访问令牌
        this._getAccessToken().then(token => {
          this._ws = new WebSocket(this._wsUrl, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          this._setupWebSocketHandlers();

          this._ws.once('open', () => {
            this._status = 'connected';
            this._stats.connectedTime = new Date().toISOString();
            this._currentReconnectDelay = this.reconnectDelay;
            this._startHeartbeat();
            this.emit('connected');
            logger.info('FeishuSync connected');
            resolve();
          });

          this._ws.once('error', (error) => {
            if (this._status === 'connecting') {
              reject(error);
            }
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 设置 WebSocket 事件处理器
   * @private
   */
  _setupWebSocketHandlers() {
    if (!this._ws) return;

    this._ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this._handleMessage(message);
      } catch (error) {
        logger.error('Failed to parse WebSocket message', { error: error.message });
      }
    });

    this._ws.on('close', (code, reason) => {
      logger.warn('WebSocket closed', { code, reason: reason.toString() });
      this._handleDisconnect();
    });

    this._ws.on('error', (error) => {
      logger.error('WebSocket error', { error: error.message });
      this._stats.errorCount++;
      this._stats.lastError = error.message;
      this.emit('error', error);
    });
  }

  /**
   * 处理断线
   * @private
   */
  _handleDisconnect() {
    this._clearTimers();

    if (this._status === 'connected') {
      this._status = 'reconnecting';
      this._scheduleReconnect();
    } else {
      this._status = 'disconnected';
    }

    this.emit('disconnected');
  }

  /**
   * 调度重连
   * @private
   */
  _scheduleReconnect() {
    this._reconnectTimer = setTimeout(async () => {
      logger.info('Attempting to reconnect', { delay: this._currentReconnectDelay });
      this._stats.reconnectCount++;

      try {
        await this._connect();
      } catch (error) {
        // 指数退避
        this._currentReconnectDelay = Math.min(
          this._currentReconnectDelay * 2,
          this.maxReconnectDelay
        );
        this._scheduleReconnect();
      }
    }, this._currentReconnectDelay);
  }

  /**
   * 获取访问令牌
   * @private
   * @returns {Promise<string>}
   */
  async _getAccessToken() {
    // 使用飞书 SDK 获取 tenant_access_token
    const config = getConfig();
    // 简化实现：实际应通过 lark SDK 获取
    // 这里返回一个占位符，实际使用时需要实现完整的认证流程
    return `tenant_access_token_${Date.now()}`;
  }

  // ==================== 心跳机制 ====================

  /**
   * 启动心跳
   * @private
   */
  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.heartbeatInterval);
  }

  /**
   * 清除定时器
   * @private
   */
  _clearTimers() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  // ==================== 消息处理 ====================

  /**
   * 处理 WebSocket 消息
   * @private
   * @param {Object} message
   */
  _handleMessage(message) {
    switch (message.type) {
      case 'pong':
        // 心跳响应
        break;

      case 'record_change':
        this._handleRecordChange(message.payload);
        break;

      case 'error':
        logger.error('Received error from server', { error: message.error });
        this._stats.errorCount++;
        this._stats.lastError = message.error;
        this.emit('error', new Error(message.error));
        break;

      default:
        logger.debug('Unknown message type', { type: message.type });
    }
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
      // 更新快照但不触发事件
      this._snapshot.set(record_id, JSON.stringify(data));
      return;
    }

    // 检测是否为真实变更
    const snapshotKey = JSON.stringify(data);
    if (this._snapshot.get(record_id) === snapshotKey) {
      // 无变化，忽略
      return;
    }

    // 更新快照
    this._snapshot.set(record_id, snapshotKey);

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
   * 强制同步一次（轮询方案作为备份）
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
