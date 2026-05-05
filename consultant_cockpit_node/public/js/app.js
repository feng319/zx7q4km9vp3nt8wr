/**
 * 顾问现场作战系统 - 前端应用
 * 设计规范实现：三栏布局 3:5:2
 */

// API 基础路径
const API_BASE = '/api';

// 阶段定义（设计文档 4.3 节）
const STAGES = ['战略梳理', '商业模式', '行业演示'];

// LLM 提供商配置
const LLM_PROVIDERS = {
  'deepseek-free': {
    name: 'DeepSeek Free',
    baseUrl: 'https://zenmux.ai/api/v1',
    models: [
      { id: 'deepseek/deepseek-v4-flash-free', name: 'DeepSeek V4 Flash Free' },
      { id: 'deepseek/deepseek-v4-pro-free', name: 'DeepSeek V4 Pro Free' }
    ]
  },
  'volc-ark': {
    name: '火山引擎 Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { id: 'doubao-seed-2-0-pro-260215', name: 'doubao-seed-2-0-pro' },
      { id: 'doubao-seed-2-0-lite-260215', name: 'doubao-seed-2-0-lite' },
      { id: 'doubao-seed-2-0-mini-260215', name: 'doubao-seed-2-0-mini' }
    ]
  },
  'deepseek': {
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com',
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }
    ]
  }
};

// 状态管理
const state = {
  sessionId: null,
  company: null,  // 客户公司名称（用于同步到飞书客户档案表）
  records: [],
  candidates: null,
  candidateId: null,  // 当前选中候选对应的记录 ID
  selectedCandidateIndex: null,  // 选中的候选索引（用于淡出其他卡片）
  candidatesFolded: false,  // 候选是否折叠到右下角
  skus: [],
  currentStage: '战略梳理',
  completeness: 0,
  fieldsStatus: {},
  currentSuggestion: null,
  ws: null,
  llmProvider: 'deepseek-free',
  llmModel: 'deepseek/deepseek-v4-flash-free',
  demoMode: false,
  _stageSyncing: false  // 阶段同步中标志，防止 GET 覆盖
};

// DOM 元素引用（新布局）
const elements = {};

// 初始化 DOM 元素引用
function initElements() {
  // Header
  elements.sessionId = document.getElementById('session-id');
  elements.sessionSelect = document.getElementById('session-select');
  elements.newSessionBtn = document.getElementById('new-session-btn');
  elements.llmProvider = document.getElementById('llm-provider');
  elements.llmModel = document.getElementById('llm-model');

  // 左栏：诊断进度
  elements.completenessProgress = document.getElementById('completeness-progress');
  elements.completenessValue = document.getElementById('completeness-value');
  elements.fieldsStatus = document.getElementById('fields-status');
  elements.currentStage = document.getElementById('current-stage');
  elements.pendingAssumptions = document.getElementById('pending-assumptions');

  // 中栏：对话区
  elements.stageDisplay = document.getElementById('stage-display');
  elements.consensusChain = document.getElementById('consensus-chain');
  elements.commandInput = document.getElementById('command-input');
  elements.executeCommandBtn = document.getElementById('execute-command-btn');
  elements.cmdCandidate = document.getElementById('cmd-candidate');
  elements.candidateBadge = document.getElementById('candidate-badge');
  elements.cmdConfirm = document.getElementById('cmd-confirm');
  elements.cmdSwitch = document.getElementById('cmd-switch');
  elements.cmdCase = document.getElementById('cmd-case');
  elements.candidatesOverlay = document.getElementById('candidates-overlay');
  elements.candidatesCards = document.getElementById('candidates-cards');
  elements.closeCandidatesBtn = document.getElementById('close-candidates-btn');

  // 右下角悬浮徽标（设计文档 3.5 节）
  elements.pendingDecisionBadge = document.getElementById('pending-decision-badge');
  elements.pendingCandidateCount = document.getElementById('pending-candidate-count');

  // 右栏：建议
  elements.suggestionStatus = document.getElementById('suggestion-status');
  elements.suggestionQuestion = document.getElementById('suggestion-question');
  elements.useSuggestionBtn = document.getElementById('use-suggestion-btn');
  elements.skipSuggestionBtn = document.getElementById('skip-suggestion-btn');
  elements.customQuestionBtn = document.getElementById('custom-question-btn');
  elements.newSkuBadge = document.getElementById('new-sku-badge');
  elements.skuList = document.getElementById('sku-list');

  // Footer
  elements.generateMemoBtn = document.getElementById('generate-memo-btn');
  elements.generateBattleCardBtn = document.getElementById('generate-battle-card-btn');
  elements.exportBtn = document.getElementById('export-btn');
  elements.importBtn = document.getElementById('import-btn');
  elements.importFile = document.getElementById('import-file');
  elements.statusBar = document.getElementById('status-bar');
}

// 工具函数
function setStatus(message, type = 'info') {
  const statusColors = {
    info: 'var(--text-secondary-color)',
    success: 'var(--success-color)',
    warning: 'var(--warning-color)',
    error: 'var(--error-color)'
  };
  elements.statusBar.style.color = statusColors[type] || statusColors.info;
  elements.statusBar.textContent = message;
}

function showLoading(button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.innerHTML = '<span class="loading"></span>处理中...';
  return originalText;
}

