package com.sitetoapk.template

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.RequestConfiguration
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform

/**
 * The flavour with ads. Nothing is requested before Google's consent flow says ads may be served, a failed
 * request is not repeated sooner than a minute, and a failure never reaches the page.
 */
object Ads {
    private val main = Handler(Looper.getMainLooper())
    private var activity: AppCompatActivity? = null
    private var ads: AdsConfig? = null
    private var gate: InterstitialGate? = null
    private val bannerRetry = RetryGate()
    private val interstitialRetry = RetryGate()
    private var initialized = false
    private var banner: AdView? = null
    private var interstitial: InterstitialAd? = null
    private var loadingInterstitial = false

    private fun now() = SystemClock.elapsedRealtime()

    fun start(activity: AppCompatActivity, ads: AdsConfig?) {
        if (ads == null) return
        this.activity = activity
        this.ads = ads
        gate = InterstitialGate(ads.interstitialGapMs, now())

        val consent = UserMessagingPlatform.getConsentInformation(activity)
        val params = ConsentRequestParameters.Builder().setTagForUnderAgeOfConsent(ads.childDirected).build()
        consent.requestConsentInfoUpdate(
            activity,
            params,
            { UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { afterConsent(consent) } },
            { afterConsent(consent) },
        )
        // A visitor who answered in an earlier session can be served at once.
        if (consent.canRequestAds()) initialize()
    }

    fun stop() {
        main.removeCallbacksAndMessages(null)
        banner?.destroy()
        banner = null
        interstitial = null
        activity = null
        initialized = false
    }

    fun onPageFinished() {
        val current = gate ?: return
        val host = activity ?: return
        if (!initialized) return
        if (!current.onPageFinished(now())) return
        val ad = interstitial
        if (ad == null) {
            loadInterstitial()
            return
        }
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                interstitial = null
                loadInterstitial()
            }

            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                interstitial = null
            }
        }
        current.shown(now())
        ad.show(host)
    }

    private fun afterConsent(consent: ConsentInformation) {
        val host = activity ?: return
        if (consent.canRequestAds()) initialize()
        val needed = consent.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
        host.findViewById<View>(R.id.ad_privacy).apply {
            visibility = if (needed) View.VISIBLE else View.GONE
            setOnClickListener { UserMessagingPlatform.showPrivacyOptionsForm(host) { } }
        }
    }

    private fun initialize() {
        val host = activity ?: return
        val config = ads ?: return
        if (initialized) return
        initialized = true
        val tag = if (config.childDirected) RequestConfiguration.TAG_FOR_CHILD_DIRECTED_TREATMENT_TRUE else RequestConfiguration.TAG_FOR_CHILD_DIRECTED_TREATMENT_UNSPECIFIED
        val under = if (config.childDirected) RequestConfiguration.TAG_FOR_UNDER_AGE_OF_CONSENT_TRUE else RequestConfiguration.TAG_FOR_UNDER_AGE_OF_CONSENT_UNSPECIFIED
        MobileAds.setRequestConfiguration(RequestConfiguration.Builder().setTagForChildDirectedTreatment(tag).setTagForUnderAgeOfConsent(under).build())
        MobileAds.initialize(host) {}
        if (config.bannerUnitId != null) showBanner(host, config)
        if (config.interstitialUnitId != null) loadInterstitial()
    }

    private fun showBanner(host: AppCompatActivity, config: AdsConfig) {
        val container = host.findViewById<FrameLayout>(if (config.bannerOnTop) R.id.ad_top else R.id.ad_bottom)
        val widthDp = (host.resources.displayMetrics.run { widthPixels / density }).toInt()
        val view = AdView(host).apply {
            adUnitId = config.bannerUnitId!!
            setAdSize(AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(host, widthDp))
            adListener = object : AdListener() {
                // Hidden until an ad arrives, so a refused request leaves no blank strip.
                override fun onAdLoaded() {
                    container.visibility = View.VISIBLE
                }

                override fun onAdFailedToLoad(error: LoadAdError) {
                    container.visibility = View.GONE
                    main.postDelayed({ reloadBanner() }, RetryGate.RETRY_MS)
                }
            }
        }
        banner = view
        container.addView(view)
        view.loadAd(AdRequest.Builder().build())
    }

    private fun reloadBanner() {
        if (bannerRetry.allow(now())) banner?.loadAd(AdRequest.Builder().build())
    }

    private fun loadInterstitial() {
        val host = activity ?: return
        val unit = ads?.interstitialUnitId ?: return
        if (interstitial != null || loadingInterstitial || !interstitialRetry.allow(now())) return
        loadingInterstitial = true
        InterstitialAd.load(host, unit, AdRequest.Builder().build(), object : InterstitialAdLoadCallback() {
            override fun onAdLoaded(ad: InterstitialAd) {
                loadingInterstitial = false
                interstitial = ad
            }

            override fun onAdFailedToLoad(error: LoadAdError) {
                loadingInterstitial = false
                interstitial = null
            }
        })
    }
}
