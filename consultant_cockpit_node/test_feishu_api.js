// 快速测试飞书 API 连接
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

  // 测试1: 列出记录 (list)
  console.log('--- 测试 list (非迭代器) ---');
  try {
    const resp = await client.bitable.appTableRecord.list({
      path: {
        app_token: process.env.FEISHU_BITABLE_APP_TOKEN,
        table_id: process.env.FEISHU_BITABLE_CONSENSUS_TABLE_ID,
      },
      params: {
        user_id_type: 'open_id',
        page_size: 10,
      },
    });
    console.log('list 成功! code:', resp.code, 'msg:', resp.msg);
    console.log('记录数:', resp.data?.items?.length || 0);
    if (resp.data?.items?.[0]) {
      console.log('第一条记录 fields:', JSON.stringify(resp.data.items[0].fields).slice(0, 200));
    }
  } catch (err) {
    console.log('list 失败:', err.message);
    console.log('错误堆栈:', err.stack?.slice(0, 500));
  }

  console.log();

  // 测试2: 列出记录 (listWithIterator)
  console.log('--- 测试 listWithIterator (迭代器) ---');
  try {
    const iterator = client.bitable.appTableRecord.listWithIterator({
      path: {
        app_token: process.env.FEISHU_BITABLE_APP_TOKEN,
        table_id: process.env.FEISHU_BITABLE_CONSENSUS_TABLE_ID,
      },
      params: {
        user_id_type: 'open_id',
        page_size: 10,
      },
    });

    let count = 0;
    for await (const record of iterator) {
      count++;
      if (count === 1) {
        console.log('迭代器第一条记录:', JSON.stringify(record).slice(0, 200));
      }
    }
    console.log('listWithIterator 成功! 记录数:', count);
  } catch (err) {
    console.log('listWithIterator 失败:', err.message);
    console.log('错误堆栈:', err.stack?.slice(0, 500));
  }

  console.log();

  // 测试3: 订阅多维表格
  console.log('--- 测试订阅 bitable ---');
  try {
    const resp = await client.drive.file.subscribe({
      path: {
        file_token: process.env.FEISHU_BITABLE_APP_TOKEN,
      },
      params: {
        file_type: 'bitable',
      },
    });
    console.log('订阅成功! code:', resp.code, 'msg:', resp.msg);
  } catch (err) {
    console.log('订阅失败:', err.message);
  }
}

test().catch(console.error);
