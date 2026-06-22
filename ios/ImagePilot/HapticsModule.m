//
//  HapticsModule.m
//  ImagePilot
//
//  Obj-C 桥接——把 Swift 的 @objc(HapticsModule) 暴露给 RN 桥。
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(HapticsModule, NSObject)

RCT_EXTERN_METHOD(impact:(NSString *)style
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(notification:(NSString *)type
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(selection:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(totalMemoryMB:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setKeepAwake:(BOOL)enable
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
