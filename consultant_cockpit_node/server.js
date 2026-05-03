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

// ==================== 自定义 Content-Type Parser ====================

// 允许 application/json 的空 body（返回空对象而非报错）
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try {
    // 空 body 返回空对象
    const json = body === '' ? {} : JSON.parse(body);
    done(null, json);
  } catch (err) {
    done(err, undefined);
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

    // 监听共识链变更，触发飞书同步
    consensusChain.on('change', async (event) => {
      if (feishuSync && event.record) {
        feishuSync.registerKnownWrite(event.record.id);
        await feishuClient.createConsensusRecord(event.record);
      }
    });
  }

  return sessions.get(sessionId);
}

// ==================== API 路由 ====================

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

  if (!isRealClient) {
    return {
      connected: false,
      reason: 'mock_mode',
      message: '使用模拟客户端（未配置飞书凭证）',
    };
  }

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
      };
    } else {
      return {
        connected: false,
        reason: 'api_error',
        message: result.msg || 'API 调用失败',
      };
    }
  } catch (error) {
    return {
      connected: false,
      reason: 'connection_error',
      message: error.message || '连接失败',
    };
  }
});

// 创建会话
fastify.post('/api/sessions', async (request, reply) => {
  const sessionId = require('crypto').randomUUID();
  getOrCreateSession(sessionId);

  reply.code(201);
  return {
    session_id: sessionId,
    message: 'Session created',
  };
});

// 获取会话状态
fastify.get('/api/sessions/:sessionId', async (request, reply) => {
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
fastify.post('/api/sessions/:sessionId/records', async (request, reply) => {
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
fastify.post('/api/sessions/:sessionId/records/:recordId/confirm', async (request, reply) => {
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
fastify.post('/api/sessions/:sessionId/records/:recordId/correct', async (request, reply) => {
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
fastify.get('/api/sessions/:sessionId/facts', async (request, reply) => {
  const { sessionId } = request.params;
  const session = getOrCreateSession(sessionId);

  return {
    facts: session.consensusChain.getConfirmedFacts(),
  };
});

// 获取候选方案
fastify.get('/api/sessions/:sessionId/candidates', async (request, reply) => {
  const { sessionId } = request.params;
  const session = getOrCreateSession(sessionId);

  try {
    // 获取可用 SKU
    const skus = session.knowledgeRetriever.getAvailableSkus();

    // 检查约束
    const constraintResult = session.candidateGen.checkConstraints(skus);
    if (!constraintResult.valid) {
      return {
        success: false,
        message: constraintResult.message,
        candidates: [],
      };
    }

    // 生成候选
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
fastify.post('/api/sessions/:sessionId/recall', async (request, reply) => {
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
fastify.post('/api/sessions/:sessionId/memo', async (request, reply) => {
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
  const session = getOrCreateSession(sessionId);

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

  const session = getOrCreateSession(sessionId);
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
  fastify.get('/ws/:sessionId', { websocket: true }, (socket, request) => {
    const { sessionId } = request.params;
    const session = getOrCreateSession(sessionId);

    fastify.log.info({ sessionId }, 'WebSocket connected');

    // 发送初始状态
    socket.send(JSON.stringify({
      type: 'init',
      data: {
        session_id: sessionId,
        records: session.consensusChain.exportRecords(),
      },
    }));

    // 监听共识链变更
    const handleChange = (event) => {
      socket.send(JSON.stringify({
        type: 'change',
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
process.on('SIGTERM', async () => {
  fastify.log.info('Received SIGTERM, shutting down...');

  // 保存所有会话
  for (const [sessionId, session] of sessions) {
    await sessionManager.saveSession(sessionId, session.consensusChain.exportRecords());
  }

  await fastify.close();
  process.exit(0);
});

start();
