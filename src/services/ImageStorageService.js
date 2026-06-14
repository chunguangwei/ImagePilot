import { AsyncStorage, logger, Platform, SQLite } from '../adapters/WebAdapters';
import configService from './ConfigService.js';
import { getDefaultPresets } from '../i18n/index.js';

// ========== 拍摄参数档位化分类（折中方案：标准档位，非高中低） ==========

const ISO_BUCKETS = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600];
const APERTURE_BUCKETS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22];
// 快门：秒 -> 显示档位（1/1000, 1/125, 1", 2" 等）
const SHUTTER_BUCKETS_SEC = [1/8000, 1/4000, 1/2000, 1/1000, 1/500, 1/250, 1/125, 1/60, 1/30, 1/15, 1/8, 1/4, 1/2, 1, 2, 4, 8];
const FOCAL_BUCKETS = [14, 24, 35, 50, 85, 135, 200, 300, 400];

function bucketToNearest(value, buckets) {
  if (value <= buckets[0]) return buckets[0];
  for (let i = 0; i < buckets.length - 1; i++) {
    const mid = (buckets[i] + buckets[i + 1]) / 2;
    if (value <= mid) return buckets[i];
  }
  return buckets[buckets.length - 1];
}

/**
 * ISO档位：50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600
 */
function categorizeISO(iso) {
  if (!iso || typeof iso !== 'number' || iso <= 0) return null;
  const bucketed = bucketToNearest(iso, ISO_BUCKETS);
  return String(bucketed);
}

/**
 * 光圈档位：1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22
 */
function categorizeAperture(fNumber) {
  if (!fNumber || typeof fNumber !== 'number' || fNumber <= 0) return null;
  const bucketed = bucketToNearest(fNumber, APERTURE_BUCKETS);
  return String(bucketed);
}

/**
 * 快门档位：1/8000, 1/4000, ..., 1/8, 1/4, 1/2, 1", 2", 4", 8"
 */
function categorizeShutterSpeed(exposureTime) {
  if (!exposureTime || typeof exposureTime !== 'number' || exposureTime <= 0) return null;
  const bucketed = bucketToNearest(exposureTime, SHUTTER_BUCKETS_SEC);
  if (bucketed >= 1) return `${bucketed}"`;
  const denom = Math.round(1 / bucketed);
  return `1/${denom}`;
}

/**
 * 焦距档位：14, 24, 35, 50, 85, 135, 200, 300, 400 mm
 */
function categorizeFocalLength(focalLength) {
  if (!focalLength || typeof focalLength !== 'number' || focalLength <= 0) return null;
  const bucketed = bucketToNearest(focalLength, FOCAL_BUCKETS);
  return String(bucketed);
}

/**
 * 根据 cameraSettings 计算分类
 * @param {Object|string|null} cameraSettings - 拍摄参数对象或JSON字符串
 * @returns {Object} 包含 isoCategory, apertureCategory, shutterCategory, focalLengthCategory
 */
function calculateCameraSettingsCategories(cameraSettings) {
  if (!cameraSettings) {
    return {
      isoCategory: null,
      apertureCategory: null,
      shutterCategory: null,
      focalLengthCategory: null
    };
  }
  
  // 如果 cameraSettings 是字符串，尝试解析
  let settings = cameraSettings;
  if (typeof cameraSettings === 'string') {
    try {
      settings = JSON.parse(cameraSettings);
    } catch (e) {
      logger.debug('解析 cameraSettings JSON 失败:', e);
      return {
        isoCategory: null,
        apertureCategory: null,
        shutterCategory: null,
        focalLengthCategory: null
      };
    }
  }
  
  if (!settings || typeof settings !== 'object') {
    return {
      isoCategory: null,
      apertureCategory: null,
      shutterCategory: null,
      focalLengthCategory: null
    };
  }
  
  const result = {
    isoCategory: categorizeISO(settings.iso),
    apertureCategory: categorizeAperture(settings.aperture),
    shutterCategory: categorizeShutterSpeed(settings.shutterSpeed),
    focalLengthCategory: categorizeFocalLength(settings.focalLength)
  };
  
  return result;
}

// SQLite 适配器类（移动端）
class SQLiteAdapter {
  constructor() {
    this.dbName = 'ImageClassifier.db';
    this.db = null;
    this.isInitialized = false;
  }

  // 辅助函数：将 tx.executeSql 包装成 Promise（移动端兼容性处理）
  // 注意：在事务中，所有操作必须在事务函数返回前完成，不能有异步操作在事务外执行
  _executeSqlPromise(tx, sql, params = []) {
    return new Promise((resolve, reject) => {
      try {
        // 检查事务状态（某些情况下可能已经 finalized）
        tx.executeSql(
          sql,
          params || [],
          (tx, result) => {
            // 确保返回的是 result 对象，而不是数组
            // 在事务回调中立即 resolve，不要有额外延迟
            try {
              resolve(result);
            } catch (resolveError) {
              // 如果 resolve 时出错，reject
              reject(resolveError);
            }
          },
          (tx, error) => {
            // 错误回调中也要正确处理
            try {
              reject(error);
            } catch (rejectError) {
              // 如果 reject 时出错，记录但不要再次抛出
              logger.error('❌ _executeSqlPromise reject 失败:', rejectError);
            }
          }
        );
      } catch (executeError) {
        // 如果 executeSql 本身抛出异常（比如事务已 finalized）
        reject(executeError);
      }
    });
  }

  async init() {
    if (this.isInitialized && this.db) {
      return this.db;
    }

    try {
      logger.debug('📱 开始初始化 SQLite 数据库...');
      


      // 打开数据库
      this.db = SQLite.openDatabase(this.dbName, '1.0', 'Image Classifier DB', 200000);
      
      // 保存原生的 executeSql 方法（如果存在），用于执行 PRAGMA
      const originalExecuteSql = this.db.executeSql ? this.db.executeSql.bind(this.db) : null;
      
      // 为数据库对象添加executeSql方法（兼容性处理）
      if (!this.db.executeSql) {
        this.db.executeSql = (sql, params = []) => {
          return new Promise((resolve, reject) => {
            this.db.transaction((tx) => {
              tx.executeSql(sql, params, (tx, result) => {
                resolve([result]);
              }, (tx, error) => {
                reject(error);
              });
            });
          });
        };
      }

      // 创建专门用于执行 PRAGMA 的方法（不能在事务中执行）
      this._executePragma = (sql) => {
        return new Promise((resolve, reject) => {
          // PRAGMA 必须直接在数据库对象上执行，不能通过 transaction
          // WebAdapters.native.js 中的 executeSql 已经处理了 PRAGMA，但为了安全起见，
          // 我们直接使用原生的 executeSql（如果存在），或者通过 readTransaction 执行
          
          // 优先使用原生的 executeSql（WebAdapters.native.js 会正确处理 PRAGMA）
          if (this.db.executeSql && typeof this.db.executeSql === 'function') {
            // 检查是否是 PRAGMA 语句
            const isPragma = sql.trim().toUpperCase().startsWith('PRAGMA');
            if (isPragma) {
              // PRAGMA 语句：WebAdapters.native.js 中的 executeSql 应该已经处理了
              // 但如果仍然失败，说明可能在事务中，我们需要静默失败
              this.db.executeSql(sql, [])
                .then((results) => {
                  // executeSql 返回数组，取第一个结果
                  resolve(Array.isArray(results) ? results[0] : results);
                })
                .catch((error) => {
                  // PRAGMA 失败不影响功能，静默失败
                  // 不记录错误日志，避免日志噪音
                  resolve({ rows: { length: 0 } });
                });
            } else {
              // 非 PRAGMA 语句使用事务
              this.db.transaction((tx) => {
                tx.executeSql(sql, [], (tx, result) => {
                  resolve(result);
                }, (tx, error) => {
                  reject(error);
                });
              });
            }
          } else {
            // 如果没有 executeSql 方法，PRAGMA 无法执行，静默失败
            resolve({ rows: { length: 0 } });
          }
        });
      };
      
      // 创建表结构
      await this.createTables();
      
      // 数据库优化配置（PRAGMA 必须在事务外执行，使用特殊方法）
      // 注意：某些 PRAGMA 在 React Native SQLite 中可能不支持或有限制
      // 尝试设置，但失败不影响主要功能（静默失败，不记录错误日志）
      logger.debug('📋 设置 SQLite PRAGMA...');
      try {
        await this._executePragma('PRAGMA journal_mode = WAL;').catch(() => {
          // 静默失败，不记录日志（某些 SQLite 版本不支持 WAL 模式）
        });
      } catch (e) {
        // 静默失败
      }
      try {
        await this._executePragma('PRAGMA synchronous = NORMAL;').catch(() => {
          // 静默失败，不记录日志（某些 SQLite 版本不支持此设置）
        });
      } catch (e) {
        // 静默失败
      }
      try {
        await this._executePragma('PRAGMA cache_size = 10000;').catch(() => {
          // 静默失败，不记录日志
        });
      } catch (e) {
        // 静默失败
      }
      logger.debug('✅ SQLite PRAGMA 设置完成（部分 PRAGMA 可能未生效，不影响功能）');
      
      this.isInitialized = true;
      logger.debug('✅ SQLite 数据库初始化成功');
      
      return this.db;
    } catch (error) {
      logger.error('❌ SQLite 初始化失败:', error);
      throw error;
    }
  }

  async createTables() {
    const createTablesSql = `
      -- 图片表
      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        uri TEXT NOT NULL UNIQUE,
        fileName TEXT NOT NULL,
        category TEXT,
        confidence REAL,
        timestamp INTEGER,
        takenAt INTEGER,
        size INTEGER,
        mimeType TEXT,
        duration REAL,
        width INTEGER,
        height INTEGER,
        createdAt TEXT,
        updatedAt TEXT,
        -- GPS信息
        latitude REAL,
        longitude REAL,
        altitude REAL,
        accuracy REAL,
        -- 地址信息
        address TEXT,
        city TEXT,
        country TEXT,
        province TEXT,
        district TEXT,
        street TEXT,
        locationSource TEXT,
        cityDistance REAL,
        -- 检测结果（JSON字符串）
        idCardDetections TEXT,
        generalDetections TEXT,
        mobileNetV3Detections TEXT,
        imageDimensions TEXT,
        message TEXT,
        -- 背景颜色
        background_color TEXT,
        -- 拍摄参数（JSON字符串）
        cameraSettings TEXT,
        -- 拍摄参数分类
        isoCategory TEXT,
        apertureCategory TEXT,
        shutterCategory TEXT,
        focalLengthCategory TEXT
      );

      -- 索引优化
      CREATE INDEX IF NOT EXISTS idx_category ON images(category);
      CREATE INDEX IF NOT EXISTS idx_city ON images(city);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON images(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_takenAt ON images(takenAt DESC);
      CREATE INDEX IF NOT EXISTS idx_isoCategory ON images(isoCategory);
      CREATE INDEX IF NOT EXISTS idx_apertureCategory ON images(apertureCategory);
      CREATE INDEX IF NOT EXISTS idx_shutterCategory ON images(shutterCategory);
      CREATE INDEX IF NOT EXISTS idx_focalLengthCategory ON images(focalLengthCategory);

      -- 设置表
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      -- 相似度数据表
      CREATE TABLE IF NOT EXISTS similarity_data (
        imageId TEXT PRIMARY KEY,
        similarity_group_id TEXT,
        similarity_group_type TEXT,
        similarity_score REAL,
        is_similarity_processed INTEGER DEFAULT 0,
        updatedAt TEXT,
        FOREIGN KEY (imageId) REFERENCES images(id) ON DELETE CASCADE
      );

      -- 相似组索引表
      CREATE TABLE IF NOT EXISTS similarity_group_index (
        groupId TEXT PRIMARY KEY,
        imageIds TEXT,
        created_at TEXT
      );

      -- 图片特征表（颜色直方图等，相似检测时顺手持久化；以图搜图按此索引秒查）
      CREATE TABLE IF NOT EXISTS image_features (
        imageId TEXT PRIMARY KEY,
        features TEXT,
        updatedAt TEXT,
        FOREIGN KEY (imageId) REFERENCES images(id) ON DELETE CASCADE
      );

      -- CLIP 向量索引表（AI 向量维度的以图搜图：L2 归一化 embedding，余弦=点积）
      CREATE TABLE IF NOT EXISTS image_embeddings (
        imageId TEXT PRIMARY KEY,
        model TEXT,
        vec TEXT,
        updatedAt TEXT,
        FOREIGN KEY (imageId) REFERENCES images(id) ON DELETE CASCADE
      );

      -- 时刻秀（用户自建放映集：选图+播放配置+命名，展示在「时刻」Tab）
      CREATE TABLE IF NOT EXISTS showcases (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        imageIds TEXT,
        mode TEXT,
        interval REAL,
        musicPath TEXT,
        createdAt TEXT,
        coverId TEXT,
        items TEXT
      );

      -- 暂存箱表
      CREATE TABLE IF NOT EXISTS staging_box (
        imageId TEXT PRIMARY KEY,
        addedAt TEXT NOT NULL,
        FOREIGN KEY (imageId) REFERENCES images(id) ON DELETE CASCADE
      );

      -- 暂存箱索引
      CREATE INDEX IF NOT EXISTS idx_staging_box_addedAt ON staging_box(addedAt DESC);
    `;

    // 分割SQL语句并执行
    const statements = createTablesSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    for (const sql of statements) {
      await this.db.executeSql(sql);
    }
    
    // 迁移：添加 background_color 字段（如果不存在）
    await this.migrateAddBackgroundColor();
    
    // 迁移：添加拍摄参数字段（如果不存在）
    await this.migrateAddCameraSettings();
    
    // 迁移：将现有的 tobecleaned 分类迁移到 staging_box 表
    await this.migrateStagingBox();
    
    logger.debug('✅ SQLite 表结构创建完成');
  }

  /**
   * 迁移：添加 background_color 字段
   * 如果字段已存在则跳过
   */
  async migrateAddBackgroundColor() {
    try {
      // 检查字段是否存在
      const pragmaResult = await this.db.executeSql('PRAGMA table_info(images)');
      const tableInfo = pragmaResult && pragmaResult.length > 0 ? pragmaResult[0] : null;
      
      if (tableInfo && tableInfo.rows) {
        let hasBackgroundColor = false;
        for (let i = 0; i < tableInfo.rows.length; i++) {
          const column = tableInfo.rows.item(i);
          if (column.name === 'background_color') {
            hasBackgroundColor = true;
            break;
          }
        }
        
        if (!hasBackgroundColor) {
          logger.debug('🔄 迁移：添加 background_color 字段到 images 表');
          await this.db.executeSql('ALTER TABLE images ADD COLUMN background_color TEXT');
          logger.debug('✅ 迁移完成：background_color 字段已添加');
        } else {
          logger.debug('✅ background_color 字段已存在，跳过迁移');
        }
      }
    } catch (error) {
      // 如果字段已存在，SQLite 会抛出错误，这是正常的
      if (error.message && error.message.includes('duplicate column')) {
        logger.debug('✅ background_color 字段已存在，跳过迁移');
      } else {
        logger.warn('⚠️ 迁移 background_color 字段时出错（可能字段已存在）:', error.message);
      }
    }
  }

  /**
   * 迁移：添加拍摄参数字段
   * 如果字段已存在则跳过
   */
  async migrateAddCameraSettings() {
    const fields = [
      { name: 'cameraSettings', type: 'TEXT' },
      { name: 'isoCategory', type: 'TEXT' },
      { name: 'apertureCategory', type: 'TEXT' },
      { name: 'shutterCategory', type: 'TEXT' },
      { name: 'focalLengthCategory', type: 'TEXT' },
      { name: 'duration', type: 'REAL' }
    ];
    
    try {
      const pragmaResult = await this.db.executeSql('PRAGMA table_info(images)');
      const tableInfo = pragmaResult && pragmaResult.length > 0 ? pragmaResult[0] : null;
      
      if (tableInfo && tableInfo.rows) {
        const existingColumns = new Set();
        for (let i = 0; i < tableInfo.rows.length; i++) {
          const column = tableInfo.rows.item(i);
          existingColumns.add(column.name);
        }
        
        for (const field of fields) {
          if (!existingColumns.has(field.name)) {
            logger.debug(`🔄 迁移：添加 ${field.name} 字段到 images 表`);
            await this.db.executeSql(`ALTER TABLE images ADD COLUMN ${field.name} ${field.type}`);
            logger.debug(`✅ 迁移完成：${field.name} 字段已添加`);
          } else {
            logger.debug(`✅ ${field.name} 字段已存在，跳过迁移`);
          }
        }
        
        // 添加索引
        const indexes = [
          'idx_isoCategory',
          'idx_apertureCategory',
          'idx_shutterCategory',
          'idx_focalLengthCategory'
        ];
        
        for (const indexName of indexes) {
          try {
            const fieldName = indexName.replace('idx_', '');
            await this.db.executeSql(`CREATE INDEX IF NOT EXISTS ${indexName} ON images(${fieldName})`);
          } catch (error) {
            if (!error.message || !error.message.includes('already exists')) {
              logger.warn(`⚠️ 创建索引 ${indexName} 失败:`, error.message);
            }
          }
        }
      }
    } catch (error) {
      if (error.message && error.message.includes('duplicate column')) {
        logger.debug('✅ 拍摄参数字段已存在，跳过迁移');
      } else {
        logger.warn('⚠️ 迁移拍摄参数字段时出错（可能字段已存在）:', error.message);
      }
    }

    // 迁移：showcases 表加 coverId（封面图 id；空则默认首图）
    try {
      const pr = await this.db.executeSql('PRAGMA table_info(showcases)');
      const ti = pr && pr.length > 0 ? pr[0] : null;
      let hasCover = false;
      if (ti && ti.rows) {
        for (let i = 0; i < ti.rows.length; i++) {
          if (ti.rows.item(i).name === 'coverId') { hasCover = true; break; }
        }
      }
      if (!hasCover) {
        await this.db.executeSql('ALTER TABLE showcases ADD COLUMN coverId TEXT');
        logger.debug('✅ 迁移完成：showcases.coverId 已添加');
      }
    } catch (e) {
      if (!(e.message && e.message.includes('duplicate column'))) {
        logger.warn('⚠️ 迁移 showcases.coverId 出错（可能已存在）:', e?.message);
      }
    }

    // 迁移：showcases 表加 items（模板生成资源序列；空则走 imageIds）
    try {
      const pr = await this.db.executeSql('PRAGMA table_info(showcases)');
      const ti = pr && pr.length > 0 ? pr[0] : null;
      let hasItems = false;
      if (ti && ti.rows) {
        for (let i = 0; i < ti.rows.length; i++) {
          if (ti.rows.item(i).name === 'items') { hasItems = true; break; }
        }
      }
      if (!hasItems) {
        await this.db.executeSql('ALTER TABLE showcases ADD COLUMN items TEXT');
        logger.debug('✅ 迁移完成：showcases.items 已添加');
      }
    } catch (e) {
      if (!(e.message && e.message.includes('duplicate column'))) {
        logger.warn('⚠️ 迁移 showcases.items 出错（可能已存在）:', e?.message);
      }
    }
  }

  /**
   * 迁移：将现有的 tobecleaned 分类迁移到 staging_box 表
   * 如果 staging_box 表已有数据，则跳过迁移
   */
  async migrateStagingBox() {
    try {
      // 检查 staging_box 表是否已有数据
      const [checkResult] = await this.db.executeSql('SELECT COUNT(*) as count FROM staging_box');
      const existingCount = checkResult.rows.item(0).count;
      
      if (existingCount > 0) {
        logger.debug(`✅ staging_box 表已有 ${existingCount} 条数据，跳过迁移`);
        return;
      }
      
      // 查找所有 category = 'tobecleaned' 的图片
      const [result] = await this.db.executeSql(
        'SELECT id FROM images WHERE category = ?',
        ['tobecleaned']
      );
      
      if (!result || !result.rows) {
        logger.debug('✅ 没有找到 tobecleaned 分类的图片，跳过迁移');
        return;
      }
      
      const tobecleanedImages = [];
      for (let i = 0; i < result.rows.length; i++) {
        tobecleanedImages.push(result.rows.item(i).id);
      }
      
      if (tobecleanedImages.length === 0) {
        logger.debug('✅ 没有找到 tobecleaned 分类的图片，跳过迁移');
        return;
      }
      
      logger.debug(`🔄 迁移：将 ${tobecleanedImages.length} 张 tobecleaned 分类的图片迁移到 staging_box 表`);
      
      // 批量插入到 staging_box 表
      const now = new Date().toISOString();
      for (const imageId of tobecleanedImages) {
        try {
          await this.db.executeSql(
            'INSERT OR IGNORE INTO staging_box (imageId, addedAt) VALUES (?, ?)',
            [imageId, now]
          );
        } catch (error) {
          logger.warn(`迁移图片 ${imageId} 到 staging_box 失败:`, error.message);
        }
      }
      
      // 将迁移的图片的 category 修改为 'NA'
      if (tobecleanedImages.length > 0) {
        const placeholders = tobecleanedImages.map(() => '?').join(',');
        try {
          await this.db.executeSql(
            `UPDATE images SET category = 'NA' WHERE id IN (${placeholders})`,
            tobecleanedImages
          );
          logger.debug(`✅ 已将 ${tobecleanedImages.length} 张图片的分类修改为 NA`);
        } catch (error) {
          logger.warn('修改图片分类为 NA 失败:', error.message);
        }
      }
      
      logger.debug(`✅ 迁移完成：${tobecleanedImages.length} 张图片已迁移到 staging_box 表，分类已修改为 NA`);
      
    } catch (error) {
      logger.error('迁移 staging_box 失败:', error.message);
    }
  }

  async getItem(key) {
    await this.init();
    
    if (key === 'images') {
      // 查询所有图片
      const results = await this.db.executeSql(
        'SELECT * FROM images ORDER BY timestamp DESC'
      );
      
      const result = results && results.length > 0 ? results[0] : null;
      if (!result || !result.rows) {
        logger.warn('⚠️ SQLite: 没有查询到图片数据');
        return [];
      }
      
      const images = [];
      for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows.item(i);
        // 解析JSON字段
        images.push({
          ...row,
          idCardDetections: row.idCardDetections ? JSON.parse(row.idCardDetections) : null,
          generalDetections: row.generalDetections ? JSON.parse(row.generalDetections) : null,
          mobileNetV3Detections: row.mobileNetV3Detections ? JSON.parse(row.mobileNetV3Detections) : null,
          imageDimensions: row.imageDimensions ? JSON.parse(row.imageDimensions) : null
        });
      }
      
      return images;
    } else if (key === 'settings') {
      // 查询所有设置
      const results = await this.db.executeSql(
        'SELECT * FROM settings'
      );
      
      // SQLite executeSql返回数组，第一个元素是结果集
      const result = results && results.length > 0 ? results[0] : null;
      if (!result || !result.rows) {
        return null;
      }
      
      const settings = {};
      for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows.item(i);
        try {
          settings[row.key] = JSON.parse(row.value);
        } catch {
          settings[row.key] = row.value;
        }
      }
      
