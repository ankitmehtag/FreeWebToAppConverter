package com.sitetoapk.template

import android.content.ActivityNotFoundException
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.os.Message
import android.view.View
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.graphics.ColorUtils
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import java.io.IOException

class MainActivity : AppCompatActivity() {
    private lateinit var config: AppConfig
    private lateinit var refresh: SwipeRefreshLayout
    private lateinit var webContainer: FrameLayout
    private lateinit var progress: ProgressBar
    private lateinit var messagePanel: View
    private lateinit var messageText: TextView
    private lateinit var webView: WebView

    private var currentUrl: String? = null
    private var pendingUpload: ValueCallback<Array<Uri>>? = null
    private var firstPageShown = false

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        pendingUpload?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        pendingUpload = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)

        val loaded = AppConfig.parse(readConfig())
        if (loaded == null) {
            setContentView(R.layout.activity_config_error)
            applyWatermark()
            return
        }
        config = loaded

        // Without this the splash ends on the first frame, before the page has loaded.
        splash.setKeepOnScreenCondition { !firstPageShown }
        window.decorView.postDelayed({ firstPageShown = true }, SPLASH_MAX_MS)

        setContentView(R.layout.activity_main)
        refresh = findViewById(R.id.refresh)
        webContainer = findViewById(R.id.web_container)
        progress = findViewById(R.id.progress)
        messagePanel = findViewById(R.id.message_panel)
        messageText = findViewById(R.id.message_text)

        applyUi()
        applyWatermark()
        findViewById<Button>(R.id.retry).setOnClickListener { retry() }
        refresh.setOnRefreshListener { webView.reload() }
        // SwipeRefreshLayout keeps its first child for good, so the WebView sits in a
        // container that survives recreateWebView, and the scroll check is done here.
        refresh.setOnChildScrollUpCallback { _, _ -> webView.canScrollVertically(-1) }
        onBackPressedDispatcher.addCallback(this, backHandler)

        webView = createWebView()
        webContainer.addView(webView)
        load(config.startUrl)
        Push.start(this, notificationPermission)
    }

    override fun onDestroy() {
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    private fun readConfig(): String? = try {
        assets.open("app_config.json").bufferedReader().use { it.readText() }
    } catch (_: IOException) {
        null
    }

    // Shown by the layout, so that only an explicit Premium build can hide it.
    private fun applyWatermark() {
        if (!BuildConfig.WATERMARK) findViewById<View>(R.id.watermark).visibility = View.GONE
    }

    private fun applyUi() {
        val ui = config.ui
        val color = Color.parseColor(ui.statusBarColor)
        val root = findViewById<View>(R.id.root)

        // Android 15 draws apps edge to edge and ignores the status bar colour, so the
        // root view paints that area and the insets keep content clear of the bars.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        root.setBackgroundColor(color)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        WindowCompat.getInsetsController(window, root).isAppearanceLightStatusBars =
            ColorUtils.calculateLuminance(color) > 0.5

        requestedOrientation = when (ui.orientation) {
            "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        refresh.isEnabled = ui.pullToRefresh
    }

    private fun createWebView() = WebView(this).apply {
        applyHardening()
        settings.setSupportZoom(config.ui.zoom)
        settings.builtInZoomControls = config.ui.zoom
        settings.displayZoomControls = false
        webViewClient = PageClient()
        webChromeClient = ChromeClient()
        setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            startDownload(url, userAgent, contentDisposition, mimeType)
        }
    }

    private fun load(url: String) {
        currentUrl = url
        hideMessage()
        webView.loadUrl(url)
    }

    private fun retry() = load(currentUrl ?: config.startUrl)

    private fun showMessage(text: Int) {
        firstPageShown = true
        messageText.setText(text)
        messagePanel.visibility = View.VISIBLE
        progress.visibility = View.GONE
        refresh.isRefreshing = false
    }

    private fun hideMessage() {
        messagePanel.visibility = View.GONE
    }

    /** Applies the routing rules. Returns true when the WebView must not load [url]. */
    private fun intercept(url: String): Boolean {
        val route = UrlRouter.route(url, config.internalHosts)
        if (route == Route.WEBVIEW) return false
        openOutside(url, route)
        return true
    }

    private fun recreateWebView() {
        webContainer.removeView(webView)
        webView.destroy()
        webView = createWebView()
        webContainer.addView(webView)
        retry()
    }

    private val backHandler = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            when {
                webView.canGoBack() -> {
                    hideMessage()
                    webView.goBack()
                }
                config.ui.exitDialog -> AlertDialog.Builder(this@MainActivity)
                    .setMessage(R.string.exit_message)
                    .setPositiveButton(R.string.exit_confirm) { _, _ -> finish() }
                    .setNegativeButton(R.string.exit_cancel, null)
                    .show()
                else -> finish()
            }
        }
    }

    private inner class PageClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            request.isForMainFrame && intercept(request.url.toString())

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            currentUrl = url
        }

        override fun onPageFinished(view: WebView, url: String) {
            firstPageShown = true
            refresh.isRefreshing = false
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                currentUrl = request.url.toString()
                showMessage(R.string.offline_message)
            }
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            showMessage(R.string.ssl_message)
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            recreateWebView()
            return true
        }
    }

    private inner class ChromeClient : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress.progress = newProgress
            val loading = config.ui.progressBar && newProgress < 100
            progress.visibility = if (loading) View.VISIBLE else View.GONE
        }

        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            pendingUpload?.onReceiveValue(null)
            pendingUpload = callback
            return try {
                filePicker.launch(params.createIntent())
                true
            } catch (_: ActivityNotFoundException) {
                pendingUpload = null
                false
            }
        }

        // The URL is only known once the popup starts loading, so a throwaway
        // WebView catches it and hands it to the normal routing rules.
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (!isUserGesture) return false
            val popup = WebView(this@MainActivity).apply { applyHardening() }
            popup.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(popupView: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url.toString()
                    if (!intercept(url)) load(url)
                    popupView.destroy()
                    return true
                }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = popup
            resultMsg.sendToTarget()
            return true
        }
    }
}

private const val SPLASH_MAX_MS = 3000L
