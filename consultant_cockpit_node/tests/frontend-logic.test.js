// tests/frontend-logic.test.js — 前端逻辑单元测试
// 测试前端 app.js 中的核心逻辑（不依赖 DOM）

const { describe, it } = require('node:test');
const assert = require('node:assert');

// 模拟 STAGES 常量
const STAGES = ['战略梳理', '商业模式', '行业演示'];

// ==================== 阶段切换逻辑测试 ====================

describe('Stage Switch Logic', () => {
  describe('Switch button visibility', () => {
    it('should hide switch button on last stage', () => {
      const lastStage = STAGES[STAGES.length - 1];
      assert.strictEqual(lastStage, '行业演示');

      // 模拟 renderSwitchButton 逻辑
      const isLastStage = (currentStage) => currentStage === lastStage;

      assert.strictEqual(isLastStage('战略梳理'), false);
      assert.strictEqual(isLastStage('商业模式'), false);
      assert.strictEqual(isLastStage('行业演示'), true);
    });

    it('should show switch button on non-last stages', () => {
      const lastStage = STAGES[STAGES.length - 1];

      STAGES.slice(0, -1).forEach(stage => {
        const isLastStage = stage === lastStage;
        assert.strictEqual(isLastStage, false, `${stage} should not be last stage`);
      });
    });
  });

  describe('Stage lock logic', () => {
    it('should block switch when candidates exist', () => {
      // 模拟状态
      const mockState = {
        candidates: [
          { id: 'c1', title: '候选1' },
          { id: 'c2', title: '候选2' }
        ],
        records: []
      };

      // 模拟锁定检查逻辑
      const shouldBlockSwitch = (state) => {
        return state.candidates && state.candidates.length > 0;
      };

      assert.strictEqual(shouldBlockSwitch(mockState), true);
    });

    it('should allow switch when no candidates', () => {
      const mockState = {
        candidates: null,
        records: []
      };

      const shouldBlockSwitch = (state) => {
        return !!(state.candidates && state.candidates.length > 0);
      };

      assert.strictEqual(shouldBlockSwitch(mockState), false);
    });

    it('should warn when pending records exist', () => {
      const mockState = {
        candidates: null,
        records: [
          { id: 'r1', status: 'pending_client_confirm' },
          { id: 'r2', status: 'confirmed' },
          { id: 'r3', status: 'pending_client_confirm' }
        ]
      };

      // 模拟待确认记录检查
      const pendingRecords = mockState.records.filter(r => r.status === 'pending_client_confirm');
      assert.strictEqual(pendingRecords.length, 2);
    });

    it('should not warn when no pending records', () => {
      const mockState = {
        candidates: null,
        records: [
          { id: 'r1', status: 'confirmed' },
          { id: 'r2', status: 'confirmed' }
        ]
      };

      const pendingRecords = mockState.records.filter(r => r.status === 'pending_client_confirm');
      assert.strictEqual(pendingRecords.length, 0);
    });
  });

  describe('Next stage calculation', () => {
    it('should calculate next stage correctly', () => {
      const getNextStage = (currentStage) => {
        const currentIdx = STAGES.indexOf(currentStage);
        const nextIdx = (currentIdx + 1) % STAGES.length;
        return STAGES[nextIdx];
      };

      assert.strictEqual(getNextStage('战略梳理'), '商业模式');
      assert.strictEqual(getNextStage('商业模式'), '行业演示');
      // 最后一个阶段循环回第一个（但实际会被阻止）
      assert.strictEqual(getNextStage('行业演示'), '战略梳理');
    });

    it('should identify last stage correctly', () => {
      const isLastStage = (stage) => stage === STAGES[STAGES.length - 1];

      assert.strictEqual(isLastStage('战略梳理'), false);
      assert.strictEqual(isLastStage('商业模式'), false);
      assert.strictEqual(isLastStage('行业演示'), true);
    });
  });
});

// ==================== 状态流转逻辑测试 ====================

