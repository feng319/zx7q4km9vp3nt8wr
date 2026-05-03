// @ts-check
// tests/sessionManager.test.js — 会话管理器测试
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { SessionManager } = require('../src/core/sessionManager');

// 测试存储目录
const TEST_STORAGE_DIR = path.join(__dirname, 'test_sessions');

describe('SessionManager', () => {
  /** @type {SessionManager} */
  let manager;

  beforeEach(() => {
    // 清理测试目录
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      const files = fs.readdirSync(TEST_STORAGE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEST_STORAGE_DIR, file));
      }
    }

    manager = new SessionManager({
      storageDir: TEST_STORAGE_DIR,
      autoSaveInterval: 1000, // 1秒，便于测试
    });
  });

  afterEach(() => {
    // 停止所有自动保存
    // 清理测试目录
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      const files = fs.readdirSync(TEST_STORAGE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEST_STORAGE_DIR, file));
      }
      fs.rmdirSync(TEST_STORAGE_DIR);
    }
  });

  describe('saveSession', () => {
    it('should save a new session', async () => {
      const sessionId = 'test-session-1';
      const records = [
        { id: 'r1', type: 'fact', content: '测试事实' },
        { id: 'r2', type: 'consensus', content: '测试共识' },
      ];

      const result = await manager.saveSession(sessionId, records);

      assert.strictEqual(result, true);
      assert.ok(fs.existsSync(path.join(TEST_STORAGE_DIR, `${sessionId}.json`)));
    });

    it('should save session with metadata', async () => {
      const sessionId = 'test-session-2';
      const records = [{ id: 'r1', type: 'fact', content: '测试' }];
      const metadata = { company: '测试公司', consultant: '张三' };

      await manager.saveSession(sessionId, records, metadata);

      const snapshot = await manager.loadSession(sessionId);
      assert.strictEqual(snapshot.metadata.company, '测试公司');
      assert.strictEqual(snapshot.metadata.consultant, '张三');
    });

    it('should update existing session', async () => {
      const sessionId = 'test-session-3';
      const records1 = [{ id: 'r1', type: 'fact', content: '第一次' }];
      const records2 = [{ id: 'r2', type: 'fact', content: '第二次' }];

      await manager.saveSession(sessionId, records1);
      await manager.saveSession(sessionId, records2);

      const snapshot = await manager.loadSession(sessionId);
      assert.strictEqual(snapshot.records.length, 1);
      assert.strictEqual(snapshot.records[0].content, '第二次');
    });
  });

  describe('loadSession', () => {
    it('should return null for non-existent session', async () => {
      const snapshot = await manager.loadSession('non-existent');
      assert.strictEqual(snapshot, null);
    });

    it('should load saved session', async () => {
      const sessionId = 'test-session-4';
      const records = [{ id: 'r1', type: 'fact', content: '测试' }];

      await manager.saveSession(sessionId, records);
      const snapshot = await manager.loadSession(sessionId);

      assert.ok(snapshot);
      assert.strictEqual(snapshot.session_id, sessionId);
      assert.strictEqual(snapshot.records.length, 1);
    });

    it('should preserve timestamps', async () => {
      const sessionId = 'test-session-5';
      const records = [{ id: 'r1', type: 'fact', content: '测试' }];

      await manager.saveSession(sessionId, records);
      const snapshot = await manager.loadSession(sessionId);

      assert.ok(snapshot.created_at);
      assert.ok(snapshot.updated_at);
    });
  });

  describe('deleteSession', () => {
    it('should delete existing session', async () => {
      const sessionId = 'test-session-6';
      await manager.saveSession(sessionId, []);

      const result = await manager.deleteSession(sessionId);

      assert.strictEqual(result, true);
      assert.strictEqual(await manager.loadSession(sessionId), null);
    });

    it('should return true for non-existent session', async () => {
      const result = await manager.deleteSession('non-existent');
      assert.strictEqual(result, true);
    });
  });

  describe('listSessions', () => {
    it('should return empty array when no sessions', async () => {
      const sessions = await manager.listSessions();
      assert.deepStrictEqual(sessions, []);
    });

    it('should list all sessions', async () => {
      await manager.saveSession('session-1', [{ id: 'r1', type: 'fact' }]);
      await manager.saveSession('session-2', [{ id: 'r2', type: 'fact' }]);
      await manager.saveSession('session-3', [{ id: 'r3', type: 'fact' }]);

      const sessions = await manager.listSessions();

      assert.strictEqual(sessions.length, 3);
      assert.ok(sessions.some(s => s.session_id === 'session-1'));
      assert.ok(sessions.some(s => s.session_id === 'session-2'));
      assert.ok(sessions.some(s => s.session_id === 'session-3'));
    });

    it('should sort sessions by updated_at descending', async () => {
      // 按顺序创建，但最后更新的排在前面
      await manager.saveSession('session-old', [{ id: 'r1', type: 'fact' }]);

      // 等待一小段时间确保时间戳不同
      await new Promise(resolve => setTimeout(resolve, 10));

      await manager.saveSession('session-new', [{ id: 'r2', type: 'fact' }]);

      const sessions = await manager.listSessions();

      // 最新的应该在前面
      assert.strictEqual(sessions[0].session_id, 'session-new');
    });
  });

  describe('exists', () => {
    it('should return false for non-existent session', () => {
      assert.strictEqual(manager.exists('non-existent'), false);
    });

    it('should return true for existing session', async () => {
      await manager.saveSession('existing-session', []);
      assert.strictEqual(manager.exists('existing-session'), true);
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata for existing session', async () => {
      const sessionId = 'test-session-meta';
      await manager.saveSession(sessionId, [], { company: '公司A' });

      const result = await manager.updateMetadata(sessionId, { company: '公司B', stage: '诊断' });

      assert.strictEqual(result, true);
      const snapshot = await manager.loadSession(sessionId);
      assert.strictEqual(snapshot.metadata.company, '公司B');
      assert.strictEqual(snapshot.metadata.stage, '诊断');
    });

    it('should return false for non-existent session', async () => {
      const result = await manager.updateMetadata('non-existent', { key: 'value' });
      assert.strictEqual(result, false);
    });
  });

  describe('auto-save', () => {
    it('should start auto-save', async () => {
      const sessionId = 'auto-save-session';
      let callCount = 0;

      manager.startAutoSave(sessionId, () => {
        callCount++;
        return [{ id: `r${callCount}`, type: 'fact' }];
      });

      // 等待自动保存触发
      await new Promise(resolve => setTimeout(resolve, 1500));

      assert.ok(callCount >= 1);

      manager.stopAutoSave(sessionId);
    });

    it('should stop auto-save', async () => {
      const sessionId = 'auto-save-stop';
      let callCount = 0;

      manager.startAutoSave(sessionId, () => {
        callCount++;
        return [];
      });

      // 等待一次触发
      await new Promise(resolve => setTimeout(resolve, 1500));
      const countAfterFirst = callCount;

      manager.stopAutoSave(sessionId);

      // 再等待一段时间
      await new Promise(resolve => setTimeout(resolve, 1500));

      // callCount 不应该再增加
      assert.strictEqual(callCount, countAfterFirst);
    });
  });

  describe('cleanupExpired', () => {
    it('should cleanup expired sessions', async () => {
      // 创建一个会话
      await manager.saveSession('old-session', []);

      // 修改文件时间戳使其过期（8天前）
      const filePath = path.join(TEST_STORAGE_DIR, 'old-session.json');
      const oldTime = Date.now() - 8 * 24 * 60 * 60 * 1000;
      fs.utimesSync(filePath, new Date(oldTime), new Date(oldTime));

      // 清理 7 天以上的会话
      const cleaned = await manager.cleanupExpired(7 * 24 * 60 * 60 * 1000);

      assert.strictEqual(cleaned, 1);
      assert.strictEqual(await manager.loadSession('old-session'), null);
    });

    it('should keep non-expired sessions', async () => {
      await manager.saveSession('recent-session', []);

      // 清理 7 天以上的会话
      const cleaned = await manager.cleanupExpired(7 * 24 * 60 * 60 * 1000);

      assert.strictEqual(cleaned, 0);
      assert.ok(await manager.loadSession('recent-session'));
    });
  });
});
