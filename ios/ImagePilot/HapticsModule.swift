//
//  HapticsModule.swift
//  ImagePilot
//
//  iOS 触觉反馈：UIImpactFeedbackGenerator / UINotificationFeedbackGenerator /
//  UISelectionFeedbackGenerator 包装给 JS 用。iOS 10+。
//
//  设计：
//    - 不在 JS 侧做平台判断——Android/Web 走 WebAdapters 的 no-op 实现就行
//    - 每次新建 generator 用完就丢；UIKit 自己做轻量复用，没必要 JS 端 cache
//    - 全部在 main queue（UIKit 要求），切线程之后再调；不阻塞 JS
//

import Foundation
import UIKit
import React

@objc(HapticsModule)
class HapticsModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  /// 撞击型反馈：light / medium / heavy（iOS 10+），soft / rigid（iOS 13+ 这里就当 light/heavy）
  @objc(impact:resolver:rejecter:)
  func impact(_ style: NSString,
              resolver resolve: @escaping RCTPromiseResolveBlock,
              rejecter reject: @escaping RCTPromiseRejectBlock) {
    let s = (style as String).lowercased()
    DispatchQueue.main.async {
      let mapped: UIImpactFeedbackGenerator.FeedbackStyle
      switch s {
      case "heavy", "rigid": mapped = .heavy
      case "medium":          mapped = .medium
      default:                mapped = .light
      }
      let gen = UIImpactFeedbackGenerator(style: mapped)
      gen.prepare()
      gen.impactOccurred()
      resolve(nil)
    }
  }

  /// 通知型反馈：success / warning / error（语义化，系统会选不同的震动 pattern）
  @objc(notification:resolver:rejecter:)
  func notification(_ type: NSString,
                    resolver resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
    let t = (type as String).lowercased()
    DispatchQueue.main.async {
      let mapped: UINotificationFeedbackGenerator.FeedbackType
      switch t {
      case "warning": mapped = .warning
      case "error":   mapped = .error
      default:        mapped = .success
      }
      let gen = UINotificationFeedbackGenerator()
      gen.prepare()
      gen.notificationOccurred(mapped)
      resolve(nil)
    }
  }

  /// 选择型反馈：列表/滚轮里"选中条目跳变"的极轻震动
  @objc(selection:rejecter:)
  func selection(_ resolve: @escaping RCTPromiseResolveBlock,
                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      let gen = UISelectionFeedbackGenerator()
      gen.prepare()
      gen.selectionChanged()
      resolve(nil)
    }
  }
}
