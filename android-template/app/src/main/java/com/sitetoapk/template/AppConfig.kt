package com.sitetoapk.template

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

data class UiConfig(
    val statusBarColor: String,
    val orientation: String,
    val zoom: Boolean,
    val progressBar: Boolean,
    val pullToRefresh: Boolean,
    val exitDialog: Boolean,
)

data class AppConfig(
    val startUrl: String,
    val internalHosts: Set<String>,
    val ui: UiConfig,
) {
    companion object {
        private val HOST = Regex("^[a-z0-9-]+(\\.[a-z0-9-]+)+$")
        private val COLOR = Regex("^#[0-9a-fA-F]{6}$")
        private val ORIENTATIONS = setOf("unspecified", "portrait", "landscape")

        /** Returns null for anything the `shared` schema would not accept. */
        fun parse(text: String?): AppConfig? {
            if (text.isNullOrBlank()) return null
            return try {
                val json = JSONObject(text)
                if (json.opt("schemaVersion") != 1) return null

                val startUrl = json.opt("startUrl") as? String ?: return null
                if (UrlRouter.safeFallback(startUrl) == null) return null

                val hosts = hosts(json.opt("internalHosts") as? JSONArray ?: return null) ?: return null

                val ui = json.opt("ui") as? JSONObject ?: return null
                val color = (ui.opt("statusBarColor") as? String)?.takeIf(COLOR::matches) ?: return null
                val orientation = (ui.opt("orientation") as? String)?.takeIf(ORIENTATIONS::contains)
                    ?: return null

                AppConfig(
                    startUrl = startUrl,
                    internalHosts = hosts,
                    ui = UiConfig(
                        statusBarColor = color,
                        orientation = orientation,
                        zoom = ui.opt("zoom") as? Boolean ?: return null,
                        progressBar = ui.opt("progressBar") as? Boolean ?: return null,
                        pullToRefresh = ui.opt("pullToRefresh") as? Boolean ?: return null,
                        exitDialog = ui.opt("exitDialog") as? Boolean ?: return null,
                    ),
                )
            } catch (_: JSONException) {
                null
            }
        }

        private fun hosts(array: JSONArray): Set<String>? {
            if (array.length() == 0) return null
            val hosts = (0 until array.length()).map { array.opt(it) as? String ?: return null }
            return hosts.takeIf { it.all(HOST::matches) }?.toSet()
        }
    }
}
