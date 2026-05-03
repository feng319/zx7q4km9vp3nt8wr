const http = require('http');

function req(options, body = null) {
  return new Promise((resolve, reject) => {
    const r = http.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ s: res.statusCode, b: JSON.parse(d) }); }
        catch (e) { resolve({ s: res.statusCode, b: d }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function main() {
  console.log('=== PRD 验收测试 ===\n');

  // 创建会话
  let r = await req({ hostname:'localhost', port:8501, path:'/api/sessions', method:'POST', headers:{'Content-Type':'application/json'} });
  const sid = r.b.session_id;
  console.log('1. 创建会话:', sid ? '✅' : '❌');

  // 添加记录（/记）- 应该不同步飞书
  const body = JSON.stringify({ type:'fact', content:'毛利结构：储能系统集成毛利约18%', stage:'战略梳理', source:'manual' });
  r = await req({ hostname:'localhost', port:8501, path:`/api/sessions/${sid}/records`, method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} }, body);
  const recordId = r.b.record?.id;
  console.log('2. /记 添加记录:', r.b.success ? '✅' : '❌', 'ID:', recordId);
  console.log('   status:', r.b.record?.status, '(应为 recorded)');

  // 检查 session 状态
  r = await req({ hostname:'localhost', port:8501, path:`/api/sessions/${sid}`, method:'GET' });
  console.log('3. Session 状态:');
  console.log('   records:', r.b.records?.length, '条');
  console.log('   completeness:', r.b.completeness + '%');
  console.log('   fields_status 毛利结构:', r.b.fields_status?.['毛利结构']);

  // 等待 2 秒，确认飞书没有同步（/记 后不同步）
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('\n4. 飞书同步检查（/记 后应不同步）：见服务器日志');

  // 确认记录（/确认）
  const confirmBody = JSON.stringify({});
  r = await req({ hostname:'localhost', port:8501, path:`/api/sessions/${sid}/records/${recordId}/confirm`, method:'POST', headers:{'Content-Type':'application/json','Content-Length':0} });
  console.log('\n5. /确认 记录:', r.b.success ? '✅' : '❌');

  // 等待飞书同步
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('6. 飞书同步检查（/确认 后应同步）：见服务器日志');

  console.log('\n=== 测试完成 ===');
}

main().catch(console.error);
