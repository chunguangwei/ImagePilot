//
//  LiteRTLMModule.m —— LiteRTLMModule.swift 的 RN 桥接声明（RCT_EXTERN_MODULE）。
//  方法签名与 Swift 端 @objc 选择器一一对应。
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LiteRTLMModule, NSObject)

RCT_EXTERN_METHOD(classify:(NSString *)modelPath
                  imagePath:(NSString *)imagePath
                  prompt:(NSString *)prompt
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(release:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
