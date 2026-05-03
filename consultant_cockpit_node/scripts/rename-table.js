#!/usr/bin/env node
// 将「客户诊断数据」表改名为「客户档案」

const lark = require('@larksuiteoapi/node-sdk');
require('dotenv').config();

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

const bitableToken = process.env.FEISHU_BITABLE_APP_TOKEN;
const tableId = process.env.FEISHU_BITABLE_TABLE_ID;

async function renameTable() {
  console.log('=== 修改表名 ===\n');
  console.log(`bitableToken: ${bitableToken}`);
  console.log(`tableId: ${tableId}`);
  console.log(`新表名: 客户档案\n`);

  try {
    const response = await client.bitable.appTable.patch({
      path: {
        app_token: bitableToken,
        table_id: tableId,
      },
      data: {
        name: '客户档案',
      },
    });

    if (response.code !== 0) {
      console.error('修改表名失败:', response.msg);
      return;
    }

    console.log('✅ 成功将表名修改为「客户档案」');
  } catch (err) {
    console.error('错误:', err.message);
  }
}

renameTable().catch(console.error);
