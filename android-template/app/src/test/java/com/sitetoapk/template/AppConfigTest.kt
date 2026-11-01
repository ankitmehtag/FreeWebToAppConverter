package com.sitetoapk.template

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class AppConfigTest {
    private val valid = """
        {
          "schemaVersion": 1,
          "startUrl": "https://example.com/",
          "packageName": "com.sitetoapk.sample",
          "appName": "Sample App",
          "internalHosts": ["example.com", "www.example.com"],
          "ui": {
            "statusBarColor": "#0F172A",
            "orientation": "portrait",
            "zoom": false,
            "progressBar": true,
            "pullToRefresh": true,
            "exitDialog": false
          }
        }
    """.trimIndent()

    private fun edited(edit: JSONObject.() -> Unit) = JSONObject(valid).apply(edit).toString()
    private fun editedUi(edit: JSONObject.() -> Unit) = edited { getJSONObject("ui").edit() }

    @Test
    fun `parses a valid config`() {
        val config = AppConfig.parse(valid)
        assertNotNull(config)
        assertEquals("https://example.com/", config!!.startUrl)
        assertEquals(setOf("example.com", "www.example.com"), config.internalHosts)
        assertEquals("portrait", config.ui.orientation)
        assertEquals("#0F172A", config.ui.statusBarColor)
        assertFalse(config.ui.exitDialog)
    }

    @Test
    fun `rejects missing and malformed input`() {
        assertNull(AppConfig.parse(null))
        assertNull(AppConfig.parse(""))
        assertNull(AppConfig.parse("not json"))
        assertNull(AppConfig.parse("[]"))
    }

    @Test
    fun `rejects a wrong schema version`() {
        assertNull(AppConfig.parse(edited { put("schemaVersion", 2) }))
        assertNull(AppConfig.parse(edited { put("schemaVersion", "1") }))
        assertNull(AppConfig.parse(edited { remove("schemaVersion") }))
    }

    @Test
    fun `rejects a start url that is not https`() {
        assertNull(AppConfig.parse(edited { put("startUrl", "http://example.com") }))
        assertNull(AppConfig.parse(edited { put("startUrl", "file:///etc/passwd") }))
        assertNull(AppConfig.parse(edited { remove("startUrl") }))
    }

    @Test
    fun `rejects bad hosts and ui values`() {
        assertNull(AppConfig.parse(edited { put("internalHosts", org.json.JSONArray()) }))
        assertNull(AppConfig.parse(edited { remove("ui") }))
        assertNull(AppConfig.parse(editedUi { put("statusBarColor", "red") }))
        assertNull(AppConfig.parse(editedUi { put("orientation", "sideways") }))
        assertNull(AppConfig.parse(editedUi { put("zoom", "yes") }))
        assertNull(AppConfig.parse(editedUi { remove("exitDialog") }))
    }
}
