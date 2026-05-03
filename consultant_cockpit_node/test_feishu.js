// 测试飞书 API 连接
require('dotenv').config();
const lark = require('@larksuiteoapi/node-sdk');

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Lark,
});

async function test() {
  console.log('=== 飞书 API 连接测试 ===');
  console.log('APP_ID:', process.env.FEISHU_APP_ID);
  console.log('BITABLE_APP_TOKEN:', process.env.FEISHU_BITABLE_APP_TOKEN);
  console.log('CONSENSUS_TABLE_ID:', process.env.FEISHU_BITABLE_CONSENSUS_TABLE_ID);
  console.log();

  // 测试1: 列出记录
  console.log('--- 测试 list ---');
  try {
    const response = await client.bitable.appTableRecord.list({
      path: {
        app_token: process.env.FEISHU_BITABLE_APP_TOKEN,
        table_id: process.env.FEISHU_BITABLE_CONSENSUS_TABLE_ID,
      },
      params: {
        user_id_type: 'open_id',
        page_size: 10,
      },
    });
    console.log('成功! code:', response.code, 'msg:', response.msg);
    console.log('记录数:', response.data?.items?.length || 0);
    if (response.data?.items?.[0]) {
      console.log('第一条记录:', JSON.stringify(response.data.items[0], null, 2).slice(0, 500));
    }
  } catch (err) {
    console.log('失败:', err.message);
  }

  console.log();

  // 测试2: 订阅多维表格
  console.log('--- 测试订阅 bitable ---');
  try {
    const response = await client.drive.file.subscribe({
      path: {
        file_token: process.env.FEISHU_BITABLE_APP_TOKEN,
      },
      params: {
        file_type: 'bitable',
      },
    });
    console.log('订阅成功! code:', response.code, 'msg:', response.msg);
  } catch (err) {
    console.log('订阅失败:', err.message);
  }
}

test().catch(console.error);
