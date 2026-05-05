// @ts-check
/**
 * 降级处理器
 *
 * 根据设计文档 11.3 节实现：
 * - 飞书API失败降级
 * - LLM超时降级
 * - 知识库召回失败降级
 * - 统一降级统计
 */

const fs = require('fs');
const path = require('path');

/**
 * 降级类型枚举
 * @readonly
 * @enum {string}
 */
const FallbackType = {
  FEISHU_API: 'feishu_api',
  LARK_CLI: 'lark_cli',
  LLM_TIMEOUT: 'llm_timeout',
  KNOWLEDGE_RECALL: 'knowledge_recall',
  WORD_GENERATION: 'word_generation'
};

/**
 * 降级结果
 * @typedef {Object} FallbackResult
 * @property {boolean} success - 是否成功（降级也算成功）
 * @property {string} fallback_type - 降级类型
 * @property {string} message - 消息
 * @property {Object|null} data - 附加数据
 * @property {string|null} original_error - 原始错误信息
 * @property {string} timestamp - 时间戳
 */

/**
 * 创建降级结果对象
 * @param {Object} options
 * @param {boolean} options.success
 * @param {string} options.fallbackType
 * @param {string} options.message
 * @param {Object|null} [options.data]
 * @param {string|null} [options.originalError]
 * @returns {FallbackResult}
 */
function createFallbackResult({ success, fallbackType, message, data = null, originalError = null }) {
  return {
    success,
    fallback_type: fallbackType,
    message,
    data,
    original_error: originalError,
    timestamp: new Date().toISOString()
  };
}

/**
 * 预定义的降级模板
 * @type {Object<string, string>}
 */
const FALLBACK_TEMPLATES = {
  diagnosis_hypothesis: "基于行业经验，客户的核心问题需要进一步诊断确认。",

  strategy_questions: `1. 您现在的核心业务是什么？
2. 未来3年的战略目标是什么？
3. 目前最大的挑战是什么？`,

  business_questions: `1. 主要收入来源是什么？
2. 哪块业务最赚钱？
3. 商业模式有什么特点？`,

  demo_scripts: `A. 行业案例待补充
B. 行业案例待补充
C. 行业案例待补充`,

  risk_responses: `▸ 客户说"我们已经有方向了"
  → 那您觉得现在最大的执行障碍是什么？
▸ 客户问超出范围的问题
  → 这是关键问题，列入下阶段专项研究，一周内回复`
};

/**
 * 获取降级模板
 * @param {string} templateName - 模板名称
 * @returns {string} 模板内容，如果不存在返回空字符串
 */
function getFallbackTemplate(templateName) {
  return FALLBACK_TEMPLATES[templateName] || '';
}

/**
 * 统一降级处理器
 *
 * 处理以下场景的降级：
 * 1. 飞书API失败 → 本地缓存 + 提示手动同步
 * 2. LLM超时 → 模板填充 / 跳过润色
 * 3. 知识库召回失败 → 手动搜索指令
 * 4. Word生成失败 → 纯文本输出
 */
class FallbackHandler {
  /**
   * 本地缓存文件路径
   * @type {string}
   * @static
   */
  static LOCAL_CACHE_FILE = 'logs/feishu_local_cache.json';

  /**
   * @param {number} [maxWorkers=3] - 线程池最大工作线程数（Node.js 中用于并发控制）
   */
  constructor(maxWorkers = 3) {
    /**
     * 各类型降级计数
     * @type {Object<string, number>}
     * @private
     */
    this._fallbackCounts = {
      [FallbackType.FEISHU_API]: 0,
      [FallbackType.LARK_CLI]: 0,
      [FallbackType.LLM_TIMEOUT]: 0,
      [FallbackType.KNOWLEDGE_RECALL]: 0,
      [FallbackType.WORD_GENERATION]: 0
    };

    /**
     * 降级历史记录
     * @type {FallbackResult[]}
     * @private
     */
    this._fallbackHistory = [];

    /**
     * 最大并发数
     * @type {number}
     * @private
     */
    this._maxWorkers = maxWorkers;

    /**
     * 本地缓存数据
     * @type {Object[]}
     * @private
     */
    this._localCache = this._loadLocalCache();

    /**
     * 重试队列（内存中的待重试操作）
     * @type {Object[]}
     * @private
     */
    this._retryQueue = [];

    /**
     * 是否正在处理重试队列
     * @type {boolean}
     * @private
     */
    this._isProcessingQueue = false;
  }

