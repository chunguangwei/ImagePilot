// 统一数据服务 - 封装缓存和数据库的复杂逻辑
import GlobalImageCache from './GlobalImageCache.js';
import ImageStorageService from './ImageStorageService.js';
import locationStorageService from './LocationStorageService.js';
import configService from './ConfigService.js';
import { logger, Platform, RNFS, getLocalPath, getUri } from '../adapters/WebAdapters';

class UnifiedDataService {
  constructor() {
    this.imageStorageService = new ImageStorageService();
    this.imageCache = GlobalImageCache;
    this.configService = configService;
    this.isInitialized = false;
    
    // 缓存变化监听器
    this.cacheListeners = new Set();
    
    // 监听缓存变化，转发给外部监听器
    this.imageCache.addListener((cache) => {
      this.cacheListeners.forEach(listener => listener(cache));
    });
  }

  // ==================== 监听器接口 ====================
  
  /**
   * 添加缓存变化监听器
   */
  addCacheListener(callback) {
    this.cacheListeners.add(callback);
    return () => this.cacheListeners.delete(callback);
  }
  
  // ==================== 初始化接口 ====================
  
  /**
   * 初始化服务
   * 包括缓存构建、数据库连接等
   */
  async initialize() {
    if (this.isInitialized) {
      return true;
    }

    try {
      logger.debug('开始初始化 UnifiedDataService...');
      
      // 1. 初始化数据库服务
      await this.imageStorageService.ensureInitialized();
      
      // 2. 初始化位置数据库服务（在应用启动时完成，避免并发问题）
      await locationStorageService.initialize();
      
      // 3. 构建缓存
      await this.imageCache.buildCache();
      
      this.isInitialized = true;
      logger.debug('UnifiedDataService 初始化完成');
      return true;
      
    } catch (error) {
      logger.error('UnifiedDataService 初始化失败:', error);
      throw error;
    }
  }

  // ==================== 读接口 ====================
  
  /**
   * 获取所有图片
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readAllImages() {
    try {
      // 确保缓存已加载（等待初始化完成）
      await this.imageCache.buildCache();
      
      // 从缓存读取
      const cache = this.imageCache.getCache();
      if (cache.allImages && cache.allImages.length > 0) {
        logger.debug('从缓存读取所有图片:', cache.allImages.length);
        return cache.allImages;
      }
      
      // 如果缓存中仍然没有，说明数据库中也没有图片
      logger.debug('缓存中没有图片，返回空数组');
      return [];
      
    } catch (error) {
      logger.error('读取所有图片失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID获取图片基本信息
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readImageById(imageId) {
    try {
      // 先从缓存查找
      const cache = this.imageCache.getCache();
      const cachedImage = cache.allImages.find(img => img.id === imageId);
      
      if (cachedImage) {
        logger.debug('从缓存读取图片基本信息:', imageId);
        return cachedImage;
      }
      
      // 缓存没有，从数据库读取
      logger.debug('从数据库读取图片基本信息:', imageId);
      const image = await this.imageStorageService.getImageById(imageId);
      
      // 如果找到图片，将其添加到缓存中（增量更新，性能更好）
      if (image) {
        this.imageCache.addImageToCache(image);
      }
      
      return image;
      
    } catch (error) {
      logger.error('读取图片基本信息失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID获取图片详细信息
   * 用于图片详情页面，包含所有字段
   */
  async readImageDetailsById(imageId) {
    try {
      logger.debug('从数据库读取图片详细信息:', imageId);
      const fullImage = await this.imageStorageService.getImageDetailsById(imageId);
      
      return fullImage;
      
    } catch (error) {
      logger.error('读取图片详细信息失败:', error);
      throw error;
    }
  }

  /**
   * 根据分类获取图片
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readImagesByCategory(category) {
    try {
      logger.debug('🔍 readImagesByCategory 开始:', category);
      
      // 🆕 检查缓存是否初始化
      if (!this.imageCache) {
        logger.error('❌ imageCache 未初始化');
        return [];
      }
      
      // 使用标准化的分类ID
      const normalizedCategory = this.getCategoryId(category);
      logger.debug(`🔍 [readImagesByCategory] 原始分类: ${category}, 标准化后: ${normalizedCategory}`);
      
      // 先从缓存获取分类图片
      const categoryImages = this.imageCache.getImagesByCategory(normalizedCategory);
      
      // 🆕 检查返回的数据
      if (!Array.isArray(categoryImages)) {
        logger.error('❌ getImagesByCategory 返回的不是数组:', typeof categoryImages, categoryImages);
        return [];
      }
      
      // 只在有图片时打印日志
      if (categoryImages.length > 0) {
        logger.debug('从缓存读取分类图片:', normalizedCategory, categoryImages.length);
      }
      
      logger.debug('🔍 readImagesByCategory 完成:', categoryImages.length);
      return categoryImages;
      
    } catch (error) {
      logger.error('读取分类图片失败:', error);
      throw error;
    }
  }

  /**
   * 获取最近图片
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readRecentImages(limit = 20) {
    try {
      // 确保缓存已加载（等待初始化完成）
      await this.imageCache.buildCache();
      
      // 从缓存读取
      const cache = this.imageCache.getCache();
      if (cache.recentImages && cache.recentImages.length > 0) {
        return cache.recentImages.slice(0, limit);
      }
      
      // 如果缓存中仍然没有，说明数据库中也没有图片
      logger.debug('缓存中没有最近图片，返回空数组');
      return [];
      
    } catch (error) {
      logger.error('读取最近图片失败:', error);
      throw error;
    }
  }

  /**
   * 获取指定分类的最近图片
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readRecentImagesByCategory(category, limit = 4) {
    try {
      // 使用标准化的分类ID
      const normalizedCategory = this.getCategoryId(category);
      
      // 直接从缓存获取分类图片
      const categoryImages = this.imageCache.getImagesByCategory(normalizedCategory);
      
      // 按时间排序并取前N张
      const recentImages = categoryImages
        .sort((a, b) => {
          const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
          const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
          return timeB - timeA;
        })
        .slice(0, limit);
      
      return recentImages;
      
    } catch (error) {
      logger.error('读取分类最近图片失败:', error);
      throw error;
    }
  }

  /**
   * 获取图片时间（毫秒），用于按时间分类
   * @param {Object} img - 图片对象
   * @returns {number}
   */
  _getImageTime(img) {
    if (!img) return 0;
    // takenAt 为 0/缺失时回退 timestamp（视频 DATE_TAKEN 常为 0，否则会被分到「更早」桶）。
    const taRaw = img.takenAt;
    let t = (taRaw != null && taRaw !== 0)
      ? (typeof taRaw === 'number' ? taRaw : new Date(taRaw).getTime())
      : 0;
    if (!t && img.timestamp) {
      t = typeof img.timestamp === 'number' ? img.timestamp : new Date(img.timestamp).getTime();
    }
    return t || 0;
  }

  /**
   * 判断图片时间落在哪个时间桶（周一为一周起点，本地时区）
   * @param {number} ms - 时间戳毫秒
   * @returns {string} thisWeek | thisMonth | thisYear | lastYear | yearBeforeLast | YYYY | past
   */
  _getTimeBucketKey(ms) {
    if (ms <= 0) return 'past';
    const now = new Date();
    const nowMs = now.getTime();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth();
    const d = new Date(ms);
    const year = d.getFullYear();
    const month = d.getMonth();
    const getMonday = (date) => {
      const x = new Date(date);
      x.setHours(0, 0, 0, 0);
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
      return x.getTime();
    };
    const weekStart = getMonday(now);
    if (ms >= weekStart && ms <= nowMs) return 'thisWeek';
    if (year === nowYear && month === nowMonth && ms < weekStart) return 'thisMonth';
    if (year === nowYear && month < nowMonth) return 'thisYear';
    if (year === nowYear - 1) return 'lastYear';
    if (year === nowYear - 2) return 'yearBeforeLast';
    if (year === nowYear - 3) return String(nowYear - 3);
    if (year === nowYear - 4) return String(nowYear - 4);
    return 'past';
  }

  /**
   * 按时间桶统计数量（最多 8 桶：本周、本月、本年、去年、前年、前年之前两年、过去）
   * @returns {Promise<Object>} { [timeKey]: number }
   */
  async readTimeCounts() {
    try {
      await this.imageCache.buildCache();
      const allImages = this.imageCache.getCache().allImages || [];
      const counts = {};
      allImages.forEach((img) => {
        const key = this._getTimeBucketKey(this._getImageTime(img));
        counts[key] = (counts[key] || 0) + 1;
      });
      return counts;
    } catch (error) {
      logger.error('readTimeCounts 失败:', error);
      return {};
    }
  }

  /**
   * 以图搜图：用目标图的颜色直方图特征与全库特征索引（image_features 表）比对，按相似度排序。
   * 特征索引在「相似照片检测」时顺手建立；目标图无索引则现算一张（百毫秒级）。
   * @param {Object} image 目标图记录（需 id/uri）
   * @returns {Promise<{results:Array, indexedCount:number, total:number}>} results 含 similarScore
   */
  async searchSimilarImages(image, { limit = 60, minScore = 0.45 } = {}) {
    try {
      if (!image || (!image.id && !image.uri)) return { results: [], indexedCount: 0, total: 0 };
      await this.imageCache.buildCache();
      const sim = require('./ImageSimilarityService.js').default;
      const featuresMap = await this.imageStorageService.readAllImageFeatures();
      let target = image.id ? featuresMap[image.id] : null;
      if (!target || !target.color_histogram) {
        target = await sim.extractFeaturesForImage(image);   // 现算目标图特征（库外图也支持，如 AI 搜图选的图）
        if (image.id && target && target.color_histogram) {
          this.imageStorageService.saveImageFeaturesBatch([{ imageId: image.id, features: target }]).catch(() => {});
        }
      }
      const all = this.imageCache.getCache().allImages || [];
      const indexedCount = Object.keys(featuresMap).length;
      if (!target || !target.color_histogram) {
        return { results: [], indexedCount, total: all.length };
      }
      const scored = [];
      for (const img of all) {
        if (!img || img.id === image.id) continue;
        if (String(img.mimeType || '').startsWith('video/')) continue;   // 视频不参与（直方图对视频无意义）
        const f = featuresMap[img.id];
        if (!f || !f.color_histogram) continue;
        const score = sim.scoreFeatureSimilarity(target, f);
        if (score >= minScore) scored.push({ ...img, similarScore: score });
      }
      scored.sort((a, b) => b.similarScore - a.similarScore);
      return { results: scored.slice(0, limit), indexedCount, total: all.length };
    } catch (error) {
      logger.error('以图搜图失败:', error);
      return { results: [], indexedCount: 0, total: 0 };
    }
  }

  /**
   * 旅行回忆：自动识别"出行"。
   * 常驻城市 = 出现次数最多的 city；行程 = 在非常驻城市、按天连续（断档 ≤1 天）的照片簇，≥5 张成行程。
   * 纯内存计算（毫秒级）。
   * @returns {Promise<{trips:Array}>} trips 按时间倒序，含 {city,startDay,endDay,days,count,cover,images}
   */
  async findTrips({ minPhotos = 5, maxGapDays = 1 } = {}) {
    try {
      await this.imageCache.buildCache();
      const all = (this.imageCache.getCache().allImages || []).filter((img) => {
        const ts = img && (img.takenAt || img.timestamp);
        return img && img.id && img.city && ts > 0;
      });
      if (all.length === 0) return { trips: [] };
      const { formatCityName } = require('../components/shared/categoryUI');
      const dayOf0 = (img) => Math.floor((img.takenAt || img.timestamp) / 86400000);
      // 常驻城市集合：占比 >=15% 且「时间跨度较长（>=45 天）」才算常驻。
      // 单纯按占比会把「长途旅行拍了大量照片」的目的地（如大理/丽江，一次就几百张）
      // 误判成常驻而整城剔除、进不了旅行回忆；叠加时间跨度判据可区分「常驻(跨越数月)」与「旅行(集中数天)」。
      const cityCount = new Map();
      const citySpan = new Map(); // city -> {min,max}(天)
      for (const img of all) {
        cityCount.set(img.city, (cityCount.get(img.city) || 0) + 1);
        const d = dayOf0(img);
        const sp = citySpan.get(img.city);
        if (!sp) citySpan.set(img.city, { min: d, max: d });
        else { if (d < sp.min) sp.min = d; if (d > sp.max) sp.max = d; }
      }
      const homeCities = new Set(
        [...cityCount.entries()]
          .filter(([c, n]) => {
            if (n / all.length < 0.15) return false;
            const sp = citySpan.get(c);
            const spanDays = sp ? (sp.max - sp.min + 1) : 0;
            return spanDays >= 45; // 跨度足够长才算常驻，否则视为旅行目的地
          })
          .map(([c]) => c)
      );
      if (homeCities.size === 0) {
        // 兜底：取「跨度最长」的城市为常驻（而非单纯照片最多，避免旅行大城被选中）
        const byspan = [...citySpan.entries()].sort((a, b) => (b[1].max - b[1].min) - (a[1].max - a[1].min));
        if (byspan.length > 0) homeCities.add(byspan[0][0]);
      }

      const dayOf = (img) => Math.floor((img.takenAt || img.timestamp) / 86400000);
      // 异地照片按 city 分组 → 组内按天聚簇（city 解析失败的不参与）
      const byCity = new Map();
      for (const img of all) {
        if (homeCities.has(img.city)) continue;
        if (!formatCityName(img.city)) continue;
        if (!byCity.has(img.city)) byCity.set(img.city, []);
        byCity.get(img.city).push(img);
      }
      const trips = [];
      for (const [city, imgs] of byCity.entries()) {
        imgs.sort((a, b) => (a.takenAt || a.timestamp) - (b.takenAt || b.timestamp));
        let cluster = [];
        const flush = () => {
          const days = cluster.length > 0
            ? dayOf(cluster[cluster.length - 1]) - dayOf(cluster[0]) + 1 : 0;
          // 误报过滤：多天行程 >=minPhotos 张即可；单日簇要 >=8 张（去邻市办事/路过拍几张不算旅行）
          const qualifies = cluster.length >= minPhotos && (days >= 2 || cluster.length >= 8);
          if (qualifies) {
            trips.push({
              city,
              cityName: formatCityName(city),   // 显示名（清洗掉 CN_unknown_ 等内部前缀）
              startDay: cluster[0].takenAt || cluster[0].timestamp,
              endDay: cluster[cluster.length - 1].takenAt || cluster[cluster.length - 1].timestamp,
              days,
              count: cluster.length,
              cover: cluster[Math.floor(cluster.length / 2)],   // 中段照片当封面（首尾常是路途）
              images: cluster,
            });
          }
          cluster = [];
        };
        for (const img of imgs) {
          if (cluster.length === 0 || dayOf(img) - dayOf(cluster[cluster.length - 1]) <= maxGapDays) {
            cluster.push(img);
          } else { flush(); cluster = [img]; }
        }
        flush();
      }
      trips.sort((a, b) => b.endDay - a.endDay);
      return { trips };
    } catch (error) {
      logger.error('行程识别失败:', error);
      return { trips: [] };
    }
  }

