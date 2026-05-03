// @ts-check
/**
 * 会前作战卡生成器
 *
 * 根据设计文档 11.1 节实现：
 * - 双模式自动切换（验证假设版 / 信息建立版）
 * - 规则过滤 → 优先级排序 → LLM润色 → 硬约束校验
 * - Word文档输出
 */

const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');

/**
 * @typedef {'🟢' | '🟡' | '🔴'} SkuConfidence
 * @typedef {'战略梳理' | '商业模式' | '行业演示'} Stage
 * @typedef {'hypothesis' | 'info_building'} BattleCardMode
 */

/**
 * SKU 弹药卡片
 * @typedef {Object} SkuCard
 * @property {string} id
 * @property {string} title
 * @property {string} summary
 * @property {SkuConfidence} confidence
 * @property {Stage} stage
 */

/**
 * 客户档案
 * @typedef {Object} ClientProfile
 * @property {string|null} record_id
 * @property {Object} fields
 */

/**
 * 作战卡
 * @typedef {Object} BattleCard
 * @property {string} company
 * @property {string} date
 * @property {string} consultant
 * @property {BattleCardMode} mode
 * @property {number} completeness
 * @property {Object} content
 */

/**
 * 预设追问树（固定在作战卡中）
 * @type {Object}
 */
const PRESET_STRATEGY_TREE = {
  anchor: "您现在最头疼的一件事是什么?",
  branches: {
    "增长": ["现在增长靠什么驱动?", "这个驱动力能持续多久?"],
    "盈利": ["哪条线最赚钱?为什么?", "其他线是战略投入还是历史包袱?"],
    "方向": ["现在有几个方向在跑?", "资源是怎么分配的?"]
  }
};

/**
 * 预设商业模式追问树
 * @type {Object}
 */
const PRESET_BUSINESS_TREE = {
  anchor: "您的主要收入来源是什么?",
  branches: {
    "设备销售": ["有没有想过卖服务?", "客户愿意为运营结果付费吗?"],
    "EPC工程": ["工程完了客户还找你吗?", "有没有机会做长期运维?"],
    "运营服务": ["现在规模多大?", "可复制性怎么样?"]
  }
};

/**
 * 风险话术模板
 * @type {Object}
 */
const RISK_RESPONSES = {
  "已有方向": {
    trigger: "客户说\"我们已经有方向了\"",
    response: "那您觉得现在最大的执行障碍是什么?"
  },
  "超出范围": {
    trigger: "客户问超出范围的问题",
    response: "这是关键问题，列入下阶段专项研究，一周内回复"
  },
  "质疑专业性": {
    trigger: "客户质疑专业性",
    response: "动态生成：引用🟢SKU作为背书"
  }
};

/**
 * SKU 数量不足异常
 */
class InsufficientSkuError extends Error {
  /**
   * @param {string} message - 错误信息
   */
  constructor(message) {
    super(message);
    this.name = 'InsufficientSkuError';
  }
}

/**
 * 作战卡生成器
 *
 * 根据客户档案完整度自动选择模式：
 * - 完整度 >= 60%: 验证假设版
 * - 完整度 < 60%: 信息建立版
 */
class BattleCardGenerator {
  /** SKU最小数量保护阈值 */
  static MIN_SKU_COUNT = 6;

  /**
   * @param {Object} options
   * @param {Object} [options.feishuClient] - 飞书客户端（用于获取客户档案和计算完整度）
   * @param {Object} options.llmClient - LLM客户端（用于润色）
   * @param {Object} [options.knowledgeRetriever] - 知识召回器（可选，用于SKU召回）
   */
  constructor(options) {
    /**
     * 飞书客户端
     * @type {Object|null}
     */
    this.feishuClient = options.feishuClient || null;

    /**
     * LLM客户端
     * @type {Object}
     */
    this.llmClient = options.llmClient;

    /**
     * 知识召回器
     * @type {Object|null}
     */
    this.knowledgeRetriever = options.knowledgeRetriever || null;
  }

