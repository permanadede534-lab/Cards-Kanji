package com.example

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

data class SavedFileMeta(
  val name: String,
  val mimeType: String,
  val size: Long,
  val lastModified: Long,
) {
  fun toJsonString(): String = JSONObject().apply {
    put("name", name)
    put("mimeType", mimeType)
    put("size", size)
    put("lastModified", lastModified)
  }.toString()

  companion object {
    fun fromJsonString(raw: String): SavedFileMeta? {
      return try {
        val obj = JSONObject(raw)
        val name = obj.optString("name", "").trim()
        if (name.isEmpty()) return null
        SavedFileMeta(
          name = name,
          mimeType = obj.optString("mimeType", ""),
          size = obj.optLong("size", 0L),
          lastModified = obj.optLong("lastModified", 0L),
        )
      } catch (_: Throwable) {
        null
      }
    }
  }
}

class MinnaFileStore(context: Context) {
  private val appContext = context.applicationContext
  private val storeDir = File(appContext.filesDir, "minna1")
  private val binFile = File(storeDir, "saved_file.bin")
  private val metaFile = File(storeDir, "saved_file.meta.json")
  private val annotationsFile = File(storeDir, "annotations.json")
  private val readerStateFile = File(storeDir, "reader_state.json")
  private val toolPrefsFile = File(storeDir, "tool_prefs.json")
  private val cacheDir = File(appContext.filesDir, "cdn_cache")
  private val lock = Any()

  @Volatile private var activeChunkSessionId: String? = null
  @Volatile private var activeChunkFile: File? = null

  fun saveFromUri(contentResolver: ContentResolver, uri: Uri): SavedFileMeta? {
    synchronized(lock) {
      ensureDir(storeDir)
      val tmpBin = File(storeDir, "saved_file.bin.tmp")
      var totalBytes = 0L

      val copied = try {
        contentResolver.openInputStream(uri)?.use { input ->
          FileOutputStream(tmpBin).use { out ->
            val buf = ByteArray(64 * 1024)
            while (true) {
              val read = input.read(buf)
              if (read <= 0) break
              out.write(buf, 0, read)
              totalBytes += read
            }
            out.flush()
          }
          true
        } ?: false
      } catch (_: Throwable) {
        false
      }

      if (!copied || totalBytes <= 0L) {
        tmpBin.delete()
        return null
      }

      val resolved = queryUriMetadata(contentResolver, uri, totalBytes)
      if (!replaceAtomically(tmpBin, binFile)) {
        tmpBin.delete()
        return null
      }

      if (!writeMetaLocked(resolved)) {
        return null
      }
      return resolved
    }
  }

  fun beginChunkSave(sessionId: String) {
    synchronized(lock) {
      ensureDir(storeDir)
      activeChunkFile?.delete()
      activeChunkSessionId = sessionId
      activeChunkFile = File(storeDir, "saved_file.chunk.tmp").apply {
        if (exists()) delete()
      }
    }
  }

  fun appendChunk(sessionId: String, bytes: ByteArray): Boolean {
    synchronized(lock) {
      val chunkFile = activeChunkFile ?: return false
      if (activeChunkSessionId != sessionId) return false
      return try {
        FileOutputStream(chunkFile, true).use { out ->
          out.write(bytes)
          out.flush()
        }
        true
      } catch (_: Throwable) {
        false
      }
    }
  }

  fun commitChunkSave(
    sessionId: String,
    name: String,
    mimeType: String,
    lastModified: Long,
  ): SavedFileMeta? {
    synchronized(lock) {
      val chunkFile = activeChunkFile ?: return null
      if (activeChunkSessionId != sessionId) return null
      activeChunkSessionId = null
      activeChunkFile = null

      val length = chunkFile.length()
      if (!chunkFile.exists() || length <= 0L) {
        chunkFile.delete()
        return null
      }

      if (!replaceAtomically(chunkFile, binFile)) {
        chunkFile.delete()
        return null
      }

      val cleanName = name.trim().ifEmpty { "minna_file" }
      val resolvedMime = mimeType.trim().ifEmpty { inferMimeType(cleanName) }
      val meta = SavedFileMeta(
        name = cleanName,
        mimeType = resolvedMime,
        size = length,
        lastModified = if (lastModified > 0L) lastModified else System.currentTimeMillis(),
      )
      writeMetaLocked(meta)
      return meta
    }
  }

