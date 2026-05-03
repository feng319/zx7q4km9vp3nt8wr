#!/usr/bin/env node
// 测试不同的 filter 用法

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

async function testFilterV1() {
  console.log('=== 测试方法1: filter 在 params 中 ===\n');

  try {
    const response = await client.bitable.appTableRecord.list({
      path: {
        app_token: bitableToken,
        table_id: profileTableId,
      },
      params: {
        user_id_type: 'open_id',
        page_size: 10,
        filter: JSON.stringify({
          conditions: [{
            field_name: '客户公司名',
            operator: 'is',
            value: ['测试储能科技有限公司'],
          }],
          conjunction: 'and',
        }),
      },
    });

    console.log('API 响应状态:', response.code);
    const records = response.data?.items || [];
    console.log(`找到 ${records.length} 条记录`);
    for (const r of records) {
      console.log('  -', r.fields['客户公司名']);
    }
  } catch (error) {
    console.error('失败:', error.message);
  }
}

async function testFilterV2() {
  console.log('\n=== 测试方法2: filter 直接在 params 中（对象） ===\n');

  try {
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
        'filter[conditions][0][value][0]': '测试储能科技有限公司',
        'filter[conjunction]': 'and',
      },
    });

    console.log('API 响应状态:', response.code);
    const records = response.data?.items || [];
    console.log(`找到 ${records.length} 条记录`);
    for (const r of records) {
      console.log('  -', r.fields['客户公司名']);
    }
  } catch (error) {
    console.error('失败:', error.message);
  }
}

async function testFilterV3() {
  console.log('\n=== 测试方法3: 使用 request body ===\n');

  try {
    // 直接使用 HTTP 请求
    const https = require('https');
    const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${bitableToken}/tables/${profileTableId}/records?page_size=10&user_id_type=open_id`;

    // 先获取 token
    const tokenResponse = await client.auth.tenantAccessToken.internal({
      data: {}
    });
    const token = tokenResponse.data?.tenant_access_token;

    const filterJson = JSON.stringify({
      filter: {
        conditions: [{
          field_name: '客户公司名',
          operator: 'is',
          value: ['测试储能科技有限公司'],
        }],
        conjunction: 'and',
      }
    });

    console.log('请求 filter:', filterJson);

    // 这里只是打印，实际需要发送请求
    console.log('此方法需要手动实现 HTTP 请求');
  } catch (error) {
    console.error('失败:', error.message);
  }
}

async function main() {
  await testFilterV1();
  await testFilterV2();
  await testFilterV3();
}

main().catch(console.error);