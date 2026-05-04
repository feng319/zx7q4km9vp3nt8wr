// @ts-check
// src/config/fields.js — 统一字段定义配置
/**
 * @module fields
 * 集中管理所有字段的定义、类型、权重等信息
 * 解决 memoGenerator 和 battleCardGen 字段列表不一致的问题
 */

// ==================== 客户档案完整度计算字段 ====================

/**
 * 完整度计算字段定义
 * PRD 6.2 节：9 个必填字段（等权重，每个字段非空即计 11%）
 *
 * 注意：未包含"客户公司名"（用于筛选，不计入完整度）
 */
const COMPLETENESS_FIELDS = [
  { name: '产品线', weight: 1, minChars: 5 },
  { name: '客户群体', weight: 1, minChars: 5 },
  { name: '收入结构', weight: 1, minChars: 5 },
  { name: '毛利结构', weight: 1, minChars: 5 },
  { name: '交付情况', weight: 1, minChars: 5 },
  { name: '资源分布', weight: 1, minChars: 5 },
  { name: '显性诉求', weight: 1, minChars: 5 },
  { name: '隐性痛点', weight: 1, minChars: 5 },
  { name: '战略目标', weight: 1, minChars: 5 },
];

/**
 * 客户档案所有字段（PRD 1.3 节：10 静态 + 2 动态 = 12 字段）
 */
const PROFILE_FIELDS = [
  // 静态字段（10 个）
  { name: '客户公司名', type: 'text', required: true, completeness: false },
  { name: '产品线', type: 'text', required: true, completeness: true },
  { name: '客户群体', type: 'text', required: true, completeness: true },
  { name: '收入结构', type: 'text', required: true, completeness: true },
  { name: '毛利结构', type: 'text', required: true, completeness: true },
  { name: '交付情况', type: 'text', required: true, completeness: true },
  { name: '资源分布', type: 'text', required: true, completeness: true },
  { name: '显性诉求', type: 'text', required: true, completeness: true },
  { name: '隐性痛点', type: 'text', required: true, completeness: true },
  { name: '战略目标', type: 'text', required: true, completeness: true },
  // 动态字段（2 个）
  { name: '当前追问', type: 'text', required: false, completeness: false },
  { name: '诊断进度', type: 'number', required: false, completeness: false },
];

// ==================== 诊断共识表字段 ====================

/**
 * 诊断共识表类型字段映射（PRD 4.3 节：只有 fact 和 consensus）
 */
const CONSENSUS_TYPE_MAP = {
  // 代码 → 飞书
  toFeishu: {
    'fact': '事实',
    'consensus': '共识',
  },
  // 飞书 → 代码
  toCode: {
    '事实': 'fact',
    '共识': 'consensus',
  },
};

/**
 * 诊断共识表状态字段映射（PRD 4.3 节：4 个状态）
 * 修复：建立 1:1 双向映射，移除 active
 */
const CONSENSUS_STATUS_MAP = {
  // 代码 → 飞书
  toFeishu: {
    'recorded': '已记录',
    'pending_client_confirm': '待确认',
    'confirmed': '已确认',
    'superseded': '已过时',
  },
  // 飞书 → 代码
  toCode: {
    '已记录': 'recorded',
    '待确认': 'pending_client_confirm',
    '已确认': 'confirmed',
    '已过时': 'superseded',
  },
};

/**
 * 诊断共识表所有字段（内部使用，12 列）
 * 注意：PRD 4.4 节客户视图只显示 3 列
 */
const CONSENSUS_FIELDS = [
  { name: '记录ID', type: 'auto', internal: true },
  { name: '时间戳', type: 'text', internal: true },
  { name: '类型', type: 'singleSelect', internal: true },
  { name: '阶段', type: 'singleSelect', internal: true },
  { name: '内容', type: 'text', internal: false }, // → 发现内容
  { name: '来源', type: 'singleSelect', internal: true },
  { name: '关联SKU', type: 'text', internal: true },
  { name: '状态', type: 'singleSelect', internal: true },
  { name: '置信度', type: 'singleSelect', internal: true },
  { name: '替代记录', type: 'text', internal: true },
  { name: '被替代', type: 'text', internal: true },
  { name: '建议方向', type: 'text', internal: false }, // 客户可见
];

