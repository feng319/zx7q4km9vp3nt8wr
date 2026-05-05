# 顾问现场作战系统 · 完整开发计划

> **创建日期**: 2026-05-05
> **基于文档**: 页面重构.md v2.0 + 重构4.md v1.2.2
> **状态**: 待实施

---

## 一、开发阶段总览

```
┌─────────────────────────────────────────────────────────────────┐
│  Stage 0: 已完成（4批次重构）                                     │
│  ├── Batch 1: 后端数据结构 ✅                                    │
│  ├── Batch 2: 前端交互（阶段锁定） ✅                             │
│  ├── Batch 3: API 接口（target_field） ✅                        │
│  └── Batch 4: 命令清理分析 ✅                                    │
├─────────────────────────────────────────────────────────────────┤
│  Stage 1: 纯样式改动（页面重构 Phase 1）                          │
│  预计工时: 4h | 风险: 零 | 状态: ✅ 已完成                        │
├─────────────────────────────────────────────────────────────────┤
│  Stage 2: 前端交互改动（页面重构 Phase 2）                        │
│  预计工时: 8h | 风险: 低 | 状态: ✅ 已完成                        │
├─────────────────────────────────────────────────────────────────┤
│  Stage 3: 逻辑/数据改动（页面重构 Phase 3）                       │
│  预计工时: 8h | 风险: 中 | 状态: ✅ 已完成                        │
├─────────────────────────────────────────────────────────────────┤
│  Stage 4: 数据结构扩展（重构4.md P0-1 ~ P0-2）                   │
│  预计工时: 5.5h | 风险: 中 | 状态: ✅ 已完成                      │
├─────────────────────────────────────────────────────────────────┤
│  Stage 5: 六类假设响应机制（重构4.md P0-3）                       │
│  预计工时: 12.5h | 风险: 高 | 状态: ❌ 未开始                     │
├─────────────────────────────────────────────────────────────────┤
│  Stage 6: 追问建议与上下文（重构4.md P0-5 ~ P0-6）                │
│  预计工时: 14.5h | 风险: 中 | 状态: ❌ 未开始                     │
├─────────────────────────────────────────────────────────────────┤
│  Stage 7: 备忘录与作战卡（重构4.md P0-4 + Phase 0）               │
│  预计工时: 12h | 风险: 中 | 状态: ❌ 未开始                       │
├─────────────────────────────────────────────────────────────────┤
│  Stage 8: P1/P2 工作包（重构4.md P1 ~ P2）                       │
│  预计工时: 16h | 风险: 低 | 状态: ❌ 未开始                       │
└─────────────────────────────────────────────────────────────────┘

总工时: ~80h
```

---

## 二、Stage 1: 纯样式改动（页面重构 Phase 1）

**预计工时**: 4h | **风险**: 零 | **验收**: 截图对比，功能不变

### 1.1 整体布局比例调整

**文件**: `public/css/style.css`

```css
/* 当前 */
.main {
  grid-template-columns: 3fr 5fr 2fr;
}

/* 目标 */
.layout-container {
  display: flex;
  height: 100vh;
  width: 100%;
}
.col-left  { width: 30%; min-width: 200px; border-right: 1px solid #e5e7eb; }
.col-mid   { flex: 1; display: flex; flex-direction: column; }
.col-right { width: 20%; min-width: 160px; border-left: 1px solid #e5e7eb; }
```

### 1.2 左栏弹性上下分屏

**文件**: `public/css/style.css`, `public/index.html`

```css
.col-left {
  display: flex;
  flex-direction: column;
}
.left-fixed  { flex: none; padding: 12px; border-bottom: 1px solid #e5e7eb; }
.left-flex-a { flex: 1; overflow-y: auto; padding: 12px; border-bottom: 1px solid #e5e7eb; }
.left-flex-b { flex: 1; overflow-y: auto; padding: 12px; }
```

**HTML 结构调整**:
- `left-fixed`: 诊断进度（固定）
- `left-flex-a`: 已记事实（可滚动）
- `left-flex-b`: 核心共识（可滚动）

### 1.3 诊断进度改为标签网格

**文件**: `public/css/style.css`, `public/js/app.js`

```css
.progress-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  font-size: 11px;
}
.progress-tag         { padding: 2px 6px; border-radius: 4px; text-align: center; }
.progress-tag.done    { background: #dcfce7; color: #166534; }
.progress-tag.partial { background: #fef9c3; color: #854d0e; }
.progress-tag.empty   { background: #f3f4f6; color: #6b7280; }
```

### 1.4 当前阶段改为窄条 Banner

**文件**: `public/css/style.css`

```css
.stage-banner {
  padding: 4px 12px;
  background: #eff6ff;
  border-left: 3px solid #3b82f6;
  font-size: 12px;
  font-weight: 600;
  color: #1d4ed8;
  margin: 8px 0;
}
```

### 1.5 Fact 条目改为胶囊化单行

**文件**: `public/css/style.css`

