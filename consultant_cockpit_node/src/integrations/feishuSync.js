// @ts-check
// src/integrations/feishuSync.js — 飞书实时同步模块
/**
 * @module feishuSync
 * 飞书多维表格实时同步，使用 WebSocket 长连接订阅变更事件
 *
 * 架构设计（设计文档 11.2.1 节）：
 * - 主方案：WebSocket 长连接（使用 @larksuiteoapi/node-sdk）
 * - 监听事件：drive.file.bitable_record_changed_v1
 * - 降级方案：轮询（当 WebSocket 不可用时自动降级）
 *
 * 双层架构：
 * ┌─────────────────────────────────────────────────────────┐
 * │  Node.js 进程（事件网关）                                  │
 * │  WSClient ← 飞书 WebSocket 长连接                          │
 * │  监听 drive.file.bitable_record_changed_v1               │
 * │  收到事件 → 发射 'change' 事件给订阅者                      │
 * └─────────────────────────────────────────────────────────┘
 */

const EventEmitter = require('events');
const lark = require('@larksuiteoapi/node-sdk');
const { getLogger } = require('../utils/logger');
const { getConfig } = require('../utils/config');

// 模块级日志器
const logger = getLogger('feishuSync');

/**
 * 飞书同步状态
 * @typedef {'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'fallback_polling'} SyncStatus
 */

/**
 * 变更事件
 * @typedef {Object} ChangeEvent
 * @property {string} record_id
 * @property {Object} data
 * @property {'create' | 'update' | 'delete'} change_type
 * @property {string} timestamp
 * @property {'consensus' | 'profile'} table_type - 表类型：共识链或客户档案
 * @property {string} [company] - 客户公司名（仅客户档案表变更时有）
 */

/**
 * 飞书实时同步类（WebSocket 长连接 + 轮询降级）
 * @extends EventEmitter
 */
class FeishuSync extends EventEmitter {
  /**
   * @param {Object} options - 配置选项
   * @param {import('./feishuClient').FeishuClient} options.feishuClient - 飞书客户端
   * @param {string} [options.bitableToken] - 多维表格 Token
   * @param {number} [options.pollInterval] - 轮询间隔（毫秒），默认 30 秒（降级模式使用）
   * @param {number} [options.wsReconnectDelay] - WebSocket 重连延迟（毫秒），默认 5 秒
   */
  constructor(options) {
    super();

    const config = getConfig();

    this.feishuClient = options.feishuClient;
    this.bitableToken = options.bitableToken || config.feishu.bitableToken;
    this.consensusTableId = options.consensusTableId || config.feishu.consensusTableId;
    this.profileTableId = options.profileTableId || config.feishu.profileTableId;
    this.pollInterval = options.pollInterval || 30000; // 30 秒（设计文档 2.4 节）
    this.wsReconnectDelay = options.wsReconnectDelay || 5000;

    /** @type {SyncStatus} */
    this._status = 'disconnected';

    /** @type {lark.Client|null} */
    this._larkClient = null;

    /** @type {lark.WSClient|null} */
    this._wsClient = null;

    /** @type {lark.EventDispatcher|null} */
    this._eventDispatcher = null;

    /** @type {NodeJS.Timeout|null} */
    this._pollTimer = null;

    /** @type {NodeJS.Timeout|null} */
    this._reconnectTimer = null;

    // 快照缓存：用于变更检测和降级
    /** @type {Map<string, string>} */
    this._snapshot = new Map(); // record_id -> JSON string

    // 已知写入集合：避免自写自触发
    /** @type {Set<string>} */
    this._knownWriteIds = new Set();

    // 统计信息
    this._stats = {
      connectedTime: null,
      wsConnectCount: 0,
      pollCount: 0,
      changeCount: 0,
      errorCount: 0,
      lastError: null,
      mode: 'none', // 'websocket' | 'polling'
    };
  }

  // ==================== 连接管理 ====================

