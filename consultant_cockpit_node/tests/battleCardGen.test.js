// @ts-check
// tests/battleCardGen.test.js — 作战卡生成器测试
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { BattleCardGenerator, InsufficientSkuError } = require('../src/core/battleCardGen');

describe('BattleCardGenerator', () => {
  /** @type {BattleCardGenerator} */
  let generator;

  beforeEach(() => {
    generator = new BattleCardGenerator({
      llmClient: {
        chat: async (prompt) => {
          if (prompt.includes('假设')) {
            return JSON.stringify({
              hypotheses: [
                { hypothesis: '假设1', evidence: ['证据1'], confidence: 'high' },
                { hypothesis: '假设2', evidence: ['证据2'], confidence: 'medium' },
              ]
            });
          }
          if (prompt.includes('问题')) {
            return JSON.stringify({
              questions: [
                { question: '问题1', purpose: '了解背景' },
                { question: '问题2', purpose: '验证假设' },
              ]
            });
          }
          return '{}';
        }
      }
    });
  });

  describe('generate', () => {
    it('should generate hypothesis mode card when completeness >= 60%', async () => {
      const profile = {
        company: '测试公司',
        fields: {
          客户公司名: '测试公司',
          战略目标: '成为行业第一',
        }
      };

      const records = [
        { type: 'fact', content: '事实1', status: 'confirmed' },
        { type: 'fact', content: '事实2', status: 'confirmed' },
        { type: 'consensus', content: '共识1', status: 'confirmed' },
      ];

      const skus = [
        { id: 'sku_1', title: 'SKU 1', confidence: '🟢' },
        { id: 'sku_2', title: 'SKU 2', confidence: '🟢' },
        { id: 'sku_3', title: 'SKU 3', confidence: '🟡' },
        { id: 'sku_4', title: 'SKU 4', confidence: '🟢' },
        { id: 'sku_5', title: 'SKU 5', confidence: '🟢' },
      ];

      const result = await generator.generate(profile, records, skus, {
        consultant: '顾问A',
        completeness: 75,
      });

      assert.strictEqual(result.mode, 'hypothesis');
      assert.strictEqual(result.company, '测试公司');
      assert.ok(result.content);
      assert.ok(result.completeness >= 60);
    });

    it('should generate info_building mode card when completeness < 60%', async () => {
      const profile = {
        company: '测试公司',
        fields: {}
      };

      const records = [
        { type: 'fact', content: '事实1', status: 'confirmed' },
      ];

      const skus = [
        { id: 'sku_1', title: 'SKU 1', confidence: '🟢' },
        { id: 'sku_2', title: 'SKU 2', confidence: '🟢' },
        { id: 'sku_3', title: 'SKU 3', confidence: '🟡' },
        { id: 'sku_4', title: 'SKU 4', confidence: '🟢' },
        { id: 'sku_5', title: 'SKU 5', confidence: '🟢' },
      ];

      const result = await generator.generate(profile, records, skus, {
        consultant: '顾问A',
        completeness: 40,
      });

      assert.strictEqual(result.mode, 'info_building');
      assert.ok(result.content.questions);
    });
  });

  describe('SKU validation', () => {
    it('should throw InsufficientSkuError when SKU count < 5', async () => {
      const profile = { company: '测试公司', fields: {} };
      const records = [];
      const skus = [
        { id: 'sku_1', title: 'SKU 1' },
        { id: 'sku_2', title: 'SKU 2' },
      ];

      await assert.rejects(
        async () => generator.generate(profile, records, skus),
        InsufficientSkuError
      );
    });

    it('should include current count in error message', async () => {
      const profile = { company: '测试公司', fields: {} };
      const records = [];
      const skus = [{ id: 'sku_1' }, { id: 'sku_2' }];

      try {
        await generator.generate(profile, records, skus);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof InsufficientSkuError);
        assert.ok(error.message.includes('2'));
        assert.ok(error.message.includes('5'));
      }
    });
  });

  describe('hypothesis mode', () => {
    it('should generate hypotheses with evidence', async () => {
      const profile = { company: '测试公司', fields: {} };
      const records = [
        { type: 'fact', content: '事实', status: 'confirmed' },
      ];
      const skus = Array(5).fill(null).map((_, i) => ({ id: `sku_${i}` }));

      const result = await generator._generateHypothesisMode(profile, records, skus);

      assert.ok(Array.isArray(result.hypotheses));
      assert.ok(result.hypotheses.length > 0);
      assert.ok(result.hypotheses[0].hypothesis);
      assert.ok(result.hypotheses[0].evidence);
    });
  });

  describe('info_building mode', () => {
    it('should generate questions for information gathering', async () => {
      const profile = { company: '测试公司', fields: {} };
      const records = [
        { type: 'fact', content: '事实', status: 'confirmed' },
      ];
      const skus = Array(5).fill(null).map((_, i) => ({ id: `sku_${i}` }));

      const result = await generator._generateInfoBuildingMode(profile, records, skus);

      assert.ok(Array.isArray(result.questions));
      assert.ok(result.questions.length > 0);
      assert.ok(result.questions[0].question);
      assert.ok(result.questions[0].purpose);
    });
  });

  describe('completeness calculation', () => {
    it('should calculate completeness from profile fields', () => {
      const profile = {
        fields: {
          客户公司名: '测试公司',
          产品线: 'SaaS',
          战略目标: '上市',
          // 缺少其他字段
        }
      };

      const completeness = generator._calculateCompleteness(profile);

      assert.ok(completeness >= 0 && completeness <= 100);
    });

    it('should return 0 for empty profile', () => {
      const profile = { fields: {} };

      const completeness = generator._calculateCompleteness(profile);

      assert.strictEqual(completeness, 0);
    });

    it('should return 100 for complete profile', () => {
      const profile = {
        fields: {
          客户公司名: '公司',
          产品线: '产品',
          客户群体: '群体',
          收入结构: '结构',
          毛利结构: '结构',
          交付情况: '情况',
          资源分布: '分布',
          战略目标: '目标',
          显性诉求: '诉求',
        }
      };

      const completeness = generator._calculateCompleteness(profile);

      assert.strictEqual(completeness, 100);
    });
  });

  describe('date formatting', () => {
    it('should include formatted date in card', async () => {
      const profile = { company: '测试公司', fields: {} };
      const records = [];
      const skus = Array(5).fill(null).map((_, i) => ({ id: `sku_${i}` }));

      const result = await generator.generate(profile, records, skus);

      assert.ok(result.date);
      // 验证日期格式 YYYY-MM-DD
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(result.date));
    });
  });
});

describe('InsufficientSkuError', () => {
  it('should be an instance of Error', () => {
    const error = new InsufficientSkuError(3, 5);
    assert.ok(error instanceof Error);
  });

  it('should include current and required count', () => {
    const error = new InsufficientSkuError(3, 5);
    assert.strictEqual(error.currentCount, 3);
    assert.strictEqual(error.requiredCount, 5);
  });

  it('should have descriptive message', () => {
    const error = new InsufficientSkuError(3, 5);
    assert.ok(error.message.includes('3'));
    assert.ok(error.message.includes('5'));
  });
});