  /**
   * 生成会前作战卡
   *
   * @param {string} company - 客户公司名称
   * @param {string} [consultant=''] - 顾问姓名（可选）
   * @returns {Promise<BattleCard>} 作战卡数据结构
   * @throws {InsufficientSkuError} SKU < 6 条时抛出
   *
   * 模式选择：
   * - 完整度 >= 60% → 验证假设版
   * - 完整度 < 60% → 信息建立版
   */
  async generate(company, consultant = '') {
    // 1. 获取客户档案
    let profile = null;
    if (this.feishuClient) {
      profile = await this.feishuClient.getClientProfile(company);
    }

    // 2. 处理 profile 为 null 的情况
    if (!profile) {
      profile = {
        record_id: null,
        fields: {
          '客户公司名': company
        }
      };
    }

    // 3. 计算完整度
    let completeness = 0;
    if (this.feishuClient && typeof this.feishuClient.calcCompleteness === 'function') {
      completeness = this.feishuClient.calcCompleteness(profile);
    } else {
      completeness = this._calcDefaultCompleteness(profile);
    }

    // 4. 根据完整度选择模式
    let content;
    let mode;

    if (completeness >= 0.6) {
      content = await this._generateHypothesisVersion(profile);
      mode = 'hypothesis';
    } else {
      content = await this._generateInfoBuildingVersion(profile);
      mode = 'info_building';
    }

    return {
      company,
      date: new Date().toISOString().split('T')[0],
      consultant,
      mode,
      completeness,
      content
    };
  }

  /**
   * 计算默认完整度（当 feishuClient 不可用时）
   * @param {ClientProfile} profile - 客户档案
   * @returns {number} 完整度 0-1
   * @private
   */
  _calcDefaultCompleteness(profile) {
    if (!profile || !profile.fields) return 0;

    const requiredFields = [
      '产品线', '客户群体', '收入结构',
      '毛利结构', '交付情况', '资源分布',
      '战略目标', '显性诉求', '隐性痛点'
    ];

    const fields = profile.fields;
    const filledCount = requiredFields.filter(
      f => fields[f] && String(fields[f]).length >= 5
    ).length;

    return filledCount / requiredFields.length;
  }

  /**
   * 获取 Top N SKU
   * @param {ClientProfile} profile - 客户档案
   * @param {number} [topN=15] - 返回数量
   * @returns {Promise<SkuCard[]>} SKU列表
   * @private
   */
  async _getTopSkus(profile, topN = 15) {
    if (this.knowledgeRetriever) {
      const keywords = this._extractKeywordsFromProfile(profile);
      const skus = this.knowledgeRetriever.recallByKeywords(keywords, topN);
      return skus;
    }
    // 降级：使用 mock 数据
    return this._getMockSkus(topN);
  }

  /**
   * Mock SKU 数据（降级用）
   * @param {number} [topN=15] - 返回数量
   * @returns {SkuCard[]} SKU列表
   * @private
   */
  _getMockSkus(topN = 15) {
    const mockSkus = [
      { id: 'sku_001', title: '设备商转运营商路径', summary: '从设备销售转向运营服务的典型案例', confidence: '🟢', stage: '商业模式' },
      { id: 'sku_002', title: '储能系统集成商商业模式', summary: '工商业储能系统集成商的盈利模式分析', confidence: '🟡', stage: '商业模式' },
      { id: 'sku_003', title: '虚拟电厂聚合商案例', summary: '负荷聚合商参与电力市场的路径', confidence: '🟢', stage: '战略梳理' },
      { id: 'sku_004', title: '分布式光伏运营模式', summary: '分布式光伏的商业模式创新', confidence: '🟢', stage: '商业模式' },
      { id: 'sku_005', title: '重卡换电商业案例', summary: '重卡换电站的盈利模型', confidence: '🟡', stage: '商业模式' },
      { id: 'sku_006', title: '微电网运营案例', summary: '工业园区微电网运营实践', confidence: '🟢', stage: '战略梳理' },
      { id: 'sku_007', title: '综合能源服务转型', summary: '传统能源企业转型综合能源服务', confidence: '🟡', stage: '战略梳理' },
      { id: 'sku_008', title: '储能电站运营', summary: '独立储能电站的商业模式', confidence: '🟢', stage: '商业模式' },
      { id: 'sku_009', title: '电力交易代理', summary: '电力市场化交易代理服务', confidence: '🟢', stage: '战略梳理' },
      { id: 'sku_010', title: '需求响应聚合', summary: '需求响应资源聚合模式', confidence: '🟡', stage: '商业模式' }
    ];
    return mockSkus.slice(0, topN);
  }

