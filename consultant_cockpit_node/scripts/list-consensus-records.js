#!/usr/bin/env node
// 查询诊断共识表中的记录内容

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

async function listRecords() {
  console.log('=== 诊断共识表中的记录 ===\n');

  try {
    const response = await client.bitable.appTableRecord.list({
      path: {
        app_token: bitableToken,
        table_id: consensusTableId,
      },
      params: {
        page_size: 20,
      },
    });

    if (response.code !== 0) {
      console.error('获取记录失败:', response.msg);
      return;
    }

    const records = response.data?.items || [];
    console.log(`共 ${records.length} 条记录:\n`);

    records.forEach((record, i) => {
      console.log(`--- 记录 ${i + 1} ---`);
      console.log(`record_id: ${record.record_id}`);
      const fields = record.fields || {};
      console.log(`记录ID: ${fields['记录ID'] || '(无)'}`);
      console.log(`类型: ${fields['类型'] || '(无)'}`);
      console.log(`阶段: ${fields['阶段'] || '(无)'}`);
      console.log(`状态: ${fields['状态'] || '(无)'}`);
      console.log(`内容: ${fields['内容'] || '(无)'}`);
      console.log('');
    });
  } catch (err) {
    console.error('错误:', err.message);
  }
}

listRecords().catch(console.error);
