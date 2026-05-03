// @ts-check
// src/utils/fieldMapping.js — 统一字段映射模块
/**
 * @module fieldMapping
 * 集中管理飞书多维表格字段与代码之间的映射关系
 */

// ==================== 诊断共识表映射 ====================

/**
 * 记录类型映射（代码 ↔ 飞书）
 * @type {{toFeishu: Object<string, string>, toCode: Object<string, string>}}
 */
const CONSENSUS_TYPE_MAP = {
  // 代码英文值 → 飞书中文选项
  toFeishu: {
    'fact': '事实',
    'consensus': '共识',
    'case': '案例',
    'insight': '洞察',
  },
  // 飞书中文选项 → 代码英文值
  toCode: {
    '事实': 'fact',
    '共识': 'consensus',
    '案例': 'case',
    '洞察': 'insight',
  },
};

/**
 * 记录状态映射（代码 ↔ 飞书）
 * @type {{toFeishu: Object<string, string>, toCode: Object<string, string>}}
 */
const CONSENSUS_STATUS_MAP = {
  // 代码英文值 → 飞书中文选项
  toFeishu: {
    'recorded': '待确认',
    'pending_client_confirm': '待确认',
    'confirmed': '已确认',
    'active': '已确认',
    'superseded': '已过时',
  },
  // 飞书中文选项 → 代码英文值
  toCode: {
    '待确认': 'pending_client_confirm',
    '已确认': 'confirmed',
    '已过时': 'superseded',
  },
};

/**
 * 诊断共识表字段定义
 * @type {string[]}
 */
const CONSENSUS_FIELDS = [
  '记录ID',      // field_id: fldt1SGX6u
  '时间戳',      // field_id: fldLbkq9WL
  '类型',        // field_id: fldFHZB1nv (单选)
  '阶段',        // field_id: fld5nagQ3S (单选)
  '内容',        // field_id: fldt3G5vcE
  '来源',        // field_id: fldz0rHGbl
  '关联SKU',     // field_id: fld7weLW44
  '状态',        // field_id: fldFVZKCPs (单选)
  '置信度',      // field_id: fld0lg3Pej (单选)
  '替代记录',    // field_id: fldk0C1onN
  '被替代',      // field_id: fldfbPEPjE
  '建议方向',    // field_id: fldXfkJp5p
];

// ==================== 客户档案表映射 ====================

/**
 * 客户档案表字段定义（完整列表）
 * @type {string[]}
 */
const PROFILE_FIELDS = [
  '客户公司名',  // field_id: fldSMirg0Q
  '产品线',      // field_id: fldcpGsA0i
  '客户群体',    // field_id: fldgbcctGn
  '收入结构',    // field_id: fldRsdz5k7
  '毛利结构',    // field_id: fldqdZ29m2
  '交付情况',    // field_id: fldFd96pt1
  '资源分布',    // field_id: fld6ZJQ69C
  '战略目标',    // field_id: fld7HElqu6
  '显性诉求',    // field_id: flddrDkmYx
  '当前追问',    // field_id: fldbU5arYa
  '诊断进度',    // field_id: fldSCl5WAg (数字)
  '完整度',      // field_id: fldh9UIUjB (进度条)
];

// ==================== 工具函数 ====================

/**
 * 转换记录类型（代码 → 飞书）
 * @param {string} type - 代码中的类型值
 * @returns {string} 飞书中的类型选项
 */
function typeToFeishu(type) {
  return CONSENSUS_TYPE_MAP.toFeishu[type] || type;
}

/**
 * 转换记录类型（飞书 → 代码）
 * @param {string} type - 飞书中的类型选项
 * @returns {string} 代码中的类型值
 */
function typeToCode(type) {
  return CONSENSUS_TYPE_MAP.toCode[type] || type;
}

/**
 * 转换记录状态（代码 → 飞书）
 * @param {string} status - 代码中的状态值
 * @returns {string} 飞书中的状态选项
 */
function statusToFeishu(status) {
  return CONSENSUS_STATUS_MAP.toFeishu[status] || status;
}

/**
 * 转换记录状态（飞书 → 代码）
 * @param {string} status - 飞书中的状态选项
 * @returns {string} 代码中的状态值
 */
function statusToCode(status) {
  return CONSENSUS_STATUS_MAP.toCode[status] || status;
}

/**
 * 提取飞书富文本字段值
 * 飞书返回的文本字段格式为 [{ text: '...', type: 'text' }]
 * @param {unknown} fieldValue - 飞书字段值
 * @returns {string|unknown} 提取的文本值或原始值
 */
function extractRichTextValue(fieldValue) {
  if (Array.isArray(fieldValue) && fieldValue[0]?.text) {
    return fieldValue[0].text;
  }
  return fieldValue;
}

/**
 * 处理飞书字段值（统一处理富文本、数字等类型）
 * @param {unknown} fieldValue - 飞书字段值
 * @param {string} fieldName - 字段名（用于特殊处理判断）
 * @returns {unknown} 处理后的值
 */
function processFeishuFieldValue(fieldValue, fieldName) {
  if (fieldValue === undefined || fieldValue === null) {
    return fieldValue;
  }

  // 完整度字段是数字类型，直接返回
  if (fieldName === '完整度') {
    return typeof fieldValue === 'number' ? fieldValue : Number(fieldValue);
  }

  // 诊断进度字段是数字类型
  if (fieldName === '诊断进度') {
    return typeof fieldValue === 'number' ? fieldValue : Number(fieldValue);
  }

  // 其他字段处理富文本格式
  return extractRichTextValue(fieldValue);
}

/**
 * 将 evidence_sku 数组转换为飞书记录格式
 * @param {string[]} skuArray - SKU ID 数组
 * @returns {string} 换行分隔的 SKU 字符串
 */
function skuArrayToFeishu(skuArray) {
  if (!Array.isArray(skuArray)) {
    return '';
  }
  return skuArray.join('\n');
}

/**
 * 将飞书 SKU 字符串转换为数组
 * @param {string} skuString - 换行分隔的 SKU 字符串
 * @returns {string[]} SKU ID 数组
 */
function skuStringToArray(skuString) {
  if (typeof skuString !== 'string') {
    return [];
  }
  return skuString.split('\n').filter(Boolean);
}

module.exports = {
  // 映射常量
  CONSENSUS_TYPE_MAP,
  CONSENSUS_STATUS_MAP,
  CONSENSUS_FIELDS,
  PROFILE_FIELDS,

  // 转换函数
  typeToFeishu,
  typeToCode,
  statusToFeishu,
  statusToCode,

  // 工具函数
  extractRichTextValue,
  processFeishuFieldValue,
  skuArrayToFeishu,
  skuStringToArray,
};
