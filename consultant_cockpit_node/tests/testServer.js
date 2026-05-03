// @ts-check
// tests/testServer.js — 测试用服务器构建器
const fastify = require('fastify');
const path = require('path');
const { ConsensusChain } = require('../src/core/consensusChain');
const { CandidateGenerator } = require('../src/core/candidateGen');
const { KnowledgeRetriever } = require('../src/core/knowledgeRetriever');
const { MemoGenerator } = require('../src/core/memoGenerator');
const { BattleCardGenerator } = require('../src/core/battleCardGen');
const { FallbackHandler } = require('../src/core/fallbackHandler');
const { LLMClient } = require('../src/utils/llmClient');
const { FeishuClientMock } = require('../src/integrations/feishuClient');
const { FeishuSyncMock } = require('../src/integrations/feishuSync');
const { SessionManager } = require('../src/core/sessionManager');
const { getConfig } = require('../src/utils/config');

/**
 * 构建测试服务器
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function buildServer() {
  const app = fastify({
    logger: false, // 测试时禁用日志
  });

  // 静态文件服务
  app.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/static/',
    decorateReply: false,
  });

  // 全局状态
  /** @type {Map<string, {consensusChain: ConsensusChain, candidateGen: CandidateGenerator, knowledgeRetriever: KnowledgeRetriever}>} */
  const sessions = new Map();

  /** @type {LLMClient} */
  const llmClient = new LLMClient();

  /** @type {FallbackHandler} */
  const fallbackHandler = new FallbackHandler();

  /** @type {FeishuClientMock} */
  const feishuClient = new FeishuClientMock();

  /** @type {SessionManager} */
  const sessionManager = new SessionManager({
    storageDir: path.join(__dirname, '..', 'data', 'sessions'),
    autoSaveInterval: 60000,
  });

  /**
   * 获取或创建会话
   * @param {string} sessionId
   */
  function getOrCreateSession(sessionId) {
    if (!sessions.has(sessionId)) {
      const consensusChain = new ConsensusChain({ feishuClient });
      const knowledgeRetriever = new KnowledgeRetriever();
      const candidateGen = new CandidateGenerator({
        llmClient,
        consensusChain,
        knowledgeRetriever,
        fallbackHandler,
      });

      sessions.set(sessionId, {
        consensusChain,
        candidateGen,
        knowledgeRetriever,
      });
    }

    return sessions.get(sessionId);
  }

  // ==================== API 路由 ====================

  // 健康检查
  app.get('/api/health', async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      sessions: sessions.size,
    };
  });

  // 创建会话
  app.post('/api/sessions', async (request, reply) => {
    const sessionId = require('crypto').randomUUID();
    getOrCreateSession(sessionId);

    reply.code(201);
    return {
      session_id: sessionId,
      message: 'Session created',
    };
  });

  // 获取会话状态
  app.get('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;

    if (!sessions.has(sessionId)) {
      reply.code(404);
      return { error: 'Session not found' };
    }

    const session = getOrCreateSession(sessionId);
    const records = session.consensusChain.exportRecords();

    return {
      session_id: sessionId,
      record_count: records.length,
      confirmed_facts: session.consensusChain.getConfirmedFacts().length,
      confirmed_consensus: session.consensusChain.getConfirmedConsensus().length,
      pending_consensus: session.consensusChain.getPendingConsensus().length,
    };
  });

  // 添加记录
  app.post('/api/sessions/:sessionId/records', async (request, reply) => {
    const { sessionId } = request.params;
    const session = getOrCreateSession(sessionId);

    try {
      const record = session.consensusChain.addRecord(request.body);

      reply.code(201);
      return {
        success: true,
        record,
      };
    } catch (error) {
      reply.code(400);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 确认记录
  app.post('/api/sessions/:sessionId/records/:recordId/confirm', async (request, reply) => {
    const { sessionId, recordId } = request.params;
    const session = getOrCreateSession(sessionId);

    try {
      session.consensusChain.confirmRecord(recordId);
      return { success: true };
    } catch (error) {
      reply.code(400);
      return { success: false, error: error.message };
    }
  });

  // 修正记录
  app.post('/api/sessions/:sessionId/records/:recordId/correct', async (request, reply) => {
    const { sessionId, recordId } = request.params;
    const session = getOrCreateSession(sessionId);

    try {
      const newRecord = session.consensusChain.correctRecord(recordId, request.body);
      reply.code(201);
      return { success: true, record: newRecord };
    } catch (error) {
      reply.code(400);
      return { success: false, error: error.message };
    }
  });

  // 获取已确认事实
  app.get('/api/sessions/:sessionId/facts', async (request, reply) => {
    const { sessionId } = request.params;
    const session = getOrCreateSession(sessionId);

    return {
      facts: session.consensusChain.getConfirmedFacts(),
    };
  });

  // 获取候选方案
  app.get('/api/sessions/:sessionId/candidates', async (request, reply) => {
    const { sessionId } = request.params;
    const session = getOrCreateSession(sessionId);

    try {
      const skus = session.knowledgeRetriever.getAvailableSkus();

      const constraintResult = session.candidateGen.checkConstraints(skus);
      if (!constraintResult.valid) {
        return {
          success: false,
          message: constraintResult.message,
          candidates: [],
        };
      }

      const candidates = await session.candidateGen.generateCandidates();

      return {
        success: true,
        candidates,
        cache_status: session.candidateGen.getCacheStatus(),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        candidates: [],
      };
    }
  });

  // 召回知识
  app.post('/api/sessions/:sessionId/recall', async (request, reply) => {
    const { sessionId } = request.params;
    const { keywords, top_k = 5 } = request.body || {};
    const session = getOrCreateSession(sessionId);

    if (!keywords || !Array.isArray(keywords)) {
      reply.code(400);
      return { error: 'keywords must be an array' };
    }

    const skus = session.knowledgeRetriever.recallByKeywords(keywords, top_k);

    return {
      success: true,
      skus,
      count: skus.length,
    };
  });

  // 生成备忘录
  app.post('/api/sessions/:sessionId/memo', async (request, reply) => {
    const { sessionId } = request.params;
    const session = getOrCreateSession(sessionId);

    try {
      const memoGen = new MemoGenerator({
        consensusChain: session.consensusChain,
        llmClient,
        clientProfile: request.body?.client_profile || {},
        fallbackHandler,
      });

      const structure = memoGen.generateStructure();

      return {
        success: true,
        structure,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 生成作战卡
  app.post('/api/sessions/:sessionId/battle-card', async (request, reply) => {
    const { sessionId } = request.params;
    const { company, consultant } = request.body || {};

    if (!company) {
      reply.code(400);
      return { error: 'company is required' };
    }

    try {
      const battleCardGen = new BattleCardGenerator({
        feishuClient,
        llmClient,
        knowledgeRetriever: sessions.get(sessionId)?.knowledgeRetriever,
      });

      const battleCard = await battleCardGen.generate(company, consultant);

      return {
        success: true,
        battle_card: battleCard,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 导出会话
  app.get('/api/sessions/:sessionId/export', async (request, reply) => {
    const { sessionId } = request.params;
    const session = getOrCreateSession(sessionId);

    return {
      session_id: sessionId,
      records: session.consensusChain.exportRecords(),
      exported_at: new Date().toISOString(),
    };
  });

  // 导入会话
  app.post('/api/sessions/:sessionId/import', async (request, reply) => {
    const { sessionId } = request.params;
    const { records } = request.body || {};

    if (!Array.isArray(records)) {
      reply.code(400);
      return { error: 'records must be an array' };
    }

    const session = getOrCreateSession(sessionId);
    session.consensusChain.importRecords(records);

    return {
      success: true,
      imported_count: records.length,
    };
  });

  return app;
}

module.exports = {
  buildServer,
};
