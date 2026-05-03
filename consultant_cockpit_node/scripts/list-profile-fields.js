#!/usr/bin/env node
// 查询客户档案表的字段结构

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

async function listFields() {
  console.log('=== 客户档案表字段结构 ===\n');

  try {
    const response = await client.bitable.appTableField.list({
      path: {
        app_token: bitableToken,
        table_id: profileTableId,
      },
    });

    console.log('API 响应状态:', response.code);

    const items = response.data?.items || [];
    console.log(`共 ${items.length} 个字段:\n`);

    for (const field of items) {
      console.log(`字段名: ${field.field_name}`);
      console.log(`  field_id: ${field.field_id}`);
      console.log(`  类型: ${field.type}`);
      console.log('');
    }
  } catch (error) {
    console.error('查询失败:', error.message);
  }
}

listFields().catch(console.error);