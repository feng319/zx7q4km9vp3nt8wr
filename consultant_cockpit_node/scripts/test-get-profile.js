#!/usr/bin/env node
// 测试 getClientProfile 查询

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

async function testGetProfile(company) {
  console.log(`=== 测试查询公司: ${company} ===\n`);

  try {
    const response = await client.bitable.appTableRecord.list({
      path: {
        app_token: bitableToken,
        table_id: profileTableId,
      },
      params: {
        user_id_type: 'open_id',
        page_size: 10,
      },
      data: {
        filter: {
          conditions: [{
            field_name: '客户公司名',
            operator: 'is',
            value: [company],
          }],
          conjunction: 'and',
        },
      },
    });

    console.log('API 响应状态:', response.code);
    console.log('API 响应消息:', response.msg);

    const records = response.data?.items || [];
    console.log(`找到 ${records.length} 条记录:\n`);

    for (const record of records) {
      console.log('record_id:', record.record_id);
      console.log('fields:', record.fields);
      console.log('');
    }
  } catch (error) {
    console.error('查询失败:', error.message);
  }
}

// 测试两个公司名
async function main() {
  await testGetProfile('测试公司_1777821489377');
  console.log('---\n');
  await testGetProfile('测试储能科技有限公司');
}

main().catch(console.error);