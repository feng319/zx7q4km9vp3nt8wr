// @ts-check
// src/core/sessionManager.js — 会话持久化管理
/**
 * @module sessionManager
 * 会话持久化管理器
 *
 * 功能：
 * - 会话快照保存/加载
 * - 自动保存机制
 * - 会话恢复
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

/**
 * 会话快照
 * @typedef {Object} SessionSnapshot
 * @property {string} session_id
 * @property {Object} metadata
 * @property {Object[]} records
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * 会话管理器
 */
class SessionManager {
  /**
   * @param {Object} options
   * @param {string} [options.storageDir] - 存储目录
   * @param {number} [options.autoSaveInterval] - 自动保存间隔（毫秒）
   */
  constructor(options = {}) {
    this.storageDir = options.storageDir || './data/sessions';
    this.autoSaveInterval = options.autoSaveInterval || 60000; // 默认 1 分钟

    /** @type {Map<string, NodeJS.Timeout>} */
    this._autoSaveTimers = new Map();

    /** @type {Map<string, Function>} */
    this._saveCallbacks = new Map();

    // 确保存储目录存在
    this._ensureDir(this.storageDir);

    logger.info('SessionManager initialized', { storageDir: this.storageDir });
  }

  /**
   * 确保目录存在
   * @param {string} dir
   * @private
   */
  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 获取会话文件路径
   * @param {string} sessionId
   * @returns {string}
   * @private
   */
  _getSessionPath(sessionId) {
    return path.join(this.storageDir, `${sessionId}.json`);
  }

  /**
   * 保存会话
   * @param {string} sessionId
   * @param {Object[]} records
   * @param {Object} [metadata={}]
   * @returns {Promise<boolean>}
   */
  async saveSession(sessionId, records, metadata = {}) {
    try {
      const filePath = this._getSessionPath(sessionId);

      // 读取现有快照（如果存在）
      let snapshot = await this.loadSession(sessionId) || {
        session_id: sessionId,
        created_at: new Date().toISOString(),
      };

      // 更新快照
      snapshot.records = records;
      snapshot.metadata = { ...snapshot.metadata, ...metadata };
      snapshot.updated_at = new Date().toISOString();

      // 写入文件
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

      logger.info('Session saved', { sessionId, recordCount: records.length });
      return true;
    } catch (error) {
      logger.error('Failed to save session', { sessionId, error: error.message });
      return false;
    }
  }

  /**
   * 加载会话
   * @param {string} sessionId
   * @returns {Promise<SessionSnapshot|null>}
   */
  async loadSession(sessionId) {
    try {
      const filePath = this._getSessionPath(sessionId);

      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const snapshot = JSON.parse(content);

      logger.info('Session loaded', { sessionId, recordCount: snapshot.records?.length || 0 });
      return snapshot;
    } catch (error) {
      logger.error('Failed to load session', { sessionId, error: error.message });
      return null;
    }
  }

  /**
   * 删除会话
   * @param {string} sessionId
   * @returns {Promise<boolean>}
   */
  async deleteSession(sessionId) {
    try {
      const filePath = this._getSessionPath(sessionId);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // 停止自动保存
      this.stopAutoSave(sessionId);

      logger.info('Session deleted', { sessionId });
      return true;
    } catch (error) {
      logger.error('Failed to delete session', { sessionId, error: error.message });
      return false;
    }
  }

  /**
   * 列出所有会话
   * @returns {Promise<Array<{session_id: string, updated_at: string, record_count: number}>>}
   */
  async listSessions() {
    try {
      const files = fs.readdirSync(this.storageDir);
      const sessions = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const sessionId = file.replace('.json', '');
          const snapshot = await this.loadSession(sessionId);

          if (snapshot) {
            sessions.push({
              session_id: sessionId,
              updated_at: snapshot.updated_at,
              record_count: snapshot.records?.length || 0,
            });
          }
        }
      }

      // 按更新时间排序（最新的在前）
      sessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

      return sessions;
    } catch (error) {
      logger.error('Failed to list sessions', { error: error.message });
      return [];
    }
  }

  /**
   * 启动自动保存
   * @param {string} sessionId
   * @param {Function} saveCallback - 返回要保存的 records 的函数
   */
  startAutoSave(sessionId, saveCallback) {
    // 先停止现有的定时器
    this.stopAutoSave(sessionId);

    this._saveCallbacks.set(sessionId, saveCallback);

    const timer = setInterval(async () => {
      const callback = this._saveCallbacks.get(sessionId);
      if (callback) {
        const records = callback();
        await this.saveSession(sessionId, records);
      }
    }, this.autoSaveInterval);

    this._autoSaveTimers.set(sessionId, timer);

    logger.info('Auto-save started', { sessionId, interval: this.autoSaveInterval });
  }

  /**
   * 停止自动保存
   * @param {string} sessionId
   */
  stopAutoSave(sessionId) {
    const timer = this._autoSaveTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this._autoSaveTimers.delete(sessionId);
      this._saveCallbacks.delete(sessionId);
      logger.info('Auto-save stopped', { sessionId });
    }
  }

  /**
   * 检查会话是否存在
   * @param {string} sessionId
   * @returns {boolean}
   */
  exists(sessionId) {
    const filePath = this._getSessionPath(sessionId);
    return fs.existsSync(filePath);
  }

  /**
   * 获取会话元数据
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getMetadata(sessionId) {
    const snapshot = this.loadSession(sessionId);
    return snapshot?.metadata || null;
  }

  /**
   * 更新会话元数据
   * @param {string} sessionId
   * @param {Object} metadata
   * @returns {Promise<boolean>}
   */
  async updateMetadata(sessionId, metadata) {
    const snapshot = await this.loadSession(sessionId);
    if (!snapshot) {
      return false;
    }

    snapshot.metadata = { ...snapshot.metadata, ...metadata };
    snapshot.updated_at = new Date().toISOString();

    const filePath = this._getSessionPath(sessionId);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

    return true;
  }

  /**
   * 清理过期会话
   * @param {number} maxAge - 最大年龄（毫秒）
   * @returns {Promise<number>} 清理的会话数量
   */
  async cleanupExpired(maxAge = 7 * 24 * 60 * 60 * 1000) { // 默认 7 天
    const sessions = await this.listSessions();
    const now = Date.now();
    let cleaned = 0;

    for (const session of sessions) {
      const updatedAt = new Date(session.updated_at).getTime();
      if (now - updatedAt > maxAge) {
        await this.deleteSession(session.session_id);
        cleaned++;
      }
    }

    logger.info('Cleanup completed', { cleaned, remaining: sessions.length - cleaned });
    return cleaned;
  }
}

module.exports = {
  SessionManager,
};
