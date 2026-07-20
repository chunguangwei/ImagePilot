ImagePilot 1.5.78 更新要点

本次为稳定性修复版（续 1.5.77）：

• 修复「本地大模型离线分类刚完成、就突然闪退」的问题（Android）：
  分类跑完后，程序需要重建照片缓存，而此时占用约 2.5GB 内存的大模型引擎还没释放，两者叠加在收尾一刻把内存顶爆、被系统强杀，表现为「分类刚结束就崩溃退出」。
  现已把大模型内存的释放提前到重建缓存之前，收尾不再出现内存峰值。

如你此前遇到「离线分类完成瞬间闪退」，升级后即可正常使用。

感谢使用 ImagePilot，欢迎在「设置 → 检查更新」获取最新版本。

---

ImagePilot 1.5.78 — What's New

Stability fix (follow-up to 1.5.77):

• Fixed the app crashing right after on-device offline classification finished (Android):
  after classification, the app rebuilds its photo cache, but the ~2.5GB model engine had not been released yet — the two combined spiked memory at the very end and the system killed the app.
  The model's memory is now released before the cache rebuild, removing the tail-end memory peak.

If the app used to crash the moment offline classification finished, it should work correctly after updating.