```css
.fact-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
}
.fact-tag {
  flex-shrink: 0;
  padding: 1px 6px;
  background: #f3f4f6;
  border-radius: 4px;
  font-size: 11px;
  color: #374151;
  font-weight: 600;
}
.fact-content {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #4b5563;
}
.fact-actions { flex-shrink: 0; display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.fact-item:hover .fact-actions { opacity: 1; }
```

### 1.6 Consensus 卡片样式

**文件**: `public/css/style.css`

```css
.consensus-card {
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  font-size: 13px;
}
.consensus-card.pending   { border: 1.5px solid #f97316; background: #fff7ed; }
.consensus-card.confirmed { border: 1.5px solid #22c55e; background: #f0fdf4; }
```

### 1.7 SKU 卡片 Hover 展开

**文件**: `public/css/style.css`

```css
.sku-card {
  padding: 8px 10px;
  border-radius: 6px;
  background: #f9fafb;
  margin-bottom: 6px;
  cursor: pointer;
  max-height: 32px;
  overflow: hidden;
  transition: max-height 0.2s ease;
}
.sku-card:hover { max-height: 200px; }
.sku-card.stale { opacity: 0.45; } /* 超过3分钟的旧备弹 */
```

### 1.8 演示模式 CSS 完善

**文件**: `public/css/style.css`

```css
/* 演示模式：右栏折叠 */
.demo-mode .col-right {
  width: 0;
  overflow: hidden;
  opacity: 0;
  transition: width 0.3s ease, opacity 0.2s ease;
}
/* 演示模式：隐藏调试元素 */
.demo-mode .token-counter,
.demo-mode .api-timer,
.demo-mode .sku-id,
.demo-mode .confidence-label,
.demo-mode .debug-log,
.demo-mode .cmd-hint-bar,
.demo-mode .fact-actions { display: none; }
/* 演示模式：字体放大 */
.demo-mode .consensus-card { font-size: 15px; }
.demo-mode .progress-tag   { font-size: 13px; padding: 4px 8px; }
```

---

## 三、Stage 2: 前端交互改动（页面重构 Phase 2）

**预计工时**: 8h | **风险**: 低 | **验收**: 交互行为正确，后端不变

### 2.1 字段标签点击 → 输入框焦点

**文件**: `public/js/app.js`

```javascript
// 三种状态的点击行为
document.querySelectorAll('.progress-tag').forEach(tag => {
  tag.addEventListener('click', () => {
    const fieldName = tag.dataset.field;
    const status = tag.dataset.status;
    if (status === 'done' || status === 'partial') {
      openFocusEditCard(fieldName);  // 弹出编辑卡
    } else {
      setInputPrefix(fieldName);      // 设置输入框前缀
      document.querySelector('.main-input').focus();
      tag.classList.add('highlight');
      setTimeout(() => tag.classList.remove('highlight'), 300);
    }
  });
});

// 字段前缀管理
let currentFieldPrefix = null;
function setInputPrefix(fieldName) {
  currentFieldPrefix = fieldName;
  updateInputPlaceholder();
}
function clearInputPrefix() {
  currentFieldPrefix = null;
  updateInputPlaceholder();
}
```

### 2.2 事实/判断类型切换按钮

**文件**: `public/js/app.js`, `public/index.html`, `public/css/style.css`

```javascript
let currentType = 'fact';
typeToggleBtn.addEventListener('click', () => {
  currentType = currentType === 'fact' ? 'consensus' : 'fact';
  typeToggleBtn.textContent = currentType === 'fact' ? '事实' : '判断';
  typeToggleBtn.className = currentType === 'fact' ? 'btn-type-fact' : 'btn-type-consensus';
});

// 发送后重置
function onMessageSent() {
  currentType = 'fact';
  typeToggleBtn.textContent = '事实';
  typeToggleBtn.className = 'btn-type-fact';
  clearInputPrefix();
}

// 六类响应按钮激活时隐藏
function showHypothesisResponseButtons() {
  typeToggleBtn.style.display = 'none';
}
function onHypothesisResponseComplete() {
  typeToggleBtn.style.display = '';
  currentType = 'fact';
  typeToggleBtn.textContent = '事实';
  typeToggleBtn.className = 'btn-type-fact';
}
```

### 2.3 全局快捷键绑定

**文件**: `public/js/app.js`

```javascript
document.addEventListener('keydown', (e) => {
  // Tab：接受追问建议
  if (e.key === 'Tab' && !e.shiftKey && isSuggestionVisible()) {
    e.preventDefault();
    acceptSuggestion();
  }
  // Shift+Tab：跳过追问建议
  if (e.key === 'Tab' && e.shiftKey && isSuggestionVisible()) {
    e.preventDefault();
    skipSuggestion();
  }
  // Esc：候选卡状态切换
  if (e.key === 'Escape') {
    handleEscapeKey();
  }
  // 候选卡激活时：数字键 1/2/3 选中
  if (isCandidateCardActive() && ['1','2','3'].includes(e.key)) {
    selectCandidate(parseInt(e.key) - 1);
  }
  // 分支模式：A/B/C
  if (isBranchModeActive() && ['a','b','c','A','B','C'].includes(e.key)) {
    selectBranch(e.key.toLowerCase());
  }
  // Ctrl+Shift+D：演示模式切换
  if (e.ctrlKey && e.shiftKey && e.key === 'D') {
    e.preventDefault();
    toggleDemoMode();
  }
});
```

