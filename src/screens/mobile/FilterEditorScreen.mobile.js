/**
 * FilterEditorScreen（移动版）— 本地滤镜/美颜修图（gl-react-native + expo-gl，离线）
 *
 * 用 src/services/enhance/filters.js 的自有 GLSL 滤镜，在设备 GPU 上实时预览，
 * captureAsDataURL 截帧后用 RNFS 保存到相册目录。零网络。
 * 入口：ImagePreviewScreen「🎨 滤镜」按钮 → navigate('FilterEditor', { imageUri })。
 */

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Dimensions, Alert } from 'react-native';
import { Surface } from 'gl-react-native';
import { Shaders, Node } from 'gl-react';
import { RNFS } from '../../adapters/WebAdapters';
import { FILTERS, FILTER_IDS, defaultParams } from '../../services/enhance/filters.js';

// 一次性编译所有有 shader 的滤镜
const shaderDefs = {};
for (const id of FILTER_IDS) {
  if (FILTERS[id].shader) shaderDefs[id] = { frag: FILTERS[id].shader };
}
const SHADERS = Shaders.create(shaderDefs);

const INTENSITY_LEVELS = [
  { label: '弱', value: 0.33 },
  { label: '中', value: 0.66 },
  { label: '强', value: 1.0 },
];

export default function FilterEditorScreen({ route, navigation }) {
  const imageUri = route?.params?.imageUri;
  const surfaceRef = useRef(null);
  const [filterId, setFilterId] = useState('none');
  const [intensity, setIntensity] = useState(1.0);
  const [saving, setSaving] = useState(false);

  const win = Dimensions.get('window');
  const size = Math.min(win.width, win.height - 220);

  // 当前滤镜的 uniforms：默认参数 + 用强度覆盖 intensity 类参数
  const uniforms = useMemo(() => {
    const f = FILTERS[filterId];
    if (!f || !f.shader) return null;
    const u = { t: { uri: imageUri }, ...defaultParams(filterId) };
    if ('intensity' in u) u.intensity = intensity;
    if (f.needsResolution) u.resolution = [size, size];
    return u;
  }, [filterId, intensity, imageUri, size]);

  const hasIntensity = !!FILTERS[filterId]?.params?.some((p) => p.key === 'intensity');

  const onSave = async () => {
    if (!surfaceRef.current) return;
    setSaving(true);
    try {
      const dataURL = await surfaceRef.current.captureAsDataURL();
      const base64 = String(dataURL).split(',')[1] || '';
      const dir = `${RNFS.PicturesDirectoryPath}/xualbum`;
      await RNFS.mkdir(dir).catch(() => {});
      const path = `${dir}/filtered_${Date.now()}.png`;
      await RNFS.writeFile(path, base64, 'base64');
      Alert.alert('已保存', `已保存到:\n${path}`);
    } catch (e) {
      Alert.alert('保存失败', e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.headerBtn}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>滤镜修图</Text>
        <TouchableOpacity onPress={onSave} disabled={saving || filterId === 'none'}>
          <Text style={[styles.headerBtn, (saving || filterId === 'none') && styles.disabled]}>
            {saving ? '保存中…' : '保存'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.preview}>
        {!imageUri ? (
          <Text style={styles.hint}>未传入图片</Text>
        ) : (
          <Surface ref={surfaceRef} style={{ width: size, height: size }}>
            {uniforms ? (
              <Node shader={SHADERS[filterId]} uniforms={uniforms} />
            ) : (
              <Node shader={SHADERS.warm /* placeholder */} uniforms={{ t: { uri: imageUri }, intensity: 0 }} />
            )}
          </Surface>
        )}
      </View>

      {hasIntensity && (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>强度</Text>
          {INTENSITY_LEVELS.map((lv) => (
            <TouchableOpacity
              key={lv.label}
              style={[styles.chip, Math.abs(intensity - lv.value) < 0.05 && styles.chipActive]}
              onPress={() => setIntensity(lv.value)}>
              <Text style={styles.chipText}>{lv.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView horizontal style={styles.filterBar} showsHorizontalScrollIndicator={false}>
        {FILTER_IDS.map((id) => (
          <TouchableOpacity
            key={id}
            style={[styles.filterChip, filterId === id && styles.filterChipActive]}
            onPress={() => setFilterId(id)}>
            <Text style={[styles.filterChipText, filterId === id && styles.filterChipTextActive]}>
              {FILTERS[id].name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, paddingTop: 44 },
  headerBtn: { color: '#fff', fontSize: 16 },
  disabled: { color: '#777' },
  title: { color: '#fff', fontSize: 17, fontWeight: '600' },
  preview: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  hint: { color: '#999' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  rowLabel: { color: '#ccc', marginRight: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: '#333', marginRight: 8 },
  chipActive: { backgroundColor: '#007AFF' },
  chipText: { color: '#fff' },
  filterBar: { maxHeight: 64, paddingHorizontal: 8, paddingVertical: 10 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: '#222', marginHorizontal: 5 },
  filterChipActive: { backgroundColor: '#fff' },
  filterChipText: { color: '#ddd' },
  filterChipTextActive: { color: '#000', fontWeight: '600' },
});
