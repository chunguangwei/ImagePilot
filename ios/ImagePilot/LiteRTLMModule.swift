//
//  LiteRTLMModule.swift —— iOS 本地多模态分类档（VLM tier）的原生运行时。
//
//  用 Google LiteRT-LM 加载 Gemma4-E2B（.litertlm），看图 → 出"描述+分类"文本。
//  与安卓 GemmaModule.java 对称：本模块只做「跑一次推理(模型路径, 图片路径, prompt) → 返回原始文本」，
//  prompt 构建与解析在 JS（vlmShared.js，与安卓共享）。这样 iOS / Android 统一到同一模型同一逻辑。
//
//  后端 GPU→CPU 自动回退；Engine 单例缓存；推理用 actor 串行（Conversation 单租户、避免并发数据竞争）。
//  引擎初始化失败（GPU & CPU 都挂，通常是内存不足 / 机型不支持）→ 抛 E_LOAD，
//  JS 侧据此 markVlmUnsupported → 设置页禁用该变体、分类回退 basic。
//

import Foundation
import React
import UIKit
// 注：LiteRT-LM 的 Swift 封装源（Engine/EngineConfig/Message/Content/Backend/...）直接编进了
// ImagePilot app target（不走 pod），故这里无需 `import LiteRTLM`，类型同模块直接可见。
// 底层 C API 由 CLiteRTLM.xcframework 提供（封装源内部 `import CLiteRTLM`）。

/// 运行期错误：区分「引擎初始化失败(可禁用)」与「推理失败」。
enum LiteRTLMRunnerError: Error {
  case engineInit(String)
}

/// 用 actor 持有并串行化 Engine —— Engine 本身是 actor，但缓存字段(engine/modelPath)需要串行访问；
/// 分类是逐张串行调用，并发极低，actor 足够。
actor LiteRTLMRunner {
  private var engine: Engine?
  private var engineModelPath: String?
  private(set) var backend: String = ""

  /// 确保 Engine 就绪（GPU 优先，失败回退 CPU）。两种后端都失败 → 抛 engineInit。
  func ensureEngine(_ modelPath: String) async throws -> Engine {
    if let e = engine, engineModelPath == modelPath { return e }
    await releaseEngine()

    // iOS 实测（iPhone 13/4GB）：GPU(Metal) 无论作主后端还是视觉后端，都会让 createConversation
    // 失败或卡死(probe 挂住)；唯有「主+视觉都用 CPU」能跑通(conf=0.9+正确描述)。iOS 端 Gemma 固定全 CPU
    // ——慢但可用；GPU 这条路在 iOS LiteRT-LM 上目前走不通。maxNumTokens 4096；不传 cacheDir。
    do {
      let cfg = try EngineConfig(
        modelPath: modelPath,
        backend: .cpu(),
        visionBackend: .cpu(),
        maxNumTokens: 4096
      )
      let e = Engine(engineConfig: cfg)
      try await e.initialize()   // 耗时操作（CPU 加载 2.5GB 模型可达 30s+），已在后台 Task 中
      engine = e
      engineModelPath = modelPath
      backend = "cpu"
      NSLog("[LiteRTLM] Engine ready backend=cpu")
      return e
    } catch {
      throw LiteRTLMRunnerError.engineInit("\(error)")
    }
  }

  func releaseEngine() async {
    // 置 nil → Engine.deinit 释放底层 native engine。
    engine = nil
    engineModelPath = nil
    backend = ""
  }

  /// 看图出文本：确保引擎 → 建会话 → [图 + prompt] → sendMessage → 拼接文本。
  func classify(modelPath: String, imagePath: String, prompt: String) async throws -> String {
    let e = try await ensureEngine(modelPath)
    let sampler = try SamplerConfig(topK: 40, topP: 0.95, temperature: 0.2)
    let conv = try await e.createConversation(with: ConversationConfig(samplerConfig: sampler))
    let message = Message(contents: [.imageFile(imagePath), .text(prompt)])
    let resp = try await conv.sendMessage(message)
    return resp.toString
  }
}

@objc(LiteRTLMModule)
class LiteRTLMModule: NSObject {
  private let runner = LiteRTLMRunner()

  @objc static func requiresMainQueueSetup() -> Bool { return false }

  /// classify(modelPath, imagePath, prompt) → 原始文本。多秒级，全程后台。
  @objc(classify:imagePath:prompt:resolver:rejecter:)
  func classify(_ modelPath: String,
                imagePath: String,
                prompt: String,
                resolver resolve: @escaping RCTPromiseResolveBlock,
                rejecter reject: @escaping RCTPromiseRejectBlock) {
    let mp = LiteRTLMModule.stripScheme(modelPath)
    let ip = LiteRTLMModule.stripScheme(imagePath)
    Task {
      do {
        guard FileManager.default.fileExists(atPath: mp) else {
          reject("E_LOAD", "model not found: \(mp)", nil)
          return
        }
        let text = try await runner.classify(modelPath: mp, imagePath: ip, prompt: prompt)
        resolve(text)
      } catch let err as LiteRTLMRunnerError {
        if case .engineInit(let msg) = err {
          reject("E_LOAD", "engine init failed: \(msg)", nil)
        } else {
          reject("E_INFER", "\(err)", err)
        }
      } catch {
        reject("E_INFER", "\(error)", error)
      }
    }
  }

  /// 释放 Engine（换模型 / 退出时）。
  @objc(release:rejecter:)
  func release(_ resolve: @escaping RCTPromiseResolveBlock,
               rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      await runner.releaseEngine()
      resolve(true)
    }
  }

  private static func stripScheme(_ p: String) -> String {
    return p.hasPrefix("file://") ? String(p.dropFirst(7)) : p
  }
}
