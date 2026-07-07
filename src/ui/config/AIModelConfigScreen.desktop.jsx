/**
 * AIModelConfigScreen（桌面版 · React DOM / Electron renderer）
 *
 * 瘦视图：所有逻辑在 AIModelConfigController，本文件只负责渲染与事件转发。
 * 与移动版 AIModelConfigScreen.mobile.jsx 共享同一 controller。
 *
 * 安全：API Key 输入框为 password 类型，且只在用户输入新值时调用 setApiKey；
 *       已保存的 Key 仅以「已保存 ••••」提示，绝不回显明文。
 */

import React from 'react';
import { useAIModelConfig } from './useAIModelConfig.js';
import { AIModelConfigController } from './AIModelConfigController.js';

const REMOTE_LABELS = {
  openai: 'OpenAI',
  kimi: 'Kimi（Moonshot）',
  anthropic: 'Claude（Anthropic）',
  gemini: 'Gemini（Google）',
  ollama: 'Ollama（本地，仅 PC）',
  custom: '自定义 / Azure（OpenAI 兼容）',
};

const CONSENT_MESSAGE =
  '你正在启用「在线分类」。启用后，当你主动发起云端分类时，你选择的照片（或视频抽帧）会通过你自己填写的 API Key，' +
  '发送给你指定的第三方 AI 服务商（如 OpenAI / Claude / Gemini / Kimi）进行识别。\n\n' +
  '· 发送内容：你选择分类的照片\n' +
  '· 接收方：你配置的第三方服务商（受其隐私政策约束）\n' +
  '· 本 App 开发者不运营任何服务器，不会接收、存储你的照片或数据\n' +
  '· 此功能默认关闭，你可随时切回「本地离线分类」\n\n' +
  '点击「确定」表示同意并启用。';

export function AIModelConfigScreen({ deps }) {
  const { state, controller } = useAIModelConfig(() => new AIModelConfigController(deps));

  if (state.loading) return <div className="ai-config loading">加载中…</div>;

  const choices = ['local-onnx', ...state.available];

  // 保存：若选中在线（第三方）引擎，先弹「数据发送告知并同意」再落盘。
  const handleSave = () => {
    if (state.active === 'local-onnx') {
      controller.save();
      return;
    }
    const ok = typeof window !== 'undefined' && window.confirm
      ? window.confirm(CONSENT_MESSAGE)
      : true;
    if (ok) controller.save();
  };

  return (
    <div className="ai-config">
      <h2>AI 模型设置</h2>
      {state.error && <div className="ai-config-error">出错：{state.error}</div>}

      <section className="ai-config-active">
        <label>分类引擎</label>
        <select value={state.active} onChange={(e) => controller.selectActive(e.target.value)}>
          <option value="local-onnx">本地分类（离线 · 免费 · 隐私）</option>
          {state.available.map((name) => (
            <option key={name} value={name}>{REMOTE_LABELS[name] || name}</option>
          ))}
        </select>

        <label className="ai-config-checkbox">
          <input
            type="checkbox"
            checked={state.fallbackToLocal}
            onChange={(e) => controller.setFallbackToLocal(e.target.checked)}
          />
          远程失败时回退本地
        </label>

        <label>提示词语言</label>
        <select value={state.promptLang} onChange={(e) => controller.setPromptLang(e.target.value)}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </section>

      {state.available.map((name) => {
        const p = state.providers[name] || {};
        const t = state.test[name] || {};
        return (
          <fieldset key={name} className="ai-config-provider" disabled={!choices.includes(name)}>
            <legend>{REMOTE_LABELS[name] || name}</legend>

            <label>Base URL</label>
            <input
              type="text"
              value={p.baseURL || ''}
              placeholder={name === 'custom' ? '必填，如 https://your-host/v1' : ''}
              onChange={(e) => controller.updateProvider(name, { baseURL: e.target.value })}
            />

            <label>模型</label>
            <input
              type="text"
              value={p.model || ''}
              onChange={(e) => controller.updateProvider(name, { model: e.target.value })}
            />

            {p.needsKey && (
              <>
                <label>API Key {p.hasKey ? <em>（已保存 ••••）</em> : <em>（未设置）</em>}</label>
                <div className="ai-config-key-row">
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={p.hasKey ? '输入以替换已保存的 Key' : '粘贴 API Key'}
                    onChange={(e) => controller.setApiKey(name, e.target.value)}
                  />
                  {p.hasKey && (
                    <button type="button" onClick={() => controller.clearApiKey(name)}>清除</button>
                  )}
                </div>
              </>
            )}

            <div className="ai-config-meta">
              <span>
                单图成本：{p.costCents < 0 ? '未知' : p.costCents === 0 ? '免费' : `约 ${p.costCents} 美分`}
              </span>
              <button type="button" onClick={() => controller.testConnection(name)} disabled={t.status === 'testing'}>
                {t.status === 'testing' ? '测试中…' : '测试连接'}
              </button>
              {t.status === 'ok' && <span className="ok">✓ 连通 {t.latencyMs}ms（{t.model}）</span>}
              {t.status === 'fail' && <span className="fail">✗ {t.error}</span>}
            </div>
          </fieldset>
        );
      })}

      <div className="ai-config-actions">
        <button type="button" disabled={!state.dirty || state.saving} onClick={handleSave}>
          {state.saving ? '保存中…' : '保存'}
        </button>
        <button type="button" disabled={state.saving} onClick={() => controller.load()}>重置</button>
      </div>
    </div>
  );
}

export default AIModelConfigScreen;
