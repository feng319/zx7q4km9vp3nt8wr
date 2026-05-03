#!/usr/bin/env node
// 测试不同的 filter 传递方式

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

// 方法1: filter 作为 JSON 字符串
async function testMethod1(company) {
  console.log('=== 方法1: filter 作为 JSON 字符串 ===');
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
            value: [company],
          }],
          conjunction: 'and',
        }),
      },
    });
    console.log('响应状态:', response.code);
    console.log('记录数:', response.data?.items?.length || 0);
    return response.data?.items || [];
  } catch (error) {
    console.error('失败:', error.message);
    return [];
  }
}

// 方法2: 使用原生 HTTP 请求
async function testMethod2(company) {
  console.log('\n=== 方法2: 使用原生 HTTP 请求 ===');
  const https = require('https');

  try {
    // 获取 token
    const tokenResponse = await client.auth.tenantAccessToken.internal({
      data: {}
    });
    const token = tokenResponse.data?.tenant_access_token;

    const filterObj = {
      conditions: [{
        field_name: '客户公司名',
        operator: 'is',
        value: [company],
      }],
      conjunction: 'and',
    };

    const url = `https://open.larksuite.com/open-apis/bitable/v1/apps/${bitableToken}/tables/${profileTableId}/records?page_size=10&user_id_type=open_id&filter=${encodeURIComponent(JSON.stringify(filterObj))}`;

    console.log('请求 URL (部分):', url.substring(0, 100) + '...');

    return new Promise((resolve) => {
      https.get(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            console.log('响应状态:', json.code);
            console.log('记录数:', json.data?.items?.length || 0);
            resolve(json.data?.items || []);
          } catch (e) {
            console.error('解析失败:', e.message);
            resolve([]);
          }
        });
      }).on('error', (e) => {
        console.error('请求失败:', e.message);
        resolve([]);
      });
    });
  } catch (error) {
    console.error('失败:', error.message);
    return [];
  }
}

// 方法3: 使用 POST 请求体
async function testMethod3(company) {
  console.log('\n=== 方法3: 使用 POST 请求体 ===');
  const https = require('https');

  try {
    // 获取 token
    const tokenResponse = await client.auth.tenantAccessToken.internal({
      data: {}
    });
    const token = tokenResponse.data?.tenant_access_token;

    const postData = JSON.stringify({
      filter: {
        conditions: [{
          field_name: '客户公司名',
          operator: 'is',
          value: [company],
        }],
        conjunction: 'and',
      }
    });

    const options = {
      hostname: 'open.larksuite.com',
      path: `/open-apis/bitable/v1/apps/${bitableToken}/tables/${profileTableId}/records/search?page_size=10&user_id_type=open_id`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            console.log('响应状态:', json.code);
            console.log('记录数:', json.data?.items?.length || 0);
            if (json.code !== 0) {
              console.log('错误信息:', json.msg);
            }
            resolve(json.data?.items || []);
          } catch (e) {
            console.error('解析失败:', e.message);
            resolve([]);
          }
        });
      });

      req.on('error', (e) => {
        console.error('请求失败:', e.message);
        resolve([]);
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    console.error('失败:', error.message);
    return [];
  }
}

async function main() {
  const company = '测试储能科技有限公司';

  console.log(`测试公司: ${company}\n`);

  const r1 = await testMethod1(company);
  const r2 = await testMethod2(company);
  const r3 = await testMethod3(company);

  console.log('\n=== 结果汇总 ===');
  console.log(`方法1 (JSON字符串): ${r1.length} 条记录`);
  console.log(`方法2 (原生GET): ${r2.length} 条记录`);
  console.log(`方法3 (POST search): ${r3.length} 条记录`);
}

main().catch(console.error);
