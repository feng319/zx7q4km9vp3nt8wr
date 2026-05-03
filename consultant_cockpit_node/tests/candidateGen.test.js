// @ts-check
// tests/candidateGen.test.js — 候选方案生成器测试
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { CandidateGenerator, CandidateCache } = require('../src/core/candidateGen');
const { ConsensusChain } = require('../src/core/consensusChain');

describe('CandidateCache', () => {
  /** @type {CandidateCache} */
  let cache;

  beforeEach(() => {
    cache = new CandidateCache();
  });

  describe('get/set', () => {
    it('should return null for empty cache', () => {
      const result = cache.get();
      assert.strictEqual(result, null);
    });

    it('should store and retrieve candidates', () => {
      const candidates = [
        { id: 'c1', title: '方案1', risk_level: '稳健', description: '', evidence_skus: [] },
        { id: 'c2', title: '方案2', risk_level: '平衡', description: '', evidence_skus: [] },
      ];

      cache.set(candidates);
      const result = cache.get();

      assert.ok(result);
      assert.strictEqual(result.length, 2);
    });
  });

  describe('invalidate', () => {
    it('should invalidate cache', () => {
      cache.set([{ id: 'c1', title: '方案1', risk_level: '稳健', description: '', evidence_skus: [] }]);
      cache.invalidate();

      assert.strictEqual(cache.isValid(), false);
      assert.strictEqual(cache.get(), null);
    });
  });

  describe('getAgeSeconds', () => {
    it('should return age in seconds', async () => {
      cache.set([{ id: 'c1', title: '测试', risk_level: '稳健', description: '', evidence_skus: [] }]);

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100));

      const age = cache.getAgeSeconds();

      assert.ok(age >= 0.1);
    });
  });
});

describe('CandidateGenerator', () => {
  /** @type {CandidateGenerator} */
  let generator;
  /** @type {ConsensusChain} */
  let consensusChain;

  beforeEach(() => {
    consensusChain = new ConsensusChain();

    generator = new CandidateGenerator({
      llmClient: {
        generate: async () => `候选1: 稳健型策略，优先保障现有业务稳定运行，稳健型策略
候选2: 平衡型策略，在稳健基础上适度投入创新业务，平衡型策略
候选3: 激进型策略，大胆投入新业务方向，追求高增长高回报，激进型策略`
      },
      consensusChain
    });

    // 添加足够的测试数据
    consensusChain.addRecord({
      type: 'fact',
      stage: '战略梳理',
      content: '公司有强大的研发团队',
      source: 'manual',
      status: 'confirmed'
    });

    consensusChain.addRecord({
      type: 'fact',
      stage: '战略梳理',
      content: '市场份额在下降',
      source: 'manual',
      status: 'confirmed'
    });

    consensusChain.addRecord({
      type: 'fact',
      stage: '战略梳理',
      content: '现金流充裕',
      source: 'manual',
      status: 'confirmed'
    });

    consensusChain.addRecord({
      type: 'consensus',
      stage: '战略梳理',
      content: '应聚焦高端市场',
      source: 'ai_suggested',
      status: 'pending_client_confirm'
    });
  });

  describe('checkConstraints', () => {
    it('should pass when all constraints met', () => {
      const skus = [
        { id: 'sku_1', title: 'SKU 1', confidence: '🟢' },
        { id: 'sku_2', title: 'SKU 2', confidence: '🟡' },
      ];

      const result = generator.checkConstraints(skus);

      assert.strictEqual(result.valid, true);
    });

    it('should fail when not enough facts', () => {
      // 创建一个新的、空的共识链
      const emptyChain = new ConsensusChain();
      const genWithEmptyChain = new CandidateGenerator({
        llmClient: { generate: async () => '' },
        consensusChain: emptyChain
      });

      const result = genWithEmptyChain.checkConstraints([]);

      assert.strictEqual(result.valid, false);
      assert.ok(result.message.includes('共识不足'));
    });

    it('should fail when no pending consensus', () => {
      // 创建一个没有待确认共识的链
      const chainNoPending = new ConsensusChain();
      chainNoPending.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: '事实1',
        source: 'manual',
        status: 'confirmed'
      });
      chainNoPending.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: '事实2',
        source: 'manual',
        status: 'confirmed'
      });
      chainNoPending.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: '事实3',
        source: 'manual',
        status: 'confirmed'
      });
      // 没有待确认共识

      const genNoPending = new CandidateGenerator({
        llmClient: { generate: async () => '' },
        consensusChain: chainNoPending
      });

      const result = genNoPending.checkConstraints([]);

      assert.strictEqual(result.valid, false);
      assert.ok(result.message.includes('待确认'));
    });
  });

  describe('generateCandidates', () => {
    it('should generate three candidates', async () => {
      const candidates = await generator.generateCandidates();

      assert.strictEqual(candidates.length, 3);
      assert.ok(candidates.every(c => c.id));
      assert.ok(candidates.every(c => c.title));
      assert.ok(candidates.every(c => c.risk_level));
    });

    it('should have different risk levels', async () => {
      const candidates = await generator.generateCandidates();

      const riskLevels = candidates.map(c => c.risk_level);
      const uniqueLevels = new Set(riskLevels);

      assert.strictEqual(uniqueLevels.size, 3);
    });
  });

  describe('_parseResponse', () => {
    it('should parse LLM response correctly', () => {
      const response = `候选1: 稳健型策略描述，稳健型策略
候选2: 平衡型策略描述，平衡型策略
候选3: 激进型策略描述，激进型策略`;

      const candidates = generator._parseResponse(response);

      assert.strictEqual(candidates.length, 3);
      assert.strictEqual(candidates[0].risk_level, '稳健');
      assert.strictEqual(candidates[1].risk_level, '平衡');
      assert.strictEqual(candidates[2].risk_level, '激进');
    });

    it('should handle full-width colon', () => {
      const response = `候选1：稳健型策略描述，稳健型策略
候选2：平衡型策略描述，平衡型策略
候选3：激进型策略描述，激进型策略`;

      const candidates = generator._parseResponse(response);

      assert.strictEqual(candidates.length, 3);
    });

    it('should fill missing candidates', () => {
      const response = `候选1: 只有一个候选`;

      const candidates = generator._parseResponse(response);

      assert.strictEqual(candidates.length, 3);
      // 后两个应该是填充的
      assert.ok(candidates[1].title.includes('解析失败') || candidates[1].title.includes('候选'));
    });
  });

  describe('cache operations', () => {
    it('should cache candidates', async () => {
      await generator.generateCandidates();

      const cached = generator.getCachedCandidates();

      assert.ok(cached);
      assert.strictEqual(cached.length, 3);
    });

    it('should invalidate cache', () => {
      generator._cache.set([{ id: 'c1', title: '测试', risk_level: '稳健', description: '', evidence_skus: [] }]);

      generator.invalidateCache();

      assert.strictEqual(generator._cache.isValid(), false);
    });

    it('should return cache status', () => {
      const status = generator.getCacheStatus();

      assert.ok(typeof status.is_valid === 'boolean');
      assert.ok(typeof status.age_seconds === 'number');
    });
  });

  describe('background precompute', () => {
    it('should start and stop background precompute', () => {
      const skus = [{ id: 'sku_1', title: 'SKU 1', confidence: '🟢' }];

      generator.startBackgroundPrecompute(skus, 1);

      assert.strictEqual(generator.isPrecomputeRunning(), true);

      generator.stopBackgroundPrecompute();

      assert.strictEqual(generator.isPrecomputeRunning(), false);
    });
  });
});
