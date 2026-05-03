// 检查 SDK 支持的方法和属性
require('dotenv').config();
const lark = require('@larksuiteoapi/node-sdk');

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Lark,
});

console.log('=== SDK 客户端属性检查 ===\n');
console.log('client 类型:', typeof client);
console.log('client 键:', Object.keys(client));

console.log('\n--- 检查 wsClient ---');
console.log('wsClient:', client.wsClient);
console.log('wsClient 类型:', typeof client.wsClient);

console.log('\n--- 检查其他可能的 WebSocket 相关属性 ---');
const wsRelated = Object.keys(client).filter(k =>
  k.toLowerCase().includes('ws') ||
  k.toLowerCase().includes('websocket') ||
  k.toLowerCase().includes('event')
);
console.log('WebSocket 相关键:', wsRelated);

console.log('\n--- 检查 lark 模块导出 ---');
console.log('lark 键:', Object.keys(lark));

// 检查是否有专门的 WSClient 类
if (lark.WSClient) {
  console.log('\n发现 lark.WSClient');
}

if (lark.WebSocketClient) {
  console.log('\n发现 lark.WebSocketClient');
}

// 检查 Client 原型方法
console.log('\n--- Client 原型方法 ---');
const protoMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
console.log('方法列表:', protoMethods.filter(m => typeof client[m] === 'function'));
