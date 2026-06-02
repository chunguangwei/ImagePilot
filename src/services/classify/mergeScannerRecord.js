/**
 * mergeScannerRecord — iOS scanner 写库前的合并策略。纯函数，方便单测。
 *
 * 背景（v1.4.4 → v1.5.0 修过的回归）：
 *   GalleryScannerService.ios.scanGalleryWithProgress 每次扫描走全量 INSERT OR REPLACE
 *   写库。PHAsset → toImageRecord 只能从系统 mediaSubtype 拿到兜底 category
 *   （screenshot/panorama/depth），其它图全是 'NA'。直接覆盖会把用户手动分类、
 *   云端 LLM 分类、本地 ONNX (MobileNetV3/Places365/CLIP) 分类全清成 NA，相当
 *   于用户每次刷新都"失忆"。
 *
 * 策略：按 id 合并 fresh（从 PhotoKit 新读的）和 prev（DB 已有的）。
 *   - 元数据（size / dimensions / takenAt / fileName / mimeType）始终用 fresh
 *     （PhotoKit 拿到的就是最新真相）
 *   - 分类相关字段（category / confidence / *Detections / message / background_color）：
 *     prev.category 不是 'NA' → 全保留 prev 的（不让 NA 兜底覆盖已有分类）
 *     prev.category 是 'NA' → fresh 的可以生效（systemCat 兜底进库）
 *   - 位置字段（lat/lon/city/address 等）— prev 已 reverse geocode 出来的都保留
 *
 * 注：iOS scanner 不在扫描里跑本地分类（M3 把分类拆成独立流程），所以 fresh.category
 *     一定是 'NA' 或 systemCat 兜底。Android scanner 内部跑分类，走的是
 *     batchUpdateClassification 按字段更新，不存在本回归，无需此合并。
 *
 * @param {object} fresh   toImageRecord 出来的新记录
 * @param {object|null} prev DB 里已有的同 id 记录；undefined 表示新增
 * @returns {object} 合并后准备写库的记录
 */
export function mergeScannerRecord(fresh, prev) {
  if (!prev) return fresh;
  const keepCategory = prev.category && prev.category !== 'NA';
  return {
    ...fresh,
    category: keepCategory ? prev.category : (fresh.category || 'NA'),
    confidence: keepCategory ? prev.confidence : fresh.confidence,
    idCardDetections: prev.idCardDetections || fresh.idCardDetections,
    generalDetections: prev.generalDetections || fresh.generalDetections,
    mobileNetV3Detections: prev.mobileNetV3Detections || fresh.mobileNetV3Detections,
    message: prev.message || fresh.message,
    background_color: prev.background_color || fresh.background_color,
    // 位置字段：?? 不是 || 是因为 0 / '' 都是合法值
    latitude: prev.latitude ?? fresh.latitude,
    longitude: prev.longitude ?? fresh.longitude,
    altitude: prev.altitude ?? fresh.altitude,
    accuracy: prev.accuracy ?? fresh.accuracy,
    address: prev.address || fresh.address,
    city: prev.city || fresh.city,
    country: prev.country || fresh.country,
    province: prev.province || fresh.province,
    district: prev.district || fresh.district,
    street: prev.street || fresh.street,
    locationSource: prev.locationSource || fresh.locationSource,
    cityDistance: prev.cityDistance ?? fresh.cityDistance,
    // 拍摄参数（iOS enrichExifInfo 提取后落库）：toImageRecord 重扫时 cameraSettings 恒为
    // null，不保留会把已提取的 EXIF 冲掉，「按拍摄参数」section 一刷新就空（用户反馈）。
    // 连同 4 个 *Category 列一起保（writeImageDetailedInfo 落库时直接沿用，不必重算）。
    cameraSettings: prev.cameraSettings || fresh.cameraSettings,
    isoCategory: prev.isoCategory || fresh.isoCategory,
    apertureCategory: prev.apertureCategory || fresh.apertureCategory,
    shutterCategory: prev.shutterCategory || fresh.shutterCategory,
    focalLengthCategory: prev.focalLengthCategory || fresh.focalLengthCategory,
  };
}

/**
 * 批量合并：fresh 是新 PhotoKit 记录数组，existing 是 DB 当前全部记录数组。
 * 返回准备写库的记录数组（与 fresh 等长，顺序一致）。
 * existing 为 null/空数组时跳过合并，等价于全 fresh。
 */
export function mergeScannerRecords(fresh, existing) {
  if (!Array.isArray(existing) || existing.length === 0) return fresh;
  const byId = new Map(existing.map((e) => [e.id, e]));
  return fresh.map((r) => mergeScannerRecord(r, byId.get(r.id)));
}

export default { mergeScannerRecord, mergeScannerRecords };
