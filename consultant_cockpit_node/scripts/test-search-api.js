#!/usr/bin/env node
// 测试使用 search API 的 getClientProfile

const { FeishuClient } = require('../src/integrations/feishuClient');
require('dotenv').config();

async function testGetClientProfile() {
  const client = new FeishuClient();

  console.log('=== 测试 getClientProfile (使用 search API) ===\n');

  // 测试存在的公司
  console.log('1. 测试存在的公司: 测试储能科技有限公司');
  const profile1 = await client.getClientProfile('测试储能科技有限公司');
  console.log('结果:', profile1 ? `找到记录, record_id: ${profile1.record_id}` : '未找到');
  if (profile1) {
    console.log('客户公司名:', profile1['客户公司名']);
  }

  console.log('\n2. 测试不存在的公司: 不存在的公司XYZ');
  const profile2 = await client.getClientProfile('不存在的公司XYZ');
  console.log('结果:', profile2 ? `找到记录 (错误!)` : '未找到 (正确!)');

  console.log('\n=== 测试结果 ===');
  if (profile1 && !profile2) {
    console.log('✅ getClientProfile 工作正常！');
  } else {
    console.log('❌ getClientProfile 有问题');
  }
}

testGetClientProfile().catch(console.error);
