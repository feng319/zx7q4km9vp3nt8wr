/**
 * 飞书 WebSocket 事件订阅测试
 * 测试通过 @larksuiteoapi/node-sdk 接收 bitable_record_changed 事件
 *
 * 注意：需要在开发者后台配置事件订阅，添加 drive.file.bitable_record_changed_v1 事件
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import dotenv from 'dotenv';

dotenv.config();

// 从环境变量获取配置
const APP_ID = process.env.FEISHU_APP_ID || 'cli_a97ff9da2f389cb3';
const APP_SECRET = process.env.FEISHU_APP_SECRET;

if (!APP_SECRET) {
  console.error('❌ 请设置 FEISHU_APP_SECRET 环境变量');
  console.log('提示：可以从 lark-cli 配置或开发者后台获取');
  process.exit(1);
}

const BITABLE_APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN || 'C1qybEyn9am06FspDb2czASQnif';

console.log('='.repeat(60));
console.log('飞书 WebSocket 事件订阅测试');
console.log('='.repeat(60));
console.log(`App ID: ${APP_ID}`);
console.log(`Bitable Token: ${BITABLE_APP_TOKEN}`);
console.log('='.repeat(60));

// 创建 WebSocket 客户端
const wsClient = new Lark.WSClient({
  appId: APP_ID,
  appSecret: APP_SECRET,
  loggerLevel: Lark.LoggerLevel.info,
});

// 事件计数器
let eventCount = 0;

// 启动 WebSocket 连接
console.log('\n🔌 正在连接 WebSocket...');
wsClient.start({
  eventDispatcher: new Lark.EventDispatcher({})
    // 处理多维表格记录变更事件
    .register({
      'drive.file.bitable_record_changed_v1': async (data) => {
        eventCount++;
        console.log(`\n[${new Date().toISOString()}] 📝 收到 bitable_record_changed 事件 #${eventCount}`);
        console.log('事件数据:', JSON.stringify(data, null, 2));

        // 返回成功响应
        return {};
      }
    })
    // 处理其他云文档事件
    .register({
      'drive.file.edit_v1': async (data) => {
        eventCount++;
        console.log(`\n[${new Date().toISOString()}] ✏️ 收到 file.edit 事件 #${eventCount}`);
        console.log('事件数据:', JSON.stringify(data, null, 2));
        return {};
      }
    })
});

// 监听连接状态
console.log('✅ WebSocket 客户端已启动');
console.log('\n📋 等待事件中...');
console.log('提示：请在飞书多维表格中修改记录以触发事件');
console.log('按 Ctrl+C 退出\n');

// 定时输出状态
const statusInterval = setInterval(() => {
  console.log(`[${new Date().toISOString()}] ⏳ 等待中... 已收到 ${eventCount} 个事件`);
}, 30000);

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n正在关闭...');
  clearInterval(statusInterval);
  wsClient.stop();
  console.log(`总计收到 ${eventCount} 个事件`);
  process.exit(0);
});
