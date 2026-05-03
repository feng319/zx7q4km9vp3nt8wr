// 测试 WebSocket 长连接 - 使用 EventDispatcher
require('dotenv').config();
const lark = require('@larksuiteoapi/node-sdk');

console.log('=== WebSocket 长连接测试 ===\n');

// 创建 EventDispatcher
const dispatcher = new lark.EventDispatcher('', ''); // 两个参数必须为空字符串

console.log('EventDispatcher 创建成功');

// 注册事件处理器
dispatcher.register({
  'drive.file.bitable_record_changed_v1': (data) => {
    console.log('\n✓ 收到变更事件:', JSON.stringify(data).slice(0, 300));
    return Promise.resolve();
  }
});

console.log('事件处理器已注册');

// 创建 WSClient
const wsClient = new lark.WSClient({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Lark,
  logLevel: lark.LoggerLevel.DEBUG, // 开启调试日志
  eventDispatcher: dispatcher,
});

console.log('WSClient 创建成功');

// 启动连接
console.log('\n启动 WebSocket 连接...');
wsClient.start();

console.log('已调用 start()');

// 等待并检查状态
setTimeout(() => {
  console.log('\n5秒后检查状态...');
  console.log('wsClient 状态:', Object.keys(wsClient));
}, 5000);

// 保持运行
console.log('\n等待事件 (20秒)...');
setTimeout(() => {
  console.log('\n测试结束');
  process.exit(0);
}, 20000);
