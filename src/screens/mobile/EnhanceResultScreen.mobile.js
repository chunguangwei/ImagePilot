import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  SafeAreaView,
  ScrollView,
  DeviceEventEmitter,
  PanResponder,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { getDefaultPresets } from '../../i18n';
import { Alert, RNFS, logger, getUri } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import ImageEnhanceService from '../../services/ImageEnhanceService';
import { isLocalPreset, enhanceImageLocally } from '../../services/enhance/localEnhance';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * 处理中遮罩：spinner + 进度文案 + 经过秒数；让用户清晰看到"还在跑"，
 * 同时顶栏的 ← 保持可用，可随时退出。仅处理中显示秒计时；失败/加载结果分支不计时。
 */
function ProcessingOverlay({ processing, failed, loadingEnhanced, currentResult, t, lang }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  useEffect(() => {
    if (!processing) { setElapsed(0); startRef.current = 0; return; }
    startRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 500);
    return () => clearInterval(id);
  }, [processing]);

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
        <>
          <Text style={styles.processingSub}>{`${elapsed}s`}</Text>
          <Text style={styles.processingHint}>{lang === 'en' ? 'Tap ← to cancel' : '← 可随时返回'}</Text>
        </>
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
 * - results: Record<string, { status: 'pending'|'processing'|'done'|'failed', enhancedUri?: string }> (可选，用于已存在的结果)
 * - initialIndex?: number
 */
