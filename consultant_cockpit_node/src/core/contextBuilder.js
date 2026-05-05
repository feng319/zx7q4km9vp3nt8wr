// @ts-check
/**
 * 上下文构建器 - 为候选生成、备忘录等模块提供结构化上下文
 * @module core/contextBuilder
 */

const { CLIENT_PROFILE_FIELDS, FIELD_SOURCE_EXCLUDE } = require('./gapIdentifier');

/**
 * 记录来源优先级（数字越小优先级越高）
 */
const FIELD_SOURCE_PRIORITY = [
  'hypothesis_confirmed',
  'candidate_selected',
  'hypothesis_partial',
  'manual',
  'unplanned_info',
  'ai_suggested',
  'previous_meeting'
];

/**
 * 本体引用规则（用于候选生成时的知识匹配）
 */
const ONTOLOGY_REFERENCE_RULES = {
  // 战略梳理阶段关注点
  '战略梳理': ['战略目标', '资源分布', '收入结构'],
  // 商业模式阶段关注点
  '商业模式': ['产品线', '客户群体', '毛利结构', '交付情况'],
  // 行业演示阶段关注点
  '行业演示': ['客户群体', '产品线', '战略目标']
};

/**
 * 字段值对象
 * @typedef {Object} FieldValue
 * @property {string} value - 字段值
 * @property {string} source - 来源类型
 * @property {'high'|'medium'|'low'} weight - 权重
 */

/**
 * 假设分组
 * @typedef {Object} HypothesisGroup
 * @property {import('../types').DiagnosisHypothesis[]} unverified - 未验证
 * @property {import('../types').DiagnosisHypothesis[]} confirmed - 已确认
 * @property {import('../types').DiagnosisHypothesis[]} rejected - 已推翻
 * @property {import('../types').DiagnosisHypothesis[]} partial - 部分成立
 * @property {import('../types').DiagnosisHypothesis[]} avoided - 已回避
 */

/**
 * 构建后的上下文
 * @typedef {Object} BuiltContext
 * @property {Object.<string, FieldValue>} fields - 字段值映射
 * @property {import('../types').Stage} stage - 当前阶段
 * @property {HypothesisGroup} hypotheses - 假设分组
 * @property {import('../types').ConsensusRecord[]} recentFacts - 最近事实
 * @property {Object} knowledgeRules - 知识规则
 */

/**
 * 上下文构建器类
 */
class ContextBuilder {
  /**
   * @param {Object} options - 配置选项
   * @param {import('../types').ConsensusRecord[]} options.records - 共识链记录
   * @param {Object} [options.clientProfile] - 客户档案（背景信息）
   * @param {import('../types').DiagnosisHypothesis[]} [options.hypotheses] - 诊断假设列表
   * @param {import('../types').Stage} [options.currentStage] - 当前阶段
   */
  constructor(options) {
    /** @type {import('../types').ConsensusRecord[]} */
    this.records = options.records || [];
    /** @type {Object} */
    this.clientProfile = options.clientProfile || {};
    /** @type {import('../types').DiagnosisHypothesis[]} */
    this.hypotheses = options.hypotheses || [];
    /** @type {import('../types').Stage} */
    this.currentStage = options.currentStage || '战略梳理';
  }

  /**
   * 构建完整上下文
   * @param {string} caller - 调用者标识（'candidate' | 'memo' | 'suggestion' | 'hypothesis'）
   * @returns {BuiltContext} 构建后的上下文
   */
  build(caller = 'suggestion') {
    const context = {
      fields: this._buildFields(),
      stage: this.currentStage,
      hypotheses: this._buildHypotheses(),
      recentFacts: this._getRecentFacts(5),
      knowledgeRules: ONTOLOGY_REFERENCE_RULES
    };

    return this._filterByCaller(context, caller);
  }

