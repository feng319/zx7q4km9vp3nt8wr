/**
 * 顾问现场作战系统 - 前端应用
 */

// API 基础路径
const API_BASE = '/api';

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
  ws: null,
  llmProvider: 'deepseek-free',
  llmModel: 'deepseek/deepseek-v4-pro-free'
};

// DOM 元素
const elements = {
  sessionId: document.getElementById('session-id'),
  newSessionBtn: document.getElementById('new-session-btn'),
  llmProvider: document.getElementById('llm-provider'),
  llmModel: document.getElementById('llm-model'),
  recordType: document.getElementById('record-type'),
  recordStage: document.getElementById('record-stage'),
  recordContent: document.getElementById('record-content'),
  recordSource: document.getElementById('record-source'),
  addRecordBtn: document.getElementById('add-record-btn'),
  recordsList: document.getElementById('records-list'),
  getCandidatesBtn: document.getElementById('get-candidates-btn'),
  candidatesList: document.getElementById('candidates-list'),
  recallKeywords: document.getElementById('recall-keywords'),
  recallBtn: document.getElementById('recall-btn'),
  skuList: document.getElementById('sku-list'),
  generateMemoBtn: document.getElementById('generate-memo-btn'),
  generateBattleCardBtn: document.getElementById('generate-battle-card-btn'),
  exportBtn: document.getElementById('export-btn'),
  importBtn: document.getElementById('import-btn'),
  importFile: document.getElementById('import-file'),
  statusBar: document.getElementById('status-bar')
};

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

async function apiRequest(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// 会话管理
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
    renderRecords();
  } catch (error) {
    setStatus(`创建会话失败: ${error.message}`, 'error');
  }
}

async function getSessionState() {
  if (!state.sessionId) return;

  try {
    const data = await apiRequest(`/sessions/${state.sessionId}`);
    state.records = data.records || [];
    renderRecords();
  } catch (error) {
    console.error('获取会话状态失败:', error);
  }
}

// WebSocket 连接
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
    // 尝试重连
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
      renderCandidates();
      break;
  }
}

// 记录管理
async function addRecord() {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  const content = elements.recordContent.value.trim();
  if (!content) {
    setStatus('请输入内容', 'warning');
    return;
  }

  const originalText = showLoading(elements.addRecordBtn);

  try {
    await apiRequest(`/sessions/${state.sessionId}/records`, {
      method: 'POST',
      body: JSON.stringify({
        type: elements.recordType.value,
        content: content,
        stage: elements.recordStage.value,
        source: elements.recordSource.value || 'manual'
      })
    });

    elements.recordContent.value = '';
    elements.recordSource.value = '';
    setStatus('记录添加成功', 'success');

    // 刷新记录列表
    await getSessionState();
  } catch (error) {
    setStatus(`添加记录失败: ${error.message}`, 'error');
  } finally {
    hideLoading(elements.addRecordBtn, originalText);
  }
}

async function confirmRecord(recordId) {
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
}

async function correctRecord(recordId) {
  const newContent = prompt('请输入修正内容:');
  if (!newContent) return;

  try {
    await apiRequest(`/sessions/${state.sessionId}/records/${recordId}/correct`, {
      method: 'POST',
      body: JSON.stringify({ content: newContent })
    });
    setStatus('记录已修正', 'success');
    await getSessionState();
  } catch (error) {
    setStatus(`修正失败: ${error.message}`, 'error');
  }
}

