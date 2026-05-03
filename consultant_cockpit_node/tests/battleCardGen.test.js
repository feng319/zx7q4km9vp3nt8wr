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
        generate: async (prompt, options) => {
          if (prompt.includes('假设')) {
            return '基于行业经验，客户的核心问题很可能是战略定位不够清晰。';
          }
          if (prompt.includes('问题')) {
            return '1. 您现在的核心业务是什么？\n2. 未来3年的战略目标是什么？\n3. 目前最大的挑战是什么？';
          }
          return '';
        }
      }
    });
  });

  describe('generate', () => {
    it('should generate hypothesis mode card when completeness >= 60%', async () => {
      // 使用 feishuClient 模拟高完整度档案
      const genWithFeishu = new BattleCardGenerator({
        feishuClient: {
          getClientProfile: async () => ({
            record_id: 'rec_001',
            fields: {
              '客户公司名': '测试公司',
              '产品线': '智能硬件/软件服务',
              '客户群体': '中大型企业',
              '收入结构': '硬件销售60%+服务40%',
              '毛利结构': '硬件30%+服务70%',
              '交付情况': '项目制交付',
              '资源分布': '研发40%+销售30%+交付30%',
              '战略目标': '成为行业第一',
              '显性诉求': '希望提升盈利能力',
              '隐性痛点': '竞争压力大'
            }
          }),
          calcCompleteness: () => 0.75
        },
        llmClient: {
          generate: async () => '基于行业经验，客户的核心问题很可能是战略定位不够清晰。'
        },
        knowledgeRetriever: {
          recallByKeywords: () => Array(10).fill(null).map((_, i) => ({
            id: `sku_${i}`,
            title: `SKU ${i}`,
            summary: `案例摘要 ${i}`,
            confidence: i % 2 === 0 ? '🟢' : '🟡',
            stage: '战略梳理'
          }))
        }
      });

      const result = await genWithFeishu.generate('测试公司', '顾问A');

      assert.strictEqual(result.mode, 'hypothesis');
      assert.strictEqual(result.company, '测试公司');
      assert.ok(result.content);
    });

    it('should generate info_building mode card when completeness < 60%', async () => {
      const genWithFeishu = new BattleCardGenerator({
        feishuClient: {
          getClientProfile: async () => ({
            record_id: 'rec_001',
            fields: {
              '客户公司名': '测试公司'
              // 缺少其他字段，完整度低
            }
          }),
          calcCompleteness: () => 0.3
        },
        llmClient: {
          generate: async () => '测试响应'
        },
        knowledgeRetriever: {
          recallByKeywords: () => Array(10).fill(null).map((_, i) => ({
            id: `sku_${i}`,
            title: `SKU ${i}`,
            summary: `案例摘要 ${i}`,
            confidence: '🟢',
            stage: '战略梳理'
          }))
        }
      });

      const result = await genWithFeishu.generate('测试公司', '顾问A');

      assert.strictEqual(result.mode, 'info_building');
      assert.ok(result.content.missing_fields);
    });
  });

  describe('SKU validation', () => {
    it('should throw InsufficientSkuError when SKU count < 6', async () => {
      const genWithLowSku = new BattleCardGenerator({
        feishuClient: {
          getClientProfile: async () => ({
            record_id: 'rec_001',
            fields: { '客户公司名': '测试公司', '产品线': '测试产品线内容' }
          }),
          calcCompleteness: () => 0.75
        },
        llmClient: { generate: async () => '' },
        knowledgeRetriever: {
          recallByKeywords: () => [
            { id: 'sku_1', title: 'SKU 1', summary: '摘要', confidence: '🟢' },
            { id: 'sku_2', title: 'SKU 2', summary: '摘要', confidence: '🟡' }
          ]
        }
      });

      await assert.rejects(
        async () => genWithLowSku.generate('测试公司'),
        InsufficientSkuError
      );
    });

    it('should include current count in error message', async () => {
      const genWithLowSku = new BattleCardGenerator({
        feishuClient: {
          getClientProfile: async () => ({
            record_id: 'rec_001',
            fields: { '客户公司名': '测试公司' }
          }),
          calcCompleteness: () => 0.75
        },
        llmClient: { generate: async () => '' },
        knowledgeRetriever: {
          recallByKeywords: () => [
            { id: 'sku_1', title: 'SKU 1', summary: '', confidence: '🟢' },
            { id: 'sku_2', title: 'SKU 2', summary: '', confidence: '🟡' }
          ]
        }
      });

      try {
        await genWithLowSku.generate('测试公司');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof InsufficientSkuError);
        assert.ok(error.message.includes('2'));
        assert.ok(error.message.includes('6'));
      }
    });
  });

  describe('_calcDefaultCompleteness', () => {
    it('should calculate completeness from profile fields', () => {
      const profile = {
        fields: {
          '客户公司名': '测试公司',
          '产品线': 'SaaS软件服务产品线',
          '战略目标': '成为行业第一的目标',
        }
      };

      const completeness = generator._calcDefaultCompleteness(profile);

      assert.ok(completeness >= 0 && completeness <= 1);
    });

    it('should return 0 for empty profile', () => {
      const profile = { fields: {} };
      const completeness = generator._calcDefaultCompleteness(profile);
      assert.strictEqual(completeness, 0);
    });
  });

  describe('_getMockSkus', () => {
    it('should return mock SKUs', () => {
      const skus = generator._getMockSkus(5);

      assert.strictEqual(skus.length, 5);
      assert.ok(skus.every(sku => sku.id && sku.title));
    });
  });

  describe('renderToWord', () => {
    it('should generate Word document buffer', async () => {
      const battleCard = {
        company: '测试公司',
        date: '2026-05-03',
        consultant: '顾问A',
        mode: 'hypothesis',
        completeness: 0.75,
        content: {
          diagnosis_hypothesis: '测试假设',
          strategy_questions: '1. 问题1\n2. 问题2',
          business_questions: '1. 问题1\n2. 问题2',
          demo_scripts: 'A. 案例1\nB. 案例2',
          risk_responses: '风险话术'
        }
      };

      const buffer = await generator.renderToWord(battleCard);

      assert.ok(Buffer.isBuffer(buffer));
      // 验证 ZIP 文件头（docx 是 ZIP 格式）
      assert.strictEqual(buffer[0], 0x50); // 'P'
      assert.strictEqual(buffer[1], 0x4B); // 'K'
    });
  });
});

describe('InsufficientSkuError', () => {
  it('should be an instance of Error', () => {
    const error = new InsufficientSkuError('SKU不足');
    assert.ok(error instanceof Error);
  });

  it('should have correct name', () => {
    const error = new InsufficientSkuError('SKU不足');
    assert.strictEqual(error.name, 'InsufficientSkuError');
  });
});
