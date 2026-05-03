// 测试脚本：触发飞书记录创建，获取详细错误
const http = require('http');

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  // 创建会话
  let r = await makeRequest({
    hostname: 'localhost', port: 8501, path: '/api/sessions', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const sessionId = r.body.session_id;
  console.log('Session:', sessionId);

  // 创建记录（通过 API）
  const body = JSON.stringify({ type: '案例', content: '测试飞书写入' });
  r = await makeRequest({
    hostname: 'localhost', port: 8501,
    path: `/api/sessions/${sessionId}/records`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  console.log('Record result:', JSON.stringify(r.body, null, 2));
}

main().catch(console.error);
