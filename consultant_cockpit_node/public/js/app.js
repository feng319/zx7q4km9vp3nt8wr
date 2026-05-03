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
  records: [],
  candidates: null,
  skus: [],
  currentStage: '战略梳理',
  completeness: 0,
  fieldsStatus: {},
  currentSuggestion: null,
  ws: null,
  llmProvider: 'deepseek-free',
  llmModel: 'deepseek/deepseek-v4-pro-free',
  demoMode: false
};

// DOM 元素引用（新布局）
const elements = {};

// 初始化 DOM 元素引用
function initElements() {
  // Header
  elements.sessionId = document.getElementById('session-id');
  elements.newSessionBtn = document.getElementById('new-session-btn');
  elements.llmProvider = document.getElementById('llm-provider');
  elements.llmModel = document.getElementById('llm-model');

  // 左栏：诊断进度
  elements.completenessProgress = document.getElementById('completeness-progress');
  elements.completenessValue = document.getElementById('completeness-value');
  elements.fieldsStatus = document.getElementById('fields-status');
  elements.currentStage = document.getElementById('current-stage');

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
    const data = await apiRequest('/sessions', { method: 'POST' });
    state.sessionId = data.session_id;
    elements.sessionId.textContent = `会话: ${state.sessionId.slice(0, 8)}...`;
    setStatus('会话创建成功', 'success');

    // 连接 WebSocket
    connectWebSocket();

    // 清空记录
    state.records = [];
    state.completeness = 0;
    state.fieldsStatus = {};
    renderAll();

    // 自动加载初始备弹（使用默认关键词）
    await loadInitialSkus();
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
    state.currentStage = data.current_stage || '战略梳理';
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
      getSessionState();
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

async function executeRecordCommand(content) {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  const recordType = inferType(content);

  try {
    await apiRequest(`/sessions/${state.sessionId}/records`, {
      method: 'POST',
      body: JSON.stringify({
        type: recordType,
        content: content,
        stage: state.currentStage,
        source: 'manual'
      })
    });

    elements.commandInput.value = '';
    setStatus(`已记录 (类型: ${recordType}, 阶段: ${state.currentStage})`, 'success');
    await getSessionState();
  } catch (error) {
    setStatus(`记录失败: ${error.message}`, 'error');
  }
}

async function executeConfirmCommand() {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  // 找到最近一条待确认共识
  const pendingConsensus = state.records
    .filter(r => r.type === 'consensus' && r.status === 'pending_client_confirm')
    .pop();

  if (!pendingConsensus) {
    setStatus('没有待确认的共识', 'warning');
    return;
  }

  try {
    await apiRequest(`/sessions/${state.sessionId}/records/${pendingConsensus.id}/confirm`, {
      method: 'POST'
    });
    setStatus(`已确认: ${pendingConsensus.content.slice(0, 30)}...`, 'success');
    await getSessionState();
  } catch (error) {
    setStatus(`确认失败: ${error.message}`, 'error');
  }
}

async function executeStageSwitchCommand(stage) {
  if (stage) {
    // 指定阶段
    if (STAGES.includes(stage)) {
      state.currentStage = stage;
      elements.currentStage.textContent = stage;
      elements.stageDisplay.textContent = stage;
      setStatus(`已切换到: ${stage}`, 'success');
    } else {
      setStatus(`无效阶段: ${stage}，可选: ${STAGES.join(', ')}`, 'warning');
    }
  } else {
    // 切换到下一阶段
    const currentIdx = STAGES.indexOf(state.currentStage);
    const nextIdx = (currentIdx + 1) % STAGES.length;
    const nextStage = STAGES[nextIdx];
    state.currentStage = nextStage;
    elements.currentStage.textContent = nextStage;
    elements.stageDisplay.textContent = nextStage;
    setStatus(`已切换到: ${nextStage}`, 'success');
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

    if (data.constraint_message) {
      setStatus(data.constraint_message, 'warning');
    } else {
      state.candidates = data.candidates;
      showCandidatesOverlay();
      setStatus('候选方案已生成', 'success');
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
      <div class="candidate-card" data-index="${index}" onclick="selectCandidate(${index})">
        <div class="candidate-card-label">候选 ${String.fromCharCode(65 + index)}</div>
        <div class="candidate-card-title">${escapeHtml(candidate.title || `方案 ${index + 1}`)}</div>
        <div class="candidate-card-desc">${escapeHtml(candidate.description)}</div>
      </div>
    `;
  }).join('');

  // 清除红点徽标
  elements.candidateBadge.textContent = '';
}

function hideCandidatesOverlay() {
  elements.candidatesOverlay.style.display = 'none';
  elements.candidatesOverlay.closest('.dialog-panel').classList.remove('has-candidates');
}

async function selectCandidate(index) {
  if (!state.sessionId || !state.candidates) return;

  const candidate = state.candidates[index];

  try {
    // 候选选中自动进入共识链（设计文档 4.2 节）
    await apiRequest(`/sessions/${state.sessionId}/records`, {
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

    hideCandidatesOverlay();
    setStatus(`已选择候选 ${String.fromCharCode(65 + index)}`, 'success');
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
  updateCandidateBadge();
}

function renderCompleteness() {
  elements.completenessProgress.style.width = `${state.completeness}%`;
  elements.completenessValue.textContent = `${Math.round(state.completeness)}%`;
}

function renderFieldsStatus() {
  const fieldNames = ['产品线', '客户群体', '收入结构', '毛利结构', '交付情况', '资源分布', '战略目标', '显性诉求', '隐性痛点'];

  elements.fieldsStatus.innerHTML = fieldNames.map(name => {
    const status = state.fieldsStatus[name] || 'empty';
    const icon = status === 'confirmed' ? '✓' : status === 'partial' ? '◑' : '○';
    return `
      <div class="field-item status-${status}">
        <span class="field-icon">${icon}</span>
        <span class="field-name">${name}</span>
      </div>
    `;
  }).join('');
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
      </div>
      <div class="record-content">${escapeHtml(record.content)}</div>
      ${record.status === 'pending_client_confirm' ? `
        <div class="record-actions">
          <button class="btn btn-success btn-sm" onclick="confirmRecord('${record.id}')">确认</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

function renderStageDisplay() {
  elements.currentStage.textContent = state.currentStage;
  elements.stageDisplay.textContent = state.currentStage;
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

  // 两个约束都满足才显示红点
  if (firstConstraintMet && secondConstraintMet) {
    elements.candidateBadge.textContent = '🔴';
  } else {
    elements.candidateBadge.textContent = '';
  }
}

function getStatusText(status) {
  const statusMap = {
    recorded: '已记录',
    pending_client_confirm: '待确认',
    confirmed: '已确认',
    superseded: '已作废'
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
      // Esc：关闭候选覆盖层
      if (e.key === 'Escape') {
        hideCandidatesOverlay();
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
      // 使用 SVG 渲染绿色圆点
      container.innerHTML = '<svg id="feishu-dot" width="12" height="12" viewBox="0 0 12 12" style="vertical-align: middle;"><circle cx="6" cy="6" r="5" fill="#52c41a" stroke="#389e0d" stroke-width="1"/></svg><span class="status-text" id="feishu-text">已连接</span>';
      console.log('Feishu status: connected (SVG green dot)');
    } else {
      container.innerHTML = '<svg id="feishu-dot" width="12" height="12" viewBox="0 0 12 12" style="vertical-align: middle;"><circle cx="6" cy="6" r="5" fill="#999999" stroke="#666666" stroke-width="1"/></svg><span class="status-text" id="feishu-text">' + (data.reason === 'mock_mode' ? '未配置' : '断开') + '</span>';
    }
  } catch (error) {
    container.innerHTML = '<svg id="feishu-dot" width="12" height="12" viewBox="0 0 12 12" style="vertical-align: middle;"><circle cx="6" cy="6" r="5" fill="#ff4d4f" stroke="#cf1322" stroke-width="1"/></svg><span class="status-text" id="feishu-text">检测失败</span>';
  }
}

function init() {
  initElements();
  initEventListeners();
  checkFeishuStatus(); // 检查飞书连接状态
  renderAll();
  setStatus('就绪 - 点击"新建会话"开始');
}

// 启动应用
document.addEventListener('DOMContentLoaded', init);

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

window.selectCandidate = selectCandidate;