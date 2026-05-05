// @ts-check
// server.js — Fastify HTTP 服务器入口
/**
 * 顾问现场作战系统 HTTP 服务器
 *
 * 功能：
 * - RESTful API 端点
 * - WebSocket 实时通信
 * - 会话管理
 * - 静态文件服务
 */

// Windows 控制台 UTF-8 编码修复（防止中文日志乱码）
if (process.platform === 'win32') {
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
  } catch (_) { /* ignore */ }
}
process.stdout.setDefaultEncoding('utf8');
process.stderr.setDefaultEncoding('utf8');

require('dotenv').config();
const fastify = require('fastify')({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  },
  // 允许空 body（用于 POST 请求不需要 body 的情况）
  bodyLimit: 1048576, // 1MB
  ignoreTrailingSlash: true,
  // 禁用 body 验证，允许空 body
  disableRequestLogging: true,
});

const path = require('path');
const { ConsensusChain } = require('./src/core/consensusChain');
const { CandidateGenerator } = require('./src/core/candidateGen');
const { KnowledgeRetriever } = require('./src/core/knowledgeRetriever');
const { MemoGenerator } = require('./src/core/memoGenerator');
const { BattleCardGenerator } = require('./src/core/battleCardGen');
const { FallbackHandler } = require('./src/core/fallbackHandler');
const { LLMClient } = require('./src/utils/llmClient');
const { FeishuClient, FeishuClientMock } = require('./src/integrations/feishuClient');
const { FeishuSync, FeishuSyncMock } = require('./src/integrations/feishuSync');
const { SessionManager } = require('./src/core/sessionManager');
const { getConfig } = require('./src/utils/config');
const { identifyGaps, getNextFollowUp, confirmedFactCount } = require('./src/core/gapIdentifier');
const { ContextBuilder, buildContext } = require('./src/core/contextBuilder');

// ==================== 自定义 Content-Type Parser ====================

// 移除默认的 JSON parser，注册自定义 parser
// 1. 允许空 body（返回空对象）
// 2. 正确处理 Content-Length
fastify.removeAllContentTypeParsers();
fastify.addContentTypeParser('*', { parseAs: 'string' }, (req, body, done) => {
  try {
    // 尝试解析 JSON
    if (body && body.trim()) {
      const json = JSON.parse(body);
      done(null, json);
    } else {
      // 空 body 返回空对象
      done(null, {});
    }
  } catch (err) {
    // JSON 解析失败，返回原始字符串
    done(null, body || {});
  }
});

// ==================== 插件注册 ====================

// WebSocket 支持
fastify.register(require('@fastify/websocket'));

// 静态文件服务
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/static/',
});

// 根路径指向 index.html
fastify.get('/', async (request, reply) => {
  return reply.sendFile('index.html');
});

// ==================== 全局状态 ====================

/** @type {Map<string, {consensusChain: ConsensusChain, candidateGen: CandidateGenerator, knowledgeRetriever: KnowledgeRetriever}>} */
const sessions = new Map();

/** @type {Map<string, WebSocket>} WebSocket 客户端映射（sessionId -> socket） */
const wsClients = new Map();

/** @type {LLMClient} */
const llmClient = new LLMClient();

/** @type {FallbackHandler} */
const fallbackHandler = new FallbackHandler();

/** @type {import('./src/integrations/feishuClient').FeishuClient|FeishuClientMock} */
let feishuClient;

/** @type {import('./src/integrations/feishuSync').FeishuSync|FeishuSyncMock} */
let feishuSync;

/** @type {SessionManager} */
let sessionManager;

// ==================== 初始化 ====================

