// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ClayverSDK",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "ClayverSDK", targets: ["ClayverSDK"]),
    ],
    dependencies: [
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", "11.0.0"..<"13.0.0"),
    ],
    targets: [
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
        .testTarget(
            name: "ClayverSDKTests",
            dependencies: ["ClayverSDK"],
            path: "Tests/ClayverSDKTests"
        ),
    ]
)
