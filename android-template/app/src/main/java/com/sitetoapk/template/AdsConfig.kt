package com.sitetoapk.template

import org.json.JSONException
import org.json.JSONObject

data class AdsConfig(
    val appId: String,
    val bannerUnitId: String?,
    val interstitialUnitId: String?,
    val bannerOnTop: Boolean,
    val interstitialGapMs: Long,
    val childDirected: Boolean,
) {
    companion object {
        private val APP_ID = Regex("^ca-app-pub-(\\d{16})~\\d{10}$")
        private val UNIT_ID = Regex("^ca-app-pub-(\\d{16})/\\d{10}$")
        private const val MIN_GAP_SECONDS = 60
        private const val MAX_GAP_SECONDS = 3600

        /** Returns null for anything the `shared` schema would not accept. */
        fun parse(json: JSONObject): AdsConfig? {
            return try {
                val appId = (json.opt("appId") as? String)?.takeIf(APP_ID::matches) ?: return null
                val publisher = APP_ID.matchEntire(appId)!!.groupValues[1]
                fun unit(name: String): String? {
                    val raw = json.opt(name) ?: return null
                    val text = raw as? String ?: return null
                    return text.takeIf { UNIT_ID.matchEntire(it)?.groupValues?.get(1) == publisher }
                }
                val banner = unit("bannerUnitId")
                val interstitial = unit("interstitialUnitId")
                // A unit that is present but wrong makes the whole block invalid, not just absent.
                if (json.has("bannerUnitId") && banner == null) return null
                if (json.has("interstitialUnitId") && interstitial == null) return null
                if (banner == null && interstitial == null) return null
                val position = json.opt("bannerPosition") as? String ?: return null
                if (position != "top" && position != "bottom") return null
                val gap = json.opt("interstitialGapSeconds") as? Int ?: return null
                if (gap < MIN_GAP_SECONDS || gap > MAX_GAP_SECONDS) return null
                AdsConfig(
                    appId = appId,
                    bannerUnitId = banner,
                    interstitialUnitId = interstitial,
                    bannerOnTop = position == "top",
                    interstitialGapMs = gap * 1000L,
                    childDirected = json.opt("childDirected") as? Boolean ?: return null,
                )
            } catch (_: JSONException) {
                null
            }
        }
    }
}
