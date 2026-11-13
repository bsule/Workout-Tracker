require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name = 'LiftEngine'
  s.version = package['version']
  s.summary = package['description']
  s.description = package['description']
  s.license = 'UNLICENSED'
  s.author = 'Lift'
  s.homepage = 'https://github.com/'
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.4'
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'LiftEngineModule.swift', 'Generated/*.swift', 'Generated/LiftEngineFFI.h'
  s.public_header_files = 'Generated/LiftEngineFFI.h'
  s.vendored_frameworks = 'Generated/LiftEngineFFI.xcframework'
  s.libraries = 'c++', 'resolv', 'iconv'
  s.frameworks = 'Security', 'SystemConfiguration'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
