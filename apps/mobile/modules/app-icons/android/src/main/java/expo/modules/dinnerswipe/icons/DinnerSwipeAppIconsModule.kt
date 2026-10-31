package expo.modules.dinnerswipe.icons

import android.content.ComponentName
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DinnerSwipeAppIconsModule : Module() {
  private val presets = listOf("red", "blue", "green", "teal", "purple", "orange")

  private fun context() = requireNotNull(appContext.reactContext) { "App context unavailable" }
  private fun alias(accent: String) = ComponentName(context().packageName,
    context().packageName + ".DSIcon" + accent.replaceFirstChar { it.uppercaseChar() })

  @Suppress("DEPRECATION")
  private fun enabled(accent: String): Boolean {
    val manager = context().packageManager
    return when (manager.getComponentEnabledSetting(alias(accent))) {
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
      PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> manager.getActivityInfo(alias(accent), PackageManager.MATCH_DISABLED_COMPONENTS).enabled
      else -> false
    }
  }

  @Suppress("DEPRECATION")
  override fun definition() = ModuleDefinition {
    Name("DinnerSwipeAppIcons")
    Function("isSupported") {
      try {
        presets.all { context().packageManager.getActivityInfo(alias(it), PackageManager.MATCH_DISABLED_COMPONENTS) != null }
      } catch (_: Exception) { false }
    }
    AsyncFunction("getCurrentIcon") {
      val active = presets.filter { enabled(it) }
      if (active.size == 1) active.first() else ""
    }
    AsyncFunction("setIcon") { accent: String ->
      require(presets.contains(accent)) { "Unknown accent" }
      val manager = context().packageManager
      // Keep the real MainActivity enabled: only launcher aliases are switched.
      if (Build.VERSION.SDK_INT >= 33) {
        manager.setComponentEnabledSettings(presets.map {
          PackageManager.ComponentEnabledSetting(alias(it),
            if (it == accent) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP)
        })
      } else {
        // Enable first so a failed operation can never remove every launcher entry.
        manager.setComponentEnabledSetting(alias(accent), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
        presets.filter { it != accent }.forEach {
          manager.setComponentEnabledSetting(alias(it), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        }
      }
    }
  }
}
