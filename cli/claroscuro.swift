#!/usr/bin/env swift
// Claroscuro — crea un fondo de pantalla .heic que cambia con el modo claro/oscuro de macOS.
// Usa solo frameworks de Apple (ImageIO). Licencia MIT.
//
// Uso:
//   swift claroscuro.swift <imagen-claro> <imagen-oscuro> [salida.heic]
//   swift claroscuro.swift --info <archivo.heic>

import Foundation
import ImageIO
import UniformTypeIdentifiers

let appleDesktopNS = "http://ns.apple.com/namespace/1.0/" as CFString

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("Error: \(message)\n".utf8))
    exit(1)
}

func loadImage(_ path: String) -> CGImage {
    let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fail("no se pudo leer la imagen '\(path)'")
    }
    return image
}

/// Plist binario {"l": índiceClaro, "d": índiceOscuro} en base64, que es lo que macOS lee de `apple_desktop:apr`.
func appearancePlist(light: Int, dark: Int) -> String {
    let data = try! PropertyListSerialization.data(
        fromPropertyList: ["l": light, "d": dark], format: .binary, options: 0)
    return data.base64EncodedString()
}

func create(lightPath: String, darkPath: String, outputPath: String) {
    let light = loadImage(lightPath)
    let dark = loadImage(darkPath)

    let outputURL = URL(fileURLWithPath: (outputPath as NSString).expandingTildeInPath)
    guard let destination = CGImageDestinationCreateWithURL(
        outputURL as CFURL, UTType.heic.identifier as CFString, 2, nil) else {
        fail("no se pudo crear '\(outputPath)'")
    }

    let metadata = CGImageMetadataCreateMutable()
    guard CGImageMetadataRegisterNamespaceForPrefix(metadata, appleDesktopNS, "apple_desktop" as CFString, nil),
          CGImageMetadataSetValueWithPath(metadata, nil, "apple_desktop:apr" as CFString,
                                          appearancePlist(light: 0, dark: 1) as CFString) else {
        fail("no se pudieron escribir los metadatos de apariencia")
    }

    let options = [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary
    CGImageDestinationAddImageAndMetadata(destination, light, metadata, options)
    CGImageDestinationAddImage(destination, dark, options)

    guard CGImageDestinationFinalize(destination) else {
        fail("no se pudo guardar '\(outputPath)'")
    }
    print("✓ Fondo creado: \(outputURL.path)")
    print("  Ábrelo en Ajustes del Sistema → Fondo de pantalla y deja la opción en «Automático».")
}

func info(_ path: String) {
    let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
        fail("no se pudo leer '\(path)'")
    }
    let count = CGImageSourceGetCount(source)
    print("Imágenes: \(count)")
    for i in 0..<count {
        let props = CGImageSourceCopyPropertiesAtIndex(source, i, nil) as? [CFString: Any] ?? [:]
        print("  [\(i)] \(props[kCGImagePropertyPixelWidth] ?? "?")×\(props[kCGImagePropertyPixelHeight] ?? "?")")
    }
    guard let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil) else {
        print("Sin metadatos XMP."); return
    }
    var found = false
    for key in ["apr", "h24", "solar"] {
        let tagPath = "apple_desktop:\(key)" as CFString
        guard let tag = CGImageMetadataCopyTagWithPath(metadata, nil, tagPath),
              let value = CGImageMetadataTagCopyValue(tag) as? String else { continue }
        found = true
        print("apple_desktop:\(key) = \(value)")
        if let data = Data(base64Encoded: value),
           let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) {
            print("  → \(plist)")
        }
    }
    if !found { print("No es un fondo dinámico (no hay etiquetas apple_desktop).") }
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.count {
case 2 where args[0] == "--info":
    info(args[1])
case 2, 3:
    create(lightPath: args[0], darkPath: args[1], outputPath: args.count == 3 ? args[2] : "claroscuro.heic")
default:
    print("""
    Claroscuro — fondo de pantalla que cambia con el modo claro/oscuro de macOS

    Uso:
      swift claroscuro.swift <imagen-claro> <imagen-oscuro> [salida.heic]
      swift claroscuro.swift --info <archivo.heic>
    """)
    exit(args.isEmpty ? 0 : 1)
}
