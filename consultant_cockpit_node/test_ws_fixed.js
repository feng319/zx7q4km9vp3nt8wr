// 测试修复后的 WebSocket 长连接
require('dotenv').config();
const lark = require('@larksuiteoapi/node-sdk');

console.log('=== WebSocket 长连接测试 (修复版) ===\n');

async function testWebSocket() {
  try {
    // 1. 创建 lark 客户端（用于 API 调用）
    const larkClient = new lark.Client({
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Lark,
    });

    console.log('1. lark.Client 创建成功');

    // 2. 订阅多维表格
    console.log('\n2. 订阅多维表格...');
    const subResp = await larkClient.drive.file.subscribe({
      path: { file_token: process.env.FEISHU_BITABLE_APP_TOKEN },
      params: { file_type: 'bitable' },
    });
    console.log('   订阅结果:', subResp.code === 0 ? '成功' : `失败 ${subResp.code} ${subResp.msg}`);

    // 3. 创建 EventDispatcher
    console.log('\n3. 创建 EventDispatcher...');
    const dispatcher = new lark.EventDispatcher('', '');
    console.log('   EventDispatcher 创建成功');

    // 4. 注册事件处理器
    console.log('\n4. 注册事件处理器...');
    let eventReceived = false;
    dispatcher.register({
      'drive.file.bitable_record_changed_v1': (data) => {
        console.log('\n✓ 收到变更事件:', JSON.stringify(data).slice(0, 500));
        eventReceived = true;
        return Promise.resolve();
      }
    });
    console.log('   事件处理器已注册');

    // 5. 创建 WSClient
    console.log('\n5. 创建 WSClient...');
    const wsClient = new lark.WSClient({
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Lark,
      eventDispatcher: dispatcher,
    });
    console.log('   WSClient 创建成功');

    // 6. 启动 WebSocket 连接
    console.log('\n6. 启动 WebSocket 连接...');
    wsClient.start({ eventDispatcher: dispatcher });
    console.log('   已调用 start()');

    // 7. 等待连接建立
    console.log('\n7. 等待连接建立 (5秒)...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n=== 测试结果 ===');
    console.log('WebSocket 连接已启动');
    console.log('请在飞书多维表格中修改一条记录，观察是否收到事件');

    // 等待事件
    console.log('\n等待事件 (15秒)...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    if (eventReceived) {
      console.log('\n✓ 测试成功：收到了变更事件');
    } else {
      console.log('\n⚠ 未收到变更事件（可能需要手动在多维表格中修改记录）');
    }

    console.log('\n测试结束');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ 测试失败:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testWebSocket();
