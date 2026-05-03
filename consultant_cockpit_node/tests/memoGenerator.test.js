// @ts-check
// tests/memoGenerator.test.js — 备忘录生成器测试
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { MemoGenerator } = require('../src/core/memoGenerator');
const { ConsensusChain } = require('../src/core/consensusChain');

describe('MemoGenerator', () => {
  /** @type {MemoGenerator} */
  let generator;
  /** @type {ConsensusChain} */
  let consensusChain;

  beforeEach(() => {
    consensusChain = new ConsensusChain();

    generator = new MemoGenerator({
      consensusChain,
      llmClient: {
        generate: async (prompt) => {
          if (prompt.includes('提取')) {
            return JSON.stringify({
              facts: ['提取的事实1', '提取的事实2'],
              consensuses: ['提取的共识1'],
            });
          }
          if (prompt.includes('结构化')) {
            return JSON.stringify({
              chapters: {
                '问题重构': {
                  '原始诉求': '客户想要增长',
                  '核心问题': '如何实现可持续增长',
                },
                '关键发现': {
                  '战略层面': ['发现1', '发现2'],
                  '商业模式层面': ['发现3'],
                },
              }
            });
          }
          if (prompt.includes('润色')) {
            return '润色后的备忘录内容';
          }
          return '{}';
        }
      },
      clientProfile: {
        显性诉求: '客户希望提升盈利能力',
      }
    });
  });

  describe('extractData', () => {
    it('should extract facts and consensus from chain', () => {
      // 添加测试数据
      consensusChain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: '公司2023年营收5亿元',
        source: 'manual',
        status: 'confirmed'
      });

      consensusChain.addRecord({
        type: 'consensus',
        stage: '商业模式',
        content: '应聚焦高端市场',
        source: 'ai_suggested',
        status: 'confirmed'
      });

      const data = generator.extractData();

      assert.ok(Array.isArray(data.facts));
      assert.ok(Array.isArray(data.consensus));
      assert.strictEqual(data.facts.length, 1);
      assert.strictEqual(data.consensus.length, 1);
    });
  });

  describe('generateStructure', () => {
    it('should generate memo structure with all chapters', () => {
      // 添加测试数据
      consensusChain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: '测试事实',
        source: 'manual',
        status: 'confirmed'
      });

      const structure = generator.generateStructure();

      assert.ok(structure.chapters);
      assert.ok(structure.chapters['问题重构']);
      assert.ok(structure.chapters['关键发现']);
      assert.ok(structure.chapters['初步建议方向']);
      assert.ok(structure.chapters['需要进一步访谈']);
      assert.ok(structure.chapters['建议下一步合作方式']);
    });
  });

  describe('polishChapter', () => {
    it('should return bullets when no LLM client', async () => {
      const genNoLlm = new MemoGenerator({
        consensusChain,
        llmClient: null
      });

      const result = await genNoLlm.polishChapter({
        要点1: '内容1',
        要点2: '内容2'
      });

      assert.ok(result.includes('要点1') || result.includes('内容1'));
    });

    it('should polish with LLM', async () => {
      const result = await generator.polishChapter({
        要点: '测试内容'
      });

      assert.ok(typeof result === 'string');
    });
  });

  describe('generateServiceRecommendation', () => {
    it('should recommend deep diagnosis for high completeness', () => {
      const data = {
        facts: Array(5).fill({ content: '事实' }),
        consensus: Array(3).fill({ content: '共识' }),
        pending: [],
        client_profile: {
          产品线: '智能硬件产品线描述',
          客户群体: '中大型企业客户群体',
          收入结构: '硬件销售为主收入结构',
          毛利结构: '较高毛利结构描述',
          交付情况: '项目制交付情况描述',
          资源分布: '研发为主资源分布',
          战略目标: '成为行业第一战略目标',
          显性诉求: '提升盈利能力诉求描述'
        }
      };

      const recommendation = generator.generateServiceRecommendation(data);

      assert.strictEqual(recommendation['推荐服务包'], '深度诊断服务包');
    });

    it('should recommend preliminary diagnosis for medium completeness', () => {
      const data = {
        facts: Array(3).fill({ content: '事实' }),
        consensus: [],
        pending: [],
        client_profile: {
          产品线: '产品线描述',
          客户群体: '客户群体描述',
          收入结构: '收入结构描述',
          毛利结构: '毛利结构描述'
        }
      };

      const recommendation = generator.generateServiceRecommendation(data);

      assert.strictEqual(recommendation['推荐服务包'], '初步诊断服务包');
    });

    it('should recommend free consultation for low completeness', () => {
      const data = {
        facts: [{ content: '事实' }],
        consensus: [],
        pending: [],
        client_profile: {}
      };

      const recommendation = generator.generateServiceRecommendation(data);

      assert.strictEqual(recommendation['推荐服务包'], '免费初步沟通');
    });
  });

  describe('_formatAsBullets', () => {
    it('should format object as bullet list', () => {
      const result = generator._formatAsBullets({
        key1: 'value1',
        key2: ['item1', 'item2']
      });

      assert.ok(result.includes('key1'));
      assert.ok(result.includes('value1'));
    });

    it('should handle string input', () => {
      const result = generator._formatAsBullets('simple string');
      assert.strictEqual(result, 'simple string');
    });
  });

  describe('_calcProfileCompleteness', () => {
    it('should return 0 for empty profile', () => {
      const completeness = generator._calcProfileCompleteness({});
      assert.strictEqual(completeness, 0);
    });

    it('should calculate completeness for partial profile', () => {
      const completeness = generator._calcProfileCompleteness({
        产品线: '这是一个产品线描述',
        客户群体: '这是客户群体描述'
      });

      assert.ok(completeness > 0 && completeness < 1);
    });
  });
});