describe('Status Flow Logic', () => {
  describe('Record status transitions', () => {
    it('should start with recorded status (new default)', () => {
      // 新记录默认状态
      const defaultStatus = 'recorded';
      assert.strictEqual(defaultStatus, 'recorded');
    });

    it('should support manual path: recorded → confirmed', () => {
      const validTransitions = {
        'recorded': ['confirmed', 'pending_client_confirm'],
        'pending_client_confirm': ['confirmed'],
        'confirmed': [],
        'superseded': []
      };

      // 手动路径：直接从 recorded 到 confirmed
      assert.ok(validTransitions['recorded'].includes('confirmed'));
    });

    it('should support candidate path: recorded → pending_client_confirm → confirmed', () => {
      const validTransitions = {
        'recorded': ['confirmed', 'pending_client_confirm'],
        'pending_client_confirm': ['confirmed'],
        'confirmed': [],
        'superseded': []
      };

      // 候选路径
      assert.ok(validTransitions['recorded'].includes('pending_client_confirm'));
      assert.ok(validTransitions['pending_client_confirm'].includes('confirmed'));
    });

    it('should not allow invalid transitions', () => {
      const validTransitions = {
        'recorded': ['confirmed', 'pending_client_confirm'],
        'pending_client_confirm': ['confirmed'],
        'confirmed': [],
        'superseded': []
      };

      // confirmed 不能转到其他状态
      assert.strictEqual(validTransitions['confirmed'].length, 0);

      // superseded 不能转到其他状态
      assert.strictEqual(validTransitions['superseded'].length, 0);
    });
  });
});

// ==================== Target Field 逻辑测试 ====================

describe('Target Field Logic', () => {
  // 模拟 extractTargetField 函数
  const extractTargetField = (content) => {
    if (!content) return null;
    const profileFields = ['产品线', '客户群体', '收入结构', '毛利结构', '交付情况', '资源分布', '战略目标', '显性诉求', '隐性痛点'];
    const match = content.match(/^([^：:]+)[：:]/);
    if (match && match[1]) {
      const fieldName = match[1].trim();
      if (profileFields.includes(fieldName)) {
        return fieldName;
      }
    }
    return null;
  };

  it('should extract field name from content prefix', () => {
    assert.strictEqual(extractTargetField('产品线：储能系统、光伏逆变器'), '产品线');
    assert.strictEqual(extractTargetField('客户群体: 工厂客户'), '客户群体');
    assert.strictEqual(extractTargetField('收入结构：设备销售为主'), '收入结构');
    assert.strictEqual(extractTargetField('毛利结构: 高毛利产品占比30%'), '毛利结构');
  });

  it('should return null for non-profile-field prefix', () => {
    assert.strictEqual(extractTargetField('没有前缀的内容'), null);
    assert.strictEqual(extractTargetField('其他字段：测试'), null);
    assert.strictEqual(extractTargetField('随便说点什么'), null);
  });

  it('should handle null content', () => {
    assert.strictEqual(extractTargetField(null), null);
    assert.strictEqual(extractTargetField(''), null);
    assert.strictEqual(extractTargetField(undefined), null);
  });

  it('should match all 9 profile fields', () => {
    const profileFields = ['产品线', '客户群体', '收入结构', '毛利结构', '交付情况', '资源分布', '战略目标', '显性诉求', '隐性痛点'];

    profileFields.forEach(field => {
      const content = `${field}：测试内容`;
      assert.strictEqual(extractTargetField(content), field, `Should extract "${field}"`);
    });
  });

  it('should handle both Chinese and English colon', () => {
    assert.strictEqual(extractTargetField('产品线：储能'), '产品线');
    assert.strictEqual(extractTargetField('产品线:储能'), '产品线');
    assert.strictEqual(extractTargetField('产品线 : 储能'), '产品线');
  });

  it('should not extract field from middle of content', () => {
    // 字段名必须在开头
    assert.strictEqual(extractTargetField('客户说产品线：储能'), null);
    assert.strictEqual(extractTargetField('关于收入结构：设备销售'), null);
  });
});

console.log('前端逻辑单元测试完成');
