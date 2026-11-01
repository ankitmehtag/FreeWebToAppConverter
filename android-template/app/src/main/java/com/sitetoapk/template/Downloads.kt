package com.sitetoapk.template

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast

fun Context.startDownload(url: String, userAgent: String, contentDisposition: String?, mimeType: String?) {
    if (UrlRouter.safeFallback(url) == null) {
        Toast.makeText(this, R.string.download_blocked, Toast.LENGTH_SHORT).show()
        return
    }
    val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
    val request = DownloadManager.Request(Uri.parse(url))
        .setMimeType(mimeType)
        .addRequestHeader("User-Agent", userAgent)
        .setTitle(name)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
    CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }

    // Public Downloads needs a storage permission before Android 10.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
    } else {
        request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name)
    }

    getSystemService(DownloadManager::class.java).enqueue(request)
    Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show()
}