function hideLoading(button, originalText) {
  button.disabled = false;
  button.textContent = originalText;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function apiRequest(endpoint, options = {}) {
  // 只有在有 body 时才设置 Content-Type
  const hasBody = options.body !== undefined;

  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: hasBody ? {
      'Content-Type': 'application/json',
      ...options.headers
    } : options.headers,
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ==================== 会话管理 ====================

async function createSession() {
  try {
    // 弹出输入框让用户输入客户公司名
    const company = prompt('请输入客户公司名称（可选，用于同步到飞书客户档案表）:');

    const body = company ? { company } : {};
    const data = await apiRequest('/sessions', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    state.sessionId = data.session_id;
    state.company = company || null;  // 保存公司名到状态
    elements.sessionId.textContent = `会话: ${state.sessionId.slice(0, 8)}...`;

    if (company) {
      setStatus(`会话创建成功（客户: ${company}）`, 'success');
    } else {
      setStatus('会话创建成功', 'success');
    }

    // 连接 WebSocket
    connectWebSocket();

    // 清空记录
    state.records = [];
    state.completeness = 0;
    state.fieldsStatus = {};
    renderAll();

    // 自动加载初始备弹（使用默认关键词）
    await loadInitialSkus();

    // 刷新会话列表下拉框
    await loadSessionList();
  } catch (error) {
    setStatus(`创建会话失败: ${error.message}`, 'error');
  }
}

/**
 * 加载初始备弹
 * 创建会话后自动召回一些 SKU
 */
async function loadInitialSkus() {
  if (!state.sessionId) return;

  try {
    // 使用默认关键词召回备弹
    const defaultKeywords = ['储能', '商业模式', '战略'];
    const data = await apiRequest(`/sessions/${state.sessionId}/recall`, {
      method: 'POST',
      body: JSON.stringify({ keywords: defaultKeywords, top_k: 5 })
    });

    state.skus = data.skus || [];
    renderSkus();
  } catch (error) {
    console.error('加载初始备弹失败:', error);
  }
}

async function getSessionState() {
  if (!state.sessionId) return;

  try {
    const data = await apiRequest(`/sessions/${state.sessionId}`);
    state.records = data.records || [];
    state.completeness = data.completeness || 0;
    state.fieldsStatus = data.fields_status || {};
    // 方案 B：如果阶段正在同步中，不覆盖本地状态
    if (!state._stageSyncing) {
      state.currentStage = data.current_stage || '战略梳理';
    }
    renderAll();
  } catch (error) {
    console.error('获取会话状态失败:', error);
  }
}

// ==================== WebSocket 连接 ====================

function connectWebSocket() {
  if (!state.sessionId) return;

  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${location.host}/ws/${state.sessionId}`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('WebSocket 已连接');
  };

  state.ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };

  state.ws.onclose = () => {
    console.log('WebSocket 已断开');
    setTimeout(connectWebSocket, 3000);
  };

  state.ws.onerror = (error) => {
    console.error('WebSocket 错误:', error);
  };
}

function handleWebSocketMessage(data) {
  switch (data.type) {
    case 'record_added':
    case 'record_confirmed':
    case 'record_corrected':
      // 获取新记录 ID 用于闪动动画
      const flashId = data.data?.record?.id || null;
      getSessionState().then(() => {
        if (flashId) flashRecord(flashId);
      });
      break;
    case 'profile_changed':
      // 客户档案表变更（飞书侧修改）
      console.log('Profile changed from Feishu:', data.data);
      // 如果当前会话的公司匹配，刷新状态
      if (state.company && data.data?.company === state.company) {
        getSessionState();
        // 显示提示
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.textContent = `客户档案已更新`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
      }
      break;
    case 'feishu_record_changed':
      // 共识链表变更（飞书侧修改）
      console.log('Consensus record changed from Feishu:', data.data);
      getSessionState().then(() => {
        if (data.data?.record_id) flashRecord(data.data.record_id);
      });
      break;
    case 'candidates_ready':
      state.candidates = data.candidates;
      showCandidatesOverlay();
      break;
    case 'sku_recalled':
      state.skus = data.skus;
      elements.newSkuBadge.style.display = 'inline';
      renderSkus();
      break;
  }
}

/**
 * 对指定记录触发绿色闪动动画
 * @param {string} recordId
 */
function flashRecord(recordId) {
  const el = elements.consensusChain.querySelector(`[data-id="${recordId}"]`);
  if (el) {
    el.classList.add('flash');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => el.classList.remove('flash'), 300);
  }
}

// ==================== 指令解析与执行 ====================

/**
 * 解析并执行指令
 * 设计文档 1.4 节快捷指令：
 * - /记 <内容>：记录事实或共识
 * - /确认：锁定最近一条待确认共识
 * - /切 <阶段>：切换阶段
 * - /候选：生成候选方案
 * - /案例 <关键词>：召回案例
 * - /总结：生成当前阶段总结
 */
function parseAndExecuteCommand(command) {
  command = command.trim();

  if (command.startsWith('/记')) {
    const content = command.slice(2).trim();
    if (content) executeRecordCommand(content);
  } else if (command === '/确认') {
    executeConfirmCommand();
  } else if (command.startsWith('/改')) {
    const content = command.slice(2).trim();
    if (content) executeCorrectCommand(content);
  } else if (command.startsWith('/切')) {
    const stage = command.slice(2).trim();
    executeStageSwitchCommand(stage);
  } else if (command === '/候选') {
    executeCandidateCommand();
  } else if (command === '/总结') {
    executeSummaryCommand();
  } else if (command.startsWith('/案例')) {
    const keywords = command.slice(3).trim();
    executeCaseRecallCommand(keywords);
  } else if (command.startsWith('/框架')) {
    const keywords = command.slice(3).trim();
    executeCaseRecallCommand(keywords, 'framework');
  } else if (command.startsWith('/对比')) {
    const keywords = command.slice(3).trim();
    executeCaseRecallCommand(keywords, 'comparison');
  } else {
    setStatus(`未知指令: ${command}`, 'warning');
  }
}

/**
 * 推断记录类型（设计文档 4.2 节）
 */
function inferType(content) {
  const consensusKeywords = ['客户认可', '我们决定', '确认', '选择', '同意', '认可'];
  return consensusKeywords.some(kw => content.includes(kw)) ? 'consensus' : 'fact';
}

/**
 * 从内容中提取 target_field（字段前缀）
 * 规则：内容以"字段名："或"字段名:"开头时，提取字段名作为 target_field
 * 客户档案 9 个静态字段：产品线、客户群体、收入结构、毛利结构、交付情况、资源分布、战略目标、显性诉求、隐性痛点
 */
function extractTargetField(content) {
  if (!content) return null;
  const profileFields = ['产品线', '客户群体', '收入结构', '毛利结构', '交付情况', '资源分布', '战略目标', '显性诉求', '隐性痛点'];
  const match = content.match(/^([^：:]+)[：:]/);
  if (match && match[1]) {
    const fieldName = match[1].trim();
    // 精确匹配客户档案字段
    if (profileFields.includes(fieldName)) {
      return fieldName;
    }
  }
  return null;
}

async function executeRecordCommand(content) {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  const recordType = inferType(content);
  const targetField = extractTargetField(content);

  try {
    const result = await apiRequest(`/sessions/${state.sessionId}/records`, {
      method: 'POST',
      body: JSON.stringify({
        type: recordType,
        content: content,
        stage: state.currentStage,
        source: 'manual',
        target_field: targetField
      })
    });

    elements.commandInput.value = '';
    const targetFieldInfo = targetField ? ` → ${targetField}` : '';
    setStatus(`已记录 (类型: ${recordType === 'fact' ? '事实' : '共识'}, 阶段: ${state.currentStage}${targetFieldInfo})`, 'success');

    // 立即刷新状态并闪动新记录（不等 WebSocket）
    await getSessionState();
    if (result.record?.id) {
      flashRecord(result.record.id);
    }
  } catch (error) {
    setStatus(`记录失败: ${error.message}`, 'error');
  }
}

async function executeConfirmCommand() {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  try {
    // 如果没有公司名，提示用户输入（用于同步到飞书客户档案表）
    if (!state.company) {
      const company = prompt('请输入客户公司名称（用于同步到飞书客户档案表）:');
      if (company) {
        state.company = company;
      }
    }

    // 优先确认选中的候选记录，否则由后端确认最新 pending 记录
    const body = {
      ...(state.candidateId ? { record_id: state.candidateId } : {}),
      ...(state.company ? { company: state.company } : {})
    };
    const result = await apiRequest(`/sessions/${state.sessionId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(body)
    });

    state.candidateId = null;  // 清除选中状态

    // 找到被确认的记录用于提示
    const confirmed = state.records.find(r => r.id === result.confirmed_id);
    const label = confirmed ? confirmed.content.slice(0, 30) : result.confirmed_id;
    const companyMsg = state.company ? ` (${state.company})` : '';
    setStatus(`已确认: ${label}...${companyMsg}`, 'success');
    await getSessionState();
  } catch (error) {
    setStatus(`确认失败: ${error.message}`, 'error');
  }
}

/**
 * /改 <内容>：修正最近一条记录（PRD 4.1 节）
 * 不覆盖原记录，而是新增一条 source=manual_correction、replaces=原ID 的记录
 * 原记录自动标记为 superseded
 */
async function executeCorrectCommand(newContent) {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  // 找目标记录：选中候选 > 最新 pending > 最新一条非 superseded 记录
  let target = null;
  if (state.candidateId) {
    target = state.records.find(r => r.id === state.candidateId);
  }
  if (!target) {
    target = state.records
      .filter(r => r.status === 'pending_client_confirm')
      .pop();
  }
  if (!target) {
    target = state.records
      .filter(r => r.status !== 'superseded')
      .pop();
  }

  if (!target) {
    setStatus('没有可修正的记录', 'warning');
    return;
  }

  try {
    await apiRequest(`/sessions/${state.sessionId}/records/${target.id}/correct`, {
      method: 'POST',
      body: JSON.stringify({
        content: newContent,
        source: 'manual_correction',
        type: target.type,
        stage: target.stage
      })
    });

    state.candidateId = null;
    elements.commandInput.value = '';
    setStatus(`已修正: ${target.content.slice(0, 20)}... → ${newContent.slice(0, 20)}...`, 'success');
    await getSessionState();
  } catch (error) {
    setStatus(`修正失败: ${error.message}`, 'error');
  }
}

async function executeStageSwitchCommand(stage) {
  let targetStage = stage;

  // 阶段锁定检查：有未确认候选时禁止切换
  if (state.candidates && state.candidates.length > 0) {
    setStatus('请先确认或关闭当前候选方案后再切换阶段', 'warning');
    return;
  }

  // 阶段锁定检查：有待确认记录时提示
  const pendingRecords = state.records.filter(r => r.status === 'pending_client_confirm');
  if (pendingRecords.length > 0) {
    const confirmed = confirm(`当前有 ${pendingRecords.length} 条待确认记录，切换阶段可能导致数据丢失。是否继续？`);
    if (!confirmed) {
      setStatus('已取消阶段切换', 'warning');
      return;
    }
  }

  if (!targetStage) {
    // 切换到下一阶段
    const currentIdx = STAGES.indexOf(state.currentStage);
    const nextIdx = (currentIdx + 1) % STAGES.length;
    targetStage = STAGES[nextIdx];
  }

  if (!STAGES.includes(targetStage)) {
    setStatus(`无效阶段: ${targetStage}，可选: ${STAGES.join(', ')}`, 'warning');
    return;
  }

  // 最后一个阶段不允许切换（应该已经被隐藏，但保留检查）
  const lastStage = STAGES[STAGES.length - 1];
  if (state.currentStage === lastStage) {
    setStatus(`已处于最后阶段: ${lastStage}，无法继续切换`, 'warning');
    return;
  }

  if (!state.sessionId) {
    // 无会话时只更新本地状态
    state.currentStage = targetStage;
    elements.currentStage.textContent = targetStage;
    elements.stageDisplay.textContent = targetStage;
    setStatus(`已切换到: ${targetStage}`, 'success');
    renderAll(); // 重新渲染以更新按钮状态
    return;
  }

  // 乐观更新：立即更新本地 UI
  state.currentStage = targetStage;
  state._stageSyncing = true; // 设置同步中标志，防止 GET 覆盖
  elements.currentStage.textContent = targetStage;
  elements.stageDisplay.textContent = targetStage;
  setStatus(`已切换到: ${targetStage}`, 'success');
  renderAll(); // 重新渲染以更新按钮状态

  try {
    // 同步到后端
    await apiRequest(`/sessions/${state.sessionId}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: targetStage })
    });
  } catch (error) {
    console.error('阶段同步失败:', error);
    setStatus(`阶段同步失败: ${error.message}`, 'error');
    // 可选：回滚本地状态
  } finally {
    state._stageSyncing = false; // 清除同步中标志
  }
}

async function executeCandidateCommand() {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  const originalText = showLoading(elements.cmdCandidate);

  try {
    const data = await apiRequest(`/sessions/${state.sessionId}/candidates`);

    // 后端返回 message 字段（约束不满足时的引导文案）
    if (data.message) {
      setStatus(data.message, 'warning');
    } else if (data.candidates && data.candidates.length > 0) {
      state.candidates = data.candidates;
      showCandidatesOverlay();
      setStatus('候选方案已生成', 'success');
    } else {
      setStatus('未生成候选方案', 'warning');
    }
  } catch (error) {
    setStatus(`获取候选方案失败: ${error.message}`, 'error');
  } finally {
    hideLoading(elements.cmdCandidate, originalText);
  }
}

async function executeCaseRecallCommand(keywords, mode = 'case') {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  // 如果没有关键词，从共识链提取
  if (!keywords) {
    const facts = state.records.filter(r => r.type === 'fact' && r.status === 'confirmed');
    keywords = facts.slice(0, 3).map(f => f.content.split(/\s+/).slice(0, 2).join(' ')).join(' ') || '储能';
  }

  try {
    const data = await apiRequest(`/sessions/${state.sessionId}/recall`, {
      method: 'POST',
      body: JSON.stringify({ keywords: keywords.split(/[,，]/).map(k => k.trim()), mode })
    });

    state.skus = data.skus || [];
    elements.newSkuBadge.style.display = 'inline';
    renderSkus();
    setStatus(`召回 ${state.skus.length} 条案例`, 'success');
  } catch (error) {
    setStatus(`召回失败: ${error.message}`, 'error');
  }
}

/**
 * 执行总结指令
 * 生成当前阶段的诊断总结
 */
function executeSummaryCommand() {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  // 按阶段分组统计
  const stageRecords = state.records.filter(r => r.stage === state.currentStage);
  const facts = stageRecords.filter(r => r.type === 'fact');
  const consensus = stageRecords.filter(r => r.type === 'consensus');
  const confirmed = stageRecords.filter(r => r.status === 'confirmed');

  // 生成总结文本
  const summaryLines = [
    `【${state.currentStage}阶段总结】`,
    `已确认事实: ${facts.filter(f => f.status === 'confirmed').length} 条`,
    `待确认判断: ${consensus.filter(c => c.status === 'pending_client_confirm').length} 条`,
    `已达成共识: ${confirmed.filter(c => c.type === 'consensus').length} 条`,
    `完整度: ${Math.round(state.completeness)}%`
  ];

  // 添加关键发现
  if (facts.length > 0) {
    summaryLines.push('', '关键发现:');
    facts.slice(0, 3).forEach((f, i) => {
      summaryLines.push(`  ${i + 1}. ${f.content.slice(0, 50)}${f.content.length > 50 ? '...' : ''}`);
    });
  }

  // 显示总结
  elements.suggestionQuestion.textContent = summaryLines.join('\n');
  setStatus('已生成阶段总结', 'success');
}

// ==================== 候选方案覆盖层 ====================

function showCandidatesOverlay() {
  if (!state.candidates || state.candidates.length === 0) return;

  // 设计规范 3.5 节：主对话区其他内容半透明化
  elements.candidatesOverlay.style.display = 'flex';
  elements.candidatesOverlay.closest('.dialog-panel').classList.add('has-candidates');

  const riskLabels = {
    low: { text: '稳健', class: 'low' },
    medium: { text: '平衡', class: 'medium' },
    high: { text: '激进', class: 'high' }
  };

  elements.candidatesCards.innerHTML = state.candidates.map((candidate, index) => {
    const risk = riskLabels[candidate.risk_level] || riskLabels.medium;
    return `
      <div class="candidate-card" data-index="${index}" onclick="selectCandidate(${index})" tabindex="0" role="button" aria-label="候选 ${String.fromCharCode(65 + index)}: ${escapeHtml(candidate.title || `方案 ${index + 1}`)}">
        <div class="candidate-card-label">候选 ${String.fromCharCode(65 + index)}</div>
        <div class="candidate-card-title">${escapeHtml(candidate.title || `方案 ${index + 1}`)}</div>
        <div class="candidate-card-desc">${escapeHtml(candidate.description)}</div>
      </div>
    `;
  }).join('');

  // 添加键盘导航支持
  elements.candidatesCards.querySelectorAll('.candidate-card').forEach((card, index) => {
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectCandidate(index);
      }
    });
  });

  // 清除红点徽标
  elements.candidateBadge.textContent = '';

  // 隐藏右下角悬浮徽标
  if (elements.pendingDecisionBadge) {
    elements.pendingDecisionBadge.style.display = 'none';
  }

  // 重置折叠状态
  state.candidatesFolded = false;
  state.selectedCandidateIndex = null;
}

/**
 * 更新候选卡片的淡出状态（设计文档 3.5 节）
 * 选中的候选高亮，其他候选淡出但保留
 */
function updateCandidateCardsFade(selectedIndex) {
  const cards = elements.candidatesCards.querySelectorAll('.candidate-card');
  cards.forEach((card, index) => {
    if (index === selectedIndex) {
      card.classList.add('selected');
      card.classList.remove('faded');
    } else {
      card.classList.add('faded');
      card.classList.remove('selected');
    }
  });
}

/**
 * 折叠候选到右下角"待决策"徽标（设计文档 3.5 节）
 * 按 Esc 或 /关闭 时触发
 */
function foldCandidatesToBadge() {
  if (!state.candidates || state.candidates.length === 0) return;

  state.candidatesFolded = true;
  elements.candidatesOverlay.style.display = 'none';
  elements.candidatesOverlay.closest('.dialog-panel').classList.remove('has-candidates');

  // 显示右下角悬浮徽标
  if (elements.pendingDecisionBadge) {
    elements.pendingDecisionBadge.style.display = 'flex';
    if (elements.pendingCandidateCount) {
      elements.pendingCandidateCount.textContent = state.candidates.length;
    }
  }

  // 同时更新指令旁的徽标
  elements.candidateBadge.textContent = '⏳';
  setStatus('候选已折叠到右下角，点击徽标或 /候选 重新展开', 'info');
}

/**
 * 从右下角徽标展开候选
 */
function unfoldCandidatesFromBadge() {
  if (!state.candidates || state.candidates.length === 0) return;

  state.candidatesFolded = false;

  // 隐藏右下角悬浮徽标
  if (elements.pendingDecisionBadge) {
    elements.pendingDecisionBadge.style.display = 'none';
  }

  // 显示候选面板（复用 showCandidatesOverlay 的渲染逻辑）
  showCandidatesOverlay();
}

function hideCandidatesOverlay() {
  // 如果有候选但未选中，折叠到徽标；否则直接关闭
  if (state.candidates && state.candidates.length > 0 && state.selectedCandidateIndex === null) {
    foldCandidatesToBadge();
  } else {
    elements.candidatesOverlay.style.display = 'none';
    elements.candidatesOverlay.closest('.dialog-panel').classList.remove('has-candidates');
    state.candidatesFolded = false;
    // 隐藏右下角徽标
    if (elements.pendingDecisionBadge) {
      elements.pendingDecisionBadge.style.display = 'none';
    }
  }
}

async function selectCandidate(index) {
  if (!state.sessionId || !state.candidates) return;

  const candidate = state.candidates[index];

  // 设计文档 3.5 节：选中后其他卡片淡出但保留
  state.selectedCandidateIndex = index;
  updateCandidateCardsFade(index);

  try {
    // 候选选中自动进入共识链（设计文档 4.2 节）
    const result = await apiRequest(`/sessions/${state.sessionId}/records`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'consensus',
        content: candidate.description,
        stage: state.currentStage,
        source: 'candidate_selected',
        status: 'pending_client_confirm',
        recommendation: candidate.title
      })
    });

    // 保存选中候选的记录 ID，供 /确认 使用
    state.candidateId = result.record?.id || null;

    setStatus(`已选择候选 ${String.fromCharCode(65 + index)}，其他备选已淡出保留`, 'success');
    await getSessionState();
  } catch (error) {
    setStatus(`选择失败: ${error.message}`, 'error');
  }
}

// ==================== 渲染函数 ====================

function renderAll() {
  renderCompleteness();
  renderFieldsStatus();
  renderConsensusChain();
  renderStageDisplay();
  renderSuggestionStatus();
  renderPendingAssumptions();
  updateCandidateBadge();
  renderSwitchButton(); // 新增：渲染开关按钮状态
  // 渲染后重新计算面板高度
  setTimeout(adjustPanelHeight, 50);
}

function renderCompleteness() {
  elements.completenessProgress.style.width = `${state.completeness}%`;
  elements.completenessValue.textContent = `${Math.round(state.completeness)}%`;
}

function renderFieldsStatus() {
  // Stage 2.1: 更新为 progress-tag 网格渲染
  // 匹配 index.html 中的 progress-grid 结构
  const progressGrid = document.getElementById('progress-grid');
  if (!progressGrid) return;

  const fieldNames = ['产品线', '客户群体', '收入结构', '毛利结构', '交付情况', '资源分布', '战略目标', '显性诉求', '隐性痛点'];

  progressGrid.innerHTML = fieldNames.map(name => {
    const status = state.fieldsStatus[name] || 'empty';
    return `
      <div class="progress-tag ${status}" data-field="${name}" data-status="${status}" onclick="handleProgressTagClick('${name}', '${status}')">${name}</div>
    `;
  }).join('');

  // 同时更新左栏固定区的完整度显示
  const completenessValueSmall = document.getElementById('completeness-value-small');
  if (completenessValueSmall) {
    completenessValueSmall.textContent = `${Math.round(state.completeness)}%`;
  }
}

function renderConsensusChain() {
  if (state.records.length === 0) {
    elements.consensusChain.innerHTML = '<div class="empty-state">暂无记录，使用下方指令添加</div>';
    return;
  }

  elements.consensusChain.innerHTML = state.records.map(record => `
    <div class="record-item" data-id="${record.id}" role="listitem">
      <div class="record-header">
        <span class="record-type ${record.type}">${record.type === 'fact' ? '事实' : '判断'}</span>
        <span class="record-stage">${record.stage}</span>
        <span class="status-tag ${record.status}">${getStatusText(record.status)}</span>
        ${record.status === 'pending_client_confirm' ? `
          <button class="btn-inline-confirm" onclick="confirmRecord('${record.id}')">确认</button>
        ` : ''}
        ${record.status !== 'superseded' ? `
          <button class="btn-inline-correct" onclick="correctRecord('${record.id}')">修改</button>
        ` : ''}
      </div>
      <div class="record-content">${escapeHtml(record.content)}</div>
    </div>
  `).join('');
}

function renderStageDisplay() {
  elements.currentStage.textContent = state.currentStage;
  elements.stageDisplay.textContent = state.currentStage;
}

/**
 * 渲染开关按钮状态
 * 规则：当前阶段为最后一个阶段（行业演示）时隐藏开关按钮
 */
function renderSwitchButton() {
  const lastStage = STAGES[STAGES.length - 1];
  const isLastStage = state.currentStage === lastStage;

  if (elements.cmdSwitch) {
    elements.cmdSwitch.style.display = isLastStage ? 'none' : '';
  }
}

function renderSuggestionStatus() {
  const statusInfo = elements.suggestionStatus.querySelector('.status-info');
  if (state.completeness >= 0.6) {
    statusInfo.textContent = '候选生成就绪';
    elements.suggestionStatus.style.background = '#f6ffed';
  } else {
    statusInfo.textContent = '追问建议模式';
    elements.suggestionStatus.style.background = '';
  }
}

/**
 * 渲染待确认假设区（PRD 4.2 节：四栏状态板之一）
 * 显示所有 status=pending_client_confirm 的记录
 */
function renderPendingAssumptions() {
  const pendingRecords = state.records.filter(r => r.status === 'pending_client_confirm');

  if (pendingRecords.length === 0) {
    elements.pendingAssumptions.innerHTML = '<div class="empty-state">暂无待确认假设</div>';
    return;
  }

  elements.pendingAssumptions.innerHTML = pendingRecords.map(record => `
    <div class="assumption-item" data-id="${record.id}" role="listitem">
      <span class="assumption-type">${record.type === 'fact' ? '事实' : '判断'}</span>
      <span class="assumption-content">${escapeHtml(record.content)}</span>
      <button class="btn-inline-confirm" onclick="confirmRecord('${record.id}')" aria-label="确认此假设">确认</button>
    </div>
  `).join('');
}

function renderSkus() {
  if (state.skus.length === 0) {
    elements.skuList.innerHTML = '<div class="empty-state">暂无备弹</div>';
    return;
  }

  // PRD 3.2 节：显示 SKU 编号 + 可信度标签，默认折叠摘要
  elements.skuList.innerHTML = state.skus.map(sku => `
    <div class="sku-item" tabindex="0" title="按 Tab 展开摘要">
      <span class="sku-confidence">${sku.confidence}</span>
      <span class="sku-id">[${sku.id || 'SKU'}]</span>
      <div class="sku-info">
        <div class="sku-title">${escapeHtml(sku.title)}</div>
        <div class="sku-summary collapsed">${escapeHtml(sku.summary)}</div>
      </div>
    </div>
  `).join('');

  // 添加 Tab 键展开/折叠交互
  elements.skuList.querySelectorAll('.sku-item').forEach(item => {
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const summary = item.querySelector('.sku-summary');
        if (summary) {
          e.preventDefault();
          summary.classList.toggle('collapsed');
        }
      }
    });
    item.addEventListener('click', () => {
      const summary = item.querySelector('.sku-summary');
      if (summary) {
        summary.classList.toggle('collapsed');
      }
    });
  });
}

function updateCandidateBadge() {
  // 检查候选生成条件是否满足（设计文档 3.1、3.3 节红点徽标）
  // 第一约束：≥3 条已确认事实
  const confirmedFacts = state.records.filter(r => r.type === 'fact' && r.status === 'confirmed');
  const firstConstraintMet = confirmedFacts.length >= 3;

  // 第二约束：至少有一个"待确认假设"或"客户决策问题"作为候选的目标
  // 即：待确认的共识（consensus + pending_client_confirm）
  const pendingConsensus = state.records.filter(r => r.type === 'consensus' && r.status === 'pending_client_confirm');
  const secondConstraintMet = pendingConsensus.length >= 1;

  // 第三约束：至少有 1 个 🟢/🟡 SKU（可信度高的知识备弹）
  const validSkus = state.skus.filter(s => s.confidence === '🟢' || s.confidence === '🟡');
  const thirdConstraintMet = validSkus.length >= 1;

  // 三个约束都满足才显示红点
  if (firstConstraintMet && secondConstraintMet && thirdConstraintMet) {
    elements.candidateBadge.textContent = '🔴';
  } else {
    elements.candidateBadge.textContent = '';
  }
}

function getStatusText(status) {
  // PRD 4.2: /记 创建的记录 status=pending_client_confirm，UI 显示"待确认"
  // /确认 后 status=confirmed，UI 显示"已确认"
  // 添加图标以区分状态（无障碍：不仅依赖颜色）
  const statusMap = {
    recorded: '📝 已记录',
    pending_client_confirm: '⏳ 待确认',
    confirmed: '✓ 已确认',
    superseded: '✗ 已作废'
  };
  return statusMap[status] || status;
}

// ==================== 文档生成 ====================

async function generateMemo() {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  const originalText = showLoading(elements.generateMemoBtn);

  try {
    const data = await apiRequest(`/sessions/${state.sessionId}/memo`, {
      method: 'POST'
    });

    downloadDocument(data, '备忘录.docx');
    setStatus('备忘录生成成功', 'success');
  } catch (error) {
    setStatus(`生成失败: ${error.message}`, 'error');
  } finally {
    hideLoading(elements.generateMemoBtn, originalText);
  }
}

async function generateBattleCard() {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  const company = prompt('请输入客户公司名称:');
  if (!company) return;

  const originalText = showLoading(elements.generateBattleCardBtn);

  try {
    const data = await apiRequest(`/sessions/${state.sessionId}/battle-card`, {
      method: 'POST',
      body: JSON.stringify({ company })
    });

    downloadDocument(data, `作战卡_${company}.docx`);
    setStatus('作战卡生成成功', 'success');
  } catch (error) {
    setStatus(`生成失败: ${error.message}`, 'error');
  } finally {
    hideLoading(elements.generateBattleCardBtn, originalText);
  }
}

function downloadDocument(data, filename) {
  if (typeof data === 'string') {
    const blob = base64ToBlob(data, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

// ==================== 导入导出 ====================

async function exportSession() {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  try {
    const data = await apiRequest(`/sessions/${state.sessionId}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session_${state.sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('会话导出成功', 'success');
  } catch (error) {
    setStatus(`导出失败: ${error.message}`, 'error');
  }
}

async function importSession(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    await apiRequest(`/sessions/${state.sessionId}/import`, {
      method: 'POST',
      body: JSON.stringify(data)
    });

    setStatus('会话导入成功', 'success');
    await getSessionState();
  } catch (error) {
    setStatus(`导入失败: ${error.message}`, 'error');
  }
}

// ==================== 演示模式 ====================

/**
 * 切换演示模式
 * 设计文档 5.2 节：
 * - 工作模式：灰色小圆点
 * - 演示模式：蓝色小圆点
 */
function toggleDemoMode() {
  state.demoMode = !state.demoMode;
  document.body.classList.toggle('demo-mode', state.demoMode);

  // 更新状态徽标
  const modeBadge = document.getElementById('mode-badge');
  const modeDot = modeBadge?.querySelector('.mode-dot');

  if (modeDot) {
    if (state.demoMode) {
      modeDot.classList.remove('mode-dot-work');
      modeDot.classList.add('mode-dot-demo');
      modeBadge.title = '演示模式';
    } else {
      modeDot.classList.remove('mode-dot-demo');
      modeDot.classList.add('mode-dot-work');
      modeBadge.title = '工作模式';
    }
  }

  setStatus(state.demoMode ? '已进入演示模式' : '已退出演示模式', 'success');
}

// ==================== LLM 选择器 ====================

function initLLMSelector() {
  const providerSelect = elements.llmProvider;
  const modelSelect = elements.llmModel;

  function populateModels(providerId) {
    const provider = LLM_PROVIDERS[providerId];
    if (!provider) return;

    modelSelect.disabled = true;
    modelSelect.innerHTML = '<option value="">加载中...</option>';

    setTimeout(() => {
      modelSelect.innerHTML = provider.models.map(model =>
        `<option value="${model.id}">${model.name}</option>`
      ).join('');

      modelSelect.disabled = false;
      state.llmProvider = providerId;
      state.llmModel = provider.models[0]?.id || '';
    }, 50);
  }

  populateModels(providerSelect.value);

  providerSelect.addEventListener('change', (e) => {
    populateModels(e.target.value);
    setStatus(`已切换到 ${LLM_PROVIDERS[e.target.value].name}`, 'success');
  });

  modelSelect.addEventListener('change', (e) => {
    state.llmModel = e.target.value;
    setStatus(`已选择模型: ${e.target.options[e.target.selectedIndex].text}`, 'success');
  });
}

// ==================== 事件绑定 ====================

function initEventListeners() {
  initLLMSelector();

  // 会话管理
  elements.newSessionBtn.addEventListener('click', createSession);
  elements.sessionSelect.addEventListener('change', handleSessionSelectChange);

  // 指令执行
  elements.executeCommandBtn.addEventListener('click', () => {
    const command = elements.commandInput.value.trim();
    if (command) parseAndExecuteCommand(command);
  });

  elements.commandInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const command = elements.commandInput.value.trim();
      if (command) parseAndExecuteCommand(command);
    }
  });

  // 快捷指令按钮
  elements.cmdCandidate.addEventListener('click', executeCandidateCommand);
  elements.cmdConfirm.addEventListener('click', executeConfirmCommand);
  elements.cmdSwitch.addEventListener('click', () => executeStageSwitchCommand());
  elements.cmdCase.addEventListener('click', () => executeCaseRecallCommand());

  // 候选覆盖层关闭
  elements.closeCandidatesBtn.addEventListener('click', hideCandidatesOverlay);

  // 右下角悬浮徽标点击展开候选（设计文档 3.5 节）
  if (elements.pendingDecisionBadge) {
    elements.pendingDecisionBadge.addEventListener('click', unfoldCandidatesFromBadge);
  }

  // 建议操作
  elements.useSuggestionBtn.addEventListener('click', () => {
    if (state.currentSuggestion) {
      elements.commandInput.value = `/记 ${state.currentSuggestion.question}`;
    }
  });

  elements.skipSuggestionBtn.addEventListener('click', () => {
    state.currentSuggestion = null;
    elements.suggestionQuestion.textContent = '点击"新建会话"开始诊断';
  });

  // 文档生成
  elements.generateMemoBtn.addEventListener('click', generateMemo);
  elements.generateBattleCardBtn.addEventListener('click', generateBattleCard);
  elements.exportBtn.addEventListener('click', exportSession);

  elements.importBtn.addEventListener('click', () => {
    elements.importFile.click();
  });

  elements.importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importSession(file);
  });

  // 快捷键（设计文档 5.2 节）
  document.addEventListener('keydown', (e) => {
    // F11 或 Ctrl+Shift+D：演示模式切换
    if (e.key === 'F11' || (e.ctrlKey && e.shiftKey && e.key === 'D')) {
      e.preventDefault();
      toggleDemoMode();
    }

    // Ctrl+Enter：执行指令
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      const command = elements.commandInput.value.trim();
      if (command) parseAndExecuteCommand(command);
    }

    // 数字键 1/2/3：选择候选（候选覆盖层打开时）
    if (elements.candidatesOverlay.style.display === 'flex' && state.candidates) {
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        const index = parseInt(e.key) - 1;
        if (index < state.candidates.length) {
          selectCandidate(index);
        }
      }
      // Esc：折叠候选到右下角"待决策"徽标（设计文档 3.5 节）
      if (e.key === 'Escape') {
        foldCandidatesToBadge();
      }
    }
  });
}

