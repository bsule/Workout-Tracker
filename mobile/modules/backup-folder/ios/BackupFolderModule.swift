import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

public class BackupFolderModule: Module {
  private let fsQueue = DispatchQueue(label: "lift.backupFolder.fs", qos: .userInitiated)
  private var pickerHolder: PickerHolder?

  public func definition() -> ModuleDefinition {
    Name("BackupFolderModule")

    AsyncFunction("pickFolder") { (promise: Promise) in
      DispatchQueue.main.async {
        guard let presenter = Self.topViewController() else {
          promise.reject("no-presenter", "No view controller available to present picker.")
          return
        }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
        picker.allowsMultipleSelection = false
        picker.shouldShowFileExtensions = true

        let holder = PickerHolder { [weak self] result in
          self?.pickerHolder = nil
          switch result {
          case .cancelled:
            promise.resolve(nil)
          case .picked(let url):
            self.flatMap { strong in
              strong.fsQueue.async {
                do {
                  let didStart = url.startAccessingSecurityScopedResource()
                  defer { if didStart { url.stopAccessingSecurityScopedResource() } }
                  let bookmark = try url.bookmarkData(
                    options: .withSecurityScope,
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil
                  )
                  promise.resolve([
                    "bookmark": bookmark.base64EncodedString(),
                    "label": Self.label(for: url)
                  ])
                } catch {
                  promise.reject("bookmark-failed", error.localizedDescription)
                }
              }
            }
          case .failed(let message):
            promise.reject("picker-failed", message)
          }
        }
        self.pickerHolder = holder
        picker.delegate = holder
        picker.modalPresentationStyle = .formSheet
        presenter.present(picker, animated: true)
      }
    }

    AsyncFunction("writeFile") { (bookmarkB64: String, filename: String, contents: String, promise: Promise) in
      self.fsQueue.async {
        do {
          let resolved = try Self.resolveBookmark(base64: bookmarkB64)
          let folderUrl = resolved.url
          let didStart = folderUrl.startAccessingSecurityScopedResource()
          defer { if didStart { folderUrl.stopAccessingSecurityScopedResource() } }

          let target = folderUrl.appendingPathComponent(filename)
          let tmp = folderUrl.appendingPathComponent("\(filename).tmp")

          guard let data = contents.data(using: .utf8) else {
            promise.reject("encode-failed", "Could not UTF-8 encode contents.")
            return
          }
          try data.write(to: tmp, options: .atomic)

          if FileManager.default.fileExists(atPath: target.path) {
            _ = try FileManager.default.replaceItemAt(target, withItemAt: tmp)
          } else {
            try FileManager.default.moveItem(at: tmp, to: target)
          }

          var result: [String: Any] = [:]
          if let refreshed = resolved.refreshedBookmark {
            result["bookmark"] = refreshed.base64EncodedString()
          }
          promise.resolve(result)
        } catch let nsError as NSError where nsError.domain == NSCocoaErrorDomain && nsError.code == NSFileReadNoPermissionError {
          promise.reject("denied", nsError.localizedDescription)
        } catch {
          promise.reject("write-failed", error.localizedDescription)
        }
      }
    }

    AsyncFunction("readFile") { (bookmarkB64: String, filename: String, promise: Promise) in
      self.fsQueue.async {
        do {
          let resolved = try Self.resolveBookmark(base64: bookmarkB64)
          let folderUrl = resolved.url
          let didStart = folderUrl.startAccessingSecurityScopedResource()
          defer { if didStart { folderUrl.stopAccessingSecurityScopedResource() } }

          let fileUrl = folderUrl.appendingPathComponent(filename)

          // For iCloud Drive, ask iOS to start downloading and wait briefly for it.
          try? FileManager.default.startDownloadingUbiquitousItem(at: fileUrl)
          let deadline = Date().addingTimeInterval(5)
          while !FileManager.default.fileExists(atPath: fileUrl.path) && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.2)
          }

          guard FileManager.default.fileExists(atPath: fileUrl.path) else {
            promise.reject("not-found", "No \(filename) in selected folder.")
            return
          }

          let data = try Data(contentsOf: fileUrl)
          guard let str = String(data: data, encoding: .utf8) else {
            promise.reject("decode-failed", "File is not valid UTF-8.")
            return
          }
          promise.resolve(["contents": str])
        } catch let nsError as NSError where nsError.domain == NSCocoaErrorDomain && nsError.code == NSFileReadNoPermissionError {
          promise.reject("denied", nsError.localizedDescription)
        } catch {
          promise.reject("other", error.localizedDescription)
        }
      }
    }
  }

  // MARK: - Helpers

  private struct ResolvedBookmark {
    let url: URL
    let refreshedBookmark: Data?
  }

  private static func resolveBookmark(base64: String) throws -> ResolvedBookmark {
    guard let data = Data(base64Encoded: base64) else {
      throw NSError(domain: "BackupFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bookmark is not valid base64."])
    }
    var isStale = false
    let url = try URL(
      resolvingBookmarkData: data,
      options: .withSecurityScope,
      relativeTo: nil,
      bookmarkDataIsStale: &isStale
    )
    var refreshed: Data? = nil
    if isStale {
      let didStart = url.startAccessingSecurityScopedResource()
      defer { if didStart { url.stopAccessingSecurityScopedResource() } }
      refreshed = try? url.bookmarkData(
        options: .withSecurityScope,
        includingResourceValuesForKeys: nil,
        relativeTo: nil
      )
    }
    return ResolvedBookmark(url: url, refreshedBookmark: refreshed)
  }

  private static func label(for url: URL) -> String {
    let parts = url.pathComponents.filter { $0 != "/" }
    let tail = parts.suffix(2)
    return tail.joined(separator: " › ")
  }

  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
      ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    let root = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
      ?? scene?.windows.first?.rootViewController
    var top = root
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
}

// MARK: - Picker delegate holder

private enum PickerOutcome {
  case cancelled
  case picked(URL)
  case failed(String)
}

private final class PickerHolder: NSObject, UIDocumentPickerDelegate {
  private let onResult: (PickerOutcome) -> Void
  private var resolved = false

  init(onResult: @escaping (PickerOutcome) -> Void) {
    self.onResult = onResult
  }

  private func resolveOnce(_ outcome: PickerOutcome) {
    guard !resolved else { return }
    resolved = true
    onResult(outcome)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    if let url = urls.first {
      resolveOnce(.picked(url))
    } else {
      resolveOnce(.cancelled)
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    resolveOnce(.cancelled)
  }
}
