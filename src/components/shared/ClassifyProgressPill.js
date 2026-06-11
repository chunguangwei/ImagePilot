/**
 * ClassifyProgressPill —— 多选 AI 分类的悬浮进度胶囊（全局，跨页面）
 *
 * 订阅 classifyProgressStore：运行中转圈 + "AI 分类中 x/y"；完成变 ✅ 停留 4 秒。
 * HomeScreen / CategoryScreen 各放一个实例，切页回来进度还在。
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getClassifyProgress, subscribeClassifyProgress } from '../../services/classifyProgressStore';

export default function ClassifyProgressPill({ bottom = 96 }) {
  const { t } = useTranslation('common');
  const [progress, setProgress] = useState(getClassifyProgress());

  useEffect(() => {
    const unsub = subscribeClassifyProgress(setProgress);
    setProgress(getClassifyProgress());   // 挂载即同步当前状态（切回页面恢复显示）
    return unsub;
  }, []);

  if (!progress) return null;
  const isDone = progress.status === 'done';
  return (
    <View style={[styles.pill, { bottom }]} pointerEvents="none">
      {isDone
        ? <Text style={styles.icon}>✅</Text>
        : <ActivityIndicator size="small" color="#FFFFFF" />}
      <Text style={styles.text}>
        {isDone
          ? t('category.aiClassifyDone', { total: progress.total, defaultValue: `AI 分类完成（${progress.total} 张）` })
          : t('category.aiClassifyRunning', { done: progress.done, total: progress.total, defaultValue: `AI 分类中 ${progress.done}/${progress.total}` })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.72)',
    zIndex: 900,
  },
  icon: { fontSize: 13 },
  text: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
});