// ==================== 初始化 ====================

// 检查飞书连接状态
async function checkFeishuStatus() {
  const container = document.getElementById('feishu-status');
  const text = document.getElementById('feishu-text');

  if (!container || !text) return;

  try {
    const data = await apiRequest('/feishu-status');

    if (data.connected) {
      // 根据同步模式显示不同状态
      const modeText = data.sync_mode === 'websocket' ? '实时同步'
                     : data.sync_mode === 'polling' ? '轮询(30s)'
                     : '已连接';
      const latencyHint = data.sync_latency ? ` (${data.sync_latency})` : '';

      // 使用 SVG 渲染绿色圆点
      container.innerHTML = '<svg id="feishu-dot" width="12" height="12" viewBox="0 0 12 12" style="vertical-align: middle;"><circle cx="6" cy="6" r="5" fill="#52c41a" stroke="#389e0d" stroke-width="1"/></svg><span class="status-text" id="feishu-text">' + modeText + latencyHint + '</span>';
      console.log('Feishu status: connected, sync_mode=' + data.sync_mode + ', latency=' + data.sync_latency);
    } else {
      container.innerHTML = '<svg id="feishu-dot" width="12" height="12" viewBox="0 0 12 12" style="vertical-align: middle;"><circle cx="6" cy="6" r="5" fill="#999999" stroke="#666666" stroke-width="1"/></svg><span class="status-text" id="feishu-text">' + (data.reason === 'mock_mode' ? '未配置' : '断开') + '</span>';
    }
  } catch (error) {
    container.innerHTML = '<svg id="feishu-dot" width="12" height="12" viewBox="0 0 12 12" style="vertical-align: middle;"><circle cx="6" cy="6" r="5" fill="#ff4d4f" stroke="#cf1322" stroke-width="1"/></svg><span class="status-text" id="feishu-text">检测失败</span>';
  }
}

