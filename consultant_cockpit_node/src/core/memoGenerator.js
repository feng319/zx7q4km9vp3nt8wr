// @ts-check
/**
 * 备忘录生成器（三层架构）
 *
 * 三层架构：
 * 1. extractData() - 数据提取（确定性规则）
 * 2. generateStructure() - 结构组装（模板 + 规则）
 * 3. polishChapter() - AI 润色（带超时保护）
 *
 * 设计文档 4.5 节和 7.3 节映射表：
 * - 一、问题重构
 * - 二、关键发现（按优先级排序）
 * - 三、初步建议方向
 * - 四、需要进一步访谈
 * - 五、建议下一步合作方式（服务包推荐）
 */

const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');
const { calcCompleteness, getCompletenessFieldNames } = require('../config/fields');

/**
 * @typedef {import('../types').ConsensusRecord} ConsensusRecord
 * @typedef {import('../types').MemoDocument} MemoDocument
 * @typedef {import('../types').ClientProfileFields} ClientProfileFields
 */

/**
 * LLM 超时配置（秒）
 * @type {number}
 */
const LLM_TIMEOUT_SECONDS = 10;

/**
 * 备忘录生成器类
 */
class MemoGenerator {
  /**
   * @param {Object} options
   * @param {import('./consensusChain').ConsensusChain} options.consensusChain - 共识链实例
   * @param {import('../utils/llmClient').LLMClient} [options.llmClient] - LLM 客户端（可选）
   * @param {ClientProfileFields} [options.clientProfile] - 客户档案（可选）
   * @param {import('./fallbackHandler').FallbackHandler} [options.fallbackHandler] - 降级处理器（可选）
   */
  constructor(options) {
    if (!options || !options.consensusChain) {
      throw new Error('consensusChain is required');
    }

    /**
     * @type {import('./consensusChain').ConsensusChain}
     */
    this.consensusChain = options.consensusChain;

    /**
     * @type {import('../utils/llmClient').LLMClient|null}
     */
    this.llmClient = options.llmClient || null;

    /**
     * @type {ClientProfileFields}
     */
    this.clientProfile = options.clientProfile || {};

    /**
     * @type {import('./fallbackHandler').FallbackHandler}
     */
    this.fallbackHandler = options.fallbackHandler || null;
  }

  /**
   * 剥离内部元数据字段（来源等），防止写入 Word 或传给 LLM
   * @param {Object} direction - 方向对象
   * @returns {Object} 剥离后的对象
   * @private
   */
  _stripMetadata(direction) {
    return {
      方向: direction.方向 || ''
      // 注意：不包含"来源"字段
    };
  }

  /**
   * 第一层：数据提取（确定性规则）
   *
   * 从共识链中提取已确认事实、已确认判断、待确认判断
   *
   * @returns {{facts: Array, consensus: Array, pending: Array, client_profile: ClientProfileFields}}
   */
  extractData() {
    /** @type {{facts: Array, consensus: Array, pending: Array, client_profile: ClientProfileFields}} */
    const data = {
      facts: [],
      consensus: [],
      pending: [],
      client_profile: this.clientProfile
    };

    // 提取已确认事实
    const confirmedFacts = this.consensusChain.getConfirmedFacts();
    for (const record of confirmedFacts) {
      data.facts.push({
        stage: record.stage,
        content: record.content,
        source: record.source
      });
    }

    // 提取已确认判断
    const confirmedConsensus = this.consensusChain.getConfirmedConsensus();
    for (const record of confirmedConsensus) {
      data.consensus.push({
        content: record.content,
        source: record.source,
        recommendation: record.recommendation
      });
    }

    // 提取待确认判断
    const pendingConsensus = this.consensusChain.getPendingConsensus();
    for (const record of pendingConsensus) {
      data.pending.push({
        content: record.content
      });
    }

    return data;
  }

