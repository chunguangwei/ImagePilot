//
//  PhotoKitImageLoader.m
//  ImagePilot
//
//  RN <Image source={{uri:"ph://..."}}/> 的 URL loader。
//  没有 cameraroll 依赖时，RN 默认不识别 ph://；自己装一个 loader 直接走 PHImageManager，
//  对上层 JS 透明（所有 <Image>/<FastImage> 都能直接渲染 PHAsset）。
//
//  实现要点：
//    - 实现 RCTImageURLLoader 协议（priority + canLoadImageURL + loadImageForURL）
//    - canLoadImageURL：URL scheme 是 ph 就返回 true
//    - loadImageForURL：把 ph://<localIdentifier> 解析为 PHAsset，调 requestImageForAsset
//      按目标尺寸返回 UIImage；resizeMode 决定 PHImageContentMode.aspectFit / aspectFill
//    - 取消：返回的 cancellation block 调 PHImageManager.cancelImageRequest
//
//  参考 react-native-cameraroll 的 RNCAssetsLibraryRequestHandler，但这里只针对 ph://，
//  没有 assets-library:// 旧路径——iOS 11+ 已废弃。
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

  PHFetchResult<PHAsset *> *fetch = [PHAsset fetchAssetsWithLocalIdentifiers:@[localId] options:nil];
  PHAsset *asset = fetch.firstObject;
  if (!asset) {
    completionHandler(RCTErrorWithMessage([NSString stringWithFormat:@"PhotoKitImageLoader: asset not found for %@", localId]), nil);
    return ^{};
  }

  // size 是 RN 期望的渲染尺寸（点）。为节省内存按 scale 转像素。
  // size.width == 0 视为不限尺寸（取原图）
  CGSize targetSize = CGSizeZero;
  if (size.width > 0 && size.height > 0) {
    targetSize = CGSizeMake(size.width * scale, size.height * scale);
  } else {
    targetSize = PHImageManagerMaximumSize;
  }

  PHImageRequestOptions *options = [PHImageRequestOptions new];
  options.deliveryMode = PHImageRequestOptionsDeliveryModeHighQualityFormat;
  options.networkAccessAllowed = YES;
  options.synchronous = NO;
  options.version = PHImageRequestOptionsVersionCurrent;

  PHImageContentMode contentMode = (resizeMode == RCTResizeModeCover)
    ? PHImageContentModeAspectFill
    : PHImageContentModeAspectFit;

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
    completionHandler(nil, result);
  }];

  return ^{
    [[PHImageManager defaultManager] cancelImageRequest:requestID];
  };
}

@end
