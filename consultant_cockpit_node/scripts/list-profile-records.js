#!/usr/bin/env node
// 查询客户档案表中的记录

const FeishuClient = require('../src/integrations/feishuClient');

async function main() {
  const client = new FeishuClient();

  console.log('=== 客户档案表中的记录 ===\n');

  try {
    // 查询客户档案表
    const response = await client._withRetry(async () => {
      return await client.client.bitable.appTableRecord.list({
        path: {
          app_token: client.appToken,
          table_id: client.profileTableId,  // 使用客户档案表
        },
        params: {
          page_size: 100,
        },
      });
    });

    const records = response.data?.items || [];
    console.log(`共 ${records.length} 条记录:\n`);

    for (const record of records) {
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
  }
}

main().catch(console.error);