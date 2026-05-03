// @ts-check
const OpenAI = require('openai');
const pLimit = require('p-limit');

/** @type {import('p-limit').LimitFunction} 全局并发限制器，最多 3 个并发请求 */
const limit = pLimit(3);

/**
 * LLM 客户端（OpenAI SDK + p-limit 并发限制）
 *
 * 特性：
 * - 使用 OpenAI SDK 调用兼容 API
 * - 全局 p-limit 并发限制（最多 3 个并发请求）
 * - 超时保护（Promise.race + AbortController），默认 10 秒
 * - 批量生成方法，自动控制并发
 * - 从环境变量读取配置：OPENAI_API_KEY, LLM_BASE_URL, LLM_MODEL
 */
class LLMClient {
  constructor() {
    /** @type {OpenAI|null} OpenAI 客户端实例（延迟初始化） */
    this.client = null;

    /** @type {string} 使用的模型名称 */
    this.model = process.env.LLM_MODEL || 'gpt-4';
  }

  /**
   * 获取或创建 OpenAI 客户端实例（延迟初始化）
   *
   * @returns {OpenAI}
   * @private
   */
  _getClient() {
    if (!this.client) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          'OPENAI_API_KEY environment variable is missing or empty. ' +
          'Please set it in your .env file or environment.'
        );
      }
      this.client = new OpenAI({
        apiKey,
        baseURL: process.env.LLM_BASE_URL,
      });
    }
    return this.client;
  }

  /**
   * 生成文本
   *
   * 并发限制：全局最多 3 个并发请求（p-limit）
   * 超时保护：使用 AbortController + Promise.race，超时后中止请求
   *
   * @param {string} prompt - 用户提示词
   * @param {Object} [options] - 可选参数
   * @param {number} [options.maxTokens=2000] - 最大生成 token 数
   * @param {number} [options.temperature=0.7] - 生成温度
   * @param {number} [options.timeout=10] - 超时时间（秒）
   * @returns {Promise<string>} LLM 生成的文本内容
   * @throws {Error} API 调用失败或超时时抛出异常
   *
   * @example
   * const llm = new LLMClient();
   * const result = await llm.generate('请分析以下商业模式...', {
   *   maxTokens: 1000,
   *   temperature: 0.5,
   *   timeout: 15
   * });
   */
  async generate(prompt, options = {}) {
    const {
      maxTokens = 2000,
      temperature = 0.7,
      timeout = 10,
    } = options;

    return limit(() => this._generateWithTimeout(prompt, maxTokens, temperature, timeout));
  }

  /**
   * 带超时保护的生成方法（内部方法）
   *
   * 使用 AbortController 设置超时，通过 Promise.race 竞争：
   * - 正常响应：返回 LLM 生成内容
   * - 超时：AbortController.abort() 触发，抛出超时错误
   *
   * @param {string} prompt - 用户提示词
   * @param {number} maxTokens - 最大生成 token 数
   * @param {number} temperature - 生成温度
   * @param {number} timeout - 超时时间（秒）
   * @returns {Promise<string>} LLM 生成的文本内容
   * @throws {Error} 超时或 API 调用失败时抛出
   * @private
   */
  async _generateWithTimeout(prompt, maxTokens, temperature, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
        signal: controller.signal,
      });
      return response.choices[0].message.content;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`LLM request timed out after ${timeout} seconds`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 批量生成（自动控制并发）
   *
   * 对多个 prompt 并行调用 generate，通过全局 p-limit 限制器
   * 自动控制并发数为 3。所有请求共享同一个并发池。
   *
   * @param {string[]} prompts - 提示词数组
   * @param {Object} [options] - 可选参数，同 generate 的 options
   * @param {number} [options.maxTokens=2000] - 最大生成 token 数
   * @param {number} [options.temperature=0.7] - 生成温度
   * @param {number} [options.timeout=10] - 超时时间（秒）
   * @returns {Promise<string[]>} 与 prompts 顺序对应的生成结果数组
   *
   * @example
   * const llm = new LLMClient();
   * const results = await llm.batchGenerate([
   *   '分析战略层面...',
   *   '分析商业模式层面...',
   *   '分析行业趋势...'
   * ], { temperature: 0.5 });
   */
  async batchGenerate(prompts, options = {}) {
    return Promise.all(
      prompts.map((prompt) => this.generate(prompt, options))
    );
  }
}

module.exports = { LLMClient };