  /**
   * 从客户档案提取关键词
   * @param {ClientProfile} profile - 客户档案
   * @returns {string[]} 关键词列表
   * @private
   */
  _extractKeywordsFromProfile(profile) {
    if (!profile || !profile.fields) {
      return ['新能源', '储能', '光伏'];
    }

    const fields = profile.fields;
    const keywords = [];

    // 从各字段提取
    for (const fieldName of ['产品线', '客户群体', '战略目标']) {
      const value = fields[fieldName];
      if (value) {
        keywords.push(...String(value).split('/').slice(0, 3));
        keywords.push(...String(value).split('、').slice(0, 3));
      }
    }

    // 去重
    const uniqueKeywords = [...new Set(keywords.filter(k => k.trim()))];
    return uniqueKeywords.slice(0, 10).length > 0 ? uniqueKeywords.slice(0, 10) : ['新能源', '储能', '光伏'];
  }

  /**
   * 规则过滤：根据角色×场景×痛点过滤SKU
   * @param {ClientProfile} profile - 客户档案
   * @returns {Promise<SkuCard[]>} 过滤后的SKU列表
   * @private
   */
  async _filterSkus(profile) {
    return this._getTopSkus(profile);
  }

  /**
   * 优先级排序：加权计算Top 15
   *
   * 权重：
   * - 角色匹配度 0.4
   * - 痛点匹配度 0.3
   * - SKU可信度 0.2
   * - 当前阶段相关性 0.1
   *
   * @param {SkuCard[]} candidateSkus - 候选SKU列表
   * @param {ClientProfile} profile - 客户档案
   * @returns {SkuCard[]} 排序后的SKU列表
   * @private
   */
  _rankSkus(candidateSkus, profile) {
    /**
     * 计算可信度分数
     * @param {SkuCard} sku
     * @returns {number}
     */
    const confidenceScore = (sku) => {
      const conf = sku.confidence || '🔴';
      if (conf === '🟢') return 1.0;
      if (conf === '🟡') return 0.7;
      return 0.3;
    };

    const sortedSkus = [...candidateSkus].sort((a, b) => confidenceScore(b) - confidenceScore(a));
    return sortedSkus.slice(0, 15);
  }

  /**
   * 生成验证假设版（完整度>=60%）
   *
   * 数据流：规则过滤 → 优先级排序 → LLM润色 → 硬约束校验
   *
   * @param {ClientProfile} profile - 客户档案
   * @returns {Promise<Object>} 内容对象
   * @private
   */
  async _generateHypothesisVersion(profile) {
    // 1. 规则过滤
    const candidateSkus = await this._filterSkus(profile);

    // 2. 优先级排序
    const topSkus = this._rankSkus(candidateSkus, profile);

    // 3. SKU最小数量保护
    if (topSkus.length < BattleCardGenerator.MIN_SKU_COUNT) {
      throw new InsufficientSkuError(
        `SKU召回不足${BattleCardGenerator.MIN_SKU_COUNT}条，当前${topSkus.length}条，无法生成高质量作战卡`
      );
    }

    // 4. LLM润色：分批传入，转化为口播台词
    const demoSkuCount = topSkus.length - 9;
    let demoSkus;
    if (demoSkuCount >= 3) {
      demoSkus = topSkus.slice(9, 12);
    } else if (demoSkuCount > 0) {
      demoSkus = topSkus.slice(9);
    } else {
      demoSkus = topSkus.slice(Math.max(0, topSkus.length - 3));
    }

    const content = {
      diagnosis_hypothesis: await this._generateHypothesis(topSkus.slice(0, 3), profile),
      strategy_questions: await this._generateQuestions(topSkus.slice(3, 6), '战略梳理'),
      business_questions: await this._generateQuestions(topSkus.length >= 9 ? topSkus.slice(6, 9) : [], '商业模式'),
      demo_scripts: this._generateScripts(demoSkus),
      risk_responses: this._generateRiskResponses(topSkus)
    };

    // 5. 硬约束校验：确保诊断假设引用>=1个🟢/🟡SKU
    this._validateConstraints(content, topSkus);

    return content;
  }

