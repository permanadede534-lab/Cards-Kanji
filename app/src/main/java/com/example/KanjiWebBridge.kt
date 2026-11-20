package com.example

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

class KanjiWebBridge(
  private val context: Context,
  private val minnaStore: MinnaFileStore,
  private val webViewProvider: () -> WebView?,
  private val requestAudioPermission: () -> Unit,
  private val onSaveFileRequest: (filename: String, mimeType: String, bytes: ByteArray) -> Unit,
  private val onExportMinnaFileRequest: (filename: String, mimeType: String) -> Unit,
  private val onThemeUpdate: (bgColorInt: Int, isDark: Boolean) -> Unit,
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  @Volatile private var pendingMinnaPicker = false
  @Volatile private var justSavedViaPicker = false
  private var tts: TextToSpeech? = null
  @Volatile private var ttsReady = false
  @Volatile private var cachedVoicesJson: String = "[]"

  private var speechRecognizer: SpeechRecognizer? = null
  private var pendingSpeechId: String? = null
  private var pendingSpeechLang: String = "id-ID"
  private var activeSpeechId: String? = null

  init {
    tts = TextToSpeech(context.applicationContext) { status ->
      if (status == TextToSpeech.SUCCESS) {
        ttsReady = true
        refreshVoicesCache()
        tts?.setOnUtteranceProgressListener(
          object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
              if (utteranceId != null) dispatchJs("window.__onTtsEvent(${JSONObject.quote(utteranceId)}, 'start')")
            }

            override fun onDone(utteranceId: String?) {
              if (utteranceId != null) dispatchJs("window.__onTtsEvent(${JSONObject.quote(utteranceId)}, 'end')")
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
              if (utteranceId != null) dispatchJs("window.__onTtsEvent(${JSONObject.quote(utteranceId)}, 'error')")
            }

            override fun onError(utteranceId: String?, errorCode: Int) {
              if (utteranceId != null) dispatchJs("window.__onTtsEvent(${JSONObject.quote(utteranceId)}, 'error')")
            }
          }
        )
        dispatchJs("window.__onVoicesChanged && window.__onVoicesChanged()")
      }
    }
  }

  private fun refreshVoicesCache() {
    val engine = tts ?: return
    val arr = JSONArray()
    try {
      val voices: Set<Voice> = engine.voices ?: emptySet()
      val filtered = voices
        .filter { v ->
          val lang = v.locale?.toLanguageTag().orEmpty()
          lang.startsWith("ja", ignoreCase = true) ||
            lang.startsWith("id", ignoreCase = true) ||
            lang.startsWith("in", ignoreCase = true)
        }
        .ifEmpty { voices.take(20) }
        .sortedBy { it.name }

      for (v in filtered) {
        val rawLang = v.locale?.toLanguageTag() ?: ""
        val normLang = if (rawLang.startsWith("in", ignoreCase = true)) {
          "id" + rawLang.drop(2)
        } else {
          rawLang
        }
        arr.put(
          JSONObject().apply {
            put("name", v.name)
            put("lang", normLang)
            put("voiceURI", v.name)
            put("localService", !v.isNetworkConnectionRequired)
            put("default", v.name == engine.defaultVoice?.name)
          }
        )
      }
    } catch (_: Throwable) {
    }
    cachedVoicesJson = arr.toString()
  }

  @JavascriptInterface
  fun getVoicesJson(): String {
    if (ttsReady && cachedVoicesJson == "[]") {
      refreshVoicesCache()
    }
    return cachedVoicesJson
  }

  @JavascriptInterface
  fun speak(utteranceId: String, text: String, lang: String, voiceName: String, rate: Double) {
    mainHandler.post {
      val engine = tts
      if (engine == null || !ttsReady || text.isBlank()) {
        dispatchJs("window.__onTtsEvent(${JSONObject.quote(utteranceId)}, 'error')")
        return@post
      }
      try {
        if (voiceName.isNotEmpty()) {
          val match = engine.voices?.firstOrNull { it.name == voiceName }
          if (match != null) {
            engine.voice = match
          }
        } else if (lang.isNotEmpty()) {
          val locale = Locale.forLanguageTag(lang)
          engine.language = locale
        }
        engine.setSpeechRate(rate.toFloat().coerceIn(0.3f, 2.5f))
        val params = Bundle()
        val res = engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId)
        if (res == TextToSpeech.ERROR) {
          dispatchJs("window.__onTtsEvent(${JSONObject.quote(utteranceId)}, 'error')")
        }
      } catch (_: Throwable) {
        dispatchJs("window.__onTtsEvent(${JSONObject.quote(utteranceId)}, 'error')")
      }
    }
  }

  @JavascriptInterface
  fun cancelSpeech() {
    mainHandler.post {
      try {
        tts?.stop()
      } catch (_: Throwable) {
      }
    }
  }

  @JavascriptInterface
  fun startSpeech(speechId: String, lang: String) {
    mainHandler.post {
      val granted = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.RECORD_AUDIO
      ) == PackageManager.PERMISSION_GRANTED
      if (!granted) {
        pendingSpeechId = speechId
        pendingSpeechLang = lang.ifBlank { "id-ID" }
        requestAudioPermission()
        return@post
      }
      beginRecognition(speechId, lang.ifBlank { "id-ID" })
    }
  }

  @JavascriptInterface
  fun stopSpeech(speechId: String) {
    mainHandler.post {
      if (activeSpeechId == speechId) {
        try {
          speechRecognizer?.cancel()
          speechRecognizer?.destroy()
        } catch (_: Throwable) {
        }
        speechRecognizer = null
        activeSpeechId = null
      }
      if (pendingSpeechId == speechId) {
        pendingSpeechId = null
      }
    }
  }

  fun onAudioPermissionResult(granted: Boolean) {
    mainHandler.post {
      val id = pendingSpeechId ?: return@post
      val lang = pendingSpeechLang
      pendingSpeechId = null
      if (granted) {
        beginRecognition(id, lang)
      } else {
        dispatchJs("window.__onSpeechError(${JSONObject.quote(id)}, 'not-allowed')")
        dispatchJs("window.__onSpeechEnd(${JSONObject.quote(id)})")
      }
    }
  }

  private fun beginRecognition(speechId: String, lang: String) {
    try {
      speechRecognizer?.cancel()
      speechRecognizer?.destroy()
    } catch (_: Throwable) {
    }
    speechRecognizer = null
    activeSpeechId = speechId

    if (!SpeechRecognizer.isRecognitionAvailable(context)) {
      activeSpeechId = null
      dispatchJs("window.__onSpeechError(${JSONObject.quote(speechId)}, 'audio-capture')")
      dispatchJs("window.__onSpeechEnd(${JSONObject.quote(speechId)})")
      return
    }

    val recognizer = SpeechRecognizer.createSpeechRecognizer(context)
    speechRecognizer = recognizer
    recognizer.setRecognitionListener(
      object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
          if (activeSpeechId == speechId) {
            dispatchJs("window.__onSpeechStart(${JSONObject.quote(speechId)})")
          }
        }

        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}

        override fun onError(error: Int) {
          if (activeSpeechId != speechId) return
          activeSpeechId = null
          val code = when (error) {
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
            SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
            else -> "aborted"
          }
          dispatchJs("window.__onSpeechError(${JSONObject.quote(speechId)}, ${JSONObject.quote(code)})")
          dispatchJs("window.__onSpeechEnd(${JSONObject.quote(speechId)})")
        }

        override fun onResults(results: Bundle?) {
          if (activeSpeechId != speechId) return
          activeSpeechId = null
          val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
          if (text.isNotEmpty()) {
            dispatchJs("window.__onSpeechResult(${JSONObject.quote(speechId)}, ${JSONObject.quote(text)}, true)")
          }
          dispatchJs("window.__onSpeechEnd(${JSONObject.quote(speechId)})")
        }

        override fun onPartialResults(partialResults: Bundle?) {
          if (activeSpeechId != speechId) return
          val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
          if (text.isNotEmpty()) {
            dispatchJs("window.__onSpeechResult(${JSONObject.quote(speechId)}, ${JSONObject.quote(text)}, false)")
          }
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
      }
    )

    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    }
    try {
      recognizer.startListening(intent)
    } catch (_: Throwable) {
      activeSpeechId = null
      dispatchJs("window.__onSpeechError(${JSONObject.quote(speechId)}, 'audio-capture')")
      dispatchJs("window.__onSpeechEnd(${JSONObject.quote(speechId)})")
    }
  }

  @JavascriptInterface
  fun saveDownloadedFile(filename: String, mimeType: String, base64Data: String) {
    mainHandler.post {
      try {
        val bytes = Base64.decode(base64Data, Base64.DEFAULT)
        onSaveFileRequest(
          filename.ifBlank { "export" },
          mimeType.ifBlank { "application/octet-stream" },
          bytes
        )
      } catch (_: Throwable) {
      }
    }
  }

  @JavascriptInterface
  fun onThemeChanged(cssColor: String, isDark: Boolean) {
    mainHandler.post {
      val parsed = parseCssColor(cssColor)
      if (parsed != null) {
        onThemeUpdate(parsed, isDark)
      }
    }
  }

  @JavascriptInterface
  fun markMinnaPicker() {
    pendingMinnaPicker = true
  }

  fun consumeMinnaPicker(): Boolean {
    val wasPending = pendingMinnaPicker
    pendingMinnaPicker = false
    return wasPending
  }

  fun markSavedViaPicker() {
    justSavedViaPicker = true
  }

  @JavascriptInterface
  fun hasSavedMinnaFile(): Boolean = minnaStore.hasSavedFile()

  @JavascriptInterface
  fun getSavedMinnaMetaJson(): String = minnaStore.getSavedMeta()?.toJsonString().orEmpty()

  @JavascriptInterface
  fun syncMinnaMeta(name: String, mimeType: String, size: Double, lastModified: Double): Boolean {
    val fromPicker = justSavedViaPicker
    justSavedViaPicker = false
    if (!fromPicker || !minnaStore.hasSavedFile()) return false
    return minnaStore.syncMeta(
      name = name,
      mimeType = mimeType,
      size = size.toLong(),
      lastModified = lastModified.toLong(),
    )
  }

  @JavascriptInterface
  fun deleteSavedMinnaFile(): Boolean {
    justSavedViaPicker = false
    return minnaStore.deleteSavedFile()
  }

  @JavascriptInterface
  fun saveMinnaChunkBegin(sessionId: String) {
    justSavedViaPicker = false
    minnaStore.beginChunkSave(sessionId)
  }

  @JavascriptInterface
  fun saveMinnaChunkAppend(sessionId: String, base64Chunk: String): Boolean {
    return try {
      val bytes = Base64.decode(base64Chunk, Base64.DEFAULT)
      minnaStore.appendChunk(sessionId, bytes)
    } catch (_: Throwable) {
      false
    }
  }

  @JavascriptInterface
  fun saveMinnaChunkCommit(
    sessionId: String,
    name: String,
    mimeType: String,
    lastModified: Double,
  ): Boolean {
    return minnaStore.commitChunkSave(
      sessionId = sessionId,
      name = name,
      mimeType = mimeType,
      lastModified = lastModified.toLong(),
    ) != null
  }

  @JavascriptInterface
  fun exportSavedMinnaFile() {
    mainHandler.post {
      val meta = minnaStore.getSavedMeta() ?: return@post
      onExportMinnaFileRequest(meta.name, meta.mimeType.ifBlank { "application/octet-stream" })
    }
  }

  @JavascriptInterface
  fun saveMinnaAnnotations(json: String): Boolean = minnaStore.saveAnnotationsJson(json)

  @JavascriptInterface
  fun loadMinnaAnnotations(): String = minnaStore.loadAnnotationsJson()

  @JavascriptInterface
  fun saveMinnaReaderState(json: String): Boolean = minnaStore.saveReaderStateJson(json)

  @JavascriptInterface
  fun loadMinnaReaderState(): String = minnaStore.loadReaderStateJson()

  @JavascriptInterface
  fun saveMinnaToolPrefs(json: String): Boolean = minnaStore.saveToolPrefsJson(json)

  @JavascriptInterface
  fun loadMinnaToolPrefs(): String = minnaStore.loadToolPrefsJson()

  private fun parseCssColor(raw: String): Int? {
    val s = raw.trim()
    if (s.startsWith("#")) {
      return try {
        Color.parseColor(s)
      } catch (_: Throwable) {
        null
      }
    }
    val rgbMatch = Regex("""rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)""").find(s)
    if (rgbMatch != null) {
      val r = rgbMatch.groupValues[1].toInt().coerceIn(0, 255)
      val g = rgbMatch.groupValues[2].toInt().coerceIn(0, 255)
      val b = rgbMatch.groupValues[3].toInt().coerceIn(0, 255)
      return Color.rgb(r, g, b)
    }
    return null
  }

  private fun dispatchJs(script: String) {
    mainHandler.post {
      webViewProvider()?.evaluateJavascript(script, null)
    }
  }

  fun destroy() {
    try {
      speechRecognizer?.cancel()
      speechRecognizer?.destroy()
    } catch (_: Throwable) {
    }
    speechRecognizer = null
    try {
      tts?.stop()
      tts?.shutdown()
    } catch (_: Throwable) {
    }
    tts = null
  }
}
