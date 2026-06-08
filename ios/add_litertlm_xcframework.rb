# 把 CLiteRTLM.xcframework + LiteRT-LM 的 10 个 Swift 封装源直接挂到 ImagePilot app target。
#
# 为什么不走 pod：CocoaPods 的 xcframework 解包脚本不在 Swift 模块依赖扫描之前执行，
# 跨 pod `import CLiteRTLM` 会报 "unable to resolve module dependency"。直接挂 app target，
# 由 Xcode 原生 ProcessXCFramework 选切片、设搜索路径，最稳。
#
# 幂等：可重复执行。
require 'xcodeproj'

proj_path = File.expand_path('ImagePilot.xcodeproj', __dir__)
project = Xcodeproj::Project.open(proj_path)
target = project.targets.find { |t| t.name == 'ImagePilot' }
raise 'ImagePilot target not found' unless target

# ---- 1) 把 10 个 swift 封装源加进 app target 的 Sources ----
swift_dir = File.expand_path('LiteRTLM/swift', __dir__)
swift_files = Dir.children(swift_dir).select { |f| f.end_with?('.swift') }.sort

# 在 main_group 下建/找一个 LiteRTLMVendor 组收纳这些第三方源。
vendor_group = project.main_group.children.find { |g| g.respond_to?(:display_name) && g.display_name == 'LiteRTLMVendor' }
vendor_group ||= project.main_group.new_group('LiteRTLMVendor', nil)

swift_files.each do |fname|
  rel = "LiteRTLM/swift/#{fname}"
  exists = project.files.any? { |f| f.path == rel }
  if exists
    puts "skip swift (exists): #{rel}"
    next
  end
  ref = vendor_group.new_reference(rel)
  ref.source_tree = 'SOURCE_ROOT'
  target.add_file_references([ref])
  puts "added swift: #{rel}"
end

# ---- 2) 把 CLiteRTLM.xcframework 加进 app target：链接 + 嵌入(签名拷贝) ----
xcf_rel = 'LiteRTLM/CLiteRTLM.xcframework'
xcf_ref = project.files.find { |f| f.path == xcf_rel }
unless xcf_ref
  xcf_ref = vendor_group.new_reference(xcf_rel)
  xcf_ref.source_tree = 'SOURCE_ROOT'
  xcf_ref.last_known_file_type = 'wrapper.xcframework'
  xcf_ref.name = 'CLiteRTLM.xcframework'
  puts "added xcframework ref: #{xcf_rel}"
end

# 链接（Link Binary With Libraries）
already_linked = target.frameworks_build_phase.files.any? { |bf| bf.file_ref == xcf_ref }
unless already_linked
  target.frameworks_build_phase.add_file_reference(xcf_ref, true)
  puts 'linked xcframework into Frameworks phase'
end

# 嵌入（Embed Frameworks，动态库必须 embed&sign，否则运行时 dyld 找不到）
embed_phase = target.copy_files_build_phases.find { |p| p.symbol_dst_subfolder_spec == :frameworks }
unless embed_phase
  embed_phase = target.new_copy_files_build_phase('Embed Frameworks')
  embed_phase.symbol_dst_subfolder_spec = :frameworks
  puts 'created Embed Frameworks phase'
end
already_embedded = embed_phase.files.any? { |bf| bf.file_ref == xcf_ref }
unless already_embedded
  bf = embed_phase.add_file_reference(xcf_ref, true)
  bf.settings = { 'ATTRIBUTES' => %w[CodeSignOnCopy RemoveHeadersOnCopy] }
  puts 'embedded xcframework (CodeSignOnCopy)'
end

# ---- 3) FRAMEWORK_SEARCH_PATHS 加上 xcframework 所在目录 ----
target.build_configurations.each do |c|
  fsp = c.build_settings['FRAMEWORK_SEARCH_PATHS']
  fsp = ['$(inherited)'] if fsp.nil? || fsp == '$(inherited)' || fsp.to_s.empty?
  fsp = [fsp] unless fsp.is_a?(Array)
  needle = '$(SRCROOT)/LiteRTLM'
  unless fsp.include?(needle)
    fsp << needle
    c.build_settings['FRAMEWORK_SEARCH_PATHS'] = fsp
  end
end
puts 'FRAMEWORK_SEARCH_PATHS ensured'

project.save
puts 'project saved.'