  /**
   * 第二层：结构组装（模板 + 规则）
   *
   * 设计文档 4.5 节和 7.3 节映射表：
   * - 一、问题重构
   * - 二、关键发现（按优先级排序）
   * - 三、初步建议方向
   * - 四、需要进一步访谈
   * - 五、建议下一步合作方式（服务包推荐）
   *
   * @returns {MemoDocument}
   */
  generateStructure() {
    const data = this.extractData();

    /** @type {MemoDocument} */
    const structure = {
      chapters: {
        问题重构: {
          原始诉求: '',
          核心问题: ''
        },
        关键发现: {
          战略层面: [],
          商业模式层面: []
        },
        初步建议方向: [],
        需要进一步访谈: [],
        建议下一步合作方式: {
          推荐服务包: '',
          理由: '',
          下一步: ''
        }
      }
    };

    // 一、问题重构
    structure.chapters.问题重构 = {
      原始诉求: data.client_profile.显性诉求 || '',
      核心问题: data.consensus.length > 0 ? data.consensus[0].content : ''
    };

    // 二、关键发现（按优先级排序：source=candidate_selected > 时间戳最早 > 时间戳最新）
    const strategyFacts = this._sortFactsByPriority(
      data.facts.filter(f => f.stage === '战略梳理')
    );
    const businessFacts = this._sortFactsByPriority(
      data.facts.filter(f => f.stage === '商业模式')
    );

    structure.chapters.关键发现 = {
      战略层面: strategyFacts.slice(0, 3).map(f => f.content),
      商业模式层面: businessFacts.slice(0, 3).map(f => f.content)
    };

    // 超过 3 条的降级到"需要进一步访谈"
    const extraFacts = [
      ...strategyFacts.slice(3).map(f => f.content),
      ...businessFacts.slice(3).map(f => f.content)
    ];

    // 三、初步建议方向
    structure.chapters.初步建议方向 = data.consensus.map(c => ({
      方向: c.recommendation || c.content,
      来源: c.source === 'candidate_selected' ? '系统生成' : '顾问判断'
    }));

    // 四、需要进一步访谈
    structure.chapters.需要进一步访谈 = [
      ...data.pending.map(p => p.content),
      ...extraFacts
    ];

    // 五、建议下一步合作方式（设计文档 7.6 节）
    structure.chapters.建议下一步合作方式 = this.generateServiceRecommendation(data);

    return structure;
  }

  /**
   * 按优先级排序事实
   *
   * 规则（设计文档 7.3 节）：
   * 1. source=candidate_selected 优先
   * 2. 时间戳最早优先
   * 3. 时间戳最新优先
   *
   * @param {Array<{stage: string, content: string, source: string}>} facts - 事实列表
   * @returns {Array<{stage: string, content: string, source: string}>} 排序后的事实列表
   * @private
   */
  _sortFactsByPriority(facts) {
    return facts.sort((a, b) => {
      // source=candidate_selected 排最前
      const aPriority = a.source === 'candidate_selected' ? 0 : 1;
      const bPriority = b.source === 'candidate_selected' ? 0 : 1;
      return aPriority - bPriority;
    });
  }

  /**
   * 生成服务包推荐（设计文档 7.6 节）
   *
   * 逻辑：
   * - 共识链确认条数 >= 5 且完整度 >= 60%：推荐"深度诊断服务包"
   * - 共识链确认条数 >= 3 且完整度 >= 40%：推荐"初步诊断服务包"
   * - 其他：推荐"免费初步沟通"
   *
   * @param {Object} data - extractData 的返回值
   * @returns {{推荐服务包: string, 理由: string, 下一步: string}}
   */
  generateServiceRecommendation(data) {
    const confirmedCount = data.consensus.length + data.facts.length;
    const completeness = this._calcProfileCompleteness(data.client_profile);

    if (confirmedCount >= 5 && completeness >= 0.6) {
      return {
        推荐服务包: '深度诊断服务包',
        理由: `已确认${confirmedCount}条共识，客户档案完整度${Math.round(completeness * 100)}%，建议进入深度诊断阶段`,
        下一步: '安排2-3次深度访谈，聚焦关键决策点'
      };
    } else if (confirmedCount >= 3 && completeness >= 0.4) {
      return {
        推荐服务包: '初步诊断服务包',
        理由: `已确认${confirmedCount}条共识，建议进一步明确诊断方向`,
        下一步: '补充关键信息，完善客户档案'
      };
    } else {
      return {
        推荐服务包: '免费初步沟通',
        理由: `当前共识条数${confirmedCount}条，建议继续建立信任关系`,
        下一步: '聚焦客户痛点，收集更多背景信息'
      };
    }
  }

