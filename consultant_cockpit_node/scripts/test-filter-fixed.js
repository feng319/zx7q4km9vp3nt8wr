#!/usr/bin/env node
// 测试修复后的 getClientProfile 查询

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

async function testGetProfileFixed(company) {
  console.log(`=== 测试查询公司: ${company} ===\n`);

  try {
    // 使用扁平化的 filter 参数格式
    const response = await client.bitable.appTableRecord.list({
      path: {
        app_token: bitableToken,
        table_id: profileTableId,
      },
      params: {
        user_id_type: 'open_id',
        page_size: 10,
        'filter[conditions][0][field_name]': '客户公司名',
        'filter[conditions][0][operator]': 'is',
        'filter[conditions][0][value][0]': company,
        'filter[conjunction]': 'and',
      },
    });

    console.log('API 响应状态:', response.code);
    console.log('API 响应消息:', response.msg);

    const records = response.data?.items || [];
    console.log(`找到 ${records.length} 条记录:\n`);

    for (const record of records) {
      console.log('record_id:', record.record_id);
      console.log('客户公司名:', record.fields['客户公司名']);
      console.log('');
    }

    return records;
  } catch (error) {
    console.error('查询失败:', error.message);
    return [];
  }
}

async function main() {
  // 测试存在的公司
  console.log('--- 测试存在的公司 ---');
  const records1 = await testGetProfileFixed('测试储能科技有限公司');

  console.log('\n--- 测试不存在的公司 ---');
  const records2 = await testGetProfileFixed('不存在的公司XYZ');

  console.log('\n=== 测试结果 ===');
  console.log(`测试储能科技有限公司: 找到 ${records1.length} 条记录`);
  console.log(`不存在的公司XYZ: 找到 ${records2.length} 条记录`);

  if (records1.length > 0 && records2.length === 0) {
    console.log('\n✅ Filter 功能正常工作！');
  } else if (records1.length === 0) {
    console.log('\n❌ Filter 可能过于严格，未找到应存在的记录');
  } else if (records2.length > 0) {
    console.log('\n❌ Filter 未生效，返回了不应存在的记录');
  }
}

main().catch(console.error);
