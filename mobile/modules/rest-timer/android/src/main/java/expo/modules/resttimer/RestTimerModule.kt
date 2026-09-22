package expo.modules.resttimer

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class RestTimerInput : Record {
  @Field var exerciseName: String = ""
  /** Epoch milliseconds. */
  @Field var startedAt: Double = 0.0
  /** Epoch milliseconds. */
  @Field var endsAt: Double = 0.0
}

/**
 * The rest timer as one silent ongoing notification with a live chronometer.
 * Android counts the time and removes the notification at the cutoff
 * (setTimeoutAfter) by itself, so nothing here needs the app process to stay
 * alive. On Android 16 and later the notification asks to be promoted to a
 * Live Update, which pins the chronometer to the status bar.
 */
class RestTimerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("RestTimerModule")

    AsyncFunction("start") { input: RestTimerInput ->
      post(input)
    }

    // One fixed notification id, so posting again replaces in place. Start
    // and update are the same call on Android.
    AsyncFunction("update") { input: RestTimerInput ->
      post(input)
    }

    AsyncFunction("end") {
      NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
      prefs().edit().clear().apply()
    }

    AsyncFunction("current") {
      currentTimer()
    }
  }

  private fun currentTimer(): Map<String, Any>? {
    if (!isShowing()) return null
    val p = prefs()
    val endsAt = p.getLong(KEY_ENDS_AT, 0L)
    if (endsAt <= System.currentTimeMillis()) return null
    return mapOf(
      "exerciseName" to (p.getString(KEY_NAME, "") ?: ""),
      "startedAt" to p.getLong(KEY_STARTED_AT, 0L).toDouble(),
      "endsAt" to endsAt.toDouble(),
    )
  }

  private fun post(input: RestTimerInput) {
    val ctx = context
    // Android 13+: without POST_NOTIFICATIONS the post is dropped. JS asks
    // for it first; a denial is the user's choice, not an error. The explicit
    // check is also what Android lint looks for before notify().
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
    val remaining = input.endsAt.toLong() - System.currentTimeMillis()
    if (remaining <= 0) return
    ensureChannel(ctx)

    val builder = NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setSmallIcon(R.drawable.rest_timer_icon)
      .setContentTitle(input.exerciseName.ifEmpty { "Workout" })
      .setContentText("Since last set")
      .setWhen(input.startedAt.toLong())
      .setShowWhen(true)
      .setUsesChronometer(true)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setTimeoutAfter(remaining)
      // Android 16 Live Update. This extras key is what
      // NotificationCompat.Builder.setRequestPromotedOngoing (androidx.core
      // 1.17) writes; setting it directly avoids the dependency bump. Older
      // Android ignores the key.
      .addExtras(Bundle().apply { putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true) })
    launchIntent(ctx)?.let { builder.setContentIntent(it) }

    try {
      NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, builder.build())
    } catch (e: SecurityException) {
      // Permission revoked between the check and the post.
      return
    }
    prefs().edit()
      .putString(KEY_NAME, input.exerciseName)
      .putLong(KEY_STARTED_AT, input.startedAt.toLong())
      .putLong(KEY_ENDS_AT, input.endsAt.toLong())
      .apply()
  }

  private fun isShowing(): Boolean {
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return nm.activeNotifications.any { it.id == NOTIFICATION_ID }
  }

  private fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    // LOW: silent, no heads-up. Not MIN, which Android 16 refuses to promote.
    val channel = NotificationChannel(CHANNEL_ID, "Rest timer", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Time since your last set"
      setShowBadge(false)
    }
    nm.createNotificationChannel(channel)
  }

  private fun launchIntent(ctx: Context): PendingIntent? {
    val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    return PendingIntent.getActivity(
      ctx,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  companion object {
    private const val CHANNEL_ID = "rest_timer"
    private const val NOTIFICATION_ID = 4711
    private const val PREFS = "lift.restTimer"
    private const val KEY_NAME = "exerciseName"
    private const val KEY_STARTED_AT = "startedAt"
    private const val KEY_ENDS_AT = "endsAt"
    private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"
  }
}