export default function EnhanceResultScreen({ route, navigation }) {
  const { t, i18n } = useTranslation('common');
  const {
    presetName: routePresetName,
    presetId, // 预设方案ID（必须）
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
        // 获取当前语言的默认预设
        const currentLang = i18n.language || 'zh';
        const defaultPresets = getDefaultPresets(currentLang);
        const zhDefaults = getDefaultPresets('zh');
        const enDefaults = getDefaultPresets('en');
        
        // 从设置中读取预设信息
        const settings = await UnifiedDataService.readSettings();
        const settingsPreset = settings?.aiEnhancePresets?.[presetId];
        
        // 判断是否是默认预设（通过比较名称是否等于中文或英文的默认值）
        const defaultPreset = defaultPresets[presetId];
        if (defaultPreset && settingsPreset) {
          const isDefaultName = (
            settingsPreset.name === zhDefaults[presetId]?.name ||
            settingsPreset.name === enDefaults[presetId]?.name
          );
          
          // 如果是默认预设，使用当前语言的翻译；否则使用用户自定义的名称
          if (isDefaultName) {
            setPresetName(defaultPreset.name);
          } else {
            setPresetName(settingsPreset.name);
          }
        } else if (defaultPreset) {
          // 如果没有设置信息，使用默认预设名称
          setPresetName(defaultPreset.name);
        } else {
          // 如果都没有，使用路由传入的名称或默认值
          setPresetName(routePresetName || t('enhanceResult.defaultPresetName'));
        }
      } catch (error) {
        logger.warn('⚠️ 加载预设名称失败，使用默认值:', error);
        // 出错时使用默认预设名称或路由传入的名称
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
  const [taskProcessing, setTaskProcessing] = useState(false); // 任务处理状态
  const abortControllerRef = useRef(null); // 用于取消轮询的 AbortController
  const saveSuccessAnim = useRef(new Animated.Value(0)).current;
  
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

  const onSave = useCallback(async () => {
    // 仅保存增强图（对齐PC逻辑）
    if (!enhancedReady || !currentResult?.enhancedUri) {
      Alert.alert(t('enhanceResult.tip'), t('enhanceResult.notReady'));
      return;
    }
    if (!current) return;
    // 防重复保存
    if (currentResult?.saved) {
      Alert.alert(t('enhanceResult.tip'), t('enhanceResult.alreadySaved'));
      return;
    }
    try {
      setSavingById((prev) => ({ ...prev, [current.id]: true }));
      
      // 2) 先读取原图完整信息（用于获取文件名和复制描述/检测结果）
      let originalImage = null;
      try {
        if (current.id) {
          originalImage = await UnifiedDataService.readImageDetailsById(current.id);
        }
      } catch (e) {
        originalImage = null;
      }
      
      // 1) 保存到相册（由适配层处理落盘与权限）
      // 生成文件名：与PC端保持一致，格式为 原文件名_xt_时间戳.扩展名
      let fileName = `enhanced_${Date.now()}.jpg`; // 默认文件名
      try {
        // 优先从原图信息获取文件名
        const originalFileName = originalImage?.fileName || current?.fileName || '';
        if (originalFileName) {
          // 解析文件名（去除扩展名，获取名称部分）
          const lastDotIndex = originalFileName.lastIndexOf('.');
          const nameWithoutExt = lastDotIndex > 0 
            ? originalFileName.substring(0, lastDotIndex) 
            : originalFileName;
          const ext = lastDotIndex > 0 
            ? originalFileName.substring(lastDotIndex) 
            : '.jpg';
          
          // 清理文件名中的特殊字符（避免保存失败）
          const cleanName = nameWithoutExt.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').substring(0, 100); // 限制长度
          
          const timestamp = Date.now();
          fileName = `${cleanName}_xt_${timestamp}${ext}`;
        }
      } catch (e) {
        logger.warn('⚠️ 生成文件名失败，使用默认文件名:', e);
      }
      
      const res = await RNFS.saveImageToGallery(currentResult.enhancedUri, fileName);

      // 3) 组装完整数据并写入数据库（对齐PC：writeImageDetailedInfo + 刷新缓存）
      const now = Date.now();
      
      // 移动端：拼装 URI 格式为 contentUri||path（如果有 path）
      // res.uri 是 MediaStore 返回的 content:// URI（例如：content://media/external/images/media/12345）
      // res.path 是文件系统路径，可能是：
      // - Android 9及以下：绝对路径（如 /storage/emulated/0/Pictures/ImagePilot/image.jpg）
      // - Android 10+：可能为 null（因为使用 MediaStore API，不直接暴露文件路径）
      // 如果有 path，拼装成 contentUri||path 格式；如果没有 path，只使用 contentUri
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

      // 从原图获取尺寸信息（readImageDetailsById 返回的数据已包含 width 和 height）
      const width = originalImage?.width || null;
      const height = originalImage?.height || null;
      
      // 复制原图的所有元数据，只改变 uri 指向新保存的图片
      const completeImageData = {
        uri: newImageUri, // 新保存的图片 URI
        fileName: res.fileName || fileName || 'enhanced.jpg', // 优先使用返回的文件名，否则使用我们生成的
        // 复制原图的所有元数据
        category: originalImage?.category || 'other', // 保持原图的分类，如果没有则默认为 other
        confidence: originalImage?.confidence ?? 1.0, // 保持原图的置信度，如果没有则默认为 1.0
        timestamp: now, // 文件时间戳使用新保存的时间
        takenAt: originalImage?.takenAt || now, // 保持原图的拍摄时间，如果没有则使用当前时间
        size: fileSize, // 新保存图片的文件大小
        // 🔥 设置 width 和 height（必需字段）
        width: width,
        height: height,
        // 复制原图的所有检测结果和描述信息
        idCardDetections: originalImage?.idCardDetections || [],
        generalDetections: originalImage?.generalDetections || [],
        mobileNetV3Detections: originalImage?.mobileNetV3Detections || null,
        message: originalImage?.message || null,
        // 复制原图的其他元数据
        ...(originalImage?.imageDimensions && { imageDimensions: originalImage.imageDimensions }),
        ...(originalImage?.city && { city: originalImage.city }),
        ...(originalImage?.color && { color: originalImage.color }),
      };
      
      // 验证必要字段
      if (!completeImageData.category) {
        logger.warn('⚠️ 图片数据缺少category，自动设置为other');
        completeImageData.category = 'other';
      }
      if (!completeImageData.timestamp) {
        logger.warn('⚠️ 图片数据缺少timestamp，使用当前时间');
        completeImageData.timestamp = now;
      }
      // 🔥 验证 width 和 height（必需字段）
      if (!completeImageData.width || !completeImageData.height) {
        logger.warn(`⚠️ 图片数据缺少width或height: width=${completeImageData.width}, height=${completeImageData.height}`);
        // 如果缺少尺寸，尝试从新保存的图片中读取（移动端可能需要使用 ImageProcessor）
        // 但为了不阻塞保存流程，先使用默认值或从原图获取
        if (!completeImageData.width) completeImageData.width = 0;
        if (!completeImageData.height) completeImageData.height = 0;
      }

      // 使用 writeImageDetailedInfo 保存图片数据（服务层会自动刷新缓存）
      await UnifiedDataService.writeImageDetailedInfo([completeImageData], true);

      // 4) 标记本地结果为已保存
      Animated.sequence([
        Animated.timing(saveSuccessAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(saveSuccessAnim, { toValue: 0, duration: 220, delay: 180, useNativeDriver: true }),
      ]).start();

      setLocalResults((prev) => ({
        ...prev,
        [current.id]: { ...(prev[current.id] || {}), saved: true, savedAt: now },
      }));

    } catch (e) {
      logger.error('❌ 保存增强图片失败:', e);
      Alert.alert(t('enhanceResult.saveFailedTitle'), e?.message || t('enhanceResult.saveFailed'));
    } finally {
      setSavingById((prev) => {
        const next = { ...prev };
        if (current?.id) delete next[current.id];
        return next;
      });
    }
  }, [enhancedReady, current, currentResult]);

  const toggleShow = () => {
    if (!enhancedReady) return;
    try {
      const from = showEnhanced ? (currentResult?.enhancedUri || current?.uri) : current?.uri;
      const to = !showEnhanced ? (currentResult?.enhancedUri || current?.uri) : current?.uri;
      console.log('🟡 切换原/增强', { from, to });
    } catch (e) {}
    userToggleRef.current = true;
    setShowEnhanced((v) => !v);
  };

  // 提交任务并开始轮询（如果传递了 presetId 且结果为空，说明需要提交新任务）
  useEffect(() => {
    // 如果已经有结果或者没有 taskKey，不执行任务提交
    // 检查初始的 results（从路由参数传入），如果已经有结果就不提交
    if (!taskKey || Object.keys(results).length > 0) {
      return;
    }

    // 本地（离线）预设：用设备端模型逐张处理，不走云端 submit/poll。
    const runLocal = async () => {
      const initial = {};
      selected.forEach((it) => { initial[it.id] = { status: 'processing', progress: 0 }; });
      setLocalResults(initial);
      setTaskProcessing(true);
      for (const img of selected) {
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
          });
          setLocalResults((prev) => ({
            ...prev,
            [img.id]: { ...(prev[img.id] || {}), status: 'done', enhancedUri: dataUrl },
          }));
        } catch (e) {
          logger.error('❌ 本地增强失败:', e);
          const raw = e?.message || String(e);
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
        
        // 初始化所有图片为 processing 状态
        const initialResults = {};
        selected.forEach((item) => {
          initialResults[item.id] = { status: 'processing' };
        });
        setLocalResults(initialResults);
        setTaskProcessing(true);
        
        // 创建 AbortController 用于取消轮询
        abortControllerRef.current = new AbortController();
        
        // 读取图片URI（使用 getUri 获取正确的 URI）
        const uris = selected.map((img) => {
          // 如果 img 是一个对象且有 uri 属性，使用 getUri
          // 如果 img.uri 已经是完整的 URI 字符串，也尝试使用 getUri 处理
          return getUri(img) || img.uri;
        }).filter(Boolean);
        
        if (uris.length === 0) {
          Alert.alert(t('common.error'), t('enhanceResult.noValidImages'));
          setTaskProcessing(false);
          return;
        }

        // 1) 预处理图片
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

        // 2) 提交任务
        const submit = await ImageEnhanceService.submitEnhanceTask(validPrepared, presetId);
        const taskId = submit.task_id;

        // 3) 轮询任务状态
        const onProgress = (status) => {
          try {
            if (status && Array.isArray(status.results)) {
              // 更新每个图片的状态（过滤掉 null 值）
              status.results
                .filter(r => r != null) // 过滤掉 null 值
                .forEach((r) => {
                  const idx = typeof r.index === 'number' ? r.index : null;
                  const img = idx != null && idx < selected.length ? selected[idx] : null;
                  if (!img) {
                    logger.warn('⚠️ 进度更新：找不到对应的图片', { index: idx, total: selected.length });
                    return;
                  }

                  setLocalResults((prev) => {
                    const newStatus = r.status === 'completed' ? 'done' : 
                                     r.status === 'failed' ? 'failed' : 'processing';
                    return {
                      ...prev,
                      [img.id]: {
                        ...prev[img.id], // 保留所有原有属性，包括 saved 状态
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

        // 处理最终状态
        if (finalStatus && Array.isArray(finalStatus.results)) {
          // 过滤掉 null 值，只处理有效的结果
          const validResults = finalStatus.results.filter(r => r != null);
          
          selected.forEach((img, idx) => {
            const r = validResults.find((it) => it.index === idx);
            if (r) {
              const newStatus = r.status === 'completed' ? 'done' : 
                               r.status === 'failed' ? 'failed' : 'processing';
              setLocalResults((prev) => ({
                ...prev,
                [img.id]: {
                  ...prev[img.id], // 保留所有原有属性，包括 saved 状态
                  status: newStatus,
                  enhancedUri: r.result_url || prev[img.id]?.enhancedUri,
                  error: r.error || prev[img.id]?.error,
                }
              }));
            } else {
              // 如果没有找到对应的结果，检查是否还在处理中
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

        // 检查是否所有任务都完成了（过滤掉 null 值）
        const validResultsForCheck = finalStatus?.results?.filter(r => r != null) || [];
        const allCompleted = selected.every((s, idx) => {
          const result = validResultsForCheck.find((r) => r.index === idx);
          return result && (result.status === 'completed' || result.status === 'failed');
        });

        if (allCompleted) {
          setTaskProcessing(false);
        }

        // 清理 AbortController
        if (abortControllerRef.current) {
          abortControllerRef.current = null;
        }

      } catch (error) {
        // 清理 AbortController
        if (abortControllerRef.current) {
          abortControllerRef.current = null;
        }
        setTaskProcessing(false);

        // 如果是用户取消操作，不显示错误提示
        if (error.message && error.message.includes('轮询已被用户取消')) {
          logger.debug('🛑 用户取消了增强任务');
          return;
        }

        logger.error('提交/轮询增强任务失败:', error);
        Alert.alert(t('common.error'), error.message || t('enhanceResult.submitFailed'));
        
        // 将所有图片标记为失败
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

    // 清理函数：组件卸载时取消任务
    return () => {
      if (abortControllerRef.current) {
        logger.debug('🛑 组件卸载，取消轮询任务');
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKey]); // 只依赖 taskKey，避免重复执行。taskKey 只在 presetId 或 selected 变化时变化
  
  // 拦截返回操作：如果任务还在处理中，显示确认提示并取消任务
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      // 如果任务还在处理中，阻止返回并显示提示
      if (taskProcessing && abortControllerRef.current) {
        // 阻止默认返回行为
        e.preventDefault();
        
        Alert.alert(
          t('enhanceResult.confirmBack'),
          t('enhanceResult.taskProcessingMessage'),
          [
            {
              text: t('enhanceResult.continueWaiting'),
              style: 'cancel',
              onPress: () => {
                // 用户选择继续等待，不返回（已经通过 preventDefault 阻止了）
              }
            },
            {
              text: t('enhanceResult.confirmBackButton'),
              style: 'destructive',
              onPress: () => {
                // 用户确认返回，取消轮询任务
                if (abortControllerRef.current) {
                  logger.debug('🛑 用户确认返回，取消轮询任务');
                  abortControllerRef.current.abort();
                  abortControllerRef.current = null;
                }
                setTaskProcessing(false);
                // 移除监听器后执行返回操作
                unsubscribe();
                navigation.dispatch(e.data.action);
              }
            }
          ]
        );
      } else if (abortControllerRef.current) {
        // 即使没有 taskProcessing 标记，如果有 abortController，也取消它（防止遗漏）
        logger.debug('🛑 检测到返回操作，取消可能的轮询任务');
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    });

    return unsubscribe;
  }, [navigation, taskProcessing]);

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
      {/* 顶部栏 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{presetName}</Text>
        <Text style={styles.progress}>{completed}/{total}</Text>
      </View>

      {/* 图片区域 */}
      <View style={styles.imageContainer} {...panResponder.panHandlers}>
        {current ? (() => {
          // 使用 getUri 获取原始图片 URI，增强后的 URI 直接使用（来自服务器）
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
          />
        )}

        {/* 左右切换区域（简化实现：点击左右区域）*/}
        <TouchableOpacity style={styles.leftZone} onPress={goPrev} />
        <TouchableOpacity style={styles.rightZone} onPress={goNext} />

        {/* 浮动切换按钮已移除，统一放到底部操作栏 */}
      </View>

      {/* 底部栏：序号/总数 + 保存 */}
      <View style={styles.footer}>
        {/* 左：序号 */}
        <View style={styles.footerLeft}>
          <Text style={styles.indexText}>{index + 1} / {total}</Text>
        </View>
        {/* 中：保存到相册 */}
        <View style={styles.footerCenter}>
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
            <TouchableOpacity style={[styles.saveButton, (!canSave) && styles.saveButtonDisabled]} onPress={onSave} disabled={!canSave}>
              <Text style={styles.saveText}>{currentResult?.saved ? t('enhanceResult.saved') : (isSaving ? t('enhanceResult.saving') : t('enhanceResult.saveToGallery'))}</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
        {/* 右：原图/增强 */}
        <View style={styles.footerRight}>
          {enhancedReady && (
            <TouchableOpacity style={styles.toggleFooterButton} onPress={toggleShow}>
              <Text style={styles.toggleFooterText}>{showEnhanced ? t('enhanceResult.showOriginal') : t('enhanceResult.showEnhanced', { preset: presetName || t('enhanceResult.defaultPresetName') })}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  toggleButton: {
    position: 'absolute', right: 12, bottom: 12,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    zIndex: 10,
  },
  toggleText: { color: '#fff', fontSize: 12 },
  leftZone: { position: 'absolute', left: 0, top: 0, bottom: 0, width: SCREEN_WIDTH / 2, zIndex: 1 },
  rightZone: { position: 'absolute', right: 0, top: 0, bottom: 0, width: SCREEN_WIDTH / 2, zIndex: 1 },
  footer: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)'
  },
  indexText: { color: '#fff', fontSize: 14 },
  footerLeft: { width: 80 },
  footerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footerRight: { width: 140, alignItems: 'flex-end', justifyContent: 'center' },
  footerActions: { flexDirection: 'row', alignItems: 'center' },
  toggleFooterButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 12,
    height: 40,
    paddingHorizontal: 16,
    paddingVertical: 0,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleFooterText: { color: '#fff', fontSize: 14 },
  saveButton: { backgroundColor: '#007AFF', borderRadius: 12, height: 40, paddingHorizontal: 16, paddingVertical: 0, alignItems: 'center', justifyContent: 'center' },
  saveButtonDisabled: { backgroundColor: '#2C2C2E' },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});


