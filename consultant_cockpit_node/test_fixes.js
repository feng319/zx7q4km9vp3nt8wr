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
  console.log('=== 验收测试 ===\n');

  // 1. 创建会话
  let r = await makeRequest({
    hostname: 'localhost', port: 8501, path: '/api/sessions', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const sid = r.body.session_id;
  console.log('1. 创建会话:', sid ? '✅' : '❌');

  // 2. 添加记录
  const body1 = JSON.stringify({ type: 'fact', content: '毛利结构：储能系统集成毛利约18%，EPC工程毛利约12%', stage: '战略梳理', source: 'manual' });
  r = await makeRequest({
    hostname: 'localhost', port: 8501, path: `/api/sessions/${sid}/records`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body1) }
  }, body1);
  console.log('2. 添加记录:', r.body.success ? '✅' : '❌', 'ID:', r.body.record?.id);

  // 3. 检查 session 状态是否返回 records/completeness/fields_status
  r = await makeRequest({
    hostname: 'localhost', port: 8501, path: `/api/sessions/${sid}`, method: 'GET'
  });
  const hasRecords = Array.isArray(r.body.records) && r.body.records.length > 0;
  const hasCompleteness = typeof r.body.completeness === 'number';
  const hasFieldsStatus = typeof r.body.fields_status === 'object';
  console.log('3. Session 状态 API:');
  console.log('   records:', hasRecords ? '✅' : '❌', `(${r.body.records?.length}条)`);
  console.log('   completeness:', hasCompleteness ? '✅' : '❌', `(${r.body.completeness}%)`);
  console.log('   fields_status:', hasFieldsStatus ? '✅' : '❌');

  // 4. 检查飞书同步（等待异步）
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('\n4. 检查飞书同步日志（见服务器输出）');
}

main().catch(console.error);