/**
 * PRD 4.4 节客户视图字段（3 列）
 */
const CUSTOMER_VIEW_FIELDS = [
  { sourceField: '内容', displayAs: '发现内容' },
  { sourceField: '时间戳', displayAs: '确认时间' },
  { sourceField: '建议方向', displayAs: '建议方向' },
];

// ==================== 工具函数 ====================

/**
 * 计算客户档案完整度
 * @param {Object} profile - 客户档案对象
 * @returns {number} 完整度 0-1
 */
function calcCompleteness(profile) {
  if (!profile || Object.keys(profile).length === 0) {
    return 0;
  }

  let filled = 0;
  for (const field of COMPLETENESS_FIELDS) {
    const value = profile[field.name];
    if (value && String(value).length >= field.minChars) {
      filled++;
    }
  }

  return filled / COMPLETENESS_FIELDS.length;
}

/**
 * 获取完整度计算字段名列表
 * @returns {string[]}
 */
function getCompletenessFieldNames() {
  return COMPLETENESS_FIELDS.map(f => f.name);
}

/**
 * 获取客户档案字段名列表
 * @returns {string[]}
 */
function getProfileFieldNames() {
  return PROFILE_FIELDS.map(f => f.name);
}

/**
 * 转换记录类型（代码 → 飞书）
 * @param {string} type
 * @returns {string}
 */
function typeToFeishu(type) {
  return CONSENSUS_TYPE_MAP.toFeishu[type] || type;
}

/**
 * 转换记录类型（飞书 → 代码）
 * @param {string} type
 * @returns {string}
 */
function typeToCode(type) {
  return CONSENSUS_TYPE_MAP.toCode[type] || type;
}

/**
 * 转换记录状态（代码 → 飞书）
 * @param {string} status
 * @returns {string}
 */
function statusToFeishu(status) {
  return CONSENSUS_STATUS_MAP.toFeishu[status] || status;
}

/**
 * 转换记录状态（飞书 → 代码）
 * @param {string} status
 * @returns {string}
 */
function statusToCode(status) {
  return CONSENSUS_STATUS_MAP.toCode[status] || status;
}

/**
 * 检查类型是否有效（PRD 定义）
 * @param {string} type
 * @returns {boolean}
 */
function isValidType(type) {
  return type === 'fact' || type === 'consensus';
}

/**
 * 将内部记录转换为客户视图格式（PRD 4.4 节：3 列）
 * 用于投屏、客户可见场景
 * @param {Object} record - 内部记录对象（含所有字段）
 * @returns {Object} 客户视图记录（只有 3 列）
 */
function toCustomerView(record) {
  return {
    '发现内容': record.content || record['内容'] || '',
    '确认时间': record.timestamp || record['时间戳'] || '',
    '建议方向': record.recommendation || record['建议方向'] || '',
  };
}

/**
 * 批量转换内部记录为客户视图格式
 * @param {Object[]} records - 内部记录数组
 * @returns {Object[]} 客户视图记录数组
 */
function toCustomerViewBatch(records) {
  if (!Array.isArray(records)) return [];
  return records.map(toCustomerView);
}

/**
 * 过滤出客户可见的字段（internal: false）
 * @param {Object} record - 内部记录对象
 * @returns {Object} 只含客户可见字段的记录
 */
function filterCustomerFields(record) {
  const result = {};
  for (const field of CONSENSUS_FIELDS) {
    if (!field.internal) {
      const value = record[field.name] || record[field.name.toLowerCase()];
      if (value !== undefined) {
        result[field.name] = value;
      }
    }
  }
  return result;
}

module.exports = {
  // 常量
  COMPLETENESS_FIELDS,
  PROFILE_FIELDS,
  CONSENSUS_TYPE_MAP,
  CONSENSUS_STATUS_MAP,
  CONSENSUS_FIELDS,
  CUSTOMER_VIEW_FIELDS,

  // 工具函数
  calcCompleteness,
  getCompletenessFieldNames,
  getProfileFieldNames,
  typeToFeishu,
  typeToCode,
  statusToFeishu,
  statusToCode,
  isValidType,

  // 客户视图转换函数
  toCustomerView,
  toCustomerViewBatch,
  filterCustomerFields,
};
