// @ts-check
const { EventEmitter } = require('events');
const crypto = require('crypto');

/** @typedef {import('../types').Candidate} Candidate */
/** @typedef {import('../types').SkuCard} SkuCard */
/** @typedef {import('../types').ConstraintCheckResult} ConstraintCheckResult */
/** @typedef {import('../types').CandidateCacheStatus} CandidateCacheStatus */
/** @typedef {import('../types').RiskLevel} RiskLevel */

/**
 * @typedef {Object} ConstraintState
 * @property {boolean} firstConstraint - >=3 条已确认事实
 * @property {boolean} secondConstraint - 至少 1 个待确认假设
 * @property {boolean} thirdConstraint - 至少 1 个 🟢/🟡 SKU
 */

/**
 * 候选缓存类（线程安全，使用变量模拟）
 *
 * 在 Node.js 单线程环境下，使用变量状态模拟线程安全。
 * 所有状态变更操作都是同步的，不存在竞态条件。
 */
class CandidateCache {
  constructor() {
    /** @type {Candidate[]|null} */
    this._candidates = null;
    /** @type {number|null} */
    this._timestamp = null;
    /** @type {boolean} */
    this._isValid = false;
  }

  /**
   * 获取缓存的候选
   * @returns {Candidate[]|null}
   */
  get() {
    if (this._isValid && this._candidates) {
      return [...this._candidates];
    }
    return null;
  }

  /**
   * 设置缓存
   * @param {Candidate[]} candidates
   */
  set(candidates) {
    this._candidates = [...candidates];
    this._timestamp = Date.now();
    this._isValid = true;
  }

  /**
   * 使缓存失效
   */
  invalidate() {
    this._isValid = false;
  }

  /**
   * 检查缓存是否有效
   * @returns {boolean}
   */
  isValid() {
    return this._isValid;
  }

  /**
   * 获取缓存年龄（秒）
   * @returns {number}
   */
  getAgeSeconds() {
    if (this._timestamp) {
      return (Date.now() - this._timestamp) / 1000;
    }
    return Infinity;
  }
}

/**
 * 候选生成器（MDU核心）
 * @extends EventEmitter
 *
 * 事件：
 * - 'cache-invalidate' - 缓存失效时触发
 * - 'precompute-start' - 预计算开始
 * - 'precompute-done' - 预计算完成，payload: { candidates }
 *
 * 设计文档 3.2 节：
 * - 后台预计算缓存，/候选 指令 1.5 秒内响应
 * - 三约束检查 + 补充召回
 * - 防抖机制（10秒窗口）
 * - SKU 变化监听
 */
class CandidateGenerator extends EventEmitter {
  /**
   * @param {Object} options
   * @param {import('../utils/llmClient').LLMClient} options.llmClient
   * @param {import('./consensusChain').ConsensusChain} options.consensusChain
   * @param {Object} [options.knowledgeRetriever] - 知识召回器（可选）
   * @param {Object} [options.fallbackHandler] - 降级处理器（可选）
   */
  constructor(options) {
    super();

    /** @type {import('../utils/llmClient').LLMClient} */
    this.llmClient = options.llmClient;

    /** @type {import('./consensusChain').ConsensusChain} */
    this.consensusChain = options.consensusChain;

    /** @type {Object|null} */
    this.knowledgeRetriever = options.knowledgeRetriever || null;

    /** @type {Object|null} */
    this.fallbackHandler = options.fallbackHandler || null;

    // 预计算缓存
    /** @type {CandidateCache} */
    this._cache = new CandidateCache();

    // 后台预计算定时器
    /** @type {NodeJS.Timeout|null} */
    this._backgroundTimer = null;

    /** @type {SkuCard[]} */
    this._availableSkus = [];

    // 记录上次状态用于变更检测
    /** @type {number} */
    this._lastFactsCount = 0;

    /** @type {number} */
    this._lastPendingCount = 0;

    // ====== P0: 防抖机制 ======
    /** @type {NodeJS.Timeout|null} */
    this._debounceTimer = null;

    /** @type {number} */
    this._debounceDelay = 10000; // 10秒防抖窗口

    // ====== P0: 三约束状态追踪 ======
    /** @type {ConstraintState} */
    this._lastConstraintState = {
      firstConstraint: false,
      secondConstraint: false,
      thirdConstraint: false
    };

    // ====== P0: 预计算次数上限 ======
    /** @type {number} */
    this._precomputeCount = 0;

    /** @type {number} */
    this._maxPrecomputeCount = 20;

    // 监听共识链的 invalidate-cache 事件
    this.consensusChain.on('invalidate-cache', (event) => {
      // 手动修正跳过防抖，立即重算
      if (event && event.source === 'manual_correction') {
        this._cancelDebounce();
        this._triggerImmediatePrecompute(this._availableSkus);
      } else {
        this.invalidateCache();
      }
    });
  }

