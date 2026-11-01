package com.sitetoapk.template

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import java.net.URISyntaxException

/** Hands a non-WebView [route] to Android. Returns false if nothing could open it. */
fun Context.openOutside(url: String, route: Route): Boolean = when (route) {
    Route.CUSTOM_TAB -> openCustomTab(url)
    Route.EXTERNAL_BROWSER -> start(browsable(Intent.ACTION_VIEW, url))
    Route.SYSTEM -> start(
        browsable(if (url.startsWith("tel:", ignoreCase = true)) Intent.ACTION_DIAL else Intent.ACTION_VIEW, url),
    )
    Route.INTENT -> openIntentLink(url)
    Route.WEBVIEW, Route.BLOCK -> false
}

private fun browsable(action: String, url: String) =
    Intent(action, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)

private fun Context.start(intent: Intent): Boolean = try {
    startActivity(intent)
    true
} catch (_: ActivityNotFoundException) {
    false
}

private fun Context.openCustomTab(url: String): Boolean = try {
    CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse(url))
    true
} catch (_: ActivityNotFoundException) {
    start(browsable(Intent.ACTION_VIEW, url))
}

// A web page controls this URI, so it must never be able to reach a private
// component or receive URI grants.
private fun Context.openIntentLink(url: String): Boolean {
    val intent = try {
        Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
    } catch (_: URISyntaxException) {
        return false
    }
    val fallback = UrlRouter.safeFallback(intent.getStringExtra("browser_fallback_url"))

    intent.component = null
    intent.selector = null
    intent.flags = 0
    intent.addCategory(Intent.CATEGORY_BROWSABLE)

    if (start(intent)) return true
    return fallback != null && start(browsable(Intent.ACTION_VIEW, fallback))
}
