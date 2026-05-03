// @ts-check
// tests/memoGenerator.test.js — 备忘录生成器测试
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { MemoGenerator } = require('../src/core/memoGenerator');

describe('MemoGenerator', () => {
  /** @type {MemoGenerator} */
  let generator;

  beforeEach(() => {
    generator = new MemoGenerator({
      llmClient: {
        chat: async (prompt) => {
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
      }
    });
  });

  describe('generate', () => {
    it('should generate memo with three layers', async () => {
      const records = [
        { type: 'fact', content: '事实内容', status: 'confirmed' },
        { type: 'consensus', content: '共识内容', status: 'confirmed' },
      ];

      const result = await generator.generate(records, {
        company: '测试公司',
        date: '2026-05-03',
      });

      assert.ok(result.chapters);
      assert.ok(result.chapters['问题重构']);
    });
  });

  describe('extract layer', () => {
    it('should extract facts and consensuses from records', async () => {
      const records = [
        { type: 'fact', content: '事实1' },
        { type: 'fact', content: '事实2' },
        { type: 'consensus', content: '共识1' },
      ];

      const extracted = await generator._extractLayer(records);

      assert.ok(Array.isArray(extracted.facts));
      assert.ok(Array.isArray(extracted.consensuses));
    });
  });

  describe('structure layer', () => {
    it('should structure extracted content into chapters', async () => {
      const extracted = {
        facts: ['事实1', '事实2'],
        consensuses: ['共识1'],
      };

      const structured = await generator._structureLayer(extracted, {
        company: '测试公司',
      });

      assert.ok(structured.chapters);
      assert.ok(structured.chapters['问题重构']);
      assert.ok(structured.chapters['关键发现']);
    });
  });

  describe('polish layer', () => {
    it('should polish structured content', async () => {
      const structured = {
        chapters: {
          '问题重构': {
            '原始诉求': '诉求',
          }
        }
      };

      const polished = await generator._polishLayer(structured);

      assert.ok(typeof polished === 'string');
    });
  });

  describe('generateWord', () => {
    it('should generate Word document', async () => {
      const memo = {
        chapters: {
          '问题重构': {
            '原始诉求': '客户诉求',
            '核心问题': '核心问题',
          },
          '关键发现': {
            '战略层面': ['发现1', '发现2'],
          },
        }
      };

      const buffer = await generator.generateWord(memo, {
        title: '测试备忘录',
      });

      assert.ok(Buffer.isBuffer(buffer));
      // 验证 ZIP 文件头（docx 是 ZIP 格式）
      assert.strictEqual(buffer[0], 0x50); // 'P'
      assert.strictEqual(buffer[1], 0x4B); // 'K'
    });
  });

  describe('chapter validation', () => {
    it('should include all required chapters', async () => {
      const records = [
        { type: 'fact', content: '事实' },
      ];

      const result = await generator.generate(records);

      const requiredChapters = [
        '问题重构',
        '关键发现',
        '初步建议方向',
        '需要进一步访谈',
        '建议下一步合作方式',
      ];

      for (const chapter of requiredChapters) {
        assert.ok(result.chapters[chapter], `Missing chapter: ${chapter}`);
      }
    });
  });

  describe('error handling', () => {
    it('should handle LLM failure gracefully', async () => {
      const failingGenerator = new MemoGenerator({
        llmClient: {
          chat: async () => { throw new Error('LLM error'); }
        }
      });

      await assert.rejects(
        async () => failingGenerator.generate([{ type: 'fact', content: 'test' }]),
        /LLM error/
      );
    });
  });
});
