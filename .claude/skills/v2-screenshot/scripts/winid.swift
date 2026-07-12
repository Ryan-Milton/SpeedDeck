// Print the CoreGraphics window id of the main SpeedDeck (v2) window.
// "Main" = the largest layer-0 window owned by the requested process.
// Used by capture.sh so `screencapture -l<id>` grabs just the app window,
// even when it is occluded by other windows. Run: swift winid.swift <pid>
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2, let pid = Int(CommandLine.arguments[1]) else {
  FileHandle.standardError.write("usage: swift winid.swift <pid>\n".data(using: .utf8)!)
  exit(2)
}

let opts = CGWindowListOption(arrayLiteral: .optionAll)
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
  FileHandle.standardError.write("could not read window list\n".data(using: .utf8)!)
  exit(1)
}

var bestId = -1
var bestArea = -1.0
for w in list {
  guard (w[kCGWindowOwnerPID as String] as? Int) == pid else { continue }
  guard (w[kCGWindowLayer as String] as? Int) == 0 else { continue }
  guard let b = w[kCGWindowBounds as String] as? [String: Any],
        let width = b["Width"] as? Double,
        let height = b["Height"] as? Double,
        let id = w[kCGWindowNumber as String] as? Int else { continue }
  let area = width * height
  if area > bestArea {
    bestArea = area
    bestId = id
  }
}

if bestId >= 0 {
  print(bestId)
} else {
  FileHandle.standardError.write("no window found for PID \(pid)\n".data(using: .utf8)!)
  exit(1)
}
