const fs = require('fs');

let content = fs.readFileSync('src/integrations/feishuClient.js', 'utf-8');

const oldMethod = `  async listConsensusRecords(options = {}) {
    try {
      /** @type {Object[]} */
      const allRecords = [];

      // list 返回异步迭代器，自动处理分页
      const iterator = this.client.bitable.appTableRecord.list({
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
      });
      // 返回缓存数据
      return Array.from(this._recordCache.values());
    }
  }`;

const newMethod = `  async listConsensusRecords(options = {}) {
    try {
      /** @type {Object[]} */
      const allRecords = [];

      // 使用 list 方法获取记录
      const response = await this.client.bitable.appTableRecord.list({
        path: {
          app_token: this.bitableToken,
          table_id: this.consensusTableId,
        },
        params: {
          user_id_type: 'open_id',
          page_size: options.pageSize || 100,
        },
      });

      if (response.code !== 0) {
        throw new Error('Lark API error: ' + response.code + ' - ' + response.msg);
      }

      const records = response.data?.items || [];
      for (const record of records) {
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
      });
      // 返回缓存数据
      return Array.from(this._recordCache.values());
    }
  }`;

if (content.includes(oldMethod)) {
  content = content.replace(oldMethod, newMethod);
  fs.writeFileSync('src/integrations/feishuClient.js', content, 'utf-8');
  console.log('Done - fixed listConsensusRecords method');
} else {
  console.log('Pattern not found, checking current state...');
  if (content.includes('for await (const record of iterator)')) {
    console.log('ERROR: still has for-await loop');
  } else {
    console.log('OK: method already fixed');
  }
}