  /**
   * 构建字段值映射
   * @returns {Object.<string, FieldValue>}
   */
  _buildFields() {
    const result = {};

    for (const field of CLIENT_PROFILE_FIELDS) {
      // 查找该字段的所有候选记录
      const candidates = this.records.filter(r =>
        r.target_field === field &&
        !FIELD_SOURCE_EXCLUDE.has(r.source) &&
        ['confirmed', 'recorded', 'pending_client_confirm'].includes(r.status)
      );

      if (candidates.length === 0) {
        // 没有共识记录，尝试使用背景信息
        const background = this.clientProfile[field];
        if (background) {
          result[field] = {
            value: background,
            source: 'background_info',
            weight: 'low'
          };
        }
        continue;
      }

      // 选择优先级最高的记录
      const best = candidates.reduce((a, b) => {
        const aIdx = FIELD_SOURCE_PRIORITY.indexOf(a.source);
        const bIdx = FIELD_SOURCE_PRIORITY.indexOf(b.source);
        // 优先级相同时，选择更新的记录
        if (aIdx === bIdx) {
          return new Date(a.timestamp) > new Date(b.timestamp) ? a : b;
        }
        return aIdx < bIdx ? a : b;
      });

      result[field] = {
        value: best.content,
        source: best.source,
        weight: best.status === 'confirmed' ? 'high' : 'medium'
      };
    }

    return result;
  }

  /**
   * 构建假设分组
   * @returns {HypothesisGroup}
   */
  _buildHypotheses() {
    return {
      unverified: this.hypotheses.filter(h => h.status === 'unverified'),
      confirmed: this.hypotheses.filter(h => h.status === 'confirmed'),
      rejected: this.hypotheses.filter(h => h.status === 'rejected'),
      partial: this.hypotheses.filter(h => h.status === 'partial'),
      avoided: this.hypotheses.filter(h => h.status === 'avoided')
    };
  }

  /**
   * 获取最近 N 条事实记录
   * @param {number} count - 数量
   * @returns {import('../types').ConsensusRecord[]}
   */
  _getRecentFacts(count) {
    return this.records
      .filter(r =>
        r.type === 'fact' &&
        !FIELD_SOURCE_EXCLUDE.has(r.source) &&
        ['confirmed', 'recorded'].includes(r.status)
      )
      .slice(-count);
  }

  /**
   * 根据调用者过滤上下文
   * @param {BuiltContext} context - 原始上下文
   * @param {string} caller - 调用者标识
   * @returns {BuiltContext} 过滤后的上下文
   */
  _filterByCaller(context, caller) {
    // 候选生成和备忘录只使用高权重字段
    if (caller === 'candidate' || caller === 'memo') {
      context.fields = Object.fromEntries(
        Object.entries(context.fields).filter(([_, v]) => v.weight === 'high')
      );
    }

    // 追问建议需要所有字段（包括缺失的）
    if (caller === 'suggestion') {
      // 标记缺失字段
      context.missingFields = CLIENT_PROFILE_FIELDS.filter(
        field => !context.fields[field]
      );
    }

    return context;
  }

  /**
   * 生成上下文摘要（用于 LLM prompt）
   * @param {BuiltContext} [context] - 上下文对象（可选，默认使用 build() 结果）
   * @returns {string} 格式化的上下文摘要
   */
  toSummary(context) {
    const ctx = context || this.build('suggestion');
    const lines = [];

    // 已确认字段
    lines.push('【已确认信息】');
    for (const [field, value] of Object.entries(ctx.fields)) {
      if (value.weight === 'high') {
        lines.push(`- ${field}: ${value.value}`);
      }
    }

    // 缺失字段
    if (ctx.missingFields && ctx.missingFields.length > 0) {
      lines.push('');
      lines.push('【待确认信息】');
      for (const field of ctx.missingFields) {
        lines.push(`- ${field}: 未知`);
      }
    }

    // 未验证假设
    if (ctx.hypotheses.unverified.length > 0) {
      lines.push('');
      lines.push('【待验证假设】');
      for (const hyp of ctx.hypotheses.unverified.slice(0, 3)) {
        lines.push(`- ${hyp.content}`);
      }
    }

    // 最近事实
    if (ctx.recentFacts.length > 0) {
      lines.push('');
      lines.push('【最近确认事实】');
      for (const fact of ctx.recentFacts.slice(-3)) {
        lines.push(`- ${fact.content}`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * 快速构建上下文的便捷函数
 * @param {Object} options - 配置选项
 * @param {string} [caller='suggestion'] - 调用者标识
 * @returns {BuiltContext}
 */
function buildContext(options, caller = 'suggestion') {
  const builder = new ContextBuilder(options);
  return builder.build(caller);
}

module.exports = {
  ContextBuilder,
  buildContext,
  FIELD_SOURCE_PRIORITY,
  ONTOLOGY_REFERENCE_RULES
};
