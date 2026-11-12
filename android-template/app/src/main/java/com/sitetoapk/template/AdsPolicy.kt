package com.sitetoapk.template

/** When an interstitial may show. Plain logic, so a unit test can cover it without the ad library. */
class InterstitialGate(private val gapMs: Long, launchedAt: Long) {
    private var pages = 0
    // Starting at launch means the first interstitial is never sooner than one gap after the app opened.
    private var lastShownAt = launchedAt

    /** Counts a finished page load. True when an interstitial may show now: not for the first page, and not within the gap. */
    fun onPageFinished(now: Long): Boolean {
        pages += 1
        return pages >= 2 && now - lastShownAt >= gapMs
    }

    fun shown(now: Long) {
        lastShownAt = now
    }
}

/** Keeps a failed ad request from being repeated more than once a minute. */
class RetryGate(private val minGapMs: Long = RETRY_MS) {
    private var lastAttemptAt = Long.MIN_VALUE / 2

    fun allow(now: Long): Boolean {
        if (now - lastAttemptAt < minGapMs) return false
        lastAttemptAt = now
        return true
    }

    companion object {
        const val RETRY_MS = 60_000L
    }
}
