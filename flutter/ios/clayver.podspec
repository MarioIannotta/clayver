#
# Flutter plugin pod for Clayver. The plugin is a thin bridge: all behavior
# comes from the native `ClayverSDK` pod.
#
# Until ClayverSDK is published to CocoaPods trunk, add this to the app's
# ios/Podfile, inside `target 'Runner' do`, before `flutter_install_all_ios_pods`:
#
#   pod 'ClayverSDK', :path => '<path to the clayver repo>/ios'
#
Pod::Spec.new do |s|
  s.name             = 'clayver'
  s.version          = '0.2.0'
  s.summary          = 'Flutter plugin for Clayver in-app customer support.'
  s.description      = <<-DESC
    Flutter wrapper over the Clayver iOS SDK: open-source in-app customer
    support whose backend runs in your own Firebase project.
  DESC
  s.homepage         = 'https://github.com/clayver/clayver'
  s.license          = { :type => 'Apache-2.0' }
  s.author           = { 'Clayver contributors' => 'oss@clayver.dev' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*.swift'

  s.dependency 'Flutter'
  s.dependency 'ClayverSDK', '~> 0.2.0'
  s.dependency 'FirebaseCore'

  s.platform         = :ios, '15.0'
  s.swift_version    = '5.9'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
