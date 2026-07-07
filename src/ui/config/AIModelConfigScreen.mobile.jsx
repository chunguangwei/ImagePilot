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
import { View, Text, TextInput, Switch, Pressable, ScrollView, ActivityIndicator, StyleSheet, Alert, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIosColors } from '../ios/theme';
import { useAIModelConfig } from './useAIModelConfig.js';
import { AIModelConfigController } from './AIModelConfigController.js';

const PRIVACY_POLICY_URL = 'https://gist.github.com/chunguangwei/c3eff9e00f2d3c4375968f61d1b160da';

const REMOTE_LABELS = {
  openai: 'OpenAI',
  kimi: 'Kimi（Moonshot）',
  anthropic: 'Claude（Anthropic）',
  gemini: 'Gemini（Google）',
  // custom 走 i18n（aiModelConfig.labelCustom）；这里仅占位
  custom: '',
};

export function AIModelConfigScreen({ deps, styles: override = {} }) {
  const { t: tr } = useTranslation('common');
  const c = useIosColors();
  const styles = React.useMemo(() => createStyles(c), [c]);
  const { state, controller } = useAIModelConfig(() => new AIModelConfigController(deps));
  const s = { ...styles, ...override };

  const labelOf = (name) => {
    if (name === 'local-onnx') return tr('aiModelConfig.labelLocal');
    if (name === 'custom') return tr('aiModelConfig.labelCustom');
    return REMOTE_LABELS[name] || name;
  };

  if (state.loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={c.accent} />
        <Text style={s.meta}>{tr('aiModelConfig.loading')}</Text>
      </View>
    );
  }

  const activeIsLocal = state.active === 'local-onnx';

  // 保存：若选中的是在线（第三方）引擎，先弹「数据发送告知并同意」再落盘。
  // 满足 App Store 5.1.1(i)/5.1.2(i)：发送前明确告知发送内容/接收方，并获得用户许可。
  const handleSave = () => {
    if (activeIsLocal) {
      controller.save();
      return;
    }
    Alert.alert(
      tr('aiModelConfig.consentTitle'),
      tr('aiModelConfig.consentMessage'),
      [
        { text: tr('aiModelConfig.consentLink'), onPress: () => { try { Linking.openURL(PRIVACY_POLICY_URL); } catch (_) {} } },
        { text: tr('aiModelConfig.consentCancel'), style: 'cancel' },
        { text: tr('aiModelConfig.consentAgree'), onPress: () => controller.save() },
      ],
      { cancelable: true }
    );
  };

  // 渲染「当前生效」这一个远程引擎的配置卡片
  const renderActiveRemoteCard = () => {
    const name = state.active;
    const p = state.providers[name] || {};
    const tst = state.test[name] || {};
    return (
      <View style={s.card}>
        <Text style={s.cardTitle}>{tr('aiModelConfig.cardTitle', { name: labelOf(name) })}</Text>

        <Text style={s.label}>{tr('aiModelConfig.baseURL')}</Text>
        <TextInput
          style={s.input}
          autoCapitalize="none"
          placeholderTextColor={c.tertiaryLabel}
          value={p.baseURL || ''}
          placeholder={name === 'custom' ? tr('aiModelConfig.baseURLPlaceholderCustom') : ''}
          onChangeText={(v) => controller.updateProvider(name, { baseURL: v })}
        />

        <Text style={s.label}>{tr('aiModelConfig.model')}</Text>
        <TextInput
          style={s.input}
          autoCapitalize="none"
          placeholderTextColor={c.tertiaryLabel}
          value={p.model || ''}
          onChangeText={(v) => controller.updateProvider(name, { model: v })}
        />

        {p.needsKey ? (
          <>
            <Text style={s.label}>{p.hasKey ? tr('aiModelConfig.apiKeySaved') : tr('aiModelConfig.apiKeyUnset')}</Text>
            <TextInput
              style={s.input}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={c.tertiaryLabel}
              placeholder={p.hasKey ? tr('aiModelConfig.apiKeyPlaceholderReplace') : tr('aiModelConfig.apiKeyPlaceholderPaste')}
              onChangeText={(v) => controller.setApiKey(name, v)}
            />
            {p.hasKey ? (
              <Pressable onPress={() => controller.clearApiKey(name)}>
                <Text style={s.link}>{tr('aiModelConfig.clearSavedKey')}</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        <View style={s.metaRow}>
          <Text style={s.meta}>
            {p.costCents < 0
              ? tr('aiModelConfig.costUnknown')
              : p.costCents === 0
                ? tr('aiModelConfig.costFree')
                : tr('aiModelConfig.costCents', { cents: p.costCents })}
          </Text>
          <Pressable
            style={s.testBtn}
            disabled={tst.status === 'testing'}
            onPress={() => controller.testConnection(name)}
          >
            <Text style={s.testBtnText}>{tst.status === 'testing' ? tr('aiModelConfig.testing') : tr('aiModelConfig.testConnection')}</Text>
          </Pressable>
        </View>
        {tst.status === 'ok' ? <Text style={s.ok}>{tr('aiModelConfig.testOk', { latency: tst.latencyMs, model: tst.model })}</Text> : null}
        {tst.status === 'fail' ? <Text style={s.fail}>{tr('aiModelConfig.testFail', { error: tst.error })}</Text> : null}
      </View>
    );
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.title}>{tr('aiModelConfig.title')}</Text>
      {state.error ? <Text style={s.error}>{tr('aiModelConfig.errorPrefix', { error: state.error })}</Text> : null}

      <Text style={s.label}>{tr('aiModelConfig.engineLabel')}</Text>
      <Text style={s.hint}>{tr('aiModelConfig.engineHint')}</Text>
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
      <Text style={s.activeHint}>{tr('aiModelConfig.activeHint', { name: labelOf(state.active) })}</Text>

      {!activeIsLocal ? (
        <View style={s.switchRow}>
          <Text style={s.switchLabel}>{tr('aiModelConfig.fallbackSwitch')}</Text>
          <Switch value={state.fallbackToLocal} onValueChange={(v) => controller.setFallbackToLocal(v)} />
        </View>
      ) : null}

      {activeIsLocal ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>{tr('aiModelConfig.localTitle')}</Text>
          <Text style={s.meta}>{tr('aiModelConfig.localDesc')}</Text>
        </View>
      ) : (
        renderActiveRemoteCard()
      )}

      <Pressable
        style={[s.saveBtn, (!state.dirty || state.saving) && s.saveBtnDisabled]}
        disabled={!state.dirty || state.saving}
        onPress={handleSave}
      >
        <Text style={s.saveBtnText}>{state.saving ? tr('aiModelConfig.saving') : tr('common.save')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const createStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.groupedBg },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.groupedBg },
  title: { fontSize: 20, fontWeight: '700', color: c.label, marginBottom: 6 },
  error: { color: c.danger, marginBottom: 8 },
  label: { fontSize: 14, color: c.label, marginTop: 14, marginBottom: 6, fontWeight: '600' },
  hint: { fontSize: 12, color: c.tertiaryLabel, marginBottom: 8 },
  engineRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
    borderColor: c.separator, backgroundColor: c.fillTertiary, marginRight: 8, marginBottom: 8,
  },
  chipActive: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { color: c.label, fontSize: 14 },
  chipActiveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  activeHint: { color: c.accent, fontWeight: '600', marginTop: 2, marginBottom: 4 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  switchLabel: { flex: 1, color: c.label, fontSize: 14, marginRight: 12 },
  card: { borderWidth: 1, borderColor: c.separator, borderRadius: 12, padding: 14, marginTop: 16, backgroundColor: c.card },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.label },
  input: { borderWidth: 1, borderColor: c.separator, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: c.card, color: c.label },
  link: { color: c.accent, marginTop: 8 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  meta: { color: c.secondaryLabel, fontSize: 13, flex: 1, lineHeight: 19 },
  testBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: c.accentSoft, marginLeft: 8 },
  testBtnText: { color: c.accent, fontWeight: '600' },
  ok: { color: c.success, marginTop: 6 },
  fail: { color: c.danger, marginTop: 6 },
  saveBtn: { marginTop: 24, backgroundColor: c.accent, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});

export default AIModelConfigScreen;