  /**
   * 计算客户档案完整度
   *
   * @param {ClientProfileFields} profile - 客户档案
   * @returns {number} 完整度 0-1
   * @private
   */
  _calcProfileCompleteness(profile) {
    if (!profile || Object.keys(profile).length === 0) {
      return 0.0;
    }

    const requiredFields = [
      '产品线', '客户群体', '收入结构', '毛利结构',
      '交付情况', '资源分布', '战略目标', '显性诉求'
    ];

    let filled = 0;
    for (const field of requiredFields) {
      const value = profile[field];
      if (value && String(value).length >= 5) {
        filled++;
      }
    }

    return filled / requiredFields.length;
  }

  /**
   * 第三层：AI 润色章节（带超时保护）
   *
   * @param {Object} chapterData - 章节数据（键值对或列表）
   * @param {number} [maxWords=200] - 最大字数限制
   * @returns {Promise<string>} 润色后的段落文字，或降级后的要点列表
   */
  async polishChapter(chapterData, maxWords = 200) {
    // 降级：无 LLM 时直接返回要点列表
    if (!this.llmClient) {
      return this._formatAsBullets(chapterData);
    }

    const prompt = `请将以下要点转化成连贯的段落文字。

要求：
1. 只能用下面的要点，不能添加任何额外信息
2. 字数不超过${maxWords}字
3. 所有数字和专有名词必须与原始要点完全一致
4. 语气专业、客观、建设性，不使用夸张词汇

要点：
${JSON.stringify(chapterData, null, 2)}

直接输出润色后的段落，不要其他解释。`;

    // 使用降级处理器进行超时保护
    if (this.fallbackHandler) {
      const result = await this.fallbackHandler.handleLlmTimeout(
        () => this.llmClient.generate(prompt, { temperature: 0.3 }),
        LLM_TIMEOUT_SECONDS,
        this._formatAsBullets(chapterData)
      );

      if (result.success) {
        let polished = result.data.result || '';
        // 字数截断
        if (polished.length > maxWords) {
          polished = polished.substring(0, maxWords) + '...';
        }
        return polished;
      } else {
        // 超时降级：使用原始要点
        return result.data.fallback_value || this._formatAsBullets(chapterData);
      }
    }

    // 无降级处理器时，直接调用 LLM
    try {
      const polished = await this.llmClient.generate(prompt, { temperature: 0.3 });
      // 字数截断
      if (polished.length > maxWords) {
        return polished.substring(0, maxWords) + '...';
      }
      return polished;
    } catch (error) {
      // 出错时降级为要点列表
      return this._formatAsBullets(chapterData);
    }
  }