  fun syncMeta(name: String, mimeType: String, size: Long, lastModified: Long): Boolean {
    synchronized(lock) {
      if (!binFile.exists() || binFile.length() <= 0L) return false
      val cleanName = name.trim().ifEmpty {
        getSavedMetaLocked()?.name ?: "minna_file"
      }
      val resolvedMime = mimeType.trim().ifEmpty { inferMimeType(cleanName) }
      val resolvedSize = if (size > 0L) size else binFile.length()
      val resolvedLastMod = if (lastModified > 0L) {
        lastModified
      } else {
        getSavedMetaLocked()?.lastModified ?: System.currentTimeMillis()
      }
      return writeMetaLocked(
        SavedFileMeta(
          name = cleanName,
          mimeType = resolvedMime,
          size = resolvedSize,
          lastModified = resolvedLastMod,
        )
      )
    }
  }

  fun hasSavedFile(): Boolean {
    synchronized(lock) {
      return binFile.exists() && binFile.length() > 0L && getSavedMetaLocked() != null
    }
  }

  fun getSavedMeta(): SavedFileMeta? {
    synchronized(lock) {
      return getSavedMetaLocked()
    }
  }

  fun openSavedStream(): InputStream? {
    synchronized(lock) {
      if (!binFile.exists() || binFile.length() <= 0L) return null
      return try {
        FileInputStream(binFile)
      } catch (_: Throwable) {
        null
      }
    }
  }

  fun deleteSavedFile(): Boolean {
    synchronized(lock) {
      activeChunkSessionId = null
      activeChunkFile?.delete()
      activeChunkFile = null
      File(storeDir, "saved_file.bin.tmp").delete()
      File(storeDir, "saved_file.meta.json.tmp").delete()
      val binDeleted = !binFile.exists() || binFile.delete()
      val metaDeleted = !metaFile.exists() || metaFile.delete()
      return binDeleted && metaDeleted
    }
  }

  fun saveAnnotationsJson(json: String): Boolean = writeTextLocked(annotationsFile, json)

  fun loadAnnotationsJson(): String = readTextLocked(annotationsFile)

  fun saveReaderStateJson(json: String): Boolean = writeTextLocked(readerStateFile, json)

  fun loadReaderStateJson(): String = readTextLocked(readerStateFile)

  fun saveToolPrefsJson(json: String): Boolean = writeTextLocked(toolPrefsFile, json)

  fun loadToolPrefsJson(): String = readTextLocked(toolPrefsFile)

  private fun writeTextLocked(target: File, content: String): Boolean {
    synchronized(lock) {
      ensureDir(storeDir)
      val tmp = File(storeDir, target.name + ".tmp")
      return try {
        tmp.writeText(content, StandardCharsets.UTF_8)
        replaceAtomically(tmp, target)
      } catch (_: Throwable) {
        tmp.delete()
        false
      }
    }
  }

  private fun readTextLocked(target: File): String {
    synchronized(lock) {
      if (!target.exists()) return ""
      return try {
        target.readText(StandardCharsets.UTF_8)
      } catch (_: Throwable) {
        ""
      }
    }
  }

  fun isAllowedCdnScript(urlString: String): Boolean {
    return urlString in ALLOWED_CDN_SCRIPTS
  }

