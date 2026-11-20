package com.example

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.nio.charset.StandardCharsets

private const val APP_ORIGIN = "https://appassets.androidplatform.net"
private const val ENTRY_URL = "$APP_ORIGIN/assets/kanji.html"

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
    )
    setContent {
      KanjiCardsHost(
        onSystemBarThemeChange = { bgColorInt, isDark ->
          enableEdgeToEdge(
            statusBarStyle = if (isDark) {
              SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
            } else {
              SystemBarStyle.light(android.graphics.Color.TRANSPARENT, bgColorInt)
            },
            navigationBarStyle = if (isDark) {
              SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
            } else {
              SystemBarStyle.light(android.graphics.Color.TRANSPARENT, bgColorInt)
            },
          )
        },
        onExitApp = { finish() },
      )
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun KanjiCardsHost(
  onSystemBarThemeChange: (bgColorInt: Int, isDark: Boolean) -> Unit,
  onExitApp: () -> Unit,
) {
  val context = LocalContext.current
  val minnaStore = remember(context) { MinnaFileStore(context) }
  val coroutineScope = rememberCoroutineScope()
  var bgColor by remember { mutableStateOf(Color(0xFF09090F)) }
  var isDarkTheme by remember { mutableStateOf(true) }
  var webViewRef by remember { mutableStateOf<WebView?>(null) }

  var pendingFileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
  var pendingFileTargetIsMinna by remember { mutableStateOf(false) }
  var pendingDownloadBytes by remember { mutableStateOf<ByteArray?>(null) }
  var pendingExportMinna by remember { mutableStateOf(false) }
  var bridgeRef by remember { mutableStateOf<KanjiWebBridge?>(null) }

  LaunchedEffect(bgColor, isDarkTheme) {
    onSystemBarThemeChange(bgColor.toArgb(), isDarkTheme)
  }

  val fileChooserLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.StartActivityForResult()
  ) { result ->
    val callback = pendingFileCallback
    pendingFileCallback = null
    val isMinna = pendingFileTargetIsMinna
    pendingFileTargetIsMinna = false
    if (callback == null) return@rememberLauncherForActivityResult
    val parsed = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
    val uris = parsed ?: result.data?.data?.let { arrayOf(it) }
    if (isMinna && uris != null && uris.isNotEmpty()) {
      val pickedUri = uris[0]
      coroutineScope.launch {
        val saved = withContext(Dispatchers.IO) {
          minnaStore.saveFromUri(context.contentResolver, pickedUri)
        }
        if (saved != null) {
          bridgeRef?.markSavedViaPicker()
        }
        callback.onReceiveValue(uris)
      }
    } else {
      callback.onReceiveValue(uris)
    }
  }

  val photoPickerLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.PickVisualMedia()
  ) { uri ->
    val callback = pendingFileCallback
    pendingFileCallback = null
    pendingFileTargetIsMinna = false
    callback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
  }

  val createDocumentLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.CreateDocument("*/*")
  ) { uri ->
    val bytes = pendingDownloadBytes
    val exportMinna = pendingExportMinna
    pendingDownloadBytes = null
    pendingExportMinna = false
    if (uri == null) return@rememberLauncherForActivityResult
    if (exportMinna) {
      coroutineScope.launch {
        val ok = withContext(Dispatchers.IO) {
          try {
            minnaStore.openSavedStream()?.use { input ->
              context.contentResolver.openOutputStream(uri)?.use { out ->
                input.copyTo(out)
                out.flush()
                true
              } ?: false
            } ?: false
          } catch (_: Throwable) {
            false
          }
        }
        Toast.makeText(
          context,
          if (ok) "File berhasil disimpan" else "Gagal menyimpan file",
          Toast.LENGTH_SHORT
        ).show()
      }
    } else if (bytes != null) {
      try {
        context.contentResolver.openOutputStream(uri)?.use { out ->
          out.write(bytes)
          out.flush()
        }
        Toast.makeText(context, "File berhasil disimpan", Toast.LENGTH_SHORT).show()
      } catch (_: Throwable) {
        Toast.makeText(context, "Gagal menyimpan file", Toast.LENGTH_SHORT).show()
      }
    }
  }

  val audioPermissionLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.RequestPermission()
  ) { granted ->
    bridgeRef?.onAudioPermissionResult(granted)
  }

  val bridge = remember(context) {
    KanjiWebBridge(
      context = context,
      minnaStore = minnaStore,
      webViewProvider = { webViewRef },
      requestAudioPermission = {
        audioPermissionLauncher.launch(android.Manifest.permission.RECORD_AUDIO)
      },
      onSaveFileRequest = { filename, _, bytes ->
        pendingExportMinna = false
        pendingDownloadBytes = bytes
        createDocumentLauncher.launch(filename)
      },
      onExportMinnaFileRequest = { filename, _ ->
        pendingDownloadBytes = null
        pendingExportMinna = true
        createDocumentLauncher.launch(filename)
      },
      onThemeUpdate = { colorInt, dark ->
        bgColor = Color(colorInt)
        isDarkTheme = dark
      },
    ).also { bridgeRef = it }
  }

  DisposableEffect(bridge) {
    onDispose {
      bridge.destroy()
      webViewRef?.destroy()
      webViewRef = null
    }
  }

  BackHandler {
    val wv = webViewRef
    if (wv != null && wv.canGoBack()) {
      wv.goBack()
    } else {
      onExitApp()
    }
  }

  val assetLoader = remember(context) {
    WebViewAssetLoader.Builder()
      .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
      .build()
  }

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(bgColor)
      .windowInsetsPadding(WindowInsets.safeDrawing)
      .imePadding()
  ) {
    AndroidView(
      modifier = Modifier.fillMaxSize(),
      factory = { ctx ->
        WebView(ctx).apply {
          layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
          )
          setBackgroundColor(android.graphics.Color.TRANSPARENT)
          overScrollMode = WebView.OVER_SCROLL_NEVER
          isVerticalScrollBarEnabled = false
          isHorizontalScrollBarEnabled = false

          settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
          }

          addJavascriptInterface(bridge, "AndroidBridge")

          webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
              view: WebView?,
              request: WebResourceRequest?,
            ): WebResourceResponse? {
              val url = request?.url ?: return null
              val urlStr = url.toString()
              if (urlStr == ENTRY_URL) {
                return try {
                  val html = ctx.assets.open("kanji.html").bufferedReader(StandardCharsets.UTF_8).use {
                    it.readText()
                  }
                  val bridgeScriptTag = "<script src=\"$APP_ORIGIN/assets/android_bridge.js\"></script>"
                  val injected = html.replaceFirst(
                    "<head><meta charset=\"utf-8\">",
                    "<head><meta charset=\"utf-8\">$bridgeScriptTag",
                  )
                  WebResourceResponse(
                    "text/html",
                    "utf-8",
                    ByteArrayInputStream(injected.toByteArray(StandardCharsets.UTF_8)),
                  )
                } catch (_: Throwable) {
                  assetLoader.shouldInterceptRequest(url)
                }
              }
              if (urlStr == "$APP_ORIGIN/__minna_saved_file__") {
                val meta = minnaStore.getSavedMeta()
                val stream = minnaStore.openSavedStream()
                val headers = mapOf(
                  "Access-Control-Allow-Origin" to "*",
                  "Cache-Control" to "no-store",
                )
                return if (meta != null && stream != null) {
                  WebResourceResponse(
                    meta.mimeType.ifBlank { "application/octet-stream" },
                    null,
                    200,
                    "OK",
                    headers,
                    stream,
                  )
                } else {
                  WebResourceResponse(
                    "text/plain",
                    "utf-8",
                    404,
                    "Not Found",
                    headers,
                    ByteArrayInputStream(ByteArray(0)),
                  )
                }
              }
              if (minnaStore.isAllowedCdnScript(urlStr)) {
                val bytes = minnaStore.getCachedScriptOrFetch(urlStr)
                if (bytes != null) {
                  return WebResourceResponse(
                    "application/javascript",
                    "utf-8",
                    200,
                    "OK",
                    mapOf(
                      "Access-Control-Allow-Origin" to "*",
                      "Cache-Control" to "public, max-age=31536000",
                    ),
                    ByteArrayInputStream(bytes),
                  )
                }
              }
              return assetLoader.shouldInterceptRequest(url)
            }

            override fun shouldOverrideUrlLoading(
              view: WebView?,
              request: WebResourceRequest?,
            ): Boolean {
              val url = request?.url ?: return false
              if (url.host == "appassets.androidplatform.net") {
                return false
              }
              return try {
                ctx.startActivity(Intent(Intent.ACTION_VIEW, url))
                true
              } catch (_: Throwable) {
                false
              }
            }
          }

          webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
              if (request == null) return
              if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
              } else {
                request.deny()
              }
            }

            override fun onShowFileChooser(
              webView: WebView?,
              filePathCallback: ValueCallback<Array<Uri>>?,
              fileChooserParams: FileChooserParams?,
            ): Boolean {
              pendingFileCallback?.onReceiveValue(null)
              pendingFileCallback = filePathCallback

              val acceptTypes = fileChooserParams?.acceptTypes
                ?.flatMap { it.split(',') }
                ?.map { it.trim() }
                ?.filter { it.isNotEmpty() }
                .orEmpty()

              val markedMinna = bridge.consumeMinnaPicker()
              pendingFileTargetIsMinna = markedMinna ||
                acceptTypes.any {
                  it.equals(".pdf", ignoreCase = true) ||
                    it.equals("application/pdf", ignoreCase = true) ||
                    it.equals(".docx", ignoreCase = true) ||
                    it.equals(".xlsx", ignoreCase = true)
                }

              // Use zero-permission Android Photo Picker for image-only inputs
              if (!pendingFileTargetIsMinna && acceptTypes.size == 1 && acceptTypes[0].equals("image/*", ignoreCase = true)) {
                photoPickerLauncher.launch(
                  PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                )
                return true
              }

              val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = if (!pendingFileTargetIsMinna && acceptTypes.size == 1 && acceptTypes[0].equals("audio/*", ignoreCase = true)) {
                  "audio/*"
                } else {
                  "*/*"
                }
              }
              return try {
                fileChooserLauncher.launch(intent)
                true
              } catch (_: Throwable) {
                pendingFileCallback?.onReceiveValue(null)
                pendingFileCallback = null
                pendingFileTargetIsMinna = false
                false
              }
            }
          }

          webViewRef = this
          loadUrl(ENTRY_URL)
        }
      },
      update = { wv ->
        webViewRef = wv
      },
    )
  }
}