async function initialize() {
  const config = getConfig();

  // 初始化飞书客户端
  // 检测是否是占位符配置（以 'your_' 开头）
  const isPlaceholder = (val) => val && val.startsWith('your_');
  const hasRealConfig = config.feishu.appId &&
                        config.feishu.appSecret &&
                        !isPlaceholder(config.feishu.appId) &&
                        !isPlaceholder(config.feishu.appSecret);

  if (hasRealConfig) {
    feishuClient = new FeishuClient({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      bitableToken: config.feishu.bitableToken,
      consensusTableId: config.feishu.consensusTableId,
      profileTableId: config.feishu.profileTableId,
    });

    feishuSync = new FeishuSync({ feishuClient });
    // 监听错误事件，防止进程崩溃
    feishuSync.on('error', (err) => {
      fastify.log.warn('FeishuSync error (non-fatal):', err.message);
    });
    // 监听飞书变更事件，广播给所有 WebSocket 客户端
    feishuSync.on('change', (changeEvent) => {
      const { table_type, company, record_id, change_type, data } = changeEvent;

      fastify.log.info({ table_type, company, record_id, change_type }, 'Feishu change event received');

      // 广播给所有连接的 WebSocket 客户端
      for (const [sessionId, wsClient] of wsClients) {
        if (wsClient && wsClient.readyState === 1) { // WebSocket.OPEN
          wsClient.send(JSON.stringify({
            type: table_type === 'profile' ? 'profile_changed' : 'feishu_record_changed',
            data: {
              table_type,
              company,
              record_id,
              change_type,
              record: data,
            },
          }));
        }
      }
    });
    // 非阻塞启动，失败时优雅降级
    feishuSync.start().catch(err => {
      fastify.log.warn('FeishuSync start failed, sync disabled:', err.message);
    });
  } else {
    // 使用 Mock（开发/测试环境）
    fastify.log.info('Using Mock Feishu clients (placeholder config detected)');
    feishuClient = new FeishuClientMock();
    feishuSync = new FeishuSyncMock();
  }

  // 初始化会话管理器
  sessionManager = new SessionManager({
    storageDir: config.session.storageDir,
    autoSaveInterval: config.session.autoSaveInterval,
  });

  fastify.log.info('Server initialized');
}

// ==================== 会话管理辅助函数 ====================

/**
 * 获取或创建会话
 * @param {string} sessionId
 * @returns {{consensusChain: ConsensusChain, candidateGen: CandidateGenerator, knowledgeRetriever: KnowledgeRetriever}}
 */
async function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    const consensusChain = new ConsensusChain({ feishuClient });
    const knowledgeRetriever = new KnowledgeRetriever();
    const candidateGen = new CandidateGenerator({
      llmClient,
      consensusChain,
      knowledgeRetriever,
      fallbackHandler,
    });

    // 用于恢复的状态（在 session 创建后设置）
    let restoredCompany = null;
    let restoredStage = '战略梳理'; // 默认阶段

    // 尝试从文件系统恢复会话数据
    try {
      const savedSession = await sessionManager.loadSession(sessionId);
      if (savedSession && savedSession.records && savedSession.records.length > 0) {
        consensusChain.importRecords(savedSession.records);
        fastify.log.info({ sessionId, recordCount: savedSession.records.length }, 'Session restored from disk');
      }
      // 恢复公司名
      if (savedSession && savedSession.metadata && savedSession.metadata.company) {
        restoredCompany = savedSession.metadata.company;
      }
      // 恢复当前阶段
      if (savedSession && savedSession.metadata && savedSession.metadata.currentStage) {
        restoredStage = savedSession.metadata.currentStage;
      }
    } catch (error) {
      fastify.log.warn({ sessionId, error: error.message }, 'Failed to restore session from disk');
    }

    const session = {
      consensusChain,
      candidateGen,
      knowledgeRetriever,
      company: restoredCompany, // 恢复公司名
      currentStage: restoredStage, // 恢复当前阶段
    };

    sessions.set(sessionId, session);

    // 启动候选预计算（设计文档 3.2 节：后台预计算，/候选 指令 0.2 秒响应）
    const initialSkus = knowledgeRetriever.getFreshSkus();
    candidateGen.startBackgroundPrecompute(initialSkus, 30); // 30秒检查间隔

    if (restoredCompany) {
      fastify.log.info({ sessionId, company: restoredCompany }, 'Company restored from disk');
    }
    if (restoredStage !== '战略梳理') {
      fastify.log.info({ sessionId, currentStage: restoredStage }, 'Stage restored from disk');
    }

    // 监听共识链变更（用于自动保存 + 触发候选重算）
    // 飞书同步由 consensusChain 内部处理：
    // - addRecord(syncToFeishu=false) → /记 不同步
    // - confirmRecord() → /确认 自动同步
    consensusChain.on('change', async (event) => {
      if (!event.record) return;
      // 飞书同步已在 consensusChain 内部完成，此处不做重复调用

      // 触发候选预计算重算（共识链变化时）
      const currentSkus = knowledgeRetriever.getFreshSkus();
      candidateGen.checkAndPrecompute(currentSkus).catch(e => {
        fastify.log.warn({ sessionId, error: e.message }, 'Candidate precompute failed');
      });

      // 自动保存会话到文件系统（包含 metadata 如公司名、当前阶段）
      try {
        const currentSession = sessions.get(sessionId);
        const metadata = {};
        if (currentSession?.company) metadata.company = currentSession.company;
        if (currentSession?.currentStage) metadata.currentStage = currentSession.currentStage;
        await sessionManager.saveSession(sessionId, consensusChain.exportRecords(), metadata);
      } catch (error) {
        fastify.log.warn({ sessionId, error: error.message }, 'Auto-save failed');
      }
    });

    // 监听候选预计算完成事件，通过 WebSocket 通知前端
    candidateGen.on('precompute-done', ({ candidates }) => {
      const wsClient = wsClients.get(sessionId);
      if (wsClient && wsClient.readyState === 1) {
        wsClient.send(JSON.stringify({
          type: 'candidates_ready',
          candidates,
        }));
      }
    });
  }

  return sessions.get(sessionId);
}

