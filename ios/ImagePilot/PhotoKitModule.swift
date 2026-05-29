//
//  PhotoKitModule.swift
//  ImagePilot
//
//  iOS 端相册访问的原生模块——对应 Android 的 GalleryScanModule。
//  暴露 3 个方法给 JS：
//    - requestAuthorization → 弹系统授权对话框（iOS 14+ 含「允许全部 / 选部分」）
//    - fetchAllPhotos       → 一次性返回所有照片的元数据数组（PhotoKit 是内存索引，很快）
//    - deleteAssets         → 删除指定 localIdentifier 的资源（系统会自动弹原生确认对话框）
//
//  设计取舍：
//    - 一次性 fetch，不做 paging。iOS PhotoKit fetchAssets() 上万张也只是几十毫秒；
//      JS 端再分页/虚拟列表显示就行。Android 因为 MediaStore 查询要走 SQLite，
//      所以是分页+流式；iOS 用不着。
//    - 不在原生侧调 imageManager 拉缩略图/原图——保持模块单一职责。
//      预览时 RN <Image source={{uri:"ph://..."}}/> 系统自动从 PhotoKit 加载。
//      分类时把 localIdentifier 给 JS，再有需要 base64 时单独走另一个方法（M3）。
//    - 文件名/大小要从 PHAssetResource 拿（PHAsset 本身不暴露 originalFilename），
//      `fileSize` 是 KVC 访问私有 key——iOS 8 起一直能用，社区库（如 react-native-cameraroll）
//      也是这么做的，目前没有公开 API 等价替代。
//

import Foundation
import Photos
import React

@objc(PhotoKitModule)
class PhotoKitModule: RCTEventEmitter, PHPhotoLibraryChangeObserver {

  // RCTEventEmitter 需要在 main queue setup；不开 main queue setup 启动时会有警告
  @objc override static func requiresMainQueueSetup() -> Bool { true }

  // MARK: - 增量监听（PHPhotoLibraryChangeObserver）

  /// JS 端订阅 / 退订时 RN 自动调 startObserving / stopObserving。
  /// 我们靠这个时机注册/反注册 PHPhotoLibrary 观察者 —— 无 JS 订阅时不浪费 CPU。
  private var observerFetchResult: PHFetchResult<PHAsset>?
  private var isObserving = false

  override func supportedEvents() -> [String]! { ["PhotoLibraryDidChange"] }

