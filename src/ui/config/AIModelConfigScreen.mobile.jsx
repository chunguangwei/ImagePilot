/**
 * AIModelConfigScreen（移动版 · React Native）
 *
 * 与桌面版共享同一 AIModelConfigController；仅渲染层用 RN 组件。
 * Ollama 在移动端不可用，故 state.available 已自动过滤掉（平台守卫在 LLMProviderService）。
 *
 * 交互设计：顶部「分类引擎」选一个即当前生效（active）；下方只展示「当前生效」这一个引擎的
 * 配置，避免多家配置同时铺开、看不出以哪个为准。各家的 Key/URL 仍按引擎分别存储，切回时记得。
 *
 * 安全：API Key 用 secureTextEntry，已保存的 Key 仅提示「已保存」，绝不回显。
 */

import React from 'react';
import { View, Text, TextInput, Switch, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useAIModelConfig } from './useAIModelConfig.js';
import { AIModelConfigController } from './AIModelConfigController.js';

const REMOTE_LABELS = {
  openai: 'OpenAI',
  kimi: 'Kimi（Moonshot）',
  anthropic: 'Claude（Anthropic）',
  gemini: 'Gemini（Google）',
  custom: '自定义 / Azure（OpenAI 兼容）',
};

const labelOf = (name) => (name === 'local-onnx' ? '本地（离线·免费）' : REMOTE_LABELS[name] || name);

export function AIModelConfigScreen({ deps, styles: override = {} }) {
  const { state, controller } = useAIModelConfig(() => new AIModelConfigController(deps));
  const s = { ...defaultStyles, ...override };

  if (state.loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
        <Text style={s.meta}>加载中…</Text>
      </View>
    );
  }

  const activeIsLocal = state.active === 'local-onnx';

  // 渲染「当前生效」这一个远程引擎的配置卡片
  const renderActiveRemoteCard = () => {
    const name = state.active;
    const p = state.providers[name] || {};
    const t = state.test[name] || {};
    return (
      <View style={s.card}>
        <Text style={s.cardTitle}>{REMOTE_LABELS[name] || name} 配置</Text>

        <Text style={s.label}>Base URL</Text>
        <TextInput
          style={s.input}
          autoCapitalize="none"
          value={p.baseURL || ''}
          placeholder={name === 'custom' ? '必填，如 https://your-host/v1' : ''}
          onChangeText={(v) => controller.updateProvider(name, { baseURL: v })}
        />

        <Text style={s.label}>模型</Text>
        <TextInput
          style={s.input}
          autoCapitalize="none"
          value={p.model || ''}
          onChangeText={(v) => controller.updateProvider(name, { model: v })}
        />

        {p.needsKey ? (
          <>
            <Text style={s.label}>API Key {p.hasKey ? '（已保存 ••••）' : '（未设置）'}</Text>
            <TextInput
              style={s.input}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={p.hasKey ? '输入以替换已保存的 Key' : '粘贴 API Key'}
              onChangeText={(v) => controller.setApiKey(name, v)}
            />
            {p.hasKey ? (
              <Pressable onPress={() => controller.clearApiKey(name)}>
                <Text style={s.link}>清除已保存的 Key</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        <View style={s.metaRow}>
          <Text style={s.meta}>
            单图成本：{p.costCents < 0 ? '未知' : p.costCents === 0 ? '免费' : `约 ${p.costCents} 美分`}
          </Text>
          <Pressable
            style={s.testBtn}
            disabled={t.status === 'testing'}
            onPress={() => controller.testConnection(name)}
          >
            <Text style={s.testBtnText}>{t.status === 'testing' ? '测试中…' : '测试连接'}</Text>
          </Pressable>
        </View>
        {t.status === 'ok' ? <Text style={s.ok}>✓ 连通 {t.latencyMs}ms（{t.model}）</Text> : null}
        {t.status === 'fail' ? <Text style={s.fail}>✗ {t.error}</Text> : null}
      </View>
    );
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.title}>AI 模型设置</Text>
      {state.error ? <Text style={s.error}>出错：{state.error}</Text> : null}

      <Text style={s.label}>分类引擎</Text>
      <Text style={s.hint}>选中哪个，分类就用哪个；下方只需配置选中的这一个。</Text>
      <View style={s.engineRow}>
        {['local-onnx', ...state.available].map((name) => (
          <Pressable
            key={name}
            onPress={() => controller.selectActive(name)}
            style={[s.chip, state.active === name && s.chipActive]}
          >
            <Text style={state.active === name ? s.chipActiveText : s.chipText}>{labelOf(name)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.activeHint}>● 当前生效：{labelOf(state.active)}</Text>

      {!activeIsLocal ? (
        <View style={s.switchRow}>
          <Text style={s.switchLabel}>在线分类失败时，自动回退本地离线分类</Text>
          <Switch value={state.fallbackToLocal} onValueChange={(v) => controller.setFallbackToLocal(v)} />
        </View>
      ) : null}

      {activeIsLocal ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>本地（离线·免费）</Text>
          <Text style={s.meta}>
            使用设备端 MobileNetV3 离线分类：不联网、不上传、免费，无需任何配置。{'\n'}
            如需更高精度，可在上方切换到一个在线大模型并填入 API Key。
          </Text>
        </View>
      ) : (
        renderActiveRemoteCard()
      )}

      <Pressable
        style={[s.saveBtn, (!state.dirty || state.saving) && s.saveBtnDisabled]}
        disabled={!state.dirty || state.saving}
        onPress={() => controller.save()}
      >
        <Text style={s.saveBtnText}>{state.saving ? '保存中…' : '保存'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const defaultStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 6 },
  error: { color: '#d00', marginBottom: 8 },
  label: { fontSize: 14, color: '#333', marginTop: 14, marginBottom: 6, fontWeight: '600' },
  hint: { fontSize: 12, color: '#888', marginBottom: 8 },
  engineRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
    borderColor: '#ccc', backgroundColor: '#f3f4f6', marginRight: 8, marginBottom: 8,
  },
  chipActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  chipText: { color: '#333', fontSize: 14 },
  chipActiveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  activeHint: { color: '#007AFF', fontWeight: '600', marginTop: 2, marginBottom: 4 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  switchLabel: { flex: 1, color: '#333', fontSize: 14, marginRight: 12 },
  card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 14, marginTop: 16, backgroundColor: '#fafafa' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: '#fff', color: '#111' },
  link: { color: '#007AFF', marginTop: 8 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  meta: { color: '#666', fontSize: 13, flex: 1, lineHeight: 19 },
  testBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#eaf1ff', marginLeft: 8 },
  testBtnText: { color: '#007AFF', fontWeight: '600' },
  ok: { color: '#138000', marginTop: 6 },
  fail: { color: '#d00', marginTop: 6 },
  saveBtn: { marginTop: 24, backgroundColor: '#007AFF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

export default AIModelConfigScreen;
