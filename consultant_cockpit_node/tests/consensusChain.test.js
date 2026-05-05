// @ts-check
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ConsensusChain } = require('../src/core/consensusChain');

describe('ConsensusChain', () => {
  /** @type {ConsensusChain} */
  let chain;

  beforeEach(() => {
    chain = new ConsensusChain();
  });

  describe('addRecord', () => {
    it('should add a fact record with auto-generated id and timestamp', () => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: '客户主营业务为储能系统集成',
        source: 'manual'
      });

      assert.ok(record.id.startsWith('record_'));
      assert.ok(record.timestamp);
      assert.strictEqual(record.type, 'fact');
      assert.strictEqual(record.stage, '战略梳理');
      assert.strictEqual(record.content, '客户主营业务为储能系统集成');
      assert.strictEqual(record.source, 'manual');
      // 重构后默认状态为 'recorded'
      assert.strictEqual(record.status, 'recorded');
      assert.deepStrictEqual(record.evidence_sku, []);
      assert.strictEqual(record.confidence, null);
      assert.strictEqual(record.replaces, null);
      assert.strictEqual(record.superseded_by, null);
      // 新增 target_field 字段
      assert.strictEqual(record.target_field, null);
    });

    it('should add a consensus record with recommendation', () => {
      const record = chain.addRecord({
        type: 'consensus',
        stage: '商业模式',
        content: '客户需要优化收入结构',
        source: 'ai_suggested',
        recommendation: '建议增加高毛利产品线'
      });

      assert.strictEqual(record.type, 'consensus');
      assert.strictEqual(record.recommendation, '建议增加高毛利产品线');
    });

    it('should add record with target_field', () => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: '产品线：储能系统、光伏逆变器',
        source: 'manual',
        target_field: '产品线'
      });

      assert.strictEqual(record.target_field, '产品线');
    });

    it('should emit change event on add', (t, done) => {
      chain.on('change', (payload) => {
        assert.strictEqual(payload.type, 'add');
        assert.strictEqual(payload.record.content, 'test content');
        done();
      });

      chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test content',
        source: 'manual'
      });
    });

    it('should use provided evidence_sku array', () => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual',
        evidence_sku: ['sku_1', 'sku_2']
      });

      assert.deepStrictEqual(record.evidence_sku, ['sku_1', 'sku_2']);
    });

    it('should use provided status if specified', () => {
      const record = chain.addRecord({
        type: 'consensus',
        stage: '战略梳理',
        content: 'test',
        source: 'ai_suggested',
        status: 'pending_client_confirm'
      });

      assert.strictEqual(record.status, 'pending_client_confirm');
    });
  });

  describe('getRecord', () => {
    it('should return record by id', () => {
      const added = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual'
      });

      const found = chain.getRecord(added.id);
      assert.strictEqual(found?.id, added.id);
      assert.strictEqual(found?.content, 'test');
    });

    it('should return null for non-existent record', () => {
      const found = chain.getRecord('non_existent_id');
      assert.strictEqual(found, null);
    });
  });

  describe('confirmRecord', () => {
    it('should change status to confirmed from recorded', () => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual'
      });

      // 默认状态为 recorded
      assert.strictEqual(record.status, 'recorded');

      chain.confirmRecord(record.id);

      const confirmed = chain.getRecord(record.id);
      assert.strictEqual(confirmed?.status, 'confirmed');
    });

    it('should change status to confirmed from pending_client_confirm', () => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual',
        status: 'pending_client_confirm'
      });

      chain.confirmRecord(record.id);

      const confirmed = chain.getRecord(record.id);
      assert.strictEqual(confirmed?.status, 'confirmed');
    });

    it('should throw error for non-existent record', () => {
      assert.throws(
        () => chain.confirmRecord('non_existent'),
        /找不到记录: non_existent/
      );
    });

    it('should throw error for invalid status', () => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual',
        status: 'confirmed'
      });

      assert.throws(
        () => chain.confirmRecord(record.id),
        /记录状态不正确/
      );
    });

    it('should emit change event on confirm', (t, done) => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual'
      });

      chain.on('change', (payload) => {
        if (payload.type === 'confirm') {
          assert.strictEqual(payload.record.id, record.id);
          done();
        }
      });

      chain.confirmRecord(record.id);
    });
  });

  describe('setCandidateRecordPending', () => {
    it('should change status from recorded to pending_client_confirm', () => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual'
      });

      // 默认状态为 recorded
      assert.strictEqual(record.status, 'recorded');

      chain.setCandidateRecordPending(record.id);

      const pending = chain.getRecord(record.id);
      assert.strictEqual(pending?.status, 'pending_client_confirm');
    });

    it('should throw error for non-existent record', () => {
      assert.throws(
        () => chain.setCandidateRecordPending('non_existent'),
        /找不到记录: non_existent/
      );
    });

    it('should throw error if status is not recorded', () => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual',
        status: 'pending_client_confirm'
      });

      assert.throws(
        () => chain.setCandidateRecordPending(record.id),
        /记录状态不正确.*应为 recorded/
      );
    });

    it('should emit change event with type pending', (t, done) => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual'
      });

      chain.on('change', (payload) => {
        if (payload.type === 'pending') {
          assert.strictEqual(payload.record.id, record.id);
          assert.strictEqual(payload.record.status, 'pending_client_confirm');
          done();
        }
      });

      chain.setCandidateRecordPending(record.id);
    });
  });

  describe('correctRecord', () => {
    it('should create new record and mark original as superseded', () => {
      const original = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: '原始内容',
        source: 'manual'
      });

      const corrected = chain.correctRecord(original.id, '修正后的内容');

      // 检查新记录
      assert.ok(corrected.id.includes('_corr_'));
      assert.strictEqual(corrected.content, '修正后的内容');
      assert.strictEqual(corrected.source, 'manual_correction');
      assert.strictEqual(corrected.status, 'confirmed');
      assert.strictEqual(corrected.replaces, original.id);

      // 检查原记录被标记为 superseded
      const originalAfter = chain.getRecord(original.id);
      assert.strictEqual(originalAfter?.status, 'superseded');
      assert.strictEqual(originalAfter?.superseded_by, corrected.id);
    });

    it('should preserve original evidence_sku in corrected record', () => {
      const original = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: '原始内容',
        source: 'manual',
        evidence_sku: ['sku_1', 'sku_2']
      });

      const corrected = chain.correctRecord(original.id, '修正后的内容');

      assert.deepStrictEqual(corrected.evidence_sku, ['sku_1', 'sku_2']);
    });

    it('should throw error for non-existent record', () => {
      assert.throws(
        () => chain.correctRecord('non_existent', 'new content'),
        /找不到记录: non_existent/
      );
    });

    it('should emit invalidate-cache event', (t, done) => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual'
      });

      chain.on('invalidate-cache', (payload) => {
        // 修正：事件使用 source 属性标识来源（与 candidateGen.js 对齐）
        assert.strictEqual(payload.source, 'manual_correction');
        assert.strictEqual(payload.originalId, record.id);
        done();
      });

      chain.correctRecord(record.id, 'new content');
    });

    it('should emit change event with correct type', (t, done) => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual'
      });

      chain.on('change', (payload) => {
        if (payload.type === 'correct') {
          assert.strictEqual(payload.record.content, 'new content');
          assert.strictEqual(payload.originalRecord.id, record.id);
          done();
        }
      });

      chain.correctRecord(record.id, 'new content');
    });

    it('should support custom source parameter', () => {
      const original = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: '原始内容',
        source: 'manual'
      });

      const corrected = chain.correctRecord(original.id, '修正后的内容', 'candidate_selected');

      assert.strictEqual(corrected.source, 'candidate_selected');
    });
  });

  describe('getConfirmedFacts', () => {
    it('should return only confirmed facts', () => {
      chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'fact1',
        source: 'manual',
        status: 'confirmed'
      });

      chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'fact2',
        source: 'manual',
        status: 'recorded'
      });

      chain.addRecord({
        type: 'consensus',
        stage: '战略梳理',
        content: 'consensus1',
        source: 'manual',
        status: 'confirmed'
      });

      const facts = chain.getConfirmedFacts();
      assert.strictEqual(facts.length, 1);
      assert.strictEqual(facts[0].content, 'fact1');
    });

    it('should exclude superseded records', () => {
      const original = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'original fact',
        source: 'manual',
        status: 'confirmed'
      });

      chain.correctRecord(original.id, 'corrected fact');

      const facts = chain.getConfirmedFacts();
      assert.strictEqual(facts.length, 1);
      assert.strictEqual(facts[0].content, 'corrected fact');
    });
  });

  describe('getConfirmedConsensus', () => {
    it('should return only confirmed consensus', () => {
      chain.addRecord({
        type: 'consensus',
        stage: '战略梳理',
        content: 'consensus1',
        source: 'manual',
        status: 'confirmed'
      });

      chain.addRecord({
        type: 'consensus',
        stage: '战略梳理',
        content: 'consensus2',
        source: 'manual',
        status: 'pending_client_confirm'
      });

      chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'fact1',
        source: 'manual',
        status: 'confirmed'
      });

      const consensus = chain.getConfirmedConsensus();
      assert.strictEqual(consensus.length, 1);
      assert.strictEqual(consensus[0].content, 'consensus1');
    });
  });

  describe('getPendingConsensus', () => {
    it('should return only pending consensus', () => {
      chain.addRecord({
        type: 'consensus',
        stage: '战略梳理',
        content: 'pending1',
        source: 'ai_suggested',
        status: 'pending_client_confirm'
      });

      chain.addRecord({
        type: 'consensus',
        stage: '战略梳理',
        content: 'confirmed1',
        source: 'manual',
        status: 'confirmed'
      });

      const pending = chain.getPendingConsensus();
      assert.strictEqual(pending.length, 1);
      assert.strictEqual(pending[0].content, 'pending1');
    });
  });

  describe('getCorrectionHistory', () => {
    it('should return empty array for record without corrections', () => {
      const record = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual'
      });

      const history = chain.getCorrectionHistory(record.id);
      assert.deepStrictEqual(history, []);
    });

    it('should return correction history in chronological order', () => {
      const original = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'original',
        source: 'manual'
      });

      const correction1 = chain.correctRecord(original.id, 'correction1');
      const correction2 = chain.correctRecord(correction1.id, 'correction2');

      const history = chain.getCorrectionHistory(original.id);

      assert.strictEqual(history.length, 2);
      assert.strictEqual(history[0].content, 'correction1');
      assert.strictEqual(history[1].content, 'correction2');
    });

    it('should return history starting from middle of chain', () => {
      const original = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'original',
        source: 'manual'
      });

      const correction1 = chain.correctRecord(original.id, 'correction1');
      chain.correctRecord(correction1.id, 'correction2');

      const history = chain.getCorrectionHistory(correction1.id);

      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].content, 'correction2');
    });
  });

  describe('getActiveRecords', () => {
    it('should return all non-superseded records', () => {
      const record1 = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'fact1',
        source: 'manual'
      });

      chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'fact2',
        source: 'manual'
      });

      chain.correctRecord(record1.id, 'corrected fact1');

      const active = chain.getActiveRecords();
      assert.strictEqual(active.length, 2);
      assert.ok(active.every(r => r.status !== 'superseded'));
    });
  });

  describe('exportRecords / importRecords', () => {
    it('should export and import records correctly', () => {
      const record1 = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'fact1',
        source: 'manual'
      });

      const record2 = chain.addRecord({
        type: 'consensus',
        stage: '商业模式',
        content: 'consensus1',
        source: 'ai_suggested'
      });

      const exported = chain.exportRecords();
      assert.strictEqual(exported.length, 2);

      // 创建新链并导入
      const newChain = new ConsensusChain();
      newChain.importRecords(exported);

      const imported = newChain.exportRecords();
      assert.strictEqual(imported.length, 2);
      assert.strictEqual(imported[0].content, 'fact1');
      assert.strictEqual(imported[1].content, 'consensus1');
    });

    it('should emit invalidate-cache event on import', (t, done) => {
      const records = [
        {
          id: 'record_test',
          timestamp: new Date().toISOString(),
          type: 'fact',
          stage: '战略梳理',
          content: 'imported fact',
          source: 'manual',
          evidence_sku: [],
          status: 'confirmed',
          confidence: null,
          replaces: null,
          superseded_by: null,
          feishu_record_id: null,
          recommendation: null
        }
      ];

      chain.on('invalidate-cache', (payload) => {
        assert.strictEqual(payload.reason, 'records_imported');
        done();
      });

      chain.importRecords(records);
    });

    it('should deep clone records on export', () => {
      chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'fact1',
        source: 'manual'
      });

      const exported = chain.exportRecords();
      exported[0].content = 'modified';

      const originalRecords = chain.exportRecords();
      assert.strictEqual(originalRecords[0].content, 'fact1');
    });
  });

  describe('EventEmitter integration', () => {
    it('should be an instance of EventEmitter', () => {
      assert.ok(chain instanceof require('events').EventEmitter);
    });

    it('should support multiple listeners', (t, done) => {
      let callCount = 0;

      chain.on('change', () => { callCount++; });
      chain.on('change', () => {
        callCount++;
        if (callCount === 2) done();
      });

      chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual'
      });
    });
  });

  describe('Feishu client integration', () => {
    it('should not throw when feishuClient is not provided', () => {
      const chainWithoutFeishu = new ConsensusChain();

      assert.doesNotThrow(() => {
        chainWithoutFeishu.addRecord({
          type: 'fact',
          stage: '战略梳理',
          content: 'test',
          source: 'manual'
        });
      });
    });

    it('should call feishuClient.createConsensusRecord when provided', async () => {
      let syncCalled = false;
      const mockFeishuClient = {
        createConsensusRecord: async () => {
          syncCalled = true;
        }
      };

      const chainWithFeishu = new ConsensusChain({ feishuClient: mockFeishuClient });

      chainWithFeishu.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'test',
        source: 'manual'
      }, true); // syncToFeishu = true

      // 等待异步操作
      await new Promise(resolve => setTimeout(resolve, 10));

      assert.strictEqual(syncCalled, true);
    });

    it('should handle feishu sync failure gracefully', async () => {
      const mockFeishuClient = {
        createConsensusRecord: async () => {
          throw new Error('Feishu API error');
        }
      };

      const chainWithFeishu = new ConsensusChain({ feishuClient: mockFeishuClient });

      // 不应该抛出异常
      assert.doesNotThrow(() => {
        chainWithFeishu.addRecord({
          type: 'fact',
          stage: '战略梳理',
          content: 'test',
          source: 'manual'
        }, true); // syncToFeishu = true
      });

      // 等待异步操作
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  });

  describe('ID generation with crypto.randomUUID', () => {
    it('should generate unique IDs for each record', () => {
      const ids = new Set();

      for (let i = 0; i < 100; i++) {
        const record = chain.addRecord({
          type: 'fact',
          stage: '战略梳理',
          content: `test ${i}`,
          source: 'manual'
        });
        ids.add(record.id);
      }

      assert.strictEqual(ids.size, 100);
    });

    it('should generate unique correction IDs', () => {
      const original = chain.addRecord({
        type: 'fact',
        stage: '战略梳理',
        content: 'original',
        source: 'manual'
      });

      const correctionIds = new Set();

      for (let i = 0; i < 10; i++) {
        const current = chain.getRecord(original.id);
        const corrected = chain.correctRecord(current?.superseded_by || original.id, `correction ${i}`);
        correctionIds.add(corrected.id);
      }

      assert.strictEqual(correctionIds.size, 10);
    });
  });
});
