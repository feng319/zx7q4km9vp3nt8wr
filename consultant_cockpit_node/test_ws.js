// 测试 WebSocket 长连接
require('dotenv').config();
const lark = require('@larksuiteoapi/node-sdk');

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Lark,
});

async function testWebSocket() {
  console.log('=== WebSocket 长连接测试 ===\n');

  // 1. 先订阅
  console.log('1. 订阅多维表格...');
  try {
    const subResp = await client.drive.file.subscribe({
      path: { file_token: process.env.FEISHU_BITABLE_APP_TOKEN },
      params: { file_type: 'bitable' },
    });
    console.log('   订阅结果:', subResp.code === 0 ? '成功' : `失败 ${subResp.code} ${subResp.msg}`);
  } catch (err) {
    console.log('   订阅失败:', err.message);
    return;
  }

  // 2. 启动 WebSocket
  console.log('\n2. 启动 WebSocket 客户端...');
  try {
    client.wsClient.start();
    console.log('   已调用 start()');
  } catch (err) {
    console.log('   启动失败:', err.message);
    return;
  }

  // 3. 监听事件
  console.log('\n3. 注册事件监听...');

  client.wsClient.on('connect', () => {
    console.log('   ✓ WebSocket 已连接');
  });

  client.wsClient.on('disconnect', (err) => {
    console.log('   ✗ WebSocket 断开:', err);
  });

  client.wsClient.on('error', (err) => {
    console.log('   ✗ WebSocket 错误:', err);
  });

  client.wsClient.on('drive.file.bitable_record_changed_v1', (event) => {
    console.log('   ✓ 收到变更事件:', JSON.stringify(event).slice(0, 200));
  });

  // 4. 等待连接
  console.log('\n4. 等待连接建立 (15秒超时)...');
  const startTime = Date.now();
  const timeout = 15000;

  await new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      if (client.wsClient.isConnected?.()) {
        console.log(`   ✓ 连接成功! 耗时 ${elapsed}ms`);
        clearInterval(checkInterval);
        resolve(true);
      } else if (elapsed >= timeout) {
        console.log(`   ✗ 连接超时 (${timeout}ms)`);
        clearInterval(checkInterval);
        resolve(false);
      } else {
        process.stdout.write(`\r   等待中... ${Math.floor(elapsed / 1000)}s`);
      }
    }, 500);
  });

  // 5. 检查状态
  console.log('\n\n5. 最终状态:');
  console.log('   isConnected:', client.wsClient.isConnected?.());

  // 保持运行 5 秒观察事件
  console.log('\n6. 等待 5 秒观察事件...');
  await new Promise(r => setTimeout(r, 5000));

  console.log('\n测试结束');
  process.exit(0);
}

testWebSocket().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
