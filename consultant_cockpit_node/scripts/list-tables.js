#!/usr/bin/env node
// 列出多维表格中的所有数据表

const lark = require('@larksuiteoapi/node-sdk');
require('dotenv').config();

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

const bitableToken = process.env.FEISHU_BITABLE_APP_TOKEN;

async function listTables() {
  console.log('=== 多维表格中的数据表 ===\n');
  console.log('bitableToken:', bitableToken);

  try {
    const response = await client.bitable.appTable.list({
      path: {
        app_token: bitableToken,
      },
    });

    console.log('API 响应状态:', response.code);
    console.log('API 响应消息:', response.msg);

    const items = response.data?.items || [];
    console.log(`共 ${items.length} 个数据表:\n`);

    for (const table of items) {
      console.log(`--- 数据表 ---`);
      console.log('table_id:', table.table_id);
      console.log('名称:', table.name);
      console.log('');
    }
  } catch (error) {
    console.error('查询失败:', error.message);
    if (error.code) {
      console.error('错误代码:', error.code);
    }
  }
}

listTables().catch(console.error);