  /**
   * 节日回忆：历年节日（春节/国庆/中秋/元旦/五一/圣诞）期间拍的照片聚合卡片。
   * 纯内存（毫秒级）；每张卡 = 节日+年份，≥3 张才成卡。
   * @returns {Promise<{cards:Array<{key,name,nameEn,year,count,cover,images,ts}>}>} 按时间倒序
   */
  async findHolidayMemories({ minPhotos = 3 } = {}) {
    try {
      await this.imageCache.buildCache();
      const all = (this.imageCache.getCache().allImages || []).filter((img) => {
        const ts = img && (img.takenAt || img.timestamp);
        return img && img.id && ts > 0;
      });
      if (all.length === 0) return { cards: [] };
      const { holidayRangesForYear } = require('../components/shared/holidays');
      // 预生成涉及年份的节日范围
      const years = new Set(all.map((i) => new Date(i.takenAt || i.timestamp).getFullYear()));
      const ranges = [];
      for (const y of years) {
        for (const r of holidayRangesForYear(y)) {
          ranges.push({ ...r, year: y, startMs: r.start.getTime(), endMs: r.end.getTime() + 86399999 });
        }
      }
      const buckets = new Map();   // `${key}-${year}` → { range, images }
      for (const img of all) {
        const ts = img.takenAt || img.timestamp;
        for (const r of ranges) {
          if (ts >= r.startMs && ts <= r.endMs) {
            const k = `${r.key}-${r.year}`;
            if (!buckets.has(k)) buckets.set(k, { range: r, images: [] });
            buckets.get(k).images.push(img);
            break;
          }
        }
      }
      const cards = [];
      for (const { range, images } of buckets.values()) {
        if (images.length < minPhotos) continue;
        images.sort((a, b) => (a.takenAt || a.timestamp) - (b.takenAt || b.timestamp));
        cards.push({
          key: range.key,
          name: range.zh,
          nameEn: range.en,
          year: range.year,
          count: images.length,
          cover: images[Math.floor(images.length / 2)],
          images,
          ts: range.startMs,
        });
      }
      cards.sort((a, b) => b.ts - a.ts);
      return { cards };
    } catch (error) {
      logger.error('节日回忆失败:', error);
      return { cards: [] };
    }
  }

  /**
   * 相册统计（年报）：纯内存聚合，毫秒级。
   */
  async getAlbumStats() {
    try {
      await this.imageCache.buildCache();
      const all = (this.imageCache.getCache().allImages || []).filter((i) => i && i.id);
      let photos = 0; let videos = 0; let totalBytes = 0; let withDesc = 0;
      let videoSeconds = 0; let longestVideo = null;
      const byYear = new Map(); const byCategory = new Map(); const byCity = new Map(); const byDay = new Map();
      let earliest = null; let latest = null;
      for (const img of all) {
        const isVideo = String(img.mimeType || '').startsWith('video/');
        if (isVideo) {
          videos++;
          videoSeconds += img.duration || 0;
          if (!longestVideo || (img.duration || 0) > (longestVideo.duration || 0)) longestVideo = img;
        } else { photos++; }
        totalBytes += img.size || 0;
        if (img.message) withDesc++;
        const ts = img.takenAt || img.timestamp || 0;
        if (ts > 0) {
          if (!earliest || ts < earliest) earliest = ts;
          if (!latest || ts > latest) latest = ts;
          const d = new Date(ts);
          byYear.set(d.getFullYear(), (byYear.get(d.getFullYear()) || 0) + 1);
          const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          byDay.set(dayKey, (byDay.get(dayKey) || 0) + 1);
        }
        if (img.category && img.category !== 'NA' && img.category !== 'NA_video') {
          byCategory.set(img.category, (byCategory.get(img.category) || 0) + 1);
        }
        if (img.city) byCity.set(img.city, (byCity.get(img.city) || 0) + 1);
      }
      const topN = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
      const busiest = topN(byDay, 1)[0] || null;
      return {
        total: all.length, photos, videos, totalBytes,
        withDesc, videoSeconds, longestVideo,
        earliest, latest,
        years: [...byYear.entries()].sort((a, b) => a[0] - b[0]),
        topCategories: topN(byCategory, 5),
        topCities: topN(byCity, 5),
        busiestDay: busiest ? { day: busiest[0], count: busiest[1] } : null,
      };
    } catch (error) {
      logger.error('相册统计失败:', error);
      return null;
    }
  }

