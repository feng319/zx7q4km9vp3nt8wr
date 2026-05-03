// 测试正确的 WebSocket 用法
require('dotenv').config();
const lark = require('@larksuiteoapi/node-sdk');

console.log('=== WebSocket 长连接测试 (正确用法) ===\n');

// 创建 WSClient
const wsClient = new lark.WSClient({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Lark,
});

console.log('WSClient 创建成功');
console.log('WSClient 方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(wsClient)));

// 注册事件处理器
wsClient.on('connect', () => {
  console.log('\n✓ WebSocket 已连接!');
});

wsClient.on('disconnect', () => {
  console.log('\n✗ WebSocket 断开');
});

wsClient.on('error', (err) => {
  console.log('\n✗ WebSocket 错误:', err);
});

wsClient.on('drive.file.bitable_record_changed_v1', (event) => {
  console.log('\n✓ 收到变更事件:', JSON.stringify(event).slice(0, 300));
});

// 启动连接
console.log('\n启动 WebSocket 连接...');
wsClient.start();

// 等待连接
setTimeout(() => {
  console.log('\n检查连接状态...');
  console.log('isConnected:', wsClient.isConnected?.());
}, 5000);

// 保持运行
console.log('\n等待事件 (15秒)...');
setTimeout(() => {
  console.log('\n测试结束');
  process.exit(0);
}, 15000);