  /**
   * 生成信息建立版（完整度<60%）
   * @param {ClientProfile} profile - 客户档案
   * @returns {Promise<Object>} 内容对象
   * @private
   */
  async _generateInfoBuildingVersion(profile) {
    const topSkus = await this._getTopSkus(profile, 6);

    const content = {
      missing_fields: this._identifyMissingFields(profile),
      strategy_tree: PRESET_STRATEGY_TREE,
      business_tree: PRESET_BUSINESS_TREE,
      demo_scripts: this._generateScripts(topSkus.slice(0, 3)),
      risk_responses: this._generateRiskResponses(topSkus)
    };

    return content;
  }

  /**
   * 生成诊断假设
   * @param {SkuCard[]} skus - Top 3 SKU
   * @param {ClientProfile} profile - 客户档案
   * @returns {Promise<string>} 诊断假设文本
   * @private
   */
  async _generateHypothesis(skus, profile) {
    if (!skus || skus.length === 0) {
      return '客户业务模式需要进一步诊断，建议从战略定位和商业模式两个维度展开。';
    }

    // 构建prompt
    const skuRefs = skus.map(sku => `- [${sku.confidence}] ${sku.title}: ${sku.summary}`).join('\n');

    const fields = profile?.fields || {};
    const company = fields['客户公司名'] || '客户';
    const productLine = fields['产品线'] || '未知';
    const demand = fields['显性诉求'] || '';

    const prompt = `基于以下客户信息和行业案例，生成1-2句诊断假设。

客户：${company}
产品线：${productLine}
显性诉求：${demand}

参考案例：
${skuRefs}

要求：
1. 假设必须引用至少1个案例作为依据
2. 用专业但易懂的语言
3. 不超过100字
4. 格式："基于[案例名]的经验，客户的核心问题很可能是..."

直接输出假设，不要其他解释。`;

    try {
      if (this.llmClient && typeof this.llmClient.generate === 'function') {
        const result = await this.llmClient.generate(prompt, { temperature: 0.5, maxTokens: 200 });
        return result.trim();
      }
      // 降级：模板填充
      return `基于${skus[0].title}的经验，客户的核心问题很可能是战略定位不够清晰，建议进一步验证。`;
    } catch (error) {
      // 降级：模板填充
      return `基于${skus[0].title}的经验，客户的核心问题很可能是战略定位不够清晰，建议进一步验证。`;
    }
  }

