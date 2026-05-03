#!/usr/bin/env node
// 查询客户档案表中特定公司的记录

const lark = require('@larksuiteoapi/node-sdk');
require('dotenv').config();

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

const bitableToken = process.env.FEISHU_BITABLE_APP_TOKEN;
const profileTableId = process.env.FEISHU_BITABLE_PROFILE_TABLE_ID;

async function listRecords() {
  console.log('=== 客户档案表中的记录 ===\n');

  try {
    const response = await client.bitable.appTableRecord.list({
      path: {
        app_token: bitableToken,
        table_id: profileTableId,
      },
      params: {
        page_size: 100,
      },
    });

    const items = response.data?.items || [];
    console.log(`共 ${items.length} 条记录:\n`);

    for (const record of items) {
      const fields = record.fields || {};
      // 显示所有字段
      console.log(`--- 记录 ${record.record_id} ---`);
      for (const [key, value] of Object.entries(fields)) {
        console.log(`  ${key}: ${value}`);
      }
      console.log('');
    }
  } catch (error) {
    console.error('查询失败:', error.message);
  }
}

listRecords().catch(console.error);