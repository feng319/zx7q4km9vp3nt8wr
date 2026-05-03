// @ts-check
// tests/feishuSync.test.js — 飞书同步测试
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { FeishuSyncMock } = require('../src/integrations/feishuSync');
const { FeishuClientMock } = require('../src/integrations/feishuClient');

describe('FeishuSync', () => {
  /** @type {FeishuSyncMock} */
  let sync;
  /** @type {FeishuClientMock} */
  let client;

  beforeEach(() => {
    client = new FeishuClientMock();
    sync = new FeishuSyncMock();
  });

  afterEach(() => {
    sync.stop();
  });

  describe('start/stop', () => {
    it('should start and emit connected event', async () => {
      let connected = false;
      sync.on('connected', () => {
        connected = true;
      });

      const result = await sync.start();

      assert.strictEqual(result, true);
      assert.strictEqual(connected, true);

      const status = sync.getStatus();
      assert.strictEqual(status.status, 'connected');
    });

    it('should stop and emit disconnected event', async () => {
      await sync.start();

      let disconnected = false;
      sync.on('disconnected', () => {
        disconnected = true;
      });

      sync.stop();

      const status = sync.getStatus();
      assert.strictEqual(status.status, 'disconnected');
    });
  });

  describe('registerKnownWrite', () => {
    it('should register known write without error', () => {
      // Mock 版本不执行实际操作，但不应抛出错误
      assert.doesNotThrow(() => {
        sync.registerKnownWrite('record_123');
      });
    });
  });

  describe('forceSync', () => {
    it('should return success with empty records', async () => {
      const result = await sync.forceSync();

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.records, []);
    });

    it('should accept company parameter', async () => {
      const result = await sync.forceSync('测试公司');

      assert.strictEqual(result.success, true);
    });
  });

  describe('getStatus', () => {
    it('should return initial status', () => {
      const status = sync.getStatus();

      assert.strictEqual(status.status, 'disconnected');
      assert.strictEqual(status.stats.reconnectCount, 0);
      assert.strictEqual(status.stats.changeCount, 0);
      assert.strictEqual(status.snapshotSize, 0);
    });

    it('should return connected status after start', async () => {
      await sync.start();

      const status = sync.getStatus();

      assert.strictEqual(status.status, 'connected');
      assert.ok(status.stats.connectedTime);
    });
  });

  describe('clearCache', () => {
    it('should clear cache without error', () => {
      assert.doesNotThrow(() => {
        sync.clearCache();
      });
    });
  });

  describe('events', () => {
    it('should emit connected event on start', async () => {
      let eventFired = false;
      sync.on('connected', () => {
        eventFired = true;
      });

      await sync.start();

      assert.strictEqual(eventFired, true);
    });

    it('should emit disconnected event on stop', async () => {
      await sync.start();

      let eventFired = false;
      sync.on('disconnected', () => {
        eventFired = true;
      });

      sync.stop();

      // Mock 是同步的，所以事件应该立即触发
      assert.strictEqual(eventFired, true);
    });
  });
});
