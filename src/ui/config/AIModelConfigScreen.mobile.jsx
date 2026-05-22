/**
 * AIModelConfigScreen（移动版 · React Native）
 *
 * 与桌面版共享同一 AIModelConfigController；仅渲染层用 RN 组件。
 * Ollama 在移动端不可用，故 state.available 已自动过滤掉（平台守卫在 LLMProviderService）。
 *
 * 安全：API Key 用 secureTextEntry，已保存的 Key 仅提示「已保存」，绝不回显。
 */

import React from 'react';
import { View, Text, TextInput, Switch, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useAIModelConfig } from './useAIModelConfig.js';
import { AIModelConfigController } from './AIModelConfigController.js';

const REMOTE_LABELS = {
  openai: 'OpenAI',
  kimi: 'Kimi（Moonshot）',
  custom: '自定义（OpenAI 兼容）',
};

export function AIModelConfigScreen({ deps, styles = {} }) {
  const { state, controller } = useAIModelConfig(() => new AIModelConfigController(deps));

  if (state.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>加载中…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>AI 模型设置</Text>
      {state.error ? <Text style={styles.error}>出错：{state.error}</Text> : null}

      <Text style={styles.label}>分类引擎</Text>
      <View style={styles.engineRow}>
        {['local-onnx', ...state.available].map((name) => (
          <Pressable
            key={name}
            onPress={() => controller.selectActive(name)}
            style={[styles.chip, state.active === name && styles.chipActive]}
          >
            <Text style={state.active === name ? styles.chipActiveText : styles.chipText}>
              {name === 'local-onnx' ? '本地（离线·免费）' : REMOTE_LABELS[name] || name}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.switchRow}>
        <Text>远程失败时回退本地</Text>
        <Switch value={state.fallbackToLocal} onValueChange={(v) => controller.setFallbackToLocal(v)} />
      </View>

      {state.available.map((name) => {
        const p = state.providers[name] || {};
        const t = state.test[name] || {};
        return (
          <View key={name} style={styles.card}>
            <Text style={styles.cardTitle}>{REMOTE_LABELS[name] || name}</Text>

            <Text style={styles.label}>Base URL</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              value={p.baseURL || ''}
              placeholder={name === 'custom' ? '必填，如 https://your-host/v1' : ''}
              onChangeText={(v) => controller.updateProvider(name, { baseURL: v })}
            />

            <Text style={styles.label}>模型</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              value={p.model || ''}
              onChangeText={(v) => controller.updateProvider(name, { model: v })}
            />

            {p.needsKey ? (
              <>
                <Text style={styles.label}>API Key {p.hasKey ? '（已保存 ••••）' : '（未设置）'}</Text>
                <TextInput
                  style={styles.input}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={p.hasKey ? '输入以替换已保存的 Key' : '粘贴 API Key'}
                  onChangeText={(v) => controller.setApiKey(name, v)}
                />
                {p.hasKey ? (
                  <Pressable onPress={() => controller.clearApiKey(name)}>
                    <Text style={styles.link}>清除已保存的 Key</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            <View style={styles.metaRow}>
              <Text style={styles.meta}>
                单图成本：{p.costCents < 0 ? '未知' : p.costCents === 0 ? '免费' : `约 ${p.costCents} 美分`}
              </Text>
              <Pressable
                style={styles.testBtn}
                disabled={t.status === 'testing'}
                onPress={() => controller.testConnection(name)}
              >
                <Text style={styles.testBtnText}>{t.status === 'testing' ? '测试中…' : '测试连接'}</Text>
              </Pressable>
            </View>
            {t.status === 'ok' ? <Text style={styles.ok}>✓ 连通 {t.latencyMs}ms（{t.model}）</Text> : null}
            {t.status === 'fail' ? <Text style={styles.fail}>✗ {t.error}</Text> : null}
          </View>
        );
      })}

      <Pressable
        style={[styles.saveBtn, (!state.dirty || state.saving) && styles.saveBtnDisabled]}
        disabled={!state.dirty || state.saving}
        onPress={() => controller.save()}
      >
        <Text style={styles.saveBtnText}>{state.saving ? '保存中…' : '保存'}</Text>
      </Pressable>
    </ScrollView>
  );
}

export default AIModelConfigScreen;