/**
 * 加载会话列表并更新下拉框
 */
async function loadSessionList() {
  try {
    const data = await apiRequest('/sessions');

    if (data.success && data.sessions && data.sessions.length > 0) {
      // 清空现有选项
      elements.sessionSelect.innerHTML = '<option value="">选择历史会话...</option>';

      // 添加会话选项
      for (const session of data.sessions) {
        const option = document.createElement('option');
        option.value = session.session_id;

        // 格式化时间显示
        const updatedAt = new Date(session.updated_at);
        const timeStr = updatedAt.toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });

        option.textContent = `${session.session_id.slice(0, 8)}... (${session.record_count}条) ${timeStr}`;

        // 标记当前会话
        if (state.sessionId === session.session_id) {
          option.selected = true;
        }

        elements.sessionSelect.appendChild(option);
      }

      // 显示下拉框
      elements.sessionSelect.style.display = 'inline-block';
      return data.sessions;
    }
  } catch (error) {
    console.warn('加载会话列表失败:', error);
  }

  return [];
}

/**
 * 处理会话选择变更
 */
async function handleSessionSelectChange() {
  const selectedSessionId = elements.sessionSelect.value;

  console.log('会话选择变更:', selectedSessionId, '当前会话:', state.sessionId);

  if (!selectedSessionId) {
    return;
  }

  // 如果选择了当前会话，不做任何操作
  if (selectedSessionId === state.sessionId) {
    console.log('选择的是当前会话，跳过');
    return;
  }

  // 切换到选中的会话
  await switchToSession(selectedSessionId);
}

