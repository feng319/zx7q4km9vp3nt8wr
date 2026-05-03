const http = require('http');

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runTests() {
  console.log('=== 顾问现场作战系统验收测试 ===\n');

  // Test 1: 创建会话
  console.log('1. 测试创建会话（带 Content-Type: application/json）');
  let result = await makeRequest({
    hostname: 'localhost',
    port: 8501,
    path: '/api/sessions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  console.log('   状态:', result.status);
  console.log('   响应:', JSON.stringify(result.body));

  if (!result.body.session_id) {
    console.log('   ❌ 失败：未返回 session_id\n');
    return;
  }
  console.log('   ✅ 通过\n');
  const sessionId = result.body.session_id;

  // Test 2: 召回备弹
  console.log('2. 测试召回备弹');
  const recallBody = JSON.stringify({ keywords: ['储能', '商业模式'], top_k: 5 });
  result = await makeRequest({
    hostname: 'localhost',
    port: 8501,
    path: `/api/sessions/${sessionId}/recall`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(recallBody)
    }
  }, recallBody);
  console.log('   状态:', result.status);
  console.log('   响应:', JSON.stringify(result.body));

  if (result.body.success && result.body.skus && result.body.skus.length > 0) {
    console.log('   ✅ 通过 - 召回', result.body.skus.length, '条 SKU\n');
  } else {
    console.log('   ⚠️ 部分通过 - SKU 数量为 0\n');
  }

  // Test 3: 创建记录
  console.log('3. 测试创建记录');
  const recordBody = JSON.stringify({ type: '案例', content: '测试案例内容' });
  result = await makeRequest({
    hostname: 'localhost',
    port: 8501,
    path: `/api/sessions/${sessionId}/records`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(recordBody)
    }
  }, recordBody);
  console.log('   状态:', result.status);
  console.log('   响应:', JSON.stringify(result.body));

  if (result.body.success && result.body.record) {
    console.log('   ✅ 通过 - 记录 ID:', result.body.record.id, '\n');
  } else {
    console.log('   ❌ 失败\n');
  }

  console.log('=== 测试完成 ===');
}

runTests().catch(console.error);
