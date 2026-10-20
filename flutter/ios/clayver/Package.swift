// swift-tools-version: 5.9
// Flutter looks for this manifest at ios/clayver/Package.swift so the plugin
// builds with Swift Package Manager. CocoaPods remains available via the podspec.

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
        // Same Firebase iOS SDK version as firebase_core 4.15.0, so the app
        // resolves a single copy.
        .package(url: "https://github.com/firebase/firebase-ios-sdk", exact: "12.19.0"),
        .package(name: "FlutterFramework", path: "../FlutterFramework"),
    ],
    targets: [
        // SDK sources live in this package. A path to the repository root
        // breaks once Flutter symlinks the plugin into the app's ephemeral
        // folder, and a git dependency on this same repository collapses
        // into the plugin package itself.
        .target(
            name: "ClayverSDK",
            dependencies: [
                .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
                .product(name: "FirebaseDatabase", package: "firebase-ios-sdk"),
                .product(name: "FirebaseStorage", package: "firebase-ios-sdk"),
                .product(name: "FirebaseFunctions", package: "firebase-ios-sdk"),
                .product(name: "FirebaseMessaging", package: "firebase-ios-sdk"),
            ],
            path: "Sources/ClayverSDK"
        ),
        .target(
            name: "clayver",
            dependencies: [
                "ClayverSDK",
                .product(name: "FirebaseCore", package: "firebase-ios-sdk"),
                .product(name: "FlutterFramework", package: "FlutterFramework"),
            ],
            path: "Sources/clayver"
        ),
    ]
)