  /**
   * 查找完全重复的照片（字节级同一张图的多份拷贝）。
   * 分组键 = size|takenAt|宽x高 ——三者全同且 size 精确相等，实践上即同一文件
   * （连拍/相似图的字节数几乎必然不同）；有颜色特征索引时再用直方图 ≥0.985 复核剔除碰撞。
   * 视频不参与。每组按 timestamp 升序，第一张为「保留」，其余为冗余。
   * @returns {Promise<{groups:Array, totalRedundant:number, totalWastedBytes:number}>}
   */
  async findExactDuplicates() {
    try {
      await this.imageCache.buildCache();
      const all = (this.imageCache.getCache().allImages || []).filter((img) =>
        img && img.id && !String(img.mimeType || '').startsWith('video/') && (img.size || 0) > 0
      );
      const byKey = new Map();
      for (const img of all) {
        const key = `${img.size}|${img.takenAt || 0}|${img.width || 0}x${img.height || 0}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(img);
      }
      let featuresMap = null;
      const groups = [];
      let totalRedundant = 0;
      let totalWastedBytes = 0;
      for (const [key, imgs] of byKey.entries()) {
        if (imgs.length < 2) continue;
        // 直方图复核（有索引才做）：与组内第一张相似度 <0.985 视为元数据碰撞，踢出该组
        let members = imgs;
        try {
          if (featuresMap === null) featuresMap = await this.imageStorageService.readAllImageFeatures();
          const sim = require('./ImageSimilarityService.js').default;
          const f0 = featuresMap[imgs[0].id];
          if (f0 && f0.color_histogram) {
            members = imgs.filter((m, i) => {
              if (i === 0) return true;
              const f = featuresMap[m.id];
              if (!f || !f.color_histogram) return true;   // 无特征不否决（元数据条件已极强）
              return sim.scoreFeatureSimilarity(f0, f) >= 0.985;
            });
          }
        } catch (_) { /* 复核失败按元数据分组 */ }
        if (members.length < 2) continue;
        members.sort((a, b) => ((a.timestamp || a.takenAt || 0) - (b.timestamp || b.takenAt || 0)));
        const redundantIds = members.slice(1).map((m) => m.id);
        groups.push({
          key,
          images: members,
          keepId: members[0].id,
          redundantIds,
          wastedBytes: (members[0].size || 0) * redundantIds.length,
        });
        totalRedundant += redundantIds.length;
        totalWastedBytes += (members[0].size || 0) * redundantIds.length;
      }
      groups.sort((a, b) => b.wastedBytes - a.wastedBytes);
      return { groups, totalRedundant, totalWastedBytes };
    } catch (error) {
      logger.error('查找重复照片失败:', error);
      return { groups: [], totalRedundant: 0, totalWastedBytes: 0 };
    }
  }

  /** 文本 → 字符 bigram 集合（去空白/标点、转小写）。中文无分词，bigram 比 token 稳。 */
  _bigrams(text) {
    const s = String(text || '').toLowerCase().replace(/[\s\p{P}]+/gu, '');
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }

  /**
   * 文本相似度（0-1）：bigram Dice 系数（对称）。适合「描述 vs 描述」。
   */
  _textSimilarity(a, b) {
    const g1 = this._bigrams(a); const g2 = this._bigrams(b);
    if (g1.size === 0 || g2.size === 0) return 0;
    let inter = 0;
    for (const g of g1) { if (g2.has(g)) inter++; }
    return (2 * inter) / (g1.size + g2.size);
  }

  /**
   * 查询包含度（0-1）：查询的 bigram 被文档覆盖的比例（非对称）。
   * 适合「短查询 vs 长描述」——Dice 会被长度差惩罚，这里只看查询词覆盖率。
   */
  _gramContainment(queryText, docText) {
    const q = this._bigrams(queryText); const d = this._bigrams(docText);
    if (q.size === 0 || d.size === 0) return 0;
    let inter = 0;
    for (const g of q) { if (d.has(g)) inter++; }
    return inter / q.size;
  }

  /**
   * 语义文字搜图：查询短语与库中 AI 描述(message)+分类名 做 bigram 包含度匹配。
   * 与关键字搜图（子串精确匹配）互补：写"狗在草地上跑"也能命中"草坪上奔跑的小狗"这类描述。
   * @returns {Promise<{results:Array, untaggedCount:number, total:number}>} results 含 aiScore
   */
  async searchBySemanticText(query, { limit = 80, minScore = 0.45 } = {}) {
    try {
      const q = String(query || '').trim();
      if (!q) return { results: [], untaggedCount: 0, total: 0 };
      await this.imageCache.buildCache();
      const all = this.imageCache.getCache().allImages || [];
      let untagged = 0;
      const nameMap = (() => {
        try { return require('./ConfigService').default.getCategoryNameMap() || {}; } catch (_) { return {}; }
      })();
      const scored = [];
      for (const img of all) {
        if (!img || !img.id) continue;
        if (!img.message) { untagged++; }
        const catName = (nameMap[img.category] && (nameMap[img.category].chinese || nameMap[img.category].english)) || '';
        const doc = `${img.message || ''} ${catName}`;
        const score = this._gramContainment(q, doc);
        if (score >= minScore) scored.push({ ...img, aiScore: score });
      }
      scored.sort((a, b) => b.aiScore - a.aiScore || ((b.takenAt || 0) - (a.takenAt || 0)));
      return { results: scored.slice(0, limit), untaggedCount: untagged, total: all.length };
    } catch (error) {
      logger.error('语义搜图失败:', error);
      return { results: [], untaggedCount: 0, total: 0 };
    }
  }

  /**
   * AI 搜图（语义以图搜图）：给定目标图的 AI 分类信息（category + 描述），
   * 与库中已分类内容（分类强权重 + AI 描述 bigram 相似度）比对，按分数排序。
   * 含视频；零库侧成本（直接复用已有分类成果）。
   * @param {{category:string|null, desc:string}} target
   * @returns {Promise<{results:Array, total:number}>} results 含 aiScore
   */
  async searchByAISemantics(target, { limit = 80 } = {}) {
    try {
      const cat = target && target.category && target.category !== 'other' ? target.category : null;
      const desc = (target && target.desc) || '';
      await this.imageCache.buildCache();
      const all = this.imageCache.getCache().allImages || [];
      const scored = [];
      for (const img of all) {
        if (!img || !img.id) continue;
        const catMatch = !!(cat && img.category === cat);
        const descSim = desc && img.message ? this._textSimilarity(desc, img.message) : 0;
        // 分类同桶 = 0.6 基分；描述相似最高加 0.4。无分类命中时描述要足够像才进结果。
        if (!catMatch && descSim < 0.35) continue;
        scored.push({ ...img, aiScore: (catMatch ? 0.6 : 0) + descSim * 0.4 });
      }
      scored.sort((a, b) => b.aiScore - a.aiScore || ((b.takenAt || 0) - (a.takenAt || 0)));
      return { results: scored.slice(0, limit), total: all.length };
    } catch (error) {
      logger.error('AI 搜图失败:', error);
      return { results: [], total: 0 };
    }
  }

  /**
   * 按描述/关键词搜图：匹配 AI 描述(message) + 分类名 + 文件名 + 城市/国家。
   * 语义搜索依赖 AI 描述（只有多模态档分类过的图才有）；未打描述的图统计出来提示用户。
   * @param {string} query
   * @returns {Promise<{results:Array, untaggedCount:number, total:number, withDescCount:number}>}
   */
  /**
   * 扩展检索词：时间(2024/5月)、格式(jpg/视频)、分辨率(4k/1080p/宽x高)、方向(横屏/竖屏)、
   * 拍摄参数分类(含中文翻译)、目录名、大小(Nmb/大文件)——全部进关键字索引。
   */
  _searchHaystackExtras(img) {
    const parts = [];
    const ts = img.takenAt || img.timestamp || 0;
    if (ts > 0) {
      const d = new Date(ts);
      const y = d.getFullYear(); const m = d.getMonth() + 1; const day = d.getDate();
      parts.push(`${y}`, `${y}年`, `${m}月`, `${y}年${m}月`, `${y}-${String(m).padStart(2, '0')}`, `${m}月${day}日`);
    }
    const mt = String(img.mimeType || '');
    const sub = (mt.split('/')[1] || '').toLowerCase();
    if (sub) { parts.push(sub); if (sub === 'jpeg') parts.push('jpg'); }
    if (mt.startsWith('video/')) parts.push('视频', 'video');
    const w = img.width || 0; const h = img.height || 0;
    if (w > 0 && h > 0) {
      parts.push(`${w}x${h}`);
      const long = Math.max(w, h);
      if (long >= 3840) parts.push('4k', '超高清');
      else if (long >= 1920) parts.push('1080p', '高清');
      if (w > h) parts.push('横屏', '横向', 'landscape');
      else if (h > w) parts.push('竖屏', '竖向', 'portrait');
      else parts.push('方形', 'square');
    }
    try {
      const { getCameraSettingsCategoryTranslation } = require('../i18n');
      for (const [type, val] of [['iso', img.isoCategory], ['aperture', img.apertureCategory], ['shutter', img.shutterCategory], ['focalLength', img.focalLengthCategory]]) {
        if (val) {
          parts.push(String(val));
          const tr = getCameraSettingsCategoryTranslation(type, val);
          if (tr && tr !== val) parts.push(String(tr));
        }
      }
    } catch (_) { /* 翻译不可用就只搜原始值 */ }
    const uri = String(img.uri || '');
    if (!uri.startsWith('ph://')) {
      const path = uri.includes('||') ? (uri.split('||')[1] || uri.split('||')[0]) : uri;
      const segs = path.replace(/^file:\/\//, '').split('/').filter(Boolean);
      if (segs.length >= 2) parts.push(segs[segs.length - 2]);   // 目录名（倒数第二段）
    }
    const size = img.size || 0;
    if (size > 0) {
      const mb = size / (1024 * 1024);
      parts.push(`${Math.max(1, Math.round(mb))}mb`);
      if (mb >= 20) parts.push('大文件');
    }
    return parts.join(' ');
  }

  async searchImages(query) {
    try {
      const q = String(query || '').trim().toLowerCase();
      await this.imageCache.buildCache();
      const all = this.imageCache.getCache().allImages || [];
      if (!q) return { results: [], untaggedCount: 0, total: all.length, withDescCount: 0 };
      const terms = q.split(/\s+/).filter(Boolean);
      const getCatName = (id) => {
        try { return this.configService.getCategoryDisplayName(id, 'zh') || id; } catch (_) { return id; }
      };
      let untaggedCount = 0;
      let withDescCount = 0;
      const results = [];
      for (const img of all) {
        const desc = (img.message != null ? String(img.message) : '').trim();
        if (desc) withDescCount++; else untaggedCount++;
        const hay = [
          desc,
          getCatName(img.category),
          img.fileName || '',
          img.city || '',
          img.country || '',
          this._searchHaystackExtras(img),
        ].join(' ').toLowerCase();
        if (hay.includes(q) || terms.every((t) => hay.includes(t))) {
          results.push(img);
        }
      }
      results.sort((a, b) => this._getImageTime(b) - this._getImageTime(a));
      return { results, untaggedCount, total: all.length, withDescCount };
    } catch (error) {
      logger.error('searchImages 失败:', error);
      return { results: [], untaggedCount: 0, total: 0, withDescCount: 0 };
    }
  }

  /**
   * 按时间桶获取图片列表（时间倒序）
   * @param {string} timeKey - thisWeek | thisMonth | thisYear | lastYear | yearBeforeLast | YYYY | past
   * @returns {Promise<Array>}
   */
  async readImagesByTimeRange(timeKey) {
    try {
      await this.imageCache.buildCache();
      const allImages = this.imageCache.getCache().allImages || [];
      const list = allImages.filter((img) => this._getTimeBucketKey(this._getImageTime(img)) === timeKey);
      list.sort((a, b) => this._getImageTime(b) - this._getImageTime(a));
      return list;
    } catch (error) {
      logger.error('readImagesByTimeRange 失败:', error);
      return [];
    }
  }

  /**
   * 按时间桶获取最近若干张图（用于首页卡片缩略图）
   * @param {string} timeKey
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async readRecentImagesByTimeRange(timeKey, limit = 1) {
    try {
      const list = await this.readImagesByTimeRange(timeKey);
      return list.slice(0, limit);
    } catch (error) {
      logger.error('readRecentImagesByTimeRange 失败:', error);
      return [];
    }
  }

  /**
   * 获取指定城市的最近图片
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readRecentImagesByCity(city, limit = 4) {
    try {
      // 直接从缓存获取城市图片
      const cityImages = this.imageCache.getImagesByCity(city);
      
      // 按时间排序并取前N张
      const recentImages = cityImages
        .sort((a, b) => {
          const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
          const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
          return timeB - timeA;
        })
        .slice(0, limit);
      
      return recentImages;
      
    } catch (error) {
      logger.error('读取城市最近图片失败:', error);
      throw error;
    }
  }

  /**
   * 获取分类统计
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readCategoryCounts() {
    try {
      // 确保缓存已加载（等待初始化完成）
      await this.imageCache.buildCache();
      
      // 从缓存读取
      const cache = this.imageCache.getCache();
      if (cache.categoryCounts && Object.keys(cache.categoryCounts).length > 0) {
        logger.debug('从缓存读取分类统计');
        return cache.categoryCounts;
      }
      
      // 如果缓存中仍然没有，说明数据库中也没有数据
      logger.debug('缓存中没有分类统计，返回空对象');
      return {};
      
    } catch (error) {
      logger.error('读取分类统计失败:', error);
      throw error;
    }
  }

  /**
   * 获取城市统计
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readCityCounts() {
    try {
      // 确保缓存已加载（等待初始化完成）
      await this.imageCache.buildCache();
      
      // 从缓存读取
      const cache = this.imageCache.getCache();
      if (cache.cityCounts && Object.keys(cache.cityCounts).length > 0) {
        logger.debug('从缓存读取城市统计');
        return cache.cityCounts;
      }
      
      // 如果缓存中仍然没有，说明数据库中也没有数据
      logger.debug('缓存中没有城市统计，返回空对象');
      return {};
      
    } catch (error) {
      logger.error('读取城市统计失败:', error);
      throw error;
    }
  }

  /**
   * 获取颜色统计
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readColorCounts() {
    try {
      // 确保缓存已加载（等待初始化完成）
      await this.imageCache.buildCache();
      
      // 从缓存读取
      const cache = this.imageCache.getCache();
      if (cache.colorCounts && Object.keys(cache.colorCounts).length > 0) {
        logger.debug('从缓存读取颜色统计');
        // 过滤掉 null、undefined 和空字符串
        const filteredColorCounts = {};
        Object.entries(cache.colorCounts).forEach(([color, count]) => {
          if (color && 
              typeof color === 'string' && 
              color.trim() !== '' && 
              color !== 'null' && 
              color !== 'undefined') {
            filteredColorCounts[color] = count;
          }
        });
        return filteredColorCounts;
      }
      
      // 如果缓存中仍然没有，说明数据库中也没有数据
      logger.debug('缓存中没有颜色统计，返回空对象');
      return {};
      
    } catch (error) {
      logger.error('读取颜色统计失败:', error);
      throw error;
    }
  }

  /**
   * 根据颜色获取图片
   * 优先从缓存读取
   */
  async readImagesByColor(color, limit = null) {
    try {
      // 确保缓存已加载
      await this.imageCache.buildCache();
      
      // 从缓存获取所有图片
      const allImages = this.imageCache.getCache().allImages;
      
      // 过滤出指定颜色的图片
      const colorImages = allImages.filter(img => 
        img.background_color === color
      );
      
      // 按时间排序
      const sortedImages = colorImages.sort((a, b) => {
        const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
        const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
        return timeB - timeA;
      });
      
      return limit ? sortedImages.slice(0, limit) : sortedImages;
      
    } catch (error) {
      logger.error('读取颜色图片失败:', error);
      throw error;
    }
  }

  /**
   * 获取指定颜色的最近图片
   * 优先从缓存读取
   */
  async readRecentImagesByColor(color, limit = 4) {
    return await this.readImagesByColor(color, limit);
  }

  /**
   * 读取新发现的照片（从上次扫描时间之后，相册中新发现的照片）
   * 空窗兜底：当「自上次扫描后新增」为空时，回退展示「最近入库的照片」，
   * 避免时间窗随多次扫描不断前滑后该区长期空白，且保证总能看到最新的照片。
   * @param {number} limit - 限制返回数量，默认12（用于显示）
   * @returns {Promise<{total: number, images: Array}>} 返回总数和图片列表（最多limit张）
   */
  async readNewDiscoveredImages(limit = 12) {
    try {
      const since = await this._readNewDiscoveredImagesSince(limit);
      if (since && since.total > 0 && Array.isArray(since.images) && since.images.length > 0) {
        return since;
      }
      // 兜底：展示最近的照片（按时间倒序），isFallback 供 UI 区分文案
      const fallback = await this._readMostRecentImages(limit);
      return { ...fallback, isFallback: true };
    } catch (error) {
      logger.error('读取新发现的照片失败(外层):', error);
      try {
        const fallback = await this._readMostRecentImages(limit);
        return { ...fallback, isFallback: true };
      } catch (_) {
        return { total: 0, images: [] };
      }
    }
  }

  /**
   * 兜底：读取最近的照片（按拍摄/入库时间倒序），与平台无关，只要库里有图就不为空
   * @param {number} limit
   * @returns {Promise<{total: number, images: Array}>}
   */
  async _readMostRecentImages(limit = 12) {
    const all = await this.readAllImages();
    const list = (Array.isArray(all) ? all : [])
      .slice()
      .sort((a, b) => (this._getImageTime(b) - this._getImageTime(a)));
    return { total: list.length, images: list.slice(0, limit) };
  }

  /**
   * 读取新发现的照片（从上次扫描时间之后，相册中新发现的照片）
   * @param {number} limit - 限制返回数量，默认12（用于显示）
   * @returns {Promise<{total: number, images: Array}>} 返回总数和图片列表（最多limit张）
   */
  async _readNewDiscoveredImagesSince(limit = 12) {
    try {
      // 获取扫描时间。「新发现」基准用 prevScanTime（上上次扫描）：
      // 若用 lastScanTime，刚扫完该区就清空，两次扫描之间拍的内容扫完后也永远进不来（死循环）。
      const settings = await this.readSettings();
      const lastScanTime = settings?.lastScanTime;

      if (!lastScanTime) {
        // 如果没有扫描记录，返回空结果
        logger.debug('没有扫描记录，返回空结果');
        return { total: 0, images: [] };
      }

      const baseTime = settings?.prevScanTime || lastScanTime;
      const sinceTime = new Date(baseTime).getTime();
      
      if (isNaN(sinceTime)) {
        logger.error(`❌ lastScanTime 格式错误: ${lastScanTime}`);
        return { total: 0, images: [] };
      }
      
      // 根据平台选择不同的实现方式
      const { Platform } = require('../adapters/WebAdapters');
      
      if (Platform.OS === 'web') {
        // PC端：遍历文件系统，查找 mtime >= lastScanTime 的图片文件
        return await this._readNewDiscoveredImagesFromFileSystem(sinceTime, limit, settings.scanPaths || []);
      } else if (Platform.OS === 'ios') {
        // iOS：PhotoKit 没有「自上次扫描以来新增」的原生筛选 API，但增量监听
        // (PHPhotoLibraryChangeObserver) 已经把新照片插进 DB 了。从已落库的全量按
        // takenAt（≈ PHAsset.creationDate）过滤，足以反映「新拍/新导入」的图。
        // 实际成本：~万级一次内存过滤 ≈ 几 ms，没必要走原生。
        const all = await this.readAllImages();
        const recent = (Array.isArray(all) ? all : [])
          .filter((img) => (img.takenAt || img.timestamp || 0) >= sinceTime)
          .sort((a, b) => (b.takenAt || b.timestamp || 0) - (a.takenAt || a.timestamp || 0));
        return { total: recent.length, images: recent.slice(0, limit) };
      } else {
        // Android：使用 MediaStore API（PC 端、iOS 都不走这条路径）
        const mediaStoreService = require('./MediaStoreService').default;

        if (!mediaStoreService.checkAvailability()) {
          logger.warn('MediaStore 不可用，无法查询新发现的照片');
          return { total: 0, images: [] };
        }

        // 先查询所有新照片（不限制数量）以获取总数
        const allResult = await mediaStoreService.getImagesSinceTime({
          sinceTime: sinceTime,
          limit: 0, // 0表示不限制
          offset: 0
        });

        let allImages = mediaStoreService.convertBatchToCompatibleFormat(allResult.images || []);

        // MediaStore 查询只覆盖图片——视频从 DB 补（扫描已入库的视频按 takenAt 过滤），合并后按时间排
        try {
          const all = await this.readAllImages();
          const newVideos = (Array.isArray(all) ? all : []).filter((img) =>
            String(img.mimeType || '').startsWith('video/') &&
            ((img.takenAt || img.timestamp || 0) >= sinceTime)
          );
          if (newVideos.length > 0) {
            const seen = new Set(allImages.map((i) => i.id));
            allImages = allImages.concat(newVideos.filter((v) => !seen.has(v.id)));
            allImages.sort((a, b) => ((b.takenAt || b.timestamp || 0) - (a.takenAt || a.timestamp || 0)));
          }
        } catch (_) { /* 视频合并失败不影响图片展示 */ }

        const total = allImages.length;

        // 只返回前limit张用于显示
        const images = allImages.slice(0, limit);

        return { total, images };
      }
      
    } catch (error) {
      logger.error('读取新发现的照片失败:', error);
      // 出错时返回空结果，不影响主流程
      return { total: 0, images: [] };
    }
  }

  /**
   * PC端：从文件系统查找新发现的照片（mtime >= lastScanTime）
   * @param {number} sinceTime - 起始时间戳（毫秒）
   * @param {number} limit - 限制返回数量（用于显示）
   * @param {Array<string>} scanPaths - 扫描目录列表
   * @returns {Promise<{total: number, images: Array}>} 返回总数和图片列表（最多limit张）
   */
  async _readNewDiscoveredImagesFromFileSystem(sinceTime, limit, scanPaths) {
    try {
      const { RNFS, Platform, pathToFileUri } = require('../adapters/WebAdapters');
      
      if (!RNFS) {
        logger.warn('RNFS 不可用，无法查询新发现的照片');
        return [];
      }
      
      if (!scanPaths || scanPaths.length === 0) {
        return [];
      }
      
      const newImages = [];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
      
      // 递归遍历目录，查找新照片（不限制数量，统计所有）
      const scanDirectory = async (dirPath) => {
        try {
          const exists = await RNFS.exists(dirPath);
          if (!exists) {
            return;
          }
          
          const items = await RNFS.readDir(dirPath);
          
          for (const item of items) {
            
            if (item.isDirectory()) {
              // 递归扫描子目录
              await scanDirectory(item.path);
            } else {
              // 检查是否是图片文件
              const lowerFileName = item.name.toLowerCase();
              const isImage = imageExtensions.some(ext => lowerFileName.endsWith(ext));
              
              if (isImage) {
                try {
                  // 获取文件统计信息
                  const stats = await RNFS.stat(item.path);
                  
                  // Windows上：birthtime 是真正的创建时间，ctime 实际上是状态更改时间（通常等于 mtime）
                  // 优先使用 birthtime，如果没有则使用 mtime（修改时间）
                  // 因为复制文件时，birthtime 会更新为复制时间
                  let fileTime = null;
                  let timeField = null;
                  
                  // 尝试获取 birthtime（创建时间）
                  if (stats.birthtime) {
                    fileTime = stats.birthtime;
                    timeField = 'birthtime';
                  } else if (stats.ctime) {
                    // Windows上 ctime 通常等于 mtime，但可以作为备选
                    fileTime = stats.ctime;
                    timeField = 'ctime';
                  } else if (stats.mtime) {
                    // 最后使用 mtime（修改时间）
                    fileTime = stats.mtime;
                    timeField = 'mtime';
                  }
                  
                  if (fileTime) {
                    // 处理时间：可能是 Date 对象或时间戳
                    let timeValue = fileTime;
                    if (timeValue instanceof Date) {
                      // 如果是 Date 对象，直接转换为时间戳（已经是UTC时间）
                      timeValue = timeValue.getTime();
                    } else if (typeof timeValue === 'number') {
                      // 如果是数字，检查是否是微秒时间戳
                      if (timeValue > 9999999999999) {
                        timeValue = Math.floor(timeValue / 1000); // 转换为毫秒级
                      }
                    } else {
                      // 其他类型，尝试转换为 Date 再获取时间戳
                      timeValue = new Date(timeValue).getTime();
                    }
                    
                    const fileTimeMs = timeValue;
                    
                    // 检查文件创建/复制时间是否在 lastScanTime 之后
                    if (fileTimeMs >= sinceTime) {
                      // 构建图片信息（简化版，只包含必要字段）
                      const fileUri = pathToFileUri(item.path);
                      newImages.push({
                        id: `new_${item.path}_${fileTimeMs}`, // 临时ID
                        uri: fileUri,
                        fileName: item.name,
                        path: item.path,
                        size: stats.size || 0,
                        ctime: fileTimeMs, // 保持字段名不变，但实际是 birthtime 或 mtime
                        // 其他字段可以后续补充
                      });
                    }
                  }
                } catch (statError) {
                  // 忽略单个文件的错误，继续处理其他文件
                }
              }
            }
          }
        } catch (error) {
          // 忽略单个目录的错误，继续处理其他目录
        }
      };
      
      // 遍历所有扫描目录（不限制，统计所有新照片）
      for (const scanPath of scanPaths) {
        await scanDirectory(scanPath);
      }
      
      // 按创建/复制时间降序排序
      newImages.sort((a, b) => (b.ctime || 0) - (a.ctime || 0));
      
      // 统计总数
      const total = newImages.length;
      
      // 只返回前limit张用于显示
      const images = newImages.slice(0, limit);
      
      return { total, images };
      
    } catch (error) {
      logger.error('PC端读取新发现的照片失败:', error);
      return { total: 0, images: [] };
    }
  }

  /**
   * 读取目录统计
   */
  async readDirectoryCounts() {
    try {
      // 确保缓存已加载（等待初始化完成）
      await this.imageCache.buildCache();
      
      // 从缓存读取
      const cache = this.imageCache.getCache();
      if (cache.directoryCounts && Object.keys(cache.directoryCounts).length > 0) {
        logger.debug('从缓存读取目录统计');
        // 过滤掉无效目录
        const filteredDirectoryCounts = {};
        Object.entries(cache.directoryCounts).forEach(([directory, count]) => {
          if (directory && 
              typeof directory === 'string' && 
              directory.trim() !== '' && 
              directory !== 'null' && 
              directory !== 'undefined') {
            filteredDirectoryCounts[directory] = count;
          }
        });
        return filteredDirectoryCounts;
      }
      
      // 如果缓存中仍然没有，说明数据库中也没有数据
      logger.debug('缓存中没有目录统计，返回空对象');
      return {};
      
    } catch (error) {
      logger.error('读取目录统计失败:', error);
      throw error;
    }
  }

  /**
   * 获取格式统计
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readFormatCounts() {
    try {
      // 确保缓存已加载（等待初始化完成）
      await this.imageCache.buildCache();
      
      // 从缓存读取
      const cache = this.imageCache.getCache();
      if (cache.formatCounts && Object.keys(cache.formatCounts).length > 0) {
        logger.debug('从缓存读取格式统计');
        return cache.formatCounts;
      }
      
      // 如果缓存中仍然没有，说明数据库中也没有数据
      logger.debug('缓存中没有格式统计，返回空对象');
      return {};
      
    } catch (error) {
      logger.error('读取格式统计失败:', error);
      throw error;
    }
  }

  /**
   * 获取分辨率统计
   * 只返回前7个最多的分辨率，其他合并为"其他"
   */
  async readResolutionCounts() {
    try {
      // 确保缓存已加载（等待初始化完成）
      await this.imageCache.buildCache();
      
      // 先检查原始统计数据
      const cache = this.imageCache.getCache();
      const rawCounts = cache.resolutionCounts || {};
      logger.debug(`📐 原始分辨率统计: ${Object.keys(rawCounts).length} 种分辨率`);
      
      // 使用 getTopResolutions(7) 只返回前7个最多的，其他合并为"其他"
      const topResolutions = this.imageCache.getTopResolutions(7);
      
      if (Object.keys(topResolutions).length > 0) {
        logger.debug(`从缓存读取分辨率统计（前7个）: ${Object.keys(topResolutions).length} 种分辨率`);
        return topResolutions;
      }
      
      // 如果缓存中仍然没有，说明数据库中也没有数据（刚启动app时没有数据是正常情况）
      logger.debug('缓存中没有分辨率统计，返回空对象');
      return {};
      
    } catch (error) {
      logger.error('读取分辨率统计失败:', error);
      throw error;
    }
  }

  /**
   * 获取方向统计
   * 返回横屏、竖屏、全景、正方形等方向统计
   */
  async readOrientationCounts() {
    try {
      // 确保缓存已加载（等待初始化完成）
      await this.imageCache.buildCache();
      
      // 从缓存读取
      const cache = this.imageCache.getCache();
      if (cache.orientationCounts && Object.keys(cache.orientationCounts).length > 0) {
        logger.debug('从缓存读取方向统计');
        return cache.orientationCounts;
      }
      
      // 如果缓存中仍然没有，说明数据库中也没有数据
      logger.debug('缓存中没有方向统计，返回空对象');
      return {};
      
    } catch (error) {
      logger.error('读取方向统计失败:', error);
      throw error;
    }
  }

  /**
   * 根据目录获取图片
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readImagesByDirectory(directory, limit = null) {
    try {
      // 确保缓存已加载
      await this.imageCache.buildCache();
      
      // 从缓存获取所有图片
      const directoryImages = this.imageCache.getImagesByDirectory(directory);
      
      // 按时间排序
      const sortedImages = directoryImages.sort((a, b) => {
        const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
        const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
        return timeB - timeA;
      });
      
      // 如果指定了限制，只返回前N张
      if (limit && limit > 0) {
        return sortedImages.slice(0, limit);
      }
      
      return sortedImages;
    } catch (error) {
      logger.error('读取目录图片失败:', error);
      throw error;
    }
  }

  /**
   * 根据格式获取图片
   * 优先从缓存读取
   */
  async readImagesByFormat(format, limit = null) {
    try {
      // 确保缓存已加载
      await this.imageCache.buildCache();
      
      // 从缓存获取格式图片
      const formatImages = this.imageCache.getImagesByFormat(format);
      
      // 按时间排序
      const sortedImages = formatImages.sort((a, b) => {
        const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
        const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
        return timeB - timeA;
      });
      
      return limit ? sortedImages.slice(0, limit) : sortedImages;
    } catch (error) {
      logger.error('读取格式图片失败:', error);
      throw error;
    }
  }

  /**
   * 根据分辨率获取图片
   * 优先从缓存读取
   */
  async readImagesByResolution(resolution, limit = null) {
    try {
      // 确保缓存已加载
      await this.imageCache.buildCache();
      
      // 从缓存获取分辨率图片
      const resolutionImages = this.imageCache.getImagesByResolution(resolution);
      
      // 按时间排序
      const sortedImages = resolutionImages.sort((a, b) => {
        const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
        const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
        return timeB - timeA;
      });
      
      return limit ? sortedImages.slice(0, limit) : sortedImages;
    } catch (error) {
      logger.error('读取分辨率图片失败:', error);
      throw error;
    }
  }

  /**
   * 获取指定格式的最近图片
   */
  async readRecentImagesByFormat(format, limit = 4) {
    return await this.readImagesByFormat(format, limit);
  }

  /**
   * 获取指定分辨率的最近图片
   */
  async readRecentImagesByResolution(resolution, limit = 4) {
    return await this.readImagesByResolution(resolution, limit);
  }

  /**
   * 根据方向获取图片
   */
  async readImagesByOrientation(orientation, limit = null) {
    try {
      // 确保缓存已加载
      await this.imageCache.buildCache();
      
      // 从缓存获取方向图片
      const orientationImages = this.imageCache.getImagesByOrientation(orientation);
      
      // 按时间排序
      const sortedImages = orientationImages.sort((a, b) => {
        const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
        const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
        return timeB - timeA;
      });
      
      return limit ? sortedImages.slice(0, limit) : sortedImages;
    } catch (error) {
      logger.error('读取方向图片失败:', error);
      return [];
    }
  }

  /**
   * 🔥 获取ISO统计
   */
  async readISOCounts() {
    try {
      await this.imageCache.buildCache();
      const cache = this.imageCache.getCache();
      return cache.isoCounts || {};
    } catch (error) {
      logger.error('读取ISO统计失败:', error);
      throw error;
    }
  }

  /**
   * 🔥 获取光圈统计
   */
  async readApertureCounts() {
    try {
      await this.imageCache.buildCache();
      const cache = this.imageCache.getCache();
      return cache.apertureCounts || {};
    } catch (error) {
      logger.error('读取光圈统计失败:', error);
      throw error;
    }
  }

  /**
   * 🔥 获取快门统计
   */
  async readShutterCounts() {
    try {
      await this.imageCache.buildCache();
      const cache = this.imageCache.getCache();
      return cache.shutterCounts || {};
    } catch (error) {
      logger.error('读取快门统计失败:', error);
      throw error;
    }
  }

  /**
   * 🔥 获取焦距统计
   */
  async readFocalLengthCounts() {
    try {
      await this.imageCache.buildCache();
      const cache = this.imageCache.getCache();
      return cache.focalLengthCounts || {};
    } catch (error) {
      logger.error('读取焦距统计失败:', error);
      throw error;
    }
  }

  /**
   * 🔥 根据ISO分类获取图片
   */
  async readImagesByISO(isoCategory, limit = null) {
    try {
      await this.imageCache.buildCache();
      const images = this.imageCache.getImagesByISO(isoCategory);
      const sorted = images.sort((a, b) => {
        const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
        const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
        return timeB - timeA;
      });
      return limit ? sorted.slice(0, limit) : sorted;
    } catch (error) {
      logger.error('读取ISO图片失败:', error);
      throw error;
    }
  }

  /**
   * 🔥 根据光圈分类获取图片
   */
  async readImagesByAperture(apertureCategory, limit = null) {
    try {
      await this.imageCache.buildCache();
      const images = this.imageCache.getImagesByAperture(apertureCategory);
      const sorted = images.sort((a, b) => {
        const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
        const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
        return timeB - timeA;
      });
      return limit ? sorted.slice(0, limit) : sorted;
    } catch (error) {
      logger.error('读取光圈图片失败:', error);
      throw error;
    }
  }

  /**
   * 🔥 根据快门分类获取图片
   */
  async readImagesByShutter(shutterCategory, limit = null) {
    try {
      await this.imageCache.buildCache();
      const images = this.imageCache.getImagesByShutter(shutterCategory);
      const sorted = images.sort((a, b) => {
        const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
        const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
        return timeB - timeA;
      });
      return limit ? sorted.slice(0, limit) : sorted;
    } catch (error) {
      logger.error('读取快门图片失败:', error);
      throw error;
    }
  }

  /**
   * 🔥 根据焦距分类获取图片
   */
  async readImagesByFocalLength(focalLengthCategory, limit = null) {
    try {
      await this.imageCache.buildCache();
      const images = this.imageCache.getImagesByFocalLength(focalLengthCategory);
      const sorted = images.sort((a, b) => {
        const timeA = a.takenAt ? new Date(a.takenAt).getTime() : a.timestamp;
        const timeB = b.takenAt ? new Date(b.takenAt).getTime() : b.timestamp;
        return timeB - timeA;
      });
      return limit ? sorted.slice(0, limit) : sorted;
    } catch (error) {
      logger.error('读取焦距图片失败:', error);
      throw error;
    }
  }

  /**
   * 🔥 获取指定ISO分类的最近图片
   */
  async readRecentImagesByISO(isoCategory, limit = 4) {
    return await this.readImagesByISO(isoCategory, limit);
  }

  /**
   * 🔥 获取指定光圈分类的最近图片
   */
  async readRecentImagesByAperture(apertureCategory, limit = 4) {
    return await this.readImagesByAperture(apertureCategory, limit);
  }

  /**
   * 🔥 获取指定快门分类的最近图片
   */
  async readRecentImagesByShutter(shutterCategory, limit = 4) {
    return await this.readImagesByShutter(shutterCategory, limit);
  }

  /**
   * 🔥 获取指定焦距分类的最近图片
   */
  async readRecentImagesByFocalLength(focalLengthCategory, limit = 4) {
    return await this.readImagesByFocalLength(focalLengthCategory, limit);
  }

  /**
   * 获取指定方向的最近图片
   */
  async readRecentImagesByOrientation(orientation, limit = 4) {
    return await this.readImagesByOrientation(orientation, limit);
  }

  /**
   * 获取目录的最近图片
   */
  async readRecentImagesByDirectory(directory, limit = 4) {
    return await this.readImagesByDirectory(directory, limit);
  }

  /**
   * 根据城市/地区获取图片
   * 优先从缓存读取，缓存没有则从数据库读取
   */
  async readImagesByLocation(city, country) {
    try {
      // 直接从缓存获取城市图片
      let filteredImages = [];
      
      if (city) {
        filteredImages = this.imageCache.getImagesByCity(city);
      } else {
        // 如果没有指定城市，返回所有有城市信息的图片
        filteredImages = this.imageCache.getCache().allImages.filter(img => img.city);
      }
      
      // 如果指定了国家，进一步过滤
      if (country) {
        filteredImages = filteredImages.filter(img => 
          img.country && img.country.toLowerCase().includes(country.toLowerCase())
        );
      }
      
      logger.debug('从缓存读取城市图片:', city, filteredImages.length);
      return filteredImages;
      
    } catch (error) {
      logger.error('读取城市图片失败:', error);
      throw error;
    }
  }

  /**
   * 搜索图片
   * 优先从缓存搜索，缓存没有则从数据库搜索
   */

  

  /**
   * 批量保存图片分类结果
   * 先写缓存，再写数据库
   */

  /**
   * 批量更新图片分类ID
   * 优化性能，减少数据库调用次数
   */
  async updateImagesCategory(imageIds, newCategory, newConfidence = 'manual') {
    try {
      const t0 = Date.now();
      logger.debug(`[updateImagesCategory] start: ${imageIds.length} → ${newCategory}`);

      if (!imageIds || imageIds.length === 0) {
        logger.warn('批量更新分类：没有图片ID');
        return { success: true, processed: 0 };
      }

      // 移回「待分类」时按介质路由：图片→NA、视频→NA_video（两边都防：传 NA 或 NA_video 均矫正）。
      if (newCategory === 'NA' || newCategory === 'NA_video') {
        try {
          const all = this.imageCache.getCache().allImages || [];
          const byId = new Map(all.map((i) => [i.id, i]));
          const isVid = (id) => String(byId.get(id)?.mimeType || '').startsWith('video/');
          const vidIds = imageIds.filter(isVid);
          if (vidIds.length === imageIds.length) {
            newCategory = 'NA_video';                 // 全是视频
          } else if (vidIds.length === 0) {
            newCategory = 'NA';                       // 全是图片
          } else {
            const imgIds = imageIds.filter((id) => !isVid(id));
            const rV = await this.updateImagesCategory(vidIds, 'NA_video', newConfidence);
            const rI = await this.updateImagesCategory(imgIds, 'NA', newConfidence);
            return { success: !!(rV.success && rI.success), processed: (rV.processed || 0) + (rI.processed || 0) };
          }
        } catch (_) { /* 取不到缓存就按原 newCategory 走 */ }
      }

      let processed = 0;
      const errors = [];

      // 批量更新数据库
      const t1 = Date.now();
      const result = await this.imageStorageService.batchUpdateImageCategory(imageIds, newCategory, newConfidence);
      logger.debug(`[updateImagesCategory] DB update done in ${Date.now() - t1}ms, processed=${result.processed}`);
      processed = result.processed;
      if (result.errors) {
        errors.push(...result.errors);
      }

      // 批量更新缓存（同步操作，但内含 6 个 rebuild* fn）
      const t2 = Date.now();
      const cacheUpdates = imageIds.map(imageId => ({
        imageId,
        newCategory,
        additionalData: { confidence: newConfidence }
      }));
      const cacheResult = this.imageCache.batchUpdateImageClassification(cacheUpdates);
      logger.debug(`[updateImagesCategory] cache update done in ${Date.now() - t2}ms`);
      if (!cacheResult.success && cacheResult.errors) {
        logger.warn('批量更新缓存部分失败:', cacheResult.errors);
      }

      logger.debug(`[updateImagesCategory] total ${Date.now() - t0}ms, ${processed} 张成功`);

      return {
        success: errors.length === 0,
        processed,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      logger.error('批量更新图片分类失败:', error);
      throw error;
    }
  }

  /**
   * 清理选中图片的分类信息：category→NA（待分类）、清空 AI 描述(message)、置信度归零、清空检测。
   * 用于让用户把图片"退回待分类"，下次扫描会重新分类（含新建的自定义分类）。
   * @param {string[]} imageIds
   * @returns {Promise<{success:boolean, processed:number}>}
   */
  async clearImagesClassification(imageIds) {
    try {
      if (!imageIds || imageIds.length === 0) return { success: true, processed: 0 };
      // 视频退回「待分类视频」NA_video，图片退回 NA。
      const all = this.imageCache.getCache().allImages || [];
      const byId = new Map(all.map((i) => [i.id, i]));
      const arr = imageIds.map((id) => ({
        id,
        category: String(byId.get(id)?.mimeType || '').startsWith('video/') ? 'NA_video' : 'NA',
        message: null,                  // 清空 AI 描述
        confidence: 0,
        generalDetections: null,
        idCardDetections: null,
        mobileNetV3Detections: null,
      }));
      const result = await this.batchUpdateClassification(arr, false);
      try { await this.imageCache.refreshCache(); } catch (_) {}
      logger.debug(`[clearImagesClassification] 已清理 ${imageIds.length} 张 → 待分类`);
      return { success: !!(result && result.success), processed: (result && result.updatedCount) || imageIds.length };
    } catch (error) {
      logger.error('清理图片分类失败:', error);
      throw error;
    }
  }

  /**
   * 人工编辑 AI 描述（message 字段）。
   * 只动 message（存储层动态 SET 不会碰 category/检测结果）；改完描述立即可被搜索命中。
   */
  async updateImageDescription(imageId, message) {
    try {
      if (!imageId) return { success: false };
      const text = String(message == null ? '' : message).trim();
      const result = await this.batchUpdateClassification([{ id: imageId, message: text || null }], false);
      try { await this.imageCache.refreshCache(); } catch (_) {}
      logger.debug(`[updateImageDescription] ${imageId} → ${text ? `"${text.slice(0, 30)}…"` : '(清空)'}`);
      return { success: !!(result && result.success), message: text || null };
    } catch (error) {
      logger.error('更新图片描述失败:', error);
      return { success: false, error };
    }
  }

  /** 把未分类视频从 NA 迁到 NA_video（幂等）。扫描后调用，让旧版已扫进 NA 的视频归位。 */
  async migrateUnclassifiedVideos() {
    const r = await this.imageStorageService.migrateUnclassifiedVideosToNaVideo();
    return r || { moved: 0 };
  }


  /**
   * 批量删除图片
   * 先删物理文件、验证文件真的不存在了，再删数据库记录。
   *
   * 关键不变量：
   *  - successfulImageIds 仅包含**物理文件确认已消失**的 id；DB 也只删这些 id。
   *  - 任何一张图删失败（无路径 / unlink 抛错 / unlink 后文件仍在）都计入 filesFailed，
   *    使 result.success === false，上层据此走 MediaStore.createDeleteRequest 系统授权。
   *
   * 历史 bug：之前 RNFS.unlink "看起来成功"或 content:// 无路径就静默跳过，
   * 把 success 当 true 报上去；用户看到「已删除」但相册里照片还在。
   */
    async writeDeleteImages(imageIds, onProgress) {
      try {
        logger.debug('批量删除图片:', imageIds.length);
        const total = imageIds.length;

        // iOS：照片在 Photos 图库（PHAsset），RNFS.unlink 删不了（只能删 app 沙盒文件）→ 之前批量删除
        // 在 iOS 上只清了 DB、照片仍在。必须走 PhotoKitModule.deleteAssets 物理删除（与单图删除一致）。
        // imageIds 在 iOS 端即 PHAsset.localIdentifier；系统弹一次原生确认：同意=全部物理删，拒绝=E_USER_CANCELLED。
        if (Platform.OS === 'ios') {
          const { NativeModules } = require('react-native');
          const PhotoKitModule = NativeModules && NativeModules.PhotoKitModule;
          if (PhotoKitModule && typeof PhotoKitModule.deleteAssets === 'function') {
            try {
              await PhotoKitModule.deleteAssets(imageIds);
              await this.imageStorageService.deleteImages(imageIds);
              await this.imageCache.refreshCache();
              if (onProgress) onProgress({ filesDeleted: total, filesFailed: 0, total });
              return { success: true, processed: total, filesDeleted: total, filesFailed: 0, successfulImageIds: imageIds, failedImageIds: [] };
            } catch (e) {
              const cancelled = !!(e && e.code === 'E_USER_CANCELLED');
              if (!cancelled) logger.debug('iOS PhotoKit 批量删除失败:', e?.message || e);
              if (onProgress) onProgress({ filesDeleted: 0, filesFailed: total, total });
              return { success: false, processed: 0, filesDeleted: 0, filesFailed: total, successfulImageIds: [], failedImageIds: imageIds, cancelled };
            }
          }
          // PhotoKitModule 不可用 → 落到下面通用流程（在 iOS 上基本删不动，但不至于崩）
        }

        // 1. 收集 (id, 本地路径)。没有路径（content:// 或缓存里没此图）的直接计为失败，
        //    交由上层（系统授权流程 / 错误提示）处理。
        const imageIdToPathMap = new Map();
        const noPathFailedIds = [];
        for (const imageId of imageIds) {
          const image = this.imageCache._getImageById(imageId);
          if (!image) {
            logger.warn(`⚠️ 无法找到图片: ${imageId}`);
            noPathFailedIds.push(imageId);
            continue;
          }
          const localPath = getLocalPath(image);
          if (!localPath) {
            logger.debug(`⚠️ 无本地路径（content:// 等），交由系统授权流程处理: ${imageId}`);
            noPathFailedIds.push(imageId);
            continue;
          }
          imageIdToPathMap.set(imageId, localPath);
        }

        let filesDeleted = 0;
        let filesFailed = noPathFailedIds.length;
        const successfulImageIds = [];
        const failedImageIds = [...noPathFailedIds];

        if (onProgress) onProgress({ filesDeleted, filesFailed, total });

        // 2. 依次尝试 RNFS.unlink，并**在 unlink 后再验证一次** —— Android 11+ 沙盒下
        //    unlink 对非本应用创建的媒体常常"看起来成功"但文件仍存在，必须复核。
        for (const [imageId, filePath] of imageIdToPathMap.entries()) {
          let ok = false;
          try {
            const exists = await RNFS.exists(filePath);
            if (!exists) {
              // 文件本就不在 —— 视为已删除（DB 残留记录走 successfulImageIds 一起清掉）
              ok = true;
            } else {
              try {
                await RNFS.unlink(filePath);
              } catch (rnfsError) {
                if (!(rnfsError && rnfsError.message && rnfsError.message.includes('File does not exist'))) {
                  logger.debug(`🔍 RNFS 删除失败: ${filePath}`, rnfsError?.message || rnfsError);
                }
              }
              // 复核：文件真的没了才算成功
              const stillExists = await RNFS.exists(filePath).catch(() => true);
              ok = !stillExists;
              if (!ok) {
                logger.debug(`🔍 RNFS unlink 后文件仍在（Scoped Storage 限制）: ${filePath}`);
              }
            }
          } catch (e) {
            logger.debug(`🔍 删除物理文件异常: ${filePath}`, e?.message || e);
            ok = false;
          }

          if (ok) {
            filesDeleted++;
            successfulImageIds.push(imageId);
          } else {
            filesFailed++;
            failedImageIds.push(imageId);
          }
          if (onProgress) onProgress({ filesDeleted, filesFailed, total });
        }

        // 3. 只对物理文件已消失的 id 删 DB 记录
        if (successfulImageIds.length > 0) {
          await this.imageStorageService.deleteImages(successfulImageIds);
          await this.imageCache.refreshCache();
          logger.debug('数据库批量删除完成（仅物理删成功的）');
        }

        return {
          success: filesFailed === 0 && successfulImageIds.length === total && total > 0,
          processed: successfulImageIds.length,
          filesDeleted,
          filesFailed,
          successfulImageIds,
          failedImageIds,
        };
      } catch (error) {
        logger.debug('批量删除图片失败（可能是权限问题）:', error);
        throw error;
      }
    }

  /**
   * 仅清理 DB 记录（不动物理文件）——用于"系统授权对话框已经把文件删除"之后的收尾。
   * Android 11+ MediaStore.createDeleteRequest 用户同意后系统已物理删除，但 app DB
   * 还保留着该 id 的记录；不清的话列表/缓存会出现"删了还在"的鬼影直到下次扫描。
   */
  async purgeDeletedImageRecords(imageIds) {
    if (!Array.isArray(imageIds) || imageIds.length === 0) return { success: true, processed: 0 };
    try {
      await this.imageStorageService.deleteImages(imageIds);
      await this.imageCache.refreshCache();
      return { success: true, processed: imageIds.length };
    } catch (error) {
      logger.warn('清理已系统删除图片的 DB 记录失败:', error?.message || error);
      return { success: false, processed: 0, error };
    }
  }

  /**
   * 读取应用设置
   * 直接从数据库读取
   */
  async readSettings() {
    try {
      const settings = await this.imageStorageService.getSettings();
      // 把用户自定义分类注入 ConfigService，使分类名解析（getCategoryDisplayName）能
      // 把自定义 id 解析为配置的名称。每次读设置都刷新 → 删除/改名自动反映。
      try { this.configService?.setCustomCategories?.(settings?.aiProvider?.customCategories); } catch (_) {}
      // 同理注入「已删除的内置分类」，使被删默认分类从首页/各列表隐藏。
      try { this.configService?.setHiddenBuiltinCategories?.(settings?.aiProvider?.hiddenBuiltinCategories); } catch (_) {}
      return settings;

    } catch (error) {
      logger.error('读取设置失败:', error);
      throw error;
    }
  }

  /**
   * 保存应用设置
   * 先写缓存，再写数据库
   */
  async writeSettings(settings) {
    try {
      logger.debug('保存应用设置');
      
      // 1. 先写数据库
      await this.imageStorageService.saveSettings(settings);
      logger.debug('✅ 数据库设置保存完成');

      // 2. 同步自定义分类 + 已删除的内置分类到 ConfigService → 用户在分类管理页改动后立即生效
      try { this.configService?.setCustomCategories?.(settings?.aiProvider?.customCategories); } catch (_) {}
      try { this.configService?.setHiddenBuiltinCategories?.(settings?.aiProvider?.hiddenBuiltinCategories); } catch (_) {}

      // 3. 缓存不需要更新（设置不涉及图片数据）

      return true;
      
    } catch (error) {
      console.error('❌ 保存设置失败:', error);
      throw error;
    }
  }

  // ==================== 自动回忆卡封面覆盖 ====================
  // 旅行/节日回忆每次进页重算、无持久记录；用户换的封面存 settings.momentCoverOverrides
  // 映射（cardKey → imageId），进页时套用。cardKey 见 MomentsScreen（trip_/holiday_ 前缀）。

  /** 取换封面映射 { cardKey: imageId } */
  async getMomentCoverOverrides() {
    try { const s = await this.readSettings(); return (s && s.momentCoverOverrides) || {}; } catch (_) { return {}; }
  }

  /** 设某卡封面（imageId 为空则清除该卡覆盖，回退默认） */
  async setMomentCoverOverride(cardKey, imageId) {
    if (!cardKey) return false;
    const s = (await this.readSettings()) || {};
    const map = { ...(s.momentCoverOverrides || {}) };
    if (imageId) map[cardKey] = imageId; else delete map[cardKey];
    s.momentCoverOverrides = map;
    await this.writeSettings(s);
    return true;
  }

  // ==================== AI图像增强接口 ====================

  /**
   * 添加单张图片（用于AI增强图）
   * @param {Object} imageData - 图片数据
   * @returns {Promise<Object>} - 保存后的图片数据
   */
  async addImage(imageData) {
    try {
      logger.debug('添加新图片:', imageData.fileName);
      
      // 1. 确保服务已初始化
      await this.imageStorageService.ensureInitialized();
      
      // 2. 使用适配器的方法写入数据库
      // ImageStorageService 使用适配器模式：this.storage 是 IndexedDBAdapter 或 SQLiteAdapter
      await this.imageStorageService.storage.addOrUpdateSingleImage(imageData);
      logger.debug('✅ 数据库写入完成');
      
      // 3. 刷新缓存（从数据库重建，包括新添加的图片和统计信息）
      await this.imageCache.refreshCache();
      logger.debug('✅ 缓存已刷新');
      
      return imageData;
      
    } catch (error) {
      logger.error('❌ 添加图片失败:', error);
      throw error;
    }
  }


  /**
   * 获取客户端唯一ID
   */
  async getClientId() {
    try {
      return await this.imageStorageService.getClientId();
    } catch (error) {
      logger.error('获取客户端ID失败:', error);
      throw error;
    }
  }

  // ==================== 工具方法 ====================
  
  /**
   * 获取分类显示名称（从配置文件读取）
   */
  getCategoryDisplayName(categoryId) {
    // 如果配置服务可用，从配置读取
    if (this.configService && this.configService.isConfigLoaded()) {
      return this.configService.getCategoryDisplayName(categoryId, 'chinese');
    }
    
    // 后备方案：返回原ID
    return categoryId;
  }

  /**
   * 获取分类ID（从显示名称或ID获取标准化的分类ID）
   */
  getCategoryId(categoryInput) {
    // 如果配置服务可用，从配置读取
    if (this.configService && this.configService.isConfigLoaded()) {
      const categoryMap = this.configService.getCategoryNameMap();
      
      // 如果输入已经是键名，直接返回
      if (categoryMap[categoryInput]) {
        return categoryInput;
      }
      
      // 如果是显示名称，查找对应的键名
      for (const [key, category] of Object.entries(categoryMap)) {
        if (category.chinese === categoryInput || category.english === categoryInput) {
          return key;
        }
      }
    }
    
    // 如果都没找到，返回原值
    return categoryInput;
  }

  /**
   * 获取所有分类ID列表（从配置文件读取）
   */
  getAllCategoryIds() {
    // 如果配置服务可用，从配置读取
    if (this.configService && this.configService.isConfigLoaded()) {
      return this.configService.getAllCategoryIds();
    }
    
    // 后备方案：返回空数组
    return [];
  }

  /**
   * 强制刷新缓存（用于修复分类统计问题）
   */
  async forceRefreshCache() {
    try {
      await this.imageCache.refreshCache();
      logger.debug('✅ 缓存刷新完成');
    } catch (error) {
      console.error('❌ 强制刷新缓存失败:', error);
      throw error;
    }
  }

  // ==================== 暂存箱相关方法 ====================

  /**
   * 由 URI 计算图片记录的稳定 id（与写库时 generateStableId 一致）。
   * 修图链路保存新图后据此暂存（addToStagingBox 用同一 id）。
   */
  /** 内置分类删除/恢复后调用：重算分类统计（隐藏归 NA）并通知首页等刷新，无需重扫 */
  refreshCategoryVisibility() {
    try { this.imageCache.rebuildCategoryCountsAndNotify(); } catch (e) { logger.warn('refreshCategoryVisibility 失败:', e); }
  }

  getStableId(uri) {
    // 与 SQLiteAdapter/IndexedDBAdapter.generateStableId 完全相同的 URI 稳定哈希。
    // 内联实现：主类 ImageStorageService 不暴露该方法（只在适配器上），直接委托会
    // 「undefined is not a function」。纯函数，结果与写库时生成的 id 一致。
    const s = String(uri || '');
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash = hash & hash;
    }
    return `img_${Math.abs(hash).toString(36)}`;
  }

  /**
   * 添加图片到暂存箱
   * @param {Array<string>} imageIds - 图片ID数组
   * @returns {Promise<{success: boolean, added: number, errors: Array}>}
   */
  async addToStagingBox(imageIds) {
    try {
      const result = await this.imageStorageService.addToStagingBox(imageIds);
      // 暂存箱是独立表，不影响图片列表，不需要刷新缓存
      return result;
    } catch (error) {
      logger.error('添加图片到暂存箱失败:', error);
      throw error;
    }
  }

  /**
   * 从暂存箱移除图片
   * @param {Array<string>} imageIds - 图片ID数组
   * @returns {Promise<{success: boolean, removed: number, errors: Array}>}
   */
  async removeFromStagingBox(imageIds) {
    try {
      const result = await this.imageStorageService.removeFromStagingBox(imageIds);
      // 暂存箱是独立表，不影响图片列表，不需要刷新缓存
      return result;
    } catch (error) {
      logger.error('从暂存箱移除图片失败:', error);
      throw error;
    }
  }

  /**
   * 获取暂存箱所有图片
   * @returns {Promise<Array>} 图片数组
   */
  async getStagingBoxImages() {
    try {
      return await this.imageStorageService.getStagingBoxImages();
    } catch (error) {
      logger.error('获取暂存箱图片失败:', error);
      return [];
    }
  }

  /**
   * 获取暂存箱图片数量
   * @returns {Promise<number>}
   */
  async getStagingBoxCount() {
    try {
      return await this.imageStorageService.getStagingBoxCount();
    } catch (error) {
      logger.error('获取暂存箱数量失败:', error);
      return 0;
    }
  }

  /**
   * 检查图片是否在暂存箱
   * @param {string} imageId - 图片ID
   * @returns {Promise<boolean>}
   */
  async isInStagingBox(imageId) {
    try {
      return await this.imageStorageService.isInStagingBox(imageId);
    } catch (error) {
      logger.error('检查图片是否在暂存箱失败:', error);
      return false;
    }
  }


  // ==================== 缓存管理接口 ====================
  

  /**
   * 获取缓存状态
   */
  getCacheStatus() {
    const cache = this.imageCache.getCache();
    return {
      isLoaded: this.imageCache.isLoaded,
      isLoading: this.imageCache.isLoading,
      totalImages: cache.allImages ? cache.allImages.length : 0,
      categoryCount: Object.keys(cache.categoryCounts || {}).length,
      cityCount: Object.keys(cache.cityCounts || {}).length
    };
  }

  // ==================== 选中状态管理接口 ====================
  
  /**
   * 获取选中的图片
   */
  getSelectedImages(category = null, city = null) {
    return this.imageCache.getSelectedImages(category, city);
  }

  /**
   * 检查图片是否被选中
   */
  isImageSelected(imageId) {
    return this.imageCache.isImageSelected(imageId);
  }

  /**
   * 切换图片选中状态
   */
  toggleImageSelection(imageId) {
    this.imageCache.toggleImageSelection(imageId);
  }

  /**
   * 设置图片选中状态
   */
  setImageSelection(imageId, selected) {
    this.imageCache.setImageSelection(imageId, selected);
  }

  
  /**
   * 添加到选中状态
   * 不会清空现有选中，只是添加新的选中
   */
  addToSelection(imageIds) {
    this.imageCache.addToSelection(imageIds);
  }

  /**
   * 批量添加到选中状态 - 优化版本
   * 直接传递图片对象，避免创建大数组
   */
  addToSelectionBatch(imageObjects) {
    this.imageCache.addToSelectionBatch(imageObjects);
  }


  /**
   * 获取选中数量
   */
  getSelectedCount() {
    return this.imageCache.getSelectedCount();
  }

  /**
   * 获取按分类的选中状态统计
   * 返回每个分类的选中图片数量
   */
  getSelectedCountsByCategory() {
    try {
      // 直接使用预计算的统计，避免重复计算
      const categoryCounts = this.imageCache.getSelectedCategoryCounts();
      logger.debug('📊 按分类选中统计:', categoryCounts);
      return categoryCounts;
      
    } catch (error) {
      console.error('❌ 获取按分类选中统计失败:', error);
      return {};
    }
  }

  /**
   * 获取按城市的选中状态统计
   * 返回每个城市的选中图片数量
   */
  getSelectedCountsByCity() {
    try {
      // 直接使用预计算的统计，避免重复计算
      const cityCounts = this.imageCache.getSelectedCityCounts();
      logger.debug('📊 按城市选中统计:', cityCounts);
      return cityCounts;
      
    } catch (error) {
      console.error('❌ 获取按城市选中统计失败:', error);
      return {};
    }
  }

  /**
   * 获取按相似组的选中状态统计
   * 返回每个相似组的选中图片数量
   */
  getSelectedCountsBySimilarityGroup() {
    try {
      // 直接使用预计算的统计，避免重复计算
      const similarityGroupCounts = this.imageCache.getSelectedSimilarityGroupCounts();
      logger.debug('📊 按相似组选中统计:', similarityGroupCounts);
      return similarityGroupCounts;
      
    } catch (error) {
      console.error('❌ 获取按相似组选中统计失败:', error);
      return {};
    }
  }

  /**
   * 获取选中图片的详细信息统计
   * 包括总数、按分类、按城市、按时间等统计
   */
  getSelectedImagesStats() {
    try {
      const selectedImages = this.getSelectedImages(); // 获取所有选中图片用于统计
      const stats = {
        total: selectedImages.length,
        byCategory: {},
        byCity: {},
        byDate: {},
        totalSize: 0,
        averageSize: 0
      };
      
      selectedImages.forEach(image => {
        // 按分类统计
        if (!image.category) {
          console.error(`❌ 图片 ${image.id} 缺少分类信息:`, image);
          throw new Error(`图片 ${image.id} 缺少分类信息`);
        }
        const category = image.category;
        stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
        
        // 按城市统计
        if (image.city) {
          stats.byCity[image.city] = (stats.byCity[image.city] || 0) + 1;
        }
        
        // 按日期统计
        const date = new Date(image.timestamp).toDateString();
        stats.byDate[date] = (stats.byDate[date] || 0) + 1;
        
        // 大小统计
        stats.totalSize += image.size || 0;
      });
      
      // 计算平均大小
      stats.averageSize = stats.total > 0 ? stats.totalSize / stats.total : 0;
      
      logger.debug('📊 选中图片详细统计:', stats);
      return stats;
      
    } catch (error) {
      console.error('❌ 获取选中图片统计失败:', error);
      return {
        total: 0,
        byCategory: {},
        byCity: {},
        byDate: {},
        totalSize: 0,
        averageSize: 0
      };
    }
  }

  /**
   * 按分类选中图片
   * 选中指定分类的所有图片
   */
  selectImagesByCategory(category) {
    try {
      const cache = this.imageCache.getCache();
      const categoryImages = this.imageCache.getImagesByCategory(category);
      const imageIds = categoryImages.map(img => img.id);
      
      this.addToSelection(imageIds);
      logger.debug(`📊 按分类选中图片: ${category}, 数量: ${imageIds.length}`);
      
      return imageIds.length;
      
    } catch (error) {
      console.error('❌ 按分类选中图片失败:', error);
      return 0;
    }
  }

  /**
   * 按城市选中图片
   * 选中指定城市的所有图片
   */
  selectImagesByCity(city) {
    try {
      const cache = this.imageCache.getCache();
      const cityImages = this.imageCache.getImagesByCity(city);
      const imageIds = cityImages.map(img => img.id);
      
      this.addToSelection(imageIds);
      logger.debug(`📊 按城市选中图片: ${city}, 数量: ${imageIds.length}`);
      
      return imageIds.length;
      
    } catch (error) {
      console.error('❌ 按城市选中图片失败:', error);
      return 0;
    }
  }

  /**
   * 通用取消选中函数
   * 取消选中指定范围内的所有图片
   */
  _deselectImagesByFilter(filterType, filterValue) {
    try {
      let images;
      let logPrefix;
      
      if (filterType === 'category') {
        images = this.imageCache.getImagesByCategory(filterValue);
        logPrefix = '按分类取消选中图片';
      } else if (filterType === 'city') {
        images = this.imageCache.getImagesByCity(filterValue);
        logPrefix = '按城市取消选中图片';
      } else if (filterType === 'similarityGroup') {
        images = this.imageCache.getImagesBySimilarityGroup(filterValue);
        logPrefix = '按相似组取消选中图片';
      } else {
        throw new Error(`不支持的过滤类型: ${filterType}`);
      }
      
      const imageIds = images.map(img => img.id);
      
      imageIds.forEach(imageId => {
        this.setImageSelection(imageId, false);
        // 发送事件通知图片组件更新显示
        if (typeof window !== 'undefined') {
          const event = new CustomEvent('imageSelectionChanged', {
            detail: {
              imageId: imageId,
              isSelected: false
            }
          });
          window.dispatchEvent(event);
        }
      });
      
      logger.debug(`📊 ${logPrefix}: ${filterValue}, 数量: ${imageIds.length}`);
      return imageIds.length;
      
    } catch (error) {
      console.error(`❌ ${filterType === 'category' ? '取消分类选中状态' : '按城市取消选中图片'}失败:`, error);
      return 0;
    }
  }

  /**
   * 取消当前分类的所有选中状态
   * 用于"取消选择"按钮
   */
  clearCategorySelection(category) {
    return this._deselectImagesByFilter('category', category);
  }

  /**
   * 按城市取消选中图片
   * 取消选中指定城市的所有图片
   */
  deselectImagesByCity(city) {
    return this._deselectImagesByFilter('city', city);
  }

  /**
   * 按相似组取消选中图片
   * 取消选中指定相似组的所有图片
   */
  deselectImagesBySimilarityGroup(groupId) {
    return this._deselectImagesByFilter('similarityGroup', groupId);
  }

  /**
   * 获取指定分类的选中图片
   */
  getSelectedImagesByCategory(category) {
    try {
      const categoryImages = this.getSelectedImages(category, null);
      logger.debug(`📊 获取分类选中图片: ${category}, 数量: ${categoryImages.length}`);
      return categoryImages;
    } catch (error) {
      console.error('❌ 获取分类选中图片失败:', error);
      return [];
    }
  }

  /**
   * 获取指定城市的选中图片
   */
  getSelectedImagesByCity(city) {
    try {
      const cityImages = this.getSelectedImages(null, city);
      logger.debug(`📊 获取城市选中图片: ${city}, 数量: ${cityImages.length}`);
      return cityImages;
    } catch (error) {
      console.error('❌ 获取城市选中图片失败:', error);
      return [];
    }
  }

  /**
   * 获取指定相似组的选中图片
   */
  getSelectedImagesBySimilarityGroup(groupId) {
    try {
      const groupImages = this.imageCache.getImagesBySimilarityGroup(groupId);
      const selectedImages = groupImages.filter(img => img.selected === true);
      logger.debug(`📊 获取相似组选中图片: ${groupId}, 数量: ${selectedImages.length}`);
      return selectedImages;
    } catch (error) {
      console.error('❌ 获取相似组选中图片失败:', error);
      return [];
    }
  }

  /**
   * 获取暂存箱的选中图片（同步版本）
   * 优化：从给定的图片ID列表中，只检查这些图片的选中状态
   * @param {Array<string>} stagingBoxImageIds - 暂存箱的图片ID列表
   * @returns {Array} 选中的图片数组
   */
  getSelectedImagesByStagingBox(stagingBoxImageIds) {
    try {
      if (!stagingBoxImageIds || stagingBoxImageIds.length === 0) {
        return [];
      }
      
      // 从缓存中获取这些图片的精简信息（包含选中状态）
      const cache = this.imageCache.getCache();
      const stagingBoxImageIdSet = new Set(stagingBoxImageIds);
      const stagingBoxImages = cache.allImages.filter(img => stagingBoxImageIdSet.has(img.id));
      
      // 过滤出选中的图片
      const selectedImages = stagingBoxImages.filter(img => img.selected === true);
      return selectedImages;
    } catch (error) {
      console.error('❌ 获取暂存箱选中图片失败:', error);
      return [];
    }
  }

  /**
   * 🆕 根据 filterType 和 filterValue 统一获取图片数据
   * @param {string} filterType - 过滤类型: 'category', 'city', 'color', 'directory', 'similarityGroup'
   * @param {string} filterValue - 过滤值
   * @returns {Promise<Array>} 图片数组
   */
  async readImagesByFilter(filterType, filterValue) {
    if (!filterType) {
      logger.error('readImagesByFilter: filterType 不能为空');
      return [];
    }

    try {
      switch (filterType) {
        case 'similarityGroup': {
          if (!filterValue) {
            logger.error('readImagesByFilter: similarityGroup 需要 filterValue');
            return [];
          }
          const groupData = await this.getSimilarityGroupImages(filterValue);
          return groupData.images || [];
        }
        
        case 'directory':
          if (!filterValue) {
            logger.error('readImagesByFilter: directory 需要 filterValue');
            return [];
          }
          return await this.readImagesByDirectory(filterValue);
        
        case 'color':
          if (!filterValue) {
            logger.error('readImagesByFilter: color 需要 filterValue');
            return [];
          }
          return await this.readImagesByColor(filterValue);
        
        case 'city':
          if (!filterValue) {
            logger.error('readImagesByFilter: city 需要 filterValue');
            return [];
          }
          return await this.readImagesByLocation(filterValue, null);
        
        case 'stagingBox':
          // 🆕 stagingBox 是独立的 filterType，不需要 filterValue
          return await this.getStagingBoxImages();
        
        case 'category':
          if (!filterValue) {
            logger.error('readImagesByFilter: category 需要 filterValue');
            return [];
          }
          return await this.readImagesByCategory(filterValue);
        
        case 'format':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('readImagesByFilter: format 需要 filterValue，但 filterValue 为空');
            return [];
          }
          return await this.readImagesByFormat(filterValue);
        
        case 'resolution':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('readImagesByFilter: resolution 需要 filterValue，但 filterValue 为空');
            return [];
          }
          return await this.readImagesByResolution(filterValue);
        
        case 'orientation':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('readImagesByFilter: orientation 需要 filterValue，但 filterValue 为空');
            return [];
          }
          return await this.readImagesByOrientation(filterValue);
        
        case 'iso':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('readImagesByFilter: iso 需要 filterValue，但 filterValue 为空');
            return [];
          }
          return await this.readImagesByISO(filterValue);
        
        case 'aperture':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('readImagesByFilter: aperture 需要 filterValue，但 filterValue 为空');
            return [];
          }
          return await this.readImagesByAperture(filterValue);
        
        case 'shutter':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('readImagesByFilter: shutter 需要 filterValue，但 filterValue 为空');
            return [];
          }
          return await this.readImagesByShutter(filterValue);
        
        case 'focalLength':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('readImagesByFilter: focalLength 需要 filterValue，但 filterValue 为空');
            return [];
          }
          return await this.readImagesByFocalLength(filterValue);
        
        case 'time':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('readImagesByFilter: time 需要 filterValue');
            return [];
          }
          return await this.readImagesByTimeRange(filterValue);
        
        default:
          logger.error(`readImagesByFilter: 未知的 filterType: ${filterType}`);
          return [];
      }
    } catch (error) {
      logger.error(`readImagesByFilter 失败: filterType=${filterType}, filterValue=${filterValue}`, error);
      return [];
    }
  }

  /**
   * 🆕 根据 filterType 和 filterValue 统一获取当前分类的选中图片
   * 数据服务自己从缓存获取图片数据，无需外部传递
   * @param {string} filterType - 过滤类型: 'category', 'city', 'color', 'directory', 'similarityGroup', 'stagingBox'
   * @param {string} filterValue - 过滤值（stagingBox 不需要 filterValue）
   * @returns {Promise<Array>} 选中的图片数组（异步，因为暂存箱需要从数据库获取）
   */
  async getSelectedImagesByFilter(filterType, filterValue) {
    if (!filterType) {
      logger.error('getSelectedImagesByFilter: filterType 不能为空');
      return [];
    }

    try {
      switch (filterType) {
        case 'similarityGroup':
          if (!filterValue) {
            logger.error('getSelectedImagesByFilter: similarityGroup 需要 filterValue');
            return [];
          }
          return this.getSelectedImagesBySimilarityGroup(filterValue);
        
        case 'city':
          if (!filterValue) {
            logger.error('getSelectedImagesByFilter: city 需要 filterValue');
            return [];
          }
          return this.getSelectedImagesByCity(filterValue);
        
        case 'stagingBox':
          // 🆕 stagingBox 是独立的 filterType，不需要 filterValue
          // 先获取所有选中图片，然后检查是否在暂存箱中
          const allSelected = this.getSelectedImages();
          
          // 从数据库获取暂存箱图片ID列表
          const stagingBoxImageIds = await this.imageStorageService.getStagingBoxImageIds();
          const stagingBoxImageIdSet = new Set(stagingBoxImageIds);
          
          // 从所有选中图片中过滤出在暂存箱中的
          return allSelected.filter(img => stagingBoxImageIdSet.has(img.id));
        
        case 'category':
          if (!filterValue) {
            logger.error('getSelectedImagesByFilter: category 需要 filterValue');
            return [];
          }
          const normalizedCategory = this.getCategoryId(filterValue);
          return this.getSelectedImagesByCategory(normalizedCategory);
        
        case 'color':
          if (!filterValue) {
            logger.error('getSelectedImagesByFilter: color 需要 filterValue');
            return [];
          }
          // 颜色：从缓存获取当前颜色的图片，然后过滤出选中的
          const colorImages = this.imageCache.getCache().allImages.filter(
            img => img.background_color === filterValue
          );
          return colorImages.filter(img => img.selected === true);
        
        case 'directory':
          if (!filterValue) {
            logger.error('getSelectedImagesByFilter: directory 需要 filterValue');
            return [];
          }
          // 目录：从缓存获取当前目录的图片，然后过滤出选中的
          const directoryImages = this.imageCache.getImagesByDirectory(filterValue);
          return directoryImages.filter(img => img.selected === true);
        
        case 'format':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('getSelectedImagesByFilter: format 需要 filterValue，但 filterValue 为空');
            return [];
          }
          // 格式：从缓存获取当前格式的图片，然后过滤出选中的
          const formatImages = this.imageCache.getImagesByFormat(filterValue);
          return formatImages.filter(img => img.selected === true);
        
        case 'resolution':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('getSelectedImagesByFilter: resolution 需要 filterValue，但 filterValue 为空');
            return [];
          }
          // 分辨率：从缓存获取当前分辨率的图片，然后过滤出选中的
          const resolutionImages = this.imageCache.getImagesByResolution(filterValue);
          return resolutionImages.filter(img => img.selected === true);
        
        case 'orientation':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('getSelectedImagesByFilter: orientation 需要 filterValue，但 filterValue 为空');
            return [];
          }
          // 方向：从缓存获取当前方向的图片，然后过滤出选中的
          const orientationImages = this.imageCache.getImagesByOrientation(filterValue);
          return orientationImages.filter(img => img.selected === true);
        
        case 'iso':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('getSelectedImagesByFilter: iso 需要 filterValue，但 filterValue 为空');
            return [];
          }
          const isoImages = this.imageCache.getImagesByISO(filterValue);
          return isoImages.filter(img => img.selected === true);
        
        case 'aperture':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('getSelectedImagesByFilter: aperture 需要 filterValue，但 filterValue 为空');
            return [];
          }
          const apertureImages = this.imageCache.getImagesByAperture(filterValue);
          return apertureImages.filter(img => img.selected === true);
        
        case 'shutter':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('getSelectedImagesByFilter: shutter 需要 filterValue，但 filterValue 为空');
            return [];
          }
          const shutterImages = this.imageCache.getImagesByShutter(filterValue);
          return shutterImages.filter(img => img.selected === true);
        
        case 'focalLength':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('getSelectedImagesByFilter: focalLength 需要 filterValue，但 filterValue 为空');
            return [];
          }
          const focalLengthImages = this.imageCache.getImagesByFocalLength(filterValue);
          return focalLengthImages.filter(img => img.selected === true);
        
        case 'time':
          if (!filterValue || (typeof filterValue === 'string' && filterValue.trim() === '')) {
            logger.warn('getSelectedImagesByFilter: time 需要 filterValue');
            return [];
          }
          const timeImages = await this.readImagesByTimeRange(filterValue);
          return timeImages.filter(img => img.selected === true);
        
        default:
          logger.error(`getSelectedImagesByFilter: 未知的 filterType: ${filterType}`);
          return [];
      }
    } catch (error) {
      logger.error(`getSelectedImagesByFilter 失败: filterType=${filterType}, filterValue=${filterValue}`, error);
      return [];
    }
  }

  // ==================== 监听器接口 ====================
  
  /**
   * 添加数据变化监听器
   */
  addDataChangeListener(callback) {
    return this.imageCache.addListener(callback);
  }

  /**
   * 添加选中状态变化监听器
   */
  addSelectionChangeListener(callback) {
    return this.imageCache.addSelectionListener(callback);
  }

  /**
   * 清空所有数据
   */
  async clearAllData() {
    try {
      logger.debug('🗑️ 开始清空所有数据');
      
      // 清空数据库中的所有图片数据
      await this.imageStorageService.clearAllImages();
      
      // 清空缓存
      this.imageCache.clearCache();
      
      // 通知所有监听器数据已清空
      this.cacheListeners.forEach(listener => listener(this.imageCache.cache));
      
      logger.debug('✅ 所有数据已清空');
      return true;
      
    } catch (error) {
      console.error('❌ 清空数据失败:', error);
      throw error;
    }
  }

  // 获取所有图片的URI列表
  async getImageUris() {
    try {
      return await this.imageStorageService.getImageUris();
    } catch (error) {
      console.error('❌ 获取图片URI列表失败:', error);
      return [];
    }
  }

  // 根据URI列表删除图片
  async removeImagesByUris(urisToRemove, updateCache = true) {
    try {
      const result = await this.imageStorageService.removeImagesByUris(urisToRemove);
      if (result.success) {
        // 根据参数决定是否立即更新缓存
        if (updateCache) {
          // 更新缓存
          await this.imageCache.buildCache();
          // 通知监听器
          this.cacheListeners.forEach(listener => listener(this.imageCache.cache));
        }
      }
      return result;
    } catch (error) {
      console.error('❌ 根据URI删除图片失败:', error);
      throw error;
    }
  }

  // 批量保存图片详细信息
  async writeImageDetailedInfo(imageDataArray, updateCache = true) {
    try {
      logger.debug(`💾 开始保存图片详细信息: ${imageDataArray.length}张, updateCache=${updateCache}`);
      
      // 🔥 调试：检查是否有拍摄参数
      const imagesWithCameraSettings = imageDataArray.filter(img => img.cameraSettings);
      if (imagesWithCameraSettings.length > 0) {
        logger.debug(`📷 [保存] ${imagesWithCameraSettings.length}张图片包含拍摄参数`);
        imagesWithCameraSettings.slice(0, 3).forEach(img => {
          logger.debug(`📷 [保存] 图片: ${img.fileName}, cameraSettings: ${JSON.stringify(img.cameraSettings)}`);
        });
      }
      
      await this.imageStorageService.saveImageDetailedInfo(imageDataArray);
      logger.debug(`✅ 图片详细信息保存成功: ${imageDataArray.length}张`);
      
      // 根据参数决定是否立即更新缓存
      if (updateCache) {
        logger.debug('🔄 开始刷新缓存...');
        // 更新缓存（使用 refreshCache 而不是 buildCache，确保真正重新读取数据库）
        await this.imageCache.refreshCache();
        logger.debug('✅ 缓存刷新完成');
        
        // 🔥 调试：检查缓存中的拍摄参数统计
        const cache = this.imageCache.getCache();
        logger.debug(`📷 [缓存] ISO统计: ${JSON.stringify(cache.isoCounts)}, 光圈统计: ${JSON.stringify(cache.apertureCounts)}, 快门统计: ${JSON.stringify(cache.shutterCounts)}, 焦距统计: ${JSON.stringify(cache.focalLengthCounts)}`);
        
        // 通知监听器
        this.cacheListeners.forEach(listener => listener(this.imageCache.cache));
      }
    } catch (error) {
      logger.error('❌ 批量保存图片详细信息失败:', error);
      console.error('❌ 批量保存图片详细信息失败:', error);
      throw error;
    }
  }

  /**
   * 🔥 批量更新city字段（仅更新位置信息，不查询其他字段）
   * 用于位置信息补全，避免查询所有数据导致的数据库锁竞争
   * @param {Array} cityDataArray - 位置数据数组，每个元素包含：
   *   - uri: 图片 URI（必需）
   *   - id: 图片 ID（可选，如果有则使用，否则根据 URI 生成）
   *   - city: location_id（必需）
   * @param {boolean} updateCache - 是否立即更新缓存，默认false
   * @returns {Promise<Object>} 更新结果统计 { success: boolean, updatedCount: number, failedCount: number }
   */
  async updateImagesCity(cityDataArray, updateCache = false) {
    try {
      const result = await this.imageStorageService.batchUpdateCity(cityDataArray);
      
      // 根据参数决定是否立即更新缓存
      if (updateCache && result.success) {
        await this.imageCache.refreshCache();
        this.cacheListeners.forEach(listener => listener(this.imageCache.cache));
      }
      
      return result;
    } catch (error) {
      logger.error('❌ 批量更新city失败:', error);
      throw error;
    }
  }

  /** 批量更新照片 uri（分类文件迁移后同步路径）。pathDataArray=[{id, uri}]。 */
  async updateImagesPath(pathDataArray, updateCache = false) {
    try {
      const result = await this.imageStorageService.batchUpdateImagePath(pathDataArray);
      if (updateCache && result.success) {
        await this.imageCache.refreshCache();
        this.cacheListeners.forEach(listener => listener(this.imageCache.cache));
      }
      return result;
    } catch (error) {
      logger.error('❌ 批量更新 uri 失败:', error);
      throw error;
    }
  }

  /**
   * 批量更新分类信息（只更新分类相关字段，不更新其他字段）
   * @param {Array} classificationDataArray - 分类数据数组，每个元素包含：
   *   - uri: 图片 URI（必需）
   *   - id: 图片 ID（可选，如果有则使用，否则根据 URI 生成）
   *   - category: 分类ID（必需）
   *   - confidence: 置信度（可选）
   *   - idCardDetections: 身份证检测结果（可选）
   *   - generalDetections: 通用检测结果（可选）
   *   - mobileNetV3Detections: MobileNetV3检测结果（可选）
   *   - message: 大模型推理描述（可选）
   * @param {boolean} updateCache - 是否立即更新缓存，默认false
   * @returns {Promise<Object>} 更新结果统计 { success: boolean, updatedCount: number, failedCount: number }
   */
  async batchUpdateClassification(classificationDataArray, updateCache = false) {
    try {
      const result = await this.imageStorageService.batchUpdateClassification(classificationDataArray);
      
      // 根据参数决定是否立即更新缓存
      if (updateCache && result.success) {
        // 更新缓存
        await this.imageCache.buildCache();
        // 通知监听器
        this.cacheListeners.forEach(listener => listener(this.imageCache.cache));
      }
      
      return result;
    } catch (error) {
      logger.error('❌ 批量更新分类信息失败:', error);
      throw error;
    }
  }

  // 获取分类规则
  async getClassificationRules() {
    try {
      return await this.imageStorageService.getClassificationRules();
    } catch (error) {
      console.error('❌ 获取分类规则失败:', error);
      throw error;
    }
  }

  // 保存分类规则
  async saveClassificationRules(rules) {
    try {
      await this.imageStorageService.saveClassificationRules(rules);
      logger.debug('✅ 分类规则保存成功');
      return true;
    } catch (error) {
      console.error('❌ 保存分类规则失败:', error);
      throw error;
    }
  }

  // 重置分类规则为默认值
  async resetClassificationRules() {
    try {
      const defaultRules = await this.imageStorageService.resetClassificationRules();
      logger.debug('✅ 分类规则已重置为默认值');
      return defaultRules;
    } catch (error) {
      console.error('❌ 重置分类规则失败:', error);
      throw error;
    }
  }

  // 更新单个分类规则
  async updateClassificationRule(objectClass, newCategory) {
    try {
      const rules = await this.imageStorageService.updateClassificationRule(objectClass, newCategory);
      logger.debug(`✅ 分类规则更新成功: ${objectClass} -> ${newCategory}`);
      return rules;
    } catch (error) {
      console.error('❌ 更新分类规则失败:', error);
      throw error;
    }
  }

  // 添加新的分类规则
  async addClassificationRule(objectClass, category) {
    try {
      const rules = await this.imageStorageService.addClassificationRule(objectClass, category);
      logger.debug(`✅ 新增分类规则: ${objectClass} -> ${category}`);
      return rules;
    } catch (error) {
      console.error('❌ 添加分类规则失败:', error);
      throw error;
    }
  }

  // 删除分类规则
  async removeClassificationRule(objectClass) {
    try {
      const rules = await this.imageStorageService.removeClassificationRule(objectClass);
      logger.debug(`✅ 删除分类规则: ${objectClass}`);
      return rules;
    } catch (error) {
      console.error('❌ 删除分类规则失败:', error);
      throw error;
    }
  }

  /**
   * 查询从指定时间点之后有更新的图片
   * @param {string|Date} sinceTimestamp - ISO 8601格式的时间字符串或Date对象
   * @returns {Promise<Array>} 图片列表（完整信息）
   */
  async readImagesUpdatedAfter(sinceTimestamp) {
    try {
      return await this.imageStorageService.getImagesUpdatedAfter(sinceTimestamp);
    } catch (error) {
      logger.error('读取最近更新的图片失败:', error);
      throw error;
    }
  }

  /**
   * 查询从指定时间点之后文件时间更新的图片（基于 timestamp）
   * @param {string|Date} sinceTimestamp - ISO 8601格式的时间字符串或Date对象
   * @returns {Promise<Array>} 图片列表（完整信息）
   */
  async readImagesByTimestampAfter(sinceTimestamp) {
    try {
      return await this.imageStorageService.getImagesByTimestampAfter(sinceTimestamp);
    } catch (error) {
      logger.error('读取最近文件时间更新的图片失败:', error);
      throw error;
    }
  }

  /**
   * 清空相似度数据
   * @param {Array<string|number>} [imageIds] - 可选，指定要清除相似度数据的图片ID数组。如果未指定，则清除所有相似度数据
   */
  async clearSimilarityData(imageIds = null) {
    try {
      if (imageIds && Array.isArray(imageIds) && imageIds.length > 0) {
        logger.debug(`清除 ${imageIds.length} 张图片的相似度数据`);
      } else {
        logger.debug('清空所有相似度数据');
      }
      await this.imageStorageService.clearSimilarityData(imageIds);
      logger.debug('相似度数据清空完成');
    } catch (error) {
      logger.error('清空相似度数据失败:', error);
      throw error;
    }
  }

  /**
   * 完全重置数据库（模拟全新启动）
   * 删除整个 IndexedDB 数据库，包括所有数据：图片、统计、设置、分类规则、相似度数据等
   * @returns {Promise<boolean>} 是否成功
   */
  async resetDatabase() {
    try {
      logger.info('🗑️ 开始重置数据库（模拟全新启动）...');
      
      // 如果使用的是 IndexedDB，直接删除数据库
      if (Platform.OS === 'web') {
        // 先清空缓存
        this.imageCache.clearCache();
        
        // 删除整个数据库
        await this.imageStorageService.storage.deleteDatabase();
        
        // 重置初始化状态
        this.imageStorageService.isInitialized = false;
        this.imageStorageService.storage.isInitialized = false;
        this.imageStorageService.storage.db = null;
        
        logger.info('✅ 数据库已完全删除，下次访问时会自动重新创建');
        return true;
      }
      
      // 移动端：清空所有数据
      await this.imageStorageService.clear();
      
      // 重建缓存
      await this.imageCache.buildCache();
      
      logger.info('✅ 数据库已重置完成');
      return true;
    } catch (error) {
      logger.error('❌ 重置数据库失败:', error);
      throw error;
    }
  }

  /**
   * 批量更新图片相似度信息
   */
  async updateImagesSimilarity(imageSimilarityArray) {
    try {
      // logger.debug('批量更新图片相似度信息:', imageSimilarityArray.length);
      await this.imageStorageService.updateImagesSimilarity(imageSimilarityArray);
    } catch (error) {
      logger.error('更新图片相似度信息失败:', error);
      throw error;
    }
  }

  // ==================== 相似度检测接口 ====================

 

  /**
   * 获取相似度组统计信息
   * 返回相似组数组，每个组包含groupid、图片数量和最近一张照片的URI
   * @returns {Array} 相似组数组
   */
  async getSimilarityGroupsStats() {
    try {
      // logger.debug('📊 获取相似度组统计信息...');
      
      // 使用 ImageStorageService 获取相似组数据
      const similarityGroups = await this.imageStorageService.getSimilarityGroups('similar');
      
      if (!similarityGroups || similarityGroups.length === 0) {
        return [];
      }
      
      // 获取所有图片数据用于获取最近照片的URI
      const allImages = await this.readAllImages();
      const imageMap = new Map(allImages.map(img => [img.id, img]));
      
      // 构建统计信息
      const groups = similarityGroups.map(group => {
        // 找到该组中最近的一张照片（排除 tobecleaned 分类）
        let latestImage = null;
        let latestTime = 0;
        let validImageCount = 0;
        
        group.images.forEach(imageInfo => {
          const image = imageMap.get(imageInfo.id);
          if (image) {
            validImageCount++;
            // 🔥 使用文件时间（timestamp）而不是拍摄时间（takenAt），因为新复制过来的照片文件时间会变化
            const imageTime = image.timestamp ? (typeof image.timestamp === 'string' ? new Date(image.timestamp).getTime() : image.timestamp) : 0;
            if (imageTime > latestTime) {
              latestTime = imageTime;
              latestImage = image;
            }
          }
        });
        
        return {
          groupId: group.id,
          imageCount: validImageCount,
          latestImageUri: latestImage ? getUri(latestImage) : null,
          latestTime: latestTime > 0 ? new Date(latestTime) : null
        };
      });
      
      // 过滤掉图片数量为 0 的组（所有图片都被移到暂存箱的情况）
      const validGroups = groups.filter(group => group.imageCount > 0);
      
      // 按「最新照片时间」降序（最新/增量新增的组排最前）；同一时间再按组大小降序
      validGroups.sort((a, b) => {
        const ta = a.latestTime ? a.latestTime.getTime() : 0;
        const tb = b.latestTime ? b.latestTime.getTime() : 0;
        if (tb !== ta) return tb - ta;
        return b.imageCount - a.imageCount;
      });
      
      // logger.debug(`📊 相似度组统计: ${validGroups.length}个组（已过滤空组）`);
      return validGroups;
      
    } catch (error) {
      console.error('❌ 获取相似度组统计失败:', error);
      throw error;
    }
  }

  /**
   * 获取指定相似组的照片精简信息
   * @param {string} groupId - 相似组ID
   * @returns {Object} 相似组信息，包含该组的所有照片精简信息
   */
  async getSimilarityGroupImages(groupId) {
    try {
      logger.debug(`📖 获取相似组照片信息: ${groupId}`);
      
      if (!groupId) {
        throw new Error('相似组ID不能为空');
      }
      
      // 使用 ImageStorageService 获取相似组信息
      const group = await this.imageStorageService.getSimilarityGroupById(groupId);
      
      if (!group) {
        logger.debug(`📖 未找到相似组 ${groupId}`);
        return {
          groupId,
          imageCount: 0,
          images: [],
          notFound: true
        };
      }
      
      // 获取所有图片数据
      const allImages = await this.readAllImages();
      const imageMap = new Map(allImages.map(img => [img.id, img]));
      
      // 直接使用缓存中的图片对象，添加相似度信息
      const images = group.images
        .map(imageInfo => {
          const image = imageMap.get(imageInfo.id);
          if (image) {
            // 为缓存中的图片对象添加相似度信息
            image.similarityScore = imageInfo.similarity_score || 0;
            image.similarityGroupIndex = groupId;
            image.similarityGroupType = imageInfo.similarity_group_type || 'similar';
            return image; // 直接返回缓存中的对象
          }
          return null;
        })
        .filter(img => img !== null) // 过滤掉不存在的图片
        .sort((a, b) => {
          // 按时间排序（最新的在前）
          const timeA = a.takenAt || a.timestamp || a.createdAt || a.modifiedAt || 0;
          const timeB = b.takenAt || b.timestamp || b.createdAt || b.modifiedAt || 0;
          return new Date(timeB) - new Date(timeA);
        });
      
      const result = {
        groupId: group.id,
        imageCount: images.length,
        images,
        confidence: group.confidence || 0,
        createdAt: group.created_at,
        notFound: false
      };
      
      logger.debug(`📖 相似组 ${groupId} 包含 ${images.length} 张图片`);
      return result;
      
    } catch (error) {
      console.error('❌ 获取相似组照片信息失败:', error);
      throw error;
    }
  }

  /**
   * 从相似组中移除图片
   */
  async removeImageFromSimilarityGroup(imageId, groupId) {
    try {
      logger.debug(`🔄 从相似组移除图片: ${imageId}, groupId: ${groupId}`);
      
      // 从相似组中移除图片
      await this.imageStorageService.removeImageFromSimilarityGroup(imageId);
      
      // 只移除关联关系，不删除图片，不影响图片列表和统计，不需要刷新缓存
      // 如果是在删除图片流程中调用，删除操作本身已经 refreshCache
      
      logger.debug(`✅ 成功从相似组移除图片: ${imageId}`);
      return true;
    } catch (error) {
      console.error('❌ 从相似组移除图片失败:', error);
      throw error;
    }
  }

  /**
   * 添加图片到相似组
   * @param {string} imageId - 图片ID
   * @param {string} groupId - 相似组ID
   * @param {Object} similarityInfo - 相似度信息
   * @returns {Promise<boolean>} 是否添加成功
   */
  async addImageToSimilarityGroup(imageId, groupId, similarityInfo = {}) {
    try {
      logger.debug(`🔄 添加图片到相似组: ${imageId}, groupId: ${groupId}`);
      
      // 添加到相似组
      await this.imageStorageService.addImageToSimilarityGroup(imageId, groupId, similarityInfo);
      
      // 重建缓存以同步所有数据
      await this.imageCache.buildCache();
      
      logger.debug(`✅ 成功添加图片到相似组: ${imageId}`);
      return true;
    } catch (error) {
      console.error('❌ 添加图片到相似组失败:', error);
      throw error;
    }
  }

  // ==================== 统计接口扩展 ====================

  /**
   * 获取今日新增图片数量
   * @returns {number} 今日新增的图片数量
   */
  getTodayAddedCount() {
    try {
      const cache = this.imageCache.getCache();
      const today = new Date().toDateString();
      
      const todayImages = cache.allImages.filter(img => {
        if (!img.createdAt) return false;
        return new Date(img.createdAt).toDateString() === today;
      });
      
      logger.debug(`📊 今日新增图片数量: ${todayImages.length}`);
      return todayImages.length;
    } catch (error) {
      logger.error('获取今日新增数量失败:', error);
      return 0;
    }
  }
}

// 导出单例实例
export default new UnifiedDataService();
