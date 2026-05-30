//
//  PhotoKitImageLoader.m
//  ImagePilot
//
//  RN <Image source={{uri:"ph://..."}}/> 的 URL loader。
//  没有 cameraroll 依赖时，RN 默认不识别 ph://；自己装一个 loader 直接走 PHImageManager，
//  对上层 JS 透明（所有 <Image>/<FastImage> 都能直接渲染 PHAsset）。
//
//  性能：
//    - sUIImageCache：按 "localId|w|h|mode" 缓存解码后的 UIImage（NSCache 自动响应
//      内存压力清理）。同一张图在列表里反复出现/重渲染时直接命中，无需 PHImageManager
//    - sAssetCache：按 localId 缓存 PHAsset，省 fetchAssetsWithLocalIdentifiers 的开销
//    - degraded 阶段不写 UIImage 缓存（避免 cache 住低清图）
//
//  实现要点：
//    - 实现 RCTImageURLLoader 协议（priority + canLoadImageURL + loadImageForURL）
//    - canLoadImageURL：URL scheme 是 ph 就返回 true
//    - loadImageForURL：把 ph://<localIdentifier> 解析为 PHAsset，调 requestImageForAsset
//      按目标尺寸返回 UIImage；resizeMode 决定 PHImageContentMode.aspectFit / aspectFill
//    - 取消：返回的 cancellation block 调 PHImageManager.cancelImageRequest
//

#import <Foundation/Foundation.h>
#import <Photos/Photos.h>
#import <UIKit/UIKit.h>
#import <React/RCTImageURLLoader.h>
#import <React/RCTUtils.h>

@interface PhotoKitImageLoader : NSObject <RCTImageURLLoader>
@end

@implementation PhotoKitImageLoader

RCT_EXPORT_MODULE()

// 静态缓存：进程生命周期共享。NSCache 在内存吃紧时会自动 evict，且线程安全。
static NSCache<NSString *, UIImage *> *sUIImageCache;
static NSCache<NSString *, PHAsset *> *sAssetCache;

+ (void)initialize {
  if (self != [PhotoKitImageLoader class]) return;
  sUIImageCache = [NSCache new];
  // 估算：~50 张满分辨率屏幕缩略图，每张 ~200KB，~10MB 上限。
  // NSCache 也按 totalCostLimit 自动 evict，cost 单位 = 字节。
  sUIImageCache.totalCostLimit = 32 * 1024 * 1024; // 32MB
  sUIImageCache.countLimit = 256;
  sAssetCache = [NSCache new];
  sAssetCache.countLimit = 1024;
}

- (BOOL)canLoadImageURL:(NSURL *)requestURL {
  return [requestURL.scheme caseInsensitiveCompare:@"ph"] == NSOrderedSame;
}

- (float)loaderPriority { return 2.0; }

- (RCTImageLoaderCancellationBlock)loadImageForURL:(NSURL *)imageURL
                                              size:(CGSize)size
                                             scale:(CGFloat)scale
                                        resizeMode:(RCTResizeMode)resizeMode
                                   progressHandler:(RCTImageLoaderProgressBlock)progressHandler
                                partialLoadHandler:(RCTImageLoaderPartialLoadBlock)partialLoadHandler
                                 completionHandler:(RCTImageLoaderCompletionBlock)completionHandler {

  // ph://<localIdentifier> —— iOS 的 localIdentifier 形如 "ABCD-1234/L0/001"
  // URL absoluteString 整体去掉 "ph://" 前缀就是 localIdentifier
  NSString *abs = imageURL.absoluteString ?: @"";
  NSString *localId = nil;
  if ([abs hasPrefix:@"ph://"]) {
    localId = [abs substringFromIndex:5];
  }
  if (localId.length == 0) {
    completionHandler(RCTErrorWithMessage(@"PhotoKitImageLoader: empty localIdentifier"), nil);
    return ^{};
  }

  // size 是 RN 期望的渲染尺寸（点）。为节省内存按 scale 转像素。
  // size.width == 0 视为不限尺寸（取原图，但实际很少这样请求；列表/网格都有具体尺寸）
  CGSize targetSize;
  if (size.width > 0 && size.height > 0) {
    targetSize = CGSizeMake(size.width * scale, size.height * scale);
  } else {
    targetSize = PHImageManagerMaximumSize;
  }

  PHImageContentMode contentMode = (resizeMode == RCTResizeModeCover)
    ? PHImageContentModeAspectFill
    : PHImageContentModeAspectFit;

  // UIImage 缓存命中？
  NSString *cacheKey = [NSString stringWithFormat:@"%@|%d|%d|%d",
                        localId,
                        (int)targetSize.width,
                        (int)targetSize.height,
                        (int)contentMode];
  UIImage *cached = [sUIImageCache objectForKey:cacheKey];
  if (cached) {
    completionHandler(nil, cached);
    return ^{};
  }

  // PHAsset 缓存命中？没命中再走 fetchAssets
  PHAsset *asset = [sAssetCache objectForKey:localId];
  if (!asset) {
    PHFetchResult<PHAsset *> *fetch = [PHAsset fetchAssetsWithLocalIdentifiers:@[localId] options:nil];
    asset = fetch.firstObject;
    if (asset) {
      [sAssetCache setObject:asset forKey:localId];
    }
  }
  if (!asset) {
    completionHandler(RCTErrorWithMessage([NSString stringWithFormat:@"PhotoKitImageLoader: asset not found for %@", localId]), nil);
    return ^{};
  }

  PHImageRequestOptions *options = [PHImageRequestOptions new];
  options.deliveryMode = PHImageRequestOptionsDeliveryModeHighQualityFormat;
  options.networkAccessAllowed = YES;
  options.synchronous = NO;
  options.version = PHImageRequestOptionsVersionCurrent;

  PHImageRequestID requestID = [[PHImageManager defaultManager]
                                 requestImageForAsset:asset
                                 targetSize:targetSize
                                 contentMode:contentMode
                                 options:options
                                 resultHandler:^(UIImage * _Nullable result, NSDictionary * _Nullable info) {
    NSError *err = info[PHImageErrorKey];
    if (err) {
      completionHandler(err, nil);
      return;
    }
    if (!result) {
      // degraded=YES 阶段没拿到图就忽略，等下一次 callback
      BOOL isDegraded = [info[PHImageResultIsDegradedKey] boolValue];
      if (isDegraded) return;
      completionHandler(RCTErrorWithMessage(@"PhotoKitImageLoader: nil image result"), nil);
      return;
    }
    // 只缓存最终非降级图：避免列表里看到"先模糊→后清晰"中间态的模糊版被 cache 住
    BOOL isDegraded = [info[PHImageResultIsDegradedKey] boolValue];
    if (!isDegraded && result) {
      CGImageRef cg = result.CGImage;
      NSUInteger bytes = cg ? (NSUInteger)(CGImageGetWidth(cg) * CGImageGetHeight(cg) * 4) : 0;
      [sUIImageCache setObject:result forKey:cacheKey cost:bytes];
    }
    completionHandler(nil, result);
  }];

  return ^{
    [[PHImageManager defaultManager] cancelImageRequest:requestID];
  };
}

@end
