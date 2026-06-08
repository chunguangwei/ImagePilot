# 把 LiteRTLMModule.swift / .m 加进 ImagePilot target，并把项目部署目标 14.0→15.0。
# 用 CocoaPods 自带 xcodeproj。可重复执行（幂等）。
require 'xcodeproj'

proj_path = File.expand_path('ImagePilot.xcodeproj', __dir__)
project = Xcodeproj::Project.open(proj_path)

target = project.targets.find { |t| t.name == 'ImagePilot' }
raise 'ImagePilot target not found' unless target

# 找到 ImagePilot 组（HapticsModule.swift 所在的组），新增文件挂这里。
group = project.main_group.recursive_children.find do |g|
  g.is_a?(Xcodeproj::Project::Object::PBXGroup) &&
    g.files.any? { |f| f.path.to_s.end_with?('ImagePilot/HapticsModule.swift') }
end
group ||= project.main_group

files = ['ImagePilot/LiteRTLMModule.swift', 'ImagePilot/LiteRTLMModule.m']
files.each do |rel|
  already = project.files.any? { |f| f.path == rel }
  if already
    puts "skip (exists): #{rel}"
    next
  end
  ref = group.new_reference(rel)
  target.add_file_references([ref])
  puts "added: #{rel}"
end

# 部署目标 14.0 → 15.0（CLiteRTLM.framework MinimumOSVersion=15.0）。
bumped = 0
project.build_configurations.each do |c|
  if c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < 15.0
    c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
    bumped += 1
  end
end
target.build_configurations.each do |c|
  if c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < 15.0
    c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
    bumped += 1
  end
end
puts "deployment target bumped on #{bumped} config(s)"

project.save
puts 'project saved.'