// ==================== API 路由 ====================

// 获取会话列表（用于页面刷新后恢复最近会话）
fastify.get('/api/sessions', async (request, reply) => {
  try {
    const sessionsList = await sessionManager.listSessions();
    return {
      success: true,
      sessions: sessionsList,
    };
  } catch (error) {
    return {
      success: false,
      sessions: [],
      error: error.message,
    };
  }
});

// 健康检查
fastify.get('/api/health', async (request, reply) => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    sessions: sessions.size,
  };
});

// 飞书连接状态
fastify.get('/api/feishu-status', async (request, reply) => {
  // 检查是否使用真实飞书客户端
  const isRealClient = feishuClient && !(feishuClient instanceof FeishuClientMock);
  const isRealSync = feishuSync && !(feishuSync instanceof FeishuSyncMock);

  if (!isRealClient) {
    return {
      connected: false,
      reason: 'mock_mode',
      message: '使用模拟客户端（未配置飞书凭证）',
      sync_mode: 'none',
    };
  }

  // 获取同步状态（WebSocket 或轮询）
  const syncStatus = isRealSync ? feishuSync.getStatus() : null;
  const syncMode = syncStatus?.mode || 'none';
  const syncLatency = syncMode === 'websocket' ? '< 1秒' : syncMode === 'polling' ? '30秒' : '未知';

  try {
    // 尝试访问多维表格来验证连接
    const result = await feishuClient.client.bitable.appTableRecord.list({
      path: {
        app_token: feishuClient.bitableToken,
        table_id: feishuClient.consensusTableId,
      },
      params: { page_size: 1 },
    });

    if (result.code === 0) {
      return {
        connected: true,
        message: '已连接',
        bitable_accessible: true,
        sync_mode: syncMode,
        sync_latency: syncLatency,
        sync_stats: syncStatus?.stats || null,
      };
    } else {
      return {
        connected: false,
        reason: 'api_error',
        message: result.msg || 'API 调用失败',
        sync_mode: syncMode,
      };
    }
  } catch (error) {
    return {
      connected: false,
      reason: 'connection_error',
      message: error.message || '连接失败',
      sync_mode: syncMode,
    };
  }
});

// 创建会话
fastify.post('/api/sessions', async (request, reply) => {
  const sessionId = require('crypto').randomUUID();
  const { company } = request.body || {};

  const session = await getOrCreateSession(sessionId);

  // 存储公司名到会话中
  if (company) {
    session.company = company;
    // 立即保存公司名到 metadata
    await sessionManager.saveSession(sessionId, session.consensusChain.exportRecords(), { company });
  }

  reply.code(201);
  return {
    session_id: sessionId,
    message: 'Session created',
    company: session.company || null,
  };
});

