// @ts-check
// tests/server.test.js — HTTP 服务器集成测试
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// 测试前确保目录存在
const dataDir = path.join(__dirname, '..', 'data', 'sessions');
const publicDir = path.join(__dirname, '..', 'public');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

describe('Server Integration', () => {
  /** @type {import('fastify').FastifyInstance} */
  let fastify;

  before(async () => {
    // 动态导入服务器模块
    const { buildServer } = require('./testServer');
    fastify = await buildServer();
    await fastify.ready();
  });

  after(async () => {
    if (fastify) {
      await fastify.close();
    }
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/health',
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.status, 'ok');
      assert.ok(body.timestamp);
      assert.strictEqual(typeof body.sessions, 'number');
    });
  });

  describe('Session Management', () => {
    it('should create a new session', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/sessions',
      });

      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.ok(body.session_id);
      assert.strictEqual(body.message, 'Session created');
    });

    it('should get session state', async () => {
      // 先创建会话
      const createResponse = await fastify.inject({
        method: 'POST',
        url: '/api/sessions',
      });
      const { session_id } = JSON.parse(createResponse.body);

      // 获取状态
      const response = await fastify.inject({
        method: 'GET',
        url: `/api/sessions/${session_id}`,
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.session_id, session_id);
      assert.strictEqual(typeof body.record_count, 'number');
    });

    it('should return 404 for non-existent session', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/sessions/non-existent-id',
      });

      assert.strictEqual(response.statusCode, 404);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'Session not found');
    });
  });

  describe('Record Operations', () => {
    /** @type {string} */
    let sessionId;

    before(async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/sessions',
      });
      sessionId = JSON.parse(response.body).session_id;
    });

    it('should add a record', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/records`,
        payload: {
          type: 'fact',
          stage: '战略梳理',
          content: '测试事实内容',
          source: 'manual',
        },
      });

      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
      assert.ok(body.record);
      assert.strictEqual(body.record.type, 'fact');
    });

    it('should confirm a record', async () => {
      // 先添加记录
      const addResponse = await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/records`,
        payload: {
          type: 'fact',
          content: '待确认事实',
        },
      });
      const recordId = JSON.parse(addResponse.body).record.id;

      // 确认记录
      const response = await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/records/${recordId}/confirm`,
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
    });

    it('should correct a record', async () => {
      // 先添加记录
      const addResponse = await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/records`,
        payload: {
          type: 'fact',
          content: '原始内容',
        },
      });
      const recordId = JSON.parse(addResponse.body).record.id;

      // 修正记录
      const response = await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/records/${recordId}/correct`,
        payload: {
          content: '修正后的内容',
        },
      });

      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
      assert.ok(body.record);
    });
  });

  describe('Knowledge Recall', () => {
    /** @type {string} */
    let sessionId;

    before(async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/sessions',
      });
      sessionId = JSON.parse(response.body).session_id;
    });

    it('should recall knowledge by keywords', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/recall`,
        payload: {
          keywords: ['战略', '商业模式'],
          top_k: 5,
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.skus));
    });

    it('should return 400 for invalid keywords', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/recall`,
        payload: {
          keywords: 'not-an-array',
        },
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'keywords must be an array');
    });
  });

  describe('Export/Import', () => {
    /** @type {string} */
    let sessionId;

    before(async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/sessions',
      });
      sessionId = JSON.parse(response.body).session_id;

      // 添加一些记录
      await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/records`,
        payload: { type: 'fact', content: '事实1' },
      });
      await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/records`,
        payload: { type: 'consensus', content: '共识1' },
      });
    });

    it('should export session', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/export`,
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.session_id, sessionId);
      assert.ok(Array.isArray(body.records));
      assert.ok(body.exported_at);
    });

    it('should import records', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/import`,
        payload: {
          records: [
            { type: 'fact', content: '导入事实1' },
            { type: 'fact', content: '导入事实2' },
          ],
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.imported_count, 2);
    });

    it('should return 400 for invalid import data', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/import`,
        payload: {
          records: 'not-an-array',
        },
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'records must be an array');
    });
  });

  describe('Facts Endpoint', () => {
    /** @type {string} */
    let sessionId;

    before(async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/sessions',
      });
      sessionId = JSON.parse(response.body).session_id;
    });

    it('should return confirmed facts', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/facts`,
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body.facts));
    });
  });

  describe('Candidates Endpoint', () => {
    /** @type {string} */
    let sessionId;

    before(async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/sessions',
      });
      sessionId = JSON.parse(response.body).session_id;
    });

    it('should return candidates or constraint message', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/candidates`,
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      // 可能返回成功或约束检查失败
      assert.ok(body.success !== undefined);
      assert.ok(Array.isArray(body.candidates));
    });
  });

  describe('Battle Card Endpoint', () => {
    /** @type {string} */
    let sessionId;

    before(async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/sessions',
      });
      sessionId = JSON.parse(response.body).session_id;
    });

    it('should return 400 when company is missing', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/battle-card`,
        payload: {},
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, 'company is required');
    });
  });
});