      return Object.keys(settings).length > 0 ? settings : null;
    } else if (key === 'similarityData') {
      // 查询相似度数据
      const results = await this.db.executeSql(
        'SELECT * FROM similarity_data'
      );
      const result = results && results.length > 0 ? results[0] : null;
      if (!result || !result.rows) {
        return null;
      }
      
      const data = {};
      for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows.item(i);
        data[row.imageId] = {
          similarity_group_id: row.similarity_group_id,
          similarity_group_type: row.similarity_group_type,
          similarity_score: row.similarity_score,
          is_similarity_processed: row.is_similarity_processed === 1,
          updatedAt: row.updatedAt
        };
      }
      
      return data;
    } else if (key === 'similarityGroupIndex') {
      // 查询相似组索引
      const results = await this.db.executeSql(
        'SELECT * FROM similarity_group_index'
      );
      const result = results && results.length > 0 ? results[0] : null;
      if (!result || !result.rows) {
        return null;
      }
      
      const index = {};
      for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows.item(i);
        index[row.groupId] = JSON.parse(row.imageIds);
      }
      
      return index;
    }
    
    return null;
  }

  async setItem(key, value) {
    await this.init();
    
    if (key === 'images') {
      // 批量插入/更新图片
      if (!Array.isArray(value)) {
        throw new Error('images value must be an array');
      }
      
      // 使用事务批量操作
      await new Promise((resolve, reject) => {
        this.db.transaction((tx) => {
          let completed = 0;
          let hasError = false;
          const totalImages = value.length;

          if (totalImages === 0) {
            resolve(true);
            return;
          }

          for (const image of value) {
            // 🔥 如果提供了 cameraSettings 但没有分类字段，则计算分类
            const categories = image.isoCategory !== undefined && image.apertureCategory !== undefined
              ? {
                  isoCategory: image.isoCategory || null,
                  apertureCategory: image.apertureCategory || null,
                  shutterCategory: image.shutterCategory || null,
                  focalLengthCategory: image.focalLengthCategory || null
                }
              : calculateCameraSettingsCategories(image.cameraSettings);
            
            const sql = `
              INSERT OR REPLACE INTO images (
                id, uri, fileName, category, confidence, timestamp, takenAt,
                size, mimeType, duration, width, height, createdAt, updatedAt,
                latitude, longitude, altitude, accuracy,
                address, city, country, province, district, street, locationSource, cityDistance,
                idCardDetections, generalDetections, mobileNetV3Detections, imageDimensions, message,
                cameraSettings, isoCategory, apertureCategory, shutterCategory, focalLengthCategory
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            tx.executeSql(
              sql,
              [
                image.id,
                image.uri,
                image.fileName,
                image.category,
                image.confidence,
                image.timestamp,
                image.takenAt,
                image.size,
                image.mimeType,
                image.duration || 0,
                image.width,
                image.height,
                image.createdAt,
                image.updatedAt,
                image.latitude,
                image.longitude,
                image.altitude,
                image.accuracy,
                image.address,
                image.city,
                image.country,
                image.province,
                image.district,
                image.street,
                image.locationSource,
                image.cityDistance,
                image.idCardDetections ? JSON.stringify(image.idCardDetections) : null,
                image.generalDetections ? JSON.stringify(image.generalDetections) : null,
                image.mobileNetV3Detections ? JSON.stringify(image.mobileNetV3Detections) : null,
                image.imageDimensions ? JSON.stringify(image.imageDimensions) : null,
                image.message,
                // 🔥 拍摄参数和分类（如果已有分类则使用，否则根据 cameraSettings 计算）
                image.cameraSettings ? (typeof image.cameraSettings === 'string' ? image.cameraSettings : JSON.stringify(image.cameraSettings)) : null,
                categories.isoCategory,
                categories.apertureCategory,
                categories.shutterCategory,
                categories.focalLengthCategory
              ],
              (tx, result) => {
                completed++;
                if (completed === totalImages && !hasError) {
                  resolve(true);
                }
              },
              (tx, error) => {
                if (!hasError) {
                  hasError = true;
                  reject(error);
                }
              }
            );
          }
        }, (error) => {
          if (error) {
            reject(error);
          }
        });
      });
      
      logger.debug(`✅ SQLite批量保存${value.length}张图片`);
      return true;
    } else if (key === 'settings') {
      // 保存设置
      // 注意：React Native SQLite 的 transaction 不支持 async/await 在循环中使用
      // 必须在事务回调中同步执行所有操作，或使用 Promise 包装整个事务
      await new Promise((resolve, reject) => {
        this.db.transaction((tx) => {
          const settingsEntries = Object.entries(value);
          let completed = 0;
          let hasError = false;

          if (settingsEntries.length === 0) {
            // 如果没有设置项，直接完成
            resolve(true);
            return;
          }

          for (const [settingKey, settingValue] of settingsEntries) {
            tx.executeSql(
              'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
              [settingKey, JSON.stringify(settingValue)],
              (tx, result) => {
                completed++;
                if (completed === settingsEntries.length && !hasError) {
                  // 所有操作完成，事务会自动提交
                  resolve(true);
                }
              },
              (tx, error) => {
                if (!hasError) {
                  hasError = true;
                  reject(error);
                }
              }
            );
          }
        }, (error) => {
          // 事务错误回调（如果事务本身失败）
          if (error) {
            reject(error);
          }
        });
      });
      
      return true;
    } else if (key === 'similarityData') {
      // 保存相似度数据
      await new Promise((resolve, reject) => {
        this.db.transaction((tx) => {
          const entries = Object.entries(value);
          let completed = 0;
          let hasError = false;

          if (entries.length === 0) {
            resolve(true);
            return;
          }

          for (const [imageId, data] of entries) {
            tx.executeSql(
              `INSERT OR REPLACE INTO similarity_data 
               (imageId, similarity_group_id, similarity_group_type, similarity_score, is_similarity_processed, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                imageId,
                data.similarity_group_id,
                data.similarity_group_type,
                data.similarity_score,
                data.is_similarity_processed ? 1 : 0,
                data.updatedAt
              ],
              (tx, result) => {
                completed++;
                if (completed === entries.length && !hasError) {
                  resolve(true);
                }
              },
              (tx, error) => {
                if (!hasError) {
                  hasError = true;
                  reject(error);
                }
              }
            );
          }
        }, (error) => {
          if (error) {
            reject(error);
          }
        });
      });
      
      return true;
    } else if (key === 'similarityGroupIndex') {
      // 保存相似组索引
      await new Promise((resolve, reject) => {
        this.db.transaction((tx) => {
          const entries = Object.entries(value);
          let deleteCompleted = false;
          let insertCompleted = 0;
          let hasError = false;

          // 清空旧数据
          tx.executeSql(
            'DELETE FROM similarity_group_index',
            [],
            (tx, result) => {
              deleteCompleted = true;
              // 如果没有新数据，直接完成
              if (entries.length === 0) {
                resolve(true);
                return;
              }
              // 开始插入新数据
              for (const [groupId, imageIds] of entries) {
                tx.executeSql(
                  'INSERT INTO similarity_group_index (groupId, imageIds, created_at) VALUES (?, ?, ?)',
                  [groupId, JSON.stringify(imageIds), new Date().toISOString()],
                  (tx, result) => {
                    insertCompleted++;
                    if (insertCompleted === entries.length && !hasError) {
                      resolve(true);
                    }
                  },
                  (tx, error) => {
                    if (!hasError) {
                      hasError = true;
                      reject(error);
                    }
                  }
                );
              }
            },
            (tx, error) => {
              if (!hasError) {
                hasError = true;
                reject(error);
              }
            }
          );
        }, (error) => {
          if (error) {
            reject(error);
          }
        });
      });
      
      return true;
    }
    
    return false;
  }

  async addOrUpdateSingleImage(imageData) {
    await this.init();
    
    const sql = `
      INSERT OR REPLACE INTO images (
        id, uri, fileName, category, confidence, timestamp, takenAt,
        size, mimeType, width, height, createdAt, updatedAt,
        latitude, longitude, altitude, accuracy,
        address, city, country, province, district, street, locationSource, cityDistance,
        idCardDetections, generalDetections, mobileNetV3Detections, imageDimensions, message, background_color,
        cameraSettings, isoCategory, apertureCategory, shutterCategory, focalLengthCategory
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    await this.db.executeSql(sql, [
      imageData.id || this.generateStableId(imageData.uri),
      imageData.uri,
      imageData.fileName,
      imageData.category,
      imageData.confidence,
      imageData.timestamp,
      imageData.takenAt,
      imageData.size,
      imageData.mimeType,
      imageData.width,
      imageData.height,
      imageData.createdAt || new Date().toISOString(),
      imageData.updatedAt || new Date().toISOString(),
      imageData.latitude,
      imageData.longitude,
      imageData.altitude,
      imageData.accuracy,
      imageData.address,
      imageData.city,
      imageData.country,
      imageData.province,
      imageData.district,
      imageData.street,
      imageData.locationSource,
      imageData.cityDistance,
      imageData.idCardDetections ? JSON.stringify(imageData.idCardDetections) : null,
      imageData.generalDetections ? JSON.stringify(imageData.generalDetections) : null,
      imageData.mobileNetV3Detections ? JSON.stringify(imageData.mobileNetV3Detections) : null,
      imageData.imageDimensions ? JSON.stringify(imageData.imageDimensions) : null,
      imageData.message,
      imageData.background_color || null,
      // 🔥 拍摄参数和分类
      imageData.cameraSettings ? JSON.stringify(imageData.cameraSettings) : null,
      imageData.isoCategory || null,
      imageData.apertureCategory || null,
      imageData.shutterCategory || null,
      imageData.focalLengthCategory || null
    ]);
    
    return true;
  }

  async removeItem(key) {
    await this.init();
    
    if (key === 'images') {
      await this.db.executeSql('DELETE FROM images');
      logger.debug('✅ SQLite清空images表');
    } else if (key === 'settings') {
      await this.db.executeSql('DELETE FROM settings');
    } else if (key === 'similarityData') {
      await this.db.executeSql('DELETE FROM similarity_data');
    } else if (key === 'similarityGroupIndex') {
      await this.db.executeSql('DELETE FROM similarity_group_index');
    } else if (key === 'stagingBox') {
      await this.db.executeSql('DELETE FROM staging_box');
      logger.debug('✅ SQLite清空staging_box表');
    }
    
    return true;
  }

  async clear() {
    await this.init();
    
    await new Promise((resolve, reject) => {
      this.db.transaction((tx) => {
        let completed = 0;
        let hasError = false;
        const totalOperations = 5; // 增加暂存箱

        const checkComplete = () => {
          if (completed === totalOperations && !hasError) {
            resolve(true);
          }
        };

        tx.executeSql('DELETE FROM images', [], (tx, result) => {
          completed++;
          checkComplete();
        }, (tx, error) => {
          if (!hasError) {
            hasError = true;
            reject(error);
          }
        });

        tx.executeSql('DELETE FROM settings', [], (tx, result) => {
          completed++;
          checkComplete();
        }, (tx, error) => {
          if (!hasError) {
            hasError = true;
            reject(error);
          }
        });

        tx.executeSql('DELETE FROM similarity_data', [], (tx, result) => {
          completed++;
          checkComplete();
        }, (tx, error) => {
          if (!hasError) {
            hasError = true;
            reject(error);
          }
        });

        tx.executeSql('DELETE FROM similarity_group_index', [], (tx, result) => {
          completed++;
          checkComplete();
        }, (tx, error) => {
          if (!hasError) {
            hasError = true;
            reject(error);
          }
        });

        tx.executeSql('DELETE FROM staging_box', [], (tx, result) => {
          completed++;
          checkComplete();
        }, (tx, error) => {
          if (!hasError) {
            hasError = true;
            reject(error);
          }
        });
      }, (error) => {
        if (error) {
          reject(error);
        }
      });
    });
    
    logger.debug('✅ SQLite数据库已清空（包括暂存箱）');
    return true;
  }

  generateStableId(uri) {
    // 只使用URI的哈希值，确保同一URI总是生成相同ID
    let hash = 0;
    for (let i = 0; i < uri.length; i++) {
      const char = uri.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `img_${Math.abs(hash).toString(36)}`;
  }

  // 🆕 专用方法：更新图片分类（单条记录）
  async updateImageCategory(imageId, newCategory, newConfidence) {
    await this.init();
    
    const sql = `
      UPDATE images 
      SET category = ?, confidence = ?, updatedAt = ?
      WHERE id = ?
    `;
    
    const [result] = await this.db.executeSql(sql, [
      newCategory,
      newConfidence,
      new Date().toISOString(),
      imageId
    ]);
    
    if (result.rowsAffected > 0) {
      logger.debug(`✅ SQLite更新分类: ${imageId} -> ${newCategory}`);
      return true;
  } else {
      logger.warn(`⚠️ SQLite未找到图片: ${imageId}`);
      return false;
    }
  }


  // 🆕 专用方法：删除单张图片（单条记录）
  async deleteImageById(imageId) {
    await this.init();
    
    // 先查询图片信息
    const [selectResult] = await this.db.executeSql(
      'SELECT * FROM images WHERE id = ?',
      [imageId]
    );
    
    if (selectResult.rows.length === 0) {
      return { success: false, message: 'Image not found', image: null };
    }
    
    const image = selectResult.rows.item(0);
    
    // 删除图片记录
    const [deleteResult] = await this.db.executeSql(
      'DELETE FROM images WHERE id = ?',
      [imageId]
    );
    
    if (deleteResult.rowsAffected > 0) {
      logger.debug(`✅ SQLite删除图片: ${image.fileName}`);
      return { success: true, message: 'Image deleted', image };
    } else {
      return { success: false, message: 'Delete failed', image };
    }
  }

  // 🆕 专用方法：批量删除图片（按ID列表）
  async deleteImagesByIds(imageIds) {
    await this.init();
    
    let removedCount = 0;
    let failedCount = 0;
    
    await new Promise((resolve, reject) => {
      this.db.transaction((tx) => {
        let completed = 0;
        let hasError = false;
        const totalIds = imageIds.length;

        if (totalIds === 0) {
          resolve(true);
          return;
        }

        for (const imageId of imageIds) {
          tx.executeSql(
            'DELETE FROM images WHERE id = ?',
            [imageId],
            (tx, result) => {
              completed++;
              if (result && result.rowsAffected > 0) {
                removedCount++;
              } else {
                failedCount++;
              }
              if (completed === totalIds) {
                resolve(true);
              }
            },
            (tx, error) => {
              completed++;
              logger.error(`❌ SQLite删除失败: ${imageId}`, error);
              failedCount++;
              if (completed === totalIds) {
                resolve(true);
              }
            }
          );
        }
      }, (error) => {
        if (error) {
          reject(error);
        }
      });
    });
    
    logger.debug(`✅ SQLite批量删除: 成功${removedCount}, 失败${failedCount}`);
    return { removedCount, failedCount };
  }

  // 🆕 专用方法：按URI列表删除
  async deleteImagesByUris(uris) {
    await this.init();
    
    // 先查询要删除的图片ID
    const placeholders = uris.map(() => '?').join(',');
    const [result] = await this.db.executeSql(
      `SELECT id FROM images WHERE uri IN (${placeholders})`,
      uris
    );
    
    const imageIds = [];
    for (let i = 0; i < result.rows.length; i++) {
      imageIds.push(result.rows.item(i).id);
    }
    
    // 批量删除
    return await this.deleteImagesByIds(imageIds);
  }
}

// IndexedDB 适配器类
class IndexedDBAdapter {
  constructor() {
    this.dbName = 'ImageClassifierDB';
    this.version = 4; // 版本 4：添加 stagingBox 对象存储
    this.db = null;
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) {
      return this.db;
    }

    // 检查 IndexedDB 是否可用
    if (!window.indexedDB) {
      logger.error('IndexedDB 不可用');
      throw new Error('IndexedDB 不可用');
    }

    // 尝试关闭可能存在的旧连接
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }

    return new Promise((resolve, reject) => {
      // 添加超时机制，防止无限等待
      const timeout = setTimeout(() => {
        logger.error('IndexedDB 初始化超时');
        logger.error('可能的原因: 数据库被锁定或浏览器兼容性问题');
        reject(new Error('IndexedDB 初始化超时'));
      }, 5000); // 5秒超时

      
      // 添加请求状态监听
      let requestStarted = false;
      const request = indexedDB.open(this.dbName, this.version);
      
      // 监听请求开始
      request.addEventListener('success', () => {
      });
      
      request.addEventListener('error', () => {
      });
      
      request.addEventListener('upgradeneeded', () => {
      });
      
      // 检查请求是否立即被阻塞
      setTimeout(() => {
        if (!requestStarted) {
        }
      }, 100);
      
      request.onerror = () => {
        clearTimeout(timeout);
        logger.error('IndexedDB 初始化失败:', request.error);
        reject(request.error);
      };

      request.onsuccess = async () => {
        clearTimeout(timeout);
        this.db = request.result;
        this.isInitialized = true;
        logger.debug('IndexedDB 初始化成功');
        
        // 迁移：将现有的 tobecleaned 分类迁移到 staging_box
        try {
          await this.migrateStagingBoxIndexedDB();
        } catch (error) {
          logger.warn('IndexedDB 暂存箱迁移失败:', error);
        }
        
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        logger.debug('IndexedDB 开始升级数据库...');
        logger.debug('升级事件详情:', {
          oldVersion: event.oldVersion,
          newVersion: event.newVersion,
          type: event.type
        });
        
        const db = event.target.result;
        logger.debug('数据库对象:', db);
        logger.debug('当前对象存储:', Array.from(db.objectStoreNames));
        
        try {
          // 创建图片存储表
          if (!db.objectStoreNames.contains('images')) {
            logger.debug('创建 images 对象存储...');
            const imageStore = db.createObjectStore('images', { keyPath: 'id' });
            imageStore.createIndex('category', 'category', { unique: false });
            imageStore.createIndex('createdAt', 'createdAt', { unique: false });
            logger.debug('images 对象存储创建完成');
          } else {
            logger.debug('images 对象存储已存在');
          }
          
          // 创建统计信息表
          if (!db.objectStoreNames.contains('stats')) {
            logger.debug('创建 stats 对象存储...');
            db.createObjectStore('stats', { keyPath: 'key' });
            logger.debug(' stats 对象存储创建完成');
          } else {
            logger.debug(' stats 对象存储已存在');
          }
          
          // 创建设置表
          if (!db.objectStoreNames.contains('settings')) {
            logger.debug(' 创建 settings 对象存储...');
            db.createObjectStore('settings', { keyPath: 'key' });
            logger.debug(' settings 对象存储创建完成');
          } else {
            logger.debug(' settings 对象存储已存在');
          }
          
          // 创建分类规则表
          if (!db.objectStoreNames.contains('classificationRules')) {
            logger.debug(' 创建 classificationRules 对象存储...');
            db.createObjectStore('classificationRules', { keyPath: 'key' });
            logger.debug(' classificationRules 对象存储创建完成');
          } else {
            logger.debug(' classificationRules 对象存储已存在');
          }
          
          // 创建相似度数据表
          if (!db.objectStoreNames.contains('similarityData')) {
            logger.debug(' 创建 similarityData 对象存储...');
            db.createObjectStore('similarityData', { keyPath: 'key' });
            logger.debug(' similarityData 对象存储创建完成');
          } else {
            logger.debug(' similarityData 对象存储已存在');
          }
          
          // 创建相似组索引表
          if (!db.objectStoreNames.contains('similarityGroupIndex')) {
            logger.debug(' 创建 similarityGroupIndex 对象存储...');
            db.createObjectStore('similarityGroupIndex', { keyPath: 'key' });
            logger.debug(' similarityGroupIndex 对象存储创建完成');
          } else {
            logger.debug(' similarityGroupIndex 对象存储已存在');
          }
          
          // 创建暂存箱表
          if (!db.objectStoreNames.contains('stagingBox')) {
            logger.debug(' 创建 stagingBox 对象存储...');
            const stagingBoxStore = db.createObjectStore('stagingBox', { keyPath: 'imageId' });
            stagingBoxStore.createIndex('addedAt', 'addedAt', { unique: false });
            logger.debug(' stagingBox 对象存储创建完成');
          } else {
            logger.debug(' stagingBox 对象存储已存在');
          }
          
          logger.debug(' IndexedDB 数据库结构创建完成');
          logger.debug('升级完成后的对象存储:', Array.from(db.objectStoreNames));
        } catch (upgradeError) {
          logger.error(' 数据库升级过程中出错:', upgradeError);
          logger.error(' 升级错误堆栈:', upgradeError.stack);
          clearTimeout(timeout);
          reject(upgradeError);
        }
      };
      
      // 迁移：将现有的 tobecleaned 分类迁移到 staging_box（在初始化完成后执行）
      this.migrateStagingBoxIndexedDB = async () => {
        try {
          // 检查 stagingBox objectStore 是否存在
          if (!this.db.objectStoreNames.contains('stagingBox')) {
            logger.warn('⚠️ stagingBox objectStore 不存在，跳过迁移（可能需要刷新页面触发数据库升级）');
            return;
          }
          
          // 检查 staging_box 是否已有数据
          const stagingBoxData = await this.getItem('stagingBox') || [];
          if (stagingBoxData.length > 0) {
            logger.debug(`✅ staging_box 已有 ${stagingBoxData.length} 条数据，跳过迁移`);
            return;
          }
          
          // 查找所有 category = 'tobecleaned' 的图片
          const allImagesData = await this.getItem('images') || [];
          const tobecleanedImages = allImagesData.filter(img => img.category === 'tobecleaned');
          
          if (tobecleanedImages.length === 0) {
            logger.debug('✅ 没有找到 tobecleaned 分类的图片，跳过迁移');
            return;
          }
          
          logger.debug(`🔄 迁移：将 ${tobecleanedImages.length} 张 tobecleaned 分类的图片迁移到 staging_box`);
          
          // 批量添加到 staging_box
          const now = new Date().toISOString();
          const stagingBoxItems = tobecleanedImages.map(img => ({
            imageId: img.id,
            addedAt: now
          }));
          
          await this.setItem('stagingBox', stagingBoxItems);
          
          // 将迁移的图片的 category 修改为 'NA'
          const updatedImages = allImagesData.map(img => {
            if (tobecleanedImages.some(ti => ti.id === img.id)) {
              return { ...img, category: 'NA' };
            }
            return img;
          });
          
          await this.setItem('images', updatedImages);
          
          logger.debug(`✅ 迁移完成：${tobecleanedImages.length} 张图片已迁移到 staging_box，分类已修改为 NA`);
          
        } catch (error) {
          logger.error('IndexedDB 迁移 staging_box 失败:', error);
        }
      };
    });
  }

  async getItem(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([key], 'readonly');
      const store = transaction.objectStore(key);
      const request = store.getAll();
      
      request.onsuccess = () => {
        const results = request.result;
        if (results.length === 0) {
          resolve(null);
        } else if (key === 'images' || key === 'stagingBox') {
          // 对于图片数据和暂存箱数据，返回数组（因为它们都是数组结构，不是键值对）
          resolve(results);
        } else {
          // 对于其他数据，返回第一个结果的值
          resolve(results[0].value);
        }
      };
      
      request.onerror = () => {
        logger.error(`❌ IndexedDB 读取失败 (${key}):`, request.error);
        reject(request.error);
      };
    });
  }

  async setItem(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([key], 'readwrite');
      const store = transaction.objectStore(key);
      
      if (key === 'images') {
        // 对于图片数据，清空后批量插入
        store.clear();
        if (Array.isArray(value)) {
          value.forEach(item => {
            store.add(item);
          });
        }
      } else if (key === 'stagingBox') {
        // 对于暂存箱数据，清空后批量插入（每个对象都有 imageId 字段作为 keyPath）
        store.clear();
        if (Array.isArray(value)) {
          value.forEach(item => {
            if (item && item.imageId) {
              store.add(item);
            }
          });
        }
      } else {
        // 对于其他数据，存储为键值对
        store.put({ key, value });
      }
      
      transaction.oncomplete = () => {
        resolve(true);
      };
      
      transaction.onerror = () => {
        logger.error(`❌ IndexedDB 保存失败 (${key}):`, transaction.error);
        reject(transaction.error);
      };
    });
  }

  // 新增：单条记录增量更新（性能最优）
  async addOrUpdateSingleImage(imageData) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['images'], 'readwrite');
      const store = transaction.objectStore('images');
      
      // 🔧 修复：使用 id 作为主键查找（keyPath 是 'id'）
      const imageId = imageData.id || this.generateStableId(imageData.uri);
      const getRequest = store.get(imageId);
      
      getRequest.onsuccess = () => {
        const existingImage = getRequest.result;
        
        if (existingImage) {
          // 更新现有记录，保留原有ID和创建时间
          const updatedImage = {
            ...existingImage,
            ...imageData,
            id: existingImage.id, // 保持原有ID
            createdAt: existingImage.createdAt, // 保持原有创建时间
            updatedAt: new Date().toISOString()
          };
          
          store.put(updatedImage);
          logger.debug(`✅ 更新图片: ${imageData.fileName}`);
        } else {
          // 添加新记录，确保有ID字段
          const imageWithId = {
            ...imageData,
            id: imageId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          store.add(imageWithId);
        }
      };
      
      getRequest.onerror = () => {
        logger.error(`❌ IndexedDB 查找图片失败:`, getRequest.error);
        reject(getRequest.error);
      };
      
      // 🔧 修复：只在事务完成时 resolve，避免重复 resolve
      transaction.oncomplete = () => {
        resolve(true);
      };
      
      transaction.onerror = () => {
        logger.error(`❌ IndexedDB 单条记录操作失败:`, transaction.error);
        reject(transaction.error);
      };
    });
  }

  // 批量增量更新（用于批量操作）
  async updateImagesIncremental(newImages) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['images'], 'readwrite');
      const store = transaction.objectStore('images');
      
      // 获取现有数据
      const getAllRequest = store.getAll();
      
      getAllRequest.onsuccess = () => {
        const existingImages = getAllRequest.result || [];
        const existingMap = new Map(existingImages.map(img => [img.uri, img]));
        
        // 合并新数据
        newImages.forEach(newImg => {
          existingMap.set(newImg.uri, newImg);
        });
        
        // 清空并重新插入所有数据
        store.clear();
        const allImages = Array.from(existingMap.values());
        allImages.forEach(item => {
          store.add(item);
        });
        
        logger.debug(`✅ IndexedDB 批量增量更新成功，总图片数: ${allImages.length}`);
        resolve(true);
      };
      
      getAllRequest.onerror = () => {
        logger.error(`❌ IndexedDB 读取现有数据失败:`, getAllRequest.error);
        reject(getAllRequest.error);
      };
      
      transaction.onerror = () => {
        logger.error(`❌ IndexedDB 批量增量更新失败:`, transaction.error);
        reject(transaction.error);
      };
    });
  }

  async removeItem(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([key], 'readwrite');
      const store = transaction.objectStore(key);
      
      if (key === 'images' || key === 'stagingBox') {
        // 对于图片数据和暂存箱数据，清空整个表（因为它们是数组结构，不是键值对）
        store.clear();
      } else {
        // 对于其他数据，删除键值对
        store.delete(key);
      }
      
      transaction.oncomplete = () => {
        logger.debug(`✅ IndexedDB 删除成功 (${key})`);
        resolve(true);
      };
      
      transaction.onerror = () => {
        logger.error(`❌ IndexedDB 删除失败 (${key}):`, transaction.error);
        reject(transaction.error);
      };
    });
  }

  /**
   * 清空 IndexedDB 所有数据（模拟全新启动）
   * 清空所有 objectStore：images, stats, settings, classificationRules, similarityData, similarityGroupIndex
   */
  async clear() {
    await this.init();
    return new Promise((resolve, reject) => {
      // 获取所有 objectStore 名称
      const storeNames = Array.from(this.db.objectStoreNames);
      logger.debug(`🗑️ 开始清空 IndexedDB，包含 ${storeNames.length} 个表:`, storeNames);
      
      const transaction = this.db.transaction(storeNames, 'readwrite');
      
      transaction.oncomplete = () => {
        logger.debug('✅ IndexedDB 所有数据清空成功');
        resolve(true);
      };
      
      transaction.onerror = () => {
        logger.error('❌ IndexedDB 清空失败:', transaction.error);
        reject(transaction.error);
      };
      
      // 清空所有表
      for (const storeName of storeNames) {
        try {
          transaction.objectStore(storeName).clear();
          logger.debug(`  ✅ 已清空表: ${storeName}`);
        } catch (error) {
          logger.warn(`  ⚠️ 清空表失败: ${storeName}`, error);
        }
      }
    });
  }

  /**
   * 完全删除 IndexedDB 数据库（模拟全新启动）
   * 这会删除整个数据库，下次访问时会自动重新创建
   */
  async deleteDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB 不可用'));
        return;
      }

      // 关闭现有连接
      if (this.db) {
        this.db.close();
        this.db = null;
        this.isInitialized = false;
      }

      const deleteRequest = indexedDB.deleteDatabase(this.dbName);
      
      deleteRequest.onsuccess = () => {
        logger.debug('✅ IndexedDB 数据库删除成功:', this.dbName);
        resolve(true);
      };
      
      deleteRequest.onerror = () => {
        logger.error('❌ IndexedDB 数据库删除失败:', deleteRequest.error);
        reject(deleteRequest.error);
      };
      
      deleteRequest.onblocked = () => {
        logger.warn('⚠️ IndexedDB 数据库删除被阻塞，可能有其他连接正在使用');
        // 即使被阻塞，也继续删除
        resolve(true);
      };
    });
  }

  // 生成稳定的ID
  generateStableId(uri) {
    // 只使用URI的哈希值，确保同一URI总是生成相同ID
    let hash = 0;
    for (let i = 0; i < uri.length; i++) {
      const char = uri.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return `img_${Math.abs(hash).toString(36)}`;
  }
}

class ImageStorageService {
  constructor() {
    this.storageKeys = {
      images: 'images',
      stats: 'stats',
      settings: 'settings',
      classificationRules: 'classificationRules',
      similarityData: 'similarityData', // 新增：相似度数据表
      similarityGroupIndex: 'similarityGroupIndex', // 新增：相似组索引
      stagingBox: 'stagingBox', // 新增：暂存箱
    };
    this.isInitialized = false;
    // 添加保存锁，防止并发保存导致数据丢失
    this.saveLock = null;
    
    // 🆕 根据平台选择存储方式
    if (Platform.OS === 'web') {
      // PC端：使用IndexedDB，失败时降级到localStorage
      logger.debug('💻 PC端: 使用 IndexedDB 存储');
      this.storage = new IndexedDBAdapter();
      this.fallbackStorage = AsyncStorage;
    } else {
      // 移动端：使用SQLite，失败时降级到AsyncStorage
      logger.debug('📱 移动端: 使用 SQLite 存储');
      this.storage = new SQLiteAdapter();
      this.fallbackStorage = AsyncStorage;
    }
  }

  // 获取分类显示名称
  getCategoryDisplayName(categoryId) {
    // 确保配置服务已加载
    if (!configService || !configService.isConfigLoaded()) {
      throw new Error('ConfigService未初始化或配置未加载');
    }
    
    return configService.getCategoryDisplayName(categoryId, 'chinese');
  }

  // Initialize check
  async ensureInitialized() {
    if (this.isInitialized) return;
    
    try {
      if (Platform.OS === 'web') {
        // PC端：初始化IndexedDB
        logger.debug('💻 开始初始化 IndexedDB...');
        await this.storage.init();
        logger.debug('✅ IndexedDB 初始化完成');
      } else {
        // 移动端：初始化SQLite
        logger.debug('📱 开始初始化 SQLite...');
        try {
          await this.storage.init();
          logger.debug('✅ SQLite 初始化完成');
        } catch (sqliteError) {
          logger.error('❌ SQLite 初始化失败，降级到 AsyncStorage:', sqliteError);
          // 降级到AsyncStorage
          this.storage = this.fallbackStorage;
        await this.storage.getItem('test');
          logger.debug('✅ AsyncStorage 初始化完成（降级模式）');
        }
      }
      this.isInitialized = true;
      logger.debug('✅ 存储服务初始化成功');
      
      // 初始化客户端唯一ID
      await this.initializeClientId();
    } catch (error) {
      logger.error('❌ 存储初始化失败:', error);
      
      // 如果IndexedDB失败且有降级存储，尝试降级
      if (Platform.OS === 'web' && this.fallbackStorage) {
        try {
          logger.debug(' 降级到localStorage存储');
          this.storage = this.fallbackStorage;
          await this.storage.getItem('test');
          this.isInitialized = true;
          logger.warn('⚠️ 当前使用localStorage存储，检测结果可能不会显示在IndexedDB中');
          return;
        } catch (fallbackError) {
          logger.error(' localStorage降级也失败:', fallbackError);
        }
      }
      
      // 最后尝试：强制清理数据库后重试
      logger.debug(' 尝试强制清理数据库...');
      try {
        // 尝试删除数据库
        const deleteRequest = indexedDB.deleteDatabase(this.dbName);
        deleteRequest.onsuccess = () => {
          logger.debug(' 数据库删除成功，准备重新创建');
        };
        deleteRequest.onerror = () => {
          logger.warn('⚠️ 数据库删除失败，继续尝试');
        };
        
        // 等待删除完成
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 重新创建IndexedDB适配器
        logger.debug(' 重新创建IndexedDB适配器...');
        this.storage = new IndexedDBAdapter();
        logger.debug(' 重试IndexedDB初始化...');
        await this.storage.init();
        logger.debug(' 重试IndexedDB初始化成功');
        this.isInitialized = true;
        logger.debug(' 重试成功，IndexedDB初始化完成');
      } catch (retryError) {
        logger.error(' 重试IndexedDB初始化失败:', retryError);
        logger.debug(' 最终降级到localStorage存储');
        // 最终降级到localStorage
        this.storage = this.fallbackStorage;
        await this.storage.getItem('test');
        this.isInitialized = true;
        logger.warn('⚠️ 当前使用localStorage存储，检测结果可能不会显示在IndexedDB中');
      }
    }
  }

  // 批量保存图片详细信息
  async saveImageDetailedInfo(imageDataArray) {
    try {
      await this.ensureInitialized();
      
      if (!imageDataArray || imageDataArray.length === 0) {
        logger.debug('⚠️ saveImageDetailedInfo: 图片数据数组为空，跳过保存');
        return;
      }
      
      logger.debug(`💾 saveImageDetailedInfo: 准备保存 ${imageDataArray.length} 张图片`);
      
      // 等待之前的保存操作完成
      while (this.saveLock) {
        logger.debug('⏳ 等待之前的保存操作完成...');
        await this.saveLock;
      }
      
      // 创建新的保存锁
      this.saveLock = this._performSaveOptimized(imageDataArray);
      const result = await this.saveLock;
      this.saveLock = null;
      
      logger.debug(`✅ saveImageDetailedInfo: 保存完成 ${imageDataArray.length} 张图片`);
      return result;
      
    } catch (error) {
      logger.error('❌ Batch save failed:', error);
      this.saveLock = null; // 确保锁被释放
      throw error;
    }
  }
  
  /**
   * 批量更新分类信息（只更新分类相关字段，不更新其他字段）
   * @param {Array} classificationDataArray - 分类数据数组，每个元素包含：
   *   - uri: 图片 URI（必需）
   *   - category: 分类ID（必需）
   *   - confidence: 置信度（可选）
   *   - idCardDetections: 身份证检测结果（可选）
   *   - generalDetections: 通用检测结果（可选）
   *   - mobileNetV3Detections: MobileNetV3检测结果（可选）
   *   - message: 大模型推理描述（可选）
   * @returns {Promise<Object>} 更新结果统计 { success: boolean, updatedCount: number, failedCount: number }
   */
  async batchUpdateClassification(classificationDataArray) {
    try {
      await this.ensureInitialized();
      
      if (!classificationDataArray || classificationDataArray.length === 0) {
        return { success: true, updatedCount: 0, failedCount: 0 };
      }
      
      let result;
      if (Platform.OS === 'web') {
        // PC端：使用IndexedDB
        result = await this._batchUpdateClassificationIndexedDB(classificationDataArray);
      } else {
        // 移动端：使用SQLite
        result = await this._batchUpdateClassificationSQLite(classificationDataArray);
      }
      
      return result;
    } catch (error) {
      logger.error('❌ 批量更新分类信息失败:', error);
      return { success: false, updatedCount: 0, failedCount: classificationDataArray.length, error };
    }
  }

  /**
   * PC端：IndexedDB批量更新分类信息
   */
  async _batchUpdateClassificationIndexedDB(classificationDataArray) {
    await this.storage.init();
    
    let updatedCount = 0;
    let failedCount = 0;
    
    return new Promise((resolve, reject) => {
      const transaction = this.storage.db.transaction(['images'], 'readwrite');
      const store = transaction.objectStore('images');
      let completed = 0;
      const total = classificationDataArray.length;
      
      if (total === 0) {
        resolve({ success: true, updatedCount: 0, failedCount: 0 });
        return;
      }
      
      for (const classificationData of classificationDataArray) {
        const imageId = classificationData.id || this.storage.generateStableId(classificationData.uri);
        const getRequest = store.get(imageId);
        
        getRequest.onsuccess = () => {
          const existingImage = getRequest.result;
          
          if (existingImage) {
            // 只更新分类相关字段，保留其他字段
            // 🔧 如果 category 是 null 或空字符串，保留数据库中的原值；如果原值也为空，使用默认值 'NA'
            let category = classificationData.category;
            if (!category || (typeof category === 'string' && category.trim() === '')) {
              // 如果传入的 category 为空，保留数据库中的原值
              category = existingImage.category;
              // 如果数据库中的原值也为空，使用默认值 'NA'
              if (!category || (typeof category === 'string' && category.trim() === '')) {
                category = 'NA';
                logger.debug(`⚠️ 图片 ${imageId} 缺少分类信息，使用默认值 'NA'`);
              }
            }
            
            const updatedImage = {
              ...existingImage,
              category: category,
              confidence: classificationData.confidence !== undefined ? classificationData.confidence : existingImage.confidence,
              idCardDetections: classificationData.idCardDetections !== undefined ? classificationData.idCardDetections : existingImage.idCardDetections,
              generalDetections: classificationData.generalDetections !== undefined ? classificationData.generalDetections : existingImage.generalDetections,
              mobileNetV3Detections: classificationData.mobileNetV3Detections !== undefined ? classificationData.mobileNetV3Detections : existingImage.mobileNetV3Detections,
              message: classificationData.message !== undefined ? classificationData.message : existingImage.message,
              background_color: classificationData.background_color !== undefined ? classificationData.background_color : existingImage.background_color,
              updatedAt: new Date().toISOString()
            };
            
            store.put(updatedImage);
            updatedCount++;
          } else {
            logger.warn(`⚠️ IndexedDB 未找到图片: ${imageId}, uri: ${classificationData.uri}`);
            failedCount++;
          }
          
          completed++;
          if (completed === total) {
            resolve({ success: true, updatedCount, failedCount });
          }
        };
        
        getRequest.onerror = () => {
          logger.error(`❌ IndexedDB 查找图片失败: ${imageId}`, getRequest.error);
          failedCount++;
          completed++;
          if (completed === total) {
            resolve({ success: true, updatedCount, failedCount });
          }
        };
      }
      
      transaction.onerror = () => {
        logger.error('❌ IndexedDB 批量更新分类失败:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  /**
   * 移动端：SQLite批量更新分类信息
   */
  async _batchUpdateClassificationSQLite(classificationDataArray) {
    await this.ensureInitialized();
    
    let updatedCount = 0;
    let failedCount = 0;
    
    // 批量处理，每批100条
    const batchSize = 100;
    for (let i = 0; i < classificationDataArray.length; i += batchSize) {
      const batch = classificationDataArray.slice(i, i + batchSize);
      
      // 为每条记录构建 UPDATE 语句
      const updatePromises = batch.map(async (classificationData) => {
        try {
          const imageId = classificationData.id || this.generateStableId(classificationData.uri);
          
          // 构建动态 SET 子句，只更新提供的字段
          const setParts = [];
          const params = [];
          
          // 🔥 只在明确提供 category 时才更新，避免清空现有分类
          if (classificationData.category !== undefined) {
            setParts.push('category = ?');
            params.push(classificationData.category);
          }
          
          if (classificationData.confidence !== undefined) {
            setParts.push('confidence = ?');
            params.push(classificationData.confidence);
          }
          
          if (classificationData.idCardDetections !== undefined) {
            setParts.push('idCardDetections = ?');
            params.push(classificationData.idCardDetections ? JSON.stringify(classificationData.idCardDetections) : null);
          }
          
          if (classificationData.generalDetections !== undefined) {
            setParts.push('generalDetections = ?');
            params.push(classificationData.generalDetections ? JSON.stringify(classificationData.generalDetections) : null);
          }
          
          if (classificationData.mobileNetV3Detections !== undefined) {
            setParts.push('mobileNetV3Detections = ?');
            params.push(classificationData.mobileNetV3Detections ? JSON.stringify(classificationData.mobileNetV3Detections) : null);
          }
          
          if (classificationData.message !== undefined) {
            setParts.push('message = ?');
            params.push(classificationData.message);
          }

          if (classificationData.duration !== undefined) {
            setParts.push('duration = ?');
            params.push(classificationData.duration);
          }

          if (classificationData.background_color !== undefined) {
            setParts.push('background_color = ?');
            params.push(classificationData.background_color);
          }
          
          // 始终更新 updatedAt
          setParts.push('updatedAt = ?');
          params.push(new Date().toISOString());
          
          // 添加 WHERE 条件
          params.push(imageId);
          
          const sql = `
            UPDATE images 
            SET ${setParts.join(', ')}
            WHERE id = ?
          `;
          
          const [result] = await this.storage.db.executeSql(sql, params);
          
          if (result.rowsAffected > 0) {
            return { success: true };
          } else {
            logger.warn(`⚠️ SQLite 未找到图片: ${imageId}, uri: ${classificationData.uri}`);
            return { success: false };
          }
        } catch (error) {
          logger.error(`❌ SQLite 更新分类失败: ${classificationData.uri}`, error);
          return { success: false, error };
        }
      });
      
      const results = await Promise.all(updatePromises);
      
      for (const result of results) {
        if (result.success) {
          updatedCount++;
        } else {
          failedCount++;
        }
      }
    }
    
    return { success: true, updatedCount, failedCount };
  }

  /**
   * 🔥 批量更新city字段（仅更新位置信息，不查询其他字段）
   * 用于位置信息补全，避免查询所有数据导致的数据库锁竞争
   * @param {Array} cityDataArray - 位置数据数组，每个元素包含：
   *   - uri: 图片 URI（必需）
   *   - id: 图片 ID（可选，如果有则使用，否则根据 URI 生成）
   *   - city: location_id（必需）
   * @returns {Promise<Object>} 更新结果统计 { success: boolean, updatedCount: number, failedCount: number }
   */
  async batchUpdateCity(cityDataArray) {
    try {
      await this.ensureInitialized();
      
      if (!cityDataArray || cityDataArray.length === 0) {
        return { success: true, updatedCount: 0, failedCount: 0 };
      }
      
      if (Platform.OS === 'web') {
        // PC端：使用IndexedDB
        return await this._batchUpdateCityIndexedDB(cityDataArray);
      } else {
        // 移动端：使用SQLite
        return await this._batchUpdateCitySQLite(cityDataArray);
      }
    } catch (error) {
      logger.error('❌ 批量更新city失败:', error);
      return { success: false, updatedCount: 0, failedCount: cityDataArray.length, error: error.message };
    }
  }

  /**
   * PC端：IndexedDB批量更新city
   */
  async _batchUpdateCityIndexedDB(cityDataArray) {
    await this.storage.init();
    
    let updatedCount = 0;
    let failedCount = 0;
    
    for (const cityData of cityDataArray) {
      try {
        const imageId = cityData.id || this.storage.generateStableId(cityData.uri);
        const existingImage = await this.storage.getItem('images').then(images => 
          images ? images.find(img => img.id === imageId) : null
        );
        
        if (existingImage) {
          existingImage.city = cityData.city;
          existingImage.updatedAt = new Date().toISOString();
          await this.storage.setItem('images', 
            await this.storage.getItem('images').then(images => 
              images.map(img => img.id === imageId ? existingImage : img)
            )
          );
          updatedCount++;
        } else {
          failedCount++;
          logger.warn(`⚠️ IndexedDB 未找到图片: ${imageId}, uri: ${cityData.uri}`);
        }
      } catch (error) {
        logger.error(`❌ IndexedDB 更新city失败: ${cityData.uri}`, error);
        failedCount++;
      }
    }
    
    return { success: true, updatedCount, failedCount };
  }

  /**
   * 移动端：SQLite批量更新city（直接UPDATE，不查询其他字段）
   * 🔥 使用事务批量执行，减少数据库锁竞争
   */
  async _batchUpdateCitySQLite(cityDataArray) {
    await this.ensureInitialized();
    
    let updatedCount = 0;
    let failedCount = 0;
    
    // 批量处理，每批100条
    const batchSize = 100;
    for (let i = 0; i < cityDataArray.length; i += batchSize) {
      const batch = cityDataArray.slice(i, i + batchSize);
      
      // 🔥 使用事务批量执行所有UPDATE，减少数据库锁竞争
      await new Promise((resolve, reject) => {
        this.storage.db.transaction((tx) => {
          let completed = 0;
          let hasError = false;
          const totalUpdates = batch.length;
          const updatedAt = new Date().toISOString();
          
          const checkComplete = () => {
            if (completed === totalUpdates && !hasError) {
              resolve();
            } else if (hasError && completed === totalUpdates) {
              reject(new Error('批量更新city失败'));
            }
          };
          
          for (const cityData of batch) {
            try {
              const imageId = cityData.id || this.storage.generateStableId(cityData.uri);
              
              if (!cityData.city || cityData.city.trim() === '') {
                logger.warn(`⚠️ SQLite city为空，跳过: ${imageId}, uri: ${cityData.uri}`);
                completed++;
                failedCount++;
                checkComplete();
                continue;
              }
              
              // 🔥 在事务中执行UPDATE，只更新city字段，不查询其他字段
              tx.executeSql(
                `UPDATE images SET city = ?, updatedAt = ? WHERE id = ?`,
                [cityData.city, updatedAt, imageId],
                (tx, result) => {
                  completed++;
                  if (result.rowsAffected > 0) {
                    updatedCount++;
                  } else {
                    failedCount++;
                    logger.warn(`⚠️ SQLite 未找到图片: ${imageId}, uri: ${cityData.uri}`);
                  }
                  checkComplete();
                },
                (tx, error) => {
                  if (!hasError) {
                    hasError = true;
                    logger.error(`❌ SQLite 更新city失败: ${cityData.uri}`, error);
                  }
                  completed++;
                  failedCount++;
                  checkComplete();
                }
              );
            } catch (error) {
              if (!hasError) {
                hasError = true;
                logger.error(`❌ SQLite 更新city失败: ${cityData.uri}`, error);
              }
              completed++;
              failedCount++;
              checkComplete();
            }
          }
        }, (error) => {
          logger.error('❌ SQLite 批量更新city事务失败:', error);
          reject(error);
        });
      });
    }
    
    return { success: true, updatedCount, failedCount };
  }

  // 实际执行保存操作的方法
  async _performSaveOptimized(imageDataArray) {
    // 优化的保存方法：使用真正的批量插入
    if (imageDataArray.length === 0) {
      return { newCount: 0, updatedCount: 0 };
    }

    // 构建批量插入的SQL语句
    const batchSize = 100; // 每批处理100条记录，避免SQL语句过长
    let totalNewCount = 0;
    let totalUpdatedCount = 0;

    for (let i = 0; i < imageDataArray.length; i += batchSize) {
      const batch = imageDataArray.slice(i, i + batchSize);
      const { newCount, updatedCount } = await this._performBatchInsert(batch);
      totalNewCount += newCount;
      totalUpdatedCount += updatedCount;
    }
    
    // 更新统计信息
    await this.updateStats();
    
    return { newCount: totalNewCount, updatedCount: totalUpdatedCount };
  }

  // 执行批量插入的方法
  async _performBatchInsert(imageDataArray) {
    if (imageDataArray.length === 0) {
      return { newCount: 0, updatedCount: 0 };
    }

    if (Platform.OS === 'web') {
      // PC端：使用IndexedDB的批量插入
      return await this._performBatchInsertIndexedDB(imageDataArray);
    } else {
      // 移动端：使用SQLite的批量插入
      return await this._performBatchInsertSQLite(imageDataArray);
    }
  }

  // PC端：IndexedDB批量插入实现
  async _performBatchInsertIndexedDB(imageDataArray) {
    await this.storage.init();
    
    let newCount = 0;
    let updatedCount = 0;
    let naCount = 0;
    let screenshotCount = 0;
    
    logger.debug(`🔍 [诊断] IndexedDB批量插入开始: ${imageDataArray.length} 条记录`);
    
    // 逐个处理图片数据（IndexedDB没有真正的批量插入，但我们可以优化）
    for (let i = 0; i < imageDataArray.length; i++) {
      const imageData = imageDataArray[i];
      try {
        // 🔍 诊断：记录分类信息
        if (imageData.category === 'NA') naCount++;
        if (imageData.category === 'screenshot') screenshotCount++;
        
        // 🔥 如果提供了 cameraSettings 但没有分类字段，则计算分类
        const categories = imageData.isoCategory !== undefined && imageData.apertureCategory !== undefined
          ? {
              isoCategory: imageData.isoCategory || null,
              apertureCategory: imageData.apertureCategory || null,
              shutterCategory: imageData.shutterCategory || null,
              focalLengthCategory: imageData.focalLengthCategory || null
            }
          : calculateCameraSettingsCategories(imageData.cameraSettings);
        
        // 🔥 调试日志：记录分类计算结果
        if (imageData.cameraSettings && (categories.isoCategory || categories.apertureCategory || categories.shutterCategory || categories.focalLengthCategory)) {
        }
        
        const imageRecord = {
          id: imageData.id || this.storage.generateStableId(imageData.uri),
          uri: imageData.uri,
          category: imageData.category,
          confidence: imageData.confidence,
          timestamp: imageData.timestamp,
          fileName: imageData.fileName,
          size: imageData.size,
          takenAt: imageData.takenAt || null,
          latitude: imageData.latitude || null,
          longitude: imageData.longitude || null,
          altitude: imageData.altitude || null,
          accuracy: imageData.accuracy || null,
          address: imageData.address || null,
          city: imageData.city || null,
          country: imageData.country || null,
          province: imageData.province || null,
          district: imageData.district || null,
          street: imageData.street || null,
          locationSource: imageData.locationSource || null,
          cityDistance: imageData.cityDistance || null,
          idCardDetections: imageData.idCardDetections || null,
          generalDetections: imageData.generalDetections || null,
          mobileNetV3Detections: imageData.mobileNetV3Detections || null,
          imageDimensions: imageData.imageDimensions || null,
          message: imageData.message || null,
          background_color: imageData.background_color || null,
          // 🔥 拍摄参数和分类（如果已有分类则使用，否则根据 cameraSettings 计算）
          cameraSettings: imageData.cameraSettings ? (typeof imageData.cameraSettings === 'string' ? imageData.cameraSettings : JSON.stringify(imageData.cameraSettings)) : null,
          isoCategory: categories.isoCategory,
          apertureCategory: categories.apertureCategory,
          shutterCategory: categories.shutterCategory,
          focalLengthCategory: categories.focalLengthCategory,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // 🔍 诊断：检查关键字段
        if (!imageRecord.category) {
          logger.warn(`⚠️ [诊断] 图片缺少category字段: ${imageRecord.uri}`);
        }

        // 使用IndexedDB的单条插入方法
        await this.storage.addOrUpdateSingleImage(imageRecord);
        newCount++; // IndexedDB的addOrUpdateSingleImage会处理新增/更新逻辑
      } catch (error) {
        logger.error(`❌ IndexedDB批量插入单条记录失败 (${i + 1}/${imageDataArray.length}):`, error);
        // 继续处理下一条记录
      }
    }
    
    logger.debug(`🔍 [诊断] IndexedDB批量插入完成: 成功=${newCount}, NA=${naCount}, screenshot=${screenshotCount}`);
    
    // 🔍 诊断：写入后立即验证
    try {
      const allImages = await this.getImages();
      const naInDb = allImages.filter(img => img.category === 'NA').length;
      const screenshotInDb = allImages.filter(img => img.category === 'screenshot').length;
      logger.debug(`🔍 [诊断] IndexedDB写入后验证: 总数=${allImages.length}, NA=${naInDb}, screenshot=${screenshotInDb}`);
    } catch (verifyError) {
      logger.warn('⚠️ [诊断] IndexedDB写入后验证失败:', verifyError);
    }
    
    return { newCount, updatedCount };
  }

  // 移动端：SQLite批量插入实现
  async _performBatchInsertSQLite(imageDataArray) {
    // ❌ 严格数据验证：检查是否只传递了部分字段（部分更新）
    // 如果只传递了部分字段，需要先读取现有数据，然后合并更新
    
    const validImageDataArray = [];
    const invalidData = [];
    
    // 检查哪些记录需要从数据库读取现有数据
    const idsToCheck = imageDataArray
      .filter(img => img.id || img.uri)
      .map(img => img.id || this.storage.generateStableId(img.uri));
    
    // 批量读取现有数据（如果存在）
    let existingImagesMap = new Map();
    if (idsToCheck.length > 0) {
      try {
        const existingImagesMapResult = await this.getImagesByIds(idsToCheck);
        // getImagesByIds 返回 Map，直接使用
        existingImagesMap = existingImagesMapResult;
      } catch (error) {
        logger.warn('⚠️ 读取现有数据失败，将进行严格验证:', error);
      }
    }
    
    for (const imageData of imageDataArray) {
      // 验证必需字段
      if (!imageData.uri) {
        throw new Error(`数据验证失败: uri 为空, data=${JSON.stringify(imageData)}`);
      }
      
      const imageId = imageData.id || this.storage.generateStableId(imageData.uri);
      const existingImage = existingImagesMap.get(imageId);
      const isPartialUpdate = !!existingImage;
      
      // 确保 fileName 不为空
      let fileName = imageData.fileName;
      if (!fileName || fileName.trim() === '') {
        if (isPartialUpdate && existingImage.fileName) {
          fileName = existingImage.fileName;
        } else {
          // 从 URI 中提取文件名
          try {
            const uriObj = new URL(imageData.uri);
            fileName = uriObj.pathname.split('/').pop() || 'unknown.jpg';
          } catch (e) {
            const pathParts = imageData.uri.split('/');
            fileName = pathParts[pathParts.length - 1] || 'unknown.jpg';
          }
        }
      }
      
      // ❌ 严格验证：如果是部分更新，必须从现有数据中读取缺失的关键字段
      if (isPartialUpdate) {
        // 关键字段：width, height, imageDimensions, category
        if (!imageData.hasOwnProperty('width') || imageData.width == null) {
          if (existingImage.width && existingImage.width > 0) {
            imageData.width = existingImage.width;
          } else {
            throw new Error(`部分更新时，现有数据的 width 也为0或null，无法合并更新: id=${imageId}, uri=${imageData.uri}`);
          }
        }
        if (!imageData.hasOwnProperty('height') || imageData.height == null) {
          if (existingImage.height && existingImage.height > 0) {
            imageData.height = existingImage.height;
          } else {
            throw new Error(`部分更新时，现有数据的 height 也为0或null，无法合并更新: id=${imageId}, uri=${imageData.uri}`);
          }
        }
        if (!imageData.hasOwnProperty('imageDimensions') || imageData.imageDimensions == null) {
          if (existingImage.imageDimensions) {
            imageData.imageDimensions = existingImage.imageDimensions;
          } else {
            throw new Error(`部分更新时，现有数据的 imageDimensions 也为空，无法合并更新: id=${imageId}, uri=${imageData.uri}`);
          }
        }
        if (!imageData.hasOwnProperty('category') || !imageData.category || imageData.category.trim() === '') {
          if (existingImage.category && existingImage.category.trim() !== '') {
            imageData.category = existingImage.category;
          } else {
            throw new Error(`部分更新时，现有数据的 category 也为空，无法合并更新: id=${imageId}, uri=${imageData.uri}`);
          }
        }
        
        // 可选字段：如果不存在，从现有数据读取
        if (!imageData.hasOwnProperty('size') || imageData.size == null) {
          imageData.size = existingImage.size || null;
        }
        if (!imageData.hasOwnProperty('mimeType') || imageData.mimeType == null) {
          imageData.mimeType = existingImage.mimeType || null;
        }
        if (!imageData.hasOwnProperty('timestamp') || imageData.timestamp == null) {
          imageData.timestamp = existingImage.timestamp || null;
        }
        if (!imageData.hasOwnProperty('takenAt') || imageData.takenAt == null) {
          imageData.takenAt = existingImage.takenAt || null;
        }
        if (!imageData.hasOwnProperty('createdAt') || imageData.createdAt == null) {
          imageData.createdAt = existingImage.createdAt || new Date().toISOString();
        }
      } else {
        // 新记录：必须包含所有必填字段
        if (!imageData.hasOwnProperty('width') || !imageData.hasOwnProperty('height') || 
            imageData.width == null || imageData.height == null) {
          throw new Error(`新记录必须包含 width 和 height: id=${imageId}, uri=${imageData.uri}`);
        }
        if (!imageData.hasOwnProperty('imageDimensions') || imageData.imageDimensions == null) {
          throw new Error(`新记录必须包含 imageDimensions: id=${imageId}, uri=${imageData.uri}`);
        }
        if (!imageData.hasOwnProperty('category') || !imageData.category || imageData.category.trim() === '') {
          throw new Error(`新记录必须包含 category: id=${imageId}, uri=${imageData.uri}`);
        }
        
        // 设置默认值
        if (!imageData.createdAt) {
          imageData.createdAt = new Date().toISOString();
        }
      }
      
      validImageDataArray.push({
        ...imageData,
        id: imageId,
        fileName: fileName
      });
    }
    
    if (invalidData.length > 0) {
      logger.warn(`⚠️ 过滤了 ${invalidData.length} 条无效数据`);
    }
    
    if (validImageDataArray.length === 0) {
      logger.warn('⚠️ 没有有效数据可保存');
      return { newCount: 0, updatedCount: 0 };
    }
    
    // 构建批量SQL语句（添加了5个拍摄参数字段）
    const placeholders = validImageDataArray.map(() => 
      '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).join(', ');

    const sql = `
      INSERT OR REPLACE INTO images (
        id, uri, fileName, category, confidence, timestamp, takenAt,
        size, mimeType, width, height, createdAt, updatedAt,
        latitude, longitude, altitude, accuracy,
        address, city, country, province, district, street, locationSource, cityDistance,
        idCardDetections, generalDetections, mobileNetV3Detections, imageDimensions, message,
        cameraSettings, isoCategory, apertureCategory, shutterCategory, focalLengthCategory
      ) VALUES ${placeholders}
    `;

    // 构建参数数组
    const params = [];
    for (const imageData of validImageDataArray) {
      // 🔥 如果提供了 cameraSettings 但没有分类字段，则计算分类
      const categories = imageData.isoCategory !== undefined && imageData.apertureCategory !== undefined
        ? {
            isoCategory: imageData.isoCategory || null,
            apertureCategory: imageData.apertureCategory || null,
            shutterCategory: imageData.shutterCategory || null,
            focalLengthCategory: imageData.focalLengthCategory || null
          }
        : calculateCameraSettingsCategories(imageData.cameraSettings);
      
      const imageRecord = {
        id: imageData.id || this.storage.generateStableId(imageData.uri),
        uri: imageData.uri,
        // 🔧 确保 category 不为 null，如果为空则使用默认值 "NA"
        category: imageData.category && imageData.category.trim() !== '' ? imageData.category : 'NA',
        confidence: imageData.confidence || null,
        timestamp: imageData.timestamp || null,
        fileName: imageData.fileName, // 已经在验证阶段确保不为空
        size: imageData.size || null,
        mimeType: imageData.mimeType || null,
        width: imageData.width || null,
        height: imageData.height || null,
        takenAt: imageData.takenAt || null,
        latitude: imageData.latitude || null,
        longitude: imageData.longitude || null,
        altitude: imageData.altitude || null,
        accuracy: imageData.accuracy || null,
        address: imageData.address || null,
        city: imageData.city || null,
        country: imageData.country || null,
        province: imageData.province || null,
        district: imageData.district || null,
        street: imageData.street || null,
        locationSource: imageData.locationSource || null,
        cityDistance: imageData.cityDistance || null,
        idCardDetections: imageData.idCardDetections || null,
        generalDetections: imageData.generalDetections || null,
        mobileNetV3Detections: imageData.mobileNetV3Detections || null,
        imageDimensions: imageData.imageDimensions || null,
        message: imageData.message || null,
        // 🔥 拍摄参数和分类（如果已有分类则使用，否则根据 cameraSettings 计算）
        cameraSettings: imageData.cameraSettings || null,
        isoCategory: categories.isoCategory,
        apertureCategory: categories.apertureCategory,
        shutterCategory: categories.shutterCategory,
        focalLengthCategory: categories.focalLengthCategory,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // 按SQL字段顺序添加参数
      params.push(
        imageRecord.id,
        imageRecord.uri,
        imageRecord.fileName,
        imageRecord.category,
        imageRecord.confidence,
        imageRecord.timestamp,
        imageRecord.takenAt,
        imageRecord.size,
        imageRecord.mimeType,
        imageRecord.width,
        imageRecord.height,
        imageRecord.createdAt,
        imageRecord.updatedAt,
        imageRecord.latitude,
        imageRecord.longitude,
        imageRecord.altitude,
        imageRecord.accuracy,
        imageRecord.address,
        imageRecord.city,
        imageRecord.country,
        imageRecord.province,
        imageRecord.district,
        imageRecord.street,
        imageRecord.locationSource,
        imageRecord.cityDistance,
        // 修复：将对象转换为JSON字符串
        imageRecord.idCardDetections ? JSON.stringify(imageRecord.idCardDetections) : null,
        imageRecord.generalDetections ? JSON.stringify(imageRecord.generalDetections) : null,
        imageRecord.mobileNetV3Detections ? JSON.stringify(imageRecord.mobileNetV3Detections) : null,
        imageRecord.imageDimensions ? JSON.stringify(imageRecord.imageDimensions) : null,
        imageRecord.message,
        // 🔥 拍摄参数和分类
        imageRecord.cameraSettings ? JSON.stringify(imageRecord.cameraSettings) : null,
        imageRecord.isoCategory,
        imageRecord.apertureCategory,
        imageRecord.shutterCategory,
        imageRecord.focalLengthCategory
      );
    }

    // 执行批量插入
    try {
      await this.storage.db.executeSql(sql, params);
    } catch (error) {
      // 如果批量插入失败，记录详细错误信息
      logger.error(`❌ SQLite批量插入失败: 有效数据=${validImageDataArray.length}, 无效数据=${invalidData.length}`, error);
      
      // 尝试逐个插入，找出有问题的数据
      if (validImageDataArray.length > 1) {
        logger.debug('🔄 尝试逐个插入以定位问题数据...');
        let successCount = 0;
        let failCount = 0;
        
        for (const imageData of validImageDataArray) {
          try {
            await this._performBatchInsertSQLite([imageData]);
            successCount++;
          } catch (singleError) {
            failCount++;
            logger.error(`❌ 单条插入失败: uri=${imageData.uri}, fileName=${imageData.fileName}`, singleError);
          }
        }
        
        logger.debug(`📊 逐个插入结果: 成功=${successCount}, 失败=${failCount}`);
      }
      
      throw error;
    }

    // 由于使用了 INSERT OR REPLACE，我们无法准确区分新增和更新
    // 返回一个估算值
    return { newCount: validImageDataArray.length, updatedCount: 0 };
  }

  async _performSave(imageDataArray) {
    // 获取现有图片数据
    const existingImages = await this.getImages();
    
    // 批量处理
    const newImages = [];
    const updatedImages = [];
    
    for (const imageData of imageDataArray) {
      const { uri, category, confidence, timestamp, fileName, size } = imageData;
      
      // 检查是否已存在
      const existingIndex = existingImages.findIndex(img => img.uri === uri);
      
      // 生成更稳定的ID，基于URI的哈希值
      const generateStableId = (uri) => {
        // 使用URI的简单哈希作为ID基础，确保相同URI总是生成相同ID
        let hash = 0;
        for (let i = 0; i < uri.length; i++) {
          const char = uri.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash; // 转换为32位整数
        }
        return `img_${Math.abs(hash).toString(36)}`;
      };
      
      const imageRecord = {
        id: existingIndex >= 0 ? existingImages[existingIndex].id : generateStableId(uri),
        uri,
        category,
        confidence,
        timestamp,
        fileName,
        size,
        takenAt: imageData.takenAt || null,
        latitude: imageData.latitude || null,
        longitude: imageData.longitude || null,
        altitude: imageData.altitude || null,
        accuracy: imageData.accuracy || null,
        address: imageData.address || null,
        city: imageData.city || null,
        country: imageData.country || null,
        province: imageData.province || null,
        district: imageData.district || null,
        street: imageData.street || null,
        locationSource: imageData.locationSource || null,
        cityDistance: imageData.cityDistance || null,
        // Detection results
        idCardDetections: imageData.idCardDetections || null,  // 身份证模型检测结果
        generalDetections: imageData.generalDetections || null,  // 通用模型检测结果
        mobileNetV3Detections: imageData.mobileNetV3Detections || null,  // MobileNetV3模型检测结果
        imageDimensions: imageData.imageDimensions || null,  // 图像尺寸信息
        message: imageData.message || null,  // 大模型推理描述
        background_color: imageData.background_color || null,  // 背景颜色
        createdAt: existingIndex >= 0 ? existingImages[existingIndex].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      if (existingIndex >= 0) {
        // 更新现有记录
        existingImages[existingIndex] = imageRecord;
        updatedImages.push(fileName);
      } else {
        // 添加新记录
        existingImages.push(imageRecord);
        newImages.push(fileName);
      }
    }
    
    // 🆕 保存到存储 - 根据平台和数据量选择最优保存策略
    if (this.storage.addOrUpdateSingleImage) {
      // PC端和移动端SQLite：使用单条记录操作（性能最优）
      // 使用existingImages中已构建好的imageRecord
      const imagesToSave = existingImages.filter(img => 
        imageDataArray.some(data => data.uri === img.uri)
      );
      
      for (const imageRecord of imagesToSave) {
        await this.storage.addOrUpdateSingleImage(imageRecord);
      }
    } else {
      // 移动端AsyncStorage（降级模式）：使用批量保存
      await this.storage.setItem(this.storageKeys.images, existingImages);
    }
    
    // 更新统计信息
    await this.updateStats();
    
    return { newCount: newImages.length, updatedCount: updatedImages.length };
  }

  // 获取完整图片数据（用于内部操作）
  async _getFullImages() {
    try {
      await this.ensureInitialized();
      
      const images = await this.storage.getItem(this.storageKeys.images);
      if (!images) {
        return [];
      }
      
      return images;
    } catch (error) {
      logger.error('Failed to get full images:', error);
      throw error;
    }
  }

  // 更新图片分类ID（独立接口，只更新分类相关字段）
  async updateImageCategory(imageId, newCategory, newConfidence = 'manual') {
    try {
      await this.ensureInitialized();
      
      logger.debug(`🔄 更新图片分类: ${imageId} -> ${newCategory}`);
      
      // 🆕 移动端：使用SQLite专用方法
      if (Platform.OS !== 'web' && this.storage.updateImageCategory) {
        const updated = await this.storage.updateImageCategory(imageId, newCategory, newConfidence);
        
        if (!updated) {
          throw new Error(`图片不存在: ${imageId}`);
        }
        
        // 更新统计信息
        await this.updateStats();
        
        // 返回更新后的图片（需要重新查询）
        const images = await this._getFullImages();
        const updatedImage = images.find(img => img.id === imageId);
        return updatedImage;
      }
      
      // PC端：使用IndexedDB事务
      if (!this.storage || !this.storage.db) {
        logger.error('❌ IndexedDB未初始化');
        throw new Error('IndexedDB未初始化');
      }
      
      return new Promise((resolve, reject) => {
        const transaction = this.storage.db.transaction(['images'], 'readwrite');
        const store = transaction.objectStore('images');
        
        // 直接使用id主键查找图片（id是keyPath，不需要索引）
        const getRequest = store.get(imageId);
        
        getRequest.onsuccess = async () => {
          const existingImage = getRequest.result;
          
          if (!existingImage) {
            logger.error(`❌ 未找到图片: ${imageId}`);
            reject(new Error(`图片不存在: ${imageId}`));
            return;
          }
          
          logger.debug(`📋 原始图片有检测结果:`, {
            hasIdCardDetections: !!existingImage.idCardDetections,
            hasGeneralDetections: !!existingImage.generalDetections,
            hasMobileNetV3Detections: !!existingImage.mobileNetV3Detections
          });
          
          // 只更新分类相关字段，保留所有检测结果和其他数据
          const updatedImage = {
            ...existingImage,
            category: newCategory,
            confidence: newConfidence,
            updatedAt: new Date().toISOString()
          };
          
          // 使用put更新记录（基于URI主键）
          const putRequest = store.put(updatedImage);
          
          putRequest.onsuccess = async () => {
            logger.debug(`✅ 图片分类更新成功: ${imageId} -> ${newCategory}`);
            
            // 更新统计信息
            try {
              await this.updateStats();
            } catch (statsError) {
              logger.warn('统计信息更新失败:', statsError);
            }
            
            resolve(updatedImage);
          };
          
          putRequest.onerror = () => {
            logger.error(`❌ IndexedDB put失败:`, putRequest.error);
            reject(putRequest.error);
          };
        };
        
        getRequest.onerror = () => {
          logger.error(`❌ IndexedDB get失败:`, getRequest.error);
          reject(getRequest.error);
        };
        
        transaction.onerror = () => {
          logger.error(`❌ IndexedDB 事务失败:`, transaction.error);
          reject(transaction.error);
        };
      });
      
    } catch (error) {
      logger.error(' 更新图片分类失败:', error);
      throw error;
    }
  }

  // 批量更新图片分类ID（统一接口，内部处理平台差异）
  /**
   * 把「未分类的视频」从 NA 迁到 NA_video（一次性/幂等）。供旧版已扫进 NA 的视频归位用。
   * 只动 category='NA' 且 mimeType 为 video/* 的记录，不影响已手动分类的视频。
   */
  async migrateUnclassifiedVideosToNaVideo() {
    try {
      if (Platform.OS === 'web') return { moved: 0 };
      await this.ensureInitialized();
      const now = new Date().toISOString();
      const [res] = await this.storage.db.executeSql(
        "UPDATE images SET category = 'NA_video', updatedAt = ? WHERE category = 'NA' AND mimeType LIKE 'video/%'",
        [now]
      );
      // 反向自愈：被误放进「待分类视频」的图片迁回「待分类」（如旧版选择器两个"待分类"并列时选错）
      const [res2] = await this.storage.db.executeSql(
        "UPDATE images SET category = 'NA', updatedAt = ? WHERE category = 'NA_video' AND (mimeType IS NULL OR mimeType NOT LIKE 'video/%')",
        [now]
      );
      const moved = ((res && res.rowsAffected) || 0) + ((res2 && res2.rowsAffected) || 0);
      if (moved > 0) logger.debug(`[migrate] 待分类归位 ${moved} 条（视频→NA_video / 图片→NA）`);
      return { moved };
    } catch (e) {
      logger.warn('迁移未分类视频失败:', e?.message || e);
      return { moved: 0 };
    }
  }

  async batchUpdateImageCategory(imageIds, newCategory, newConfidence = 'manual') {
    try {
      await this.ensureInitialized();

      logger.debug(`🔄 批量更新图片分类: ${imageIds.length}张图片 -> ${newCategory}`);
      
      if (!imageIds || imageIds.length === 0) {
        return { success: true, processed: 0 };
      }
      
      let processed = 0;
      const errors = [];
      
      if (Platform.OS !== 'web' && this.storage.db) {
        // 移动端：使用SQLite批量更新（直接内联SQLite逻辑）
        try {
          await this.storage.init();
          const placeholders = imageIds.map(() => '?').join(',');
          const sql = `
            UPDATE images 
            SET category = ?, confidence = ?, updatedAt = ?
            WHERE id IN (${placeholders})
          `;
          
          const params = [
            newCategory,
            newConfidence,
            new Date().toISOString(),
            ...imageIds
          ];
          
          const [result] = await this.storage.db.executeSql(sql, params);
          processed = result.rowsAffected;
          logger.debug(`✅ SQLite批量更新分类: ${processed}张图片 -> ${newCategory}`);
        } catch (error) {
          logger.error('批量更新分类（SQLite）失败:', error);
          errors.push({ imageId: 'bulk_operation', error: error.message });
        }
      } else {
        // PC端：一次读全量 -> 批量修改 -> 一次写回
        try {
          const allImages = await this.storage.getItem(this.storageKeys.images) || [];
          
          if (!Array.isArray(allImages) || allImages.length === 0) {
            logger.warn('批量更新分类：当前没有任何图片数据');
          }
          
          const imageIdSet = new Set(imageIds);
          let updatedCount = 0;
          const updatedImages = allImages.map(image => {
            if (image && image.id && imageIdSet.has(image.id)) {
              updatedCount++;
              return {
                ...image,
                category: newCategory,
                confidence: newConfidence,
                updatedAt: new Date().toISOString(),
              };
            }
            return image;
          });
          
          if (updatedCount > 0) {
            await this.storage.setItem(this.storageKeys.images, updatedImages);
            processed = updatedCount;
          } else {
            logger.warn('批量更新分类：在数据集中未找到匹配的图片ID');
          }
        } catch (error) {
          logger.error('批量更新分类（IndexedDB）失败:', error);
          errors.push({ imageId: 'bulk_operation', error: error.message });
        }
      }
      
      // 🆕 如果移动到tobecleaned分类，批量清理相似组信息（在更新统计信息之前）
      if (newCategory === 'tobecleaned') {
        logger.debug(`🧹 批量清理相似组信息: ${imageIds.length}张图片`);
        try {
          await this.batchRemoveFromSimilarityGroups(imageIds);
        } catch (error) {
          logger.warn(`批量清理相似组信息失败:`, error);
        }
      }
      
      // 更新统计信息
      await this.updateStats();
      
      logger.debug(`✅ 批量更新分类完成: ${processed}张成功`);
      
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

  // Save image classification result
  async saveImageClassification(imageData) {
    try {
      await this.ensureInitialized();
      
      const { uri, category, confidence, timestamp, fileName, size } = imageData;
      
      // Gallery scan only generates local files, no need to verify
      
      // Get existing image data
      const existingImages = await this.getImages();
      
      // Check if already exists
      const existingIndex = existingImages.findIndex(img => img.uri === uri);
      
      // 生成更稳定的ID，基于URI的哈希值
      const generateStableId = (uri) => {
        // 使用URI的简单哈希作为ID基础，确保相同URI总是生成相同ID
        let hash = 0;
        for (let i = 0; i < uri.length; i++) {
          const char = uri.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash; // 转换为32位整数
        }
        return `img_${Math.abs(hash).toString(36)}`;
      };
      
      const imageRecord = {
        id: existingIndex >= 0 ? existingImages[existingIndex].id : generateStableId(uri),
        uri,
        category,
        confidence,
        timestamp,
        fileName,
        size,
        takenAt: imageData.takenAt || null,
        // Location information
        latitude: imageData.latitude || null,
        longitude: imageData.longitude || null,
        altitude: imageData.altitude || null,
        accuracy: imageData.accuracy || null,
        address: imageData.address || null,
        city: imageData.city || null,
        country: imageData.country || null,
        province: imageData.province || null,
        district: imageData.district || null,
        street: imageData.street || null,
        locationSource: imageData.locationSource || null,
        cityDistance: imageData.cityDistance || null,
        // Detection results
        idCardDetections: imageData.idCardDetections || null,  // 身份证模型检测结果
        generalDetections: imageData.generalDetections || null,  // 通用模型检测结果
        mobileNetV3Detections: imageData.mobileNetV3Detections || null,  // MobileNetV3模型检测结果
        imageDimensions: imageData.imageDimensions || null,  // 图像尺寸信息
        message: imageData.message || null,  // 大模型推理描述
        // Additional metadata
        createdAt: existingIndex >= 0 ? existingImages[existingIndex].createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      if (existingIndex >= 0) {
        // Update existing record
        existingImages[existingIndex] = imageRecord;
        logger.debug(`Updated existing image record: ${fileName}`);
      } else {
        // Add new record
        existingImages.push(imageRecord);
        logger.debug(`Added new image record: ${fileName}`);
      }
      
      // Save to AsyncStorage
      await this.storage.setItem(this.storageKeys.images, existingImages);
      
      // Update statistics
      await this.updateStats();
      
      logger.debug(`Image classification saved successfully: ${fileName}`);
      return imageRecord;
      
    } catch (error) {
      logger.error('Failed to save image classification:', error);
      throw error;
    }
  }

  // Get all images (精简结构)
  async getImages() {
    try {
      await this.ensureInitialized();
      const fullImages = await this.storage.getItem(this.storageKeys.images);
      
      if (!fullImages) {
        return [];
      }
      
      // 转换为精简数据结构 - 只包含界面显示必需字段
      const simplifiedImages = fullImages
        .filter(img => {
          // 🆕 过滤掉无效的图片对象
          if (!img || typeof img !== 'object') {
            logger.warn(`⚠️ 发现无效的图片对象，已过滤:`, img);
            return false;
          }
          return true;
        })
        .map(img => {
          // 🔧 确保 category 不为空：如果数据库中的 category 是 null 或空字符串，使用默认值 'NA'
          let category = img.category;
          if (!category || (typeof category === 'string' && category.trim() === '')) {
            category = 'NA';
            // 只在第一次发现时记录警告，避免重复日志
            if (!this._missingCategoryLogged) {
              logger.warn(`⚠️ 发现图片缺少分类信息，使用默认值 'NA'`, {
                id: img.id,
                fileName: img.fileName,
                suggestion: '这些图片可能是旧数据，建议重新扫描'
              });
              this._missingCategoryLogged = true;
            }
          }
        
        return {
          id: img.id,
          timestamp: img.timestamp,
          takenAt: img.takenAt,
          category: category,
          city: img.city || img.location?.city,
          country: img.country || img.location?.country,
          fileName: img.fileName,
          uri: img.uri,
          size: img.size,
          background_color: img.background_color || null, // 背景颜色字段
          message: img.message || null, // 🤖 AI 描述（VLM 多模态档生成）——必须带上，否则详情页缓存里没有、不显示
          mimeType: img.mimeType || null, // 格式统计需要
          imageDimensions: img.imageDimensions || null, // 保留原始 imageDimensions 字段
          // 🔥 GPS坐标字段（用于位置信息补全）
          latitude: img.latitude || null,
          longitude: img.longitude || null,
          // 🔥 拍摄参数分类字段（用于统计和筛选）
          isoCategory: img.isoCategory || null,
          apertureCategory: img.apertureCategory || null,
          shutterCategory: img.shutterCategory || null,
          focalLengthCategory: img.focalLengthCategory || null,
          cameraSettings: img.cameraSettings || null, // 保留原始 cameraSettings 字段
          // 只保留界面显示必需字段，其他按需加载
        };
      });
      
      return simplifiedImages;
      
    } catch (error) {
      logger.error('Failed to get images:', error);
      return [];
    }
  }

  /**
   * 查询从指定时间点之后有更新的图片
   * @param {string|Date} sinceTimestamp - ISO 8601格式的时间字符串或Date对象
   * @returns {Promise<Array>} 图片列表（完整信息，包含 createdAt 和 updatedAt）
   */
  async getImagesUpdatedAfter(sinceTimestamp) {
    try {
      await this.ensureInitialized();
      
      // 转换为ISO 8601格式字符串
      let sinceTimeStr;
      if (sinceTimestamp instanceof Date) {
        sinceTimeStr = sinceTimestamp.toISOString();
      } else if (typeof sinceTimestamp === 'string') {
        sinceTimeStr = sinceTimestamp;
      } else {
        throw new Error('sinceTimestamp 必须是 Date 对象或 ISO 8601 字符串');
      }
      
      if (Platform.OS === 'web') {
        // PC端：IndexedDB
        return await this._getImagesUpdatedAfterIndexedDB(sinceTimeStr);
      } else {
        // 移动端：SQLite
        return await this._getImagesUpdatedAfterSQLite(sinceTimeStr);
      }
      
    } catch (error) {
      logger.error('查询最近更新的图片失败:', error);
      return [];
    }
  }

  // 移动端：SQLite查询
  async _getImagesUpdatedAfterSQLite(sinceTimeStr) {
    try {
      // 确保数据库已初始化
      await this.ensureInitialized();
      
      // 检查数据库对象
      if (!this.storage || !this.storage.db) {
        logger.error('❌ SQLite数据库对象为空');
        return [];
      }
      
      if (!this.storage.db.executeSql) {
        logger.error('❌ SQLite数据库executeSql方法不存在');
        return [];
      }
      
      // 使用SQL查询：updatedAt > sinceTimeStr
      const sql = `SELECT * FROM images WHERE updatedAt > ? ORDER BY updatedAt DESC`;
      const [result] = await this.storage.db.executeSql(sql, [sinceTimeStr]);
      
      if (!result || !result.rows) {
        return [];
      }
      
      const images = [];
      for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows.item(i);
        // 解析JSON字段
        const img = {
          id: row.id,
          uri: row.uri,
          fileName: row.fileName,
          category: row.category,
          confidence: row.confidence,
          timestamp: row.timestamp,
          takenAt: row.takenAt,
          size: row.size,
          mimeType: row.mimeType,
          duration: row.duration || 0,
          width: row.width,
          height: row.height,
          isoCategory: row.isoCategory,
          apertureCategory: row.apertureCategory,
          shutterCategory: row.shutterCategory,
          focalLengthCategory: row.focalLengthCategory,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          latitude: row.latitude,
          longitude: row.longitude,
          altitude: row.altitude,
          accuracy: row.accuracy,
          address: row.address,
          city: row.city,
          country: row.country,
          province: row.province,
          district: row.district,
          street: row.street,
          locationSource: row.locationSource,
          cityDistance: row.cityDistance,
          message: row.message,
          // 解析JSON字段
          idCardDetections: row.idCardDetections ? JSON.parse(row.idCardDetections) : null,
          generalDetections: row.generalDetections ? JSON.parse(row.generalDetections) : null,
          mobileNetV3Detections: row.mobileNetV3Detections ? JSON.parse(row.mobileNetV3Detections) : null,
          imageDimensions: row.imageDimensions ? JSON.parse(row.imageDimensions) : null
        };
        images.push(img);
      }
      
      logger.debug(`📥 SQLite查询最近更新的图片: 找到 ${images.length} 张（since: ${sinceTimeStr}）`);
      return images;
      
    } catch (error) {
      logger.error('SQLite查询最近更新的图片失败:', error);
      return [];
    }
  }

  // PC端：IndexedDB查询
  async _getImagesUpdatedAfterIndexedDB(sinceTimeStr) {
    try {
      if (!this.storage || !this.storage.db) {
        logger.error('❌ IndexedDB数据库对象为空');
        return [];
      }
      
      return new Promise((resolve, reject) => {
        const transaction = this.storage.db.transaction(['images'], 'readonly');
        const store = transaction.objectStore('images');
        const images = [];
        
        // IndexedDB 没有 updatedAt 索引，需要遍历所有图片
        const request = store.openCursor();
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const img = cursor.value;
            // 比较 updatedAt 字符串（ISO 8601格式可以直接字符串比较）
            if (img.updatedAt && img.updatedAt > sinceTimeStr) {
              images.push(img);
            }
            cursor.continue();
          } else {
            // 按 updatedAt DESC 排序
            images.sort((a, b) => {
              const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
              const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
              return timeB - timeA;
            });
            logger.debug(`📥 IndexedDB查询最近更新的图片: 找到 ${images.length} 张（since: ${sinceTimeStr}）`);
            resolve(images);
          }
        };
        
        request.onerror = () => {
          logger.error('IndexedDB查询最近更新的图片失败:', request.error);
          reject(request.error);
        };
      });
      
    } catch (error) {
      logger.error('IndexedDB查询最近更新的图片失败:', error);
      return [];
    }
  }

  /**
   * 查询从指定时间点之后文件时间更新的图片（基于 timestamp）
   * @param {string|Date} sinceTimestamp - ISO 8601格式的时间字符串或Date对象
   * @returns {Promise<Array>} 图片列表（完整信息）
   */
  async getImagesByTimestampAfter(sinceTimestamp) {
    try {
      await this.ensureInitialized();
      
      // 转换为ISO 8601格式字符串或时间戳
      let sinceTimeStr;
      let sinceTimeNum;
      if (sinceTimestamp instanceof Date) {
        sinceTimeStr = sinceTimestamp.toISOString();
        sinceTimeNum = sinceTimestamp.getTime();
      } else if (typeof sinceTimestamp === 'string') {
        sinceTimeStr = sinceTimestamp;
        sinceTimeNum = new Date(sinceTimestamp).getTime();
      } else {
        throw new Error('sinceTimestamp 必须是 Date 对象或 ISO 8601 字符串');
      }
      
      if (Platform.OS === 'web') {
        // PC端：IndexedDB
        return await this._getImagesByTimestampAfterIndexedDB(sinceTimeStr, sinceTimeNum);
      } else {
        // 移动端：SQLite（传入时间戳数字，因为 timestamp 字段是 INTEGER 类型）
        return await this._getImagesByTimestampAfterSQLite(sinceTimeNum);
      }
      
    } catch (error) {
      logger.error('查询最近文件时间更新的图片失败:', error);
      return [];
    }
  }

  // 移动端：SQLite查询（基于 timestamp）
  // @param {number} sinceTimeNum - 时间戳数字（毫秒），因为 timestamp 字段是 INTEGER 类型
  async _getImagesByTimestampAfterSQLite(sinceTimeNum) {
    try {
      await this.ensureInitialized();
      
      if (!this.storage || !this.storage.db) {
        logger.error('❌ SQLite数据库对象为空');
        return [];
      }
      
      if (!this.storage.db.executeSql) {
        logger.error('❌ SQLite数据库executeSql方法不存在');
        return [];
      }
      
      // 🔥 使用文件时间（timestamp）查询，timestamp 字段是 INTEGER 类型，需要传入数字
      const sql = `SELECT * FROM images WHERE timestamp > ? ORDER BY timestamp DESC`;
      const [result] = await this.storage.db.executeSql(sql, [sinceTimeNum]);
      
      if (!result || !result.rows) {
        return [];
      }
      
      const images = [];
      for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows.item(i);
        const img = {
          id: row.id,
          uri: row.uri,
          fileName: row.fileName,
          category: row.category,
          confidence: row.confidence,
          timestamp: row.timestamp,
          takenAt: row.takenAt,
          size: row.size,
          mimeType: row.mimeType,
          duration: row.duration || 0,
          width: row.width,
          height: row.height,
          isoCategory: row.isoCategory,
          apertureCategory: row.apertureCategory,
          shutterCategory: row.shutterCategory,
          focalLengthCategory: row.focalLengthCategory,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          latitude: row.latitude,
          longitude: row.longitude,
          altitude: row.altitude,
          accuracy: row.accuracy,
          address: row.address,
          city: row.city,
          country: row.country,
          province: row.province,
          district: row.district,
          street: row.street,
          locationSource: row.locationSource,
          cityDistance: row.cityDistance,
          message: row.message,
          idCardDetections: row.idCardDetections ? JSON.parse(row.idCardDetections) : null,
          generalDetections: row.generalDetections ? JSON.parse(row.generalDetections) : null,
          mobileNetV3Detections: row.mobileNetV3Detections ? JSON.parse(row.mobileNetV3Detections) : null,
          imageDimensions: row.imageDimensions ? JSON.parse(row.imageDimensions) : null
        };
        images.push(img);
      }
      
      logger.debug(`📥 SQLite查询最近文件时间更新的图片: 找到 ${images.length} 张（since: ${new Date(sinceTimeNum).toISOString()}，时间戳: ${sinceTimeNum}）`);
      return images;
      
    } catch (error) {
      logger.error('SQLite查询最近文件时间更新的图片失败:', error);
      return [];
    }
  }

  // PC端：IndexedDB查询（基于 timestamp）
  async _getImagesByTimestampAfterIndexedDB(sinceTimeStr, sinceTimeNum) {
    try {
      if (!this.storage || !this.storage.db) {
        logger.error('❌ IndexedDB数据库对象为空');
        return [];
      }
      
      return new Promise((resolve, reject) => {
        const transaction = this.storage.db.transaction(['images'], 'readonly');
        const store = transaction.objectStore('images');
        const images = [];
        
        // IndexedDB 没有 timestamp 索引，需要遍历所有图片
        const request = store.openCursor();
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const img = cursor.value;
            // 🔥 使用文件时间（timestamp）比较
            if (img.timestamp) {
              const imgTime = typeof img.timestamp === 'string' ? new Date(img.timestamp).getTime() : img.timestamp;
              if (imgTime > sinceTimeNum) {
                images.push(img);
              }
            }
            cursor.continue();
          } else {
            // 按 timestamp DESC 排序
            images.sort((a, b) => {
              const timeA = a.timestamp ? (typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp) : 0;
              const timeB = b.timestamp ? (typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp) : 0;
              return timeB - timeA;
            });
            logger.debug(`📥 IndexedDB查询最近文件时间更新的图片: 找到 ${images.length} 张（since: ${sinceTimeStr}）`);
            resolve(images);
          }
        };
        
        request.onerror = () => {
          logger.error('IndexedDB查询最近文件时间更新的图片失败:', request.error);
          reject(request.error);
        };
      });
      
    } catch (error) {
      logger.error('IndexedDB查询最近文件时间更新的图片失败:', error);
      return [];
    }
  }

  /**
   * 批量获取图片详细信息（按ID列表）
   * @param {Array<string>} imageIds - 图片ID数组
   * @returns {Promise<Map<string, Object>>} ID到图片对象的映射
   */
  async getImagesByIds(imageIds) {
    try {
      await this.ensureInitialized();
      
      if (Platform.OS === 'web') {
        // PC端：IndexedDB - 使用原生查询优化
        return await this._getImagesByIdsIndexedDB(imageIds);
      } else {
        // 移动端：SQLite - 使用SQL查询优化
        return await this._getImagesByIdsSQLite(imageIds);
      }
      
    } catch (error) {
      logger.error('批量获取图片失败:', error);
      return new Map();
    }
  }

  // PC端：IndexedDB优化查询
  async _getImagesByIdsIndexedDB(imageIds) {
    try {
      // 确保数据库已初始化
      await this.ensureInitialized();
      
      // 检查数据库对象
      if (!this.storage || !this.storage.db) {
        logger.error('❌ IndexedDB数据库对象为空');
        return new Map();
      }
      
      // 创建ID集合，提高查找效率
      const idSet = new Set(imageIds);
      
      return new Promise((resolve, reject) => {
        const transaction = this.storage.db.transaction(['images'], 'readonly');
        const store = transaction.objectStore('images');
        const resultMap = new Map();
        
        // 使用游标遍历，比getAll()更高效
        const request = store.openCursor();
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const img = cursor.value;
            if (idSet.has(img.id)) {
              resultMap.set(img.id, img);
            }
            cursor.continue();
          } else {
            // 游标遍历完成
            logger.debug(`📥 IndexedDB批量查询: 请求${imageIds.length}张, 找到${resultMap.size}张`);
            resolve(resultMap);
          }
        };
        
        request.onerror = () => {
          logger.error('IndexedDB游标查询失败:', request.error);
          reject(request.error);
        };
      });
      
    } catch (error) {
      logger.error('IndexedDB批量查询失败:', error);
      return new Map();
    }
  }

  // 移动端：SQLite优化查询
  async _getImagesByIdsSQLite(imageIds) {
    try {
      if (!imageIds || imageIds.length === 0) {
        return new Map();
      }
      
      // 确保数据库已初始化
      await this.ensureInitialized();
      
      // 检查数据库对象
      if (!this.storage || !this.storage.db) {
        logger.error('❌ SQLite数据库对象为空');
        return new Map();
      }
      
      if (!this.storage.db.executeSql) {
        logger.error('❌ SQLite数据库executeSql方法不存在');
        return new Map();
      }
      
      // 使用SQL IN查询，利用主键索引
      const placeholders = imageIds.map(() => '?').join(',');
      const sql = `SELECT * FROM images WHERE id IN (${placeholders})`;
      
      const [result] = await this.storage.db.executeSql(sql, imageIds);
      
      const resultMap = new Map();
      if (result && result.rows) {
        for (let i = 0; i < result.rows.length; i++) {
          const row = result.rows.item(i);
          // 解析JSON字段
          const img = {
            id: row.id,
            uri: row.uri,
            fileName: row.fileName,
            category: row.category,
            confidence: row.confidence,
            timestamp: row.timestamp,
            takenAt: row.takenAt,
            size: row.size,
            mimeType: row.mimeType,
            duration: row.duration || 0,
            width: row.width,
            height: row.height,
            isoCategory: row.isoCategory,
            apertureCategory: row.apertureCategory,
            shutterCategory: row.shutterCategory,
            focalLengthCategory: row.focalLengthCategory,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            latitude: row.latitude,
            longitude: row.longitude,
            altitude: row.altitude,
            accuracy: row.accuracy,
            address: row.address,
            city: row.city,
            country: row.country,
            province: row.province,
            district: row.district,
            street: row.street,
            locationSource: row.locationSource,
            cityDistance: row.cityDistance,
            idCardDetections: row.idCardDetections ? JSON.parse(row.idCardDetections) : null,
            generalDetections: row.generalDetections ? JSON.parse(row.generalDetections) : null,
            mobileNetV3Detections: row.mobileNetV3Detections ? JSON.parse(row.mobileNetV3Detections) : null,
            imageDimensions: row.imageDimensions ? JSON.parse(row.imageDimensions) : null,
            message: row.message
          };
          resultMap.set(img.id, img);
        }
      }
      
      logger.debug(`📥 SQLite批量查询: 请求${imageIds.length}张, 找到${resultMap.size}张`);
      return resultMap;
      
    } catch (error) {
      logger.error('SQLite批量查询失败:', error);
      return new Map();
    }
  }

  // Get image by ID (精简结构)
  async getImageById(imageId) {
    try {
      const allImages = await this.getImages();
      const image = allImages.find(img => img.id === imageId);
      return image || null;
    } catch (error) {
      logger.error('Failed to get image by ID:', error);
      return null;
    }
  }

  // Get full image details by ID (完整结构)
  async getImageDetailsById(imageId) {
    try {
      await this.ensureInitialized();
      
      const fullImages = await this.storage.getItem(this.storageKeys.images);
      if (!fullImages) {
        return null;
      }
      const image = fullImages.find(img => img.id === imageId);
      return image || null;
      
    } catch (error) {
      console.error('Failed to get image details by ID:', error);
      return null;
    }
  }

  // Get images by category (精简结构)
  async getImagesByCategory(category) {
    try {
      const allImages = await this.getImages();
      const filteredImages = allImages.filter(img => img.category === category);
      
      // 按拍摄时间排序（最新的在前）
      const sortedImages = filteredImages.sort((a, b) => {
        const timeA = a.takenAt ? new Date(a.takenAt).getTime() : new Date(a.timestamp).getTime();
        const timeB = b.takenAt ? new Date(b.takenAt).getTime() : new Date(b.timestamp).getTime();
        return timeB - timeA; // 降序，最新的在前
      });
      
      return sortedImages;
      
    } catch (error) {
      console.error('Failed to get images by category:', error);
      return [];
    }
  }

  // Get recent images (精简结构)
  async getRecentImages(limit = 20) {
    try {
      const allImages = await this.getImages();
      const recentImages = allImages
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
      
      return recentImages;
      
    } catch (error) {
      console.error('Failed to get recent images:', error);
      return [];
    }
  }

  // Get category counts
  async getCategoryCounts() {
    try {
      const allImages = await this.getImages();
      const counts = {};
      
      allImages.forEach(image => {
        if (!image.category) {
          console.error(`❌ 图片 ${image.id} 缺少分类信息:`, image);
          throw new Error(`图片 ${image.id} 缺少分类信息`);
        }
        const category = image.category;
        counts[category] = (counts[category] || 0) + 1;
      });
      
      return counts;
      
    } catch (error) {
      console.error('Failed to get category counts:', error);
      return {};
    }
  }


  /**
   * 生成UUID（通用唯一标识符）
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 初始化客户端唯一ID
   * 如果不存在则生成新ID，存在则不做任何操作
   */
  async initializeClientId() {
    try {
      const settings = await this.getSettings();
      
      // 如果没有客户端ID，生成一个新的
      if (!settings.clientId) {
        const clientId = this.generateUUID();
        settings.clientId = clientId;
        settings.clientIdCreatedAt = new Date().toISOString();
        
        // 初始化阶段跳过验证，允许未设置扫描目录
        await this.saveSettings(settings, true);
        
        logger.debug('🆔 客户端ID已生成:', clientId);
        logger.debug('🆔 新客户端ID:', clientId);
      } else {
        logger.debug('🆔 客户端ID已存在:', settings.clientId);
      }
      
      return settings.clientId;
    } catch (error) {
      logger.error('初始化客户端ID失败:', error);
      throw error;
    }
  }

  /**
   * 获取客户端唯一ID
   */
  async getClientId() {
    try {
      const settings = await this.getSettings();
      return settings.clientId || null;
    } catch (error) {
      logger.error('获取客户端ID失败:', error);
      return null;
    }
  }

  /**
   * 获取用户 Pictures 目录路径（PC端默认扫描目录）
   * @returns {string|null} 用户 Pictures 目录路径，如果无法获取则返回 null
   */
  getUserPicturesDirectory() {
    try {
      // 检查是否是 Electron 环境
      if (typeof window !== 'undefined' && window.require) {
        try {
          const os = window.require('os');
          const path = window.require('path');
          
          // 直接获取用户主目录下的 Pictures 目录
          const homeDir = os.homedir();
          const picturesDir = path.join(homeDir, 'Pictures');
          
          logger.debug(`📁 获取用户 Pictures 目录: ${picturesDir}`);
          return picturesDir;
        } catch (error) {
          logger.warn('⚠️ 无法获取用户 Pictures 目录:', error);
          return null;
        }
      }
      
      // 非 Electron 环境，返回 null
      return null;
    } catch (error) {
      logger.warn('⚠️ 获取用户 Pictures 目录失败:', error);
      return null;
    }
  }

  // Get settings
  async getSettings() {
    try {
      await this.ensureInitialized();
      const settingsData = await this.storage.getItem(this.storageKeys.settings);
      
      if (settingsData) {
        const parsed = settingsData;
        
        // 确保必要的设置项存在，但不要覆盖用户已有的配置
        const result = { ...parsed };
        
        // scanPaths 不再自动初始化，保持用户设置或 undefined/null
        // 如果用户明确设置了空数组，保持空数组（移动端扫描整个设备）
        if (result.scanPaths && result.scanPaths.length === 0 && Platform.OS !== 'web') {
          // 移动端空数组是有效的，表示扫描整个设备
          result.scanPaths = [];
        }
        
        // PC端：如果 scanPaths 完全未设置（undefined/null），尝试设置默认的用户 Pictures 目录
        // 如果用户已经设置了空数组，不覆盖（用户可能故意清空）
        if (Platform.OS === 'web' && (result.scanPaths === undefined || result.scanPaths === null)) {
          const defaultPicturesDir = this.getUserPicturesDirectory();
          if (defaultPicturesDir) {
            result.scanPaths = [defaultPicturesDir];
            logger.debug(`📁 PC端设置默认扫描目录: ${defaultPicturesDir}`);
          }
        }
        // 默认隐藏空分类（true），只有用户主动设置为显示空分类时才是 false
        // 注意：只有当值完全未定义时才设置默认值，不要覆盖用户已保存的 false 值
        if (result.hideEmptyCategories === undefined || result.hideEmptyCategories === null) {
          result.hideEmptyCategories = true;
        }
        // 确保 hideEmptyCategories 是布尔值（防止字符串等其他类型）
        if (typeof result.hideEmptyCategories !== 'boolean') {
          result.hideEmptyCategories = result.hideEmptyCategories === 'false' ? false : true;
        }
        if (result.scanInterval === undefined || result.scanInterval === null) {
          result.scanInterval = 5;
        }
        
        // 🆕 初始化语言设置（如果不存在）
        if (result.app_language === undefined || result.app_language === null) {
          result.app_language = 'zh'; // 默认中文
        }
        // 确保语言值有效
        if (result.app_language !== 'zh' && result.app_language !== 'en') {
          result.app_language = 'zh';
        }
        
        // 🆕 获取当前语言并定义默认 AI 增强预设方案（支持多语言）
        const currentLang = result.app_language;
        const defaultAiEnhancePresets = getDefaultPresets(currentLang);
        
        // 初始化或合并 AI 增强预设方案
        if (!result.aiEnhancePresets) {
          result.aiEnhancePresets = defaultAiEnhancePresets;
          logger.debug('✅ 已初始化 AI 增强预设方案（首次使用）');
        } else {
          // 合并默认预设与用户配置，补充缺失的新预设
          // 对于已存在的预设，保留用户的 name 和 description（如果用户修改过）
          // 对于新添加的预设，使用默认值
          const mergedPresets = { ...defaultAiEnhancePresets };
          let hasNewPresets = false; // 标记是否有新预设被添加
          
          for (const [presetId, userPreset] of Object.entries(result.aiEnhancePresets)) {
            if (mergedPresets[presetId]) {
              // 🔥 检查并修复翻译 key：如果 name 或 description 是翻译 key（以 settings. 开头），使用默认预设的值
              const isTranslationKey = (value) => {
                return typeof value === 'string' && value.startsWith('settings.');
              };
              
              const fixedName = (userPreset.name && !isTranslationKey(userPreset.name)) 
                ? userPreset.name 
                : mergedPresets[presetId].name;
              
              const fixedDescription = (userPreset.description && !isTranslationKey(userPreset.description)) 
                ? userPreset.description 
                : mergedPresets[presetId].description;
              
              // 🔥 同样修复 prompt 字段的翻译 key
              const fixedPrompt = (userPreset.prompt !== undefined && !isTranslationKey(userPreset.prompt)) 
                ? userPreset.prompt 
                : mergedPresets[presetId].prompt;
              
              // 保留用户的修改（name, description, prompt, enabled），但修复翻译 key
              mergedPresets[presetId] = {
                ...mergedPresets[presetId],
                name: fixedName,
                description: fixedDescription,
                prompt: fixedPrompt,
                enabled: userPreset.enabled !== undefined ? userPreset.enabled : mergedPresets[presetId].enabled,
                sortOrder: userPreset.sortOrder !== undefined ? userPreset.sortOrder : mergedPresets[presetId].sortOrder
              };
            } else {
              // 用户自定义的新预设，保留
              mergedPresets[presetId] = userPreset;
            }
          }
          
          // 检查是否有新预设被添加到默认预设中（用户配置中没有的）
          for (const presetId of Object.keys(defaultAiEnhancePresets)) {
            if (!result.aiEnhancePresets[presetId]) {
              hasNewPresets = true;
              break;
            }
          }
          
          // 只在有新预设被添加时才输出日志，避免频繁输出
          if (hasNewPresets) {
            logger.debug('✅ 已合并 AI 增强预设方案（包含新预设）');
          }
          
          // 🔥 检查是否有翻译 key 被修复，如果有则保存修复后的数据
          let hasFixedTranslationKeys = false;
          for (const [presetId, mergedPreset] of Object.entries(mergedPresets)) {
            const userPreset = result.aiEnhancePresets[presetId];
            if (userPreset) {
              const isTranslationKey = (value) => {
                return typeof value === 'string' && value.startsWith('settings.');
              };
              if (isTranslationKey(userPreset.name) || isTranslationKey(userPreset.description) || isTranslationKey(userPreset.prompt)) {
                hasFixedTranslationKeys = true;
                break;
              }
            }
          }
          
          result.aiEnhancePresets = mergedPresets;
          
          // 如果有翻译 key 被修复，自动保存修复后的设置
          if (hasFixedTranslationKeys) {
            logger.debug('🔧 检测到翻译 key，已自动修复并保存');
            try {
              // 自动保存修复后的设置，避免下次加载时再次显示翻译 key
              await this.saveSettings(result, true); // 第二个参数表示跳过验证
            } catch (error) {
              logger.warn('⚠️ 自动保存修复后的设置失败:', error);
            }
          }
        }
        
        // 🆕 初始化默认预设
        if (!result.aiEnhanceDefaultPreset) {
          result.aiEnhanceDefaultPreset = 'portrait';
        }
        
        // 🆕 初始化最近使用的提示词
        if (!result.aiEnhanceRecentPrompts) {
          result.aiEnhanceRecentPrompts = [];
        }
        
        return result;
      }
      
      // 如果没有设置数据，返回默认设置
      // PC端：尝试获取用户 Pictures 目录作为默认扫描目录
      let defaultScanPaths = Platform.OS === 'web' ? undefined : [];
      if (Platform.OS === 'web') {
        const defaultPicturesDir = this.getUserPicturesDirectory();
        if (defaultPicturesDir) {
          defaultScanPaths = [defaultPicturesDir];
          logger.debug(`📁 PC端默认扫描目录: ${defaultPicturesDir}`);
        }
      }
      
      const defaultSettings = {
        // PC端：尝试设置用户 Pictures 目录，如果无法获取则为 undefined
        // 移动端：scanPaths 可以是空数组（表示扫描整个设备）
        scanPaths: defaultScanPaths,
        hideEmptyCategories: false,
        scanInterval: 5, // 默认5分钟扫描间隔
        
        // 🆕 语言设置（默认中文）
        app_language: 'zh',
        
        // 🆕 AI 增强预设方案
        aiEnhancePresets: {
          portrait: {
            name: '人像美颜',
            icon: '👤',
            prompt: '修复面部瑕疵和皱纹，提亮肤色，保持人物原貌不变',
            description: '适合人物照片',
            enabled: true,
            sortOrder: 1
          },
          enhance: {
            name: '清晰增强',
            icon: '✨',
            prompt: '增强图像清晰度，去除模糊，锐化细节，提升整体质量',
            description: '适合模糊照片',
            enabled: true,
            sortOrder: 2
          },
          color: {
            name: '色彩优化',
            icon: '🎨',
            prompt: '优化色彩饱和度和对比度，使图片更加鲜艳生动',
            description: '适合偏暗照片',
            enabled: true,
            sortOrder: 3
          },
          custom: {
            name: '自定义',
            icon: '⚙️',
            prompt: '',
            description: '自定义编辑需求',
            enabled: true,
            sortOrder: 4
          }
        },
        aiEnhanceDefaultPreset: 'portrait',
        aiEnhanceRecentPrompts: []
      };
      
      logger.debug('✅ 返回默认设置（包含 AI 增强预设方案）');
      return defaultSettings;
      
    } catch (error) {
      console.error('Failed to get settings:', error);
      // 错误情况下也返回默认设置
      // PC端：尝试获取用户 Pictures 目录作为默认扫描目录
      let defaultScanPaths = Platform.OS === 'web' ? undefined : [];
      if (Platform.OS === 'web') {
        try {
          const defaultPicturesDir = this.getUserPicturesDirectory();
          if (defaultPicturesDir) {
            defaultScanPaths = [defaultPicturesDir];
          }
        } catch (dirError) {
          logger.warn('⚠️ 获取默认 Pictures 目录失败:', dirError);
        }
      }
      
      return {
        // PC端：尝试设置用户 Pictures 目录，如果无法获取则为 undefined
        // 移动端：scanPaths 可以是空数组（表示扫描整个设备）
        scanPaths: defaultScanPaths,
        hideEmptyCategories: false,
        scanInterval: 5,
        
        // 🆕 语言设置（默认中文）
        app_language: 'zh',
        
        // 🆕 AI 增强预设方案
        aiEnhancePresets: {
          portrait: {
            name: '人像美颜',
            icon: '👤',
            prompt: '修复面部瑕疵和皱纹，提亮肤色，保持人物原貌不变',
            description: '适合人物照片',
            enabled: true,
            sortOrder: 1
          },
          enhance: {
            name: '清晰增强',
            icon: '✨',
            prompt: '增强图像清晰度，去除模糊，锐化细节，提升整体质量',
            description: '适合模糊照片',
            enabled: true,
            sortOrder: 2
          },
          color: {
            name: '色彩优化',
            icon: '🎨',
            prompt: '优化色彩饱和度和对比度，使图片更加鲜艳生动',
            description: '适合偏暗照片',
            enabled: true,
            sortOrder: 3
          },
          custom: {
            name: '自定义',
            icon: '⚙️',
            prompt: '',
            description: '自定义编辑需求',
            enabled: true,
            sortOrder: 4
          }
        },
        aiEnhanceDefaultPreset: 'portrait',
        aiEnhanceRecentPrompts: []
      };
    }
  }

  // Save settings
  async saveSettings(settings, skipValidation = false) {
    try {
      await this.ensureInitialized();
      
      // 根据平台进行不同的验证（初始化阶段可以跳过验证）
      if (!skipValidation) {
        if (Platform.OS === 'web') {
          // PC端：如果用户设置了 scanPaths，必须至少有一个目录
          // 如果 scanPaths 是 undefined/null，表示未设置，允许（用户稍后设置）
          // 如果 scanPaths 是空数组，不允许（用户必须设置至少一个目录）
          if (settings.scanPaths !== undefined && settings.scanPaths !== null && settings.scanPaths.length === 0) {
            throw new Error('PC端必须至少设置一个扫描目录。');
          }
        } else {
          // 移动端：允许空数组，表示扫描整个设备（使用MediaStore）
          // 空数组是有效的，表示使用MediaStore扫描整个设备
        }
      }
      
      await this.storage.setItem(this.storageKeys.settings, settings);
      
      logger.debug('Settings saved:', settings);
      
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error; // 重新抛出错误，让调用者处理
    }
  }

  // Clear all images
  async clearAllImages() {
    try {
      await this.ensureInitialized();
      
      // 清空 IndexedDB
      await this.storage.removeItem(this.storageKeys.images);
      await this.storage.removeItem(this.storageKeys.stats);
      // 清空相似度数据
      await this.storage.removeItem(this.storageKeys.similarityData);
      await this.storage.removeItem(this.storageKeys.similarityGroupIndex);
      // 清空暂存箱
      await this.storage.removeItem(this.storageKeys.stagingBox);
      logger.debug(' IndexedDB 数据已清空');
      
      // 同时清空 localStorage（防止数据重新迁移）
      if (Platform.OS === 'web' && this.fallbackStorage) {
        await this.fallbackStorage.removeItem('classified_images');
        await this.fallbackStorage.removeItem('image_stats');
        await this.fallbackStorage.removeItem('app_settings');
        logger.debug(' localStorage 数据已清空');
      }
      
      logger.debug(' 所有存储数据已清空（包括相似度数据和暂存箱）');
    } catch (error) {
      console.error('Failed to clear all images:', error);
      throw error;
    }
  }








  // 批量从相似组中移除图片（优化版本）
  async batchRemoveFromSimilarityGroups(imageIds) {
    try {
      await this.ensureInitialized();
      
      if (!imageIds || imageIds.length === 0) {
        return;
      }
      
      // 一次性获取相似度数据和组索引
      const similarityData = await this.getSimilarityData();
      const groupIndex = await this.getSimilarityGroupIndex();
      
      // 按组ID分组要删除的图片
      const groupsToUpdate = new Map();
      const imagesToRemove = [];
      
      for (const imageId of imageIds) {
        const imageData = similarityData[imageId];
        if (imageData && imageData.similarity_group_id) {
          const groupId = imageData.similarity_group_id;
          if (!groupsToUpdate.has(groupId)) {
            groupsToUpdate.set(groupId, []);
          }
          groupsToUpdate.get(groupId).push(imageId);
          imagesToRemove.push(imageId);
        }
      }
      
      logger.debug(`🧹 批量清理: ${imagesToRemove.length}张图片，涉及${groupsToUpdate.size}个相似组`);
      
      // 批量更新每个相似组
      for (const [groupId, imageIdsInGroup] of groupsToUpdate) {
        const currentGroupImages = groupIndex[groupId] || [];
        const remainingImages = currentGroupImages.filter(id => !imageIdsInGroup.includes(id));
        
        if (remainingImages.length <= 1) {
          // 如果删除后只剩0或1张图片，删除整个组
          if (remainingImages.length === 1) {
            // 如果组只剩1张图片，需要清除该图片的相似组信息
            const remainingImageId = remainingImages[0];
            if (similarityData[remainingImageId]) {
              delete similarityData[remainingImageId].similarity_group_id;
              delete similarityData[remainingImageId].similarity_group_type;
              delete similarityData[remainingImageId].similarity_score;
              logger.debug(`✅ 清除单图片组，移除图片 ${remainingImageId} 的相似组信息`);
            }
          }
          // 删除该组
          delete groupIndex[groupId];
          logger.debug(`🧹 删除相似组: ${groupId} (剩余${remainingImages.length}张)`);
        } else {
          // 更新组索引
          groupIndex[groupId] = remainingImages;
          logger.debug(`🧹 更新相似组: ${groupId} (${currentGroupImages.length} -> ${remainingImages.length}张)`);
        }
      }
      
      // 批量删除相似度数据
      for (const imageId of imagesToRemove) {
        delete similarityData[imageId];
      }
      
      // 一次性保存更新后的数据
      await this.saveSimilarityData(similarityData);
      await this.saveSimilarityGroupIndex(groupIndex);
      
      logger.debug(`✅ 批量清理相似组完成: ${imagesToRemove.length}张图片`);
      
    } catch (error) {
      logger.error('批量清理相似组失败:', error);
      throw error;
    }
  }

  // Delete multiple images (只删除数据库记录，不删除物理文件)
  async deleteImages(imageIds) {
    try {
      await this.ensureInitialized();
      
      logger.debug(`🗑️ 批量删除数据库记录: ${imageIds.length} 张图片`);
      
      // 先删除暂存箱中的记录（在删除图片记录之前）
      try {
        await this.removeFromStagingBox(imageIds);
        logger.debug(`✅ 已从暂存箱移除 ${imageIds.length} 张图片的记录`);
      } catch (error) {
        logger.warn(`⚠️ 从暂存箱移除记录失败（继续删除图片记录）:`, error);
      }
      
      let filesDeleted = 0;
      let filesFailed = 0;
      
      for (let i = 0; i < imageIds.length; i++) {
        try {
          // 根据平台选择删除方法
          if (Platform.OS === 'web') {
            // PC端：使用IndexedDB事务删除
            if (!this.storage || !this.storage.db) {
              throw new Error('IndexedDB未初始化');
            }
            
            await new Promise((resolve, reject) => {
              const transaction = this.storage.db.transaction(['images'], 'readwrite');
              const store = transaction.objectStore('images');
              const request = store.delete(imageIds[i]);
              
              request.onsuccess = () => resolve();
              request.onerror = () => reject(new Error('IndexedDB删除失败'));
            });
          } else {
            // 移动端：使用SQLite删除
            // 注意：SQLite 有外键约束 ON DELETE CASCADE，应该会自动删除暂存箱记录
            // 但为了确保一致性，我们也显式删除（即使外键约束可能已经处理了）
            await this.storage.deleteImageById(imageIds[i]);
            
            // 显式删除暂存箱记录（即使有 CASCADE，也确保删除）
            try {
              await this.storage.db.executeSql(
                'DELETE FROM staging_box WHERE imageId = ?',
                [imageIds[i]]
              );
            } catch (stagingError) {
              // 如果记录不存在或已通过 CASCADE 删除，忽略错误
              logger.debug(`暂存箱记录删除（可能已通过CASCADE删除）: ${imageIds[i]}`);
            }
          }
          filesDeleted++;
          logger.debug(`🗑️ 数据库记录删除: ${i + 1}/${imageIds.length}: ${imageIds[i]}`);
        } catch (error) {
          filesFailed++;
          console.error(`❌ 数据库记录删除失败: ${imageIds[i]}:`, error);
        }
      }
      
      logger.debug(`✅ 数据库批量删除完成: ${filesDeleted} 成功, ${filesFailed} 失败`);
      
      // 统一更新统计信息（批量操作完成后）
      await this.updateStats();
      
      return {
        success: filesFailed === 0,
        filesDeleted,
        filesFailed,
        total: imageIds.length
      };
      
    } catch (error) {
      logger.error('批量删除数据库记录失败:', error);
      throw error;
    }
  }

  // Delete multiple images with progress callback


  // Update statistics
  async updateStats() {
    try {
      const allImages = await this.getImages();
      
      const stats = {
        totalImages: allImages.length,
        classified: 0, // 已分类照片数量
        byCategory: {},
        byDate: {},
        totalSize: 0,
        lastUpdated: new Date().toISOString(),
      };
      
      // Calculate statistics
      allImages.forEach(img => {
        // Count classified images (non-other category)
        if (img.category && img.category !== 'other') {
          stats.classified++;
        }
        
        // By category
        if (!stats.byCategory[img.category]) {
          stats.byCategory[img.category] = 0;
        }
        stats.byCategory[img.category]++;
        
        // By date
        const date = new Date(img.timestamp).toDateString();
        if (!stats.byDate[date]) {
          stats.byDate[date] = 0;
        }
        stats.byDate[date]++;
        
        // Total size
        stats.totalSize += img.size || 0;
      });
      
      // Calculate average size
      stats.averageSize = stats.totalImages > 0 ? stats.totalSize / stats.totalImages : 0;
      
      // Save statistics
      await this.storage.setItem(this.storageKeys.stats, stats);
      
      return stats;
      
    } catch (error) {
      console.error('Failed to update statistics:', error);
      throw error;
    }
  }

  // Get statistics
  async getStats() {
    try {
      const stats = await this.storage.getItem(this.storageKeys.stats);
      if (!stats) {
        return await this.updateStats();
      }
      return stats;
      
    } catch (error) {
      console.error('Failed to get statistics:', error);
      return await this.updateStats();
    }
  }

  // Clear all data
  async clearAllData() {
    try {
      await this.ensureInitialized();
      
      logger.debug('Clearing all image data...');
      
      // Clear images
      await this.storage.removeItem(this.storageKeys.images);
      
      // Clear statistics
      await this.storage.removeItem(this.storageKeys.stats);
      
      // Clear settings
      await this.storage.removeItem(this.storageKeys.settings);
      
      logger.debug('All data cleared successfully');
      return true;
      
    } catch (error) {
      console.error('Failed to clear data:', error);
      throw error;
    }
  }

  // Export data
  async exportData() {
    try {
      const images = await this.getImages();
      const stats = await this.getStats();
      
      const exportData = {
        images,
        stats,
        exportDate: new Date().toISOString(),
        version: '1.1.4',
      };
      
      logger.debug(`Exported ${images.length} images and statistics`);
      return exportData;
      
    } catch (error) {
      console.error('Failed to export data:', error);
      throw error;
    }
  }

  // Import data
  async importData(importData) {
    try {
      await this.ensureInitialized();
      
      if (!importData || !importData.images) {
        throw new Error('Invalid import data');
      }
      
      logger.debug(`Importing ${importData.images.length} images...`);
      
      // Save images
      await this.storage.setItem(this.storageKeys.images, importData.images);
      
      // Save statistics if available
      if (importData.stats) {
        await this.storage.setItem(this.storageKeys.stats, importData.stats);
      } else {
        // Update statistics
        await this.updateStats();
      }
      
      logger.debug('Data imported successfully');
      return true;
      
    } catch (error) {
      console.error('Failed to import data:', error);
      throw error;
    }
  }

  // Search images (精简结构)
  async searchImages(query) {
    try {
      const allImages = await this.getImages();
      
      if (!query || query.trim() === '') {
        return allImages;
      }
      
      const searchTerm = query.toLowerCase();
      const filteredImages = allImages.filter(img => 
        img.fileName.toLowerCase().includes(searchTerm) ||
        img.category.toLowerCase().includes(searchTerm) ||
        (img.city && img.city.toLowerCase().includes(searchTerm)) ||
        (img.country && img.country.toLowerCase().includes(searchTerm))
      );
      
      logger.debug(`Found ${filteredImages.length} images matching: ${query}`);
      return filteredImages;
      
    } catch (error) {
      console.error('Failed to search images:', error);
      return [];
    }
  }

  // Get images by date range
  async getImagesByDateRange(startDate, endDate) {
    try {
      const allImages = await this.getImages();
      
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime();
      
      const filteredImages = allImages.filter(img => {
        const imgDate = new Date(img.timestamp).getTime();
        return imgDate >= start && imgDate <= end;
      });
      
      logger.debug(`Found ${filteredImages.length} images in date range: ${startDate} to ${endDate}`);
      return filteredImages;
      
    } catch (error) {
      console.error('Failed to get images by date range:', error);
      return [];
    }
  }

  // Get images by location (精简结构)
  async getImagesByLocation(city, country) {
    try {
      const allImages = await this.getImages();
      
      let filteredImages = allImages;
      
      if (city) {
        filteredImages = filteredImages.filter(img => 
          img.city && img.city.toLowerCase().includes(city.toLowerCase())
        );
      }
      
      if (country) {
        filteredImages = filteredImages.filter(img => 
          img.country && img.country.toLowerCase().includes(country.toLowerCase())
        );
      }
      
      // 按拍摄时间排序（最新的在前）
      const sortedImages = filteredImages.sort((a, b) => {
        const timeA = a.takenAt ? new Date(a.takenAt).getTime() : new Date(a.timestamp).getTime();
        const timeB = b.takenAt ? new Date(b.takenAt).getTime() : new Date(b.timestamp).getTime();
        return timeB - timeA; // 降序，最新的在前
      });
      
      logger.debug(`Found ${sortedImages.length} images in location: ${city || 'any'}, ${country || 'any'}`);
      return sortedImages;
      
    } catch (error) {
      console.error('Failed to get images by location:', error);
      return [];
    }
  }

  // Get duplicate images
  async getDuplicateImages() {
    try {
      const allImages = await this.getImages();
      const duplicates = [];
      const seen = new Map();
      
      allImages.forEach(img => {
        const key = `${img.fileName}_${img.size}`;
        if (seen.has(key)) {
          duplicates.push({
            original: seen.get(key),
            duplicate: img,
          });
        } else {
          seen.set(key, img);
        }
      });
      
      logger.debug(`Found ${duplicates.length} duplicate image pairs`);
      return duplicates;
      
    } catch (error) {
      console.error('Failed to get duplicate images:', error);
      return [];
    }
  }

  // Get storage usage
  async getStorageUsage() {
    try {
      const allImages = await this.getImages();
      
      const usage = {
        totalImages: allImages.length,
        totalSize: 0,
        averageSize: 0,
        byCategory: {},
        byMonth: {},
      };
      
      allImages.forEach(img => {
        usage.totalSize += img.size || 0;
        
        // By category
        if (!usage.byCategory[img.category]) {
          usage.byCategory[img.category] = { count: 0, size: 0 };
        }
        usage.byCategory[img.category].count++;
        usage.byCategory[img.category].size += img.size || 0;
        
        // By month
        const month = new Date(img.timestamp).toISOString().substring(0, 7);
        if (!usage.byMonth[month]) {
          usage.byMonth[month] = { count: 0, size: 0 };
        }
        usage.byMonth[month].count++;
        usage.byMonth[month].size += img.size || 0;
      });
      
      usage.averageSize = usage.totalImages > 0 ? usage.totalSize / usage.totalImages : 0;
      
      logger.debug(`Storage usage calculated: ${usage.totalImages} images, ${(usage.totalSize / 1024 / 1024).toFixed(2)} MB`);
      return usage;
      
    } catch (error) {
      console.error('Failed to get storage usage:', error);
      return {
        totalImages: 0,
        totalSize: 0,
        averageSize: 0,
        byCategory: {},
        byMonth: {},
      };
    }
  }

  // 批量删除图片（根据URI列表）
  async removeImagesByUris(urisToRemove) {
    try {
      await this.ensureInitialized();
      
      if (!urisToRemove || urisToRemove.length === 0) {
        logger.debug('No images to remove');
        return { success: true, removedCount: 0 };
      }
      
      logger.debug(`Starting to remove ${urisToRemove.length} images by URIs...`);
      
      // 🆕 移动端：使用SQLite专用方法
      if (Platform.OS !== 'web' && this.storage.deleteImagesByUris) {
        // 先查询要删除的图片ID，用于清理暂存箱
        const allImages = await this.getImages();
        const urisSet = new Set(urisToRemove);
        const imagesToRemove = allImages.filter(img => urisSet.has(img.uri));
        const imageIdsToRemove = imagesToRemove.map(img => img.id);
        
        // 先删除暂存箱中的记录（在删除图片记录之前）
        if (imageIdsToRemove.length > 0) {
          try {
            await this.removeFromStagingBox(imageIdsToRemove);
            logger.debug(`✅ 已从暂存箱移除 ${imageIdsToRemove.length} 张图片的记录`);
          } catch (error) {
            logger.warn(`⚠️ 从暂存箱移除记录失败（继续删除图片记录）:`, error);
          }
        }
        
        const result = await this.storage.deleteImagesByUris(urisToRemove);
        
        // 更新统计信息
        await this.updateStats();
        
        logger.debug(`Successfully removed ${result.removedCount} images, ${result.failedCount} failed`);
        
        return {
          success: true,
          removedCount: result.removedCount,
          failedCount: result.failedCount,
          totalRequested: urisToRemove.length
        };
      }
      
      // PC端：使用IndexedDB事务
      if (!this.storage || !this.storage.db) {
        logger.error('❌ IndexedDB未初始化');
        throw new Error('IndexedDB未初始化');
      }
      
      const allImages = await this.getImages();
      const urisSet = new Set(urisToRemove);
      const imagesToRemove = allImages.filter(img => urisSet.has(img.uri));
      
      logger.debug(`Found ${imagesToRemove.length} images to remove out of ${allImages.length} total`);
      
      // 先删除暂存箱中的记录（在删除图片记录之前）
      if (imagesToRemove.length > 0) {
        try {
          const imageIdsToRemove = imagesToRemove.map(img => img.id);
          await this.removeFromStagingBox(imageIdsToRemove);
          logger.debug(`✅ 已从暂存箱移除 ${imageIdsToRemove.length} 张图片的记录`);
        } catch (error) {
          logger.warn(`⚠️ 从暂存箱移除记录失败（继续删除图片记录）:`, error);
        }
      }
      
      // 在一个事务中批量删除图片记录
      const result = await new Promise((resolve, reject) => {
        const transaction = this.storage.db.transaction(['images'], 'readwrite');
        const store = transaction.objectStore('images');
        
        let removedCount = 0;
        let failedCount = 0;
        let completedCount = 0;
        
        // 批量发起删除请求
        imagesToRemove.forEach((image) => {
          const deleteRequest = store.delete(image.id);
          
          deleteRequest.onsuccess = () => {
            logger.debug(`✅ 图片记录已删除: ${image.fileName}`);
            removedCount++;
            completedCount++;
            
            // 所有删除操作完成后 resolve
            if (completedCount === imagesToRemove.length) {
              resolve({ removedCount, failedCount });
            }
          };
          
          deleteRequest.onerror = () => {
            logger.error(`❌ 图片记录删除失败: ${deleteRequest.error}`);
            failedCount++;
            completedCount++;
            
            // 所有删除操作完成后 resolve
            if (completedCount === imagesToRemove.length) {
              resolve({ removedCount, failedCount });
            }
          };
        });
        
        // 如果没有要删除的图片
        if (imagesToRemove.length === 0) {
          resolve({ removedCount: 0, failedCount: 0 });
        }
        
        transaction.onerror = () => {
          reject(transaction.error);
        };
      });
      
      // 更新统计信息（在事务完成后）
      await this.updateStats();
      
      logger.debug(`Successfully removed ${result.removedCount} images, ${result.failedCount} failed`);
      
      return { 
        success: true, 
        removedCount: result.removedCount,
        failedCount: result.failedCount,
        totalRequested: urisToRemove.length
      };
      
    } catch (error) {
      console.error('Failed to remove images by URIs:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  // 获取所有图片的URI列表（优化性能）
  async getImageUris() {
    try {
      await this.ensureInitialized();
      
      const allImages = await this.getImages();
      return allImages.map(img => img.uri);
      
    } catch (error) {
      console.error('Failed to get image URIs:', error);
      return [];
    }
  }

  // 按日期分组图片（用于时间线显示）
  getGroupedImages(images) {
    logger.debug(`🔍 getGroupedImages 被调用，当前图片数量: ${images.length}`);
    const grouped = {};
    
    images.forEach(image => {
      // Prioritize taken time (takenAt), if not available use file time (timestamp)
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
      
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(image);
    });
    
    // Sort images within each date group by taken time
    // If no taken time, sort by file time
    Object.keys(grouped).forEach(dateKey => {
      grouped[dateKey].sort((a, b) => {
        const timeA = a.takenAt || a.timestamp || a.createdAt || a.modifiedAt || 0;
        const timeB = b.takenAt || b.timestamp || b.createdAt || b.modifiedAt || 0;
        return new Date(timeB) - new Date(timeA); // Latest first
      });
    });
    
    // Sort dates in descending order (latest date first)
    const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));
    
    return { grouped, sortedDates };
  }

  // 获取默认分类规则（带优先级）
  getDefaultClassificationRulesWithPriority() {
    // 从ConfigService获取配置
    const objectMappings = configService.getObjectMappings();
    const fullConfig = configService.getFullConfig();
    
    // 从配置文件生成分类优先级（基于categoryDisplayOrder）
    const categoryPriorities = {};
    if (fullConfig?.categoryDisplayOrder) {
      fullConfig.categoryDisplayOrder.forEach((category, index) => {
        categoryPriorities[category] = index + 1;
      });
    }
    
    return {
      // 分类优先级定义（从categoryDisplayOrder自动生成）
      categoryPriorities: categoryPriorities,
      
      // 物体到分类的映射（从配置文件读取）
      objectMappings: objectMappings
    };
  }

  // 获取默认分类规则（兼容旧版本）
  getDefaultClassificationRules() {
    const rulesWithPriority = this.getDefaultClassificationRulesWithPriority();
    return rulesWithPriority.objectMappings;
  }

  // 获取分类规则（带优先级）
  async getClassificationRulesWithPriority() {
    try {
      await this.ensureInitialized();
      const rulesData = await this.storage.getItem(this.storageKeys.classificationRules);
      
      if (!rulesData || !rulesData.categoryPriorities) {
        // 如果没有优先级数据，初始化默认规则
        const defaultRules = this.getDefaultClassificationRulesWithPriority();
        await this.saveClassificationRulesWithPriority(defaultRules);
        return defaultRules;
      }
      
      return rulesData;
    } catch (error) {
      console.error('获取分类规则失败:', error);
      // 出错时返回默认规则
      return this.getDefaultClassificationRulesWithPriority();
    }
  }

  // 获取分类规则（兼容旧版本）
  async getClassificationRules() {
    try {
      const rulesWithPriority = await this.getClassificationRulesWithPriority();
      return rulesWithPriority.objectMappings;
    } catch (error) {
      console.error('获取分类规则失败:', error);
      return this.getDefaultClassificationRules();
    }
  }

  // 保存分类规则（带优先级）
  async saveClassificationRulesWithPriority(rulesWithPriority) {
    try {
      await this.ensureInitialized();
      const rulesData = {
        key: 'classificationRules',
        ...rulesWithPriority,
        updatedAt: new Date().toISOString()
      };
      await this.storage.setItem(this.storageKeys.classificationRules, rulesData);
      logger.debug(' 分类规则（带优先级）保存成功');
      return true;
    } catch (error) {
      console.error('保存分类规则失败:', error);
      throw error;
    }
  }

  // 保存分类规则（兼容旧版本）
  async saveClassificationRules(rules) {
    try {
      // 将旧格式转换为新格式
      const rulesWithPriority = this.getDefaultClassificationRulesWithPriority();
      rulesWithPriority.objectMappings = rules;
      await this.saveClassificationRulesWithPriority(rulesWithPriority);
      return true;
    } catch (error) {
      console.error('保存分类规则失败:', error);
      throw error;
    }
  }

  // 重置分类规则为默认值
  async resetClassificationRules() {
    try {
      const defaultRules = this.getDefaultClassificationRules();
      await this.saveClassificationRules(defaultRules);
      logger.debug(' 分类规则已重置为默认值');
      return defaultRules;
    } catch (error) {
      console.error('重置分类规则失败:', error);
      throw error;
    }
  }

  // 更新单个分类规则
  async updateClassificationRule(objectClass, newCategory) {
    try {
      const rules = await this.getClassificationRules();
      rules[objectClass] = newCategory;
      await this.saveClassificationRules(rules);
      logger.debug(`✅ 分类规则更新成功: ${objectClass} -> ${newCategory}`);
      return rules;
    } catch (error) {
      console.error('更新分类规则失败:', error);
      throw error;
    }
  }

  // 添加新的分类规则
  async addClassificationRule(objectClass, category) {
    try {
      const rules = await this.getClassificationRules();
      rules[objectClass] = category;
      await this.saveClassificationRules(rules);
      logger.debug(`✅ 新增分类规则: ${objectClass} -> ${category}`);
      return rules;
    } catch (error) {
      console.error('添加分类规则失败:', error);
      throw error;
    }
  }

  // 删除分类规则
  async removeClassificationRule(objectClass) {
    try {
      const rules = await this.getClassificationRules();
      delete rules[objectClass];
      await this.saveClassificationRules(rules);
      logger.debug(`✅ 删除分类规则: ${objectClass}`);
      return rules;
    } catch (error) {
      console.error('删除分类规则失败:', error);
      throw error;
    }
  }

  // ==================== 相似度数据表相关方法 ====================

  /**
   * 获取相似组索引
   * @returns {Promise<Object>} 相似组索引 {groupId: [imageId1, imageId2, ...]}
   */
  /** 保存时刻秀（放映集） */
  async saveShowcase(sc) {
    try {
      if (Platform.OS === 'web') return false;
      await this.ensureInitialized();
      await this.storage.db.executeSql(
        'INSERT OR REPLACE INTO showcases (id, name, description, imageIds, mode, interval, musicPath, createdAt, coverId, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sc.id, sc.name || '', sc.description || '', JSON.stringify(sc.imageIds || []), sc.mode || 'fade', sc.interval || 3, sc.musicPath || '', sc.createdAt || new Date().toISOString(), sc.coverId || '', sc.items ? JSON.stringify(sc.items) : '']
      );
      return true;
    } catch (e) {
      logger.warn('保存时刻秀失败:', e?.message || e);
      return false;
    }
  }

  /** 时刻秀列表（按创建时间倒序） */
  async listShowcases() {
    try {
      if (Platform.OS === 'web') return [];
      await this.ensureInitialized();
      const results = await this.storage.db.executeSql('SELECT * FROM showcases ORDER BY createdAt DESC');
      const result = results && results.length > 0 ? results[0] : null;
      const out = [];
      if (result && result.rows) {
        for (let i = 0; i < result.rows.length; i++) {
          const row = result.rows.item(i);
          let ids = [];
          try { ids = JSON.parse(row.imageIds || '[]'); } catch (_) {}
          let items = null;
          try { if (row.items) items = JSON.parse(row.items); } catch (_) {}
          out.push({ ...row, imageIds: ids, items });
        }
      }
      return out;
    } catch (e) {
      logger.warn('读取时刻秀失败:', e?.message || e);
      return [];
    }
  }

  /** 删除时刻秀（并清理模板生成的 items 缓存资源） */
  async deleteShowcase(id) {
    try {
      if (Platform.OS === 'web') return false;
      await this.ensureInitialized();
      // 删库前：取 items → unlink asset 资源文件（模板生成的滤镜图/标题卡）
      try {
        const [r] = await this.storage.db.executeSql('SELECT items FROM showcases WHERE id = ?', [id]);
        const row = r && r.rows && r.rows.length ? r.rows.item(0) : null;
        if (row && row.items) {
          const items = JSON.parse(row.items);
          if (Array.isArray(items)) {
            const RNFS = require('react-native-fs');
            for (const it of items) {
              if (it && it.kind === 'asset' && it.uri) {
                try { await RNFS.unlink(String(it.uri).replace(/^file:\/\//, '')); } catch (_) {}
              }
            }
          }
        }
      } catch (_) { /* 清理失败不阻断删除 */ }
      await this.storage.db.executeSql('DELETE FROM showcases WHERE id = ?', [id]);
      return true;
    } catch (e) {
      logger.warn('删除时刻秀失败:', e?.message || e);
      return false;
    }
  }

  /**
   * 批量保存图片特征（颜色直方图等）。相似检测阶段顺手调用，给「以图搜图」建索引。
   * @param {Array<{imageId: string, features: Object}>} entries
   */
  async saveImageFeaturesBatch(entries) {
    try {
      if (!entries || entries.length === 0) return true;
      if (Platform.OS === 'web') return true;   // PC 端暂不支持以图搜图索引
      await this.ensureInitialized();
      const now = new Date().toISOString();
      for (const e of entries) {
        if (!e || !e.imageId || !e.features) continue;
        await this.storage.db.executeSql(
          'INSERT OR REPLACE INTO image_features (imageId, features, updatedAt) VALUES (?, ?, ?)',
          [e.imageId, JSON.stringify(e.features), now]
        );
      }
      return true;
    } catch (error) {
      logger.warn('保存图片特征失败:', error?.message || error);
      return false;
    }
  }

  /** 批量保存 CLIP 向量（量化 4 位小数省空间；L2 归一化向量，余弦=点积） */
  async saveImageEmbeddingsBatch(entries, model) {
    try {
      if (!entries || entries.length === 0) return true;
      if (Platform.OS === 'web') return true;
      await this.ensureInitialized();
      const now = new Date().toISOString();
      for (const e of entries) {
        if (!e || !e.imageId || !Array.isArray(e.vec)) continue;
        const q = e.vec.map((v) => Math.round(v * 10000) / 10000);
        await this.storage.db.executeSql(
          'INSERT OR REPLACE INTO image_embeddings (imageId, model, vec, updatedAt) VALUES (?, ?, ?, ?)',
          [e.imageId, model || '', JSON.stringify(q), now]
        );
      }
      return true;
    } catch (error) {
      logger.warn('保存向量索引失败:', error?.message || error);
      return false;
    }
  }

  /** 清空指定模型的全部 CLIP 向量（重建索引用） */
  async deleteAllImageEmbeddings(model) {
    try {
      if (Platform.OS === 'web') return true;
      await this.ensureInitialized();
      await this.storage.db.executeSql('DELETE FROM image_embeddings WHERE model = ?', [model || '']);
      return true;
    } catch (error) {
      logger.warn('清空向量索引失败:', error?.message || error);
      return false;
    }
  }

  /** 按 imageId 批量删除向量（清理已删图的残留向量） */
  async deleteImageEmbeddingsByIds(model, ids) {
    try {
      if (Platform.OS === 'web') return true;
      if (!Array.isArray(ids) || ids.length === 0) return true;
      await this.ensureInitialized();
      // 分批 IN 删除（避免 SQL 变量过多）
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        const placeholders = part.map(() => '?').join(',');
        // eslint-disable-next-line no-await-in-loop
        await this.storage.db.executeSql(
          `DELETE FROM image_embeddings WHERE model = ? AND imageId IN (${placeholders})`,
          [model || '', ...part]
        );
      }
      return true;
    } catch (error) {
      logger.warn('删除残留向量失败:', error?.message || error);
      return false;
    }
  }

  /** 读取全部 CLIP 向量 → { imageId: number[] }（仅指定模型的） */
  async readAllImageEmbeddings(model) {
    try {
      if (Platform.OS === 'web') return {};
      await this.ensureInitialized();
      const results = await this.storage.db.executeSql(
        'SELECT imageId, vec FROM image_embeddings WHERE model = ?', [model || '']
      );
      const result = results && results.length > 0 ? results[0] : null;
      const map = {};
      if (result && result.rows) {
        for (let i = 0; i < result.rows.length; i++) {
          const row = result.rows.item(i);
          try { map[row.imageId] = JSON.parse(row.vec); } catch (_) {}
        }
      }
      return map;
    } catch (error) {
      logger.warn('读取向量索引失败:', error?.message || error);
      return {};
    }
  }

  /** 读取全部图片特征 → { imageId: featuresObj }（以图搜图用） */
  async readAllImageFeatures() {
    try {
      if (Platform.OS === 'web') return {};
      await this.ensureInitialized();
      const results = await this.storage.db.executeSql('SELECT imageId, features FROM image_features');
      const result = results && results.length > 0 ? results[0] : null;
      const map = {};
      if (result && result.rows) {
        for (let i = 0; i < result.rows.length; i++) {
          const row = result.rows.item(i);
          try { map[row.imageId] = JSON.parse(row.features); } catch (_) {}
        }
      }
      return map;
    } catch (error) {
      logger.warn('读取图片特征失败:', error?.message || error);
      return {};
    }
  }

  async getSimilarityGroupIndex() {
    try {
      await this.ensureInitialized();
      const index = await this.storage.getItem(this.storageKeys.similarityGroupIndex);
      return index || {};
    } catch (error) {
      logger.error(' 获取相似组索引失败:', error);
      return {};
    }
  }

  /**
   * 保存相似组索引
   * @param {Object} groupIndex - 相似组索引
   * @returns {Promise<boolean>} 是否保存成功
   */
  async saveSimilarityGroupIndex(groupIndex) {
    try {
      await this.ensureInitialized();
      await this.storage.setItem(this.storageKeys.similarityGroupIndex, groupIndex);
      // logger.debug(`✅ 保存相似组索引成功，共${Object.keys(groupIndex).length}个组`);
      return true;
    } catch (error) {
      logger.error(' 保存相似组索引失败:', error);
      throw error;
    }
  }

  /**
   * 从相似组中移除图片
   * @param {string} imageId - 图片ID
   * @returns {Promise<boolean>} 是否移除成功
   */
  async removeImageFromSimilarityGroup(imageId) {
    try {
      const similarityData = await this.getSimilarityData();
      const groupIndex = await this.getSimilarityGroupIndex();
      
      // 从相似度数据中获取图片的组ID
      const imageData = similarityData[imageId];
      if (!imageData || !imageData.similarity_group_id) {
        logger.debug(`⚠️ 图片 ${imageId} 没有相似组信息`);
        return true;
      }
      
      const groupId = imageData.similarity_group_id;
      
      if (groupIndex[groupId]) {
        // 先检查删除后还剩多少张图片
        const remainingCount = groupIndex[groupId].length - 1;
        let remainingImageId = null;
        
        // 如果删除后只剩1张图片，获取剩余图片ID
        if (remainingCount === 1) {
          remainingImageId = groupIndex[groupId].find(id => id !== imageId);
          if (remainingImageId && similarityData[remainingImageId]) {
            delete similarityData[remainingImageId];
            logger.debug(`🗑️ 清除剩余图片的相似组数据: ${remainingImageId}`);
          }
        }
        
        // 删除目标图片的相似组数据
        if (similarityData[imageId]) {
          delete similarityData[imageId];
          logger.debug(`🗑️ 清除目标图片的相似组数据: ${imageId}`);
        }
        
        // 删除目标图片
        groupIndex[groupId] = groupIndex[groupId].filter(id => id !== imageId);
        
        // 如果删除后只剩1张图片，也要从组中移除剩余图片
        if (remainingCount === 1 && remainingImageId) {
          groupIndex[groupId] = groupIndex[groupId].filter(id => id !== remainingImageId);
        }
        
        // 如果组为空，删除该组
        if (groupIndex[groupId].length === 0) {
          delete groupIndex[groupId];
        }
      }
      
      // 保存更新后的数据
      await this.saveSimilarityGroupIndex(groupIndex);
      await this.saveSimilarityData(similarityData);
      logger.debug(`✅ 从相似组移除图片: ${imageId} 从 ${groupId}`);
      return true;
    } catch (error) {
      logger.error(' 从相似组移除图片失败:', error);
      throw error;
    }
  }

  /**
   * 添加图片到相似组
   * @param {string} imageId - 图片ID
   * @param {string} groupId - 组ID
   * @param {Object} similarityInfo - 相似度信息
   * @returns {Promise<boolean>} 是否添加成功
   */
  async addImageToSimilarityGroup(imageId, groupId, similarityInfo = {}) {
    try {
      // 先清理图片的现有相似度信息
      await this.removeImageFromSimilarityGroup(imageId);
      
      const groupIndex = await this.getSimilarityGroupIndex();
      const similarityData = await this.getSimilarityData();
      
      if (groupId) {
        // 更新相似组索引
        if (!groupIndex[groupId]) {
          groupIndex[groupId] = [];
        }
        if (!groupIndex[groupId].includes(imageId)) {
          groupIndex[groupId].push(imageId);
        }
        
        // 更新相似度数据，包含完整的相似度信息
        similarityData[imageId] = {
          ...similarityData[imageId],
          ...similarityInfo,
          similarity_group_id: groupId,
          updatedAt: new Date().toISOString()
        };
      }
      
      await this.saveSimilarityGroupIndex(groupIndex);
      await this.saveSimilarityData(similarityData);
      logger.debug(`✅ 添加图片到相似组: ${imageId} 到 ${groupId}`);
      return true;
    } catch (error) {
      logger.error(' 添加图片到相似组失败:', error);
      throw error;
    }
  }

  /**
   * 重建相似组索引（从相似度数据表重建）
   * @returns {Promise<boolean>} 是否重建成功
   */
  async rebuildSimilarityGroupIndex() {
    try {
      const similarityData = await this.getSimilarityData();
      const groupIndex = {};
      
      // 遍历相似度数据，按组ID分组
      Object.entries(similarityData).forEach(([imageId, data]) => {
        if (data.similarity_group_id) {
          const groupId = data.similarity_group_id;
          if (!groupIndex[groupId]) {
            groupIndex[groupId] = [];
          }
          groupIndex[groupId].push(imageId);
        }
      });
      
      await this.saveSimilarityGroupIndex(groupIndex);
      logger.debug(`✅ 重建相似组索引成功，共${Object.keys(groupIndex).length}个组`);
      return true;
    } catch (error) {
      logger.error(' 重建相似组索引失败:', error);
      throw error;
    }
  }

  /**
   * 获取相似度数据表
   * @returns {Promise<Object>} 相似度数据映射表 {imageId: similarityData}
   */
  async getSimilarityData() {
    try {
      await this.ensureInitialized();
      const data = await this.storage.getItem(this.storageKeys.similarityData);
      return data || {};
    } catch (error) {
      logger.error(' 获取相似度数据失败:', error);
      return {};
    }
  }

  /**
   * 保存相似度数据表
   * @param {Object} similarityData - 相似度数据映射表
   * @returns {Promise<boolean>} 是否保存成功
   */
  async saveSimilarityData(similarityData) {
    try {
      await this.ensureInitialized();
      await this.storage.setItem(this.storageKeys.similarityData, similarityData);
      // logger.debug(`✅ 保存相似度数据成功，共${Object.keys(similarityData).length}条记录`);
      return true;
    } catch (error) {
      logger.error(' 保存相似度数据失败:', error);
      throw error;
    }
  }

  /**
   * 更新单张图片的相似度数据
   * @param {string} imageId - 图片ID
   * @param {Object} similarityInfo - 相似度信息
   * @returns {Promise<boolean>} 是否更新成功
   */
  async updateImageSimilarity(imageId, similarityInfo) {
    try {
      const similarityData = await this.getSimilarityData();
      
      // 获取旧的组ID（用于索引更新）
      const oldGroupId = similarityData[imageId]?.similarity_group_id;
      const newGroupId = similarityInfo.similarity_group_id;
      
      // 更新或添加相似度数据
      similarityData[imageId] = {
        ...similarityData[imageId],
        ...similarityInfo,
        updatedAt: new Date().toISOString()
      };
      
      // 保存相似度数据
      await this.saveSimilarityData(similarityData);
      
      // 更新相似组索引
      if (oldGroupId && oldGroupId !== newGroupId) {
        await this.removeImageFromSimilarityGroup(imageId);
      }
      if (newGroupId && newGroupId !== oldGroupId) {
        await this.addImageToSimilarityGroup(imageId, newGroupId, similarityInfo);
      }
      
      logger.debug(`✅ 更新图片相似度数据: ${imageId}`);
      return true;
    } catch (error) {
      logger.error(' 更新图片相似度数据失败:', error);
      throw error;
    }
  }

  /**
   * 批量更新图片相似度数据
   * @param {Array} imageSimilarityArray - 图片相似度数据数组
   * @returns {Promise<boolean>} 是否更新成功
   */
  async updateImagesSimilarity(imageSimilarityArray) {
    try {
      const similarityData = await this.getSimilarityData();
      const groupIndex = await this.getSimilarityGroupIndex();
      
      // 批量更新相似度数据
      imageSimilarityArray.forEach(item => {
        const oldGroupId = similarityData[item.imageId]?.similarity_group_id;
        const newGroupId = item.similarityInfo.similarity_group_id;
        
        // 更新相似度数据
        similarityData[item.imageId] = {
          ...similarityData[item.imageId],
          ...item.similarityInfo,
          updatedAt: new Date().toISOString()
        };
        
        // 更新相似组索引
        if (oldGroupId && oldGroupId !== newGroupId) {
          // 从旧组中移除
          if (groupIndex[oldGroupId]) {
            groupIndex[oldGroupId] = groupIndex[oldGroupId].filter(id => id !== item.imageId);
            if (groupIndex[oldGroupId].length === 0) {
              delete groupIndex[oldGroupId];
            }
          }
        }
        
        // 添加到新组
        if (newGroupId) {
          if (!groupIndex[newGroupId]) {
            groupIndex[newGroupId] = [];
          }
          if (!groupIndex[newGroupId].includes(item.imageId)) {
            groupIndex[newGroupId].push(item.imageId);
          }
        }
      });
      
      // 保存更新后的数据
      await this.saveSimilarityData(similarityData);
      await this.saveSimilarityGroupIndex(groupIndex);
      
      return true;
    } catch (error) {
      logger.error(' 批量更新图片相似度数据失败:', error);
      throw error;
    }
  }

  /**
   * 获取单张图片的相似度数据
   * @param {string} imageId - 图片ID
   * @returns {Promise<Object|null>} 相似度数据
   */
  async getImageSimilarity(imageId) {
    try {
      const similarityData = await this.getSimilarityData();
      return similarityData[imageId] || null;
    } catch (error) {
      logger.error(' 获取图片相似度数据失败:', error);
      return null;
    }
  }

  // ==================== 相似度检测相关方法 ====================

  /**
   * 获取相似度检测统计信息（使用独立相似度数据表）
   * @returns {Promise<Object>} 统计信息
   */
  async getSimilarityStats() {
    try {
      // 获取相似度数据
      const similarityData = await this.getSimilarityData();
      const similarityEntries = Object.values(similarityData);
      
      const stats = {
        processed: similarityEntries.filter(data => data.is_similarity_processed).length,
        grouped: similarityEntries.filter(data => data.similarity_group_id).length,
        groupTypes: {}
      };

      // 统计各类型组数量
      similarityEntries.forEach(data => {
        if (data.similarity_group_type) {
          stats.groupTypes[data.similarity_group_type] = 
            (stats.groupTypes[data.similarity_group_type] || 0) + 1;
        }
      });

      return stats;
    } catch (error) {
      logger.error(' 获取相似度统计信息失败:', error);
      return {
        processed: 0,
        grouped: 0,
        groupTypes: {}
      };
    }
  }

  /**
   * 获取相似图片组
   * @param {string} groupType - 组类型过滤，'all'表示所有类型
   * @returns {Promise<Array>} 相似图片组列表
   */
  async getSimilarityGroups(groupType = 'all') {
    try {
      // 使用索引快速获取相似组
      const groupIndex = await this.getSimilarityGroupIndex();
      const similarityData = await this.getSimilarityData();
      const groups = {};

      // 遍历索引中的每个组
      Object.entries(groupIndex).forEach(([groupId, imageIds]) => {
        if (imageIds.length === 0) return; // 跳过空组
        
        // 验证组中所有图片的数据是否都存在
        const validImageIds = imageIds.filter(imageId => similarityData[imageId]);
        if (validImageIds.length === 0) {
          logger.debug(`⚠️ 相似组 ${groupId} 没有有效数据，跳过`);
          return;
        }
        
        // 如果有效图片数量少于原始数量，说明有数据不一致
        if (validImageIds.length !== imageIds.length) {
          logger.debug(`⚠️ 相似组 ${groupId} 数据不一致，有效图片: ${validImageIds.length}/${imageIds.length}`);
        }
        
        // 获取组中第一张有效图片的数据来确定组类型
        const firstImageId = validImageIds[0];
        const firstImageData = similarityData[firstImageId];
        
        if (!firstImageData) return;
        
        groups[groupId] = {
          id: groupId,
          type: firstImageData.similarity_group_type || 'similar',
          images: [],
          confidence: 0,
          created_at: firstImageData.updatedAt
        };
        
        // 添加组中所有有效图片
        validImageIds.forEach(imageId => {
          const data = similarityData[imageId];
          if (data) {
            groups[groupId].images.push({
              id: imageId,
              similarity_score: data.similarity_score,
              similarity_group_type: data.similarity_group_type
            });
            
            // 更新组置信度（取平均值）
            if (data.similarity_score) {
              const currentConfidence = groups[groupId].confidence;
              const imageCount = groups[groupId].images.length;
              groups[groupId].confidence = 
                (currentConfidence * (imageCount - 1) + data.similarity_score) / imageCount;
            }
          }
        });
      });

      // 过滤组类型
      let filteredGroups = Object.values(groups);
      if (groupType !== 'all') {
        filteredGroups = filteredGroups.filter(group => group.type === groupType);
      }

      // 按组大小和置信度排序
      filteredGroups.sort((a, b) => {
        if (b.images.length !== a.images.length) {
          return b.images.length - a.images.length;
        }
        return b.confidence - a.confidence;
      });

      return filteredGroups;
    } catch (error) {
      logger.error(' 获取相似图片组失败:', error);
      return [];
    }
  }

  /**
   * 根据组ID快速获取相似组信息
   * @param {string} groupId - 组ID
   * @returns {Promise<Object|null>} 相似组信息
   */
  async getSimilarityGroupById(groupId) {
    try {
      const groupIndex = await this.getSimilarityGroupIndex();
      const imageIds = groupIndex[groupId];
      
      if (!imageIds || imageIds.length === 0) {
        return null;
      }
      
      const similarityData = await this.getSimilarityData();
      const firstImageData = similarityData[imageIds[0]];
      
      if (!firstImageData) {
        return null;
      }
      
      const group = {
        id: groupId,
        type: firstImageData.similarity_group_type || 'similar',
        images: [],
        confidence: 0,
        created_at: firstImageData.updatedAt
      };
      
      // 添加组中所有图片
      imageIds.forEach(imageId => {
        const data = similarityData[imageId];
        if (data) {
          group.images.push({
            id: imageId,
            similarity_score: data.similarity_score,
            similarity_group_type: data.similarity_group_type
          });
          
          // 更新组置信度（取平均值）
          if (data.similarity_score) {
            const currentConfidence = group.confidence;
            const imageCount = group.images.length;
            group.confidence = 
              (currentConfidence * (imageCount - 1) + data.similarity_score) / imageCount;
          }
        }
      });
      
      return group;
    } catch (error) {
      logger.error(' 获取相似组信息失败:', error);
      return null;
    }
  }

  /**
   * 获取特定图片的相似图片
   * @param {string} imageId - 图片ID
   * @param {number} limit - 返回数量限制，默认10
   * @returns {Promise<Array>} 相似图片列表
   */
  async getSimilarImages(imageId, limit = 10) {
    try {
      // 获取目标图片的相似度数据
      const targetSimilarity = await this.getImageSimilarity(imageId);
      
      if (!targetSimilarity || !targetSimilarity.similarity_group_id) {
        return [];
      }

      // 使用索引快速获取同组图片
      const groupIndex = await this.getSimilarityGroupIndex();
      const groupImageIds = groupIndex[targetSimilarity.similarity_group_id];
      
      if (!groupImageIds || groupImageIds.length <= 1) {
        return [];
      }

      // 获取相似度数据并按相似度分数排序
      const similarityData = await this.getSimilarityData();
      const similarImages = groupImageIds
        .filter(id => id !== imageId) // 排除目标图片
        .map(id => ({
          id: id,
          similarity_score: similarityData[id]?.similarity_score || 0
        }))
        .sort((a, b) => b.similarity_score - a.similarity_score)
        .slice(0, limit);

      return similarImages;
    } catch (error) {
      logger.error(' 获取相似图片失败:', error);
      return [];
    }
  }

  /**
   * 清除相似度检测数据
   * @param {Array} imageIds - 要清除的图片ID数组，为空则清除所有
   * @returns {Promise<boolean>} 是否清除成功
   */
  async clearSimilarityData(imageIds = null) {
    try {
      if (imageIds === null) {
        // 清除所有相似度数据
        await this.storage.removeItem(this.storageKeys.similarityData);
        await this.storage.removeItem(this.storageKeys.similarityGroupIndex);
        logger.debug(' 清除所有相似度数据成功');
      } else {
        // 清除指定图片的相似度数据
        const similarityData = await this.getSimilarityData();
        const groupIndex = await this.getSimilarityGroupIndex();
        
        // 记录需要更新的组
        const groupsToUpdate = new Set();
        
        imageIds.forEach(imageId => {
          // 从相似度数据中移除
          const oldData = similarityData[imageId];
          if (oldData?.similarity_group_id) {
            groupsToUpdate.add(oldData.similarity_group_id);
          }
          delete similarityData[imageId];
          
          // 从组索引中移除
          if (oldData?.similarity_group_id && groupIndex[oldData.similarity_group_id]) {
            const groupId = oldData.similarity_group_id;
            groupIndex[groupId] = groupIndex[groupId].filter(id => id !== imageId);
            
            // 如果组为空或只剩一张图片，删除该组
            if (groupIndex[groupId].length <= 1) {
              // 如果组只剩一张图片，需要清除该图片的相似组信息
              if (groupIndex[groupId].length === 1) {
                const remainingImageId = groupIndex[groupId][0];
                if (similarityData[remainingImageId]) {
                  delete similarityData[remainingImageId].similarity_group_id;
                  delete similarityData[remainingImageId].similarity_group_type;
                  delete similarityData[remainingImageId].similarity_score;
                  logger.debug(`✅ 清除单图片组，移除图片 ${remainingImageId} 的相似组信息`);
                }
              }
              // 删除该组
              delete groupIndex[groupId];
            }
          }
        });
        
        // 保存更新后的数据
        await this.saveSimilarityData(similarityData);
        await this.saveSimilarityGroupIndex(groupIndex);
        logger.debug(`✅ 清除${imageIds.length}张图片的相似度数据成功`);
      }
      return true;
    } catch (error) {
      logger.error(' 清除相似度检测数据失败:', error);
      throw error;
    }
  }

  /**
   * 删除相似组（优化版本）
   * @param {string} groupId - 相似组ID
   * @returns {Promise<boolean>} 是否删除成功
   */
  async deleteSimilarityGroup(groupId) {
    try {
      // 获取组索引和相似度数据
      const groupIndex = await this.getSimilarityGroupIndex();
      const similarityData = await this.getSimilarityData();
      
      const groupImageIds = groupIndex[groupId];
      
      if (!groupImageIds || groupImageIds.length === 0) {
        logger.debug(`⚠️ 未找到相似组: ${groupId}`);
        return false;
      }

      // 直接从相似度数据中删除该组的所有图片
      groupImageIds.forEach(imageId => {
        delete similarityData[imageId];
      });
      
      // 从索引中删除该组
      delete groupIndex[groupId];
      
      // 保存更新后的数据
      await this.saveSimilarityData(similarityData);
      await this.saveSimilarityGroupIndex(groupIndex);
      
      logger.debug(`✅ 删除相似组${groupId}，影响${groupImageIds.length}张图片`);
      return true;
      
    } catch (error) {
      logger.error(' 删除相似组失败:', error);
      return false;
    }
  }

  /**
   * 获取时间窗口内的图片
   * @param {Date} startTime - 开始时间
   * @param {Date} endTime - 结束时间
   * @returns {Promise<Array>} 时间窗口内的图片列表
   */
  async getImagesInTimeWindow(startTime, endTime) {
    try {
      const allImages = await this.getImages();
      
      const filteredImages = allImages.filter(image => {
        // 只使用拍摄时间，没有拍摄时间就不参与相似度检测
        if (!image.takenAt) {
          return false;
        }
        
        const imageTime = new Date(image.takenAt);
        return imageTime >= startTime && imageTime <= endTime;
      });

      // 按时间排序
      filteredImages.sort((a, b) => {
        const timeA = new Date(a.takenAt).getTime();
        const timeB = new Date(b.takenAt).getTime();
        return timeA - timeB;
      });

      return filteredImages;
    } catch (error) {
      logger.error(' 获取时间窗口图片失败:', error);
      return [];
    }
  }

  // ==================== 暂存箱相关方法 ====================

  /**
   * 添加图片到暂存箱
   * @param {Array<string>} imageIds - 图片ID数组
   * @returns {Promise<{success: boolean, added: number, errors: Array}>}
   */
  async addToStagingBox(imageIds) {
    try {
      await this.ensureInitialized();
      
      if (!imageIds || imageIds.length === 0) {
        return { success: true, added: 0, errors: [] };
      }
      
      const now = new Date().toISOString();
      let added = 0;
      const errors = [];
      
      if (Platform.OS === 'web') {
        // PC端：IndexedDB
        try {
          const stagingBoxData = await this.storage.getItem(this.storageKeys.stagingBox) || [];
          logger.debug(`📦 暂存箱当前数据: ${stagingBoxData.length} 条`, stagingBoxData.map(item => item.imageId));
          const existingIds = new Set(stagingBoxData.map(item => item.imageId));
          logger.debug(`📦 现有图片ID集合:`, Array.from(existingIds));
          logger.debug(`📦 准备添加的图片ID:`, imageIds);
          
          for (const imageId of imageIds) {
            if (!existingIds.has(imageId)) {
              stagingBoxData.push({
                imageId,
                addedAt: now
              });
              added++;
              logger.debug(`✅ 添加图片到暂存箱: ${imageId}`);
            } else {
              logger.debug(`⏭️ 图片已在暂存箱中，跳过: ${imageId}`);
            }
          }
          
          logger.debug(`📦 更新后的暂存箱数据: ${stagingBoxData.length} 条`, stagingBoxData.map(item => item.imageId));
          await this.storage.setItem(this.storageKeys.stagingBox, stagingBoxData);
          
          // 验证保存结果
          const verifyData = await this.storage.getItem(this.storageKeys.stagingBox) || [];
          logger.debug(`🔍 验证：保存后暂存箱数据: ${verifyData.length} 条`, verifyData.map(item => item.imageId));
        } catch (error) {
          logger.error('添加图片到暂存箱失败（IndexedDB）:', error);
          errors.push({ imageId: 'bulk_operation', error: error.message });
        }
      } else {
        // 移动端：SQLite - 批量插入
        try {
          if (imageIds.length > 0) {
            // 确保 storage 已初始化
            if (!this.storage || !this.storage.db) {
              logger.error('❌ SQLite 数据库未初始化');
              throw new Error('数据库未初始化');
            }
            
            // 构建批量插入 SQL：INSERT OR IGNORE INTO staging_box (imageId, addedAt) VALUES (?, ?), (?, ?), ...
            const valuesPlaceholders = imageIds.map(() => '(?, ?)').join(', ');
            const sql = `INSERT OR IGNORE INTO staging_box (imageId, addedAt) VALUES ${valuesPlaceholders}`;
            
            // 构建参数数组：[id1, now, id2, now, id3, now, ...]
            const params = imageIds.flatMap(imageId => [imageId, now]);
            
            const [result] = await this.storage.db.executeSql(sql, params);
            added = result.rowsAffected || imageIds.length; // rowsAffected 可能不准确，使用传入的数量
          }
        } catch (error) {
          logger.error('批量添加图片到暂存箱失败（SQLite）:', error);
          errors.push({ imageId: 'bulk_operation', error: error.message });
        }
      }
      
      logger.debug(`✅ 添加 ${added} 张图片到暂存箱`);
      return { success: errors.length === 0, added, errors };
      
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
      await this.ensureInitialized();
      
      if (!imageIds || imageIds.length === 0) {
        return { success: true, removed: 0, errors: [] };
      }
      
      let removed = 0;
      const errors = [];
      
      if (Platform.OS === 'web') {
        // PC端：IndexedDB
        try {
          const stagingBoxData = await this.storage.getItem(this.storageKeys.stagingBox) || [];
          const imageIdSet = new Set(imageIds);
          const filteredData = stagingBoxData.filter(item => !imageIdSet.has(item.imageId));
          removed = stagingBoxData.length - filteredData.length;
          
          await this.storage.setItem(this.storageKeys.stagingBox, filteredData);
        } catch (error) {
          logger.error('从暂存箱移除图片失败（IndexedDB）:', error);
          errors.push({ imageId: 'bulk_operation', error: error.message });
        }
      } else {
        // 移动端：SQLite
        const placeholders = imageIds.map(() => '?').join(',');
        try {
          // 确保 storage 已初始化
          if (!this.storage || !this.storage.db) {
            logger.error('❌ SQLite 数据库未初始化');
            throw new Error('数据库未初始化');
          }
          
          const [result] = await this.storage.db.executeSql(
            `DELETE FROM staging_box WHERE imageId IN (${placeholders})`,
            imageIds
          );
          removed = result.rowsAffected || 0;
        } catch (error) {
          logger.error('从暂存箱移除图片失败（SQLite）:', error);
          errors.push({ imageId: 'bulk_operation', error: error.message });
        }
      }
      
      logger.debug(`✅ 从暂存箱移除 ${removed} 张图片`);
      return { success: errors.length === 0, removed, errors };
      
    } catch (error) {
      logger.error('从暂存箱移除图片失败:', error);
      throw error;
    }
  }

  /**
   * 获取暂存箱所有图片ID
   * @returns {Promise<Array<string>>} 图片ID数组
   */
  async getStagingBoxImageIds() {
    try {
      await this.ensureInitialized();
      
      if (Platform.OS === 'web') {
        // PC端：IndexedDB
        const stagingBoxData = await this.storage.getItem(this.storageKeys.stagingBox) || [];
        return stagingBoxData.map(item => item.imageId);
      } else {
        // 移动端：SQLite
        // 确保 storage 已初始化
        if (!this.storage || !this.storage.db) {
          logger.error('❌ SQLite 数据库未初始化');
          return [];
        }
        
        const [result] = await this.storage.db.executeSql(
          'SELECT imageId FROM staging_box ORDER BY addedAt DESC'
        );
        
        if (!result || !result.rows) {
          return [];
        }
        
        const imageIds = [];
        for (let i = 0; i < result.rows.length; i++) {
          imageIds.push(result.rows.item(i).imageId);
        }
        return imageIds;
      }
    } catch (error) {
      logger.error('获取暂存箱图片ID失败:', error);
      return [];
    }
  }

  /**
   * 检查图片是否在暂存箱
   * @param {string} imageId - 图片ID
   * @returns {Promise<boolean>}
   */
  async isInStagingBox(imageId) {
    try {
      await this.ensureInitialized();
      
      if (Platform.OS === 'web') {
        // PC端：IndexedDB
        const stagingBoxData = await this.storage.getItem(this.storageKeys.stagingBox) || [];
        return stagingBoxData.some(item => item.imageId === imageId);
      } else {
        // 移动端：SQLite
        // 确保 storage 已初始化
        if (!this.storage || !this.storage.db) {
          logger.error('❌ SQLite 数据库未初始化');
          return false;
        }
        
        const [result] = await this.storage.db.executeSql(
          'SELECT COUNT(*) as count FROM staging_box WHERE imageId = ?',
          [imageId]
        );
        return result.rows.item(0).count > 0;
      }
    } catch (error) {
      logger.error('检查图片是否在暂存箱失败:', error);
      return false;
    }
  }

  /**
   * 获取暂存箱所有图片（完整信息）
   * @returns {Promise<Array>} 图片数组
   */
  async getStagingBoxImages() {
    try {
      const imageIds = await this.getStagingBoxImageIds();
      if (imageIds.length === 0) {
        return [];
      }
      
      const imagesMap = await this.getImagesByIds(imageIds);
      // 按照 addedAt 排序（最新的在前）
      const images = imageIds
        .map(id => imagesMap.get(id))
        .filter(img => img !== undefined);
      
      return images;
    } catch (error) {
      logger.error('获取暂存箱图片失败:', error);
      return [];
    }
  }

  /**
   * 获取暂存箱图片数量
   * 直接统计 staging_box 表中的记录数，性能更好
   * 注意：这个数量可能包含已删除的图片ID，但为了性能考虑，不进行过滤
   * 如果需要精确数量（排除已删除的图片），请使用 getStagingBoxImages().length
   * @returns {Promise<number>}
   */
  async getStagingBoxCount() {
    try {
      await this.ensureInitialized();
      
      if (Platform.OS === 'web') {
        // PC端：IndexedDB
        const stagingBoxData = await this.storage.getItem(this.storageKeys.stagingBox) || [];
        return stagingBoxData.length;
      } else {
        // 移动端：SQLite
        // 确保 storage 已初始化
        if (!this.storage || !this.storage.db) {
          logger.error('❌ SQLite 数据库未初始化');
          return 0;
        }
        
        const [result] = await this.storage.db.executeSql(
          'SELECT COUNT(*) as count FROM staging_box'
        );
        
        if (!result || !result.rows || result.rows.length === 0) {
          return 0;
        }
        
        return result.rows.item(0).count || 0;
      }
    } catch (error) {
      logger.error('获取暂存箱数量失败:', error);
      return 0;
    }
  }

}

export default ImageStorageService;