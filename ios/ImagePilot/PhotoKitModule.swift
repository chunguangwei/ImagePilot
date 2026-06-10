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
import ImageIO
import Photos
import PhotosUI
import React
import UIKit
import AVKit

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
      opts.predicate = NSPredicate(format: "isHidden == NO AND (mediaType == %d OR mediaType == %d)",
                                   PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
      self.observerFetchResult = PHAsset.fetchAssets(with: opts)
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
    let isVideo = asset.mediaType == .video
    let resources = PHAssetResource.assetResources(for: asset)
    let primary = isVideo
      ? (resources.first(where: { $0.type == .video || $0.type == .fullSizeVideo }) ?? resources.first)
      : (resources.first(where: { $0.type == .photo || $0.type == .fullSizePhoto }) ?? resources.first)
    let fileName = primary?.originalFilename ?? "\(asset.localIdentifier)\(isVideo ? ".mov" : ".jpg")"
    let fileSize = (primary?.value(forKey: "fileSize") as? Int64) ?? 0
    let takenAt = Int64((asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000)
    // PhotoKit mediaSubtypes 暴露的系统级标记（私有 vision 标签拿不到，只能用这些）
    let subtypes = asset.mediaSubtypes
    let isScreenshot = subtypes.contains(.photoScreenshot)
    let isPanorama = subtypes.contains(.photoPanorama)
    let isHDR = subtypes.contains(.photoHDR)
    let isLive = subtypes.contains(.photoLive)
    let isDepthEffect = subtypes.contains(.photoDepthEffect) // 人像模式
    let isBurst = asset.representsBurst

    let lowerName = fileName.lowercased()
    let mimeType: String = isVideo
      ? (lowerName.hasSuffix(".mp4") ? "video/mp4" : lowerName.hasSuffix(".m4v") ? "video/x-m4v" : "video/quicktime")
      : (lowerName.hasSuffix(".png") ? "image/png" :
         lowerName.hasSuffix(".heic") ? "image/heic" :
         lowerName.hasSuffix(".gif") ? "image/gif" :
         "image/jpeg")

    // GPS：PHAsset.location 是 CLLocation?，由系统从原图 EXIF 抽好缓存在 Photos DB 里——
    // 拿它比我们自己解 EXIF 快几个数量级（不用打开图像数据）。
    // horizontalAccuracy < 0 时坐标是无效的（CoreLocation 约定），按缺失处理。
    var lat: NSNumber? = nil
    var lng: NSNumber? = nil
    var alt: NSNumber? = nil
    var acc: NSNumber? = nil
    if let loc = asset.location, loc.horizontalAccuracy >= 0 {
      lat = NSNumber(value: loc.coordinate.latitude)
      lng = NSNumber(value: loc.coordinate.longitude)
      if loc.verticalAccuracy >= 0 {
        alt = NSNumber(value: loc.altitude)
      }
      acc = NSNumber(value: loc.horizontalAccuracy)
    }

    var dict: [String: Any] = [
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
      // 新增：iOS 系统能告诉我们的拍摄类型（用于 model fail 时的兜底分类）
      "isPanorama": isPanorama,
      "isHDR": isHDR,
      "isLive": isLive,
      "isDepthEffect": isDepthEffect,
      "isBurst": isBurst,
      // 视频：isVideo 标记 + 时长(秒)。uri 仍是 ph://，PhotoKit 对视频会返回封面帧作缩略图。
      "isVideo": isVideo,
      "duration": isVideo ? asset.duration : 0,
    ]
    // 把 nil 字段交给 JS 层默认值（toImageRecord），不在 dict 里塞 NSNull
    if let lat = lat { dict["latitude"] = lat }
    if let lng = lng { dict["longitude"] = lng }
    if let alt = alt { dict["altitude"] = alt }
    if let acc = acc { dict["accuracy"] = acc }
    return dict
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
      // 排除已"最近删除"里的图；同时纳入图片 + 视频（视频后续显示缩略图+手动分类）。
      options.predicate = NSPredicate(format: "isHidden == NO AND (mediaType == %d OR mediaType == %d)",
                                      PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)

      let fetchResult = PHAsset.fetchAssets(with: options)
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

  // MARK: - 视频抽帧（自动分类用）

  /// 取视频时长中点的一帧，存为 ≤1024px 的临时 JPEG，返回 file:// 路径。
  /// 用于视频自动分类：中间帧 → 现有图片分类链路（封面帧常是黑场，中点更具代表性）。
  @objc(extractVideoFrame:resolver:rejecter:)
  func extractVideoFrame(_ localIdentifier: String,
                         resolver resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil)
    guard let asset = fetch.firstObject, asset.mediaType == .video else {
      reject("E_NO_VIDEO", "未找到该视频", nil); return
    }
    let opts = PHVideoRequestOptions()
    opts.isNetworkAccessAllowed = true   // 允许拉 iCloud 视频
    opts.deliveryMode = .fastFormat      // 抽帧不需要高码率
    PHImageManager.default().requestAVAsset(forVideo: asset, options: opts) { avAsset, _, _ in
      guard let avAsset = avAsset else { reject("E_LOAD", "无法加载视频资源", nil); return }
      let gen = AVAssetImageGenerator(asset: avAsset)
      gen.appliesPreferredTrackTransform = true
      gen.maximumSize = CGSize(width: 1024, height: 1024)
      // 容差 ±1s：允许就近取关键帧，避免逐帧解码慢
      let tol = CMTime(seconds: 1, preferredTimescale: 600)
      gen.requestedTimeToleranceBefore = tol
      gen.requestedTimeToleranceAfter = tol
      let mid = CMTimeMultiplyByFloat64(avAsset.duration, multiplier: 0.5)
      do {
        let cg = try gen.copyCGImage(at: mid, actualTime: nil)
        guard let data = UIImage(cgImage: cg).jpegData(compressionQuality: 0.85) else {
          reject("E_JPEG", "帧编码失败", nil); return
        }
        let path = NSTemporaryDirectory() + "vframe_\(abs(localIdentifier.hashValue)).jpg"
        try data.write(to: URL(fileURLWithPath: path))
        resolve("file://" + path)
      } catch {
        reject("E_FRAME", error.localizedDescription, error)
      }
    }
  }

  // MARK: - 播放视频（系统播放器 AVPlayerViewController）

  /// 用系统播放器播放指定 localIdentifier 的视频（支持 iCloud 下载）。
  @objc(playVideo:resolver:rejecter:)
  func playVideo(_ localIdentifier: String,
                 resolver resolve: @escaping RCTPromiseResolveBlock,
                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil)
    guard let asset = fetch.firstObject, asset.mediaType == .video else {
      reject("E_NO_VIDEO", "未找到该视频", nil); return
    }
    let opts = PHVideoRequestOptions()
    opts.isNetworkAccessAllowed = true   // 允许下载 iCloud 视频
    opts.deliveryMode = .automatic
    PHImageManager.default().requestPlayerItem(forVideo: asset, options: opts) { playerItem, _ in
      DispatchQueue.main.async {
        guard let playerItem = playerItem else { reject("E_PLAY", "无法加载视频", nil); return }
        let player = AVPlayer(playerItem: playerItem)
        let vc = AVPlayerViewController()
        vc.player = player
        guard let root = Self.topViewController() else { reject("E_NO_VC", "无可用控制器", nil); return }
        root.present(vc, animated: true) { player.play() }
        resolve(true)
      }
    }
  }

  /// 找当前最顶层 VC 用于 present。
  private static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let keyWindow = scenes.flatMap { $0.windows }.first(where: { $0.isKeyWindow })
      ?? scenes.first?.windows.first
    var top = keyWindow?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
  }

  // MARK: - Limited Library Picker（iOS 14+，"仅允许部分照片"层级专用）

  /// 当授权层级是 .limited 时，弹原生选择器让用户增删可被 app 看见的照片。
  /// 用户在选择器里加/减照片后，PHPhotoLibraryChangeObserver 会自动推送 diff，
  /// 走我们的增量监听管线落 DB + 刷 UI——不用 JS 再手动 fetchAllPhotos。
  ///
  /// 不是 limited 状态时直接 resolve 走，主要 fail-soft：
  ///   - 系统已经是 authorized：没东西可选
  ///   - denied / restricted：本身就拿不到，跳系统设置才对（JS 侧已经做）
  @objc(presentLimitedLibraryPicker:rejecter:)
  func presentLimitedLibraryPicker(_ resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    if #available(iOS 14, *) {
      DispatchQueue.main.async {
        // 取当前 keyWindow 的 rootVC——RN 的 app 只有一个 window，第一个 keyWindow 就是它
        let rootVC: UIViewController? = UIApplication.shared.connectedScenes
          .compactMap { $0 as? UIWindowScene }
          .flatMap { $0.windows }
          .first(where: { $0.isKeyWindow })?
          .rootViewController
        // 走到顶层 presentedViewController，避免在已 present 的 RN modal 上叠 present
        var presenter = rootVC
        while let p = presenter?.presentedViewController { presenter = p }

        guard let host = presenter else {
          reject("E_NO_VIEWCONTROLLER", "无法定位当前 view controller", nil)
          return
        }

        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .limited else {
          // 非 limited 状态本来就不该弹，直接成功返回，由 JS 侧决定下一步
          resolve(["presented": false, "status": Self.statusString(status)])
          return
        }

        PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: host)
        // PhotoKit 没回调；用户调整后变化由 PHPhotoLibraryChangeObserver 自动推
        resolve(["presented": true, "status": "limited"])
      }
    } else {
      reject("E_UNSUPPORTED", "presentLimitedLibraryPicker 需要 iOS 14+", nil)
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

  // MARK: - 保存到相册（修图/AI 增强结果写回照片库）

  /// 把本地文件保存到照片库。Android 端用 MediaStoreModule.saveImageToGallery 干同样的事；
  /// iOS 这边没有等价 RN 库，所以走自家原生：PHAssetCreationRequest.addResource(.photo, fileURL:)
  /// —— 系统会自动保留 EXIF/HEIC 元数据，并把新照片放到「相机胶卷」里。
  ///
  /// 入参：
  ///   sourcePath — 本地路径，支持 "file://..." 前缀；其它任何形式（http/data URI）请先 JS 侧落到本地再调
  ///   fileName   — 可选；iOS 系统按 EXIF/创建时间自己起名，这个字段只用于回报，不影响实际存储
  /// 出参：{ uri, fileName, localIdentifier } —— 与 Android 端形状对齐
  @objc(saveImageToGallery:fileName:resolver:rejecter:)
  func saveImageToGallery(_ sourcePath: String,
                          fileName: String?,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    // 兼容 "file://" 前缀；其它形式拒绝（不在 iOS 这层做下载/解码）
    let trimmed = sourcePath.hasPrefix("file://") ? String(sourcePath.dropFirst(7)) : sourcePath
    if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") || trimmed.hasPrefix("data:") {
      reject("E_UNSUPPORTED_URI", "saveImageToGallery 只接受本地文件路径，请先把数据落到磁盘", nil)
      return
    }
    guard FileManager.default.fileExists(atPath: trimmed) else {
      reject("E_FILE_NOT_FOUND", "源文件不存在: \(trimmed)", nil)
      return
    }
    let fileURL = URL(fileURLWithPath: trimmed)
    let finalName = fileName ?? fileURL.lastPathComponent

    let proceed = {
      var placeholder: PHObjectPlaceholder?
      PHPhotoLibrary.shared().performChanges({
        // 用 addResource 而不是 creationRequestForAssetFromImage —— 后者会先解码再重编码
        // 成 JPEG，HEIC/PNG 元数据/质量会丢；addResource 原样落盘，跟 Android 端 MediaStore
        // 拷字节的行为一致。
        let req = PHAssetCreationRequest.forAsset()
        req.addResource(with: .photo, fileURL: fileURL, options: nil)
        placeholder = req.placeholderForCreatedAsset
      }) { success, error in
        DispatchQueue.main.async {
          if success, let id = placeholder?.localIdentifier {
            resolve([
              "uri": "ph://\(id)",
              "fileName": finalName,
              "localIdentifier": id,
            ])
          } else {
            reject("E_SAVE_FAILED", error?.localizedDescription ?? "save failed", error)
          }
        }
      }
    }

    // iOS 14+：用 .addOnly 精细权限弹「只允许添加」，比 .readWrite 体验好（不需要读权限）
    if #available(iOS 14, *) {
      let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
      switch status {
      case .authorized, .limited:
        proceed()
      case .notDetermined:
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { newStatus in
          if newStatus == .authorized || newStatus == .limited {
            proceed()
          } else {
            reject("E_PERMISSION_DENIED", "未授予相册写入权限（系统设置 → ImagePilot → 照片 → 添加照片）", nil)
          }
        }
      default:
        reject("E_PERMISSION_DENIED", "未授予相册写入权限（系统设置 → ImagePilot → 照片 → 添加照片）", nil)
      }
    } else {
      let status = PHPhotoLibrary.authorizationStatus()
      if status == .authorized {
        proceed()
      } else if status == .notDetermined {
        PHPhotoLibrary.requestAuthorization { newStatus in
          if newStatus == .authorized { proceed() }
          else { reject("E_PERMISSION_DENIED", "未授予相册访问权限", nil) }
        }
      } else {
        reject("E_PERMISSION_DENIED", "未授予相册访问权限", nil)
      }
    }
  }

  // MARK: - EXIF 拍参提取（光圈/快门/ISO/焦距）—— 与 Android GalleryScanService 对齐

  /// 批量读 PHAsset EXIF：每张走 PHImageManager.requestImageDataAndOrientation 拿原图数据，
  /// 再用 CGImageSource 解 EXIF 字典。**这是 PhotoKit 提取拍参的标准路径**——PHAsset
  /// 本身不暴露拍参（只有 location / mediaSubtypes 等），所以必须读原图字节。
  ///
  /// 性能：单张约 30~100ms（HEIC 主要在 CGImageSource 解码 header）。原生侧串行（同步选项 +
  /// background queue），JS 侧建议每 50 张一批走、给进度回调，避免长时间无反馈。
  ///
  /// 入参：identifiers — 一批 PHAsset.localIdentifier
  /// 出参：
  ///   { results: { <localId>: { iso, aperture, shutterSpeed, focalLength } }, total, success, missing }
  ///   只回填实际能读到的字段；4 个字段都缺则 results 不带该 localId。
  @objc(fetchAssetsExif:resolver:rejecter:)
  func fetchAssetsExif(_ identifiers: [String],
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    if identifiers.isEmpty {
      resolve(["results": [String: Any](), "total": 0, "success": 0, "missing": 0])
      return
    }
    DispatchQueue.global(qos: .userInitiated).async {
      let assets = PHAsset.fetchAssets(withLocalIdentifiers: identifiers, options: nil)
      var resultDict: [String: [String: Any]] = [:]
      var missing = 0

      let manager = PHImageManager.default()
      let opts = PHImageRequestOptions()
      opts.version = .original         // 原图字节（含 EXIF），不带 Photos 编辑链上的转码
      opts.deliveryMode = .highQualityFormat
      opts.isNetworkAccessAllowed = false // 不主动下 iCloud，避免悄悄 burn 流量；JS 上层提示用户
      opts.isSynchronous = true        // 已在 background queue，串行即可

      assets.enumerateObjects { (asset, _, _) in
        var got = false
        manager.requestImageDataAndOrientation(for: asset, options: opts) { (data, _, _, _) in
          guard let data = data,
                let src = CGImageSourceCreateWithData(data as CFData, nil),
                let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
                let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] else {
            return
          }

          var settings: [String: Any] = [:]
          // ISO：EXIF 给数组（系统拍摄一般 1 个值），取首
          if let isoArr = exif[kCGImagePropertyExifISOSpeedRatings] as? [NSNumber], let first = isoArr.first?.intValue, first > 0 {
            settings["iso"] = first
          } else if let isoSingle = exif[kCGImagePropertyExifISOSpeedRatings] as? NSNumber, isoSingle.intValue > 0 {
            settings["iso"] = isoSingle.intValue
          }
          // 光圈 fNumber：CFNumber double
          if let f = exif[kCGImagePropertyExifFNumber] as? NSNumber {
            let v = f.doubleValue
            if v > 0 { settings["aperture"] = v }
          }
          // 快门 ExposureTime：秒（如 1/125 → 0.008）
          if let t = exif[kCGImagePropertyExifExposureTime] as? NSNumber {
            let v = t.doubleValue
            if v > 0 { settings["shutterSpeed"] = v }
          }
          // 焦距 FocalLength：mm
          if let fl = exif[kCGImagePropertyExifFocalLength] as? NSNumber {
            let v = fl.doubleValue
            if v > 0 { settings["focalLength"] = v }
          }
          if !settings.isEmpty {
            resultDict[asset.localIdentifier] = settings
            got = true
          }
        }
        if !got { missing += 1 }
      }

      DispatchQueue.main.async {
        resolve([
          "results": resultDict,
          "total": assets.count,
          "success": resultDict.count,
          "missing": missing,
        ])
      }
    }
  }
}