  fun getCachedScriptOrFetch(urlString: String): ByteArray? {
    if (!isAllowedCdnScript(urlString)) return null
    ensureDir(cacheDir)
    val cacheFile = File(cacheDir, sha256(urlString) + ".js")
    if (cacheFile.exists() && cacheFile.length() > 0L) {
      return try {
        cacheFile.readBytes()
      } catch (_: Throwable) {
        null
      }
    }

    var conn: HttpURLConnection? = null
    return try {
      conn = (URL(urlString).openConnection() as HttpURLConnection).apply {
        connectTimeout = 10_000
        readTimeout = 15_000
        instanceFollowRedirects = true
        requestMethod = "GET"
      }
      if (conn.responseCode !in 200..299) return null
      val bytes = conn.inputStream.use { it.readBytes() }
      if (bytes.isEmpty()) return null
      val tmp = File(cacheDir, cacheFile.name + ".tmp")
      FileOutputStream(tmp).use {
        it.write(bytes)
        it.flush()
      }
      replaceAtomically(tmp, cacheFile)
      bytes
    } catch (_: Throwable) {
      null
    } finally {
      try {
        conn?.disconnect()
      } catch (_: Throwable) {
      }
    }
  }

  private fun getSavedMetaLocked(): SavedFileMeta? {
    if (!metaFile.exists()) return null
    return try {
      val raw = metaFile.readText(StandardCharsets.UTF_8)
      SavedFileMeta.fromJsonString(raw)
    } catch (_: Throwable) {
      null
    }
  }

  private fun writeMetaLocked(meta: SavedFileMeta): Boolean {
    ensureDir(storeDir)
    val tmpMeta = File(storeDir, "saved_file.meta.json.tmp")
    return try {
      tmpMeta.writeText(meta.toJsonString(), StandardCharsets.UTF_8)
      replaceAtomically(tmpMeta, metaFile)
    } catch (_: Throwable) {
      tmpMeta.delete()
      false
    }
  }

  private fun queryUriMetadata(
    contentResolver: ContentResolver,
    uri: Uri,
    fallbackSize: Long,
  ): SavedFileMeta {
    var displayName: String? = null
    var queriedSize: Long = fallbackSize
    var queriedLastMod: Long = 0L

    try {
      contentResolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null,
        null,
        null,
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
            displayName = cursor.getString(nameIdx)
          }
          val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
            val s = cursor.getLong(sizeIdx)
            if (s > 0L) queriedSize = s
          }
        }
      }
    } catch (_: Throwable) {
    }

    try {
      contentResolver.query(
        uri,
        arrayOf(DocumentsContract.Document.COLUMN_LAST_MODIFIED),
        null,
        null,
        null,
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          val idx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
          if (idx >= 0 && !cursor.isNull(idx)) {
            queriedLastMod = cursor.getLong(idx)
          }
        }
      }
    } catch (_: Throwable) {
    }

    val cleanName = displayName?.trim()?.takeIf { it.isNotEmpty() }
      ?: uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotEmpty() }
      ?: "minna_file"

    val rawMime = try {
      contentResolver.getType(uri).orEmpty()
    } catch (_: Throwable) {
      ""
    }
    val resolvedMime = rawMime.ifBlank { inferMimeType(cleanName) }

    return SavedFileMeta(
      name = cleanName,
      mimeType = resolvedMime,
      size = queriedSize,
      lastModified = if (queriedLastMod > 0L) queriedLastMod else System.currentTimeMillis(),
    )
  }

  private fun ensureDir(dir: File) {
    if (!dir.exists()) {
      dir.mkdirs()
    }
  }

  private fun replaceAtomically(src: File, dst: File): Boolean {
    if (src.renameTo(dst)) return true
    if (dst.exists() && dst.delete() && src.renameTo(dst)) return true
    return false
  }

  private fun sha256(value: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
      .digest(value.toByteArray(StandardCharsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
  }

  companion object {
    private val ALLOWED_CDN_SCRIPTS = setOf(
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
    )

    fun inferMimeType(fileName: String): String {
      return when (fileName.substringAfterLast('.', "").lowercase()) {
        "pdf" -> "application/pdf"
        "doc" -> "application/msword"
        "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        "xls" -> "application/vnd.ms-excel"
        "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        "csv" -> "text/csv"
        "ods" -> "application/vnd.oasis.opendocument.spreadsheet"
        "jpg", "jpeg" -> "image/jpeg"
        "png" -> "image/png"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        "bmp" -> "image/bmp"
        "svg" -> "image/svg+xml"
        "txt", "md", "log" -> "text/plain"
        "json" -> "application/json"
        "xml" -> "application/xml"
        else -> "application/octet-stream"
      }
    }
  }
}