  /**
   * 启动同步
   * 设计文档 11.2.1 节：优先使用 WebSocket，失败时降级为轮询
   * @returns {Promise<boolean>}
   */
  async start() {
    if (this._status === 'connected' || this._status === 'connecting') {
      logger.warn('FeishuSync already running');
      return true;
    }

    try {
      this._status = 'connecting';

      // 尝试 WebSocket 连接
      const wsSuccess = await this._startWebSocket();

      if (wsSuccess) {
        this._status = 'connected';
        this._stats.mode = 'websocket';
        this._stats.wsConnectCount++;
        this._stats.connectedTime = new Date().toISOString();
        this.emit('connected');
        logger.info('FeishuSync started (WebSocket mode)');
        return true;
      }

      // WebSocket 失败，降级为轮询
      logger.warn('WebSocket connection failed, falling back to polling');
      await this._startPollingFallback();

      this._status = 'fallback_polling';
      this._stats.mode = 'polling';
      this._stats.connectedTime = new Date().toISOString();
      this.emit('connected');
      logger.info('FeishuSync started (polling fallback)', { pollInterval: this.pollInterval });

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
    // 停止 WebSocket 重连
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // 停止轮询
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    this._status = 'disconnected';
    this._stats.mode = 'none';
    logger.info('FeishuSync stopped');
    this.emit('disconnected');
  }

  // ==================== WebSocket 长连接 ====================

  /**
   * 启动 WebSocket 长连接
   * 设计文档 11.2.1 节：使用 @larksuiteoapi/node-sdk 的 WebSocket 事件订阅
   *
   * SDK v1.62.1 正确用法：
   * 1. lark.Client 用于 API 调用（订阅等）
   * 2. lark.WSClient 是独立的 WebSocket 客户端类
   * 3. lark.EventDispatcher 用于事件路由
   *
   * @private
   * @returns {Promise<boolean>}
   */
  async _startWebSocket() {
    try {
      const config = getConfig();

      // 创建 lark 客户端（用于 API 调用，如订阅）
      // 使用 Domain.Feishu（中国版飞书），而非 Domain.Lark（国际版）
      this._larkClient = new lark.Client({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        appType: lark.AppType.SelfBuild,
        domain: lark.Domain.Feishu,
      });

      // 订阅多维表格变更事件
      // 设计文档 11.2.1 节前置条件：
      // 1. 开发者后台配置：事件与回调 → 订阅方式 → 使用长连接接收事件
      // 2. 添加事件：drive.file.bitable_record_changed_v1
      // 3. 调用订阅 API：POST drive/v1/files/:file_token/subscribe

      // 先订阅多维表格
      await this._subscribeBitable();

      // 创建 EventDispatcher（事件分发器）
      // SDK 要求：两个参数必须为空字符串
      this._eventDispatcher = new lark.EventDispatcher('', '');

      // 注册事件处理器
      // 注意：飞书订阅多维表格时会推送多种事件类型，需要注册对应的处理器
      this._eventDispatcher.register({
        // 主要事件：多维表格记录变更
        'drive.file.bitable_record_changed_v1': (data) => {
          this._handleBitableChangeEvent(data);
          return Promise.resolve();
        },
        // 忽略文档编辑事件（避免 SDK 警告）
        'drive.file.edit_v1': () => Promise.resolve(),
      });

      // 创建独立的 WSClient
      // 使用 Domain.Feishu（中国版飞书）
      this._wsClient = new lark.WSClient({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        appType: lark.AppType.SelfBuild,
        domain: lark.Domain.Feishu,
        eventDispatcher: this._eventDispatcher,
      });

      // 启动 WebSocket 连接
      // start() 需要传入包含 eventDispatcher 的参数对象
      this._wsClient.start({ eventDispatcher: this._eventDispatcher });

      logger.info('WebSocket client started, waiting for connection');

      // 等待连接建立（最多 10 秒）
      // 由于 WSClient 不提供 isConnected 方法，我们等待一段时间后假设成功
      await new Promise(resolve => setTimeout(resolve, 3000));

      return true;
    } catch (error) {
      logger.error('WebSocket start failed', { error: error.message, stack: error.stack });
      this._stats.errorCount++;
      this._stats.lastError = error.message;
      return false;
    }
  }

  /**
   * 订阅多维表格变更事件
   * @private
   */
  async _subscribeBitable() {
    try {
      const response = await this._larkClient.drive.file.subscribe({
        path: {
          file_token: this.bitableToken,
        },
        params: {
          file_type: 'bitable',
        },
      });

      if (response.code !== 0) {
        throw new Error(`Subscribe API error: ${response.msg}`);
      }

      logger.info('Subscribed to bitable changes', { bitableToken: this.bitableToken });
    } catch (error) {
      logger.error('Failed to subscribe bitable', { error: error.message });
      throw error;
    }
  }

  /**
   * 处理 WebSocket 断开
   * @private
   */
  _handleWsDisconnect() {
    if (this._status !== 'connected') return;

    // 尝试重连
    this._status = 'reconnecting';
    this._reconnectTimer = setTimeout(async () => {
      const success = await this._startWebSocket();
      if (success) {
        this._status = 'connected';
        logger.info('WebSocket reconnected');
      } else {
        // 重连失败，降级为轮询
        logger.warn('WebSocket reconnect failed, falling back to polling');
        await this._startPollingFallback();
        this._status = 'fallback_polling';
        this._stats.mode = 'polling';
      }
    }, this.wsReconnectDelay);
  }

  /**
   * 处理多维表格变更事件
   * 设计文档 11.2.1 节验证结果：
   * - action: "record_added" | "record_modified" | "record_deleted"
   * - record_id: 变更记录ID
   * - table_id: 数据表ID
   * @private
   * @param {Object} event - 飞书事件对象
   */
  async _handleBitableChangeEvent(event) {
    try {
      // 飞书事件结构：
      // 方式1: { header: {...}, event: { body: {...} } }
      // 方式2: { body: {...} } (直接是 event 对象)
      // 参考: https://open.feishu.cn/document/client-docs/sdk-docs/node-sdk/event-dispatcher

      // 调试：打印完整事件结构
      logger.debug('Received bitable change event', {
        eventKeys: Object.keys(event || {}),
        hasEvent: !!event?.event,
        hasBody: !!event?.body,
        body: event?.body || event?.event?.body
      });

      // 兼容两种事件格式
      const body = event.body || event.event?.body || {};
      const action = body.action; // 'record_added' | 'record_modified' | 'record_deleted'
      const recordId = body.record_id;
      const tableId = body.table_id;

      if (!recordId) {
        logger.warn('Bitable change event missing record_id', { body, eventKeys: Object.keys(event || {}) });
        return;
      }

      // 跳过已知写入的记录（避免自写自触发）
      if (this._knownWriteIds.has(recordId)) {
        this._knownWriteIds.delete(recordId);
        logger.debug('Skipping known write', { recordId });
        return;
      }

      // 根据 table_id 判断表类型
      const tableType = this._getTableType(tableId);

      // 映射 action 到 change_type
      const changeTypeMap = {
        'record_added': 'create',
        'record_modified': 'update',
        'record_deleted': 'delete',
      };
      const changeType = changeTypeMap[action] || 'update';

      // 获取完整记录数据（create/update 时）
      let data = null;
      let company = null;

      if (changeType !== 'delete') {
        if (tableType === 'profile') {
          // 客户档案表变更
          data = await this.feishuClient.getProfileRecord(recordId);
          company = data?.['客户公司名'] || data?.company || null;
        } else {
          // 共识链表变更
          data = await this.feishuClient.getConsensusRecord(recordId);
        }
      }

      // 构造变更事件
      /** @type {ChangeEvent} */
      const changeEvent = {
        record_id: recordId,
        data,
        change_type: changeType,
        timestamp: new Date().toISOString(),
        table_type: tableType,
        table_id: tableId,
      };

      // 客户档案表变更时附加公司名
      if (tableType === 'profile' && company) {
        changeEvent.company = company;
      }

      this._stats.changeCount++;
      this.emit('change', changeEvent);
      logger.info('Bitable record changed', { recordId, changeType, action, tableType, company });

      // 更新快照（用于降级模式同步）
      if (data) {
        this._snapshot.set(recordId, JSON.stringify(data));
      } else if (changeType === 'delete') {
        this._snapshot.delete(recordId);
      }
    } catch (error) {
      logger.error('Failed to handle bitable change event', { error: error.message });
      this._stats.errorCount++;
      this._stats.lastError = error.message;
    }
  }

  // ==================== 轮询降级方案 ====================

  /**
   * 启动轮询降级
   * 设计文档 11.2.1 节：当 Node.js 事件网关不可用时，Python 侧自动降级为轮询
   * @private
   */
  async _startPollingFallback() {
    // 初始同步
    await this._poll();

    // 开始定时轮询
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

    // 检测新增和更新
    for (const record of records) {
      if (!record.record_id) continue;

      const snapshotKey = JSON.stringify(record);
      const previousSnapshot = this._snapshot.get(record.record_id);

      if (!previousSnapshot) {
        // 新记录
        this._emitChange({
          record_id: record.record_id,
          data: record,
          change_type: 'create',
        });
      } else if (previousSnapshot !== snapshotKey) {
        // 更新的记录
        this._emitChange({
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
        this._emitChange({
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
   * 发射变更事件（避免自写自触发）
   * @private
   * @param {Object} payload
   */
  _emitChange(payload) {
    const { record_id, change_type, data } = payload;

    // 跳过已知写入的记录
    if (this._knownWriteIds.has(record_id)) {
      this._knownWriteIds.delete(record_id);
      return;
    }

    /** @type {ChangeEvent} */
    const event = {
      record_id,
      data,
      change_type,
      timestamp: new Date().toISOString(),
    };

    this._stats.changeCount++;
    this.emit('change', event);
    logger.info('Record changed (polling)', { record_id, change_type });
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

      // 更新快照并检测变更
      for (const record of records) {
        if (record.record_id) {
          const snapshotKey = JSON.stringify(record);
          const oldSnapshot = this._snapshot.get(record.record_id);

          if (oldSnapshot !== snapshotKey) {
            this._snapshot.set(record.record_id, snapshotKey);
            this._emitChange({
              record_id: record.record_id,
              data: record,
              change_type: 'update',
            });
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
   * @returns {{status: SyncStatus, stats: Object, snapshotSize: number, mode: string}}
   */
  getStatus() {
    return {
      status: this._status,
      stats: { ...this._stats },
      snapshotSize: this._snapshot.size,
      mode: this._stats.mode,
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
      wsConnectCount: 0,
      pollCount: 0,
      changeCount: 0,
      errorCount: 0,
      lastError: null,
      mode: 'none',
    };
  }

  async start() {
    this._status = 'connected';
    this._stats.mode = 'websocket';
    this._stats.connectedTime = new Date().toISOString();
    this.emit('connected');
    return true;
  }

  stop() {
    this._status = 'disconnected';
    this._stats.mode = 'none';
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
      mode: this._stats.mode,
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