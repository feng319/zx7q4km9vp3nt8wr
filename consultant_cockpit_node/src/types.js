// @ts-check
// src/types.js — 核心数据结构定义（JSDoc），供所有模块引用

/**
 * @typedef {'fact' | 'consensus'} ConsensusType
 * @typedef {'战略梳理' | '商业模式' | '行业演示'} Stage
 * @typedef {'manual' | 'candidate_selected' | 'ai_suggested' | 'manual_correction'} RecordSource
 * @typedef {'recorded' | 'pending_client_confirm' | 'confirmed' | 'superseded'} RecordStatus
 * @typedef {'high' | 'medium' | 'low'} ConfidenceLevel
 * @typedef {'稳健' | '平衡' | '激进'} RiskLevel
 * @typedef {'🟢' | '🟡' | '🔴'} SkuConfidence
 * @typedef {'hypothesis' | 'info_building'} BattleCardMode
 */

/**
 * 共识链记录
 * @typedef {Object} ConsensusRecord
 * @property {string} id - 唯一标识，格式：`record_0`、`record_0_corr_1`
 * @property {string} timestamp - ISO 8601 时间戳
 * @property {ConsensusType} type - 事实或判断
 * @property {Stage} stage - 所属阶段
 * @property {string} content - 记录内容
 * @property {RecordSource} source - 来源
 * @property {string[]} evidence_sku - 关联的 SKU ID 列表
 * @property {RecordStatus} status - 状态
 * @property {ConfidenceLevel|null} confidence - 置信度（可选）
 * @property {string|null} replaces - 替代的原记录 ID（修正时指向原记录）
 * @property {string|null} superseded_by - 被哪条记录替代（原记录指向新记录）
 * @property {string|null} feishu_record_id - 飞书记录 ID（同步后填充）
 * @property {string|null} recommendation - 建议方向（仅 consensus 类型有）
 * @property {string|null} target_field - 对应客户档案的字段名（如"产品线"、"毛利结构"）
 */

/**
 * 诊断假设（重构 4.md 12.2 节）
 * @typedef {Object} DiagnosisHypothesis
 * @property {string} id - 唯一标识
 * @property {string} content - 假设内容
 * @property {string|null} target_field - 对应客户档案的字段名
 * @property {Stage} origin_stage - 假设提出时的阶段（注意：不是共识链记录的 stage）
 * @property {string[]} evidence_skus - 关联的 SKU ID 列表
 * @property {'confirmed'|'partial'|'rejected'|'avoided'|'pending'} status - 假设响应状态
 * @property {'pre_meeting'|'mid_meeting_generated'} source - 假设来源
 */

/**
 * 候选方案
 * @typedef {Object} Candidate
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {RiskLevel} risk_level
 * @property {string[]} evidence_skus
 */

/**
 * 候选缓存状态
 * @typedef {Object} CandidateCacheStatus
 * @property {boolean} is_valid
 * @property {number} age_seconds
 * @property {boolean} background_running
 * @property {number} last_facts_count
 * @property {number} last_pending_count
 */

/**
 * SKU 弹药卡片
 * @typedef {Object} SkuCard
 * @property {string} id
 * @property {string} title
 * @property {string} summary
 * @property {SkuConfidence} confidence
 * @property {Stage} stage
 * @property {string} recalled_at
 */

/**
 * 客户档案字段
 * @typedef {Object} ClientProfileFields
 * @property {string} 客户公司名
 * @property {string} 产品线
 * @property {string} 客户群体
 * @property {string} 收入结构
 * @property {string} 毛利结构
 * @property {string} 交付情况
 * @property {string} 资源分布
 * @property {string} 战略目标
 * @property {string} 显性诉求
 * @property {string} [当前追问]
 * @property {string} [诊断进度]
 * @property {number} [完整度] - 档案完整度百分比 (0-100)
 */

/**
 * 客户档案
 * @typedef {Object} ClientProfile
 * @property {string|null} record_id
 * @property {ClientProfileFields} fields
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
 * 备忘录结构
 * @typedef {Object} MemoDocument
 * @property {Object} chapters
 * @property {Object} chapters.问题重构
 * @property {string} chapters.问题重构.原始诉求
 * @property {string} chapters.问题重构.核心问题
 * @property {Object} chapters.关键发现
 * @property {string[]} chapters.关键发现.战略层面
 * @property {string[]} chapters.关键发现.商业模式层面
 * @property {Object[]} chapters.初步建议方向
 * @property {string[]} chapters.需要进一步访谈
 * @property {Object} chapters.建议下一步合作方式
 */

/**
 * 会话快照
 * @typedef {Object} SessionSnapshot
 * @property {string} version
 * @property {string} timestamp
 * @property {ConsensusRecord[]} records
 * @property {Object} metadata
 * @property {string} metadata.company
 * @property {Stage} metadata.current_stage
 */

/**
 * 降级类型
 * @typedef {'feishu_api' | 'lark_cli' | 'llm_timeout' | 'knowledge_recall' | 'word_generation'} FallbackType
 */

/**
 * 降级结果
 * @typedef {Object} FallbackResult
 * @property {boolean} success
 * @property {FallbackType} fallback_type
 * @property {string} message
 * @property {Object|null} data
 * @property {string|null} original_error
 * @property {string} timestamp
 */

/**
 * 约束检查结果
 * @typedef {Object} ConstraintCheckResult
 * @property {boolean} valid
 * @property {string} message
 * @property {SkuCard|null} [supplemented_sku]
 */

/**
 * 飞书同步变更事件
 * @typedef {Object} FeishuChangeEvent
 * @property {string} record_id
 * @property {Object} data
 * @property {'update'|'create'|'delete'} change_type
 * @property {string} timestamp
 */

/**
 * WebSocket 消息
 * @typedef {Object} WsMessage
 * @property {string} event
 * @property {Object} payload
 * @property {string} timestamp
 */

// 导出空对象，仅用于类型定义
module.exports = {};