/**
 * AIModelConfigScreen.desktop（桌面端导航包装屏）
 *
 * 桌面端无 react-navigation 的 header，故在此包一层「返回设置」按钮。
 * 内部渲染共享的瘦视图 ui/config/AIModelConfigScreen.desktop.jsx，
 * 并注入与扫描路径同源的 deps（makeAIModelConfigDeps）。
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AIModelConfigScreen as AIModelConfigView } from '../../ui/config/AIModelConfigScreen.desktop.jsx';
import { makeAIModelConfigDeps } from '../../ui/config/aiModelConfigDeps.js';

export default function AIModelConfigScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.backBar}
        onPress={() => navigation && navigation.goBack && navigation.goBack()}
        activeOpacity={0.7}
      >
        <Text style={styles.backText}>← 返回设置</Text>
      </TouchableOpacity>
      <AIModelConfigView deps={makeAIModelConfigDeps()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5FCFF' },
  backBar: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E5E5EA' },
  backText: { fontSize: 15, color: '#007AFF' },
});
