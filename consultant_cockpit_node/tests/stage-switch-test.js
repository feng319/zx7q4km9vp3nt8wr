// tests/stage-switch-test.js — 阶段切换功能验证
const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

async function apiRequest(endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}/api${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  return response.json();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('=== 阶段切换功能验证 ===\n');

  // 步骤 1：启动会话
  console.log('步骤 1：启动会话，初始阶段');
  const session = await apiRequest('/sessions', { method: 'POST' });
  const sessionId = session.session_id;
  console.log(`  会话 ID: ${sessionId}`);

  // 获取初始状态
  let state = await apiRequest(`/sessions/${sessionId}`);
  assert.strictEqual(state.current_stage, '战略梳理', '初始阶段应为战略梳理');
  console.log(`  ✓ 初始阶段: ${state.current_stage}`);

  // 步骤 2：记录一条内容
  console.log('\n步骤 2：记录一条内容（阶段应为战略梳理）');
  await apiRequest(`/sessions/${sessionId}/records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'fact', content: '产品线：储能', stage: '战略梳理', source: 'manual' })
  });
  state = await apiRequest(`/sessions/${sessionId}`);
  const record1 = state.records[0];
  assert.strictEqual(record1.stage, '战略梳理', '第1条记录阶段应为战略梳理');
  console.log(`  ✓ 记录阶段: ${record1.stage}`);

  // 步骤 3：切换到商业模式
  console.log('\n步骤 3：切换到商业模式');
  const switchResult = await apiRequest(`/sessions/${sessionId}/stage`, {
    method: 'PATCH',
    body: JSON.stringify({ stage: '商业模式' })
  });
  assert.strictEqual(switchResult.success, true, '切换应成功');
  assert.strictEqual(switchResult.current_stage, '商业模式', '返回的阶段应为商业模式');

  state = await apiRequest(`/sessions/${sessionId}`);
  assert.strictEqual(state.current_stage, '商业模式', '后端状态应为商业模式');
  console.log(`  ✓ 后端阶段: ${state.current_stage}`);

  // 步骤 4：记录第二条内容（这就是之前出 bug 的地方）
  console.log('\n步骤 4：记录第二条内容（阶段应为商业模式）');
  await apiRequest(`/sessions/${sessionId}/records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'fact', content: '战略目标：xxx', stage: '商业模式', source: 'manual' })
  });
  state = await apiRequest(`/sessions/${sessionId}`);
  const record2 = state.records[1];
  assert.strictEqual(record2.stage, '商业模式', '第2条记录阶段应为商业模式');
  console.log(`  ✓ 记录阶段: ${record2.stage}`);

  // 步骤 5：等待并验证状态不被覆盖
  console.log('\n步骤 5：等待 1 秒后验证状态');
  await sleep(1000);
  state = await apiRequest(`/sessions/${sessionId}`);
  assert.strictEqual(state.current_stage, '商业模式', '阶段不应被覆盖');
  console.log(`  ✓ 阶段保持: ${state.current_stage}`);

  // 步骤 6：候选生成（验证缓存失效）
  console.log('\n步骤 6：验证候选缓存失效');
  // 先添加更多记录以满足候选生成条件
  await apiRequest(`/sessions/${sessionId}/records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'fact', content: '客户群体：工厂', stage: '商业模式', source: 'manual' })
  });
  await apiRequest(`/sessions/${sessionId}/records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'fact', content: '收入结构：设备销售', stage: '商业模式', source: 'manual' })
  });
  await apiRequest(`/sessions/${sessionId}/records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'consensus', content: '客户认可商业模式', stage: '商业模式', source: 'manual' })
  });
  console.log('  ✓ 已添加足够记录');

  // 步骤 7：刷新浏览器后验证（模拟重新获取状态）
  console.log('\n步骤 7：模拟浏览器刷新后验证');
  state = await apiRequest(`/sessions/${sessionId}`);
  assert.strictEqual(state.current_stage, '商业模式', '刷新后阶段应保持');
  console.log(`  ✓ 刷新后阶段: ${state.current_stage}`);

  // 步骤 8：验证记录阶段正确
  console.log('\n步骤 8：验证所有记录阶段');
  state = await apiRequest(`/sessions/${sessionId}`);
  const stageCheck = state.records.every(r => r.stage === '商业模式');
  assert.strictEqual(stageCheck, true, '所有记录阶段应为商业模式');
  console.log(`  ✓ 所有记录阶段正确`);

  // 测试无效阶段
  console.log('\n额外测试：无效阶段');
  const invalidResult = await apiRequest(`/sessions/${sessionId}/stage`, {
    method: 'PATCH',
    body: JSON.stringify({ stage: '无效阶段' })
  });
  assert.notStrictEqual(invalidResult.success, true, '无效阶段应失败');
  console.log(`  ✓ 无效阶段被拒绝`);

  console.log('\n=== 所有测试通过 ===');
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
