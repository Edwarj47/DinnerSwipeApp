require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))
Pod::Spec.new do |s|
  s.name = 'DinnerSwipeAppIcons'
  s.version = package['version']
  s.summary = package['description']
  s.description = package['description']
  s.license = package['license']
  s.author = 'Data Centric Software Solutions'
  s.homepage = 'https://dinner.dcss.dev'
  s.platforms = { :ios => '13.4' }
  s.swift_version = '5.4'
  s.source = { :git => 'https://github.com/Edwarj47/DinnerSwipeApp.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end