  /**
   * 加载本地缓存
   * @returns {Object[]} 缓存数据
   * @private
   */
  _loadLocalCache() {
    const cacheFile = path.resolve(FallbackHandler.LOCAL_CACHE_FILE);
    if (fs.existsSync(cacheFile)) {
      try {
        const content = fs.readFileSync(cacheFile, 'utf-8');
        return JSON.parse(content);
      } catch (error) {
        return [];
      }
    }
    return [];
  }

  /**
   * 保存本地缓存到文件
   * @private
   */
  _saveLocalCache() {
    const cacheFile = path.resolve(FallbackHandler.LOCAL_CACHE_FILE);
    const cacheDir = path.dirname(cacheFile);

    // 确保目录存在
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    fs.writeFileSync(cacheFile, JSON.stringify(this._localCache, null, 2), 'utf-8');
  }

  /**
   * 处理飞书 API 失败
   * @param {string} operation - 操作名称
   * @param {Error} error - 原始异常
   * @param {Object} [data] - 需要缓存的数据
   * @returns {FallbackResult} 降级结果
   *
   * 副作用：将失败的操作数据写入 logs/feishu_local_cache.json
   */
  handleFeishuFailure(operation, error, data) {
    this._fallbackCounts[FallbackType.FEISHU_API]++;

    // 真正的本地缓存：将失败的操作数据写入本地文件
    const cacheEntry = {
      operation,
      error: error.message || String(error),
      data,
      timestamp: new Date().toISOString(),
      retry_suggested: true
    };

    this._localCache.push(cacheEntry);
    this._saveLocalCache();

    const result = createFallbackResult({
      success: true,
      fallbackType: FallbackType.FEISHU_API,
      message: `飞书同步失败，已保存到本地缓存（${this._localCache.length}条待同步）。会议结束后请手动同步。`,
      originalError: error.message || String(error),
      data: {
        operation,
        local_cached: true,
        cache_size: this._localCache.length,
        cache_file: FallbackHandler.LOCAL_CACHE_FILE,
        retry_suggested: true
      }
    });

    this._fallbackHistory.push(result);
    return result;
  }

  /**
   * 处理 lark-cli 失败
   * @param {string} operation - 操作名称
   * @param {Error} error - 原始异常
   * @param {number} [maxRetries=3] - 最大重试次数
   * @returns {FallbackResult} 降级结果
   */
  handleLarkCliFailure(operation, error, maxRetries = 3) {
    this._fallbackCounts[FallbackType.LARK_CLI]++;

    const result = createFallbackResult({
      success: true,
      fallbackType: FallbackType.LARK_CLI,
      message: 'lark-cli 执行失败，已记录错误。建议检查网络连接后重试。',
      originalError: error.message || String(error),
      data: {
        operation,
        retry_available: true,
        max_retries: maxRetries
      }
    });

    this._fallbackHistory.push(result);
    return result;
  }