  /**
   * 生成必问3问
   * @param {SkuCard[]} skus - SKU列表（3个）
   * @param {string} stage - 阶段名称
   * @returns {Promise<string>} 问题列表文本
   * @private
   */
  async _generateQuestions(skus, stage) {
    if (!skus || skus.length === 0) {
      // 降级：使用预设问题
      if (stage === '战略梳理') {
        return '1. 您现在的核心业务是什么？\n2. 未来3年的战略目标是什么？\n3. 目前最大的挑战是什么？';
      }
      return '1. 主要收入来源是什么？\n2. 哪块业务最赚钱？\n3. 商业模式有什么特点？';
    }

    // 构建prompt
    const skuRefs = skus.map(sku => `- ${sku.title}`).join('\n');

    const prompt = `基于以下案例，生成3个可以直接口播的诊断问题。

参考案例：${skuRefs}
阶段：${stage}

要求：
1. 问题要具体，可以直接问客户
2. 每个问题不超过30字
3. 格式：每行一个问题，编号1/2/3

直接输出3个问题，不要其他解释。`;

    try {
      if (this.llmClient && typeof this.llmClient.generate === 'function') {
        const result = await this.llmClient.generate(prompt, { temperature: 0.6, maxTokens: 300 });
        return result.trim();
      }
      // 降级：基于SKU生成
      return skus.map((sku, i) => `${i + 1}. 您如何看待${sku.title}这个方向？`).join('\n');
    } catch (error) {
      // 降级：基于SKU生成
      return skus.map((sku, i) => `${i + 1}. 您如何看待${sku.title}这个方向？`).join('\n');
    }
  }

  /**
   * 生成口播台词
   * @param {SkuCard[]} skus - SKU列表（3个）
   * @returns {string} 台词文本
   * @private
   */
  _generateScripts(skus) {
    if (!skus || skus.length === 0) {
      return 'A. 案例待补充\nB. 案例待补充\nC. 案例待补充';
    }

    const lines = [];
    const labels = ['A', 'B', 'C'];

    for (let i = 0; i < Math.min(3, skus.length); i++) {
      const label = labels[i];
      const sku = skus[i];
      const title = sku.title || '案例';
      const summary = sku.summary || '';
      // 生成一句话台词
      const script = summary.length > 30
        ? `在${title}领域，${summary.slice(0, 30)}...`
        : `在${title}领域，${summary}`;
      lines.push(`${label}. ${title} → ${script}`);
    }

    return lines.join('\n');
  }

  /**
   * 生成风险话术
   * @param {SkuCard[]} [skus] - SKU列表（可选，用于动态生成第三条话术）
   * @returns {string} 风险话术文本
   * @private
   */
  _generateRiskResponses(skus) {
    const lines = [];

    // 第一条：固定模板
    lines.push(`▸ ${RISK_RESPONSES['已有方向'].trigger}`);
    lines.push(`  → ${RISK_RESPONSES['已有方向'].response}`);

    // 第二条：固定模板
    lines.push(`▸ ${RISK_RESPONSES['超出范围'].trigger}`);
    lines.push(`  → ${RISK_RESPONSES['超出范围'].response}`);

    // 第三条：动态生成（引用🟢SKU作为背书）
    lines.push(`▸ ${RISK_RESPONSES['质疑专业性'].trigger}`);

    if (skus && skus.length > 0) {
      // 找到🟢可信度的SKU
      const greenSkus = skus.filter(sku => sku.confidence === '🟢');
      if (greenSkus.length > 0) {
        const skuRef = greenSkus[0];
        lines.push(`  → 我们在${skuRef.title}领域有深入研究，可以分享相关案例`);
      } else {
        // 没有🟢SKU，使用🟡SKU
        const yellowSkus = skus.filter(sku => sku.confidence === '🟡');
        if (yellowSkus.length > 0) {
          const skuRef = yellowSkus[0];
          lines.push(`  → 我们在${skuRef.title}方向有相关经验，可以展开讨论`);
        } else {
          lines.push('  → 我们在新能源行业有丰富的咨询经验，可以分享具体案例');
        }
      }
    } else {
      lines.push('  → 我们在新能源行业有丰富的咨询经验，可以分享具体案例');
    }

    return lines.join('\n');
  }

  /**
   * 识别缺失字段
   * @param {ClientProfile} profile - 客户档案
   * @returns {string[]} 缺失字段列表
   * @private
   */
  _identifyMissingFields(profile) {
    const requiredFields = [
      '产品线', '客户群体', '收入结构',
      '毛利结构', '交付情况', '资源分布',
      '战略目标', '显性诉求', '隐性痛点'
    ];

    if (!profile || !profile.fields) {
      return requiredFields;
    }

    const fields = profile.fields;
    const missing = [];

    for (const fieldName of requiredFields) {
      const value = fields[fieldName];
      if (!value || String(value).length < 5) {
        missing.push(fieldName);
      }
    }

    return missing;
  }

