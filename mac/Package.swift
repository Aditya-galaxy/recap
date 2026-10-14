// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Recap",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(
            name: "Recap",
            path: "Sources/Recap",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
