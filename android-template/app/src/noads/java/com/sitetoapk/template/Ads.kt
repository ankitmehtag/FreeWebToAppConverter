package com.sitetoapk.template

import androidx.appcompat.app.AppCompatActivity

/** The flavour without ads: the same calls, doing nothing, with no ad library behind them. */
object Ads {
    fun start(activity: AppCompatActivity, ads: AdsConfig?) = Unit

    fun onPageFinished() = Unit

    fun stop() = Unit
}
