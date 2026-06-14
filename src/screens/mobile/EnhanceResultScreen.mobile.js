import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  SafeAreaView,
  PanResponder,
  Animated,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { getDefaultPresets } from '../../i18n';
import { Alert, RNFS, logger, getUri } from '../../adapters/WebAdapters';
import { useIosColors } from '../../ui/ios/theme';
import UnifiedDataService from '../../services/UnifiedDataService';
import ImageEnhanceService from '../../services/ImageEnhanceService';
import { isLocalPreset, enhanceImageLocally, supportsDepth, DEPTH_PRESETS, blendSuperResWithOriginal } from '../../services/enhance/localEnhance';
import DepthSlider from '../../components/shared/DepthSlider';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * 处理中遮罩：spinner + 进度文案 + 经过秒数；顶栏的 ← 保持可用，可随时退出。
 * 仅处理中显示秒计时；失败/加载结果分支不计时。
 */
function ProcessingOverlay({ processing, failed, loadingEnhanced, currentResult, t, lang, styles }) {
  // 不再显示读秒：jimp 像素处理会堵塞 JS 线程，计时器无法刷新、显示卡住没意义（用户反馈去掉）。
  const pct = typeof currentResult?.progress === 'number' ? Math.round(currentResult.progress * 100) : 0;
  const phaseLabel = currentResult?.phase === 'download' ? '下载模型' : t('enhanceResult.processing');
  let primary;
  if (failed) primary = t('enhanceResult.failed');
  else if (loadingEnhanced) primary = t('enhanceResult.loadingEnhancedResult');
  else primary = pct > 0 ? `${phaseLabel} ${pct}%` : phaseLabel;

  return (
    <View style={styles.processingOverlay} pointerEvents="box-none">
      {!failed && <ActivityIndicator size="large" color="#FFFFFF" style={{ marginBottom: 12 }} />}
      <Text style={styles.processingText}>{primary}</Text>
      {processing && !failed && (
        <Text style={styles.processingHint}>{lang === 'en' ? 'Tap ← to cancel' : '← 可随时返回'}</Text>
      )}
    </View>
  );
}

/**
 * EnhanceResultScreen - 导航模态页（展示增强结果）
 * route.params:
 * - presetName: string
 * - presetId: string - 预设方案ID（用于提交任务）
 * - selected: Array<{ id: string, uri: string }>
 * - results: Record<string, { status: 'pending'|'processing'|'done'|'failed', enhancedUri?: string }> (可选)
 * - initialIndex?: number
 */
