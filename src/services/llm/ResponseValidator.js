/**
 * ResponseValidator — 校验 Provider 返回的分类结果
 *
 * 用 ajv 校验 schema.json，校验失败 → LLMProviderService 触发 1 次重试
 *
 * 兼容性：
 *   - ajv 是通用 JS 库，RN/Electron 均可用（zero-dep at runtime）
 *   - 若用户希望最小化依赖，可用 SimpleValidator（不依赖 ajv）
 *
 * 关于 schema 来源：
 *   不静态 import `./prompts/schema.json` —— JSON import 在三套环境里语法不一致
 *   （Node ESM 需 `with { type:'json' }`、Metro/webpack 要纯 import、旧版本又不支持），
 *   无法用一种写法通吃。故这里内联 DEFAULT_SCHEMA，`prompts/schema.json` 仍是
 *   权威产物（供 fork / 文档 / 非 JS 消费方使用）；二者一致性由
 *   `__tests__/llm/ResponseValidator.test.js` 的漂移守卫断言保证。
 */

/**
 * DEFAULT_SCHEMA —— 必须与 prompts/schema.json 保持一致（有漂移守卫测试）
 */
export const DEFAULT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://imagepilot.dev/schemas/classification.json',
  title: 'ImagePilot Classification Result',
  description:
    'LLM Provider 归一化分类结果。被 ResponseValidator 用 ajv 编译校验；校验失败触发 LLMProviderService 的 1 次重试，仍失败则按 fallbackToLocal 处理。',
  type: 'object',
  additionalProperties: true,
  required: ['contentCategory', 'colorTheme'],
  properties: {
    contentCategory: {
      type: 'string',
      description: '图片主体内容分类',
      enum: [
        'single_person',
        'social',
        'pet',
        'food',
        'scenery',
        'id_card',
        'screenshot',
        'electronics',
        'qrcode',
        'other',
      ],
    },
    colorTheme: {
      type: 'string',
      description: '整体色调',
      enum: ['blue', 'green', 'red', 'yellow', 'black', 'white', 'warm', 'cold', 'mixed'],
    },
    isScreenshot: { type: 'boolean', description: '是否为屏幕截图', default: false },
    isIDCard: { type: 'boolean', description: '是否包含身份证 / 证件', default: false },
    confidence: {
      type: 'number',
      description: '分类置信度',
      minimum: 0,
      maximum: 1,
      default: 0.5,
    },
    semanticLabel: {
      type: 'string',
      description: '语意短标签（4~12 汉字 / 2~5 英文词），LLM 看图后产出的可见标签',
      maxLength: 60,
      default: '',
    },
    description: {
      type: 'string',
      description: '简短自然语言描述（建议 < 24 字）',
      maxLength: 200,
      default: '',
    },
  },
};

const schema = DEFAULT_SCHEMA;

let _ajvInstance = null;

function getAjv() {
  if (_ajvInstance) return _ajvInstance;
  try {
    // 动态 require，环境无 ajv 时降级
    // eslint-disable-next-line global-require
    const Ajv = require('ajv');
    _ajvInstance = new Ajv({ allErrors: true, useDefaults: true });
    return _ajvInstance;
  } catch (_) {
    return null;
  }
}

export class ResponseValidator {
  constructor(customSchema) {
    this.schema = customSchema || schema;
    this._ajv = getAjv();
    this._validateFn = this._ajv ? this._ajv.compile(this.schema) : null;
  }

  /**
   * @param {object} result
   * @returns {{ok: boolean, errors?: string}}
   */
  validate(result) {
    if (!result || typeof result !== 'object') {
      return { ok: false, errors: 'result is not an object' };
    }

    if (this._validateFn) {
      const ok = this._validateFn(result);
      if (!ok) {
        const errs = (this._validateFn.errors || [])
          .map((e) => `${e.instancePath} ${e.message}`)
          .join('; ');
        return { ok: false, errors: errs };
      }
      return { ok: true };
    }

    // ajv 不可用 → 简易校验
    return this._simpleValidate(result);
  }

  _simpleValidate(result) {
    const errors = [];
    const required = this.schema?.required || ['contentCategory', 'colorTheme'];
    for (const k of required) {
      if (!(k in result)) errors.push(`missing field: ${k}`);
    }

    const categoryEnum = (this.schema?.properties?.contentCategory?.enum) || [];
    if (categoryEnum.length && result.contentCategory && !categoryEnum.includes(result.contentCategory)) {
      errors.push(`contentCategory invalid: ${result.contentCategory}`);
    }
    const colorEnum = (this.schema?.properties?.colorTheme?.enum) || [];
    if (colorEnum.length && result.colorTheme && !colorEnum.includes(result.colorTheme)) {
      errors.push(`colorTheme invalid: ${result.colorTheme}`);
    }

    if (typeof result.confidence === 'number') {
      if (result.confidence < 0 || result.confidence > 1) {
        errors.push('confidence out of range [0,1]');
      }
    }

    return errors.length ? { ok: false, errors: errors.join('; ') } : { ok: true };
  }
}

export default ResponseValidator;
