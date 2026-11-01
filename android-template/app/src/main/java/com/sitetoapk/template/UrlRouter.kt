package com.sitetoapk.template

import java.net.MalformedURLException
import java.net.URL

enum class Route { WEBVIEW, EXTERNAL_BROWSER, CUSTOM_TAB, SYSTEM, INTENT, BLOCK }

object UrlRouter {
    private const val GOOGLE_SIGN_IN_HOST = "accounts.google.com"
    private val SYSTEM_SCHEMES = setOf("tel", "mailto", "market")

    fun route(url: String, internalHosts: Set<String>): Route {
        val scheme = url.substringBefore(':', "").lowercase()
        return when (scheme) {
            in SYSTEM_SCHEMES -> Route.SYSTEM
            "intent" -> Route.INTENT
            "https", "http" -> routeWeb(url, scheme, internalHosts)
            else -> Route.BLOCK
        }
    }

    /** Returns [url] only when it is a well-formed HTTPS address. */
    fun safeFallback(url: String?): String? {
        if (url == null || hostOf(url) == null) return null
        return url.takeIf { it.substringBefore(':').equals("https", ignoreCase = true) }
    }

    private fun routeWeb(url: String, scheme: String, internalHosts: Set<String>): Route {
        val host = hostOf(url) ?: return Route.BLOCK
        val internal = host in internalHosts
        return when {
            scheme == "http" -> if (internal) Route.BLOCK else Route.EXTERNAL_BROWSER
            host == GOOGLE_SIGN_IN_HOST -> Route.CUSTOM_TAB
            internal -> Route.WEBVIEW
            else -> Route.EXTERNAL_BROWSER
        }
    }

    // Chromium treats a backslash as a slash but java.net.URL does not, so the two
    // can disagree about the host. Such URLs are rejected rather than parsed.
    private fun hostOf(url: String): String? {
        if ('\\' in url || url.any(Char::isWhitespace)) return null
        return try {
            URL(url).host.lowercase().ifEmpty { null }
        } catch (_: MalformedURLException) {
            null
        }
    }
}
