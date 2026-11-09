import ExpoModulesCore
import UIKit

public class DinnerSwipeAppIconsModule: Module {
  private let names = ["red": "DSIconRed", "blue": "DSIconBlue", "green": "DSIconGreen", "teal": "DSIconTeal", "purple": "DSIconPurple", "orange": "DSIconOrange"]

  public func definition() -> ModuleDefinition {
    Name("DinnerSwipeAppIcons")
    Function("isSupported") { () -> Bool in
      if Thread.isMainThread { return UIApplication.shared.supportsAlternateIcons }
      return DispatchQueue.main.sync { UIApplication.shared.supportsAlternateIcons }
    }
    AsyncFunction("getCurrentIcon") { () -> String in
      guard let name = UIApplication.shared.alternateIconName else { return "black" }
      return self.names.first(where: { $0.value == name })?.key ?? ""
    }.runOnQueue(.main)
    AsyncFunction("setIcon") { (accent: String, promise: Promise) in
      guard accent == "black" || self.names[accent] != nil else {
        promise.reject("INVALID_ACCENT", "Unknown accent")
        return
      }
      guard UIApplication.shared.supportsAlternateIcons,
            UIApplication.shared.applicationState == .active else {
        promise.reject("ICON_UNAVAILABLE", "Icon changes require an active app")
        return
      }
      let desired = self.names[accent]
      if UIApplication.shared.alternateIconName == desired { promise.resolve(); return }
      // UIKit owns the icon-change notice. Do not suppress it with private APIs.
      UIApplication.shared.setAlternateIconName(desired) { error in
        if let error = error { promise.reject("ICON_CHANGE_FAILED", error.localizedDescription) }
        else { promise.resolve() }
      }
    }.runOnQueue(.main)
  }
}