/**
 * 切换到指定会话
 */
async function switchToSession(sessionId) {
  console.log('切换到会话:', sessionId);
  try {
    setStatus('正在切换会话...', 'info');

    // 关闭现有 WebSocket 连接
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }

    // 更新状态
    state.sessionId = sessionId;
    state.records = [];
    state.skus = [];
    state.candidates = null;

    // 更新 UI
    elements.sessionId.textContent = `会话: ${sessionId.slice(0, 8)}...`;

    // 连接 WebSocket
    connectWebSocket();

    // 加载会话状态
    console.log('加载会话状态...');
    await getSessionState();
    console.log('会话状态已加载, records:', state.records.length);

    // 加载备弹
    await loadInitialSkus();

    // 强制刷新 UI（确保切换后界面更新）
    renderAll();

    // 更新下拉框选中状态
    for (const option of elements.sessionSelect.options) {
      option.selected = option.value === sessionId;
    }

    setStatus(`已切换到会话 ${sessionId.slice(0, 8)}...`, 'success');
  } catch (error) {
    console.error('切换会话失败:', error);
    setStatus(`切换会话失败: ${error.message}`, 'error');
  }
}

/**
 * 自动加载最近的会话
 * 页面刷新后尝试恢复之前的会话
 */
async function autoLoadRecentSession() {
  try {
    const data = await apiRequest('/sessions');

    if (data.success && data.sessions && data.sessions.length > 0) {
      // 加载会话列表到下拉框
      await loadSessionListFromData(data.sessions);

      // 获取最近的会话（已按更新时间排序）
      const recentSession = data.sessions[0];

      state.sessionId = recentSession.session_id;
      elements.sessionId.textContent = `会话: ${state.sessionId.slice(0, 8)}...`;

      // 更新下拉框选中状态
      for (const option of elements.sessionSelect.options) {
        option.selected = option.value === state.sessionId;
      }

      // 连接 WebSocket
      connectWebSocket();

      // 加载会话状态
      await getSessionState();

      // 加载初始备弹
      await loadInitialSkus();

      setStatus(`已恢复最近会话 (${recentSession.record_count} 条记录)`, 'success');
      return true;
    }
  } catch (error) {
    console.warn('自动加载会话失败:', error);
  }

  return false;
}

