# Optional LFM image captions Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. Native implementation authorized by the user's accepted design.

**Goal:** Add an independently downloadable, default-off LFM2.5-VL-450M caption option beneath EmbeddingGemma, with Chinese and English output on Android and iOS.

**Architecture:** EmbeddingGemma still classifies. A second serial pass releases the embedding engine before loading llama.rn CPU inference, writes only successful captions to message, then releases the caption engine. No external API fallback.

**Tech Stack:** React Native 0.72, llama.rn 0.9.7 old architecture, official GGUF Q4_K_M language weights and F16 projector, existing resumable model downloader.

**Spec:** User-approved request in this conversation: optional Chinese/English LFM descriptions after EmbeddingGemma.

## Global Constraints
- Android and iOS CPU baseline, two inference threads, no GPU dependency.
- Independent model download; no automatic download during classification.
- Default disabled; language defaults to app language, explicit zh/en overrides.
- Keep existing descriptions on failure; no category template masquerading as a caption.
- Never edit .codeflicker/config.local.json.

## Review Focus
- Partial/corrupted model pair must not enable inference.
- Stop requests must not write partial captions or leak runtime/temp images.
- Each image clears LFM recurrent state; no previous-image contamination.
- Disabled setting must not load native runtime or download weights.
- Caption failure must not undo successful classification or erase message.

### Task 1: Model and inference service
Files: src/services/classify/lfmCaptionModel.js, LfmCaptionService.js, __tests__/LfmCaptionService.test.js.
Interfaces: captionModelReady(), downloadCaptionModel(onProgress, signal), deleteCaptionModel(); runCaptionPass(images, options) returns generated/failed/stopped counts.
- [x] Write failing tests for disabled/missing model, bilingual prompts, cache clearing, failure preservation, cancellation and release.
- [x] Implement integrity-checked pair downloads and serialized CPU caption pass.
- [x] Run targeted Jest suite.

### Task 2: Configuration and scanner integration
Files: src/components/LfmCaptionSettings.js, src/screens/mobile/SettingsScreen.mobile.js, src/services/GalleryScannerService.android.js, src/services/GalleryScannerService.ios.js.
- [x] Add default-off switch, zh/en/app language choices, download/progress/cancel/delete controls.
- [x] Collect successfully classified embedding images, release embedding runtime, then caption with shared service.
- [x] Preserve video-frame extraction and existing image-description storage/search.
- [ ] Check both platform bundles and native builds.

### Task 3: Documentation and verification
- [ ] Update feature/user/testing/runtime documentation and release notes with actual verified results.
- [ ] Run classification/update regression tests and native checks; review diff.
- [ ] Publish only after build verification; record limitations honestly.

## Verified runtime compatibility

The initial prebuilt runtime rejected the official 450M projector (missing optional input norm). Backported upstream optional norm handling in a version-checked postinstall script and enabled source builds for both platforms. Android uses explicit package registration. iOS uses single-window Scene lifecycle and CPU-only source runtime. Actual official-weight Chinese and English caption generation succeeded on the simulator, with zero failed images in both runs; this is not a phone thermal or performance benchmark.
