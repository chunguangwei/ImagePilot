// 空模块：用于在 RN/Hermes 下给 @jimp/core 的 require('fs')/require('path') 兜底。
// @jimp/core 仅在「按文件路径读写」的函数内部用到 fs/path（有 typeof 守卫），
// 我们只用 Buffer 解码 + getBase64Async，绝不触发这些分支，故空对象足矣。
module.exports = {};