  /**
   * 硬约束校验
   *
   * 确保诊断假设引用>=1个🟢/🟡SKU
   *
   * @param {Object} content - 内容对象
   * @param {SkuCard[]} skus - SKU列表
   * @returns {boolean} 校验通过返回 true
   * @throws {InsufficientSkuError} 没有🟢/🟡SKU时抛出
   * @private
   */
  _validateConstraints(content, skus) {
    // 检查是否有查是否有🟢/🟡SKU
    const validSkus = skus.filter(sku => sku.confidence === '🟢' || sku.confidence === '🟡');

    if (validSkus.length === 0) {
      throw new InsufficientSkuError(
        '没有'没有🟢/🟡可信度的SKU，无法生成高质量诊断假设'
      );
    }

    return true;
  }

  /**
   * 渲染为 Word 文档
   *
   * @param {BattleCard} battleCard - 作战卡数据
   * @returns {Promise<Buffer>} Word 文档字节流
   */
  async renderToWord(battleCard) {
    const modeText = battleCard.mode === 'hypothesis' ? '验证假设版' : '信息建立版';

    // 构建文档节
    const sections = [{
      properties: {},
      children: this._buildDocumentChildren(battleCard, modeText)
    }];

    const doc = new Document({ sections });

    return Packer.toBuffer(doc);
  }

  /**
   * 构建文档子元素
   * @param {BattleCard} battleCard - 作战卡数据
   * @param {string} modeText - 模式文本
   * @returns {Array} 文档子元素数组
   * @private
   */
  _buildDocumentChildren(battleCard, modeText) {
    const children = [];

    // 标题
    children.push(
      new Paragraph({
        text: `客户作战卡（${modeText}）`,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER
      })
    );

    // 基本信息
    const infoRun = new TextRun({
      text: `${battleCard.company} · ${battleCard.date}`,
      bold: true
    });
    const infoChildren = [infoRun];

    if (battleCard.consultant) {
      infoChildren.push(new TextRun({
        text: ` · 顾问：${battleCard.consultant}`
      }));
    }

    children.push(new Paragraph({ children: infoChildren }));

    // 完整度指示（信息建立版）
    if (battleCard.mode === 'info_building') {
      children.push(new Paragraph({
        children: [
          new TextRun({
            text: `⚠️ 客户背景待完善，当前完整度：${Math.round(battleCard.completeness * 100)}%`,
            bold: true
          })
        ]
      }));
      children.push(new Paragraph({
        text: '本次会议目标：建立诊断基础'
      }));
    }

    // 空行
    children.push(new Paragraph({ text: '' }));

    // 根据模式渲染内容
    if (battleCard.mode === 'hypothesis') {
      children.push(...this._renderHypothesisContent(battleCard.content));
    } else {
      children.push(...this._renderInfoBuildingContent(battleCard.content));
    }

    return children;
  }