export default function EnhanceResultScreen({ route, navigation }) {
  const { t, i18n } = useTranslation('common');
  const c = useIosColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const {
    presetName: routePresetName,
    presetId,
    selected = [],
    results = {},
    initialIndex = 0,
  } = route.params || {};

  // 根据 presetId 和当前语言获取国际化后的预设名称
  const [presetName, setPresetName] = useState(routePresetName || t('enhanceResult.defaultPresetName'));

  useEffect(() => {
    const loadPresetName = async () => {
      if (!presetId) {
        setPresetName(t('enhanceResult.defaultPresetName'));
        return;
      }

      try {
        const currentLang = i18n.language || 'zh';
        const defaultPresets = getDefaultPresets(currentLang);
        const zhDefaults = getDefaultPresets('zh');
        const enDefaults = getDefaultPresets('en');

        const settings = await UnifiedDataService.readSettings();
        const settingsPreset = settings?.aiEnhancePresets?.[presetId];

        // 判断是否是默认预设（通过比较名称是否等于中文或英文的默认值）
        const defaultPreset = defaultPresets[presetId];
        if (defaultPreset && settingsPreset) {
          const isDefaultName = (
            settingsPreset.name === zhDefaults[presetId]?.name ||
            settingsPreset.name === enDefaults[presetId]?.name
          );

          if (isDefaultName) {
            setPresetName(defaultPreset.name);
          } else {
            setPresetName(settingsPreset.name);
          }
        } else if (defaultPreset) {
          setPresetName(defaultPreset.name);
        } else {
          setPresetName(routePresetName || t('enhanceResult.defaultPresetName'));
        }
      } catch (error) {
        logger.warn('加载预设名称失败，使用默认值:', error);
        const currentLang = i18n.language || 'zh';
        const defaultPresets = getDefaultPresets(currentLang);
        const defaultPreset = defaultPresets[presetId];
        setPresetName(defaultPreset?.name || routePresetName || t('enhanceResult.defaultPresetName'));
      }
    };

    loadPresetName();
  }, [presetId, i18n.language, routePresetName, t]);

  const [index, setIndex] = useState(Math.min(Math.max(initialIndex, 0), Math.max(selected.length - 1, 0)));
  const [showEnhanced, setShowEnhanced] = useState(false);
  const [localResults, setLocalResults] = useState(results || {});
  const [savingById, setSavingById] = useState({});
  const [taskProcessing, setTaskProcessing] = useState(false);
  const abortControllerRef = useRef(null);
  const cancelledRef = useRef(false); // 本地处理取消标记（返回/卸载时置 true，超分逐 tile 检查中断）
  const saveSuccessAnim = useRef(new Animated.Value(0)).current;
  // 修图深度（美颜/清晰增强/色彩优化）：拖横杆选强度，松手按新深度重出图
  const depthable = supportsDepth(presetId);
  const [depth, setDepth] = useState(DEPTH_PRESETS[presetId] ?? 0.8);
  const srCacheRef = useRef({}); // 清晰增强：id → 全强度超分 data URL（推理只跑一次，拉杆只重混合）

  // 计算任务键，用于防止重复提交
  const taskKey = useMemo(() => {
    if (!presetId || selected.length === 0) return null;
    return `${presetId}_${selected.length}_${selected[0]?.id}`;
  }, [presetId, selected]);

  const total = selected.length;
  const completed = useMemo(() => {
    return selected.reduce((acc, s) => acc + (localResults[s.id]?.status === 'done' ? 1 : 0), 0);
  }, [selected, localResults]);

  const current = selected[index] || null;
  const currentResult = current ? localResults[current.id] : null;
  // enhancedReady 需要同时满足状态为 'done' 且存在 enhancedUri
  const enhancedReady = !!(currentResult && currentResult.status === 'done' && currentResult.enhancedUri);
  const processing = !!(currentResult && (currentResult.status === 'pending' || currentResult.status === 'processing'));
  const failed = !!(currentResult && currentResult.status === 'failed');
  // 状态为 'done' 但没有 enhancedUri，显示加载中提示
  const loadingEnhanced = !!(currentResult && currentResult.status === 'done' && !currentResult.enhancedUri);
  const isSaving = current ? !!savingById[current.id] : false;
  const canSave = enhancedReady && !failed && !isSaving && !(currentResult && currentResult.saved);
  const translateX = useRef(new Animated.Value(0)).current;
  const userToggleRef = useRef(false);
  const localResultsRef = useRef(localResults);

  useEffect(() => {
    localResultsRef.current = localResults;
  }, [localResults]);

  const goPrev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : i)), []);
  const goNext = useCallback(() => setIndex((i) => (i < total - 1 ? i + 1 : i)), [total]);

  const onSave = useCallback(async (opts) => {
    const alsoStage = opts?.stage === true; // true=保存到相册+落库+放入暂存箱
    // 仅保存增强图（对齐PC逻辑）
    if (!enhancedReady || !currentResult?.enhancedUri) {
      Alert.alert(t('enhanceResult.tip'), t('enhanceResult.notReady'));
      return;
    }
    if (!current) return;
    if (currentResult?.saved) {
      Alert.alert(t('enhanceResult.tip'), t('enhanceResult.alreadySaved'));
      return;
    }
    try {
      setSavingById((prev) => ({ ...prev, [current.id]: true }));

      // 读取原图完整信息（用于获取文件名和复制描述/检测结果）
      let originalImage = null;
      try {
        if (current.id) {
          originalImage = await UnifiedDataService.readImageDetailsById(current.id);
        }
      } catch (e) {
        originalImage = null;
      }

      // 生成文件名：与PC端保持一致，格式为 原文件名_xt_时间戳.扩展名
      let fileName = `enhanced_${Date.now()}.jpg`;
      try {
        const originalFileName = originalImage?.fileName || current?.fileName || '';
        if (originalFileName) {
          const lastDotIndex = originalFileName.lastIndexOf('.');
          const nameWithoutExt = lastDotIndex > 0
            ? originalFileName.substring(0, lastDotIndex)
            : originalFileName;
          const ext = lastDotIndex > 0
            ? originalFileName.substring(lastDotIndex)
            : '.jpg';

          // 清理文件名中的特殊字符（避免保存失败），并限制长度
          const cleanName = nameWithoutExt.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').substring(0, 100);

          const timestamp = Date.now();
          fileName = `${cleanName}_xt_${timestamp}${ext}`;
        }
      } catch (e) {
        logger.warn('生成文件名失败，使用默认文件名:', e);
      }

      const res = await RNFS.saveImageToGallery(currentResult.enhancedUri, fileName);

      const now = Date.now();

      // 移动端 URI 拼装为 contentUri||path 格式（如果有 path）。
      // Android 10+ 走 MediaStore，path 可能为 null，此时只用 contentUri。
      const contentUri = res.uri || '';
      const path = res.path || '';
      const newImageUri = path ? `${contentUri}||${path}` : contentUri;
      let fileSize = 0;
      try {
        if (path) {
          const st = await RNFS.stat(path);
          fileSize = Number(st.size) || 0;
        }
      } catch {}

      const width = originalImage?.width || null;
      const height = originalImage?.height || null;

      // 记录 id 与扫描器一致：iOS 用 PhotoKit localIdentifier（否则重扫会按 uri 唯一约束
      // 把记录重新键入 localIdentifier，原记录被顶掉、暂存 id 成孤儿）。安卓退回 getStableId。
      const recordId = res?.localIdentifier || UnifiedDataService.getStableId(newImageUri);
      // 复制原图的所有元数据，只改变 uri 指向新保存的图片
      const completeImageData = {
        id: recordId,
        uri: newImageUri,
        fileName: res.fileName || fileName || 'enhanced.jpg',
        category: originalImage?.category || 'other',
        confidence: originalImage?.confidence ?? 1.0,
        timestamp: now,
        takenAt: originalImage?.takenAt || now,
        size: fileSize,
        width: width,
        height: height,
        idCardDetections: originalImage?.idCardDetections || [],
        generalDetections: originalImage?.generalDetections || [],
        mobileNetV3Detections: originalImage?.mobileNetV3Detections || null,
        message: originalImage?.message || null,
        ...(originalImage?.city && { city: originalImage.city }),
        ...(originalImage?.color && { color: originalImage.color }),
      };

      // 验证必要字段
      if (!completeImageData.category) {
        completeImageData.category = 'other';
      }
      if (!completeImageData.timestamp) {
        completeImageData.timestamp = now;
      }
      if (!completeImageData.width || !completeImageData.height) {
        logger.warn(`图片数据缺少width或height: width=${completeImageData.width}, height=${completeImageData.height}`);
        if (!completeImageData.width) completeImageData.width = 0;
        if (!completeImageData.height) completeImageData.height = 0;
      }
      // 新记录入库强制要求 imageDimensions（缺则 insert 抛错并被上层吞掉 → 图没真正入库）。
      // 无条件补上（iOS 上原图常缺宽高，用已兜底的 width/height）。
      if (!completeImageData.imageDimensions) {
        completeImageData.imageDimensions = originalImage?.imageDimensions
          || { width: completeImageData.width || 0, height: completeImageData.height || 0 };
      }

      // 使用 writeImageDetailedInfo 保存图片数据（服务层会自动刷新缓存）
      await UnifiedDataService.writeImageDetailedInfo([completeImageData], true);

      // 「暂存」：在保存落库的基础上，把新图放进暂存箱（id 与写库一致 = getStableId(uri)）
      if (alsoStage) {
        try {
          await UnifiedDataService.addToStagingBox([recordId]);
        } catch (stageErr) {
          logger.warn('增强图加入暂存箱失败:', stageErr);
        }
      }

      Animated.sequence([
        Animated.timing(saveSuccessAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(saveSuccessAnim, { toValue: 0, duration: 220, delay: 180, useNativeDriver: true }),
      ]).start();

      setLocalResults((prev) => ({
        ...prev,
        [current.id]: { ...(prev[current.id] || {}), saved: true, savedAt: now },
      }));

    } catch (e) {
      logger.error('保存增强图片失败:', e);
      Alert.alert(t('enhanceResult.saveFailedTitle'), e?.message || t('enhanceResult.saveFailed'));
    } finally {
      setSavingById((prev) => {
        const next = { ...prev };
        if (current?.id) delete next[current.id];
        return next;
      });
    }
  }, [enhancedReady, current, currentResult, saveSuccessAnim, t]);

  // 点保存时让用户选：仅存相册 / 存相册并放入暂存箱（编辑结果直接进暂存箱）
  const onSavePressed = useCallback(() => {
    if (!canSave) return;
    Alert.alert(
      t('enhanceResult.saveActionTitle'),
      undefined,
      [
        { text: t('enhanceResult.saveToGallery'), onPress: () => onSave() },
        { text: t('enhanceResult.saveAndStage'), onPress: () => onSave({ stage: true }) },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    );
  }, [canSave, onSave, t]);

  const toggleShow = () => {
    if (!enhancedReady) return;
    userToggleRef.current = true;
    setShowEnhanced((v) => !v);
  };

  // 深度拉杆松手：按新强度重出当前这张图。美颜/色彩=jimp 重跑（秒级）；
  // 清晰增强=缓存的全强度超分结果与原图重混合（免再推理）。新结果清 saved，可再次保存。
  const onDepthComplete = useCallback(async (v) => {
    setDepth(v);
    const img = selected[index];
    if (!img || !depthable) return;
    const uri = getUri(img) || img.uri;
    if (!uri) return;
    setLocalResults((prev) => ({ ...prev, [img.id]: { ...(prev[img.id] || {}), status: 'processing', progress: 0 } }));
    try {
      let dataUrl;
      if (presetId === 'enhance') {
        let raw = srCacheRef.current[img.id];
        if (!raw) {
          raw = await enhanceImageLocally(uri, presetId, ({ done, total, phase }) => {
            setLocalResults((prev) => ({ ...prev, [img.id]: { ...(prev[img.id] || {}), status: 'processing', progress: total ? done / total : 0, phase: phase || 'process' } }));
          });
          srCacheRef.current[img.id] = raw;
        }
        dataUrl = await blendSuperResWithOriginal(uri, raw, v);
      } else {
        dataUrl = await enhanceImageLocally(uri, presetId, ({ done, total, phase }) => {
          setLocalResults((prev) => ({ ...prev, [img.id]: { ...(prev[img.id] || {}), status: 'processing', progress: total ? done / total : 0, phase: phase || 'process' } }));
        }, { intensity: v });
      }
      userToggleRef.current = false; // 重出图后回到自动展示增强图
      setLocalResults((prev) => ({
        ...prev,
        [img.id]: { ...(prev[img.id] || {}), status: 'done', enhancedUri: dataUrl, saved: false },
      }));
    } catch (e) {
      logger.error('深度重处理失败:', e);
      const raw = e?.message || String(e);
      setLocalResults((prev) => ({ ...prev, [img.id]: { ...(prev[img.id] || {}), status: 'failed', error: raw } }));
      Alert.alert(t('enhanceResult.failed') || '处理失败', raw);
    }
  }, [selected, index, depthable, presetId, t]);

  // 提交任务并开始轮询（如果传递了 presetId 且结果为空，说明需要提交新任务）
  useEffect(() => {
    if (!taskKey || Object.keys(results).length > 0) {
      return;
    }
    cancelledRef.current = false; // 新一轮处理，复位取消标记

    // 本地（离线）预设：用设备端模型逐张处理，不走云端 submit/poll。
    const runLocal = async () => {
      const initial = {};
      selected.forEach((it) => { initial[it.id] = { status: 'processing', progress: 0 }; });
      setLocalResults(initial);
      setTaskProcessing(true);
      for (const img of selected) {
        if (cancelledRef.current) break; // 用户已返回，停止后续
        const uri = getUri(img) || img.uri;
        if (!uri) {
          setLocalResults((prev) => ({ ...prev, [img.id]: { ...(prev[img.id] || {}), status: 'failed', error: t('enhanceResult.noValidImages') } }));
          continue;
        }
        try {
          const dataUrl = await enhanceImageLocally(uri, presetId, ({ done, total, phase }) => {
            setLocalResults((prev) => ({
              ...prev,
              [img.id]: { ...(prev[img.id] || {}), status: 'processing', progress: total ? done / total : 0, phase: phase || 'process' },
            }));
          }, { shouldCancel: () => cancelledRef.current });
          // 清晰增强首跑即全强度结果，缓存给深度拉杆重混合用（免再推理）
          if (presetId === 'enhance') srCacheRef.current[img.id] = dataUrl;
          setLocalResults((prev) => ({
            ...prev,
            [img.id]: { ...(prev[img.id] || {}), status: 'done', enhancedUri: dataUrl },
          }));
        } catch (e) {
          const raw = e?.message || String(e);
          if (cancelledRef.current || /E_CANCELLED/.test(raw)) break; // 用户主动返回，静默停止
          logger.error('本地增强失败:', e);
          // 把内部错误码转成友好提示；其余直接透传原始报错
          const msg = /E_TIMEOUT/.test(raw)
            ? raw.replace('E_TIMEOUT', '').trim()
            : /未检测|no face|未找到/.test(raw)
              ? raw
              : `处理失败：${raw}`;
          setLocalResults((prev) => ({
            ...prev,
            [img.id]: { ...(prev[img.id] || {}), status: 'failed', error: msg },
          }));
          Alert.alert(t('enhanceResult.failed') || '处理失败', msg);
        }
      }
      setTaskProcessing(false);
    };

    const submitAndPoll = async () => {
      // 本地预设走设备端处理；其余预设保持原云端/占位流程
      if (isLocalPreset(presetId)) {
        await runLocal();
        return;
      }
      try {
        logger.debug('开始提交增强任务', { presetId, count: selected.length });

        const initialResults = {};
        selected.forEach((item) => {
          initialResults[item.id] = { status: 'processing' };
        });
        setLocalResults(initialResults);
        setTaskProcessing(true);

        abortControllerRef.current = new AbortController();

        const uris = selected.map((img) => {
          return getUri(img) || img.uri;
        }).filter(Boolean);

        if (uris.length === 0) {
          Alert.alert(t('common.error'), t('enhanceResult.noValidImages'));
          setTaskProcessing(false);
          return;
        }

        const prepared = await ImageEnhanceService.prepareImagesForEnhance(uris);
        const validPrepared = prepared.filter(p => !p.error);

        if (validPrepared.length === 0) {
          Alert.alert(t('common.error'), t('enhanceResult.preprocessFailed'));
          setTaskProcessing(false);
          if (abortControllerRef.current) {
            abortControllerRef.current = null;
          }
          return;
        }

        const submit = await ImageEnhanceService.submitEnhanceTask(validPrepared, presetId);
        const taskId = submit.task_id;

        const onProgress = (status) => {
          try {
            if (status && Array.isArray(status.results)) {
              status.results
                .filter(r => r != null)
                .forEach((r) => {
                  const idx = typeof r.index === 'number' ? r.index : null;
                  const img = idx != null && idx < selected.length ? selected[idx] : null;
                  if (!img) {
                    logger.warn('进度更新：找不到对应的图片', { index: idx, total: selected.length });
                    return;
                  }

                  setLocalResults((prev) => {
                    const newStatus = r.status === 'completed' ? 'done' :
                                     r.status === 'failed' ? 'failed' : 'processing';
                    return {
                      ...prev,
                      [img.id]: {
                        ...prev[img.id], // 保留 saved 等所有原有属性
                        status: newStatus,
                        enhancedUri: r.result_url || prev[img.id]?.enhancedUri,
                        error: r.error || prev[img.id]?.error,
                      }
                    };
                  });
                });
            }
          } catch (e) {
            logger.error('处理进度更新失败:', e);
          }
        };

        const finalStatus = await ImageEnhanceService.pollTaskStatus(
          taskId,
          onProgress,
          abortControllerRef.current?.signal
        );

        if (finalStatus && Array.isArray(finalStatus.results)) {
          const validResults = finalStatus.results.filter(r => r != null);

          selected.forEach((img, idx) => {
            const r = validResults.find((it) => it.index === idx);
            if (r) {
              const newStatus = r.status === 'completed' ? 'done' :
                               r.status === 'failed' ? 'failed' : 'processing';
              setLocalResults((prev) => ({
                ...prev,
                [img.id]: {
                  ...prev[img.id], // 保留 saved 等所有原有属性
                  status: newStatus,
                  enhancedUri: r.result_url || prev[img.id]?.enhancedUri,
                  error: r.error || prev[img.id]?.error,
                }
              }));
            } else {
              setLocalResults((prev) => ({
                ...prev,
                [img.id]: {
                  ...(prev[img.id] || {}),
                  status: prev[img.id]?.status || 'processing',
                }
              }));
            }
          });
        }

        const validResultsForCheck = finalStatus?.results?.filter(r => r != null) || [];
        const allCompleted = selected.every((s, idx) => {
          const result = validResultsForCheck.find((r) => r.index === idx);
          return result && (result.status === 'completed' || result.status === 'failed');
        });

        if (allCompleted) {
          setTaskProcessing(false);
        }

        if (abortControllerRef.current) {
          abortControllerRef.current = null;
        }

      } catch (error) {
        if (abortControllerRef.current) {
          abortControllerRef.current = null;
        }
        setTaskProcessing(false);

        // 如果是用户取消操作，不显示错误提示
        if (error.message && error.message.includes('轮询已被用户取消')) {
          logger.debug('用户取消了增强任务');
          return;
        }

        logger.error('提交/轮询增强任务失败:', error);
        Alert.alert(t('common.error'), error.message || t('enhanceResult.submitFailed'));

        setLocalResults((prev) => {
          const updated = { ...prev };
          selected.forEach((img) => {
            updated[img.id] = {
              ...(updated[img.id] || {}),
              status: 'failed',
              error: error.message || t('enhanceResult.taskFailed'),
            };
          });
          return updated;
        });
      }
    };

    submitAndPoll();

    // 组件卸载时取消任务（本地超分逐 tile 检查此标记，及时停掉避免返回后仍占满 CPU 卡顿）
    return () => {
      cancelledRef.current = true;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKey]);

  // 拦截返回操作：如果任务还在处理中，显示确认提示并取消任务
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (taskProcessing && abortControllerRef.current) {
        e.preventDefault();

        Alert.alert(
          t('enhanceResult.confirmBack'),
          t('enhanceResult.taskProcessingMessage'),
          [
            {
              text: t('enhanceResult.continueWaiting'),
              style: 'cancel',
              onPress: () => {},
            },
            {
              text: t('enhanceResult.confirmBackButton'),
              style: 'destructive',
              onPress: () => {
                if (abortControllerRef.current) {
                  abortControllerRef.current.abort();
                  abortControllerRef.current = null;
                }
                setTaskProcessing(false);
                unsubscribe();
                navigation.dispatch(e.data.action);
              }
            }
          ]
        );
      } else if (abortControllerRef.current) {
        // 即使没有 taskProcessing 标记，如果有 abortController，也取消它（防止遗漏）
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    });

    return unsubscribe;
  }, [navigation, taskProcessing, t]);

  // 当切换到新的图片时，根据当前结果默认展示增强图（仅在未手动切换前）
  useEffect(() => {
    if (!current) return;
    userToggleRef.current = false;
    const result = localResultsRef.current[current.id];
    const shouldShowEnhanced = !!(result?.status === 'done' && result?.enhancedUri);
    setShowEnhanced(shouldShowEnhanced);
    translateX.setValue(0);
  }, [current?.id, translateX]);

  // 当任务轮询带来新的结果时，若用户未手动切换则保持自动切换逻辑
  useEffect(() => {
    if (!current || userToggleRef.current) return;
    const result = localResults[current.id];
    const shouldShowEnhanced = !!(result?.status === 'done' && result?.enhancedUri);
    setShowEnhanced(shouldShowEnhanced);
  }, [localResults, current?.id]);


  // 手势：左右滑动切换图片（处理中/完成均可）
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8,
    onPanResponderMove: (_, gesture) => {
      translateX.setValue(gesture.dx);
    },
    onPanResponderRelease: (_, gesture) => {
      const threshold = SCREEN_WIDTH * 0.2;
      if (gesture.dx > threshold) {
        Animated.timing(translateX, { toValue: SCREEN_WIDTH, duration: 180, useNativeDriver: true }).start(() => {
          translateX.setValue(0);
          goPrev();
        });
      } else if (gesture.dx < -threshold) {
        Animated.timing(translateX, { toValue: -SCREEN_WIDTH, duration: 180, useNativeDriver: true }).start(() => {
          translateX.setValue(0);
          goNext();
        });
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  }), [goPrev, goNext, translateX]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      {/* 顶部栏 */}
      <View style={styles.header}>
        {/* 处理中 jimp 像素循环会堵 JS 线程几秒，期间 navigation.goBack 排队等不到执行；
            加大 hitSlop 至少保证手指落到合理区域内都能 register；真正的 yield 在 jimpFilters 里做 */}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.backTouchable}
        >
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{presetName}</Text>
        <Text style={styles.progress}>{completed}/{total}</Text>
      </View>

      {/* 图片区域 */}
      <View style={styles.imageContainer} {...panResponder.panHandlers}>
        {current ? (() => {
          const originalUri = getUri(current) || current.uri;
          const displayUri = enhancedReady && showEnhanced
            ? (currentResult.enhancedUri || originalUri)
            : originalUri;

          return displayUri ? (
            <Animated.Image
              source={{ uri: displayUri }}
              style={[styles.image, { transform: [{ translateX }] }]}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.imagePlaceholder}><Text style={styles.placeholderText}>{t('enhanceResult.noImage')}</Text></View>
          );
        })() : (
          <View style={styles.imagePlaceholder}><Text style={styles.placeholderText}>{t('enhanceResult.noImage')}</Text></View>
        )}

        {/* 处理中/加载中/失败蒙层：spinner + 文案 + 经过秒数，← 始终可退出 */}
        {(processing || loadingEnhanced || failed) && (
          <ProcessingOverlay
            processing={processing}
            failed={failed}
            loadingEnhanced={loadingEnhanced}
            currentResult={currentResult}
            t={t}
            lang={i18n.language}
            styles={styles}
          />
        )}

        {/* 左右切换区域（简化实现：点击左右区域）*/}
        <TouchableOpacity style={styles.leftZone} onPress={goPrev} />
        <TouchableOpacity style={styles.rightZone} onPress={goNext} />
      </View>

      {/* 修图深度横杆：美颜/清晰增强/色彩优化可拉（处理中隐藏，防并发重处理） */}
      {depthable && enhancedReady && !processing && !isSaving && (
        <View style={styles.depthRow}>
          <Text style={styles.depthLabel} numberOfLines={1}>{t('enhanceResult.depth', { defaultValue: '修图深度' })}</Text>
          <DepthSlider value={depth} onChange={setDepth} onComplete={onDepthComplete} trackWidth={SCREEN_WIDTH - 190} />
          <Text style={styles.depthValue}>{Math.round(depth * 100)}%</Text>
        </View>
      )}

      {/* 底部栏：iOS Photos 风格 — 主 CTA 几何居中，索引/对比按钮绝对定位在两侧。
          之前用 flex 行布局，长 toggle 文案把中间 save 挤出几何中心还触发 ellipsis；
          现改成 absolute 定位：center 不受两侧元素长度影响，永远在屏幕正中。*/}
      <View style={styles.footer}>
        <Text style={styles.indexText} numberOfLines={1}>{index + 1} / {total}</Text>
        <Animated.View style={[
          styles.saveButtonWrapper,
          {
            transform: [{
              scale: currentResult?.saved ? saveSuccessAnim.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [1, 1.06, 1],
              }) : 1,
            }],
            opacity: currentResult?.saved ? saveSuccessAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0.94],
            }) : 1,
          },
        ]}>
          <TouchableOpacity style={[styles.saveButton, (!canSave) && styles.saveButtonDisabled]} onPress={onSavePressed} disabled={!canSave}>
            <Text style={styles.saveText} numberOfLines={1}>
              {currentResult?.saved ? t('enhanceResult.saved') : (isSaving ? t('enhanceResult.saving') : t('enhanceResult.saveToGallery'))}
            </Text>
          </TouchableOpacity>
        </Animated.View>
        {enhancedReady && (
          <TouchableOpacity style={styles.toggleFooterButton} onPress={toggleShow}>
            {/* toggle 文案保持简短 — 之前带 preset name "(人像美颜)" 一长串把 save 挤出中心 */}
            <Text style={styles.toggleFooterText} numberOfLines={1}>
              {showEnhanced ? t('enhanceResult.showOriginal') : t('enhanceResult.showEnhancedShort')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

// 整屏为全黑图片画布（StatusBar light-content）：container/header/footer 上的
// 白字 + 半透明边线属于"黑底 chrome"，不随主题切换；只把品牌强调色挂到 c.accent。
const createStyles = (c) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  backTouchable: { paddingHorizontal: 8, paddingVertical: 8 }, // 实际触摸区域 56x56，配合 hitSlop 还会更大
  back: { color: '#fff', fontSize: 32, fontWeight: 'bold', width: 40, textAlign: 'center' },
  title: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  progress: { color: '#8E8E93', fontSize: 14, width: 64, textAlign: 'right' },
  imageContainer: { flex: 1, position: 'relative', justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.7 },
  imagePlaceholder: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.7, justifyContent: 'center', alignItems: 'center' },
  placeholderText: { color: '#8E8E93' },
  processingOverlay: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  processingText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  processingSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 4, fontVariant: ['tabular-nums'] },
  processingHint: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 10 },
  leftZone: { position: 'absolute', left: 0, top: 0, bottom: 0, width: SCREEN_WIDTH / 2, zIndex: 1 },
  rightZone: { position: 'absolute', right: 0, top: 0, bottom: 0, width: SCREEN_WIDTH / 2, zIndex: 1 },
  // 深度拉杆行：label + 滑杆 + 百分比，黑底白字与整页 chrome 一致
  depthRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 2, gap: 10,
  },
  depthLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13, width: 80 },
  depthValue: { color: '#fff', fontSize: 13, fontWeight: '600', width: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
  footer: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)'
  },
  // 索引「1/1」绝对定位左侧，永远不挤压 save 按钮
  indexText: {
    position: 'absolute', left: 16, top: 0, bottom: 0,
    textAlignVertical: 'center', includeFontPadding: false,
    color: '#fff', fontSize: 14, lineHeight: 56,
  },
  // saveButtonWrapper：absolute fill 让 save 按钮总在父级几何中心
  // （之前用 flex 列布局，toggle 长文案会把 save 挤出中心 + 触发 ellipsis）
  saveButtonWrapper: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  // toggle 也绝对定位右侧，maxWidth 限宽——之前没限宽 + 带长 preset 名，行 flex 算到中间挤掉 save
  toggleFooterButton: {
    position: 'absolute', right: 16, top: 8, bottom: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 120,
  },
  toggleFooterText: { color: '#fff', fontSize: 13 },
  // 主 CTA：minWidth 兜底防 numberOfLines 触发 ellipsis（之前 width 不足把"保存到相册"截成"保存到..."）
  saveButton: {
    backgroundColor: c.accent, borderRadius: 12, height: 40,
    paddingHorizontal: 20, paddingVertical: 0,
    minWidth: 132,
    alignItems: 'center', justifyContent: 'center',
  },
  saveButtonDisabled: { backgroundColor: '#2C2C2E' },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