// 更新会话的公司名
fastify.patch('/api/sessions/:sessionId/company', async (request, reply) => {
  const { sessionId } = request.params;
  const { company } = request.body || {};

  if (!sessions.has(sessionId)) {
    reply.code(404);
    return { error: 'Session not found' };
  }

  const session = await getOrCreateSession(sessionId);

  if (company) {
    session.company = company;
    // 立即保存公司名到 metadata
    await sessionManager.saveSession(sessionId, session.consensusChain.exportRecords(), { company });
    return { success: true, company };
  } else {
    reply.code(400);
    return { error: 'company is required' };
  }
});

// 更新会话的当前阶段
const VALID_STAGES = ['战略梳理', '商业模式', '行业演示'];
fastify.patch('/api/sessions/:sessionId/stage', async (request, reply) => {
  const { sessionId } = request.params;
  const { stage } = request.body || {};

  if (!sessions.has(sessionId)) {
    reply.code(404);
    return { error: 'Session not found' };
  }

  if (!stage || !VALID_STAGES.includes(stage)) {
    reply.code(400);
    return { error: `无效阶段: ${stage}，可选: ${VALID_STAGES.join(', ')}` };
  }

  const session = await getOrCreateSession(sessionId);

  // 更新阶段
  session.currentStage = stage;

  // 触发候选缓存失效并立即重算（设计文档 3.2.4 节：阶段切换立即重算）
  session.candidateGen.invalidateCache();
  const currentSkus = session.knowledgeRetriever.getFreshSkus();
  session.candidateGen.checkAndPrecompute(currentSkus, { immediate: true, source: 'stage_switch' }).catch(e => {
    fastify.log.warn({ sessionId, error: e.message }, 'Stage switch precompute failed');
  });

  // 立即保存到 metadata
  const metadata = { currentStage: stage };
  if (session.company) metadata.company = session.company;
  await sessionManager.saveSession(sessionId, session.consensusChain.exportRecords(), metadata);

  fastify.log.info({ sessionId, stage }, 'Stage switched');

  return { success: true, current_stage: stage };
});

// 获取会话状态
fastify.get('/api/sessions/:sessionId', async (request, reply) => {
  const { sessionId } = request.params;

  if (!sessions.has(sessionId)) {
    reply.code(404);
    return { error: 'Session not found' };
  }

  const session = await getOrCreateSession(sessionId);
  const records = session.consensusChain.exportRecords();

  // 计算完整度（基于已确认的事实覆盖的字段数）
  const confirmedFacts = session.consensusChain.getConfirmedFacts();
  const { getCompletenessFieldNames } = require('./src/config/fields');
  const fieldNames = getCompletenessFieldNames();
  const fieldsStatus = {};
  for (const name of fieldNames) {
    const hasConfirmed = confirmedFacts.some(f =>
      typeof f.content === 'string' && f.content.includes(name)
    );
    const hasPartial = records.some(r =>
      typeof r.content === 'string' && r.content.includes(name)
    );
    fieldsStatus[name] = hasConfirmed ? 'confirmed' : hasPartial ? 'partial' : 'empty';
  }
  const filledCount = Object.values(fieldsStatus).filter(s => s !== 'empty').length;
  const completeness = Math.round((filledCount / fieldNames.length) * 100);

  return {
    session_id: sessionId,
    records,
    record_count: records.length,
    completeness,
    fields_status: fieldsStatus,
    current_stage: session.currentStage || '战略梳理',
    confirmed_facts: confirmedFacts.length,
    confirmed_consensus: session.consensusChain.getConfirmedConsensus().length,
    pending_consensus: session.consensusChain.getPendingConsensus().length,
    company: session.company || null,
  };
});

