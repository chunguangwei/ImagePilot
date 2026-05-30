//
//  ImagePilot-Bridging-Header.h
//  ImagePilot
//
//  Swift 模块要调 RN 提供的 Obj-C 类型（RCTBridgeModule / RCTPromise*）就必须经过 bridging header。
//  在 Xcode build settings 里通过 SWIFT_OBJC_BRIDGING_HEADER 引用本文件。
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
