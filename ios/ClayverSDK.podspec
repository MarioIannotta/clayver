Pod::Spec.new do |s|
  s.name             = 'ClayverSDK'
  s.version          = '0.2.0'
  s.summary          = 'Open-source in-app customer support that runs in your own Firebase project.'
  s.description      = <<-DESC
    Clayver is an in-app customer support SDK (chat, push notifications, unread
    counters, attachments) whose backend is the developer's own Firebase project:
    Realtime Database, Cloud Storage, Cloud Functions and Firebase Cloud Messaging.
  DESC
  s.homepage         = 'https://github.com/clayver/clayver'
  s.license          = { :type => 'Apache-2.0' }
  s.author           = { 'Clayver contributors' => 'oss@clayver.dev' }
  s.source           = { :git => 'https://github.com/clayver/clayver.git', :tag => "v#{s.version}" }

  s.ios.deployment_target = '15.0'
  s.swift_version         = '5.9'

  # A published pod is downloaded from the git tag and its paths resolve from the
  # repository root (ios/Sources/...). With `pod 'ClayverSDK', :path => '<repo>/ios'`
  # they resolve from ios/ (Sources/...). The brace pattern covers both.
  s.source_files = '{ios/Sources,Sources}/ClayverSDK/**/*.swift'
  s.frameworks   = 'SwiftUI', 'UIKit', 'PhotosUI', 'QuickLook', 'UniformTypeIdentifiers', 'ImageIO', 'Security'

  s.dependency 'FirebaseAuth',      '>= 11.0', '< 13.0'
  s.dependency 'FirebaseDatabase',  '>= 11.0', '< 13.0'
  s.dependency 'FirebaseStorage',   '>= 11.0', '< 13.0'
  s.dependency 'FirebaseFunctions', '>= 11.0', '< 13.0'
  s.dependency 'FirebaseMessaging', '>= 11.0', '< 13.0'
end
