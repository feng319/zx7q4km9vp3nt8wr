const fs = require('fs');

let content = fs.readFileSync('src/integrations/feishuClient.js', 'utf-8');

// 找到需要替换的方法签名和返回语句
const oldPattern = /async listConsensusRecords\(options = \{\}\) \{[\s\S]*?return allRecords;\s*\} catch \(error\) \{\s*logger\.error\('Failed to list consensus records', \{ error: error\.message \}\);/;

const newMethod = `async listConsensusRecords(options = {}) {
    try {
      /** @type {Object[]} */
      const allRecords = [];

      // listWithIterator 返回异步迭代器，自动处理分页
      const iterator = this.client.bitable.appTableRecord.listWithIterator({
        path: {
          app_token: this.bitableToken,
          table_id: this.consensusTableId,
        },
        params: {
          user_id_type: 'open_id',
          page_size: options.pageSize || 100,
        },
      });

      // 遍历迭代器获取所有记录
      for await (const record of iterator) {
        if (record && record.record_id) {
          allRecords.push({
            record_id: record.record_id,
            ...this._fieldsToRecord(record.fields),
          });
        }
      }

      logger.info('Listed consensus records', { count: allRecords.length });

      // 更新缓存
      for (const record of allRecords) {
        if (record.record_id) {
          this._recordCache.set(record.record_id, record);
        }
      }

      return allRecords;
    } catch (error) {
      logger.error('Failed to list consensus records', {
        error: error.message,
        stack: error.stack,
        bitableToken: this.bitableToken,
        consensusTableId: this.consensusTableId,
      });`;

content = content.replace(oldPattern, newMethod);

fs.writeFileSync('src/integrations/feishuClient.js', content, 'utf-8');
console.log('Done - fixed listConsensusRecords method');
