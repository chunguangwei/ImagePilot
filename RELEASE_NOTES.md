ImagePilot 1.5.77 更新要点

本次为稳定性修复版：

• 修复「本地大模型（端侧 Gemma）分类时 App 崩溃退出」的问题（Android）：
  - 端侧推理改为 CPU 稳定模式，规避部分机型 GPU 驱动在推理时导致的整机崩溃退出；
  - 新增可用内存实时校验并提高机型内存门槛（仅 4GB+ 机型开放本地大模型），避免加载 2.5GB 模型时被系统强杀；
  - 分类完成后自动释放大模型占用的内存，连续分类不再越用越卡、越用越易崩。

如你此前遇到「用本地大模型分类会闪退」，升级后即可正常使用。

感谢使用 ImagePilot，欢迎在「设置 → 检查更新」获取最新版本。

---

ImagePilot 1.5.77 — What's New

Stability fix:

• Fixed the app crashing/exiting during on-device large-model (Gemma) classification on Android:
  - On-device inference now runs in a stable CPU mode, avoiding whole-app crashes caused by some devices' GPU drivers during inference;
  - Added a runtime available-memory check and raised the device memory gate (on-device large model is now offered on 4GB+ devices only), preventing the system from killing the app while loading the ~2.5GB model;
  - The model's memory is now released after classification, so repeated runs no longer get slower or crash-prone.

If on-device large-model classification used to crash for you, it should work correctly after updating.
