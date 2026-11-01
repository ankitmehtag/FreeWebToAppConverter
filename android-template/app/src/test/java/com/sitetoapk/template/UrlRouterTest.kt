package com.sitetoapk.template

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UrlRouterTest {
    private val hosts = setOf("example.com", "www.example.com")
    private fun route(url: String) = UrlRouter.route(url, hosts)

    @Test
    fun `internal https stays in the WebView`() {
        assertEquals(Route.WEBVIEW, route("https://example.com/page?a=1#b"))
        assertEquals(Route.WEBVIEW, route("https://WWW.Example.com/"))
        assertEquals(Route.WEBVIEW, route("HTTPS://example.com/"))
    }

    @Test
    fun `other web links open in the browser`() {
        assertEquals(Route.EXTERNAL_BROWSER, route("https://other.com/"))
        assertEquals(Route.EXTERNAL_BROWSER, route("https://sub.example.com/"))
        assertEquals(Route.EXTERNAL_BROWSER, route("https://example.com.evil.com/"))
        assertEquals(Route.EXTERNAL_BROWSER, route("https://example.com@evil.com/"))
        assertEquals(Route.EXTERNAL_BROWSER, route("http://other.com/"))
    }

    @Test
    fun `cleartext to an internal host is blocked`() {
        assertEquals(Route.BLOCK, route("http://example.com/"))
    }

    @Test
    fun `google sign in uses a custom tab`() {
        assertEquals(Route.CUSTOM_TAB, route("https://accounts.google.com/o/oauth2/auth?x=1"))
    }

    @Test
    fun `system schemes go to Android`() {
        assertEquals(Route.SYSTEM, route("tel:+15551234"))
        assertEquals(Route.SYSTEM, route("mailto:a@example.com"))
        assertEquals(Route.SYSTEM, route("market://details?id=com.example"))
    }

    @Test
    fun `intent links are sanitised separately`() {
        assertEquals(Route.INTENT, route("intent://scan/#Intent;scheme=zxing;end"))
        assertEquals(
            Route.INTENT,
            route("intent://x/#Intent;component=com.evil/.Steal;scheme=https;end"),
        )
    }

    @Test
    fun `dangerous and unknown schemes are blocked`() {
        assertEquals(Route.BLOCK, route("javascript:alert(1)"))
        assertEquals(Route.BLOCK, route("JavaScript:alert(1)"))
        assertEquals(Route.BLOCK, route("file:///etc/passwd"))
        assertEquals(Route.BLOCK, route("content://com.example/secret"))
        assertEquals(Route.BLOCK, route("data:text/html,hi"))
        assertEquals(Route.BLOCK, route("custom://open"))
        assertEquals(Route.BLOCK, route("not a url"))
        assertEquals(Route.BLOCK, route(""))
    }

    @Test
    fun `host parser tricks are blocked`() {
        assertEquals(Route.BLOCK, route("https://evil.com\\@example.com/"))
        assertEquals(Route.BLOCK, route("https://evil.com\\.example.com/"))
    }

    @Test
    fun `intent fallback must be https`() {
        assertEquals("https://example.com/app", UrlRouter.safeFallback("https://example.com/app"))
        assertNull(UrlRouter.safeFallback("http://example.com/app"))
        assertNull(UrlRouter.safeFallback("javascript:alert(1)"))
        assertNull(UrlRouter.safeFallback("file:///etc/passwd"))
        assertNull(UrlRouter.safeFallback("https://evil.com\\@example.com/"))
        assertNull(UrlRouter.safeFallback(null))
    }
}
