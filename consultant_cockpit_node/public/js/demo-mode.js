/**
 * 演示模式模块 - Demo Mode Module
 *
 * 功能：
 * - 三级敏感度分区（隐藏/替换/保留）
 * - F11 和 Ctrl+Shift+D 快捷键
 * - 屏幕右上角状态徽章
 * - 添加记录后不退出演示模式
 * - 响应时间 < 0.1 秒无闪烁
 */

class DemoMode {
  constructor() {
    // 0=关闭, 1=隐藏, 2=替换, 3=保留
    this.level = 0;
    this.badge = null;
    this.levels = {
      0: { name: '关闭', class: '' },
      1: { name: '隐藏', class: 'demo-level-1' },
      2: { name: '替换', class: 'demo-level-2' },
      3: { name: '保留', class: 'demo-level-3' }
    };

    // 敏感字段配置
    this.sensitiveFields = {
      // 第一级：完全隐藏
      hide: [
        '.client-name', '.company-info', '.financial-data',
        '.contact-info', '.personal-data', '[data-demo="hide"]'
      ],
      // 第二级：替换为占位符
      replace: [
        '.project-name', '.business-detail', '.strategy-info',
        '[data-demo="replace"]'
      ],
      // 第三级：保留显示
      retain: [
        '.public-info', '.general-stats', '[data-demo="retain"]'
      ]
    };

    // 替换文本模板
    this.replaceTexts = {
      '.project-name': '[项目名称]',
      '.business-detail': '[业务详情]',
      '.strategy-info': '[战略信息]',
      'default': '[敏感信息]'
    };

    this.init();
  }

  init() {
    // 从 localStorage 恢复状态
    const savedLevel = localStorage.getItem('demoMode');
    if (savedLevel !== null) {
      this.level = parseInt(savedLevel, 10);
      this.applyLevel();
    }

    // 创建状态徽章
    this.createBadge();

    // 绑定快捷键
    this.bindShortcuts();

    console.log('DemoMode initialized, level:', this.level);
  }

  /**
   * 创建右上角状态徽章
   */
  createBadge() {
    // 检查是否已存在
    if (document.getElementById('demo-mode-badge')) {
      this.badge = document.getElementById('demo-mode-badge');
      return;
    }

    this.badge = document.createElement('div');
    this.badge.id = 'demo-mode-badge';
    this.badge.className = 'demo-badge';
    this.badge.style.display = 'none';

    document.body.appendChild(this.badge);

    // 点击徽章切换模式
    this.badge.addEventListener('click', () => this.toggle());

    this.updateBadge();
  }

  /**
   * 更新徽章显示
   */
  updateBadge() {
    if (!this.badge) return;

    if (this.level === 0) {
      this.badge.style.display = 'none';
      this.badge.textContent = '';
    } else {
      this.badge.style.display = 'flex';
      const levelInfo = this.levels[this.level];
      this.badge.textContent = `演示模式: ${levelInfo.name}`;
      this.badge.className = `demo-badge demo-level-${this.level}`;
    }
  }

  /**
   * 绑定快捷键
   */
  bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      // F11 切换演示模式
      if (e.key === 'F11') {
        e.preventDefault();
        this.toggle();
        return;
      }

      // Ctrl+Shift+D 切换演示模式
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        this.toggle();
        return;
      }

      // 数字键 1-3 快速切换级别
      if (e.altKey && e.key >= '1' && e.key <= '3') {
        e.preventDefault();
        this.setLevel(parseInt(e.key, 10));
        return;
      }

      // Alt+0 关闭演示模式
      if (e.altKey && e.key === '0') {
        e.preventDefault();
        this.setLevel(0);
        return;
      }
    });
  }

  /**
   * 切换演示模式级别
   */
  toggle() {
    this.level = (this.level + 1) % 4;
    this.applyLevel();
    this.updateBadge();
    this.persist();

    // 触发事件供其他模块监听
    window.dispatchEvent(new CustomEvent('demoModeChange', {
      detail: { level: this.level }
    }));

    console.log('Demo mode toggled to level:', this.level);
  }

  /**
   * 设置指定级别
   * @param {number} level - 0-3
   */
  setLevel(level) {
    if (level < 0 || level > 3) return;

    this.level = level;
    this.applyLevel();
    this.updateBadge();
    this.persist();

    window.dispatchEvent(new CustomEvent('demoModeChange', {
      detail: { level: this.level }
    }));
  }

  /**
   * 应用当前级别样式
   */
  applyLevel() {
    // 移除所有演示模式类
    document.body.classList.remove('demo-level-1', 'demo-level-2', 'demo-level-3');

    // 添加当前级别类
    if (this.level > 0) {
      document.body.classList.add(`demo-level-${this.level}`);
    }

    // 根据级别处理敏感内容
    this.processSensitiveContent();
  }

  /**
   * 处理敏感内容
   */
  processSensitiveContent() {
    // 重置所有替换的内容
    document.querySelectorAll('[data-demo-replaced]').forEach(el => {
      el.textContent = el.dataset.demoReplaced;
      delete el.dataset.demoReplaced;
    });

    // 显示所有被隐藏的元素
    document.querySelectorAll('[data-demo-hidden]').forEach(el => {
      el.style.removeProperty('display');
      delete el.dataset.demoHidden;
    });

    // 根据级别处理
    if (this.level === 0) {
      // 关闭模式，恢复所有内容
      return;
    }

    if (this.level === 1) {
      // 第一级：隐藏敏感内容
      this.hideElements(this.sensitiveFields.hide);
      this.hideElements(this.sensitiveFields.replace);
    } else if (this.level === 2) {
      // 第二级：隐藏 + 替换
      this.hideElements(this.sensitiveFields.hide);
      this.replaceElements(this.sensitiveFields.replace);
    } else if (this.level === 3) {
      // 第三级：仅隐藏，保留其他
      this.hideElements(this.sensitiveFields.hide);
    }
  }

  /**
   * 隐藏指定选择器的元素
   * @param {string[]} selectors
   */
  hideElements(selectors) {
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (!el.dataset.demoHidden) {
          el.dataset.demoHidden = el.style.display || 'visible';
          el.style.display = 'none';
        }
      });
    });
  }

  /**
   * 替换指定选择器的元素内容
   * @param {string[]} selectors
   */
  replaceElements(selectors) {
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (!el.dataset.demoReplaced) {
          el.dataset.demoReplaced = el.textContent;
          el.textContent = this.replaceTexts[selector] || this.replaceTexts.default;
        }
      });
    });
  }

  /**
   * 持久化状态
   */
  persist() {
    localStorage.setItem('demoMode', String(this.level));
  }

  /**
   * 获取当前状态
   * @returns {{level: number, enabled: boolean, name: string}}
   */
  getStatus() {
    return {
      level: this.level,
      enabled: this.level > 0,
      name: this.levels[this.level].name
    };
  }

  /**
   * 检查是否处于演示模式
   * @returns {boolean}
   */
  isEnabled() {
    return this.level > 0;
  }
}

// 创建全局实例
const demoMode = new DemoMode();

// 导出供其他模块使用
window.demoMode = demoMode;

// 提供 API 供外部调用
window.getDemoModeStatus = () => demoMode.getStatus();
window.setDemoModeLevel = (level) => demoMode.setLevel(level);
window.toggleDemoMode = () => demoMode.toggle();