  /**
   * 处理 LLM 超时（真正的超时控制）
   * @param {Function} generator - 无参数的可调用对象，返回 LLM 生成结果
   * @param {number} [timeoutSeconds=10] - 超时时间（秒）
   * @param {*} [fallbackValue] - 超时时的降级值
   * @param {string} [fallbackTemplateName] - 降级模板名称
   * @returns {Promise<FallbackResult>} 包含成功/失败状态和结果数据
   */
  async handleLlmTimeout(generator, timeoutSeconds = 10, fallbackValue, fallbackTemplateName) {
    this._fallbackCounts[FallbackType.LLM_TIMEOUT]++;

    try {
      // 使用 Promise.race 实现超时控制
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('TimeoutError')), timeoutSeconds * 1000);
      });

      const result = await Promise.race([
        Promise.resolve(generator()),
        timeoutPromise
      ]);

      return createFallbackResult({
        success: true,
        fallbackType: FallbackType.LLM_TIMEOUT,
        message: 'LLM生成成功',
        data: { result }
      });

    } catch (error) {
      // 超时或其他错误：返回降级模板内容
      let fallbackContent = fallbackValue;
      if (fallbackTemplateName) {
        fallbackContent = getFallbackTemplate(fallbackTemplateName);
      }
      if (fallbackContent === undefined || fallbackContent === null) {
        fallbackContent = '';
      }

      const isTimeout = error.message === 'TimeoutError';

      const result = createFallbackResult({
        success: false,
        fallbackType: FallbackType.LLM_TIMEOUT,
        message: isTimeout
          ? `LLM响应超时（>${timeoutSeconds}秒），已降级为模板内容`
          : `LLM生成失败：${error.message}`,
        originalError: error.message,
        data: {
          fallback_value: fallbackContent,
          fallback_template: fallbackTemplateName,
          content_available: Boolean(fallbackContent)
        }
      });

      this._fallbackHistory.push(result);
      return result;
    }
  }

  /**
   * 处理知识库召回失败
   * @param {string} manualQuery - 手动查询关键词
   * @param {Object} knowledgeRetriever - KnowledgeRetriever 实例
   * @param {number} [topK=5] - 返回数量
   * @returns {Promise<FallbackResult>} 包含召回结果
   */
  async handleKnowledgeRecallFailure(manualQuery, knowledgeRetriever, topK = 5) {
    this._fallbackCounts[FallbackType.KNOWLEDGE_RECALL]++;

    try {
      // 使用 recallByKeywords 接口
      const results = knowledgeRetriever.recallByKeywords([manualQuery], topK);

      return createFallbackResult({
        success: results && results.length > 0,
        fallbackType: FallbackType.KNOWLEDGE_RECALL,
        message: `手动召回结果：${results ? results.length : 0}条`,
        data: {
          results: results ? results.map(sku => ({
            id: sku.id,
            title: sku.title,
            summary: sku.summary,
            confidence: sku.confidence
          })) : [],
          query: manualQuery
        }
      });

    } catch (error) {
      const result = createFallbackResult({
        success: false,
        fallbackType: FallbackType.KNOWLEDGE_RECALL,
        message: `知识库召回失败：${error.message}`,
        originalError: error.message,
        data: { query: manualQuery, results: [] }
      });

      this._fallbackHistory.push(result);
      return result;
    }
  }

  /**
   * 处理 Word 生成失败
   * @param {Object} content - 原始内容
   * @param {Error} error - 原始异常
   * @returns {FallbackResult} 降级结果
   */
  handleWordGenerationFailure(content, error) {
    this._fallbackCounts[FallbackType.WORD_GENERATION]++;

    // 降级为纯文本
    const textContent = this._convertToText(content);

    const result = createFallbackResult({
      success: true,
      fallbackType: FallbackType.WORD_GENERATION,
      message: 'Word生成失败，已降级为纯文本输出',
      originalError: error.message || String(error),
      data: {
        text_content: textContent,
        format: 'plain_text'
      }
    });

    this._fallbackHistory.push(result);
    return result;
  }

  /**
   * 将内容转换为纯文本
   * @param {Object} content - 原始内容
   * @returns {string} 纯文本
   * @private
   */
  _convertToText(content) {
    const lines = [];

    for (const [key, value] of Object.entries(content)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        lines.push(`\n【${key}】`);
        for (const [k, v] of Object.entries(value)) {
          lines.push(`  ${k}: ${v}`);
        }
      } else if (Array.isArray(value)) {
        lines.push(`\n【${key}】`);
        value.forEach((item, index) => {
          if (typeof item === 'object' && item !== null) {
            lines.push(`  ${index + 1}. ${JSON.stringify(item)}`);
          } else {
            lines.push(`  ${index + 1}. ${item}`);
          }
        });
      } else {
        lines.push(`${key}: ${value}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 获取本地缓存
   * @returns {Object[]} 缓存条目列表
   */
  getLocalCache() {
    return [...this._localCache];
  }

  /**
   * 清除本地缓存
   */
  clearLocalCache() {
    this._localCache = [];
    this._saveLocalCache();
  }

  /**
   * 将失败操作加入重试队列（不阻塞主流程）
   * @param {Object} task - 重试任务
   * @param {string} task.operation - 操作名称
   * @param {Function} task.handler - 重试处理函数
   * @param {Object} task.data - 操作数据
   * @param {number} [task.maxRetries=3] - 最大重试次数
   * @param {number} [task.retryDelay=5000] - 重试间隔（毫秒）
   * @returns {Object} 队列条目
   */
  enqueue(task) {
    const queueEntry = {
      id: `${task.operation}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      operation: task.operation,
      handler: task.handler,
      data: task.data,
      maxRetries: task.maxRetries ?? 3,
      retryDelay: task.retryDelay ?? 5000,
      attempts: 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
      lastError: null
    };

    this._retryQueue.push(queueEntry);

    // 异步处理队列，不阻塞当前操作
    this._processQueueAsync();

    return queueEntry;
  }

  /**
   * 异步处理重试队列
   * @private
   */
  async _processQueueAsync() {
    // 防止并发处理
    if (this._isProcessingQueue) return;
    this._isProcessingQueue = true;

    try {
      while (this._retryQueue.length > 0) {
        const entry = this._retryQueue[0];

        if (entry.attempts >= entry.maxRetries) {
          // 超过最大重试次数，移出队列并保存到本地缓存
          this._retryQueue.shift();
          this.handleFeishuFailure(entry.operation, new Error(entry.lastError || '重试次数耗尽'), entry.data);
          continue;
        }

        try {
          entry.status = 'retrying';
          entry.attempts++;

          // 执行重试处理函数
          await entry.handler(entry.data);

          // 成功，移出队列
          this._retryQueue.shift();
          console.log(`[FallbackHandler] 重试成功: ${entry.operation} (第${entry.attempts}次)`);

        } catch (err) {
          entry.status = 'pending';
          entry.lastError = err.message || String(err);
          console.warn(`[FallbackHandler] 重试失败: ${entry.operation} (第${entry.attempts}次) - ${entry.lastError}`);

          // 等待后继续
          await new Promise(resolve => setTimeout(resolve, entry.retryDelay));
        }
      }
    } finally {
      this._isProcessingQueue = false;
    }
  }

  /**
   * 获取重试队列状态
   * @returns {Object[]} 队列条目列表（不含 handler 函数）
   */
  getRetryQueue() {
    return this._retryQueue.map(entry => ({
      id: entry.id,
      operation: entry.operation,
      attempts: entry.attempts,
      maxRetries: entry.maxRetries,
      status: entry.status,
      createdAt: entry.createdAt,
      lastError: entry.lastError
    }));
  }

  /**
   * 获取降级统计报告
   * @returns {{totalFallbacks: number, byType: Object<string, number>, recentFallbacks: Object[]}}
   */
  getFallbackReport() {
    return {
      total_fallbacks: Object.values(this._fallbackCounts).reduce((sum, count) => sum + count, 0),
      by_type: { ...this._fallbackCounts },
      recent_fallbacks: this._fallbackHistory.slice(-10).map(f => ({
        type: f.fallback_type,
        message: f.message,
        timestamp: f.timestamp
      }))
    };
  }

  /**
   * 清除历史记录
   */
  clearHistory() {
    this._fallbackHistory = [];
    this._fallbackCounts = {
      [FallbackType.FEISHU_API]: 0,
      [FallbackType.LARK_CLI]: 0,
      [FallbackType.LLM_TIMEOUT]: 0,
      [FallbackType.KNOWLEDGE_RECALL]: 0,
      [FallbackType.WORD_GENERATION]: 0
    };
  }
}

