// @ts-check
// tests/fallbackHandler.test.js — 降级处理器测试
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { FallbackHandler } = require('../src/core/fallbackHandler');

describe('FallbackHandler', () => {
  /** @type {FallbackHandler} */
  let handler;

  beforeEach(() => {
    handler = new FallbackHandler({
      llmTimeoutTemplate: '抱歉，AI 服务暂时不可用，请稍后重试。',
    });
  });

  describe('execute', () => {
    it('should return success when operation succeeds', async () => {
      const result = await handler.execute(
        'test_operation',
        async () => ({ data: 'success' })
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.data, 'success');
      assert.strictEqual(result.fallback_type, undefined);
    });

    it('should use fallback when operation fails', async () => {
      const result = await handler.execute(
        'feishu_api',
        async () => { throw new Error('API error'); },
        {
          fallbackFn: async () => ({ data: 'fallback data' }),
          useCache: true,
        }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.fallback_type, 'feishu_api');
      assert.ok(result.message.includes('fallback'));
    });
  });

  describe('Feishu API fallback', () => {
    it('should use local cache when Feishu fails', async () => {
      // 先存入缓存
      handler.setCache('record_123', { id: 'record_123', content: 'cached' });

      const result = await handler.execute(
        'feishu_api',
        async () => { throw new Error('Feishu API error'); },
        {
          fallbackFn: async () => handler.getCache('record_123'),
          useCache: true,
        }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.id, 'record_123');
    });
  });

  describe('LLM timeout fallback', () => {
    it('should return template on LLM timeout', async () => {
      const result = await handler.execute(
        'llm_timeout',
        async () => { throw new Error('timeout'); },
        {
          fallbackFn: async () => ({ message: handler.options.llmTimeoutTemplate }),
        }
      );

      assert.strictEqual(result.success, true);
      assert.ok(result.data.message.includes('抱歉'));
    });
  });

  describe('Knowledge recall fallback', () => {
    it('should return empty array on knowledge recall failure', async () => {
      const result = await handler.execute(
        'knowledge_recall',
        async () => { throw new Error('Recall failed'); },
        {
          fallbackFn: async () => [],
        }
      );

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data, []);
    });
  });

  describe('Word generation fallback', () => {
    it('should handle Word generation failure', async () => {
      const result = await handler.execute(
        'word_generation',
        async () => { throw new Error('Word generation failed'); },
        {
          fallbackFn: async () => ({ markdown: '# 备忘录\n\n内容' }),
        }
      );

      assert.strictEqual(result.success, true);
      assert.ok(result.data.markdown);
    });
  });

  describe('cache management', () => {
    it('should set and get cache', () => {
      handler.setCache('key1', { data: 'value1' });

      const cached = handler.getCache('key1');

      assert.deepStrictEqual(cached, { data: 'value1' });
    });

    it('should return undefined for missing cache', () => {
      const cached = handler.getCache('nonexistent');
      assert.strictEqual(cached, undefined);
    });

    it('should clear cache', () => {
      handler.setCache('key1', { data: 'value1' });
      handler.clearCache();

      const cached = handler.getCache('key1');
      assert.strictEqual(cached, undefined);
    });
  });

  describe('error tracking', () => {
    it('should track error count', async () => {
      await handler.execute('test', async () => { throw new Error('error 1'); }, { fallbackFn: async () => null });
      await handler.execute('test', async () => { throw new Error('error 2'); }, { fallbackFn: async () => null });

      const stats = handler.getStats();

      assert.strictEqual(stats.errorCount, 2);
    });

    it('should track last error', async () => {
      await handler.execute('test', async () => { throw new Error('specific error'); }, { fallbackFn: async () => null });

      const stats = handler.getStats();

      assert.ok(stats.lastError.includes('specific error'));
    });
  });

  describe('fallback chain', () => {
    it('should try multiple fallbacks in order', async () => {
      let attempts = [];

      const result = await handler.execute(
        'test',
        async () => { attempts.push('primary'); throw new Error('fail'); },
        {
          fallbackChain: [
            async () => { attempts.push('fallback1'); throw new Error('fail1'); },
            async () => { attempts.push('fallback2'); return { success: true }; },
          ]
        }
      );

      assert.deepStrictEqual(attempts, ['primary', 'fallback1', 'fallback2']);
      assert.strictEqual(result.success, true);
    });
  });
});