/**
 * 从已有数据加载会话列表到下拉框
 */
async function loadSessionListFromData(sessions) {
  // 清空现有选项
  elements.sessionSelect.innerHTML = '<option value="">选择历史会话...</option>';

  // 添加会话选项
  for (const session of sessions) {
    const option = document.createElement('option');
    option.value = session.session_id;

    // 格式化时间显示
    const updatedAt = new Date(session.updated_at);
    const timeStr = updatedAt.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    option.textContent = `${session.session_id.slice(0, 8)}... (${session.record_count}条) ${timeStr}`;
    elements.sessionSelect.appendChild(option);
  }

  // 显示下拉框
  elements.sessionSelect.style.display = 'inline-block';
}

async function init() {
  initElements();
  initEventListeners();
  checkFeishuStatus(); // 检查飞书连接状态

  // 初始调整面板高度
  adjustPanelHeight();

  // 尝试自动加载最近的会话
  const sessionLoaded = await autoLoadRecentSession();

  if (!sessionLoaded) {
    renderAll();
    setStatus('就绪 - 点击"新建会话"开始');
  }

  // 最终调整高度（确保所有内容加载后）
  setTimeout(adjustPanelHeight, 100);
}

// 启动应用
document.addEventListener('DOMContentLoaded', init);

// 动态调整面板高度，确保快捷指令区始终可见
function adjustPanelHeight() {
  const header = document.querySelector('.header');
  const footer = document.querySelector('.footer');
  const main = document.querySelector('.main');
  const panels = document.querySelectorAll('.panel');

  if (!header || !footer || !main || panels.length === 0) return;

  const headerHeight = header.offsetHeight;
  const footerHeight = footer.offsetHeight;
  const mainPadding = 22; // 16px top + 6px bottom (70px padding - footer overlap)

  // 计算可用高度
  const availableHeight = window.innerHeight - headerHeight - footerHeight - mainPadding;

  // 设置面板最大高度
  panels.forEach(panel => {
    panel.style.maxHeight = `${availableHeight}px`;
    panel.style.minHeight = `${Math.min(400, availableHeight)}px`;
  });

  // 设置对话区共识链的最大高度（为阶段指示和快捷指令留空间）
  const dialogPanel = document.querySelector('.dialog-panel');
  if (dialogPanel) {
    const panelContent = dialogPanel.querySelector('.panel-content');
    const stageIndicator = dialogPanel.querySelector('.stage-indicator');
    const commandSection = dialogPanel.querySelector('.command-section');

    if (panelContent && stageIndicator && commandSection) {
      const stageHeight = stageIndicator.offsetHeight + 12; // margin
      const commandHeight = commandSection.offsetHeight + 16; // margin + padding
      const panelHeaderHeight = 45; // h2 + padding
      const panelPadding = 32; // panel-content padding

      const chainMaxHeight = availableHeight - panelHeaderHeight - panelPadding - stageHeight - commandHeight - 20;
      const consensusChain = dialogPanel.querySelector('.consensus-chain');
      if (consensusChain) {
        consensusChain.style.maxHeight = `${Math.max(100, chainMaxHeight)}px`;
      }
    }
  }

  // 同样调整左栏和右栏的滚动区域
  const statusPanel = document.querySelector('.status-panel');
  if (statusPanel) {
    const fieldsStatus = statusPanel.querySelector('.fields-status');
    if (fieldsStatus) {
      const panelHeader = 45;
      const completenessHeight = statusPanel.querySelector('.completeness-section')?.offsetHeight || 60;
      const stageHeight = statusPanel.querySelector('.current-stage')?.offsetHeight || 60;
      const padding = 32;
      const maxFieldsHeight = availableHeight - panelHeader - padding - completenessHeight - stageHeight - 20;
      fieldsStatus.style.maxHeight = `${Math.max(80, maxFieldsHeight)}px`;
    }
  }

  const suggestionPanel = document.querySelector('.suggestion-panel');
  if (suggestionPanel) {
    const skuList = suggestionPanel.querySelector('#sku-list');
    if (skuList) {
      const panelHeader = 45;
      const statusHeight = suggestionPanel.querySelector('.suggestion-status')?.offsetHeight || 40;
      const currentSuggestionHeight = suggestionPanel.querySelector('.current-suggestion')?.offsetHeight || 80;
      const skuHeaderHeight = suggestionPanel.querySelector('.sku-header')?.offsetHeight || 30;
      const padding = 32;
      const maxSkuHeight = availableHeight - panelHeader - padding - statusHeight - currentSuggestionHeight - skuHeaderHeight - 20;
      skuList.style.maxHeight = `${Math.max(60, maxSkuHeight)}px`;
    }
  }
}

