#!/usr/bin/env node
// 测试确认记录同步到客户档案表

const http = require('http');

function makeRequest(path, method, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 8501,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body || '{}')
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });
    req.on('error', reject);
    req.write(body || '{}');
    req.end();
  });
}

async function test() {
  console.log('=== 测试确认记录同步到客户档案表 ===\n');

  // 1. 创建会话
  console.log('1. 创建会话...');
  const session = await makeRequest('/api/sessions', 'POST', JSON.stringify({ company: '测试公司XYZ' }));
  console.log('   会话ID:', session.session_id);
  console.log('   公司名:', session.company);

  // 2. 添加记录
  console.log('\n2. 添加记录...');
  const record = await makeRequest(`/api/sessions/${session.session_id}/records`, 'POST', JSON.stringify({
    type: 'fact',
    stage: '战略梳理',
    content: '产品线：新能源电池pack系统，储能系统集成',
    source: 'manual'
  }));
  console.log('   记录ID:', record.record?.id);
  console.log('   状态:', record.record?.status);

  // 3. 确认记录
  console.log('\n3. 确认记录...');
  const confirm = await makeRequest(`/api/sessions/${session.session_id}/confirm`, 'POST', JSON.stringify({
    company: '测试公司XYZ'
  }));
  console.log('   确认结果:', confirm);

  // 4. 检查会话状态
  console.log('\n4. 检查会话状态...');
  const state = await makeRequest(`/api/sessions/${session.session_id}`, 'GET');
  console.log('   记录数:', state.record_count);
  console.log('   已确认事实:', state.confirmed_facts);
  console.log('   完整度:', state.completeness + '%');

  console.log('\n=== 测试完成 ===');
}

test().catch(console.error);
