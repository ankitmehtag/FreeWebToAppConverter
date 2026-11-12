package com.sitetoapk.template

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AdsTest {
    private val gap = 180_000L

    @Test
    fun `never shows an interstitial on the first page`() {
        val gate = InterstitialGate(gap, launchedAt = 0)
        assertFalse(gate.onPageFinished(now = gap * 10))
    }

    @Test
    fun `shows after a page change once a full gap has passed since launch`() {
        val gate = InterstitialGate(gap, launchedAt = 0)
        gate.onPageFinished(1_000)
        assertFalse(gate.onPageFinished(gap - 1))
        assertTrue(gate.onPageFinished(gap))
    }

    @Test
    fun `two interstitials are never closer than the gap`() {
        val gate = InterstitialGate(gap, launchedAt = 0)
        gate.onPageFinished(1_000)
        assertTrue(gate.onPageFinished(gap))
        gate.shown(gap)
        assertFalse(gate.onPageFinished(gap + gap - 1))
        assertTrue(gate.onPageFinished(gap + gap))
    }

    @Test
    fun `a failed request is not retried within a minute`() {
        val retry = RetryGate()
        assertTrue(retry.allow(0))
        assertFalse(retry.allow(59_999))
        assertTrue(retry.allow(60_000))
    }

    private val ads = """
        {"appId":"ca-app-pub-1234567890123456~1234567890","bannerUnitId":"ca-app-pub-1234567890123456/1111111111",
         "bannerPosition":"top","interstitialGapSeconds":120,"childDirected":true}
    """.trimIndent()

    private fun edited(edit: JSONObject.() -> Unit) = JSONObject(ads).apply(edit)

    @Test
    fun `parses valid ad settings`() {
        val parsed = AdsConfig.parse(JSONObject(ads))
        assertNotNull(parsed)
        assertEquals("ca-app-pub-1234567890123456/1111111111", parsed!!.bannerUnitId)
        assertNull(parsed.interstitialUnitId)
        assertTrue(parsed.bannerOnTop)
        assertEquals(120_000L, parsed.interstitialGapMs)
        assertTrue(parsed.childDirected)
    }

    @Test
    fun `refuses what the shared schema refuses`() {
        assertNull(AdsConfig.parse(edited { put("appId", "ca-app-pub-1~2") }))
        assertNull(AdsConfig.parse(edited { put("bannerUnitId", "ca-app-pub-9999999999999999/1111111111") }))
        assertNull(AdsConfig.parse(edited { remove("bannerUnitId") }))
        assertNull(AdsConfig.parse(edited { put("interstitialGapSeconds", 59) }))
        assertNull(AdsConfig.parse(edited { put("bannerPosition", "middle") }))
        assertNull(AdsConfig.parse(edited { remove("childDirected") }))
    }

    @Test
    fun `an app config with invalid ads is invalid, and one without ads still parses`() {
        val base = """
            {"schemaVersion":1,"startUrl":"https://example.com/","internalHosts":["example.com"],
             "ui":{"statusBarColor":"#0F172A","orientation":"portrait","zoom":false,"progressBar":true,"pullToRefresh":true,"exitDialog":false}%s}
        """.trimIndent()
        assertNull(AppConfig.parse(base.format(""))!!.ads)
        assertNotNull(AppConfig.parse(base.format("")))
        assertNotNull(AppConfig.parse(base.format(",\"ads\":$ads"))?.ads)
        assertNull(AppConfig.parse(base.format(",\"ads\":{\"appId\":\"x\"}")))
        assertNull(AppConfig.parse(base.format(",\"ads\":5")))
    }
}
