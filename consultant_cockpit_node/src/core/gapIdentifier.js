// @ts-check
/**
 * 缺口识别模块 - 识别共识链中的信息缺口
 * @module core/gapIdentifier
 */

/**
 * 客户档案字段列表（按优先级排序）
 */
const CLIENT_PROFILE_FIELDS = [
  '客户公司名',
  '显性诉求',
  '产品线',
  '客户群体',
  '收入结构',
  '毛利结构',
  '交付情况',
  '资源分布',
  '战略目标'
];

/**
 * 不计入字段确认的来源类型
 */
const FIELD_SOURCE_EXCLUDE = new Set([
  'hypothesis_rejected',
  'hypothesis_avoided'
]);

/**
 * 检查指定字段是否有已确认的共识记录
 * @param {string} field - 目标字段名
 * @param {import('../types').ConsensusRecord[]} records - 共识链记录
 * @returns {boolean} 是否有已确认记录
 */
function getConfirmedConsensus(field, records) {
  return records.some(r =>
    r.target_field === field &&
    !FIELD_SOURCE_EXCLUDE.has(r.source) &&
    ['recorded', 'pending_client_confirm', 'confirmed'].includes(r.status)
  );
}

/**
 * 统计已确认事实数量
 * @param {import('../types').ConsensusRecord[]} records - 共识链记录
 * @returns {number} 已确认事实数量
 */
function confirmedFactCount(records) {
  return records.filter(r =>
    r.type === 'fact' &&
    r.status === 'confirmed' &&
    !FIELD_SOURCE_EXCLUDE.has(r.source)
  ).length;
}

/**
 * 缺口类型
 * @typedef {Object} Gap
 * @property {'field'|'hypothesis'|'constraint'} type - 缺口类型
 * @property {string} [field] - 字段名（type=field 时）
 * @property {import('../types').DiagnosisHypothesis} [hypothesis] - 假设对象（type=hypothesis 时）
 * @property {string} message - 缺口描述
 * @property {number} [priority] - 优先级（数字越小优先级越高）
 */

/**
 * 识别共识链中的信息缺口
 * @param {import('../types').ConsensusRecord[]} records - 共识链记录
 * @param {import('../types').DiagnosisHypothesis[]} hypotheses - 诊断假设列表
 * @returns {Gap[]} 缺口列表
 */
function identifyGaps(records, hypotheses) {
  const gaps = [];

  // 1. 客户档案未填字段
  for (const field of CLIENT_PROFILE_FIELDS) {
    if (!getConfirmedConsensus(field, records)) {
      gaps.push({
        type: 'field',
        field,
        message: `未知:${field}`,
        priority: CLIENT_PROFILE_FIELDS.indexOf(field)
      });
    }
  }

  // 2. 未验证假设
  if (hypotheses && hypotheses.length > 0) {
    for (const hyp of hypotheses) {
      if (hyp.status === 'unverified') {
        gaps.push({
          type: 'hypothesis',
          hypothesis: hyp,
          message: `未验证假设:${hyp.content}`,
          priority: 100 + (hyp.priority_score || hyp.order || 0)
        });
      }
    }
  }

  // 3. 候选生成三约束
  const factCount = confirmedFactCount(records);
  if (factCount < 3) {
    gaps.push({
      type: 'constraint',
      message: `已确认事实不足（当前${factCount}条，需≥3条）`,
      priority: 0
    });
  }

  // 按优先级排序
  return gaps.sort((a, b) => (a.priority || 999) - (b.priority || 999));
}

/**
 * 根据缺口生成追问建议
 * @param {Gap} gap - 缺口对象
 * @param {import('../types').DiagnosisHypothesis} [currentHypothesis] - 当前假设（可选）
 * @returns {string[]} 追问建议列表
 */
function generateFollowUpQuestions(gap, currentHypothesis) {
  const questions = [];

  if (gap.type === 'field' && gap.field) {
    // 根据字段类型生成针对性问题
    const fieldQuestions = {
      '客户公司名': ['请问贵公司的全称是？'],
      '显性诉求': ['今天想重点解决什么问题？', '这次咨询的主要目标是什么？'],
      '产品线': ['贵公司主要提供哪些产品或服务？', '核心产品线有哪些？'],
      '客户群体': ['目标客户群体是哪些？', '主要服务哪类客户？'],
      '收入结构': ['收入主要来源是什么？', '各业务线的收入占比大概是多少？'],
      '毛利结构': ['整体毛利率大概在什么水平？', '不同产品线的毛利差异大吗？'],
      '交付情况': ['目前的交付周期是多久？', '交付过程中遇到的主要挑战是什么？'],
      '资源分布': ['团队规模大概多少人？', '主要资源投放在哪些方向？'],
      '战略目标': ['未来1-2年的战略重点是什么？', '公司的发展目标是什么？']
    };
    questions.push(...(fieldQuestions[gap.field] || [`请介绍一下${gap.field}的情况？`]));
  } else if (gap.type === 'hypothesis' && gap.hypothesis) {
    // 使用假设的验证问题
    if (gap.hypothesis.verification_question) {
      questions.push(gap.hypothesis.verification_question);
    }
    // 如果有 playbook，根据状态生成追问
    if (gap.hypothesis.playbook) {
      const playbook = gap.hypothesis.playbook;
      if (currentHypothesis && currentHypothesis.status === 'confirmed' && playbook.if_confirmed) {
        questions.push(...playbook.if_confirmed);
      }
    }
  } else if (gap.type === 'constraint') {
    questions.push('让我们先确认一些基础事实...');
  }

  return questions;
}

/**
 * 获取下一个优先追问建议
 * @param {import('../types').ConsensusRecord[]} records - 共识链记录
 * @param {import('../types').DiagnosisHypothesis[]} hypotheses - 诊断假设列表
 * @returns {{question: string, gap: Gap}|null} 追问建议及对应缺口
 */
function getNextFollowUp(records, hypotheses) {
  const gaps = identifyGaps(records, hypotheses);

  if (gaps.length === 0) {
    return null;
  }

  const topGap = gaps[0];
  const questions = generateFollowUpQuestions(topGap);

  if (questions.length === 0) {
    return null;
  }

  return {
    question: questions[0],
    gap: topGap
  };
}

module.exports = {
  CLIENT_PROFILE_FIELDS,
  FIELD_SOURCE_EXCLUDE,
  identifyGaps,
  getConfirmedConsensus,
  confirmedFactCount,
  generateFollowUpQuestions,
  getNextFollowUp
};