  /**
   * 取消防抖计时器
   * @private
   */
  _cancelDebounce() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  /**
   * 检查三约束状态是否全部满足
   * @param {SkuCard[]} availableSkus
   * @returns {ConstraintState}
   * @private
   */
  _getConstraintState(availableSkus) {
    const confirmedFacts = this.consensusChain.getConfirmedFacts();
    const pending = this.consensusChain.getPendingConsensus();
    const validSkus = availableSkus.filter(
      sku => sku.confidence === '🟢' || sku.confidence === '🟡'
    );

    return {
      firstConstraint: confirmedFacts.length >= 3,
      secondConstraint: pending && pending.length > 0,
      thirdConstraint: validSkus && validSkus.length > 0
    };
  }

  /**
   * 检查是否是三约束首次全部满足
   * @param {ConstraintState} newState
   * @returns {boolean}
   * @private
   */
  _isFirstTimeAllConstraintsMet(newState) {
    const wasNotAllMet = !(
      this._lastConstraintState.firstConstraint &&
      this._lastConstraintState.secondConstraint &&
      this._lastConstraintState.thirdConstraint
    );
    const isNowAllMet = newState.firstConstraint && newState.secondConstraint && newState.thirdConstraint;

    return wasNotAllMet && isNowAllMet;
  }

  /**
   * 更新三约束状态
   * @param {ConstraintState} state
   * @private
   */
  _updateConstraintState(state) {
    this._lastConstraintState = { ...state };
  }

  /**
   * 触发立即预计算（跳过防抖）
   * @param {SkuCard[]} availableSkus
   * @private
   */
  async _triggerImmediatePrecompute(availableSkus) {
    // 检查预计算次数上限
    if (this._precomputeCount >= this._maxPrecomputeCount) {
      console.warn(`预计算次数已达上限 ${this._maxPrecomputeCount} 次，跳过`);
      return;
    }

    const constraints = this.checkConstraints(availableSkus);
    if (constraints.valid) {
      this._precomputeCount++;
      try {
        this.emit('precompute-start');
        const candidates = await this.generateCandidates();
        this._cache.set(candidates);
        this.emit('precompute-done', { candidates });
      } catch (e) {
        console.error(`立即预计算失败: ${e.message}`);
      }
    }
  }

  /**
   * 检查三约束
   * @param {SkuCard[]} availableSkus
   * @returns {ConstraintCheckResult}
   *
   * 三约束：
   * 1. >=3 条已确认事实
   * 2. 至少 1 个待确认假设
   * 3. 至少 1 个 🟢/🟡 SKU（不足时触发补充召回）
   */
  checkConstraints(availableSkus) {
    // 第一约束: >=3条已确认事实
    const confirmedFacts = this.consensusChain.getConfirmedFacts();
    if (confirmedFacts.length < 3) {
      return {
        valid: false,
        message: '当前共识不足以生成高质量候选,建议先追问客户更多背景信息'
      };
    }

    // 第二约束: 至少1个待确认假设或决策问题
    const pending = this.consensusChain.getPendingConsensus();
    if (!pending || pending.length === 0) {
      return {
        valid: false,
        message: '当前没有待确认的判断,建议先明确诊断方向'
      };
    }

    // 第三约束: 至少1个个🟢/🟡 SKU（带补充召回）
    const validSkus = availableSkus.filter(
      sku => sku.confidence === '🟢' || sku.confidence === '🟡'
    );

    if (!validSkus || validSkus.length === 0) {
      // 触发快速补充召回（设计文档 3.3 节）
      if (this.knowledgeRetriever) {
        try {
          // 从共识链提取关键词
          const keywords = this._extractKeywordsFromFacts(confirmedFacts);
          const supplementedSkus = this.knowledgeRetriever.recallByKeywords(keywords, 1);
          if (supplementedSkus && supplementedSkus.length > 0) {
            // 补充召回成功，返回通过
            return {
              valid: true,
              message: '约束检查通过（已补充召回）',
              supplemented_sku: supplementedSkus[0]
            };
          }
        } catch (e) {
          console.warn(`补充召回失败: ${e.message}`);
        }
      }

      return {
        valid: false,
        message: '当前知识库证据不足,建议先追问具体业务场景'
      };
    }

    return { valid: true, message: '约束检查通过' };
  }