  override func startObserving() {
    super.startObserving()
    guard !isObserving else { return }
    isObserving = true
    // 注册必须先抓一次 fetchResult 作为 diff 基线；后续变更 PhotoKit 会就着它出 diff
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { return }
      let opts = PHFetchOptions()
      opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
      opts.predicate = NSPredicate(format: "isHidden == NO")
      self.observerFetchResult = PHAsset.fetchAssets(with: .image, options: opts)
      PHPhotoLibrary.shared().register(self)
    }
  }

  override func stopObserving() {
    if isObserving {
      isObserving = false
      PHPhotoLibrary.shared().unregisterChangeObserver(self)
      observerFetchResult = nil
    }
    super.stopObserving()
  }

  /// PhotoKit 后台线程回调；我们把 diff 装好后切回 main 发 RN 事件。
  func photoLibraryDidChange(_ changeInstance: PHChange) {
    guard let prev = observerFetchResult,
          let details = changeInstance.changeDetails(for: prev) else { return }

    // 更新基线，下次 diff 就用这次结果
    observerFetchResult = details.fetchResultAfterChanges

    let inserted = details.insertedObjects.map { Self.assetToDict($0) }
    let changed  = details.changedObjects.map { Self.assetToDict($0) }
    let removed  = details.removedObjects.map { $0.localIdentifier }

    if inserted.isEmpty && changed.isEmpty && removed.isEmpty { return }

    let body: [String: Any] = [
      "inserted": inserted,
      "changed": changed,
      "removed": removed,
    ]
    DispatchQueue.main.async { [weak self] in
      // sendEvent 要求 main queue；有 listener 才发，没就静默丢
      guard let self = self, self.bridge != nil else { return }
      self.sendEvent(withName: "PhotoLibraryDidChange", body: body)
    }
  }

  /// 与 fetchAllPhotos 同形状的 PHAsset → JS dict 转换；diff 推送和初扫共用。
  private static func assetToDict(_ asset: PHAsset) -> [String: Any] {
    let resources = PHAssetResource.assetResources(for: asset)
    let primary = resources.first(where: { $0.type == .photo || $0.type == .fullSizePhoto }) ?? resources.first
    let fileName = primary?.originalFilename ?? "\(asset.localIdentifier).jpg"
    let fileSize = (primary?.value(forKey: "fileSize") as? Int64) ?? 0
    let takenAt = Int64((asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000)
    let isScreenshot = asset.mediaSubtypes.contains(.photoScreenshot)
    let lowerName = fileName.lowercased()
    let mimeType: String =
      lowerName.hasSuffix(".png") ? "image/png" :
      lowerName.hasSuffix(".heic") ? "image/heic" :
      lowerName.hasSuffix(".gif") ? "image/gif" :
      "image/jpeg"
    return [
      "id": asset.localIdentifier,
      "uri": "ph://\(asset.localIdentifier)",
      "localIdentifier": asset.localIdentifier,
      "fileName": fileName,
      "size": fileSize,
      "takenAt": takenAt,
      "width": asset.pixelWidth,
      "height": asset.pixelHeight,
      "mimeType": mimeType,
      "isScreenshot": isScreenshot,
    ]
  }

  // MARK: - 授权

  /// 请求 Photos 读写授权。返回 {status: "authorized" | "limited" | "denied" | "restricted" | "notDetermined"}
  /// JS 端只把 authorized / limited 视为可继续。
  @objc(requestAuthorization:rejecter:)
  func requestAuthorization(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
      let statusString = Self.statusString(status)
      resolve(["status": statusString])
    }
  }

  /// 同步查询当前授权状态（不弹对话框）。给"上次已授权过的"快速路径用。
  @objc(getAuthorizationStatus:rejecter:)
  func getAuthorizationStatus(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    resolve(["status": Self.statusString(status)])
  }

  private static func statusString(_ status: PHAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .limited: return "limited"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }

  // MARK: - 列照片

  /// 返回所有照片的元数据数组，按 creationDate 倒序。
  /// 返回形状（每张）：
  ///   id              — PHAsset.localIdentifier，业务层主键
  ///   uri             — "ph://<localIdentifier>"，RN <Image> 可直接消费
  ///   localIdentifier — 同上，给原生侧（删除等）回查用
  ///   fileName        — 原始文件名（如 IMG_0001.HEIC）
  ///   size            — 字节数（KVC 读 PHAssetResource.fileSize）
  ///   takenAt         — 拍摄/创建时间戳（毫秒）
  ///   width / height  — 像素尺寸
  ///   mimeType        — 简单的 .heic / .png / .jpg 判定，更细的在 JS 侧 magic-bytes 时再纠正
  ///   isScreenshot    — mediaSubtypes 含 .photoScreenshot
  @objc(fetchAllPhotos:rejecter:)
  func fetchAllPhotos(_ resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      let options = PHFetchOptions()
      options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
      // 排除已"最近删除"里的图——它们的 fileSize 通常已置 0，扫了也没意义
      options.predicate = NSPredicate(format: "isHidden == NO")

      let fetchResult = PHAsset.fetchAssets(with: .image, options: options)
      var items: [[String: Any]] = []
      items.reserveCapacity(fetchResult.count)

      fetchResult.enumerateObjects { (asset, _, _) in
        items.append(Self.assetToDict(asset))
      }

      DispatchQueue.main.async {
        resolve(["count": items.count, "items": items])
      }
    }
  }

  // MARK: - 请求图片为本地 file:// URL（绕过缺失的 ph:// 图片 loader）

  /// 把 PHAsset 解码为缓存 jpg/heic，返回 file:// URL。
  /// RN <Image source={{uri:"ph://..."}}/> 在无 cameraroll 时报 "no suitable URL loader"，
  /// 走这条把原图导出到 NSTemporaryDirectory，给 <Image> 一个能直接渲染的本地 URL。
  @objc(requestImageFileURL:resolver:rejecter:)
  func requestImageFileURL(_ localIdentifier: String,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil)
    guard let asset = fetch.firstObject else {
      reject("E_NOT_FOUND", "asset not found for id \(localIdentifier)", nil)
      return
    }
    let options = PHImageRequestOptions()
    options.isSynchronous = false
    options.deliveryMode = .highQualityFormat
    options.isNetworkAccessAllowed = true
    options.version = .current
    PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, uti, _, info in
      DispatchQueue.global(qos: .userInitiated).async {
        if let err = info?[PHImageErrorKey] as? NSError {
          DispatchQueue.main.async { reject("E_FETCH_FAILED", err.localizedDescription, err) }
          return
        }
        guard let data = data else {
          DispatchQueue.main.async { reject("E_NO_DATA", "no image data returned", nil) }
          return
        }
        // 缀名：HEIC → jpg（多数 <Image> 不解 HEIC 渲染会黑屏），其它按 UTI 简单映射
        let utiStr = (uti ?? "") as String
        let ext: String =
          utiStr.contains("png") ? "png" :
          utiStr.contains("gif") ? "gif" :
          "jpg"
        let safeId = localIdentifier.replacingOccurrences(of: "/", with: "_")
        let tmpDir = NSTemporaryDirectory() as NSString
        let path = tmpDir.appendingPathComponent("phasset_\(safeId).\(ext)")
        // 已经存在就复用，省一次 IO
        if !FileManager.default.fileExists(atPath: path) {
          // HEIC → JPEG（用 ImageIO 转码）
          var finalData = data
          if utiStr.contains("heic") || utiStr.contains("heif") {
            if let cg = UIImage(data: data)?.cgImage,
               let jpeg = UIImage(cgImage: cg).jpegData(compressionQuality: 0.92) {
              finalData = jpeg
            }
          }
          do {
            try finalData.write(to: URL(fileURLWithPath: path), options: .atomic)
          } catch {
            DispatchQueue.main.async { reject("E_WRITE_FAILED", error.localizedDescription, error) }
            return
          }
        }
        DispatchQueue.main.async {
          resolve(["uri": "file://\(path)", "path": path])
        }
      }
    }
  }

  // MARK: - 删除（系统会自动弹原生授权对话框，用户同意即真删）

  @objc(deleteAssets:resolver:rejecter:)
  func deleteAssets(_ identifiers: [String],
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
    let assets = PHAsset.fetchAssets(withLocalIdentifiers: identifiers, options: nil)
    if assets.count == 0 {
      resolve(["success": true, "deleted": 0])
      return
    }
    PHPhotoLibrary.shared().performChanges({
      PHAssetChangeRequest.deleteAssets(assets)
    }) { success, error in
      DispatchQueue.main.async {
        if success {
          resolve(["success": true, "deleted": assets.count])
        } else {
          let code = (error as NSError?)?.code == 3072 ? "E_USER_CANCELLED" : "E_DELETE_FAILED"
          reject(code, error?.localizedDescription ?? "delete failed", error)
        }
      }
    }
  }
}