### 2.4 追问建议卡完整交互

**文件**: `public/js/app.js`

```javascript
// 普通模式
function renderNormalSuggestion(question) {
  return `
    <div class="suggestion-card">
      <span class="suggestion-icon">💡</span>
      <span class="suggestion-text">"${question}"</span>
      <div class="suggestion-actions">
        <button onclick="acceptSuggestion()">Tab 接受</button>
        <button onclick="skipSuggestion()">Shift+Tab 跳过</button>
      </div>
    </div>
  `;
}

// 分支模式
function renderBranchSuggestion(context, options) {
  return `
    <div class="suggestion-card branch-mode">
      <span class="suggestion-icon">💡</span>
      <span class="suggestion-text">客户说"${context}"，建议追问：</span>
      <div class="branch-options">
        ${options.map((opt, i) => `
          <button onclick="selectBranch('${String.fromCharCode(97 + i)}')">
            [${String.fromCharCode(65 + i)}] ${opt}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

// 消失时机
function onInputStart() {
  const card = document.querySelector('.suggestion-card');
  if (card) {
    card.style.opacity = '0';
    setTimeout(() => card.style.opacity = '', 300);
  }
}
```

### 2.5 候选卡片全生命周期

**文件**: `public/js/app.js`

```javascript
// 状态管理
let candidateState = 'hidden'; // hidden | active | translucent | folded

function showCandidates() {
  candidateState = 'active';
  elements.candidatesOverlay.style.display = 'flex';
  elements.dialogPanel.classList.add('has-candidates');
}

function handleEscapeKey() {
  if (candidateState === 'active') {
    candidateState = 'translucent';
    elements.candidatesOverlay.style.opacity = '0.5';
    elements.candidatesOverlay.style.background = 'transparent';
  } else if (candidateState === 'translucent') {
    candidateState = 'folded';
    elements.candidatesOverlay.style.display = 'none';
    elements.pendingDecisionBadge.style.display = 'flex';
  }
}

function restoreCandidates() {
  if (candidateState === 'translucent') {
    candidateState = 'active';
    elements.candidatesOverlay.style.opacity = '1';
    elements.candidatesOverlay.style.background = 'rgba(255, 255, 255, 0.6)';
  } else if (candidateState === 'folded') {
    showCandidates();
    elements.pendingDecisionBadge.style.display = 'none';
  }
}
```

### 2.6 阶段下拉切换器

**文件**: `public/js/app.js`, `public/index.html`

```javascript
function renderStageDropdown() {
  const current = state.currentStage;
  const others = STAGES.filter(s => s !== current);

  return `
    <div class="stage-dropdown" id="stage-dropdown">
      <div class="stage-current" onclick="toggleStageDropdown()">
        <span class="stage-dot">●</span>
        <span>${current} (当前)</span>
      </div>
      <div class="stage-options" style="display: none;">
        ${others.map(s => `
          <div class="stage-option" onclick="confirmStageChange('${s}')">
            <span class="stage-dot-empty">○</span>
            <span>${s}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function confirmStageChange(newStage) {
  // 内联确认（不弹窗）
  showInlineConfirm({
    message: `切换到"${newStage}"？候选缓存将重算`,
    onConfirm: () => executeStageChange(newStage),
    onCancel: () => toggleStageDropdown()
  });
}

// 六类响应按钮激活时锁定
function showHypothesisResponseButtons() {
  document.querySelector('.stage-banner').classList.add('stage-locked');
}
function onHypothesisResponseComplete() {
  document.querySelector('.stage-banner').classList.remove('stage-locked');
}
```

### 2.7 右栏搜索区交互

**文件**: `public/js/app.js`

```javascript
// 意图标签点击
document.querySelectorAll('.intent-tag').forEach(tag => {
  tag.addEventListener('click', () => {
    const intent = tag.dataset.intent; // 'case' | 'framework' | 'comparison'

    // 显示进度条
    tag.classList.add('loading');
    showProgressBar(tag);

    // 调用召回
    handleIntentTagClick(intent).then(() => {
      tag.classList.remove('loading');
      hideProgressBar();
    });
  });
});

async function handleIntentTagClick(intent) {
  const context = getRecentDialogContext(5);
  const results = await apiRequest('/recall', {
    method: 'POST',
    body: JSON.stringify({ intent, context, topK: 5 })
  });
  renderSkuCards(results);
}
```

### 2.8 中栏聚焦编辑卡

**文件**: `public/js/app.js`

```javascript
function openFocusEditCard(fieldName) {
  const record = findRecordByField(fieldName);
  if (!record) return;

  const card = document.createElement('div');
  card.className = 'focus-edit-card';
  card.innerHTML = `
    <div class="edit-card-header">
      <span>✏️ 修改${record.type === 'fact' ? '事实' : '判断'}记录</span>
      <button onclick="closeFocusEditCard()">×</button>
    </div>
    <div class="edit-card-body">
      <textarea id="edit-content">${record.content}</textarea>
      <div class="edit-card-type">
        <label><input type="radio" name="type" value="fact" ${record.type === 'fact' ? 'checked' : ''}> Fact</label>
        <label><input type="radio" name="type" value="consensus" ${record.type === 'consensus' ? 'checked' : ''}> Consensus</label>
      </div>
    </div>
    <div class="edit-card-footer">
      <button onclick="saveEditCard('${record.id}')">保存修改 Ctrl+Enter</button>
      <button onclick="closeFocusEditCard()">取消 Esc</button>
    </div>
  `;

  document.querySelector('.dialog-panel').appendChild(card);
}
```

### 2.9 演示模式隐藏知识库入口

**文件**: `public/js/app.js`

```javascript
// 演示模式下左栏迷你搜索
function renderDemoSearchIcon() {
  return `
    <div class="demo-search-icon" onclick="openMiniSearch()">
      🔍
    </div>
  `;
}

function openMiniSearch() {
  const miniSearch = document.createElement('div');
  miniSearch.className = 'mini-search';
  miniSearch.innerHTML = `
    <input type="text" placeholder="搜索知识库..." onkeydown="handleMiniSearch(event)">
    <div class="mini-results"></div>
  `;
  document.querySelector('.left-flex-b').appendChild(miniSearch);
}
```

### 2.10 AI 建议记录的 + 按钮

**文件**: `public/js/app.js`

```javascript
function renderAiSuggestionCard(suggestion) {
  return `
    <div class="sku-card ai-suggestion" style="border: 1px dashed #d1d5db;">
      <span class="ai-icon">💭</span>
      <span class="ai-text">建议记录：${suggestion.summary}</span>
      <button class="ai-add-btn" onclick="acceptAiSuggestion('${suggestion.id}')">+</button>
    </div>
  `;
}

function acceptAiSuggestion(suggestionId) {
  const suggestion = getAiSuggestion(suggestionId);
  // 填入输入框，类型预设为 consensus
  elements.commandInput.value = suggestion.content;
  currentType = 'consensus';
  updateTypeToggleBtn();
}
```

---

## 四、Stage 3: 逻辑/数据改动（页面重构 Phase 3）

**预计工时**: 8h | **风险**: 中 | **验收**: 完整链路跑通

### 3.1 移除 `/记` 指令，改为直接输入

**文件**: `public/js/app.js`

```javascript
// 修改 handleMessageSubmit
async function handleMessageSubmit(content, type, fieldPrefix) {
  const record = {
    content: content,
    type: type || currentType,           // 来自切换按钮
    target_field: fieldPrefix || currentFieldPrefix,  // 来自字段标签点击
    source: 'manual',
    stage: state.currentStage,
    timestamp: new Date().toISOString()
  };

  await apiRequest(`/sessions/${state.sessionId}/records`, {
    method: 'POST',
    body: JSON.stringify(record)
  });

  // 如果有 target_field，同步更新 client_profile
  if (record.target_field) {
    await apiRequest(`/sessions/${state.sessionId}/profile/${encodeURIComponent(record.target_field)}`, {
      method: 'PUT',
      body: JSON.stringify({ value: content })
    });
  }

  // 重置状态
  onMessageSent();
}

// 移除指令解析中的 /记 分支
// 原代码（删除）：
// if (command.startsWith('/记')) { ... }
```

### 3.2 追问建议接受 → 飞书写入

**文件**: `public/js/app.js`

```javascript
async function acceptSuggestion(suggestion) {
  // 1. 填入输入框
  elements.commandInput.value = suggestion.question;

  // 2. 写入飞书「当前追问」字段（防抖 1 秒）
  debouncedFeishuWrite('当前追问', suggestion.question, 1000);

  // 3. 切换为下一条建议
  loadNextSuggestion();
}

// 顾问输入客户回答后，清空「当前追问」
async function onClientAnswerSubmitted() {
  await apiRequest(`/sessions/${state.sessionId}/profile/当前追问`, {
    method: 'PUT',
    body: JSON.stringify({ value: '' })
  });
}
```

### 3.3 移除 `/切` 指令，改为下拉切换

**文件**: `public/js/app.js`

```javascript
// 移除指令解析中的 /切 分支
// 原代码（删除）：
// if (command.startsWith('/切')) { ... }

// 新逻辑：下拉确认后触发
async function executeStageChange(newStage) {
  // 1. 更新状态
  state.currentStage = newStage;

  // 2. 触发候选预计算重算
  await apiRequest(`/sessions/${state.sessionId}/candidates/invalidate`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'stage_changed' })
  });

  // 3. 更新 UI
  updateStageBanner(newStage);
  renderAll();
}
```

### 3.4 移除 `/确认` 指令，改为内联按钮

**文件**: `public/js/app.js`

```javascript
// 移除指令解析中的 /确认 分支
// 原代码（删除）：
// if (command === '/确认') { ... }

// 内联按钮已存在，确保功能正确
async function confirmRecord(recordId) {
  await apiRequest(`/sessions/${state.sessionId}/records/${recordId}/confirm`, {
    method: 'POST'
  });
  setStatus('已确认', 'success');
  await getSessionState();
}
```

### 3.5 移除召回指令，改为意图标签

**文件**: `public/js/app.js`

```javascript
// 移除指令解析中的 /案例 /框架 /对比 分支
// 原代码（删除）：
// if (command.startsWith('/案例')) { ... }
// if (command.startsWith('/框架')) { ... }
// if (command.startsWith('/对比')) { ... }

// 新逻辑：意图标签点击触发（见 2.7）
```

### 3.6 召回上限 UI 管理

**文件**: `public/js/app.js`

```javascript
const RECALL_LIMIT = 50;
const CANDIDATE_LIMIT = 20;

function checkRecallLimit() {
  if (state.recallCount >= RECALL_LIMIT) {
    disableAutoRecall();
    showTooltip(elements.skuList, '本次会议自动召回已达上限，可手动输入关键词搜索');
  }
}

function checkCandidateLimit() {
  if (state.candidateCount >= CANDIDATE_LIMIT) {
    elements.cmdCandidate.disabled = true;
    showTooltip(elements.cmdCandidate, '本次会议候选生成已达上限（20次）');
  }
}
```

### 3.7 备忘录生成触发入口

**文件**: `public/js/app.js`

```javascript
let meetingEnded = false;

function endMeeting() {
  meetingEnded = true;
  stopTimer();
  elements.generateMemoBtn.disabled = false;
  elements.generateMemoBtn.classList.add('btn-active');
}

async function generateMemo() {
  if (!meetingEnded) {
    setStatus('请先结束会议', 'warning');
    return;
  }

  const memo = await apiRequest(`/sessions/${state.sessionId}/memo`, {
    method: 'POST'
  });
  showMemoPreview(memo);
}
```

### 3.8 移除 `/候选` 指令，改为按钮触发

**文件**: `public/js/app.js`

```javascript
// 移除指令解析中的 /候选 分支
// 原代码（删除）：
// if (command === '/候选') { ... }

// 按钮点击事件
elements.cmdCandidate.addEventListener('click', async () => {
  if (!isCandidateConditionMet()) {
    showConditionNotMetFeedback();
    return;
  }
  await triggerCandidateGeneration();
});
```

---

## 五、Stage 4: 数据结构扩展（重构4.md P0-1 ~ P0-2）

**预计工时**: 5.5h | **风险**: 中

### 4.1 扩展 ConsensusRecord 类型

**文件**: `src/types.js`

```javascript
/**
 * @typedef {Object} ConsensusRecord
 * @property {string} id
 * @property {string} event_id - 事件关联 ID（新增）
 * @property {string} timestamp
 * @property {ConsensusType} type
 * @property {Stage} stage
 * @property {Stage} origin_stage - 假设提出阶段（新增）
 * @property {Stage} verified_stage - 假设验证阶段（新增）
 * @property {string} content
 * @property {RecordSource} source
 * @property {string|null} hypothesis_id - 关联假设 ID（新增）
 * @property {string|null} client_response_type - 六类场景类型（新增）
 * @property {string|null} avoidance_subtype - 回避子类型（新增）
 * @property {string|null} target_field
 * @property {string[]} evidence_sku
 * @property {RecordStatus} status
 * @property {ConfidenceLevel|null} confidence
 * @property {string|null} replaces
 * @property {string|null} superseded_by
 * @property {string|null} feishu_record_id
 * @property {string|null} recommendation
 * @property {string|null} rationale - 候选方向说明（新增）
 */

/**
 * @typedef {'manual' | 'candidate_selected' | 'ai_suggested' | 'manual_correction' |
 *          'hypothesis_confirmed' | 'hypothesis_partial' | 'hypothesis_rejected' |
 *          'hypothesis_avoided' | 'unplanned_info' | 'mid_meeting_generated'} RecordSource
 */
```

### 4.2 定义 HypothesisPlaybook

**文件**: `src/types.js`

```javascript
/**
 * @typedef {Object} HypothesisPlaybook
 * @property {string[]} if_confirmed - 验证成立时的深挖追问列表
 * @property {string[]} if_partial - 部分成立时的修正追问列表
 * @property {string[]} if_rejected - 推翻后的重定位追问列表
 * @property {Object} if_avoided - 按回避子类型分支
 * @property {string} solution_direction - 验证成立时写入候选生成的方向提示
 * @property {string} last_edited_by - "llm" | "consultant"
 * @property {string} last_edited_at - ISO timestamp
 */
```

### 4.3 完善 DiagnosisHypothesis

**文件**: `src/types.js`

```javascript
/**
 * @typedef {Object} DiagnosisHypothesis
 * @property {string} hypothesis_id
 * @property {string} content
 * @property {string} origin_source - "pre_meeting" | "mid_meeting_generated" | "reset_generated"
 * @property {Stage} origin_stage
 * @property {Stage} verified_stage
 * @property {string[]} trigger_keywords
 * @property {string} verification_question
 * @property {string|null} target_field
 * @property {string|null} framework_sku
 * @property {HypothesisPlaybook|null} playbook
 * @property {number} order
 * @property {number} priority_score
 * @property {'unverified'|'confirmed'|'partial'|'rejected'|'avoided'} status
 */
```

### 4.4 更新共识链写入逻辑

**文件**: `src/core/consensusChain.js`

```javascript
/**
 * 六类响应写入函数
 */
writeConsensusByResponseType(hypothesis, responseType, eventId, stage, extraContent = '') {
  const base = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    type: 'fact',
    stage: stage,
    origin_stage: hypothesis.origin_stage,
    verified_stage: stage,
    hypothesis_id: hypothesis.hypothesis_id,
    target_field: hypothesis.target_field,
    client_response_type: responseType,
    status: 'recorded',
    feishu_record_id: null
  };

  const records = [];

  if (responseType === 'confirmed') {
    records.push({ ...base, source: 'hypothesis_confirmed', content: hypothesis.content });
  } else if (responseType === 'partial') {
    records.push({ ...base, source: 'hypothesis_partial', content: `${hypothesis.content}（客户部分认可）` });
    if (extraContent) {
      records.push({ ...base, source: 'hypothesis_partial', content: `${extraContent}（客户修正因果链）` });
    }
  } else if (responseType === 'rejected_with_reason') {
    records.push({ ...base, source: 'hypothesis_rejected', content: `客户否认：${hypothesis.content}` });
    if (extraContent) {
      records.push({ ...base, source: 'manual', target_field: null, content: extraContent });
    }
  } else if (responseType === 'rejected_no_reason') {
    records.push({ ...base, source: 'hypothesis_rejected', content: `客户否认：${hypothesis.content}，未给出替代原因` });
  } else if (responseType === 'avoided') {
    records.push({ ...base, source: 'hypothesis_avoided', content: `客户回避：${hypothesis.content}`, confidence: 'low' });
  }

  records.forEach(r => this.addRecord(r));
  return records;
}
```

---

## 六、Stage 5: 六类假设响应机制（重构4.md P0-3）

**预计工时**: 12.5h | **风险**: 高

### 6.1 六类响应按钮 UI

**文件**: `public/js/app.js`, `public/css/style.css`

```javascript
function showHypothesisResponseButtons(hypothesisId) {
  const container = document.createElement('div');
  container.className = 'hypothesis-response-buttons';
  container.innerHTML = `
    <div class="response-header">客户反应：</div>
    <div class="response-buttons">
      <button class="response-btn confirm" onclick="handleResponse('${hypothesisId}', 'confirmed')">
        ✓ 确认
      </button>
      <button class="response-btn partial" onclick="handleResponse('${hypothesisId}', 'partial')">
        ◑ 部分成立
      </button>
      <button class="response-btn reject-reason" onclick="handleResponse('${hypothesisId}', 'rejected_with_reason')">
        ✗ 推翻·有新方向
      </button>
      <button class="response-btn reject-no" onclick="handleResponse('${hypothesisId}', 'rejected_no_reason')">
        ✗ 推翻·无新信息
      </button>
      <button class="response-btn avoid" onclick="handleResponse('${hypothesisId}', 'avoided')">
        ↷ 回避
      </button>
      <button class="response-btn counter" onclick="handleResponse('${hypothesisId}', 'counter_question')">
        ? 反问
      </button>
    </div>
  `;

  // 隐藏类型切换按钮
  typeToggleBtn.style.display = 'none';
  // 锁定阶段 Banner
  document.querySelector('.stage-banner').classList.add('stage-locked');

  elements.suggestionPanel.appendChild(container);
}
```

### 6.2 回避子类型选择

**文件**: `public/js/app.js`

```javascript
function showAvoidanceSubtypes(hypothesisId) {
  const container = document.createElement('div');
  container.className = 'avoidance-subtypes';
  container.innerHTML = `
    <div class="subtype-header">回避原因：</div>
    <div class="subtype-options">
      <button onclick="handleAvoidance('${hypothesisId}', 'sensitive')">[A] 数据敏感</button>
      <button onclick="handleAvoidance('${hypothesisId}', 'no_data')">[B] 内部没有精确数据</button>
      <button onclick="handleAvoidance('${hypothesisId}', 'out_of_scope')">[C] 超出权限范围</button>
      <button onclick="handleAvoidance('${hypothesisId}', 'deflected')">[D] 话题转移</button>
    </div>
  `;
  document.querySelector('.hypothesis-response-buttons').appendChild(container);
}
```

### 6.3 部分成立编辑框

**文件**: `public/js/app.js`

```javascript
function showPartialEditBox(hypothesis) {
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>客户部分认可</h3>
      </div>
      <div class="modal-body">
        <p>原假设：${hypothesis.content}</p>
        <p>客户修正为：</p>
        <textarea id="partial-content" rows="3" placeholder="根据客户原话简短记录"></textarea>
      </div>
      <div class="modal-footer">
        <button onclick="submitPartial('${hypothesis.hypothesis_id}')">确认修正内容</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}
```

### 6.4 暂缓队列机制

**文件**: `public/js/app.js`, `src/core/consensusChain.js`

```javascript
// 前端暂缓队列
let deferredQueue = [];

function addToDeferredQueue(question, timestamp) {
  deferredQueue.push({
    id: `deferred_${Date.now()}`,
    question,
    timestamp,
    stage: state.currentStage
  });
  renderDeferredQueue();
}

function renderDeferredQueue() {
  const container = document.getElementById('deferred-queue');
  container.innerHTML = deferredQueue.map(item => `
    <div class="deferred-item">
      <span class="deferred-time">${formatTime(item.timestamp)}</span>
      <span class="deferred-question">${item.question}</span>
      <button onclick="resumeDeferred('${item.id}')">重新切入</button>
      <button onclick="abandonDeferred('${item.id}')">放弃</button>
    </div>
  `).join('');
}

// 会议结束时批量处理
function onMeetingEnd() {
  if (deferredQueue.length > 0) {
    showDeferredHandlingDialog();
  } else {
    endMeeting();
  }
}
```

### 6.5 诊断重置流程

**文件**: `public/js/app.js`

```javascript
function checkAllHypothesesRejected() {
  const allRejected = state.hypotheses.every(
    h => h.status === 'rejected' || h.status === 'avoided'
  );

  if (allRejected && state.hypotheses.length > 0) {
    showDiagnosticResetDialog();
  }
}

function showDiagnosticResetDialog() {
  const dialog = document.createElement('div');
  dialog.className = 'reset-dialog';
  dialog.innerHTML = `
    <div class="reset-content">
      <h3>⚠️ 所有预设假设已被推翻或回避</h3>
      <p>当前共识链有 ${state.records.filter(r => r.status === 'confirmed').length} 条已确认事实，但尚未形成诊断方向。</p>
      <div class="reset-options">
        <button onclick="regenerateHypotheses()">基于现有事实重新生成假设</button>
        <button onclick="switchToOpenMode()">切换到开放追问模式</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
}
```

---

## 七、Stage 6: 追问建议与上下文（重构4.md P0-5 ~ P0-6）

**预计工时**: 14.5h | **风险**: 中

### 7.1 缺口识别函数

**文件**: `src/core/gapIdentifier.js`（新建）

```javascript
const CLIENT_PROFILE_FIELDS = [
  '客户公司名', '显性诉求', '产品线', '客户群体',
  '收入结构', '毛利结构', '交付情况', '资源分布', '战略目标'
];

const FIELD_SOURCE_EXCLUDE = new Set(['hypothesis_rejected', 'hypothesis_avoided']);

function getConfirmedConsensus(field, records) {
  return records.some(r =>
    r.target_field === field &&
    !FIELD_SOURCE_EXCLUDE.has(r.source) &&
    ['recorded', 'pending_client_confirm', 'confirmed'].includes(r.status)
  );
}

function confirmedFactCount(records) {
  return records.filter(r =>
    r.type === 'fact' &&
    r.status === 'confirmed' &&
    !FIELD_SOURCE_EXCLUDE.has(r.source)
  ).length;
}

function identifyGaps(records, hypotheses) {
  const gaps = [];

  // 1. 客户档案未填字段
  for (const field of CLIENT_PROFILE_FIELDS) {
    if (!getConfirmedConsensus(field, records)) {
      gaps.push({ type: 'field', field, message: `未知:${field}` });
    }
  }

  // 2. 未验证假设
  for (const hyp of hypotheses) {
    if (hyp.status === 'unverified') {
      gaps.push({ type: 'hypothesis', hypothesis: hyp, message: `未验证假设:${hyp.content}` });
    }
  }

  // 3. 候选生成三约束
  const factCount = confirmedFactCount(records);
  if (factCount < 3) {
    gaps.push({ type: 'constraint', message: `已确认事实不足（当前${factCount}条，需≥3条）` });
  }

  return gaps;
}

module.exports = { identifyGaps, confirmedFactCount, getConfirmedConsensus, CLIENT_PROFILE_FIELDS };
```

### 7.2 ContextBuilder 模块

**文件**: `src/core/contextBuilder.js`（新建）

```javascript
const FIELD_SOURCE_PRIORITY = [
  'hypothesis_confirmed',
  'candidate_selected',
  'hypothesis_partial',
  'manual',
  'unplanned_info',
  'ai_suggested',
  'previous_meeting'
];

class ContextBuilder {
  constructor(consensusChain, clientProfile, hypotheses) {
    this.consensusChain = consensusChain;
    this.clientProfile = clientProfile;
    this.hypotheses = hypotheses;
  }

  build(caller) {
    const context = {
      fields: this._buildFields(),
      stage: this.consensusChain.currentStage,
      hypotheses: this._buildHypotheses(),
      recentFacts: this._getRecentFacts(3),
      knowledgeRules: ONTOLOGY_REFERENCE_RULES
    };
    return this._filterByCaller(context, caller);
  }

  _buildFields() {
    const result = {};
    for (const field of CLIENT_PROFILE_FIELDS) {
      const candidates = this.consensusChain.records.filter(r =>
        r.target_field === field &&
        !FIELD_SOURCE_EXCLUDE.has(r.source) &&
        ['confirmed', 'recorded', 'pending_client_confirm'].includes(r.status)
      );

      if (candidates.length === 0) {
        const background = this.clientProfile[field];
        if (background) {
          result[field] = { value: background, source: 'background_info', weight: 'low' };
        }
        continue;
      }

      const best = candidates.reduce((a, b) => {
        const aIdx = FIELD_SOURCE_PRIORITY.indexOf(a.source);
        const bIdx = FIELD_SOURCE_PRIORITY.indexOf(b.source);
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

  _buildHypotheses() {
    return {
      unverified: this.hypotheses.filter(h => h.status === 'unverified'),
      confirmed: this.hypotheses.filter(h => h.status === 'confirmed'),
      rejected: this.hypotheses.filter(h => h.status === 'rejected'),
      partial: this.hypotheses.filter(h => h.status === 'partial')
    };
  }

  _filterByCaller(context, caller) {
    // 根据 caller 过滤字段权重
    if (caller === 'candidate' || caller === 'memo') {
      context.fields = Object.fromEntries(
        Object.entries(context.fields).filter(([_, v]) => v.weight === 'high')
      );
    }
    return context;
  }
}

module.exports = { ContextBuilder, FIELD_SOURCE_PRIORITY };
```

---

## 八、Stage 7: 备忘录与作战卡（重构4.md P0-4 + Phase 0）

**预计工时**: 12h | **风险**: 中

### 8.1 rationale 字段生成

**文件**: `src/core/candidateGenerator.js`

```javascript
async function generateRationale(candidate, confirmedFacts) {
  const prompt = `
基于以下已确认事实，为候选方案"${candidate.title}"生成 2-3 句说明：
- 为什么这个方向适合当前客户
- 必须引用已确认事实作为依据
- 不超过 100 字

已确认事实：
${confirmedFacts.map(f => `- ${f.content}`).join('\n')}

候选方案描述：${candidate.description}
`;

  const response = await llmClient.chat(prompt);
  return response.trim().slice(0, 100);
}
```

### 8.2 会前作战卡生成

**文件**: `src/core/battleCardGenerator.js`

```javascript
async function generateHypotheses(clientProfile) {
  const prompt = `
基于以下客户档案，生成 3-5 个诊断假设：

客户档案：
${JSON.stringify(clientProfile, null, 2)}

要求：
1. 每个假设包含：hypothesis_id, content, origin_stage, trigger_keywords, verification_question, target_field
2. origin_stage 必须是 "战略梳理" | "商业模式" | "行业演示" 之一
3. trigger_keywords 3-5 个，必须包含至少 1 个已在档案中出现过的词汇
4. 输出 JSON 数组格式
`;

  const response = await llmClient.chat(prompt);
  return JSON.parse(response);
}
```

---

## 九、Stage 8: P1/P2 工作包

**预计工时**: 16h | **风险**: 低

### 8.1 计划外信息触发（P1-1）

### 8.2 引用解析规则（P1-2）

### 8.3 作战卡质量门控（P1-3）

### 8.4 跨次会议快照（P2-1）

---

## 十、进度追踪

每次开发完成后，更新此表格：

| Stage | 状态 | 完成日期 | 备注 |
|-------|------|----------|------|
| Stage 0 | ✅ 完成 | 2026-05-05 | 4 批次重构 |
| Stage 1 | ✅ 完成 | 2026-05-05 | 纯样式改动 |
| Stage 2 | ❌ 未开始 | - | |
| Stage 3 | ❌ 未开始 | - | |
| Stage 4 | ❌ 未开始 | - | |
| Stage 5 | ❌ 未开始 | - | |
| Stage 6 | ❌ 未开始 | - | |
| Stage 7 | ❌ 未开始 | - | |
| Stage 8 | ❌ 未开始 | - | |

---

## 十一、验收标准

每个 Stage 完成后必须通过以下验收：

1. **Stage 1**: 截图对比，视觉符合预期，功能行为不变
2. **Stage 2**: 所有交互行为符合定义，后端数据写入逻辑不变
3. **Stage 3**: 完整链路跑通（记录 → 候选 → 共识 → 备忘录），飞书同步正常
4. **Stage 4-8**: 单元测试通过，集成测试通过

---

*此文档作为开发进度追踪的唯一来源，每次开发前先读取此文档确认当前进度。*
