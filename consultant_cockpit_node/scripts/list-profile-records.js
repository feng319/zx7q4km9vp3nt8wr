#!/usr/bin/env node
// 查询客户档案表中的记录

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
  console.log('profileTableId:', profileTableId);
  console.log('bitableToken:', bitableToken);

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

    console.log('API 响应状态:', response.code);
    console.log('API 响应消息:', response.msg);

    const items = response.data?.items || [];
    console.log(`共 ${items.length} 条记录:\n`);

    for (const record of items) {
      console.log(`--- 记录 ---`);
      console.log('record_id:', record.record_id);

      const fields = record.fields || {};
      console.log('公司名称:', fields['公司名称'] || '(无)');
      console.log('产品线:', fields['产品线'] || '(无)');
      console.log('客户群体:', fields['客户群体'] || '(无)');
      console.log('收入结构:', fields['收入结构'] || '(无)');
      console.log('毛利结构:', fields['毛利结构'] || '(无)');
      console.log('交付情况:', fields['交付情况'] || '(无)');
      console.log('资源分布:', fields['资源分布'] || '(无)');
      console.log('战略目标:', fields['战略目标'] || '(无)');
      console.log('显性诉求:', fields['显性诉求'] || '(无)');
      console.log('隐性痛点:', fields['隐性痛点'] || '(无)');
      console.log('当前追问:', fields['当前追问'] || '(无)');
      console.log('诊断进度:', fields['诊断进度'] || '(无)');
      console.log('');
    }
  } catch (error) {
    console.error('查询失败:', error.message);
    if (error.code) {
      console.error('错误代码:', error.code);
    }
  }
}

listRecords().catch(console.error);