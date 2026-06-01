/**
 * 防回归：v1.4.4 → v1.5.0 修过的 scanner 覆盖已分类 bug。
 * 用户点首页"刷新"全相册扫描时，绝不能把已分类记录刷回 'NA'。
 */
import { mergeScannerRecord, mergeScannerRecords } from '../mergeScannerRecord';

const baseFresh = (overrides = {}) => ({
  id: 'asset-1',
  uri: 'ph://asset-1',
  fileName: 'IMG_0001.HEIC',
  category: 'NA',
  confidence: 0,
  takenAt: 1700000000000,
  size: 1024 * 1024,
  width: 4032,
  height: 3024,
  ...overrides,
});

describe('mergeScannerRecord — 单条合并', () => {
  test('prev 不存在（新增图） → 直接用 fresh', () => {
    const fresh = baseFresh();
    expect(mergeScannerRecord(fresh, undefined)).toBe(fresh);
    expect(mergeScannerRecord(fresh, null)).toBe(fresh);
  });

  test('prev 已分类（category 非 NA） → 保留 prev 的分类相关字段', () => {
    const fresh = baseFresh({ category: 'NA', confidence: 0 });
    const prev = {
      id: 'asset-1',
      category: 'travel_scenery',
      confidence: 0.87,
      idCardDetections: { hasIdCard: false },
      generalDetections: [{ label: 'mountain' }],
      mobileNetV3Detections: [{ label: 'alp', score: 0.7 }],
      message: 'cloud-llm classified',
      background_color: '#88aaff',
    };
    const out = mergeScannerRecord(fresh, prev);
    expect(out.category).toBe('travel_scenery');
    expect(out.confidence).toBe(0.87);
    expect(out.idCardDetections).toEqual({ hasIdCard: false });
    expect(out.generalDetections).toEqual([{ label: 'mountain' }]);
    expect(out.mobileNetV3Detections).toEqual([{ label: 'alp', score: 0.7 }]);
    expect(out.message).toBe('cloud-llm classified');
    expect(out.background_color).toBe('#88aaff');
  });

  test('prev 已分类 → 仍用 fresh 的 PhotoKit 元数据（size/dimensions/takenAt）', () => {
    const fresh = baseFresh({ size: 9999, width: 8000, height: 6000, takenAt: 1800000000000 });
    const prev = { id: 'asset-1', category: 'documents', confidence: 0.9, size: 1, width: 100, height: 100, takenAt: 1 };
    const out = mergeScannerRecord(fresh, prev);
    expect(out.size).toBe(9999);
    expect(out.width).toBe(8000);
    expect(out.height).toBe(6000);
    expect(out.takenAt).toBe(1800000000000);
    expect(out.category).toBe('documents'); // 分类保留
  });

  test('prev.category === "NA" → 让 fresh 的 systemCat 兜底生效', () => {
    const fresh = baseFresh({ category: 'screenshot', confidence: 1 }); // PHAsset isScreenshot
    const prev = { id: 'asset-1', category: 'NA', confidence: 0 };
    const out = mergeScannerRecord(fresh, prev);
    expect(out.category).toBe('screenshot');
    expect(out.confidence).toBe(1);
  });

  test('prev.category === "NA" 且 fresh.category 缺失 → 兜底 "NA"', () => {
    const fresh = baseFresh({ category: undefined, confidence: undefined });
    const prev = { id: 'asset-1', category: 'NA' };
    const out = mergeScannerRecord(fresh, prev);
    expect(out.category).toBe('NA');
  });

  test('prev 已 reverse geocode 出位置 → 保留城市/国家/坐标', () => {
    const fresh = baseFresh();
    const prev = {
      id: 'asset-1',
      category: 'travel_scenery',
      latitude: 39.9, longitude: 116.4,
      address: '天安门广场', city: '北京', country: '中国', province: '北京', district: '东城', street: '东长安街',
      locationSource: 'exif+reverseGeocode',
      cityDistance: 1.2,
    };
    const out = mergeScannerRecord(fresh, prev);
    expect(out.latitude).toBe(39.9);
    expect(out.longitude).toBe(116.4);
    expect(out.city).toBe('北京');
    expect(out.country).toBe('中国');
    expect(out.address).toBe('天安门广场');
    expect(out.locationSource).toBe('exif+reverseGeocode');
    expect(out.cityDistance).toBe(1.2);
  });

  test('位置字段用 ?? 不是 || — 经度 0 / accuracy 0 / cityDistance 0 都是合法值，要保留 prev', () => {
    const fresh = baseFresh({ latitude: 12, longitude: 34, accuracy: 99, cityDistance: 5 });
    const prev = { id: 'asset-1', category: 'travel_scenery', latitude: 0, longitude: 0, accuracy: 0, cityDistance: 0 };
    const out = mergeScannerRecord(fresh, prev);
    expect(out.latitude).toBe(0);
    expect(out.longitude).toBe(0);
    expect(out.accuracy).toBe(0);
    expect(out.cityDistance).toBe(0);
  });

  test('文本位置字段用 || — prev 空串时让 fresh 的填补', () => {
    const fresh = baseFresh({ city: '上海', address: '南京路' });
    const prev = { id: 'asset-1', category: 'travel_scenery', city: '', address: '' };
    const out = mergeScannerRecord(fresh, prev);
    expect(out.city).toBe('上海');
    expect(out.address).toBe('南京路');
  });
});