// 监听窗口调整
window.addEventListener('resize', adjustPanelHeight);
window.addEventListener('load', adjustPanelHeight);

// 全局函数（供 HTML onclick 使用）
window.confirmRecord = async function(recordId) {
  if (!state.sessionId) return;

  try {
    await apiRequest(`/sessions/${state.sessionId}/records/${recordId}/confirm`, {
      method: 'POST'
    });
    setStatus('记录已确认', 'success');
    await getSessionState();
  } catch (error) {
    setStatus(`确认失败: ${error.message}`, 'error');
  }
};

window.correctRecord = async function(recordId) {
  if (!state.sessionId) return;

  // 找到原记录内容作为默认值
  const record = state.records.find(r => r.id === recordId);
  if (!record) return;

  const newContent = prompt('请输入修正内容：', record.content);
  if (!newContent || newContent === record.content) return;

  try {
    await apiRequest(`/sessions/${state.sessionId}/records/${recordId}/correct`, {
      method: 'POST',
      body: JSON.stringify({
        content: newContent,
        source: 'manual_correction',
        type: record.type,
        stage: record.stage
      })
    });
    setStatus('记录已修正', 'success');
    await getSessionState();
  } catch (error) {
    setStatus(`修正失败: ${error.message}`, 'error');
  }
};

window.selectCandidate = selectCandidate;