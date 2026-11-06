# 删除授权与 LFM 慢推理排查（随1.5.92发布）

## 用户反馈与定位

1.5.91 真机截图：机柜被 LFM 描述成“黑色玻璃门，内置食物和饮料”，随后分类为美食。这是视觉误识别与分类结果一致的错误，描述写入已正常，不能用补写描述修复。另一张显示图片处理 0.3 秒、推理 76.9 秒；现有推理墙钟时间包含视觉、提示处理、生成等，不能直接推断文字生成耗时。

代码当前使用 CPU 2 线程、GPU 关闭、图片最长边 512、分类输出最多 96 token。模型一次完成简述和分类；所有有效类别说明/自定义规则进入提示。没有证据证明换成 SmolVLM 能在同一手机更快或更准。

## 本次修正

- Android 11+ 单图和批量删除共用统一服务，优先调用 MediaStore.createDeleteRequest，在系统同意后才清理数据库和刷新缓存。目录批量删除以前只有 RNFS 直接删除，失败不触发系统授权。
- 接受 MediaStore content URI、contentURI||path、file URI 和绝对路径；路径查询同时支持图片和视频。一个批次一次系统确认；并发确认返回忙碌，不替换前一个 Promise。
- 系统取消保留记录，不重复请求授权、不显示删除成功。请求失败或数据库清理失败不报告完整成功。Android 10 及更早保持原路径，本次不宣称已完善其 RecoverableSecurityException 流程。
- LFM 增加原生 prompt_ms、predicted_ms、输入/输出 token 数和生成速率诊断，详情显示提示处理与文字生成耗时。它们不一定覆盖全部墙钟时间，不把差值简单解释成 OCR 或视觉编码。
- 未改模型权重、线程数、分辨率或默认模型，不宣称精度和速度已提升。

## SmolVLM 候选结论

[SmolVLM-500M-Instruct 官方模型卡](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct)标注英语，支持图文问答/描述，不能当作中文描述能力的直接升级。500M 是参数规模，不是量化后的安装包大小或运行内存。

[LFM2.5-VL-450M 官方模型卡](https://huggingface.co/LiquidAI/LFM2.5-VL-450M)声明包含中文；其对比表中的 SmolVLM2-500M 与用户提到的 SmolVLM-500M-Instruct 不是同一模型，不混用成绩。

建议在同一 Android 手机上，固定原图、输出长度、量化方式，比较分类准确率、描述错误、首张/连续推理延迟和温升后再决定替换。机柜、奖杯、人物、合影、宠物、食品只是回归样例，不能代表总体准确率。此处为最初评估；后续用户指定替换并测试，见 [SmolVLM实验记录](SmolVlmTrial.md)，最终实验不代表精度提升。

## 验证

新增删除同意、拒绝、请求失败、数据库失败的回归测试，以及 LFM 原生计时保存测试。23 套、171 项应用测试通过。Android 原生 Java 编译（JDK 17，compileDebugJavaWithJavac）通过，Android 生产 JS bundle 成功；尚未在用户 Android 真机确认系统授权弹窗。

参考：[Android 共享媒体删除授权](https://developer.android.com/training/data-storage/shared/media#remove-item)。相册读取权限不等于删除其它应用创建的媒体的权限。