describe('mergeScannerRecords — 批量合并', () => {
  test('existing 空 → 直接返回 fresh（同一引用，零拷贝）', () => {
    const fresh = [baseFresh({ id: 'a' }), baseFresh({ id: 'b' })];
    expect(mergeScannerRecords(fresh, [])).toBe(fresh);
    expect(mergeScannerRecords(fresh, null)).toBe(fresh);
    expect(mergeScannerRecords(fresh, undefined)).toBe(fresh);
  });

  test('混合：existing 里部分已分类、部分 NA、部分新增', () => {
    const fresh = [
      baseFresh({ id: 'classified', category: 'NA' }),       // 库里已分类，会被保留
      baseFresh({ id: 'na', category: 'NA' }),               // 库里也是 NA，保持 NA
      baseFresh({ id: 'system', category: 'screenshot' }),   // 系统兜底，库里是 NA，让兜底生效
      baseFresh({ id: 'new', category: 'NA' }),              // 全新图，库里没有
    ];
    const existing = [
      { id: 'classified', category: 'people', confidence: 0.8 },
      { id: 'na', category: 'NA' },
      { id: 'system', category: 'NA' },
      // 'new' 没有
    ];
    const out = mergeScannerRecords(fresh, existing);
    expect(out).toHaveLength(4);
    expect(out[0].category).toBe('people');       // 保留
    expect(out[0].confidence).toBe(0.8);
    expect(out[1].category).toBe('NA');           // 保持
    expect(out[2].category).toBe('screenshot');   // 兜底生效
    expect(out[3].category).toBe('NA');
    expect(out[3]).toBe(fresh[3]);                // 新增图直接复用引用
  });

  test('真实回归场景：全量刷新已分类的相册，category 不能回到 NA', () => {
    // 模拟：用户点首页刷新，PhotoKit 把 100 张全部回扫，全部 fresh.category='NA'
    const fresh = Array.from({ length: 100 }, (_, i) => baseFresh({ id: `img-${i}`, category: 'NA' }));
    const existing = Array.from({ length: 100 }, (_, i) => ({
      id: `img-${i}`,
      category: i % 3 === 0 ? 'travel_scenery' : i % 3 === 1 ? 'people' : 'other',
      confidence: 0.8,
    }));
    const out = mergeScannerRecords(fresh, existing);
    const naCount = out.filter((r) => r.category === 'NA').length;
    expect(naCount).toBe(0);  // 关键断言：扫描后不能有任何已分类图退回 NA
  });
});