// 添加记录
fastify.post('/api/sessions/:sessionId/records', async (request, reply) => {
  const { sessionId } = request.params;
  const session = await getOrCreateSession(sessionId);

  try {
    // 传递 company 用于同步到客户档案表（当记录直接创建为 confirmed 状态时）
    const record = session.consensusChain.addRecord(request.body, {
      syncToFeishu: true,
      company: session.company
    });

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

// 确认记录（指定 ID）
fastify.post('/api/sessions/:sessionId/records/:recordId/confirm', async (request, reply) => {
  const { sessionId, recordId } = request.params;
  const session = await getOrCreateSession(sessionId);

  try {
    // 传递公司名给 confirmRecord，用于同步到客户档案表
    session.consensusChain.confirmRecord(recordId, session.company);
    return { success: true, company: session.company || null };
  } catch (error) {
    reply.code(400);
    return { success: false, error: error.message };
  }
});

// 确认记录（智能选择：有 record_id 用指定的，否则确认最新 pending 记录）
fastify.post('/api/sessions/:sessionId/confirm', async (request, reply) => {
  const { sessionId } = request.params;
  const session = await getOrCreateSession(sessionId);
  const { record_id, company } = request.body || {};

  // 如果请求中包含公司名，更新会话的公司名
  if (company) {
    session.company = company;
  }

  try {
    let targetId = record_id;

    if (!targetId) {
      // 找最新一条 pending_client_confirm 的记录
      const pending = session.consensusChain.records
        .filter(r => r.status === 'pending_client_confirm')
        .pop();
      if (!pending) {
        reply.code(404);
        return { success: false, error: '没有待确认的记录' };
      }
      targetId = pending.id;
    }

    // 传递公司名给 confirmRecord，用于同步到客户档案表
    session.consensusChain.confirmRecord(targetId, session.company);
    return { success: true, confirmed_id: targetId, company: session.company || null };
  } catch (error) {
    reply.code(400);
    return { success: false, error: error.message };
  }
});

// 修正记录
fastify.post('/api/sessions/:sessionId/records/:recordId/correct', async (request, reply) => {
  const { sessionId, recordId } = request.params;
  const session = await getOrCreateSession(sessionId);

  try {
    const content = request.body.content || request.body;
    // 传递 company 用于同步到客户档案表
    const newRecord = session.consensusChain.correctRecord(recordId, content, { company: session.company });
    reply.code(201);
    return { success: true, record: newRecord, company: session.company || null };
  } catch (error) {
    reply.code(400);
    return { success: false, error: error.message };
  }
});

// 获取已确认事实
fastify.get('/api/sessions/:sessionId/facts', async (request, reply) => {
  const { sessionId } = request.params;
  const session = await getOrCreateSession(sessionId);

  return {
    facts: session.consensusChain.getConfirmedFacts(),
  };
});

// 获取候选方案
fastify.get('/api/sessions/:sessionId/candidates', async (request, reply) => {
  const { sessionId } = request.params;
  const session = await getOrCreateSession(sessionId);

  try {
    // 获取可用 SKU（使用 getFreshSkus 获取缓存中 3 分钟内的 SKU）
    const skus = session.knowledgeRetriever.getFreshSkus();

    // 检查约束
    const constraintResult = session.candidateGen.checkConstraints(skus);
    if (!constraintResult.valid) {
      return {
        success: false,
        message: constraintResult.message,
        candidates: [],
      };
    }

    // 优先使用缓存（设计文档 3.2 节：预计算缓存命中时 0.2 秒响应）
    let candidates = session.candidateGen.getCachedCandidates();
    let cacheHit = true;

    if (!candidates) {
      // 缓存未命中，实时生成
      cacheHit = false;
      fastify.log.info({ sessionId }, 'Cache miss, generating candidates...');
      candidates = await session.candidateGen.generateCandidates();
      // 保存到缓存，避免下次重复生成
      session.candidateGen._cache.set(candidates);
      fastify.log.info({ sessionId, candidateCount: candidates.length }, 'Candidates generated and cached');
    } else {
      fastify.log.info({ sessionId, candidateCount: candidates.length }, 'Cache hit');
    }

    return {
      success: true,
      candidates,
      cache_status: session.candidateGen.getCacheStatus(),
      cache_hit: cacheHit,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      candidates: [],
    };
  }
});

// ==================== Stage 6: 追问建议与缺口识别 ====================

// 获取信息缺口
fastify.get('/api/sessions/:sessionId/gaps', async (request, reply) => {
  const { sessionId } = request.params;
  const session = await getOrCreateSession(sessionId);

  try {
    const records = session.consensusChain.records;
    const hypotheses = session.hypotheses || [];
    const gaps = identifyGaps(records, hypotheses);

    return {
      success: true,
      gaps,
      factCount: confirmedFactCount(records),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      gaps: [],
    };
  }
});

// 获取下一条追问建议
fastify.get('/api/sessions/:sessionId/next-follow-up', async (request, reply) => {
  const { sessionId } = request.params;
  const session = await getOrCreateSession(sessionId);

  try {
    const records = session.consensusChain.records;
    const hypotheses = session.hypotheses || [];
    const suggestion = getNextFollowUp(records, hypotheses);

    return {
      success: true,
      suggestion,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      suggestion: null,
    };
  }
});

// 获取结构化上下文（供候选生成、备忘录等使用）
fastify.get('/api/sessions/:sessionId/context', async (request, reply) => {
  const { sessionId } = request.params;
  const { caller = 'suggestion' } = request.query;
  const session = await getOrCreateSession(sessionId);

  try {
    const context = buildContext({
      records: session.consensusChain.records,
      clientProfile: session.clientProfile || {},
      hypotheses: session.hypotheses || [],
      currentStage: session.consensusChain.currentStage,
    }, caller);

    return {
      success: true,
      context,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      context: null,
    };
  }
});

// 召回知识
fastify.post('/api/sessions/:sessionId/recall', async (request, reply) => {
  const { sessionId } = request.params;
  const { keywords, top_k = 5 } = request.body || {};
  const session = await getOrCreateSession(sessionId);

  if (!keywords || !Array.isArray(keywords)) {
    reply.code(400);
    return { error: 'keywords must be an array' };
  }

  const skus = session.knowledgeRetriever.recallByKeywords(keywords, top_k);

  // 通知候选生成器 SKU 变化（设计文档 3.2.4 节：SKU 变化触发缓存过期）
  if (skus && skus.length > 0) {
    session.candidateGen.notifySkuChange(skus).catch(e => {
      fastify.log.warn({ sessionId, error: e.message }, 'SKU change notification failed');
    });
  }

  return {
    success: true,
    skus,
    count: skus.length,
  };
});

// 生成备忘录
fastify.post('/api/sessions/:sessionId/memo', async (request, reply) => {
  const { sessionId } = request.params;
  const session = await getOrCreateSession(sessionId);

  try {
    const memoGen = new MemoGenerator({
      consensusChain: session.consensusChain,
      llmClient,
      clientProfile: request.body?.client_profile || {},
      fallbackHandler,
    });

    const structure = memoGen.generateStructure();

    // 生成 Word 文档
    const outputPath = path.join(
      getConfig().session.storageDir,
      'memos',
      `${sessionId}_${Date.now()}.docx`
    );

    await memoGen.generateWord(outputPath);

    return {
      success: true,
      structure,
      file_path: outputPath,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

// 生成作战卡
fastify.post('/api/sessions/:sessionId/battle-card', async (request, reply) => {
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

    // 生成 Word 文档
    const buffer = await battleCardGen.renderToWord(battleCard);
    const filename = `battle_card_${company}_${Date.now()}.docx`;

    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

    return buffer;
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

// 导出会话
fastify.get('/api/sessions/:sessionId/export', async (request, reply) => {
  const { sessionId } = request.params;
  const session = await getOrCreateSession(sessionId);

  return {
    session_id: sessionId,
    records: session.consensusChain.exportRecords(),
    exported_at: new Date().toISOString(),
  };
});

// 导入会话
fastify.post('/api/sessions/:sessionId/import', async (request, reply) => {
  const { sessionId } = request.params;
  const { records } = request.body || {};

  if (!Array.isArray(records)) {
    reply.code(400);
    return { error: 'records must be an array' };
  }

  const session = await getOrCreateSession(sessionId);
  session.consensusChain.importRecords(records);

  return {
    success: true,
    imported_count: records.length,
  };
});

// ==================== 演示模式 API ====================

/** @type {{level: number, enabled: boolean}} */
let demoModeState = {
  level: 0,
  enabled: false
};

// 获取演示模式状态
fastify.get('/api/demo-mode', async (request, reply) => {
  return {
    level: demoModeState.level,
    enabled: demoModeState.enabled,
    name: ['关闭', '隐藏', '替换', '保留'][demoModeState.level]
  };
});

// 设置演示模式
fastify.post('/api/demo-mode', async (request, reply) => {
  const { level } = request.body || {};

  if (typeof level !== 'number' || level < 0 || level > 3) {
    reply.code(400);
    return { error: 'level must be 0, 1, 2, or 3' };
  }

  demoModeState = {
    level,
    enabled: level > 0
  };

  // 广播 WebSocket 事件
  for (const [sessionId, session] of sessions) {
    session.consensusChain.emit('demo:change', demoModeState);
  }

  return {
    success: true,
    level: demoModeState.level,
    enabled: demoModeState.enabled
  };
});

// ==================== 降级报告 API ====================

// 获取降级报告
fastify.get('/api/fallback/report', async (request, reply) => {
  return fallbackHandler.getFallbackReport();
});

// 重试本地缓存
fastify.post('/api/fallback/retry', async (request, reply) => {
  const cache = fallbackHandler.getLocalCache();
  let retried = 0;
  let succeeded = 0;

  for (const item of cache) {
    retried++;
    try {
      if (item.operation === 'consensus_record') {
        await feishuClient.createConsensusRecord(item.data);
        succeeded++;
      }
    } catch (error) {
      fastify.log.error({ error: error.message }, 'Retry failed');
    }
  }

  if (succeeded === retried) {
    fallbackHandler.clearLocalCache();
  }

  return { retried, succeeded };
});

// ==================== WebSocket 路由 ====================

fastify.register(async function (fastify) {
  fastify.get('/ws/:sessionId', { websocket: true }, async (socket, request) => {
    const { sessionId } = request.params;
    const session = await getOrCreateSession(sessionId);

    fastify.log.info({ sessionId }, 'WebSocket connected');

    // 维护 wsClients 映射（用于候选预计算完成通知）
    wsClients.set(sessionId, socket);

    // 发送初始状态
    socket.send(JSON.stringify({
      type: 'init',
      data: {
        session_id: sessionId,
        records: session.consensusChain.exportRecords(),
      },
    }));

    // 监听共识链变更，发送前端期望的事件类型
    const handleChange = (event) => {
      const eventType = event.type === 'add' ? 'record_added'
        : event.type === 'confirm' ? 'record_confirmed'
        : event.type === 'correct' ? 'record_corrected'
        : 'record_added';
      socket.send(JSON.stringify({
        type: eventType,
        data: event,
      }));
    };

    session.consensusChain.on('change', handleChange);

    // 处理客户端消息
    socket.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        // 可以在这里处理客户端发来的命令
        fastify.log.debug({ data }, 'WebSocket message received');
      } catch (error) {
        fastify.log.error({ error: error.message }, 'Failed to parse WebSocket message');
      }
    });

    // 清理
    socket.on('close', () => {
      session.consensusChain.off('change', handleChange);
      wsClients.delete(sessionId); // 清理 WebSocket 客户端映射
      fastify.log.info({ sessionId }, 'WebSocket disconnected');
    });
  });
});

// ==================== 启动服务器 ====================

async function start() {
  try {
    await initialize();

    const config = getConfig();
    const address = await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    fastify.log.info(`Server listening on ${address}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

// 优雅关闭
async function gracefulShutdown(signal) {
  fastify.log.info(`Received ${signal}, shutting down...`);

  // 保存所有会话
  for (const [sessionId, session] of sessions) {
    try {
      await sessionManager.saveSession(sessionId, session.consensusChain.exportRecords());
      fastify.log.info({ sessionId }, 'Session saved');
    } catch (error) {
      fastify.log.error({ sessionId, error: error.message }, 'Failed to save session');
    }
  }

  await fastify.close();
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();
