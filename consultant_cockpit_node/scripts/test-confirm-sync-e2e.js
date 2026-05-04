#!/usr/bin/env node
// 端到端测试：验证确认同步到客户档案表功能

const http = require('http');
require('dotenv').config();

const BASE_URL = `http://localhost:${process.env.PORT || 18501}`;

function apiRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'Invalid JSON', raw: data });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function testConfirmSync() {
  console.log('=== 端到端测试：确认同步到客户档案表 ===\n');

  // 1. 创建新会话
  console.log('1. 创建新会话...');
  const session = await apiRequest('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ company: '测试储能科技有限公司' })
  });
  console.log('   会话ID:', session.session_id);
  console.log('   公司名:', session.company);

  const sessionId = session.session_id;

  // 2. 添加一条共识记录
  console.log('\n2. 添加共识记录...');
  const record = await apiRequest(`/api/sessions/${sessionId}/records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'consensus',
      stage: '诊断阶段',
      content: '测试共识内容 - ' + new Date().toISOString()
    })
  });
  console.log('   记录ID:', record.record_id);

  // 3. 确认记录（应该同步到客户档案表）
  console.log('\n3. 确认记录并同步到客户档案表...');
  const confirmResult = await apiRequest(`/api/sessions/${sessionId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({
      record_id: record.record_id,
      company: '测试储能科技有限公司'
    })
  });
  console.log('   确认结果:', confirmResult.message || confirmResult.error);

  // 4. 验证客户档案是否更新
  console.log('\n4. 验证客户档案表...');
  const { FeishuClient } = require('../src/integrations/feishuClient');
  const feishuClient = new FeishuClient();

  const profile = await feishuClient.getClientProfile('测试储能科技有限公司');
  if (profile) {
    console.log('   ✅ 找到客户档案');
    console.log('   record_id:', profile.record_id);
    console.log('   客户公司名:', profile['客户公司名']);
  } else {
    console.log('   ❌ 未找到客户档案');
  }

  console.log('\n=== 测试完成 ===');
}

testConfirmSync().catch(console.error);