/**
 * 降级链：按顺序尝试多个降级方案
 */
class FallbackChain {
  /**
   * @param {FallbackHandler} handler - 降级处理器实例
   */
  constructor(handler) {
    /**
     * @type {FallbackHandler}
     */
    this.handler = handler;

    /**
     * @type {Function[]}
     */
    this.chain = [];
  }

  /**
   * 添加降级方案到链中
   * @param {Function} fallbackFunc - 降级函数
   * @returns {FallbackChain} 返回 this 以支持链式调用
   */
  add(fallbackFunc) {
    this.chain.push(fallbackFunc);
    return this;
  }

  /**
   * 执行主函数，失败时按链顺序降级
   * @param {Function} primaryFunc - 主函数
   * @param {...*} args - 主函数参数
   * @returns {*} 执行结果
   */
  execute(primaryFunc, ...args) {
    try {
      return primaryFunc(...args);
    } catch (error) {
      // 按链顺序尝试降级
      for (const fallbackFunc of this.chain) {
        try {
          return fallbackFunc(...args);
        } catch (fallbackError) {
          continue;
        }
      }

      // 所有降级方案都失败
      throw error;
    }
  }
}

module.exports = {
  FallbackHandler,
  FallbackChain,
  FallbackType,
  getFallbackTemplate
};
