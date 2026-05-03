#!/usr/bin/env node
// 列出诊断共识表的字段结构

const lark = require('@larksuiteoapi/node-sdk');
require('dotenv').config();

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

const bitableToken = process.env.FEISHU_BITABLE_APP_TOKEN;
const consensusTableId = process.env.FEISHU_BITABLE_CONSENSUS_TABLE_ID;

async function listFields() {
  console.log('=== 诊断共识表字段结构 ===\n');

  try {
    const response = await client.bitable.appTableField.list({
      path: {
        app_token: bitableToken,
        table_id: consensusTableId,
      },
    });

    console.log('API 响应状态:', response.code);
    if (response.code !== 0) {
      console.log('错误:', response.msg);
      return;
    }

    const fields = response.data?.items || [];
    console.log(`共 ${fields.length} 个字段:\n`);

    for (const field of fields) {
      console.log(`字段名: ${field.field_name}`);
      console.log(`  field_id: ${field.field_id}`);
      console.log(`  类型: ${field.type}`);
      console.log('');
    }
  } catch (error) {
    console.error('失败:', error.message);
  }
}

listFields().catch(console.error);
