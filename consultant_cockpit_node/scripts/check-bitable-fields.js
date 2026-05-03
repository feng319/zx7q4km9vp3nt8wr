#!/usr/bin/env node
// 查询飞书多维表格的表列表和字段结构

const lark = require('@larksuiteoapi/node-sdk');
require('dotenv').config();

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

const bitableToken = process.env.FEISHU_BITABLE_APP_TOKEN;

async function listTables() {
  console.log('\n=== 多维表格中的所有表 ===\n');
  try {
    const response = await client.bitable.appTable.list({
      path: { app_token: bitableToken },
    });

    if (response.code !== 0) {
      console.error('获取表列表失败:', response.msg);
      return [];
    }

    const tables = response.data?.items || [];
    tables.forEach(t => {
      console.log(`- 表名: ${t.name}`);
      console.log(`  table_id: ${t.table_id}`);
      console.log('');
    });
    return tables;
  } catch (err) {
    console.error('错误:', err.message);
    return [];
  }
}

async function listFields(tableId, tableName) {
  console.log(`\n=== 表「${tableName}」的字段列表 ===\n`);
  try {
    const response = await client.bitable.appTableField.list({
      path: {
        app_token: bitableToken,
        table_id: tableId,
      },
      params: {
        page_size: 100,
      },
    });

    if (response.code !== 0) {
      console.error('获取字段列表失败:', response.msg);
      return;
    }

    const fields = response.data?.items || [];
    console.log(`共 ${fields.length} 个字段:\n`);

    fields.forEach((f, i) => {
      console.log(`${i + 1}. ${f.field_name}`);
      console.log(`   field_id: ${f.field_id}`);
      console.log(`   type: ${f.type} (${getTypeName(f.type)})`);
      if (f.property) {
        console.log(`   property:`, JSON.stringify(f.property));
      }
      console.log('');
    });
  } catch (err) {
    console.error('错误:', err.message);
  }
}

function getTypeName(type) {
  const typeMap = {
    1: '文本',
    2: '数字',
    3: '单选',
    4: '多选',
    5: '日期',
    7: '复选框',
    11: '人员',
    13: '电话号码',
    15: '超链接',
    17: '附件',
    18: '关联',
    19: '查找引用',
    20: '公式',
    21: '地理位置',
    22: '群组',
    23: '创建时间',
    1001: '自动编号',
    1002: '创建人',
    1003: '修改时间',
    1004: '修改人',
  };
  return typeMap[type] || '未知';
}

async function main() {
  const tables = await listTables();

  // 找到客户诊断数据表
  const targetTable = tables.find(t =>
    t.name === '客户诊断数据' ||
    t.name.includes('客户') ||
    t.name.includes('诊断')
  );

  if (targetTable) {
    await listFields(targetTable.table_id, targetTable.name);
  } else {
    console.log('\n未找到「客户诊断数据」表，请检查表名');
  }

  // 也检查配置中的表
  console.log('\n=== 配置中的表 ===\n');
  const configTableId = process.env.FEISHU_BITABLE_TABLE_ID;
  const configConsensusId = process.env.FEISHU_BITABLE_CONSENSUS_TABLE_ID;

  const configTable = tables.find(t => t.table_id === configTableId);
  if (configTable) {
    await listFields(configTableId, configTable.name);
  } else {
    console.log(`配置的 profileTableId (${configTableId}) 未找到对应表`);
  }

  const consensusTable = tables.find(t => t.table_id === configConsensusId);
  if (consensusTable) {
    await listFields(configConsensusId, consensusTable.name);
  } else {
    console.log(`配置的 consensusTableId (${configConsensusId}) 未找到对应表`);
  }
}

main().catch(console.error);
