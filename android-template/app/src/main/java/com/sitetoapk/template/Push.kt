package com.sitetoapk.template

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.io.IOException

/** Push notifications. Does nothing unless the build wrote `firebase.json`. */
object Push {
    // A channel's importance is fixed once a phone has it, so the id changed when it went from default to high.
    const val CHANNEL_ID = "alerts"

    /** Starts Firebase, asks for permission on Android 13+, and joins this app's topic. */
    fun start(context: Context, askPermission: ActivityResultLauncher<String>) {
        val json = read(context) ?: return
        try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                FirebaseApp.initializeApp(
                    context,
                    FirebaseOptions.Builder()
                        .setApiKey(json.getString("apiKey"))
                        .setApplicationId(json.getString("appId"))
                        .setProjectId(json.getString("projectId"))
                        .setGcmSenderId(json.getString("senderId"))
                        .build(),
                )
            }
            createChannel(context)
            FirebaseMessaging.getInstance().subscribeToTopic(json.getString("topic"))
        } catch (_: Exception) {
            // A bad config must not stop the app opening.
            return
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            askPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Updates", NotificationManager.IMPORTANCE_HIGH))
    }

    private fun read(context: Context): JSONObject? = try {
        JSONObject(context.assets.open("firebase.json").bufferedReader().use { it.readText() })
    } catch (_: IOException) {
        null
    }
}