// 渲染记录列表
function renderRecords() {
  if (state.records.length === 0) {
    elements.recordsList.innerHTML = '<div class="empty-state">暂无记录</div>';
    return;
  }

  elements.recordsList.innerHTML = state.records.map(record => `
    <div class="record-item" data-id="${record.id}">
      <div class="record-header">
        <span class="record-type ${record.type}">${record.type === 'fact' ? '事实' : '判断'}</span>
        <span class="record-stage">${record.stage}</span>
        <span class="status-tag ${record.status}">${getStatusText(record.status)}</span>
      </div>
      <div class="record-content">${escapeHtml(record.content)}</div>
      ${record.status !== 'superseded' ? `
        <div class="record-actions">
          <button class="btn btn-success btn-sm" onclick="confirmRecord('${record.id}')">确认</button>
          <button class="btn btn-secondary btn-sm" onclick="correctRecord('${record.id}')">修正</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

function getStatusText(status) {
  const statusMap = {
    recorded: '已记录',
    confirmed: '已确认',
    superseded: '已作废'
  };
  return statusMap[status] || status;
}

// 候选方案
async function getCandidates() {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  const originalText = showLoading(elements.getCandidatesBtn);

  try {
    const data = await apiRequest(`/sessions/${state.sessionId}/candidates`);

    if (data.constraint_message) {
      elements.candidatesList.innerHTML = `<div class="empty-state">${data.constraint_message}</div>`;
    } else {
      state.candidates = data.candidates;
      renderCandidates();
    }
  } catch (error) {
    setStatus(`获取候选方案失败: ${error.message}`, 'error');
  } finally {
    hideLoading(elements.getCandidatesBtn, originalText);
  }
}

function renderCandidates() {
  if (!state.candidates || state.candidates.length === 0) {
    elements.candidatesList.innerHTML = '<div class="empty-state">暂无候选方案</div>';
    return;
  }

  const riskLabels = {
    low: { text: '稳健', class: 'low' },
    medium: { text: '平衡', class: 'medium' },
    high: { text: '激进', class: 'high' }
  };

  elements.candidatesList.innerHTML = state.candidates.map((candidate, index) => {
    const risk = riskLabels[candidate.risk_level] || riskLabels.medium;
    return `
      <div class="candidate-item ${candidate.risk_level}">
        <div class="candidate-header">
          <strong>方案 ${index + 1}</strong>
          <span class="candidate-risk ${risk.class}">${risk.text}</span>
        </div>
        <div class="candidate-content">${escapeHtml(candidate.description)}</div>
      </div>
    `;
  }).join('');
}

// 知识召回
async function recallKnowledge() {
  if (!state.sessionId) {
    setStatus('请先创建会话', 'warning');
    return;
  }

  const keywords = elements.recallKeywords.value.trim();
  if (!keywords) {
    setStatus('请输入关键词', 'warning');
    return;
  }

  const originalText = showLoading(elements.recallBtn);

  try {
    const data = await apiRequest(`/sessions/${state.sessionId}/recall`, {
      method: 'POST',
      body: JSON.stringify({ keywords: keywords.split(/[,，]/).map(k => k.trim()) })
    });

    state.skus = data.skus || [];
    renderSkus();
    setStatus(`召回 ${state.skus.length} 条知识`, 'success');
  } catch (error) {
    setStatus(`召回失败: ${error.message}`, 'error');
  } finally {
    hideLoading(elements.recallBtn, originalText);
  }
}

function renderSkus() {
  if (state.skus.length === 0) {
    elements.skuList.innerHTML = '<div class="empty-state">暂无召回结果</div>';
    return;
  }

  elements.skuList.innerHTML = state.skus.map(sku => `
    <div class="sku-item">
      <span class="sku-confidence">${sku.confidence}</span>
      <div class="sku-info">
        <div class="sku-title">${escapeHtml(sku.title)}</div>
        <div class="sku-summary">${escapeHtml(sku.summary)}</div>
      </div>
    </div>
  `).join('');
}

// 文档生成
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

    // 下载 Word 文档
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
  // 假设返回的是 base64 编码的文档
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

// 导入导出
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

// 工具函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 初始化 LLM 选择器
function initLLMSelector() {
  const providerSelect = elements.llmProvider;
  const modelSelect = elements.llmModel;

  // 填充模型下拉框
  function populateModels(providerId) {
    const provider = LLM_PROVIDERS[providerId];
    if (!provider) return;

    modelSelect.innerHTML = provider.models.map(model =>
      `<option value="${model.id}">${model.name}</option>`
    ).join('');

    // 更新状态
    state.llmProvider = providerId;
    state.llmModel = provider.models[0]?.id || '';
  }

  // 初始化当前提供商的模型列表
  populateModels(providerSelect.value);

  // 提供商切换事件
  providerSelect.addEventListener('change', (e) => {
    populateModels(e.target.value);
    setStatus(`已切换到 ${LLM_PROVIDERS[e.target.value].name}`, 'success');
  });

  // 模型切换事件
  modelSelect.addEventListener('change', (e) => {
    state.llmModel = e.target.value;
    setStatus(`已选择模型: ${e.target.options[e.target.selectedIndex].text}`, 'success');
  });
}

// 事件绑定
function initEventListeners() {
  // 初始化 LLM 选择器
  initLLMSelector();

  elements.newSessionBtn.addEventListener('click', createSession);
  elements.addRecordBtn.addEventListener('click', addRecord);
  elements.getCandidatesBtn.addEventListener('click', getCandidates);
  elements.recallBtn.addEventListener('click', recallKnowledge);
  elements.generateMemoBtn.addEventListener('click', generateMemo);
  elements.generateBattleCardBtn.addEventListener('click', generateBattleCard);
  elements.exportBtn.addEventListener('click', exportSession);

  elements.importBtn.addEventListener('click', () => {
    elements.importFile.click();
  });

  elements.importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      importSession(file);
    }
  });

  // 快捷键
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          addRecord();
          break;
        case 's':
          e.preventDefault();
          exportSession();
          break;
      }
    }
  });
}

// 初始化
function init() {
  initEventListeners();
  setStatus('就绪 - 点击"新建会话"开始');
}

// 启动应用
document.addEventListener('DOMContentLoaded', init);

// 全局函数（供 HTML onclick 使用）
window.confirmRecord = confirmRecord;
window.correctRecord = correctRecord;
