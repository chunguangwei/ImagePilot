import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentLanguage, getColorNameTranslation, getOrientationNameTranslation, getCameraSettingsCategoryTranslation, getDefaultPresets } from '../../i18n';
import { useFocusEffect, logger, getUri, getLocalPath } from '../../adapters/WebAdapters';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, Modal, Platform, TextInput, ScrollView } from 'react-native';
// 分页方案实现
import { SafeAreaView, Alert, createFixedStyle } from '../../adapters/WebAdapters';
import UnifiedDataService from '../../services/UnifiedDataService';
import cityLocationService from '../../services/CityLocationService';
import ImageEnhanceService from '../../services/ImageEnhanceService';
import WeChatAuthService from '../../services/WeChatAuthService';
import EnhanceResultScreen from './EnhanceResultScreen.desktop';

// 使用统一数据服务


// 时间轴标题组件 - 独立监听选中状态变化，并显示该日期下照片的相关地点
const TimelineHeader = React.memo(({ dateKey, formattedDate, imagesForDate, onPress }) => {
  const { t, i18n } = useTranslation('common');
  const [selectedCount, setSelectedCount] = useState(0);
  const [allSelected, setAllSelected] = useState(false);
  const [locationNames, setLocationNames] = useState([]);

  const lang = i18n.language || 'zh';
  useEffect(() => {
    const cityIds = [...new Set((imagesForDate || []).map(img => img.city).filter(Boolean))];
    if (cityIds.length === 0) {
      setLocationNames([]);
      return;
    }
    let cancelled = false;
    Promise.all(cityIds.map(id => cityLocationService.getLocationName(id, lang).catch(() => id)))
      .then(names => {
        if (!cancelled) setLocationNames(names || []);
      });
    return () => { cancelled = true; };
  }, [imagesForDate, lang]);

  const locationText = locationNames.length > 0 ? locationNames.join('、') : '';

  // 计算选中状态
  const updateSelectionState = useCallback(() => {
    const imageIds = imagesForDate.map(img => img.id);
    let count = 0;
    for (const id of imageIds) {
      if (UnifiedDataService.isImageSelected(id)) {
        count++;
      }
    }
    setSelectedCount(count);
    setAllSelected(count === imageIds.length && count > 0);
  }, [imagesForDate]);
  
  // 初始化选中状态
  useEffect(() => {
    updateSelectionState();
  }, [updateSelectionState]);
  
  // 监听选中状态变化
  useEffect(() => {
    const handleSelectionChange = (event) => {
      const imageIds = imagesForDate.map(img => img.id);
      if (imageIds.includes(event.detail.imageId)) {
        // 使用 setTimeout 延迟状态更新，避免在渲染期间调用 setState
        setTimeout(() => {
          updateSelectionState();
        }, 0);
      }
    };
    
    window.addEventListener('imageSelectionChanged', handleSelectionChange);
    return () => {
      window.removeEventListener('imageSelectionChanged', handleSelectionChange);
    };
  }, [imagesForDate, updateSelectionState]);
  
  const someSelected = selectedCount > 0;
  
  return (
    <TouchableOpacity 
      style={styles.timelineHeader}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.timelineHeaderContent}>
        <View style={styles.timelineHeaderLeft}>
          <Text style={styles.timelineDate}>{formattedDate}</Text>
          {locationText ? (
            <Text style={styles.timelineLocation} numberOfLines={1}>{locationText}</Text>
          ) : null}
        </View>
        <Text style={styles.timelineCount}>
          ({t('category.photosCount', { count: imagesForDate.length })}
          {someSelected && ` · ${t('category.selectedCountSimple', { count: selectedCount })}`}
          )
        </Text>
      </View>
      {someSelected && (
        <View style={styles.timelineSelectionIndicator}>
          <Text style={styles.timelineSelectionText}>
            {allSelected ? t('category.allSelected') : t('category.partiallySelected')}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

// Simplified image item component
const ImageItem = React.forwardRef(({ item, isSelected, isHighlighted, isInStagingBox, onPress, onLongPress, onRightPress, isVisible = true }, ref) => {
  const { t } = useTranslation('common');
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  
  // 懒加载逻辑：当图片可见时开始加载图片
  useEffect(() => {
    if (isVisible && !shouldLoad) {
      setShouldLoad(true);
    }
  }, [isVisible]);
  
  // 直接使用传入的item数据，不需要额外加载
  const displayItem = item;
  
  // 直接使用 getUri 获取的 URI（PC端：file://，移动端：content://）
  const imageUri = getUri(displayItem);
  
  // 调试日志（已注释以减少控制台输出）
  // if (shouldLoad) {
  //   logger.debug(`图片加载状态: ${item.id}, shouldLoad: ${shouldLoad}, imageUri: ${imageUri}, imageError: ${imageError}`);
  //   logger.debug(`原始数据: item.uri=${item.uri}, displayItem.uri=${displayItem?.uri}`);
  //   logger.debug(`分类信息: item.category=${item.category}, displayItem.category=${displayItem?.category}`);
  //   if (!imageUri) {
  //     logger.warn(`图片缺少URI: ${item.id}, 将显示占位符`);
  //   }
  // }
  
  // 只在出现问题时输出警告
  if (shouldLoad && !imageUri) {
    logger.warn(`⚠️ 图片缺少URI: ${item.id}, 将显示占位符`);
  }
  
  const handleImageLoad = () => {
    setImageLoading(false);
    setImageError(false);
  };
  
  const handleImageError = (error) => {
    logger.error('Image load error for:', item.fileName, error.nativeEvent?.error);
    setImageError(true);
    setImageLoading(false);
  };

  // 右键点击处理 - 阻止默认右键菜单
  const handleContextMenu = (event) => {
    event.preventDefault(); // 阻止默认的右键菜单
  };
  
  return (
    <TouchableOpacity
      ref={ref}
      dataSet={{ imageId: item.id }}
      style={[
        styles.imageItem, 
        isSelected && styles.selectedImage,
        isHovered && styles.imageHovered,
        isHighlighted && styles.highlightedImage
      ]}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      onContextMenu={handleContextMenu}
      onMouseDown={(event) => {
        if (event.button === 2) { // 右键点击
          logger.debug(`鼠标右键按下: ${item.id}`);
          event.preventDefault(); // 阻止默认右键菜单
          if (onRightPress) {
            logger.debug(`调用onRightPress: ${item.id}`);
            onRightPress(item);
          } else {
            logger.warn(`onRightPress未定义: ${item.id}`);
          }
        }
      }}
      activeOpacity={0.8}
      onPressIn={() => setIsHovered(true)}
      onPressOut={() => setIsHovered(false)}>
      
      {/* Display image */}
      {shouldLoad ? (
        imageUri && !imageError ? (
        <>
          {imageLoading && (
            <View style={styles.imageLoadingOverlay}>
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          )}
        <Image
            source={{ uri: imageUri }}
          style={styles.image}
          resizeMode="cover"
            onLoad={handleImageLoad}
            onError={handleImageError}
        />
        </>
      ) : (
        <View style={styles.imagePlaceholder}>
          <Text style={styles.placeholderText}>📷</Text>
          <Text style={styles.placeholderFileName} numberOfLines={1}>
            {displayItem.fileName || 'Image'}
          </Text>
          <Text style={styles.placeholderSubtext} numberOfLines={1}>
            {imageError ? 'Load failed' : (imageUri ? 'Local file' : 'Loading...')}
            </Text>
          </View>
        )
      ) : (
        <View style={styles.imagePlaceholder}>
          <Text style={styles.placeholderText}>⏳</Text>
          <Text style={styles.placeholderFileName} numberOfLines={1}>
            {displayItem.fileName || 'Image'}
          </Text>
          <Text style={styles.placeholderSubtext} numberOfLines={1}>
            {!isVisible ? 'Lazy loading...' : 'Loading...'}
          </Text>
        </View>
      )}
      
      {/* Selection indicator */}
      {isSelected && (
        <View style={styles.selectionIndicator}>
          <Text style={styles.selectionText}>✓</Text>
        </View>
      )}
      
      {/* 已暂存标签（只在非暂存箱分类中显示） */}
      {isInStagingBox && (
        <View style={styles.stagingBoxBadge}>
          <Text style={styles.stagingBoxBadgeText}>{t('category.staged')}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});
ImageItem.displayName = 'ImageItem';

const CategoryScreen = ({ 
  filterType: propFilterType,
  filterValue: propFilterValue,
  currentImageId: propCurrentImageId,
  currentPage: propCurrentPage,
  onBack, 
  forceRefresh = true, 
  scrollToImageId = null,
  route = null,
  navigation = null,
  initialPage = 1,
  itemsPerPage: propItemsPerPage = 50,
  onPageChange = null
}) => {
  const { t, i18n } = useTranslation('common');
  
  // 统一使用 filterType 和 filterValue
  const filterType = propFilterType || route?.params?.filterType;
  const filterValue = propFilterValue || route?.params?.filterValue;
  
  
  // 从统一数据服务获取数据
  const [allImages, setAllImages] = useState([]);
  
  // 高亮图片状态（从ImagePreview返回时使用）
  const [highlightedImageId, setHighlightedImageId] = useState(null);
  // 暂存箱图片ID集合（用于快速检查图片是否在暂存箱中）
  const [stagingBoxImageIds, setStagingBoxImageIds] = useState(new Set());
  const scrollViewRef = useRef(null);
  const imageRefs = useRef({});
  
  // 加载图片数据的函数
  /**
   * 截断过长的文本，添加省略号
   */
  const truncateText = useCallback((text, maxLength = 20) => {
    if (!text || typeof text !== 'string') return text;
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }, []);

  const loadImages = useCallback(async () => {
    try {
      // 🆕 防御性检查：某些 filterType 需要 filterValue
      if (filterType && filterType !== 'stagingBox') {
        // stagingBox 不需要 filterValue，其他类型都需要
        if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
          logger.warn(`filterType=${filterType} 需要 filterValue，但 filterValue 为空，返回空数组`);
          setAllImages([]);
          setSelectedImages([]);
          setStagingBoxImageIds(new Set());
          return;
        }
      }
      
      // 🆕 使用统一的接口获取图片数据
      const images = await UnifiedDataService.readImagesByFilter(filterType, filterValue);
      logger.debug(`从 ${filterType}(${filterValue}) 获取图片: 总数=${images.length}`);
      
      // 🆕 使用统一的接口获取选中状态（数据服务自己从缓存获取图片数据）
      const selectedImages = await UnifiedDataService.getSelectedImagesByFilter(filterType, filterValue);
      const selectedImageIds = selectedImages.map(img => img.id);
      logger.debug(`选中状态: ${selectedImageIds.length} 张图片被选中`);
      
      // 如果当前分类不是暂存箱，检查哪些图片在暂存箱中
      let stagingBoxIds = new Set();
      if (filterType !== 'stagingBox') {
        try {
          const stagingBoxImages = await UnifiedDataService.getStagingBoxImages();
          stagingBoxIds = new Set(stagingBoxImages.map(img => img.id));
          logger.debug(`暂存箱图片数量: ${stagingBoxIds.size}`);
        } catch (error) {
          logger.error('获取暂存箱图片失败:', error);
        }
      }
      
      setAllImages(images);
      setSelectedImages(selectedImageIds);
      setStagingBoxImageIds(stagingBoxIds);
    } catch (error) {
      logger.error('获取图片数据失败:', error);
      setAllImages([]);
      setSelectedImages([]);
      setStagingBoxImageIds(new Set());
    }
  }, [filterType, filterValue]);

  // 初始加载图片数据
  useEffect(() => {
    loadImages();
  }, [loadImages, filterType, filterValue]);

  // 按城市筛选时，locationId 对应的显示名称（与当前语言一致）
  const [cityDisplayName, setCityDisplayName] = useState('');
  useEffect(() => {
    if (filterType !== 'city' || !filterValue) {
      setCityDisplayName('');
      return;
    }
    cityLocationService.getLocationName(filterValue, i18n.language || 'zh')
      .then((name) => setCityDisplayName(name || filterValue))
      .catch(() => setCityDisplayName(filterValue));
  }, [filterType, filterValue, i18n.language]);

  // 必要的UI状态
  const [selectAll, setSelectAll] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  
  // 选中状态将在 loadImages 中统一加载
  
  
  // 创建稳定的 getIsSelected 函数，使用 ref 避免依赖变化
  const selectedImagesRef = useRef(selectedImages);
  selectedImagesRef.current = selectedImages;
  
  const getIsSelected = useCallback((id) => {
    return selectedImagesRef.current.includes(id);
  }, []); // 空依赖数组，函数引用永远不变

  // 切换图片选中状态
  const toggleImageSelection = useCallback((imageId) => {
    setSelectedImages(prev => {
      const wasSelected = prev.includes(imageId);
      const newSelectedImages = wasSelected
        ? prev.filter(id => id !== imageId)
        : [...prev, imageId];
      
      // 同时更新 UnifiedDataService 的全局状态
      UnifiedDataService.setImageSelection(imageId, !wasSelected);
      
      // 发送自定义事件通知所有组件选中状态变化
      const event = new CustomEvent('imageSelectionChanged', {
        detail: {
          imageId: imageId,
          isSelected: !wasSelected
        }
      });
      window.dispatchEvent(event);
      
      return newSelectedImages;
    });
  }, []);

  // 全选/取消全选
  const toggleSelectAll = useCallback(() => {
    if (selectedImages.length === allImages.length && allImages.length > 0) {
      // 如果全部选中，则取消全选
      // 直接清除所有选中状态，避免循环依赖
      const allImageIds = allImages.map(img => img.id);
      setSelectedImages([]);
      allImageIds.forEach(id => {
        UnifiedDataService.setImageSelection(id, false);
        window.dispatchEvent(new CustomEvent('imageSelectionChanged', {
          detail: { imageId: id, isSelected: false }
        }));
      });
      setSelectAll(false);
    } else {
      // 否则全选当前页面的所有图片
      const allImageIds = allImages.map(img => img.id);
      setSelectedImages(allImageIds);
      // 统一使用添加到选中状态
      UnifiedDataService.addToSelection(allImageIds);
      // 发送全选事件通知图片组件
      allImages.forEach(img => {
        const event = new CustomEvent('imageSelectionChanged', {
          detail: {
            imageId: img.id,
            isSelected: true
          }
        });
        window.dispatchEvent(event);
      });
    }
  }, [selectedImages.length, allImages]);
  
  
  // 删除进度状态
  const [showDeleteProgress, setShowDeleteProgress] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ filesDeleted: 0, filesFailed: 0, total: 0 });

  // 整理到文件夹（物理迁移）状态
  const [showMigrateDialog, setShowMigrateDialog] = useState(false);
  const [migrateMode, setMigrateMode] = useState('copy'); // 'copy' | 'move'
  const [migrateProgress, setMigrateProgress] = useState(null); // {done,total} | null
  
  // 操作菜单状态
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showCategorySubmenu, setShowCategorySubmenu] = useState(false);
  const [showEnhanceSubmenu, setShowEnhanceSubmenu] = useState(false);
  const [selectionVersion, setSelectionVersion] = useState(0); // 用于强制刷新选中计数
  
  // ==================== AI图像增强相关状态 ====================
  const [showEnhanceModal, setShowEnhanceModal] = useState(false);
  const [enhancePreset, setEnhancePreset] = useState('portrait');
  const [currentImageIndex, setCurrentImageIndex] = useState(0); // 当前查看的图片索引
  const [availableEnhancePresets, setAvailableEnhancePresets] = useState([]); // AI增强预设方案列表
  
  // 分页相关状态 - 优先使用从prop传递的值（返回时恢复）
  const [currentPage, setCurrentPage] = useState(propCurrentPage || initialPage);
  const [itemsPerPage, setItemsPerPage] = useState(propItemsPerPage);
  const [totalPages, setTotalPages] = useState(0);
  const [pageInput, setPageInput] = useState('');
  
  // 下拉选择框状态
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownOptions = [20, 50, 100, 1000];
  
  // 虚拟滚动相关状态
  const [scrollOffset, setScrollOffset] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  
  // 监听选中状态变化，强制刷新Header
  useEffect(() => {
    const handleSelectionChange = () => {
      // 使用 setTimeout 延迟状态更新，避免在渲染期间调用 setState
      setTimeout(() => {
        setSelectionVersion(v => v + 1);
      }, 0);
    };
    
    window.addEventListener('imageSelectionChanged', handleSelectionChange);
    return () => {
      window.removeEventListener('imageSelectionChanged', handleSelectionChange);
    };
  }, []);
  
  // 点击外部关闭操作菜单
  useEffect(() => {
    if (showActionMenu) {
      const handleClickOutside = () => {
        setShowActionMenu(false);
        setShowCategorySubmenu(false);
      };
      
      document.addEventListener('click', handleClickOutside);
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [showActionMenu]);
  
  // 加载AI增强预设方案
  useEffect(() => {
    const loadEnhancePresets = async () => {
      try {
        const imageStorageService = UnifiedDataService.imageStorageService;
        if (imageStorageService) {
          const settings = await imageStorageService.getSettings();
          if (settings?.aiEnhancePresets) {
            // 获取当前语言的默认预设翻译
            const currentLang = i18n.language || 'zh';
            const defaultPresets = getDefaultPresets(currentLang);
            const zhDefaults = getDefaultPresets('zh');
            const enDefaults = getDefaultPresets('en');
            
            const presets = Object.entries(settings.aiEnhancePresets)
              .filter(([_, preset]) => preset.enabled !== false) // 只显示启用的方案
              .sort(([_, a], [__, b]) => (a.sortOrder || 0) - (b.sortOrder || 0)) // 按sortOrder排序
              .map(([id, preset]) => {
                // 判断是否是默认预设（通过比较名称是否等于中文或英文的默认值）
                const defaultPreset = defaultPresets[id];
                const isDefaultName = defaultPreset && (
                  preset.name === zhDefaults[id]?.name ||
                  preset.name === enDefaults[id]?.name
                );
                
                // 如果是默认预设，使用当前语言的翻译；否则使用用户自定义的名称
                const displayName = isDefaultName ? defaultPreset.name : preset.name;
                
                return {
                  id,
                  name: displayName,
                  icon: preset.icon,
                  description: preset.description,
                  prompt: preset.prompt
                };
              });
            
            setAvailableEnhancePresets(presets);
            logger.debug('📋 可用增强方案数量:', presets.length);
          }
        }
      } catch (error) {
        logger.error('加载AI增强预设方案失败:', error);
      }
    };
    
    loadEnhancePresets();
    
    // 监听设置更新事件，当用户在设置页面修改增强方案时自动刷新
    const handleSettingsUpdated = (event) => {
      if (event.detail?.key === 'aiEnhancePresets') {
        logger.debug('📋 检测到AI增强预设已更新，重新加载');
        loadEnhancePresets();
      }
    };
    
    if (typeof window !== 'undefined') {
      window.addEventListener('settingsUpdated', handleSettingsUpdated);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('settingsUpdated', handleSettingsUpdated);
      }
    };
  }, [i18n.language]); // 当语言改变时重新加载预设
  
  // 监听从ImagePreview返回时的页码，恢复状态
  useEffect(() => {
    if (propCurrentPage !== undefined && propCurrentPage !== null) {
      // 计算当前数据的总页数
      const totalPagesForCurrentData = Math.max(1, Math.ceil(allImages.length / itemsPerPage));
      
      // 验证页码是否在有效范围内
      if (propCurrentPage > 0 && propCurrentPage <= totalPagesForCurrentData) {
        logger.debug('📄 恢复页码:', propCurrentPage, `(总页数: ${totalPagesForCurrentData})`);
        setCurrentPage(propCurrentPage);
      } else {
        logger.warn(`⚠️ 页码超出范围: ${propCurrentPage} > ${totalPagesForCurrentData}，重置为第1页`);
        setCurrentPage(1);
      }
    }
  }, [propCurrentPage, allImages.length, itemsPerPage]);
  
  // 监听从ImagePreview返回时的currentImageId，进行高亮和滚动
  useEffect(() => {
    const currentImageId = propCurrentImageId || route?.params?.currentImageId;
    if (!currentImageId) {
      return; // 没有图片ID，直接返回
    }
    
    // 如果图片列表为空，等待数据加载完成
    if (allImages.length === 0) {
      return;
    }
    
    // 验证图片是否在当前分类/城市/相似组中
    const imageExists = allImages.some(img => img.id === currentImageId);
    
    if (!imageExists) {
      return; // 提前返回，不执行高亮和滚动
    }
    
    // 设置高亮状态（一直保持，直到用户查看另一张照片）
    setHighlightedImageId(currentImageId);
    
    // 滚动到该图片位置 - 在Web环境使用DOM API
    const scrollTimer = setTimeout(() => {
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        // Web环境：使用DOM查询和scrollIntoView
        // 方法1：通过data-image-id属性查找
        const domElement = document.querySelector(`[data-image-id="${currentImageId}"]`);
        
        if (domElement) {
          try {
            domElement.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'center',
              inline: 'nearest'
            });
          } catch (error) {
            logger.error('❌ scrollIntoView失败:', error);
          }
        }
      } else {
        // 非Web环境的降级方案
        const imageElement = imageRefs.current[currentImageId];
        if (imageElement && scrollViewRef.current) {
          imageElement.measureLayout(
            scrollViewRef.current,
            (x, y) => {
              scrollViewRef.current.scrollTo({ y: y - 100, animated: true });
            },
            (error) => {
              logger.warn('❌ measureLayout失败:', error);
            }
          );
        }
      }
    }, 500); // 增加延迟到500ms，确保DOM已完全渲染
    
    return () => {
      clearTimeout(scrollTimer);
    };
  }, [propCurrentImageId, route?.params?.currentImageId, allImages]);
  
  // 关闭下拉框
  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
  }, []);

  // 按日期分组当前页面的图片（时间轴功能）- 使用useMemo缓存结果
  const getLocalDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const groupedImages = useMemo(() => {
    // 早期返回：如果没有图片，直接返回空结果
    if (!allImages || allImages.length === 0) {
      return { grouped: {}, sortedDates: [] };
    }
    
    const grouped = {};
    
    // 如果照片数量不超过100，显示所有照片；否则分页显示
    let currentPageImages;
    if (allImages.length <= 100) {
      currentPageImages = allImages;
    } else {
      const startIndex = (currentPage - 1) * itemsPerPage;
      const endIndex = Math.min(startIndex + itemsPerPage, allImages.length);
      currentPageImages = allImages.slice(startIndex, endIndex);
    }
    
    // 早期返回：如果当前页面没有图片，直接返回空结果
    if (currentPageImages.length === 0) {
      return { grouped: {}, sortedDates: [] };
    }
    
    // 只对当前页面的图片进行分组，提高性能
    currentPageImages.forEach(image => {
      // 优先使用拍摄时间（takenAt），如果没有则使用文件时间（timestamp）
      let date;
      if (image.takenAt) {
        date = new Date(image.takenAt);
      } else if (image.timestamp) {
        date = new Date(image.timestamp);
      } else if (image.createdAt) {
        date = new Date(image.createdAt);
      } else if (image.modifiedAt) {
        date = new Date(image.modifiedAt);
      } else {
        date = new Date();
      }
      
      const dateKey = getLocalDateKey(date); // YYYY-MM-DD格式
      
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(image);
    });
    
    // 对每个日期组内的图片按拍摄时间排序
    // 如果没有拍摄时间，则按文件时间排序
    Object.keys(grouped).forEach(dateKey => {
      grouped[dateKey].sort((a, b) => {
        const timeA = a.takenAt || a.timestamp || a.createdAt || a.modifiedAt || 0;
        const timeB = b.takenAt || b.timestamp || b.createdAt || b.modifiedAt || 0;
        return new Date(timeB) - new Date(timeA); // 最新的在前
      });
    });
    
    // 按日期倒序排列（最新的日期在前）
    const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));
    
    return { grouped, sortedDates };
  }, [allImages, currentPage, itemsPerPage]);
  
  // 移除无用的刷新状态（分页方案不需要下拉刷新）
  
  // 图片详细信息缓存
  
  
  // 固定布局参数
  const layoutParams = {
    itemWidth: 120,
    itemHeight: 120,
    gap: 12
  };
  
  // 滚动到指定图片的函数（分页版本）
  // 使用ref来存储最新的currentPage值，避免循环依赖
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  const scrollToImage = useCallback((imageId) => {
    // 直接使用最新的allImages，避免闭包问题
    const currentImages = allImages;
    if (!imageId || currentImages.length === 0) return;
    
    const imageIndex = currentImages.findIndex(img => img.id === imageId);
    if (imageIndex === -1) return;
    
    // 计算图片所在的页码
    const targetPage = Math.floor(imageIndex / itemsPerPage) + 1;
    const currentPageValue = currentPageRef.current; // 使用ref获取最新值
    
    logger.debug(`滚动到图片 ${imageId}，索引: ${imageIndex}，目标页码: ${targetPage}，当前页码: ${currentPageValue}`);
    
    // 如果目标页码不是当前页码，直接跳转到目标页码
    if (targetPage !== currentPageValue) {
      logger.debug(`直接跳转到第${targetPage}页以显示图片`);
      setCurrentPage(targetPage);
      // 页码跳转后，图片会自动显示在正确位置，不需要额外滚动
    } else {
      // 如果已经在正确页码，滚动到顶部确保图片可见
      if (scrollViewRef.current) {
    scrollViewRef.current.scrollTo({
          y: 0,
      animated: true
    });
      }
      logger.debug(`已在正确页码，图片应该可见`);
    }
  }, [itemsPerPage, allImages]); // 只依赖itemsPerPage和allImages
  
  // 当有scrollToImageId且数据加载完成时，滚动到指定图片
  useEffect(() => {
    if (scrollToImageId && allImages.length > 0) {
      // 延迟一点时间确保DOM已经渲染
      setTimeout(() => {
        scrollToImage(scrollToImageId);
      }, 100);
    }
  }, [scrollToImageId, allImages.length]); // 移除scrollToImage依赖，函数已经用useCallback稳定

  
  // FlatList自动处理虚拟滚动，不再需要手动计算可见范围

  // 分页数据计算
  const paginationData = useMemo(() => {
    const safeImages = allImages || [];
    const total = safeImages.length;
    
    // 如果照片数量不超过100，显示所有照片，不分页
    if (total <= 100) {
      logger.debug(`照片数量${total}张，不超过100张，显示全部照片`);
      return {
        currentPageImages: safeImages,
        totalPages: 1,
        startIndex: 0,
        endIndex: total,
        total
      };
    }
    
    // 照片数量超过100张，使用分页
    const totalPagesCount = Math.ceil(total / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, total);
    const currentPageImages = safeImages.slice(startIndex, endIndex);
    
    logger.debug(`分页数据: 第${currentPage}页/${totalPagesCount}页, 显示${currentPageImages.length}张图片 (${startIndex}-${endIndex-1})`);
    
    return {
      currentPageImages,
      totalPages: totalPagesCount,
      startIndex,
      endIndex,
      total
    };
  }, [allImages, currentPage, itemsPerPage]);
  
  // 移除无用的getVisibleImageDetails函数（虚拟滚动时代遗留）


  // 移除无用的 containerRef useEffect，使用 ScrollView 的 onLayout 代替

  // 移除动态布局监听，使用固定尺寸

  // 移除无用的初始化useEffect（只打印日志，无实际作用）

  // 当初始页面或每页数量参数变化时更新状态
  // 注意：不再需要监听initialPage变化，因为：
  // 1. useState已经在初始化时使用了propCurrentPage || initialPage
  // 2. 从ImagePreview返回时通过propCurrentPage的useEffect恢复
  // 3. 这个useEffect会错误地将已恢复的currentPage重置回initialPage

  useEffect(() => {
    if (propItemsPerPage !== itemsPerPage) {
      logger.debug(`每页数量参数变化: ${propItemsPerPage}`);
      setItemsPerPage(propItemsPerPage);
    }
  }, [propItemsPerPage]); // 只依赖propItemsPerPage，不依赖itemsPerPage

 

  // Image click handler - 传递图片对象和上下文信息
  const handleImagePress = useCallback((image) => {
    // 跳转到图片预览页面，传递图片对象和上下文信息
    if (navigation?.onImagePress) {
      // 统一传递 filterType 和 filterValue
      const contextProps = {
        filterType,
        filterValue,
        currentPage, // 保存当前页码，返回时恢复
        itemsPerPage // 🔥 新增：保存每页数量，返回时恢复
      };
         
      navigation.onImagePress(image, null, contextProps);
    }
  }, [navigation, filterType, filterValue, currentPage, itemsPerPage]); // 🔥 添加 itemsPerPage 依赖

  // Image long press handler
  const handleImageLongPress = useCallback((image) => {
    // 长按直接选中图片，不清除其他选中状态
    UnifiedDataService.setImageSelection(image.id, true);
  }, []);

  // Image right click handler
  const handleImageRightPress = useCallback((image) => {
    logger.debug(`处理右键点击: ${image.id}`);
    // 右键点击直接切换图片的选中状态
    toggleImageSelection(image.id);
  }, [toggleImageSelection]);

  // 🆕 获取当前选中的图片（使用统一接口，数据服务自己从缓存获取）
  const getCurrentSelectedImages = useCallback(async () => {
    return await UnifiedDataService.getSelectedImagesByFilter(filterType, filterValue);
  }, [filterType, filterValue]);

  // Clear current selections (清除当前分类或城市的选中状态)
  const clearCategorySelections = useCallback(async () => {
    // 统一使用 getCurrentSelectedImages 获取当前选中的图片，然后清除它们的选中状态
    const currentSelected = await getCurrentSelectedImages();
    const imageIds = currentSelected.map(img => img.id);
    
    // 清除选中状态
    imageIds.forEach(id => {
      UnifiedDataService.setImageSelection(id, false);
      window.dispatchEvent(new CustomEvent('imageSelectionChanged', {
        detail: { imageId: id, isSelected: false }
      }));
    });
    
    logger.debug(`清除选中状态: 操作了 ${imageIds.length} 张图片`);
    
    // 清除本地状态
    setSelectedImages([]);
    setSelectAll(false);
  }, [getCurrentSelectedImages]);

  const buildFilePathList = (images) => {
    const filePaths = [];
    for (const image of images) {
      // 直接使用 getLocalPath，它内部已经处理了路径标准化
      const imagePath = getLocalPath(image);
      if (!imagePath) {
        logger.error('⚠️ 数据库缺少图片本地路径:', {
          imageId: image?.id,
          fileName: image?.fileName,
          uri: image?.uri,
          hasPath: !!image?.path
        });
        continue;
      }
      
      logger.debug(`📋 处理图片:`, {
        id: image?.id,
        path: imagePath,
        fileName: image?.fileName
      });
      
      // getLocalPath 已经返回标准化路径，直接使用
      // 对于 Windows，路径分隔符已经是反斜杠（在 normalizeFilePath 中处理）
      filePaths.push(imagePath);
    }
    logger.debug(`📋 最终文件路径列表:`, filePaths);
    return filePaths;
  };

  const copyFilePathsToClipboard = useCallback(async (filePaths, { successTitle, successMessage }) => {
    if (typeof window === 'undefined' || !window.require) {
      Alert.alert(t('common.error'), t('category.currentEnvNotSupportCopy'));
      return { success: false };
    }

    const { ipcRenderer } = window.require('electron');

    return new Promise((resolve) => {
      ipcRenderer.once('copy-files-result', (event, result) => {
        if (result.success) {
          Alert.alert(successTitle, successMessage(result));
        } else {
          Alert.alert(t('common.failed'), t('category.copyFailed'));
        }
        resolve(result);
      });
      ipcRenderer.send('copy-files-to-clipboard', filePaths);
    });
  }, []);

  // 复制选中的图片到剪贴板（用于分享）
  const handleCopyToClipboard = useCallback(async () => {
    try {
      const selectedImages = await getCurrentSelectedImages();
      logger.debug(`📋 复制操作 - 选中图片数量: ${selectedImages.length}`);
      logger.debug(`📋 第一个图片对象:`, selectedImages[0]);
      
      if (selectedImages.length === 0) {
        Alert.alert(t('common.confirm'), t('category.pleaseSelectImagesToCopy'));
        return;
      }

      if (selectedImages.length > 9) {
        Alert.alert(
          t('common.confirm'),
          t('category.copyToClipboardLimit', { count: selectedImages.length })
        );
        return;
      }

      const filePaths = buildFilePathList(selectedImages);

      if (filePaths.length === 0) {
        Alert.alert(t('common.error'), t('category.noValidImagePath'));
        return;
      }

      await copyFilePathsToClipboard(filePaths, {
        successTitle: t('category.copySuccess'),
        successMessage: () => t('category.copyToClipboardSuccess', { count: filePaths.length })
      });
    } catch (error) {
      logger.error('复制文件到剪贴板失败:', error);
      Alert.alert(t('common.error'), t('category.copyError', { error: error.message }));
    }
  }, [getCurrentSelectedImages, copyFilePathsToClipboard]);

  // 整理到文件夹：选目标根目录 → 移动/复制选中分类照片 → DB 同步 + 刷新。
  const handleMigrateToFolder = async (mode) => {
    try {
      const { ipcRenderer } = window.require('electron');
      const picked = await ipcRenderer.invoke('select-folder');
      if (!picked || !picked.success || !picked.path) return; // 用户取消
      const selected = await getCurrentSelectedImages();
      if (!selected || selected.length === 0) {
        Alert.alert(t('common.tip', { defaultValue: '提示' }), t('category.migrateNoSelection', { defaultValue: '请先选择要整理的照片' }));
        return;
      }
      setShowMigrateDialog(false);
      setMigrateProgress({ done: 0, total: selected.length });
      // eslint-disable-next-line global-require
      const { migrateCategories } = require('../../services/desktop/fileMigration');
      const res = await migrateCategories({
        images: selected,
        rootDir: picked.path.replace(/\\/g, '/'),
        mode,
        onProgress: (done, total) => setMigrateProgress({ done, total }),
      });
      setMigrateProgress(null);
      Alert.alert(
        t('category.migrateDone', { defaultValue: '整理完成' }),
        t('category.migrateSummary', { defaultValue: '成功 {{ok}} 张，失败 {{fail}} 张，跳过 {{skipped}} 张', ok: res.ok, fail: res.fail, skipped: res.skipped }),
      );
      await loadImages(); // 刷新当前页（uri 已变）
    } catch (e) {
      setMigrateProgress(null);
      Alert.alert(t('common.tip', { defaultValue: '提示' }), e?.message || String(e));
    }
  };

  // 复制选中的图片到文件管理器（无限制）
  const handleCopyToFileManager = useCallback(async () => {
    try {
      const selectedImages = await getCurrentSelectedImages();
      logger.debug(`📂 文件管理器复制 - 选中图片数量: ${selectedImages.length}`);
      
      if (selectedImages.length === 0) {
        Alert.alert(t('common.confirm'), t('category.pleaseSelectImagesToCopy'));
        return;
      }

      const filePaths = buildFilePathList(selectedImages);

      if (filePaths.length === 0) {
        Alert.alert(t('common.error'), t('category.noValidImagePath'));
        return;
      }

      await copyFilePathsToClipboard(filePaths, {
        successTitle: t('category.copySuccess'),
        successMessage: () => t('category.copyToFileManagerSuccess', { count: filePaths.length })
      });
    } catch (error) {
      logger.error('复制文件路径失败:', error);
      Alert.alert(t('common.error'), t('category.copyError', { error: error.message }));
    }
  }, [getCurrentSelectedImages, copyFilePathsToClipboard]);

  // 批量修改分类
  const handleBatchChangeCategory = useCallback(async (newCategory) => {
    try {
      // 获取选中图片 - 统一使用 getCurrentSelectedImages
      const selectedImagesList = await getCurrentSelectedImages();
      
      const selectedCount = selectedImagesList.length;
      
      if (selectedCount === 0) {
        Alert.alert(t('common.confirm'), t('category.pleaseSelectImagesToModify'));
        return;
      }
      
      // 获取目标分类的显示名称
      const configService = UnifiedDataService.configService;
      const categoryMap = configService.getCategoryNameMap();
      const targetCategoryName = categoryMap[newCategory]?.chinese || newCategory;
      
      Alert.alert(
        t('category.batchChangeCategory'),
        t('category.confirmChangeCategory', { count: selectedCount, category: targetCategoryName }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            style: 'default',
            onPress: async () => {
              try {
                const imageIds = selectedImagesList.map(image => image.id);
                const result = await UnifiedDataService.updateImagesCategory(imageIds, newCategory, 'manual');
                const processed = result?.processed ?? imageIds.length;
                
                // 批量清除选中状态
                for (const image of selectedImagesList) {
                  UnifiedDataService.setImageSelection(image.id, false);
                }
                
                logger.debug('✅ 已清除选中状态，准备重新加载数据');
                
                // 检查清除后的统计
                const afterClearCounts = UnifiedDataService.getSelectedCountsByCategory();
                logger.debug('🔍 清除后的分类选中统计:', afterClearCounts);
                
                // 重新加载图片数据
                await loadImages();
                
                logger.debug('✅ 数据重新加载完成');
                
                // 强制刷新Header以更新选中计数
                setSelectionVersion(v => v + 1);
                
                logger.debug('✅ 已触发Header刷新');
                
                Alert.alert(t('category.operationComplete'), t('category.changeCategorySuccess', { count: processed }));
                
              } catch (error) {
                logger.error('批量修改分类失败:', error);
                Alert.alert(t('settings.operationFailed'), t('category.changeCategoryFailed'));
              }
            },
          },
        ]
      );
      
    } catch (error) {
      logger.error('批量修改分类失败:', error);
      Alert.alert(t('common.error'), t('settings.operationFailed'));
    }
  }, [filterType, filterValue, loadImages, t]);

  // ==================== AI图像增强处理函数 ====================
  // 事件处理函数：接收preset参数，直接开始处理
  const handleAIEnhance = async (preset) => {
    logger.debug('🎨 开始照片创玩, 方案:', preset);
    
    // 捕获当前选中的图片（快照）
    const selectedCount = selectedImages.length;
    
    // 检查是否有选中图片
    if (selectedCount === 0) {
      Alert.alert(t('category.tip'), t('category.pleaseSelectImagesToEnhance'));
      return;
    }
    
    // 检查数量限制（最多9张）
    const MAX_ENHANCE_COUNT = 9;
    if (selectedCount > MAX_ENHANCE_COUNT) {
      Alert.alert(
        t('category.tip'),
        t('category.enhanceCountLimit', { max: MAX_ENHANCE_COUNT }),
        [
          { text: t('common.confirm'), style: 'default' }
        ]
      );
      return;
    }

    // 🔥 在打开模态框前检查额度
    try {
      const credits = await WeChatAuthService.getCredits();
      if (!credits || typeof credits.remaining !== 'number') {
        Alert.alert(
          t('common.error'),
          t('category.getCreditsFailed') || t('imagePreview.cannotCheckCredits')
        );
        return; // 不打开模态框
      }

      // 如果用户未关注公众号，跳过额度检查，直接打开模态框
      if (credits.isFollowed === false) {
        const imagesToEnhance = allImages.filter(img => selectedImages.includes(img.id));
        logger.debug('📸 捕获图片快照:', imagesToEnhance.length, '张图片');
        
        setEnhancePreset(preset);
        setCurrentImageIndex(0);
        setShowEnhanceModal(true);
        return;
      }
      
      // 已关注公众号，进行额度检查
      if (credits.remaining < selectedCount) {
        Alert.alert(
          t('category.insufficientCredits') || t('common.tip'),
          t('category.insufficientCreditsMessageFollowWeChat', { remaining: credits.remaining, count: selectedCount })
        );
        return; // 不打开模态框
      }

      // 额度充足，弹出二次确认
      Alert.alert(
        t('category.tip'),
        t('category.enhanceConfirmMessage', { count: selectedCount, remaining: credits.remaining }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirm'),
            onPress: () => {
              // 确认后才打开模态框
              const imagesToEnhance = allImages.filter(img => selectedImages.includes(img.id));
              logger.debug('📸 捕获图片快照:', imagesToEnhance.length, '张图片');
              
              setEnhancePreset(preset);
              setCurrentImageIndex(0);
              setShowEnhanceModal(true);
            }
          }
        ]
      );
    } catch (error) {
      logger.error('检查额度失败:', error);
      Alert.alert(
        t('common.error'),
        t('category.getCreditsFailed') || t('imagePreview.cannotCheckCredits')
      );
      return; // 不打开模态框
    }
  };

  // 关闭增强模态框
  const handleCloseEnhanceModal = (hasSaved = false) => {
    setShowEnhanceModal(false);
    setEnhancePreset(null);
    
    // 如果有保存操作，重新加载数据
    if (hasSaved) {
      logger.debug('🔄 检测到保存操作，重新加载图片列表');
      loadImages();
    }
  };

  // 批量添加到暂存箱
  const handleBatchAddToStagingBox = useCallback(async () => {
    // 统一使用 getCurrentSelectedImages 获取选中图片
    const currentCategorySelectedImages = await getCurrentSelectedImages();
    const actualSelectedCount = currentCategorySelectedImages.length;
    
    if (actualSelectedCount === 0) return;

    Alert.alert(
      t('category.batchAddToStagingBox'),
      t('category.confirmAddToStagingBox', { count: actualSelectedCount }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.add'),
          style: 'default',
          onPress: async () => {
            try {
              const selectedImageIds = currentCategorySelectedImages.map(img => img.id);
              
              // 清除选中状态
              await clearCategorySelections();
              // 将图片添加到暂存箱（不修改category字段）
              const addResult = await UnifiedDataService.addToStagingBox(selectedImageIds);
              if (!addResult.success) {
                throw new Error(`${t('category.addToStagingBoxFailed')}: ${addResult.errors.map(e => e.error).join(', ')}`);
              }
              const processed = addResult.added || selectedImageIds.length;
              
              // 重新加载图片数据
              await loadImages();
              
              Alert.alert(t('category.operationComplete'), t('category.addToStagingBoxSuccess', { count: processed }));
              
            } catch (error) {
              Alert.alert(t('settings.operationFailed'), t('category.addToStagingBoxFailed'));
            }
          },
        },
      ]
    );
  }, [getCurrentSelectedImages, clearCategorySelections, loadImages]);

  // 批量从暂存箱移除
  const handleBatchRemoveFromStagingBox = useCallback(async () => {
    // 统一使用 getCurrentSelectedImages 获取选中图片
    const currentCategorySelectedImages = await getCurrentSelectedImages();
    const actualSelectedCount = currentCategorySelectedImages.length;
    
    if (actualSelectedCount === 0) return;

      Alert.alert(
      t('category.batchRemoveFromStagingBox'),
      t('category.confirmRemoveFromStagingBox', { count: actualSelectedCount }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('category.removeFromStagingBox'),
          style: 'default',
          onPress: async () => {
            try {
              const selectedImageIds = currentCategorySelectedImages.map(img => img.id);
              
              // 清除选中状态
              await clearCategorySelections();
              
              // 从暂存箱移除图片
              const removeResult = await UnifiedDataService.removeFromStagingBox(selectedImageIds);
              if (!removeResult.success) {
                const errorMessages = removeResult.errors?.map(e => e.error || e.message || t('common.error')).join(', ') || t('common.error');
                throw new Error(`${t('category.removeFromStagingBoxFailed')}: ${errorMessages}`);
              }
              
              const processed = removeResult.removed || selectedImageIds.length;
              
              // 重新加载图片数据
              await loadImages();
              
              Alert.alert(t('category.operationComplete'), t('category.removeFromStagingBoxSuccess', { count: processed }));
              
            } catch (error) {
              logger.error('从暂存箱移除失败:', error);
              Alert.alert(t('settings.operationFailed'), `${t('category.removeFromStagingBoxFailed')}: ${error.message}`);
            }
          },
        },
      ]
    );
  }, [getCurrentSelectedImages, clearCategorySelections, loadImages]);

  // 批量删除
  const handleBatchDelete = useCallback(async () => {
    // 统一使用 getCurrentSelectedImages 获取选中图片
    const currentCategorySelectedImages = await getCurrentSelectedImages();
    const actualSelectedCount = currentCategorySelectedImages.length;
    
    if (actualSelectedCount === 0) return;

    Alert.alert(
      t('category.batchDelete'),
      t('category.confirmDelete', { count: actualSelectedCount }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              setShowDeleteProgress(true);
              setDeleteProgress({ filesDeleted: 0, filesFailed: 0, total: actualSelectedCount });
              
              const selectedImageIds = currentCategorySelectedImages.map(img => img.id);
              const result = await UnifiedDataService.writeDeleteImages(
                selectedImageIds,
                (progress) => {
                  setDeleteProgress(progress);
                }
              );
              
              // 立即关闭删除进度对话框
              setShowDeleteProgress(false);
              
              // 检查删除结果
              if (result.filesFailed > 0) {
                // 有文件删除失败，显示权限提示
                Alert.alert(
                  t('category.deleteSuccess', { count: result.filesDeleted }), 
                  t('category.deletePartialSuccess', { deleted: result.filesDeleted, failed: result.filesFailed }),
                  [
                    { text: t('common.confirm'), style: 'default' }
                  ]
                );
                
                // 只移除成功删除的图片
                setAllImages(prevImages => prevImages.filter(img => !result.successfulImageIds.includes(img.id)));
              } else {
                // 全部删除成功，移除所有选中的图片
                setAllImages(prevImages => prevImages.filter(img => !selectedImageIds.includes(img.id)));
              }
              
              // 清除选中状态
              await clearCategorySelections();
              
              // 重新加载图片以确保UI正确更新
              await loadImages();
              
            } catch (error) {
              setShowDeleteProgress(false);
              Alert.alert(t('settings.operationFailed'), t('category.deleteFailed'));
            }
          },
        },
      ]
    );
  }, [getCurrentSelectedImages, clearCategorySelections, loadImages]);

  // Header 组件 - 可以重新渲染
  const HeaderComponent = () => {
    const { t: tHeader, i18n } = useTranslation('common');
    // 🆕 检查是否为暂存箱（基于filterType）
    const isStagingBox = filterType === 'stagingBox';
    
    // 获取所有分类列表（排除tobecleaned，因为暂存箱已独立）
    // 使用 getAllCategoriesWithUI() 确保顺序与配置文件中的 categoryDisplayOrder 一致
    const configService = UnifiedDataService.configService;
    let availableCategories = [];
    if (configService?.isConfigLoaded()) {
      availableCategories = configService.getAllCategoriesWithUI()
        .filter(cat => cat.id !== 'tobecleaned') // 排除旧的tobecleaned分类
        .map(cat => ({
          id: cat.id,
          chinese: cat.chinese,
          english: cat.english
        }));
    }
    
    // 使用本地selectedImages state计算选中数量
    // 这个state在loadImages时已经根据当前分类/城市/相似组过滤过了
    const currentSelectedCount = selectedImages.length;
    
    // logger.debug(`HeaderComponent 渲染: category=${category}, normalizedCategory=${normalizedCategory}, city=${city}, currentSelectedCount=${currentSelectedCount}`);
    
    return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          // 使用传入的 onBack 回调
          if (onBack) {
            onBack();
          }
        }}>
        <Text style={styles.backIcon}>←</Text>
      </TouchableOpacity>
      
      <Text style={styles.title}>
        {!filterType
          ? tHeader('category.imageList')
          : filterType === 'stagingBox'
          ? tHeader('category.stagingBoxWithCount', { count: allImages.length })
          : !filterValue
          ? tHeader('category.imageList')
          : filterType === 'similarityGroup'
          ? tHeader('category.similarityGroupWithCount', { count: allImages.length })
          : filterType === 'directory'
          ? tHeader('category.directoryWithCount', { name: truncateText(filterValue.split('/').pop() || filterValue, 20), count: allImages.length })
          : filterType === 'city'
          ? tHeader('category.cityWithCount', { city: cityDisplayName || filterValue, count: allImages.length })
          : filterType === 'color'
          ? tHeader('category.colorWithCount', { color: getColorNameTranslation(filterValue, i18n.language || 'zh'), count: allImages.length })
          : filterType === 'category'
          ? (() => {
              const currentLang = i18n.language || 'zh';
              const language = currentLang === 'en' ? 'english' : 'chinese';
              const categoryName = UnifiedDataService.configService?.getCategoryDisplayName(filterValue, language) || filterValue;
              return tHeader('category.categoryWithCount', { category: categoryName, count: allImages.length });
            })()
          : filterType === 'format'
          ? tHeader('category.formatWithCount', { format: filterValue, count: allImages.length })
          : filterType === 'resolution'
          ? tHeader('category.resolutionWithCount', { resolution: filterValue, count: allImages.length })
          : filterType === 'orientation'
          ? tHeader('category.orientationWithCount', { orientation: getOrientationNameTranslation(filterValue, i18n.language || 'zh'), count: allImages.length })
          : filterType === 'iso'
          ? tHeader('category.isoWithCount', { iso: getCameraSettingsCategoryTranslation('iso', filterValue, i18n.language || 'zh'), count: allImages.length })
          : filterType === 'aperture'
          ? tHeader('category.apertureWithCount', { aperture: getCameraSettingsCategoryTranslation('aperture', filterValue, i18n.language || 'zh'), count: allImages.length })
          : filterType === 'shutter'
          ? tHeader('category.shutterWithCount', { shutter: getCameraSettingsCategoryTranslation('shutter', filterValue, i18n.language || 'zh'), count: allImages.length })
          : filterType === 'focalLength'
          ? tHeader('category.focalLengthWithCount', { focalLength: getCameraSettingsCategoryTranslation('focalLength', filterValue, i18n.language || 'zh'), count: allImages.length })
          : filterType === 'time'
          ? (() => {
              const timeLabel = /^\d{4}$/.test(filterValue) ? tHeader('home.yearLabel', { year: filterValue }) : tHeader(`home.${filterValue}`);
              return tHeader('category.timeWithCount', { label: timeLabel, count: allImages.length });
            })()
          : tHeader('category.imageList')
        }
      </Text>
      
      
        {/* 分页控制 - 只在照片数量超过100时显示 */}
        {allImages.length > 100 && (
          <View style={styles.headerPagination}>
            <TouchableOpacity
              style={[styles.headerPageButton, currentPage === 1 && styles.headerPageButtonDisabled]}
              onPress={goToPreviousPage}
              disabled={currentPage === 1}
            >
              <Text style={styles.headerPageButtonText}>{t('category.previousPage')}</Text>
            </TouchableOpacity>
            
            <View style={styles.headerPageInfo}>
              <Text style={styles.headerPageInfoText}>
                {tHeader('category.pageInfo', { current: currentPage, total: paginationData.totalPages })}
              </Text>
            </View>
            
            <TouchableOpacity 
              style={[styles.headerPageButton, currentPage === paginationData.totalPages && styles.headerPageButtonDisabled]}
              onPress={goToNextPage}
              disabled={currentPage === paginationData.totalPages}
            >
              <Text style={styles.headerPageButtonText}>{tHeader('category.nextPage')}</Text>
            </TouchableOpacity>
            
            <View style={styles.headerItemsPerPageContainer}>
              <Text style={styles.headerItemsPerPageLabel}>{tHeader('category.itemsPerPage')}</Text>
              {renderDropdown()}
            </View>
          </View>
        )}
        
        {/* 间距 */}
        <View style={styles.headerSpacer} />
        
        {/* 没有选中图片时：只显示全选按钮 */}
        {currentSelectedCount === 0 ? (
          <TouchableOpacity
            style={[styles.headerButton, selectAll && styles.headerButtonActive]}
            onPress={toggleSelectAll}>
            <Text style={[styles.headerButtonText, selectAll && styles.headerButtonTextActive]}>
              {tHeader('common.selectAll')}
            </Text>
          </TouchableOpacity>
        ) : (
          /* 有选中图片时：显示操作菜单 */
          <View style={styles.actionMenuContainer}>
            <TouchableOpacity
              style={[styles.headerButton, styles.actionMenuButton]}
              onPress={(e) => {
                e.stopPropagation();
                setShowActionMenu(!showActionMenu);
              }}>
              <Text style={[styles.headerButtonText, styles.actionMenuButtonText]}>
                {tHeader('category.operationWithCount', { count: currentSelectedCount })} ▼
              </Text>
            </TouchableOpacity>
            
            {/* 下拉菜单 */}
            {showActionMenu && (
              <View style={styles.actionMenuDropdown}>
                {/* 全选 */}
                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={() => {
                    setShowActionMenu(false);
                    toggleSelectAll();
                  }}>
                  <Text style={styles.actionMenuItemText}>
                    {selectAll ? t('category.allSelected') : `☐ ${t('common.selectAll')}`}
                  </Text>
                </TouchableOpacity>
                
                {/* 取消选择 */}
                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={async () => {
                    setShowActionMenu(false);
                    setShowCategorySubmenu(false);
                    await clearCategorySelections();
                  }}>
                  <Text style={styles.actionMenuItemText}>{tHeader('category.deselect')}</Text>
                </TouchableOpacity>
                
                {/* 设置分类 - 带二级菜单 */}
                <TouchableOpacity
                  style={styles.actionMenuItem}
                  activeOpacity={1}
                  onMouseEnter={() => {
                    logger.debug('🖱️ 鼠标进入设置分类菜单项');
                    logger.debug('📋 可用分类数量:', availableCategories.length);
                    setShowCategorySubmenu(true);
                  }}
                  onMouseLeave={() => {
                    logger.debug('🖱️ 鼠标离开设置分类菜单项');
                    setShowCategorySubmenu(false);
                  }}
                >
                  <View style={styles.actionMenuItemWithSubmenu}>
                    <Text style={styles.actionMenuItemText}>{tHeader('category.categoryMenu')}</Text>
                    
                    {/* 二级菜单：分类列表 */}
                    {showCategorySubmenu && availableCategories.length > 0 && (
                      <View 
                        style={styles.categorySubmenu}
                        onMouseEnter={() => setShowCategorySubmenu(true)}
                        onMouseLeave={() => setShowCategorySubmenu(false)}
                      >
                        {availableCategories.map((cat) => (
                          <TouchableOpacity
                            key={cat.id}
                            style={styles.categorySubmenuItem}
                            onPress={() => {
                              logger.debug('选择分类:', cat.id, cat.chinese);
                              setShowActionMenu(false);
                              setShowCategorySubmenu(false);
                              handleBatchChangeCategory(cat.id);
                            }}>
                            <Text style={styles.categorySubmenuItemText}>
                              {(() => {
                                const currentLang = i18n.language || 'zh';
                                return currentLang === 'en' ? (cat.english || cat.chinese) : (cat.chinese || cat.english);
                              })()}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
                
                {/* 照片创玩（带二级菜单） - 所有分类都显示 */}
                <TouchableOpacity
                  style={styles.actionMenuItem}
                  activeOpacity={1}
                  onMouseEnter={() => {
                    logger.debug('🖱️ 鼠标进入照片创玩菜单项');
                    setShowEnhanceSubmenu(true);
                  }}
                  onMouseLeave={() => {
                    logger.debug('🖱️ 鼠标离开照片创玩菜单项');
                    setShowEnhanceSubmenu(false);
                  }}
                >
                  <View style={styles.actionMenuItemWithSubmenu}>
                    <Text style={styles.actionMenuItemText}>{tHeader('category.enhanceMenu')}</Text>
                    
                    {/* 二级菜单：增强方案列表 */}
                    {showEnhanceSubmenu && availableEnhancePresets.length > 0 && (
                      <View 
                        style={styles.categorySubmenu}
                        onMouseEnter={() => setShowEnhanceSubmenu(true)}
                        onMouseLeave={() => setShowEnhanceSubmenu(false)}
                      >
                        {availableEnhancePresets.map((preset) => (
                          <TouchableOpacity
                            key={preset.id}
                            style={styles.categorySubmenuItem}
                            onPress={() => {
                              logger.debug('选择方案:', preset.id, preset.name);
                              setShowActionMenu(false);
                              setShowCategorySubmenu(false);
                              setShowEnhanceSubmenu(false);
                              handleAIEnhance(preset.id);
                            }}>
                            <Text style={styles.categorySubmenuItemText}>
                              {preset.icon ? `${preset.icon} ` : ''}{preset.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
                
                {/* 删除 - 所有分类都显示 */}
                <TouchableOpacity
                  style={[styles.actionMenuItem, styles.actionMenuItemDanger]}
                  onPress={() => {
                    setShowActionMenu(false);
                    setShowCategorySubmenu(false);
                    handleBatchDelete();
                  }}>
                  <Text style={[styles.actionMenuItemText, styles.actionMenuItemTextDanger]}>
                    {tHeader('category.deleteAction')}
                  </Text>
                </TouchableOpacity>
                
                {/* 复制到剪贴板 - 所有分类都显示 */}
                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={() => {
                    setShowActionMenu(false);
                    setShowCategorySubmenu(false);
                    handleCopyToClipboard();
                  }}>
                  <Text style={styles.actionMenuItemText}>{tHeader('category.copyContent')}</Text>
                </TouchableOpacity>
                
                {/* 复制到文件管理器 - 所有分类都显示 */}
                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={() => {
                    setShowActionMenu(false);
                    setShowCategorySubmenu(false);
                    handleCopyToFileManager();
                  }}>
                  <Text style={styles.actionMenuItemText}>{t('category.copyFile')}</Text>
                </TouchableOpacity>

                {/* 整理到文件夹：物理迁移到分类目录 */}
                <TouchableOpacity
                  style={styles.actionMenuItem}
                  onPress={() => { setShowActionMenu(false); setShowMigrateDialog(true); }}>
                  <Text style={styles.actionMenuItemText}>{tHeader('category.migrateToFolder', { defaultValue: '整理到文件夹' })}</Text>
                </TouchableOpacity>

                {/* 暂存 - 只有非暂存箱显示 */}
                {!isStagingBox && (
                  <TouchableOpacity
                    style={styles.actionMenuItem}
                    onPress={() => {
                      setShowActionMenu(false);
                      setShowCategorySubmenu(false);
                      handleBatchAddToStagingBox();
                    }}>
                    <Text style={styles.actionMenuItemText}>{tHeader('category.addToStaging')}</Text>
                  </TouchableOpacity>
                )}
                
                {/* 从暂存箱移除 - 只有暂存箱显示 */}
                {isStagingBox && (
                  <TouchableOpacity
                    style={styles.actionMenuItem}
                    onPress={() => {
                      setShowActionMenu(false);
                      setShowCategorySubmenu(false);
                      handleBatchRemoveFromStagingBox();
                    }}>
                    <Text style={styles.actionMenuItemText}>{tHeader('category.removeFromStaging')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  // 懒加载图片容器组件
  const LazyImageContainer = React.memo(({ item, index, total, getIsSelected, onPress, onLongPress, onRightPress, highlightedId, isInStagingBox, setRef }) => {
    const [selected, setSelected] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const isHighlighted = highlightedId === item.id;
    
    // 初始化选中状态 - 只在组件挂载时执行一次
    useEffect(() => {
      const isSelected = getIsSelected(item.id);
      setSelected(isSelected);
    }, [item.id]); // 只依赖 item.id，不依赖 getIsSelected
    
    // 监听选中状态变化 - 使用事件监听避免依赖 getIsSelected
    useEffect(() => {
      const handleSelectionChange = (event) => {
        if (event.detail.imageId === item.id) {
          // 使用 setTimeout 延迟状态更新，避免在渲染期间调用 setState
          setTimeout(() => {
            setSelected(event.detail.isSelected);
            logger.debug(`选中状态变化: ${item.id} -> ${event.detail.isSelected}`);
          }, 0);
        }
      };
      
      // 监听自定义事件
      window.addEventListener('imageSelectionChanged', handleSelectionChange);
      
      return () => {
        window.removeEventListener('imageSelectionChanged', handleSelectionChange);
      };
    }, [item.id]); // 只依赖 item.id，不依赖 selected
    
    // logger.debug(`LazyImageContainer渲染: ${item.id}, selected: ${selected}, index: ${index}, total: ${total}`);
    
    // 处理右键点击
    const handleRightPress = () => {
      onRightPress(item);
      // 立即更新本地状态
      setSelected(!selected);
    };
    
    useEffect(() => {
      // 优先加载前15张图片，其余的延迟加载
      if (index < 15) {
        setIsVisible(true);
      } else {
        // 延迟加载，避免同时加载太多图片
        const delay = (index - 15) * 80; // 每张图片延迟80ms
        const timer = setTimeout(() => {
          setIsVisible(true);
        }, delay);
        
        return () => clearTimeout(timer);
      }
    }, [index]);
    
    return (
      <View style={styles.imageItemContainer}>
        <ImageItem
          ref={(el) => setRef && setRef(item.id, el)}
          item={item}
          isSelected={selected}
          isHighlighted={isHighlighted}
          isInStagingBox={isInStagingBox}
          onPress={onPress}
          onLongPress={onLongPress}
          onRightPress={handleRightPress}
          isVisible={isVisible}
        />
      </View>
    );
  }, (prevProps, nextProps) => {
    // 自定义比较函数：如果 highlightedId 与当前 item.id 相关，必须重新渲染
    const prevIsHighlighted = prevProps.highlightedId === prevProps.item.id;
    const nextIsHighlighted = nextProps.highlightedId === nextProps.item.id;
    
    // 如果高亮状态发生变化（从高亮变为不高亮，或从不高亮变为高亮），需要重新渲染
    if (prevIsHighlighted !== nextIsHighlighted) {
      return false; // 返回 false 表示需要重新渲染
    }
    
    // 如果 highlightedId 本身变化了，也需要重新渲染（可能影响其他图片的高亮状态）
    if (prevProps.highlightedId !== nextProps.highlightedId) {
      return false;
    }
    
    // 如果 isInStagingBox 状态变化，需要重新渲染
    if (prevProps.isInStagingBox !== nextProps.isInStagingBox) {
      return false;
    }
    
    // 其他 props 使用默认浅比较
    return (
      prevProps.item.id === nextProps.item.id &&
      prevProps.index === nextProps.index &&
      prevProps.total === nextProps.total
    );
  });

  // ScrollView 组件 - 稳定渲染，不依赖选中状态
  const ScrollViewComponent = useCallback(() => {
    return (
      <ScrollView
        style={{
          marginTop: 60, // 只有内部标题栏的高度
          flex: 1
        }}
        contentContainerStyle={{
          padding: 8,
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center'
        }}
        showsVerticalScrollIndicator={false}
      >
        {paginationData.currentPageImages.map((item, index) => (
          <LazyImageContainer
            key={item.id}
            item={item}
            index={index}
            total={paginationData.currentPageImages.length}
            getIsSelected={getIsSelected}
            onPress={handleImagePress}
            onLongPress={handleImageLongPress}
            onRightPress={handleImageRightPress}
            highlightedId={highlightedImageId}
            isInStagingBox={stagingBoxImageIds.has(item.id)}
            setRef={(id, el) => {
              if (el) {
                imageRefs.current[id] = el;
              }
            }}
          />
        ))}
      </ScrollView>
    );
  }, [paginationData.currentPageImages, getIsSelected, handleImagePress, handleImageLongPress, handleImageRightPress, highlightedImageId, stagingBoxImageIds]);

  // 时间轴标题点击处理 - 全选/取消全选该时间段的所有图片
  const handleTimelineHeaderPress = useCallback((imagesForDate) => {
    const imageIds = imagesForDate.map(img => img.id);
    
    // 使用setSelectedImages的prev参数来获取当前选中状态，避免依赖selectedImages
    setSelectedImages(prev => {
      const allSelectedInGroup = imageIds.every(id => prev.includes(id));
      
      if (allSelectedInGroup) {
        // 全部选中，则取消全选
        const newSelection = prev.filter(id => !imageIds.includes(id));
        
        // 同时更新 UnifiedDataService 的全局状态和发送事件
        imageIds.forEach(id => {
          UnifiedDataService.setImageSelection(id, false);
          window.dispatchEvent(new CustomEvent('imageSelectionChanged', {
            detail: { imageId: id, isSelected: false }
          }));
        });
        
        return newSelection;
      } else {
        // 未全部选中，则全选
        const newSelection = [...prev];
        const idsToAdd = imageIds.filter(id => !newSelection.includes(id));
        idsToAdd.forEach(id => newSelection.push(id));
        
        // 同时更新 UnifiedDataService 的全局状态和发送事件
        imageIds.forEach(id => {
          UnifiedDataService.setImageSelection(id, true);
          window.dispatchEvent(new CustomEvent('imageSelectionChanged', {
            detail: { imageId: id, isSelected: true }
          }));
        });
        
        return newSelection;
      }
    });
  }, []); // 不依赖任何状态，使用prev参数获取当前值

  // 时间轴渲染函数
  const renderTimeline = useCallback(() => {
    const { grouped, sortedDates } = groupedImages;
    
    if (sortedDates.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📷</Text>
          <Text style={styles.emptyTitle}>{t('category.noImages')}</Text>
          <Text style={styles.emptySubtitle}>
            {!filterType || !filterValue
              ? t('category.noImages')
              : filterType === 'similarityGroup'
              ? t('category.similarityGroupEmpty')
              : filterType === 'directory'
              ? t('category.directoryEmpty')
              : filterType === 'city'
              ? t('category.cityEmpty', { city: cityDisplayName || filterValue })
              : filterType === 'color'
              ? t('category.colorEmpty')
              : filterType === 'stagingBox'
              ? t('category.stagingBoxEmpty')
              : t('category.categoryEmpty')
            }
          </Text>
        </View>
      );
    }
    
    return (
      <ScrollView
        ref={scrollViewRef}
        style={{
          marginTop: 60, // 只有内部标题栏的高度
          flex: 1
        }}
        contentContainerStyle={styles.timelineContainer}
        showsVerticalScrollIndicator={false}
      >
        {sortedDates.map((dateKey) => {
          const imagesForDate = grouped[dateKey];
          const date = new Date(dateKey);
          
          // 自定义中文日期格式化
          const year = date.getFullYear();
          const month = date.getMonth() + 1;
          const day = date.getDate();
          const weekday = date.getDay();
          
          const weekdayNames = t('category.weekdayNames', { returnObjects: true });
          
          // 月份直接使用数字格式，如"11月"而不是"十一月"
          const formattedDate = t('category.dateFormat', {
            year,
            month: `${month}月`,
            day,
            weekday: weekdayNames[weekday]
          });
          
          return (
            <View key={dateKey} style={styles.timelineSection}>
              <TimelineHeader
                dateKey={dateKey}
                formattedDate={formattedDate}
                imagesForDate={imagesForDate}
                onPress={() => handleTimelineHeaderPress(imagesForDate)}
              />
              
              <View style={styles.timelineImages}>
                {imagesForDate.map((image, index) => (
                  <LazyImageContainer
                    key={image.id}
                    item={image}
                    index={index}
                    total={imagesForDate.length}
                    getIsSelected={getIsSelected}
                    onPress={handleImagePress}
                    onLongPress={handleImageLongPress}
                    onRightPress={handleImageRightPress}
                    highlightedId={highlightedImageId}
                    isInStagingBox={stagingBoxImageIds.has(image.id)}
                    setRef={(id, el) => {
                      if (el) {
                        imageRefs.current[id] = el;
                      }
                    }}
                  />
                ))}
              </View>
                    </View>
                  );
                })}
      </ScrollView>
    );
  }, [groupedImages, getIsSelected, handleImagePress, handleImageLongPress, handleImageRightPress, handleTimelineHeaderPress, highlightedImageId, stagingBoxImageIds]);

  // 分页控制已集成到头部区域

  // Render selection toolbar
  const renderSelectionToolbar = useCallback(() => {
    // 只在有选中图片时显示工具栏
    if (selectedImages.length === 0) return null;

    return (
      <View style={styles.selectionToolbar}>
        <View style={styles.toolbarLeft}>
          <TouchableOpacity
            style={[styles.toolbarButton, styles.selectAllButton]}
            onPress={toggleSelectAll}>
            <Text style={[styles.toolbarButtonText, styles.selectAllButtonText]}>
              {selectAll ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>
              </View>
        
        <View style={styles.toolbarCenter}>
          <Text style={styles.selectionCount}>
            已选择 {selectedImages.length} / {allImages.length} 张
          </Text>
            </View>
        
        <View style={styles.toolbarActions}>
          <TouchableOpacity
            style={[styles.toolbarButton, styles.deleteButton]}
            onPress={handleBatchDelete}>
            <Text style={[styles.toolbarButtonText, styles.deleteButtonText]}>
              Delete
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [selectedImages.length, allImages.length, selectAll]);

  // 移除ListRow函数，使用内联渲染

  // 分页导航函数
  const goToPage = useCallback((page) => {
    const safePage = Math.max(1, Math.min(page, paginationData.totalPages));
    logger.debug(`跳转到第${safePage}页`);
    setCurrentPage(safePage);
    
    // 通知父组件页面变化
    if (onPageChange) {
      onPageChange({
        currentPage: safePage,
        itemsPerPage,
        totalPages: paginationData.totalPages,
        filterType,
        filterValue
      });
    }
  }, [paginationData.totalPages, itemsPerPage, onPageChange, filterType, filterValue]);

  const goToPreviousPage = useCallback(() => {
    if (currentPage > 1) {
      goToPage(currentPage - 1);
    }
  }, [currentPage]);

  const goToNextPage = useCallback(() => {
    if (currentPage < paginationData.totalPages) {
      goToPage(currentPage + 1);
    }
  }, [currentPage, paginationData.totalPages]);

  const handleItemsPerPageChange = useCallback((newItemsPerPage) => {
    logger.debug(`每页数量改为: ${newItemsPerPage}`);
    setItemsPerPage(newItemsPerPage);
    setCurrentPage(1); // 重置到第一页
    
    // 通知父组件每页数量变化
    if (onPageChange) {
      onPageChange({
        currentPage: 1,
        itemsPerPage: newItemsPerPage,
        totalPages: Math.ceil((allImages?.length || 0) / newItemsPerPage),
        filterType,
        filterValue
      });
    }
  }, [onPageChange, allImages?.length, filterType, filterValue]);

  // 处理页码输入
  const handlePageInputSubmit = useCallback(() => {
    const pageNumber = parseInt(pageInput);
    if (pageNumber && pageNumber >= 1 && pageNumber <= paginationData.totalPages) {
      goToPage(pageNumber);
      setPageInput('');
    } else {
      // 输入无效，重置输入框
      setPageInput('');
    }
  }, [pageInput, paginationData.totalPages]);

  // 下拉选择框组件
  const renderDropdown = () => (
    <View style={styles.dropdownContainer}>
      <TouchableOpacity 
        style={styles.dropdownButton}
        onPress={() => setShowDropdown(!showDropdown)}
      >
        <Text style={styles.dropdownButtonText}>{itemsPerPage}</Text>
        <Text style={styles.dropdownArrow}>{showDropdown ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      
      {showDropdown && (
        <View style={styles.dropdownList}>
          {dropdownOptions.map(option => (
            <TouchableOpacity
              key={option}
              style={[
                styles.dropdownItem,
                itemsPerPage === option && styles.dropdownItemActive
              ]}
              onPress={() => {
                handleItemsPerPageChange(option);
                closeDropdown();
              }}
            >
              <Text style={[
                styles.dropdownItemText,
                itemsPerPage === option && styles.dropdownItemTextActive
              ]}>
                {option}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  // 分页控制组件（简化版，用于工具栏）
  const renderPaginationControls = () => (
    <View style={styles.paginationControls}>
      <View style={styles.paginationInfo}>
        <Text style={styles.paginationText}>
          第 {currentPage} 页 / 共 {paginationData.totalPages} 页
        </Text>
        <Text style={styles.paginationText}>
          ({paginationData.startIndex + 1}-{paginationData.endIndex} / {paginationData.total} 张图片)
        </Text>
              </View>
              
      <View style={styles.paginationButtons}>
        <TouchableOpacity 
          style={[styles.pageButton, currentPage === 1 && styles.pageButtonDisabled]}
          onPress={goToPreviousPage}
          disabled={currentPage === 1}
        >
          <Text style={styles.pageButtonText}>上一页</Text>
        </TouchableOpacity>
        
        <View style={styles.pageInputContainer}>
          <TextInput
            style={styles.pageInput}
            value={pageInput}
            onChangeText={setPageInput}
            placeholder="页码"
            keyboardType="numeric"
            onSubmitEditing={handlePageInputSubmit}
            returnKeyType="done"
          />
          <TouchableOpacity 
            style={styles.goButton}
            onPress={handlePageInputSubmit}
          >
            <Text style={styles.goButtonText}>跳转</Text>
          </TouchableOpacity>
                    </View>
        
        <TouchableOpacity 
          style={[styles.pageButton, currentPage === paginationData.totalPages && styles.pageButtonDisabled]}
          onPress={goToNextPage}
          disabled={currentPage === paginationData.totalPages}
        >
          <Text style={styles.pageButtonText}>下一页</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.paginationSettings}>
        <Text style={styles.settingLabel}>每页显示：</Text>
        <TouchableOpacity 
          style={[styles.settingButton, itemsPerPage === 20 && styles.settingButtonActive]}
          onPress={() => handleItemsPerPageChange(20)}
        >
          <Text style={styles.settingButtonText}>20</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.settingButton, itemsPerPage === 50 && styles.settingButtonActive]}
          onPress={() => handleItemsPerPageChange(50)}
        >
          <Text style={styles.settingButtonText}>50</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.settingButton, itemsPerPage === 100 && styles.settingButtonActive]}
          onPress={() => handleItemsPerPageChange(100)}
        >
          <Text style={styles.settingButtonText}>100</Text>
        </TouchableOpacity>
              </View>
            </View>
          );

  // 空状态渲染
  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>📷</Text>
      <Text style={styles.emptyTitle}>{t('category.noImages')}</Text>
      <Text style={styles.emptySubtitle}>
        {!filterType || !filterValue
          ? t('category.noImages')
          : filterType === 'similarityGroup'
          ? t('category.similarityGroupEmpty')
          : filterType === 'directory'
          ? t('category.directoryEmpty')
          : filterType === 'city'
          ? t('category.cityEmpty', { city: cityDisplayName || filterValue })
          : filterType === 'color'
          ? t('category.colorEmpty')
          : filterType === 'stagingBox'
          ? t('category.stagingBoxEmpty')
          : t('category.categoryEmpty')
        }
      </Text>
      </View>
    );


  // logger.debug('CategoryScreen 开始渲染，category:', category, 'city:', city, 'allImages.length:', allImages.length);
  
  return (
    <View style={styles.container}>
      {/* Fixed Header - 可以重新渲染 */}
      <View style={createFixedStyle(styles.fixedHeader)}>
        <HeaderComponent />
      </View>
      
      {/* 渲染时间轴视图 */}
      {allImages.length > 0 ? (
        renderTimeline()
      ) : (
        renderEmpty()
      )}

      {/* Batch delete progress dialog */}
      <Modal
        visible={showDeleteProgress}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowDeleteProgress(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>删除中...</Text>
            <Text style={styles.modalMessage}>
              已删除: {deleteProgress.filesDeleted} 个文件
              失败: {deleteProgress.filesFailed} 个文件
              总计: {deleteProgress.total} 个文件
            </Text>
            <ActivityIndicator size="small" color="#2196F3" style={styles.modalIndicator} />
          </View>
        </View>
      </Modal>

      {/* 整理到文件夹：选移动/复制 */}
      <Modal visible={showMigrateDialog} transparent animationType="fade" onRequestClose={() => setShowMigrateDialog(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('category.migrateToFolder', { defaultValue: '整理到文件夹' })}</Text>
            <Text style={styles.modalMessage}>{t('category.migrateModeHint', { defaultValue: '把选中的已分类照片按分类整理到一个目标文件夹。未分类的会跳过。' })}</Text>
            <TouchableOpacity style={styles.actionMenuItem} onPress={() => handleMigrateToFolder('copy')}>
              <Text style={styles.actionMenuItemText}>{t('category.migrateCopy', { defaultValue: '复制（保留原文件，安全）' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionMenuItem} onPress={() => {
              Alert.alert(
                t('category.migrateMoveConfirmTitle', { defaultValue: '确认移动？' }),
                t('category.migrateMoveConfirmMsg', { defaultValue: '移动会把原文件移走，原位置不再保留。建议先用复制。' }),
                [
                  { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
                  { text: t('category.migrateMove', { defaultValue: '移动' }), style: 'destructive', onPress: () => handleMigrateToFolder('move') },
                ],
              );
            }}>
              <Text style={[styles.actionMenuItemText, { color: '#FF3B30' }]}>{t('category.migrateMove', { defaultValue: '移动（原文件移走）' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionMenuItem} onPress={() => setShowMigrateDialog(false)}>
              <Text style={styles.actionMenuItemText}>{t('common.cancel', { defaultValue: '取消' })}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 迁移进度 */}
      <Modal visible={!!migrateProgress} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('category.migrating', { defaultValue: '整理中...' })}</Text>
            <Text style={styles.modalMessage}>{migrateProgress ? `${migrateProgress.done}/${migrateProgress.total}` : ''}</Text>
            <ActivityIndicator size="small" color="#2196F3" style={styles.modalIndicator} />
          </View>
        </View>
      </Modal>

      {/* AI 图像增强模态框 */}
      {showEnhanceModal && enhancePreset && (
        <EnhanceResultScreen
          visible={showEnhanceModal}
          onClose={handleCloseEnhanceModal}
          preset={enhancePreset}
          availablePresets={availableEnhancePresets}
          selectedImages={allImages.filter(img => selectedImages.includes(img.id))}
          initialIndex={currentImageIndex}
          allImages={allImages}
          categoryImages={[]}
        />
      )}

    </View>
  );
};

// EnhanceModal 已移至 EnhanceResultScreen.desktop.js

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    position: 'relative',
    overflow: 'hidden',
  },
  
  
  // 分页控制样式
  paginationControls: {
    backgroundColor: '#fff',
    padding: 12,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  paginationInfo: {
    alignItems: 'center',
    marginBottom: 12,
  },
  paginationText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  paginationButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 12,
  },
  pageButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 6,
    marginHorizontal: 8,
  },
  pageButtonDisabled: {
    backgroundColor: '#ccc',
  },
  pageButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  
  // 工具栏分页控制样式
  toolbarPagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 8,
  },
  pageInfo: {
    marginHorizontal: 8,
  },
  pageInfoText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  itemsPerPageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemsPerPageLabel: {
    fontSize: 12,
    color: '#666',
  },
  
  // 下拉选择框样式
  dropdownContainer: {
    position: 'relative',
    zIndex: 1000,
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ddd',
    minWidth: 50,
  },
  dropdownButtonText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
    flex: 1,
    textAlign: 'center',
  },
  dropdownArrow: {
    fontSize: 10,
    color: '#666',
    marginLeft: 4,
  },
  dropdownList: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 1001,
  },
  dropdownItem: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  dropdownItemActive: {
    backgroundColor: '#007AFF',
  },
  dropdownItemText: {
    fontSize: 12,
    color: '#333',
    textAlign: 'center',
  },
  dropdownItemTextActive: {
    color: '#fff',
    fontWeight: '500',
  },
  pageInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  pageInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 14,
    textAlign: 'center',
    width: 60,
    marginRight: 4,
  },
  goButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  goButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  paginationSettings: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
  },
  settingButton: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  settingButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  settingButtonText: {
    fontSize: 12,
    color: '#666',
  },
  fixedHeader: {
    position: 'absolute',
    top: 60, // 为自定义标题栏留出空间
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5, // Android阴影
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    height: 60, // 固定高度
  },
  backButton: {
    padding: 12,
    marginRight: 8,
    borderRadius: 6,
    backgroundColor: 'transparent',
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: {
    fontSize: 24,
    color: '#333',
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  headerButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
  },
  headerButtonActive: {
    backgroundColor: '#2196F3',
  },
  headerButtonText: {
    fontSize: 14,
    color: '#333',
  },
  headerButtonTextActive: {
    color: '#fff',
  },
  
  // 头部分页控制样式
  headerPagination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerPageButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  headerPageButtonDisabled: {
    backgroundColor: '#ccc',
  },
  headerPageButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  headerPageInfo: {
    marginHorizontal: 4,
  },
  headerPageInfoText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  headerItemsPerPageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerItemsPerPageLabel: {
    fontSize: 12,
    color: '#666',
  },
  headerSpacer: {
    width: 20,
  },
  headerCopyButton: {
    backgroundColor: '#34C759',
  },
  headerCopyButtonText: {
    color: '#fff',
  },
  headerDeleteButton: {
    backgroundColor: '#f0f0f0', // 暂存按钮：和全选按钮保持一致（浅灰色）
  },
  headerDeleteButtonText: {
    color: '#333', // 暂存按钮：深色文字配合浅色背景
  },
  headerRealDeleteButton: {
    backgroundColor: '#FF3B30', // 真正的删除按钮：红色警告
  },
  headerRealDeleteButtonText: {
    color: '#fff', // 真正的删除按钮：白色文字
  },
  headerCancelButton: {
    backgroundColor: '#8E8E93',
  },
  headerCancelButtonText: {
    color: '#fff',
  },
  imageItemContainer: {
    width: 120,
    height: 120,
    margin: 6,
  },
  selectionToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  toolbarButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
  },
  toolbarButtonText: {
    fontSize: 14,
    color: '#333',
  },
  deleteButton: {
    backgroundColor: '#ff4444',
  },
  deleteButtonText: {
    color: '#fff',
  },
  selectionCount: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolbarCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectAllButton: {
    backgroundColor: '#2196F3',
  },
  selectAllButtonText: {
    color: '#fff',
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
    // marginTop 现在通过动态样式设置
  },
     imageGrid: {
     padding: 8,
   },
   timelineContainer: {
     padding: 8,
    paddingTop: 0, // 移除顶部padding，因为已经有marginTop
   },
   timelineGroup: {
    marginBottom: 32,
   },
   dateHeader: {
     flexDirection: 'row',
     alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 12,
   },
   dateLine: {
     flex: 1,
     height: 1,
    backgroundColor: '#d0d7de',
   },
   dateText: {
    fontSize: 15,
     fontWeight: '600',
    color: '#24292f',
    marginHorizontal: 20,
     textAlign: 'center',
    backgroundColor: '#f6f8fa',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
   },
 imageGridContainer: {
   flexDirection: 'row',
   flexWrap: 'wrap',
   justifyContent: 'center', // 改为居中对齐
   paddingHorizontal: 4,
   gap: 12, // 使用gap统一间距
 },
 imageWrapper: {
   // 动态尺寸将在渲染时设置
   padding: 6,
 },
  imageContainer: {
    width: '100%',
    height: '100%',
   borderRadius: 12,
    position: 'relative',
   backgroundColor: '#f8f9fa',
  },
  imageItem: {
    width: 120,
    height: 120,
   borderRadius: 12,
    position: 'relative',
   backgroundColor: '#f8f9fa',
   shadowColor: '#000',
   shadowOffset: {
     width: 0,
     height: 2,
   },
   shadowOpacity: 0.1,
   shadowRadius: 4,
   elevation: 3,
   overflow: 'hidden',
  },
  image: {
   position: 'absolute',
   top: 0,
   left: 0,
   right: 0,
   bottom: 0,
    width: '100%',
    height: '100%',
 },
 imageLoadingOverlay: {
   position: 'absolute',
   top: 0,
   left: 0,
   right: 0,
   bottom: 0,
   backgroundColor: 'rgba(255,255,255,0.9)',
   justifyContent: 'center',
   alignItems: 'center',
   borderRadius: 12,
   zIndex: 1,
 },
 loadingText: {
   color: '#666',
   fontSize: 11,
   fontWeight: '500',
   marginTop: 4,
  },
  selectedImage: {
   opacity: 0.8,
   transform: [{ scale: 0.95 }],
 },
 imageHovered: {
   transform: [{ scale: 1.02 }],
   shadowOpacity: 0.2,
   shadowRadius: 8,
   elevation: 6,
  },
  highlightedImage: {
    borderWidth: 3,
    borderColor: '#FF9500',
    shadowColor: '#FF9500',
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
    transform: [{ scale: 1.05 }],
  },
  selectionIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
   width: 28,
   height: 28,
   borderRadius: 14,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
   shadowColor: '#000',
   shadowOffset: {
     width: 0,
     height: 2,
   },
   shadowOpacity: 0.25,
   shadowRadius: 4,
   elevation: 5,
   borderWidth: 2,
   borderColor: '#fff',
  },
  selectionText: {
    color: '#fff',
   fontSize: 14,
    fontWeight: 'bold',
  },
  stagingBoxBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: '#FF9500',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#fff',
  },
  stagingBoxBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
   borderRadius: 12,
   backgroundColor: '#f0f2f5',
    alignItems: 'center',
    justifyContent: 'center',
   borderWidth: 1,
   borderColor: '#e8e8e8',
   borderStyle: 'dashed',
  },
  placeholderText: {
   fontSize: 32,
   color: '#b8bcc8',
   marginBottom: 8,
  },
  placeholderFileName: {
   fontSize: 11,
    color: '#666',
   fontWeight: '500',
   textAlign: 'center',
   paddingHorizontal: 8,
 },
 placeholderSubtext: {
   marginTop: 4,
   fontSize: 9,
   color: '#999',
   fontStyle: 'italic',
   textAlign: 'center',
   paddingHorizontal: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  emptyIcon: {
    fontSize: 60,
    color: '#ccc',
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
   backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalContent: {
   backgroundColor: '#333',
    padding: 20,
   borderRadius: 10,
    alignItems: 'center',
  },
  modalTitle: {
   color: '#fff',
   fontSize: 18,
   fontWeight: '600',
    marginBottom: 10,
  },
  modalMessage: {
   color: '#fff',
   fontSize: 14,
    marginBottom: 15,
    textAlign: 'center',
  },
  modalIndicator: {
   marginTop: 10,
 },

  // 时间轴相关样式
  viewModeContainer: {
    flexDirection: 'row',
    marginLeft: 20,
    backgroundColor: '#f0f0f0',
    borderRadius: 6,
    padding: 2,
  },
  viewModeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  viewModeButtonActive: {
    backgroundColor: '#007AFF',
  },
  viewModeButtonText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  viewModeButtonTextActive: {
    color: '#fff',
  },
  timelineContainer: {
    padding: 16,
  },
  timelineSection: {
    marginBottom: 24,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    borderRadius: 4,
    cursor: 'pointer',
  },
  timelineHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  timelineHeaderLeft: {
    flex: 1,
  },
  timelineLocation: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  timelineDate: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  timelineCount: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
  timelineSelectionIndicator: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  timelineSelectionText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
  },
  timelineImages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  
  // 操作菜单样式
  actionMenuContainer: {
    position: 'relative',
    zIndex: 1000,
  },
  actionMenuButton: {
    backgroundColor: '#2196F3',
  },
  actionMenuButtonText: {
    color: '#fff',
  },
  actionMenuDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    minWidth: 180,
    zIndex: 1001,
  },
  actionMenuItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    cursor: 'pointer',
  },
  actionMenuItemDanger: {
    backgroundColor: '#fff5f5',
  },
  actionMenuItemText: {
    fontSize: 14,
    color: '#333',
  },
  actionMenuItemTextDanger: {
    color: '#FF3B30',
    fontWeight: '500',
  },
  actionMenuItemWithSubmenu: {
    position: 'relative',
  },
  categorySubmenu: {
    position: 'absolute',
    right: '100%', // 向左展开，避免超出窗口右侧
    top: 0,
    marginRight: 4,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    minWidth: 150,
    zIndex: 1002,
  },
  categorySubmenuItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    cursor: 'pointer',
  },
  categorySubmenuItemText: {
    fontSize: 13,
    color: '#333',
  },
  
  // ==================== AI图像增强样式 ====================
  enhanceModalOverlay: {
    position: 'fixed',
    top: 60,  // 从标题栏下方开始（electron.js中titleBarOverlay.height = 60）
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999999,
    display: 'flex',
  },
  enhanceModalContent: {
    position: 'relative',
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '95%',
    maxWidth: 1200,
    maxHeight: 'calc(100vh - 100px)',  // 扣除标题栏高度和边距
    height: 'calc(100vh - 100px)',  // 设置固定高度，确保模态框足够高
    marginTop: 20,  // 距离标题栏底部的间距
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    padding: 16,
    zIndex: 1000000,
    display: 'flex',
    flexDirection: 'column',  // 垂直布局，让内容可以滚动
    overflow: 'hidden',  // 防止内容溢出
  },
  enhanceModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    position: 'relative',
    zIndex: 1000001,
    flexShrink: 0,  // 标题栏不收缩
  },
  enhanceModalScrollContent: {
    flex: 1,  // 占据剩余空间
    overflow: 'auto',  // 允许滚动
  },
  enhanceModalScrollContentContainer: {
    flexGrow: 1,
    paddingBottom: 20,  // 底部留白
  },
  enhanceModalCloseButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    cursor: 'pointer',
    position: 'relative',
    zIndex: 1000002,
    transition: 'all 0.2s ease',
    ':hover': {
      backgroundColor: '#ff4444',
    },
  },
  enhanceModalCloseButtonText: {
    fontSize: 18,
    color: '#666',
    lineHeight: 16,
    fontWeight: 'bold',
  },
  enhanceConfigView: {
    padding: 24,
  },
  enhanceProgressView: {
    padding: 24,
    alignItems: 'center',
  },
  enhanceModalTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  enhanceModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  enhanceModalCounter: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2196F3',
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  enhanceModalSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  // 预设方案按钮组
  enhancePresetButtonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 0,
    justifyContent: 'flex-start',
  },
  enhancePresetButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: '#f5f5f5',
    borderWidth: 2,
    borderColor: '#ddd',
    cursor: 'pointer',
  },
  enhancePresetButtonActive: {
    backgroundColor: '#2196F3',
    borderColor: '#2196F3',
  },
  enhancePresetButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  enhancePresetButtonTextActive: {
    color: '#fff',
  },
  enhanceModalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  enhanceModalButtonSecondary: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    cursor: 'pointer',
  },
  enhanceModalButtonSecondaryText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  enhanceModalButtonPrimary: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2196F3',
    cursor: 'pointer',
  },
  enhanceModalButtonPrimaryText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
  },
  enhanceProgressIndicator: {
    marginBottom: 20,
  },

  // ==================== 大图对比区域样式 ====================
  enhanceComparisonSection: {
    flex: 1,  // 占据剩余所有空间
  },
  enhanceComparisonContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',  // 拉伸子元素高度
    justifyContent: 'space-between',
    gap: 16,
    height: '100%',
  },
  enhanceComparisonImages: {
    flexDirection: 'row',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  enhanceComparisonRightButtons: {
    width: 80,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  enhanceComparisonImageContainer: {
    flex: 1,
    maxWidth: 500,
    alignItems: 'center',
  },
  enhanceComparisonImageLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  enhanceComparisonImageLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  enhanceComparisonImageCounter: {
    fontSize: 13,
    fontWeight: '500',
    color: '#999',
  },
  enhanceComparisonImage: {
    width: '100%',
    height: 480,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  enhanceComparisonPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
  },
  enhanceComparisonPlaceholderIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  enhanceComparisonPlaceholderText: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
  },
  enhanceComparisonFailedContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff5f5',
    borderWidth: 1,
    borderColor: '#ffcccc',
  },
  enhanceComparisonFailedIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  enhanceComparisonFailedTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f44336',
    marginBottom: 8,
  },
  enhanceComparisonFailedMessage: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  enhanceComparisonFailedHint: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  enhanceComparisonNavButtonVertical: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    cursor: 'pointer',
  },
  enhanceComparisonNavButtonDisabled: {
    opacity: 0.3,
    cursor: 'not-allowed',
  },
  enhanceComparisonNavButtonText: {
    fontSize: 24,
    color: '#333',
    lineHeight: 24,
  },
  enhanceComparisonSaveButtonVertical: {
    width: 60,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#2196F3',
    cursor: 'pointer',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  enhanceComparisonSaveButtonDisabled: {
    backgroundColor: '#e0e0e0',
    cursor: 'not-allowed',
    shadowOpacity: 0,
    elevation: 0,
  },
  enhanceComparisonSaveButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
  },
  enhanceComparisonSaveButtonTextDisabled: {
    color: '#999',
  },
  
  // EnhanceResultModal 样式（已废弃，保留以防需要回退）
  enhanceResultModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  enhanceResultModalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '95%',
    maxWidth: 1200,
    maxHeight: '90%',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  enhanceResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  enhanceResultTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  enhanceResultCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    cursor: 'pointer',
  },
  enhanceResultCloseButtonText: {
    fontSize: 18,
    color: '#666',
  },
  enhanceResultCounter: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  enhanceResultComparison: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
  },
  enhanceResultImageContainer: {
    flex: 1,
    alignItems: 'center',
  },
  enhanceResultImageLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
    marginBottom: 8,
  },
  enhanceResultImage: {
    width: '100%',
    height: 400,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  enhanceResultNavigation: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 20,
  },
  enhanceResultNavButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2196F3',
    cursor: 'pointer',
  },
  enhanceResultNavButtonDisabled: {
    backgroundColor: '#ccc',
    cursor: 'not-allowed',
  },
  enhanceResultNavButtonText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
  },
  enhanceResultActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  enhanceResultActionButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    cursor: 'pointer',
    minWidth: 200,
    alignItems: 'center',
  },
  enhanceResultActionButtonPrimary: {
    backgroundColor: '#2196F3',
  },
  enhanceResultActionButtonDisabled: {
    backgroundColor: '#cccccc',
    opacity: 0.6,
  },
  enhanceResultActionButtonText: {
    fontSize: 15,
    color: '#666',
    fontWeight: '600',
  },
  enhanceResultActionButtonTextDisabled: {
    color: '#999',
  },
  enhanceResultActionButtonTextPrimary: {
    color: '#fff',
  },
  
  // 失败状态样式
  enhanceResultFailedContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff5f5',
    borderWidth: 2,
    borderColor: '#ff3b30',
    borderStyle: 'dashed',
  },
  enhanceResultFailedIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  enhanceResultFailedTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ff3b30',
    marginBottom: 8,
  },
  enhanceResultFailedMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  enhanceResultFailedHint: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  
  // ==================== 浮动进度提示样式 ====================
  floatingProgressContainer: {
    position: 'fixed',
    right: 20,
    bottom: 20,
    zIndex: 9999,
  },
  floatingProgressBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    minWidth: 240,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#2196F3',
    cursor: 'pointer',
  },
  floatingProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  floatingProgressIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  floatingProgressTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  floatingProgressText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  floatingProgressBar: {
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  floatingProgressBarFill: {
    height: '100%',
    backgroundColor: '#2196F3',
    borderRadius: 3,
  },
  floatingProgressHint: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
  },
});

export default CategoryScreen;