  /**
   * 从事实中提取关键词
   * @param {Object[]} facts
   * @returns {string[]}
   * @private
   */
  _extractKeywordsFromFacts(facts) {
    const keywords = [];
    for (const fact of facts.slice(0, 3)) {
      const content = fact.content || String(fact);
      // 简单分词（按空格分割，取前3个词）
      keywords.push(...content.split(/\s+/).slice(0, 3));
    }
    // 去重并限制数量
    return [...new Set(keywords)].slice(0, 5);
  }

  /**
   * 生成候选方案（带超时保护）
   * @returns {Promise<Candidate[]>}
   */
  async generateCandidates() {
    const prompt = this._buildPrompt();

    let response;
    let llmFailed = false;
    try {
      // 使用 LLM 客户端生成，带超时保护
      response = await this.llmClient.generate(prompt, {
        temperature: 0.7,
        timeout: 15
      });
    } catch (error) {
      // 超时或错误时使用降级模板
      console.warn(`LLM 生成失败: ${error.message}`);
      response = this._getFallbackResponse();
      llmFailed = true;
    }

    let candidates = this._parseResponse(response);

    // 差异度自检（仅在 LLM 成功时重试，最多1次）
    if (!llmFailed && !this._checkDiversity(candidates)) {
      try {
        response = await this.llmClient.generate(prompt, {
          temperature: 0.8,
          timeout: 15
        });
        candidates = this._parseResponse(response);
      } catch (e) {
        console.warn(`重新生成失败: ${e.message}`);
      }
    }

    return candidates;
  }

  /**
   * 构建候选生成 prompt
   * @returns {string}
   * @private
   */
  _buildPrompt() {
    const facts = this.consensusChain.getConfirmedFacts();
    const pending = this.consensusChain.getPendingConsensus();

    const factsList = facts.map(f => `- ${f.content}`).join('\n');
    const pendingList = pending.map(p => `- ${p.content}`).join('\n');

    const prompt = `基于以下已确认事实和待确认判断,生成3个有差异的候选方案:

已确认事实:
${factsList}

待确认判断:
${pendingList}

要求:
1. 三个候选必须分别对应不同的战略方向(重资产vs轻资产、自建vs合作、聚焦vs多元)
2. 三个候选必须分别对应不同的风险偏好(稳健、平衡、激进)
3. 每个候选用一句话描述,格式:"候选X: [描述], [风险等级]型策略"

直接输出三个候选,不要其他解释。`;

    return prompt;
  }

  /**
   * 解析 LLM 响应
   *
   * 兼容处理：
   * - 全角冒号（：）和半角冒号（:）
   * - "候选A"、"候选1"、"候选方向A" 等变体
   * - 前置空格/制表符
   * - 解析失败时返回错误提示候选
   *
   * @param {string} response
   * @returns {Candidate[]}
   * @private
   */
  _parseResponse(response) {
    /** @type {Candidate[]} */
    const candidates = [];
    const lines = response.trim().split('\n');

    // 风险等级关键词映射
    const riskKeywords = {
      '稳健': '稳健',
      '平衡': '平衡',
      '激进': '激进',
      '保守': '稳健',
      '中性': '平衡',
      '积极': '激进'
    };

    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      let line = lines[i].trim();
      if (!line) continue;

      // 兼容全角/半角冒号，统一替换为半角
      const normalized = line.replace(/：/g, ':');

      // 匹配候选模式：包含"候选"关键词
      if (normalized.includes('候选')) {
        let title;
        let description;

        // 按冒号分割
        const parts = normalized.split(':');
        if (parts.length >= 2) {
          title = parts[0].trim();
          description = parts.slice(1).join(':').trim();
        } else {
          // 没有冒号，整行作为描述
          title = `候选${candidates.length + 1}`;
          description = normalized;
        }

        // 识别风险等级（优先匹配开头的 "X型策略" 模式）
        /** @type {RiskLevel} */
        let riskLevel = '平衡'; // 默认

        // 优先匹配开头的 "X型策略" 模式
        const prefixMatch = description.match(/^(稳健|平衡|激进|保守|中性|积极)型/);
        if (prefixMatch) {
          const keyword = prefixMatch[1];
          riskLevel = /** @type {RiskLevel} */ (riskKeywords[keyword] || '平衡');
        } else {
          // 降级：遍历关键词匹配
          for (const [keyword, level] of Object.entries(riskKeywords)) {
            if (description.includes(keyword) || title.includes(keyword)) {
              riskLevel = /** @type {RiskLevel} */ (level);
              break;
            }
          }
        }

        candidates.push({
          id: `candidate_${candidates.length}`,
          title,
          description,
          risk_level: riskLevel,
          evidence_skus: []
        });

        if (candidates.length >= 3) break;
      }
    }

