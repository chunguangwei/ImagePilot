/**
 * CustomCategoriesScreen（移动版）— 自定义分类管理（A 方案）
 *
 * 增/删自定义分类 [{ id, name, rule }]，存入 settings.aiProvider.customCategories。
 * 云端大模型分类时会按这些规则把图片归入对应分类（见 wireLLMRouting / customCategories）。
 * 纯本地读写，无重依赖。入口：设置页「🏷️ 自定义分类」。
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import configService from '../../services/llm/adapters/UnifiedDataConfigService';

// 内置分类 id（自定义 id 不应与之冲突）
const BUILTIN_IDS = ['single_person', 'social_activities', 'travel_scenery', 'pets', 'foods', 'idcard', 'screenshot', 'qrcode', 'other', 'NA'];

export default function CustomCategoriesScreen({ navigation }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [rule, setRule] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const cfg = await configService.getAIProviderConfig();
        setList(Array.isArray(cfg.customCategories) ? cfg.customCategories : []);
      } catch (e) {
        Alert.alert('读取失败', e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = async (next) => {
    setList(next);
    try {
      await configService.setCustomCategories(next);
    } catch (e) {
      Alert.alert('保存失败', e?.message || String(e));
    }
  };

  const onAdd = async () => {
    const cid = id.trim();
    const cname = name.trim();
    if (!cid || !cname) {
      Alert.alert('请填写', 'id 和 名称 必填');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(cid)) {
      Alert.alert('id 格式', 'id 只能用字母/数字/下划线（英文，便于大模型输出）');
      return;
    }
    if (BUILTIN_IDS.includes(cid) || list.some((c) => c.id === cid)) {
      Alert.alert('id 重复', '该 id 与内置或已有自定义分类冲突');
      return;
    }
    await persist([...list, { id: cid, name: cname, rule: rule.trim() }]);
    setId(''); setName(''); setRule('');
  };

  const onDelete = (cid) => {
    Alert.alert('删除', `删除自定义分类「${cid}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => persist(list.filter((c) => c.id !== cid)) },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.headerBtn}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>自定义分类</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.tip}>
          配置后，使用云端大模型分类时，会按你的「规则」把图片归入对应自定义分类。id 用英文（大模型输出用）。
        </Text>

        {/* 新增表单 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>新增分类</Text>
          <TextInput style={styles.input} placeholder="id（英文，如 work_screenshot）" placeholderTextColor="#999" value={id} onChangeText={setId} autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="名称（如 工作截图）" placeholderTextColor="#999" value={name} onChangeText={setName} />
          <TextInput style={[styles.input, styles.multiline]} placeholder="规则：什么样的图片归入此类（如 含代码/表格/聊天记录的截图）" placeholderTextColor="#999" value={rule} onChangeText={setRule} multiline />
          <TouchableOpacity style={styles.addBtn} onPress={onAdd}>
            <Text style={styles.addBtnText}>添加</Text>
          </TouchableOpacity>
        </View>

        {/* 已有列表 */}
        <Text style={styles.cardTitle}>已定义（{list.length}）</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} />
        ) : list.length === 0 ? (
          <Text style={styles.empty}>还没有自定义分类</Text>
        ) : (
          list.map((c) => (
            <View key={c.id} style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{c.name} <Text style={styles.itemId}>({c.id})</Text></Text>
                {!!c.rule && <Text style={styles.itemRule}>{c.rule}</Text>}
              </View>
              <TouchableOpacity onPress={() => onDelete(c.id)}>
                <Text style={styles.del}>删除</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F7' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, paddingTop: 44, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E5EA' },
  headerBtn: { color: '#007AFF', fontSize: 16, width: 48 },
  title: { fontSize: 17, fontWeight: '600' },
  tip: { color: '#666', fontSize: 13, lineHeight: 19, marginBottom: 14 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 20 },
  cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, fontSize: 14, color: '#000' },
  multiline: { height: 70, textAlignVertical: 'top' },
  addBtn: { backgroundColor: '#007AFF', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  addBtnText: { color: '#fff', fontWeight: '600' },
  empty: { color: '#999', marginTop: 12 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10 },
  itemName: { fontSize: 15, fontWeight: '500' },
  itemId: { fontSize: 12, color: '#999' },
  itemRule: { fontSize: 13, color: '#666', marginTop: 4 },
  del: { color: '#FF3B30', marginLeft: 12 },
});
