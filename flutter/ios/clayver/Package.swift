// swift-tools-version: 5.9
// Flutter looks for this manifest at ios/clayver/Package.swift so the plugin
// builds with Swift Package Manager, the only iOS integration (no podspec).

import PackageDescription

let package = Package(
    name: "clayver",
    platforms: [
        .iOS("15.0"),
    ],
    products: [
        .library(name: "clayver", targets: ["clayver"]),
    ],
    dependencies: [
        // The native SDK is the repository root package. A relative path breaks
        // once Flutter symlinks this plugin into the app's ephemeral folder.
        .package(url: "https://github.com/MarioIannotta/clayver.git", revision: "6b457a863a0e70dc22133efa284f358afcfb2e91"),
        // Same Firebase iOS SDK version as firebase_core 4.15.0, so the app
        // resolves a single copy.
        .package(url: "https://github.com/firebase/firebase-ios-sdk", exact: "12.19.0"),
        .package(name: "FlutterFramework", path: "../FlutterFramework"),
    ],
    targets: [
        .target(
            name: "clayver",
            dependencies: [
                .product(name: "ClayverSDK", package: "ClayverSDK"),
                .product(name: "FirebaseCore", package: "firebase-ios-sdk"),
                .product(name: "FlutterFramework", package: "FlutterFramework"),
            ],
            path: "Sources/clayver"
        ),
    ]
)
