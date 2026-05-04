// @ts-check
// src/utils/fieldMapping.js — 统一字段映射模块
/**
 * @module fieldMapping
 * 集中管理飞书多维表格字段与代码之间的映射关系
 *
 * 注意：此文件是 src/config/fields.js 的子集，保留用于向后兼容
 * 新代码应直接使用 src/config/fields.js
 */

// 从统一配置模块导入并重新导出
const {
  CONSENSUS_TYPE_MAP,
  CONSENSUS_STATUS_MAP,
  CONSENSUS_FIELDS,
  PROFILE_FIELDS,
  typeToFeishu,
  typeToCode,
  statusToFeishu,
  statusToCode,
  isValidType,
} = require('../config/fields');

/**
 * 提取飞书富文本字段值
 * 飞书返回的文本字段格式为 [{ text: '...', type: 'text' }]
 * @param {unknown} fieldValue - 飞书字段值
 * @returns {string|unknown} 提取的文本值或原始值
 */
function extractRichTextValue(fieldValue) {
  if (Array.isArray(fieldValue) && fieldValue[0]?.text) {
    // 修复：拼接所有文本段，而非只取第一段
    return fieldValue.map(v => v.text || '').join('');
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
  // 映射常量（从 fields.js 重新导出）
  CONSENSUS_TYPE_MAP,
  CONSENSUS_STATUS_MAP,
  CONSENSUS_FIELDS,
  PROFILE_FIELDS,

  // 转换函数（从 fields.js 重新导出）
  typeToFeishu,
  typeToCode,
  statusToFeishu,
  statusToCode,
  isValidType,

  // 工具函数（本模块特有）
  extractRichTextValue,
  processFeishuFieldValue,
  skuArrayToFeishu,
  skuStringToArray,
};
