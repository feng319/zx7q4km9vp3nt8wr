#!/usr/bin/env node
// 为「客户诊断数据」表添加缺失的「当前追问」和「诊断进度」字段

const lark = require('@larksuiteoapi/node-sdk');
require('dotenv').config();

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

const bitableToken = process.env.FEISHU_BITABLE_APP_TOKEN;
const tableId = process.env.FEISHU_BITABLE_TABLE_ID;  // 客户诊断数据表

async function addField(fieldName, type, property = null) {
  console.log(`\n正在添加字段: ${fieldName} (type: ${type})`);

  const data = { field_name: fieldName, type };
  if (property) data.property = property;

  try {
    const response = await client.bitable.appTableField.create({
      path: {
        app_token: bitableToken,
        table_id: tableId,
      },
      data,
    });

    if (response.code !== 0) {
      console.error(`添加字段失败: ${response.msg}`);
      return false;
    }

    console.log(`✅ 成功添加字段: ${fieldName} (field_id: ${response.data?.field?.field_id})`);
    return true;
  } catch (err) {
    console.error(`错误: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('=== 为「客户诊断数据」表添加缺失字段 ===\n');
  console.log(`bitableToken: ${bitableToken}`);
  console.log(`tableId: ${tableId}`);

  // 1. 添加「当前追问」字段（单行文本，type=1）
  await addField('当前追问', 1);

  // 2. 添加「诊断进度」字段（数字类型，type=2）
  // 尝试不带 property，先创建纯数字字段
  await addField('诊断进度', 2);

  console.log('\n=== 完成 ===');
}

main().catch(console.error);
