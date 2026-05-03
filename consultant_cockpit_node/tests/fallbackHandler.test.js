// @ts-check
// tests/fallbackHandler.test.js — 降级处理器测试
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FallbackHandler, FallbackChain, FallbackType, getFallbackTemplate } = require('../src/core/fallbackHandler');

describe('FallbackHandler', () => {
  /** @type {FallbackHandler} */
  let handler;

  beforeEach(() => {
    handler = new FallbackHandler();
  });

  afterEach(() => {
    handler.clearHistory();
    handler.clearLocalCache();
  });

  describe('handleFeishuFailure', () => {
    it('should handle Feishu API failure', () => {
      const error = new Error('API error');
      const result = handler.handleFeishuFailure('sync_record', error, { id: 'record_1' });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.fallback_type, FallbackType.FEISHU_API);
      assert.ok(result.message.includes('本地缓存'));
      assert.ok(result.data.local_cached);
    });

    it('should increment fallback count', () => {
      handler.handleFeishuFailure('op1', new Error('e1'), {});
      handler.handleFeishuFailure('op2', new Error('e2'), {});

      const report = handler.getFallbackReport();

      assert.strictEqual(report.by_type[FallbackType.FEISHU_API], 2);
    });
  });

  describe('handleLlmTimeout', () => {
    it('should return success when generator completes in time', async () => {
      const result = await handler.handleLlmTimeout(
        () => Promise.resolve('LLM response'),
        5,
        'fallback value'
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.result, 'LLM response');
    });

    it('should return fallback on timeout', async () => {
      const result = await handler.handleLlmTimeout(
        () => new Promise(resolve => setTimeout(() => resolve('slow'), 2000)),
        0.1, // 100ms timeout
        'fallback value'
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.data.fallback_value, 'fallback value');
    });

    it('should return fallback on error', async () => {
      const result = await handler.handleLlmTimeout(
        () => Promise.reject(new Error('LLM error')),
        5,
        'fallback value'
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.data.fallback_value, 'fallback value');
    });

    it('should use template when provided', async () => {
      const result = await handler.handleLlmTimeout(
        () => Promise.reject(new Error('error')),
        1,
        null,
        'diagnosis_hypothesis'
      );

      assert.ok(result.data.fallback_value.includes('行业经验'));
    });
  });

  describe('handleKnowledgeRecallFailure', () => {
    it('should handle knowledge recall with results', async () => {
      const mockRetriever = {
        recallByKeywords: () => [
          { id: 'sku_1', title: 'SKU 1', summary: 'Summary 1', confidence: '🟢' }
        ]
      };

      const result = await handler.handleKnowledgeRecallFailure('关键词', mockRetriever, 5);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.results.length, 1);
    });

    it('should handle knowledge recall failure', async () => {
      const mockRetriever = {
        recallByKeywords: () => { throw new Error('Recall failed'); }
      };

      const result = await handler.handleKnowledgeRecallFailure('关键词', mockRetriever, 5);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.data.results.length, 0);
    });
  });

  describe('handleWordGenerationFailure', () => {
    it('should convert content to text', () => {
      const content = {
        title: '测试标题',
        items: ['项目1', '项目2']
      };

      const result = handler.handleWordGenerationFailure(content, new Error('Word error'));

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.fallback_type, FallbackType.WORD_GENERATION);
      assert.ok(result.data.text_content);
      assert.strictEqual(result.data.format, 'plain_text');
    });
  });

  describe('getFallbackReport', () => {
    it('should return fallback statistics', () => {
      handler.handleFeishuFailure('op1', new Error('e1'), {});
      handler.handleLlmTimeout(() => Promise.reject(new Error('e2')), 1, 'fallback');

      const report = handler.getFallbackReport();

      assert.strictEqual(report.total_fallbacks, 2);
      assert.ok(report.by_type[FallbackType.FEISHU_API] >= 1);
      assert.ok(report.by_type[FallbackType.LLM_TIMEOUT] >= 1);
    });
  });

  describe('local cache', () => {
    it('should store and retrieve local cache', () => {
      handler.handleFeishuFailure('op1', new Error('e1'), { record_id: 'r1' });

      const cache = handler.getLocalCache();

      assert.ok(cache.length > 0);
      assert.strictEqual(cache[0].operation, 'op1');
    });

    it('should clear local cache', () => {
      handler.handleFeishuFailure('op1', new Error('e1'), {});
      handler.clearLocalCache();

      const cache = handler.getLocalCache();

      assert.strictEqual(cache.length, 0);
    });
  });
});

describe('FallbackChain', () => {
  /** @type {FallbackChain} */
  let chain;
  /** @type {FallbackHandler} */
  let handler;

  beforeEach(() => {
    handler = new FallbackHandler();
    chain = new FallbackChain(handler);
  });

  describe('execute', () => {
    it('should return primary result on success', () => {
      const result = chain
        .add(() => 'fallback')
        .execute(() => 'primary');

      assert.strictEqual(result, 'primary');
    });

    it('should try fallback on primary failure', () => {
      const result = chain
        .add(() => 'fallback1')
        .add(() => 'fallback2')
        .execute(() => { throw new Error('primary failed'); });

      assert.strictEqual(result, 'fallback1');
    });

    it('should try next fallback if first fails', () => {
      const result = chain
        .add(() => { throw new Error('fallback1 failed'); })
        .add(() => 'fallback2')
        .execute(() => { throw new Error('primary failed'); });

      assert.strictEqual(result, 'fallback2');
    });

    it('should throw if all fallbacks fail', () => {
      assert.throws(() => {
        chain
          .add(() => { throw new Error('fallback1 failed'); })
          .add(() => { throw new Error('fallback2 failed'); })
          .execute(() => { throw new Error('primary failed'); });
      });
    });
  });
});

describe('getFallbackTemplate', () => {
  it('should return template for valid name', () => {
    const template = getFallbackTemplate('diagnosis_hypothesis');

    assert.ok(template.includes('行业经验'));
  });

  it('should return empty string for invalid name', () => {
    const template = getFallbackTemplate('nonexistent');

    assert.strictEqual(template, '');
  });
});