  /**
   * 降级：格式化为要点列表
   *
   * @param {Object} chapterData - 章节数据
   * @returns {string} 要点列表文本
   * @private
   */
  _formatAsBullets(chapterData) {
    const lines = [];

    if (typeof chapterData !== 'object' || chapterData === null) {
      return String(chapterData);
    }

    for (const [key, value] of Object.entries(chapterData)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          lines.push(`- ${item}`);
        }
      } else if (typeof value === 'object' && value !== null) {
        lines.push(`- ${key}: ${JSON.stringify(value)}`);
      } else {
        lines.push(`- ${key}: ${value}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 生成 Word 文档
   *
   * @param {string} outputPath - 输出文件路径
   * @returns {Promise<void>}
   */
  async generateWord(outputPath) {
    const structure = this.generateStructure();

    // 创建文档
    const doc = new Document({
      sections: [{
        properties: {},
        children: this._buildDocumentContent(structure)
      }]
    });

    // 生成 buffer 并写入文件
    const buffer = await Packer.toBuffer(doc);

    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, buffer);
  }

  /**
   * 构建文档内容
   *
   * @param {MemoDocument} structure - 备忘录结构
   * @returns {Array} docx 段落数组
   * @private
   */
  _buildDocumentContent(structure) {
    const children = [];

    // 标题
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '客户初步诊断备忘录',
            bold: true,
            size: 32, // 16pt
            font: '微软雅黑'
          })
        ],
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER
      })
    );

    // 一、问题重构
    children.push(this._createHeading1('一、问题重构'));
    const problem = structure.chapters.问题重构;
    children.push(this._createParagraph(`原始诉求: ${problem.原始诉求}`));
    children.push(this._createParagraph(`诊断后的核心问题: ${problem.核心问题}`));

    // 二、关键发现
    children.push(this._createHeading1('二、关键发现'));
    const findings = structure.chapters.关键发现;

    if (findings.战略层面.length > 0) {
      children.push(this._createHeading2('战略层面'));
      for (const fact of findings.战略层面) {
        children.push(this._createBulletParagraph(fact));
      }
    }

    if (findings.商业模式层面.length > 0) {
      children.push(this._createHeading2('商业模式层面'));
      for (const fact of findings.商业模式层面) {
        children.push(this._createBulletParagraph(fact));
      }
    }

    // 三、初步建议方向
    children.push(this._createHeading1('三、初步建议方向'));
    const directions = structure.chapters.初步建议方向;
    for (let i = 0; i < directions.length; i++) {
      const direction = directions[i];
      // 剥离内部元数据后再写入 Word
      const cleanDirection = this._stripMetadata(direction);
      children.push(this._createParagraph(`方向${i + 1}: ${cleanDirection.方向}`));
    }

    // 四、需要进一步访谈
    children.push(this._createHeading1('四、需要进一步访谈'));
    const pendingItems = structure.chapters.需要进一步访谈;
    for (const item of pendingItems) {
      children.push(this._createBulletParagraph(item));
    }

    // 五、建议下一步合作方式
    children.push(this._createHeading1('五、建议下一步合作方式'));
    const recommendation = structure.chapters.建议下一步合作方式;
    children.push(this._createParagraph(`推荐服务包: ${recommendation.推荐服务包}`));
    children.push(this._createParagraph(`理由: ${recommendation.理由}`));
    children.push(this._createParagraph(`下一步: ${recommendation.下一步}`));

    // 意向探测复选框（PRD 7.6 节）
    children.push(new Paragraph({ text: '' })); // 空行
    children.push(this._createParagraph('请在下方勾选您的意向，或直接回复本消息：'));
    children.push(this._createParagraph('□  希望进入下一阶段合作'));
    children.push(this._createParagraph('□  需要内部讨论后回复'));
    children.push(this._createParagraph('□  建议先了解类似案例'));

    return children;
  }

  /**
   * 创建一级标题
   * @param {string} text - 标题文本
   * @returns {Paragraph}
   * @private
   */
  _createHeading1(text) {
    return new Paragraph({
      children: [
        new TextRun({
          text,
          bold: true,
          size: 28, // 14pt
          font: '微软雅黑'
        })
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 }
    });
  }

  /**
   * 创建二级标题
   * @param {string} text - 标题文本
   * @returns {Paragraph}
   * @private
   */
  _createHeading2(text) {
    return new Paragraph({
      children: [
        new TextRun({
          text,
          bold: true,
          size: 24, // 12pt
          font: '微软雅黑'
        })
      ],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 }
    });
  }

  /**
   * 创建普通段落
   * @param {string} text - 段落文本
   * @returns {Paragraph}
   * @private
   */
  _createParagraph(text) {
    return new Paragraph({
      children: [
        new TextRun({
          text,
          size: 20, // 10pt
          font: '微软雅黑'
        })
      ],
      spacing: { after: 80 }
    });
  }

  /**
   * 创建项目符号段落
   * @param {string} text - 段落文本
   * @returns {Paragraph}
   * @private
   */
  _createBulletParagraph(text) {
    return new Paragraph({
      children: [
        new TextRun({
          text: `• ${text}`,
          size: 20, // 10pt
          font: '微软雅黑'
        })
      ],
      spacing: { after: 60 },
      indent: { left: 360 } // 缩进
    });
  }
}

module.exports = { MemoGenerator, LLM_TIMEOUT_SECONDS };
