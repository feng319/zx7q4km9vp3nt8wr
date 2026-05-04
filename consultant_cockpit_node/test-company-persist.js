// test-company-persist.js - 测试公司名持久化
const http = require('http');

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8501,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('=== 测试公司名持久化 ===\n');

  // 1. 创建会话并设置公司名
  console.log('1. 创建会话并设置公司名...');
  const createRes = await request('POST', '/api/sessions', { company: 'TestCompany_Persist' });
  console.log('   响应:', createRes);
  const sessionId = createRes.session_id;

  // 2. 添加记录
  console.log('\n2. 添加记录...');
  const addRes = await request('POST', `/api/sessions/${sessionId}/records`, {
    content: '测试记录内容',
    type: 'fact'
  });
  console.log('   响应:', addRes);
  const recordId = addRes.record?.id;

  // 3. 确认记录
  console.log('\n3. 确认记录...');
  const confirmRes = await request('POST', `/api/sessions/${sessionId}/records/${recordId}/confirm`);
  console.log('   响应:', confirmRes);

  // 4. 检查会话文件
  console.log('\n4. 检查会话文件...');
  const fs = require('fs');
  const path = require('path');
  const sessionFile = path.join(__dirname, 'data', 'sessions', `${sessionId}.json`);

  if (fs.existsSync(sessionFile)) {
    const content = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    console.log('   会话文件存在:', sessionFile);
    console.log('   metadata:', content.metadata);
    console.log('   company 在 metadata 中:', content.metadata?.company);

    if (content.metadata?.company === 'TestCompany_Persist') {
      console.log('\n✅ 测试通过：公司名已正确保存到 metadata');
    } else {
      console.log('\n❌ 测试失败：公司名未保存到 metadata');
    }
  } else {
    console.log('   会话文件不存在:', sessionFile);
    console.log('\n❌ 测试失败：会话文件未创建');
  }

  // 5. 模拟页面刷新 - 获取会话状态
  console.log('\n5. 模拟页面刷新 - 获取会话状态...');
  const statusRes = await request('GET', `/api/sessions/${sessionId}`);
  console.log('   会话状态中的 company:', statusRes.company);

  if (statusRes.company === 'TestCompany_Persist') {
    console.log('\n✅ 测试通过：页面刷新后公司名正确恢复');
  } else {
    console.log('\n❌ 测试失败：页面刷新后公司名丢失');
  }
}

test().catch(console.error);
