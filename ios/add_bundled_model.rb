# 把基础分类模型 mobilenetv3 加进 iOS App 资源包（Copy Bundle Resources）→ 随包、运行时
# 从 MainBundle 拷到本地缓存用（见 classifierModelSource.copyBundledModelIfPresent）。
# 引用 ../public/models 的现有文件，不在 ios/ 下复制副本。幂等。
require 'xcodeproj'

proj = Xcodeproj::Project.open(File.expand_path('ImagePilot.xcodeproj', __dir__))
target = proj.targets.find { |t| t.name == 'ImagePilot' }
raise 'ImagePilot target not found' unless target

rel = '../public/models/mobilenetv3_rw_Opset17.onnx'
already = proj.files.any? { |f| f.path == rel }
if already
  puts "skip (exists): #{rel}"
else
  ref = proj.main_group.new_reference(rel)
  ref.source_tree = 'SOURCE_ROOT'   # 相对 ios/，故 ../public/models/...
  ref.last_known_file_type = 'file'
  target.resources_build_phase.add_file_reference(ref)
  puts "added bundle resource: #{rel}"
end
proj.save
puts 'saved.'