    // 解析失败保护：不足3个候选时用错误提示填充
    while (candidates.length < 3) {
      const riskLevels = /** @type {RiskLevel[]} */ (['稳健', '平衡', '激进']);
      candidates.push({
        id: `candidate_fallback_${candidates.length}`,
        title: `候选${candidates.length + 1}（解析失败）`,
        description: 'LLM输出格式异常，请重新生成候选',
        risk_level: riskLevels[candidates.length % 3],
        evidence_skus: []
      });
    }

    // PRD 3.4 节校验：三个候选描述长度差异不超过 30%
    const lengths = candidates.map(c => c.description.length);
    if (lengths.length > 0) {
      const maxLen = Math.max(...lengths);
      const minLen = Math.min(...lengths);
      if (maxLen > 0 && (maxLen - minLen) / maxLen > 0.3) {
        // 长度差异过大，记录日志但不阻断
        console.warn(`候选描述长度差异超过30%: ${lengths.join(', ')}`);
      }
    }

    return candidates;
  }

  /**
   * 检查候选差异度
   *
   * 设计文档 3.4 节：用 embedding 计算两两相似度，> 0.85 判定为伪差异
   * 当前简化版：检查风险等级是否都不同
   * TODO: Day 4+ 接入 embedding 计算真实差异度
   *
   * @param {Candidate[]} candidates
   * @returns {boolean}
   * @private
   */
  _checkDiversity(candidates) {
    if (!candidates || candidates.length < 3) {
      return false;
    }
    // 检查风险等级是否都不同
    const riskLevels = candidates.map(c => c.risk_level);
    return new Set(riskLevels).size === 3;
  }

  /**
   * 获取降级响应
   * @returns {string}
   * @private
   */
  _getFallbackResponse() {
    return `候选1: 稳健型策略，优先保障现有业务稳定运行，逐步探索新机会，稳健型策略
候选2: 平衡型策略，在稳健基础上适度投入创新业务，平衡风险与收益，平衡型策略
候选3: 激进型策略，大胆投入新业务方向，追求高增长高回报，激进型策略`;
  }

  // ============= 预计算缓存机制 =============

  /**
   * 从缓存获取候选（0.2 秒响应）
   *
   * 设计文档 3.2 节：/候选 指令直接从缓存读取
   *
   * @returns {Candidate[]|null}
   */
  getCachedCandidates() {
    return this._cache.get();
  }

  /**
   * 检查变更并触发预计算（带防抖）
   *
   * 触发条件（设计文档 3.2.4 节）：
   * - 共识链新增事实 → 防抖 10 秒后重算
   * - 手动修正共识链 → 立即重算（跳过防抖）
   * - 阶段切换 → 立即重算（跳过防抖）
   * - SKU 变化 → 防抖 10 秒后重算
   *
   * @param {SkuCard[]} availableSkus
   * @param {Object} [options]
   * @param {boolean} [options.immediate=false] - 是否立即重算（跳过防抖）
   * @param {string} [options.source] - 触发源（'consensus_change' | 'manual_correction' | 'stage_switch' | 'sku_change'）
   * @returns {Promise<Candidate[]|null>}
   */
  async checkAndPrecompute(availableSkus, options = {}) {
    const { immediate = false, source = 'consensus_change' } = options;

    // 更新可用 SKU
    this._availableSkus = availableSkus;

    // 检查三约束状态
    const constraintState = this._getConstraintState(availableSkus);

    console.log(`[checkAndPrecompute] source=${source}, immediate=${immediate}, constraints=${JSON.stringify(constraintState)}`);

    // P0: 检查三约束首次满足
    if (this._isFirstTimeAllConstraintsMet(constraintState)) {
      // 取消防抖，立即重算
      console.log(`[checkAndPrecompute] 三约束首次满足，触发立即预计算`);
      this._cancelDebounce();
      this._updateConstraintState(constraintState);
      await this._triggerImmediatePrecompute(availableSkus);
      return this._cache.get();
    }

    // 更新约束状态
    this._updateConstraintState(constraintState);

    // 检查是否有变更
    const currentFactsCount = this.consensusChain.getConfirmedFacts().length;
    const currentPendingCount = this.consensusChain.getPendingConsensus().length;

    const changed = (
      currentFactsCount !== this._lastFactsCount ||
      currentPendingCount !== this._lastPendingCount
    );

    this._lastFactsCount = currentFactsCount;
    this._lastPendingCount = currentPendingCount;

    if (changed) {
      this._cache.invalidate();
    }

    // 如果缓存有效，直接返回
    if (this._cache.isValid()) {
      return this._cache.get();
    }

    // 缓存失效且有变更，触发预计算
    if (changed || immediate) {
      // 手动修正或阶段切换：立即重算
      if (immediate || source === 'manual_correction' || source === 'stage_switch') {
        this._cancelDebounce();
        await this._triggerImmediatePrecompute(availableSkus);
      } else {
        // 共识链变更或 SKU 变化：防抖处理
        this._scheduleDebouncedPrecompute(availableSkus);
      }
    }

    return this._cache.get();
  }

  /**
   * 调度防抖预计算
   * @param {SkuCard[]} availableSkus
   * @private
   */
  _scheduleDebouncedPrecompute(availableSkus) {
    // 取消之前的防抖计时器
    this._cancelDebounce();

    // 设置新的防抖计时器
    this._debounceTimer = setTimeout(async () => {
      this._debounceTimer = null;
      await this._triggerImmediatePrecompute(availableSkus);
    }, this._debounceDelay);
  }

  /**
   * 通知 SKU 变化（供外部调用）
   *
   * 设计文档 3.2.4 节：备弹区 SKU 可信度变化触发缓存过期
   *
   * @param {SkuCard[]} newSkus
   */
  async notifySkuChange(newSkus) {
    this._availableSkus = newSkus;

    // 检查第三约束是否变化
    const constraintState = this._getConstraintState(newSkus);

    // 如果第三约束从满足变为不满足，缓存必须失效
    if (this._lastConstraintState.thirdConstraint && !constraintState.thirdConstraint) {
      this._cache.invalidate();
    }

    // 如果第三约束从不满足变为满足，可能是首次满足
    if (!this._lastConstraintState.thirdConstraint && constraintState.thirdConstraint) {
      if (this._isFirstTimeAllConstraintsMet(constraintState)) {
        this._cancelDebounce();
        this._updateConstraintState(constraintState);
        await this._triggerImmediatePrecompute(newSkus);
        return;
      }
    }

    // 更新约束状态
    this._updateConstraintState(constraintState);

    // 防抖处理
    this._scheduleDebouncedPrecompute(newSkus);
  }

  /**
   * 启动后台预计算
   *
   * 使用 setInterval 定期检查并预计算候选。
   *
   * @param {SkuCard[]} availableSkus
   * @param {number} [interval=30] - 检查间隔（秒）
   */
  startBackgroundPrecompute(availableSkus, interval = 30) {
    if (this._backgroundTimer) {
      return; // 已在运行
    }

    this._availableSkus = availableSkus;

    this._backgroundTimer = setInterval(async () => {
      try {
        await this.checkAndPrecompute(this._availableSkus);
      } catch (e) {
        console.error(`后台预计算异常: ${e.message}`);
      }
    }, interval * 1000);

    // 立即执行一次
    this.checkAndPrecompute(availableSkus).catch(e => {
      console.error(`初始预计算失败: ${e.message}`);
    });
  }

  /**
   * 停止后台预计算
   */
  stopBackgroundPrecompute() {
    if (this._backgroundTimer) {
      clearInterval(this._backgroundTimer);
      this._backgroundTimer = null;
    }
    // 清除防抖计时器
    this._cancelDebounce();
  }

  /**
   * 检查后台预计算是否在运行
   * @returns {boolean}
   */
  isPrecomputeRunning() {
    return this._backgroundTimer !== null;
  }

  /**
   * 使缓存失效
   */
  invalidateCache() {
    this._cache.invalidate();
    this.emit('cache-invalidate');
  }

  /**
   * 获取缓存状态
   * @returns {CandidateCacheStatus}
   */
  getCacheStatus() {
    return {
      is_valid: this._cache.isValid(),
      age_seconds: this._cache.getAgeSeconds(),
      background_running: this.isPrecomputeRunning(),
      last_facts_count: this._lastFactsCount,
      last_pending_count: this._lastPendingCount,
      precompute_count: this._precomputeCount,
      constraint_state: this._lastConstraintState
    };
  }

  /**
   * 重置预计算计数（新会话时调用）
   */
  resetPrecomputeCount() {
    this._precomputeCount = 0;
    this._lastConstraintState = {
      firstConstraint: false,
      secondConstraint: false,
      thirdConstraint: false
    };
  }
}

module.exports = { CandidateGenerator, CandidateCache };
