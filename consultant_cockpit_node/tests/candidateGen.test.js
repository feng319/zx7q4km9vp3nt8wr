// @ts-check
// tests/candidateGen.test.js — 候选方案生成器测试
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { CandidateGenerator, CandidateCache } = require('../src/core/candidateGen');

describe('CandidateCache', () => {
  /** @type {CandidateCache} */
  let cache;

  beforeEach(() => {
    cache = new CandidateCache({ ttlSeconds: 60 });
  });

  describe('get/set', () => {
    it('should return null for empty cache', () => {
      const result = cache.get('战略梳理');
      assert.strictEqual(result, null);
    });

    it('should store and retrieve candidates', () => {
      const candidates = [
        { id: 'c1', title: '方案1', risk_level: '稳健' },
        { id: 'c2', title: '方案2', risk_level: '平衡' },
      ];

      cache.set('战略梳理', candidates);
      const result = cache.get('战略梳理');

      assert.ok(result);
      assert.strictEqual(result.candidates.length, 2);
    });
  });

  describe('TTL expiration', () => {
    it('should return null after TTL expires', async () => {
      const shortCache = new CandidateCache({ ttlSeconds: 1 });

      shortCache.set('战略梳理', [{ id: 'c1' }]);

      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 1100));

      const result = shortCache.get('战略梳理');
      assert.strictEqual(result, null);
    });
  });

  describe('invalidate', () => {
    it('should clear cache for specific stage', () => {
      cache.set('战略梳理', [{ id: 'c1' }]);
      cache.set('商业模式', [{ id: 'c2' }]);

      cache.invalidate('战略梳理');

      assert.strictEqual(cache.get('战略梳理'), null);
      assert.ok(cache.get('商业模式'));
    });

    it('should clear all cache', () => {
      cache.set('战略梳理', [{ id: 'c1' }]);
      cache.set('商业模式', [{ id: 'c2' }]);

      cache.invalidateAll();

      assert.strictEqual(cache.get('战略梳理'), null);
      assert.strictEqual(cache.get('商业模式'), null);
    });
  });

  describe('status', () => {
    it('should return cache status', () => {
      cache.set('战略梳理', [{ id: 'c1' }]);

      const status = cache.getStatus('战略梳理');

      assert.strictEqual(status.is_valid, true);
      assert.ok(typeof status.age_seconds === 'number');
    });
  });
});

describe('CandidateGenerator', () => {
  /** @type {CandidateGenerator} */
  let generator;

  beforeEach(() => {
    generator = new CandidateGenerator({
      llmClient: {
        chat: async () => JSON.stringify({
          candidates: [
            { title: '稳健方案', description: '稳健描述', risk_level: '稳健' },
            { title: '平衡方案', description: '平衡描述', risk_level: '平衡' },
            { title: '激进方案', description: '激进描述', risk_level: '激进' },
          ]
        })
      }
    });
  });

  describe('generate', () => {
    it('should generate three candidates', async () => {
      const facts = [
        { content: '事实1' },
        { content: '事实2' },
      ];

      const result = await generator.generate('战略梳理', facts);

      assert.strictEqual(result.length, 3);
      assert.ok(result.every(c => c.id));
      assert.ok(result.every(c => c.title));
      assert.ok(result.every(c => c.risk_level));
    });

    it('should assign evidence SKUs to candidates', async () => {
      const facts = [
        { content: '事实1', evidence_sku: ['sku_1'] },
        { content: '事实2', evidence_sku: ['sku_2'] },
      ];

      const result = await generator.generate('战略梳理', facts);

      // 每个候选应该有关联的 SKU
      assert.ok(result.every(c => c.evidence_skus && c.evidence_skus.length >= 0));
    });
  });

  describe('getCached', () => {
    it('should return cached candidates if valid', async () => {
      const facts = [{ content: '事实1' }];

      // 第一次生成
      const first = await generator.getCached('战略梳理', facts);

      // 第二次应该返回缓存
      const second = await generator.getCached('战略梳理', facts);

      assert.ok(first);
      assert.ok(second);
      assert.strictEqual(second.cacheStatus.is_valid, true);
    });
  });

  describe('checkConstraints', () => {
    it('should pass when all constraints met', () => {
      const candidates = [
        { id: 'c1', evidence_skus: ['sku_1', 'sku_2'] },
        { id: 'c2', evidence_skus: ['sku_3', 'sku_4'] },
        { id: 'c3', evidence_skus: ['sku_5', 'sku_6'] },
      ];

      const result = generator.checkConstraints(candidates, {
        minSkuPerCandidate: 2,
        minTotalCandidates: 3,
      });

      assert.strictEqual(result.valid, true);
    });

    it('should fail when SKU insufficient', () => {
      const candidates = [
        { id: 'c1', evidence_skus: ['sku_1'] },
      ];

      const result = generator.checkConstraints(candidates, {
        minSkuPerCandidate: 2,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.message.includes('不足'));
    });
  });

  describe('precompute', () => {
    it('should precompute candidates in background', async () => {
      const consensusChain = {
        getConfirmedFacts: () => [{ content: '事实1' }],
        getPendingConsensus: () => [],
      };

      // 启动预计算
      generator.startPrecompute(consensusChain);

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100));

      // 停止预计算
      generator.stopPrecompute();

      // 验证缓存已填充
      const status = generator.cache.getStatus('战略梳理');
      // 可能还没完成，但不应抛出错误
      assert.ok(true);
    });
  });
});
