package com.example.roadlink_ambulance

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createAlertChannel()
    }

    /**
     * Alerts must interrupt, so they get their own high-importance channel. AndroidManifest.xml names it as
     * Firebase's default channel, which is what a pushed `notification` message is shown on.
     */
    private fun createAlertChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel("roadlink_alerts", "Incident alerts", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "New incidents and assignments for ambulance units"
            enableVibration(true)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
}