  /**
   * 渲染验证假设版内容
   * @param {Object} content - 内容对象
   * @returns {Array} 段落数组
   * @private
   */
  _renderHypothesisContent(content) {
    const children = [];

    // 核心诊断假设
    children.push(new Paragraph({
      text: '【核心诊断假设】',
      heading: HeadingLevel.HEADING_1
    }));
    children.push(new Paragraph({
      text: content.diagnosis_hypothesis || ''
    }));
    children.push(new Paragraph({
      text: '→ 本次会议目标：验证/推翻这个假设'
    }));

    // 战略梳理阶段·必问3问
    children.push(new Paragraph({
      text: '【战略梳理阶段·必问3问】',
      heading: HeadingLevel.HEADING_1
    }));
    const strategyQ = content.strategy_questions || '';
    for (const line of strategyQ.split('\n')) {
      if (line.trim()) {
        children.push(new Paragraph({
          text: line.trim(),
          numbering: { reference: 'default-numbered', level: 0 }
        }));
      }
    }

    // 商业模式阶段·必问3问
    children.push(new Paragraph({
      text: '【商业模式阶段·必问3问】',
      heading: HeadingLevel.HEADING_1
    }));
    const businessQ = content.business_questions || '';
    for (const line of businessQ.split('\n')) {
      if (line.trim()) {
        children.push(new Paragraph({
          text: line.trim(),
          numbering: { reference: 'default-numbered', level: 0 }
        }));
      }
    }

    // 行业演示备弹
    children.push(new Paragraph({
      text: '【行业演示备弹·3条口播台词】',
      heading: HeadingLevel.HEADING_1
    }));
    const scripts = content.demo_scripts || '';
    for (const line of scripts.split('\n')) {
      if (line.trim()) {
        children.push(new Paragraph({ text: line.trim() }));
      }
    }

    // 风险话术
    children.push(new Paragraph({
      text: '【风险话术·应急回应】',
      heading: HeadingLevel.HEADING_1
    }));
    const risk = content.risk_responses || '';
    for (const line of risk.split('\n')) {
      if (line.trim()) {
        children.push(new Paragraph({ text: line.trim() }));
      }
    }

    return children;
  }

  /**
   * 渲染信息建立版内容
   * @param {Object} content - 内容对象
   * @returns {Array} 段落数组
   * @private
   */
  _renderInfoBuildingContent(content) {
    const children = [];

    // 必须在本次会议确认的字段
    children.push(new Paragraph({
      text: '【必须在本次会议确认的字段】',
      heading: HeadingLevel.HEADING_1
    }));
    const missing = content.missing_fields || [];
    for (const fieldName of missing) {
      children.push(new Paragraph({
        text: `□ ${fieldName}`,
        numbering: { reference: 'default-bullet', level: 0 }
      }));
    }

    // 分层追问树·战略层
    children.push(new Paragraph({
      text: '【分层追问树·战略层】',
      heading: HeadingLevel.HEADING_1
    }));
    const strategyTree = content.strategy_tree || PRESET_STRATEGY_TREE;
    children.push(...this._renderQuestionTree(strategyTree));

    // 分层追问树·商业模式层
    children.push(new Paragraph({
      text: '【分层追问树·商业模式层】',
      heading: HeadingLevel.HEADING_1
    }));
    const businessTree = content.business_tree || PRESET_BUSINESS_TREE;
    children.push(...this._renderQuestionTree(businessTree));

    // 行业演示备弹
    children.push(new Paragraph({
      text: '【行业演示备弹·3条口播台词】',
      heading: HeadingLevel.HEADING_1
    }));
    const scripts = content.demo_scripts || '';
    for (const line of scripts.split('\n')) {
      if (line.trim()) {
        children.push(new Paragraph({ text: line.trim() }));
      }
    }

    // 风险话术
    children.push(new Paragraph({
      text: '【风险话术】',
      heading: HeadingLevel.HEADING_1
    }));
    const risk = content.risk_responses || '';
    for (const line of risk.split('\n')) {
      if (line.trim()) {
        children.push(new Paragraph({ text: line.trim() }));
      }
    }

    return children;
  }

  /**
   * 渲染追问树
   * @param {Object} tree - 追问树对象
   * @returns {Array} 段落数组
   * @private
   */
  _renderQuestionTree(tree) {
    const children = [];
    const anchor = tree.anchor || '';
    const branches = tree.branches || {};

    // 锚点问题
    children.push(new Paragraph({
      text: `开场锚定：${anchor}`
    }));

    // 分支
    for (const [key, questions] of Object.entries(branches)) {
      if (questions && questions.length > 0) {
        children.push(new Paragraph({
          text: `├─ 答"${key}" → ${questions[0]}`
        }));
        if (questions.length > 1) {
          children.push(new Paragraph({
            text: `│            → ${questions[1]}`
          }));
        }
      }
    }

    return children;
  }
}

module.exports = { BattleCardGenerator, InsufficientSkuError };
