package com.example

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class MinnaFileStoreTest {

  private lateinit var context: Context
  private lateinit var store: MinnaFileStore

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    store = MinnaFileStore(context)
    store.deleteSavedFile()
  }

  @After
  fun tearDown() {
    store.deleteSavedFile()
  }

  @Test
  fun `chunked save persists across new store instance until explicitly deleted`() {
    val payload = "%PDF-1.4\nSample Minna 1 Content\n%%EOF".toByteArray()
    val part1 = payload.copyOfRange(0, 12)
    val part2 = payload.copyOfRange(12, payload.size)

    store.beginChunkSave("sess-1")
    assertTrue(store.appendChunk("sess-1", part1))
    assertTrue(store.appendChunk("sess-1", part2))

    val committed = store.commitChunkSave(
      sessionId = "sess-1",
      name = "minna_bab1.pdf",
      mimeType = "application/pdf",
      lastModified = 1712345678000L,
    )
    assertNotNull(committed)

    // Simulate app reopen / device reboot with a brand-new MinnaFileStore instance
    val reopenedStore = MinnaFileStore(context)
    assertTrue(reopenedStore.hasSavedFile())
    val meta = reopenedStore.getSavedMeta()
    assertNotNull(meta)
    assertEquals("minna_bab1.pdf", meta?.name)
    assertEquals("application/pdf", meta?.mimeType)
    assertEquals(payload.size.toLong(), meta?.size)
    assertEquals(1712345678000L, meta?.lastModified)

    val restoredBytes = reopenedStore.openSavedStream()?.use { it.readBytes() }
    assertArrayEquals(payload, restoredBytes)

    // Explicit deletion clears storage permanently
    assertTrue(reopenedStore.deleteSavedFile())
    assertFalse(reopenedStore.hasSavedFile())
    assertNull(reopenedStore.getSavedMeta())
    assertNull(reopenedStore.openSavedStream())
  }

  @Test
  fun `saveFromUri copies file permanently and syncMeta aligns exact metadata`() {
    val tempSource = File(context.cacheDir, "lesson_notes.xlsx")
    val bytes = byteArrayOf(0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x01, 0x02)
    tempSource.writeBytes(bytes)

    val saved = store.saveFromUri(context.contentResolver, Uri.fromFile(tempSource))
    assertNotNull(saved)
    assertEquals("lesson_notes.xlsx", saved?.name)
    assertEquals(bytes.size.toLong(), saved?.size)

    // Delete original external source to verify internal copy is independent & permanent
    assertTrue(tempSource.delete())

    assertTrue(store.syncMeta("lesson_notes.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes.size.toLong(), 999999L))
    val reopened = MinnaFileStore(context)
    assertTrue(reopened.hasSavedFile())
    assertEquals(999999L, reopened.getSavedMeta()?.lastModified)
    assertArrayEquals(bytes, reopened.openSavedStream()?.use { it.readBytes() })
  }

  @Test
  fun `cdn script whitelist allows only trusted viewer libraries`() {
    assertTrue(store.isAllowedCdnScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"))
    assertTrue(store.isAllowedCdnScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"))
    assertTrue(store.isAllowedCdnScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"))
    assertTrue(store.isAllowedCdnScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"))
    assertFalse(store.isAllowedCdnScript("https://example.com/evil.js"))
  }

  @Test
  fun `annotations, reader state, and tool preferences persist permanently across restarts`() {
    val inkJson = """{"minna.pdf|100|1:1":[{"t":"p","w":0.008,"c":"#2563EB","p":[[0.1,0.2],[0.3,0.4]]},{"t":"h","w":0.032,"c":"#4ADE80","a":0.25,"p":[[0.2,0.5],[0.8,0.5]]}]}"""
    val stateJson = """{"mn1s":{"n":5,"f":1.5,"b":[2,5]},"mn1u":{"minna.pdf|100|1":{"p":3,"b":[1,3]}}}"""
    val prefsJson = """{"pen":{"sizePx":6,"color":"#2563EB"},"hl":{"sizePx":28,"color":"#4ADE80","transparency":75},"eraser":{"sizePx":40}}"""

    assertTrue(store.saveAnnotationsJson(inkJson))
    assertTrue(store.saveReaderStateJson(stateJson))
    assertTrue(store.saveToolPrefsJson(prefsJson))

    val reopened = MinnaFileStore(context)
    assertEquals(inkJson, reopened.loadAnnotationsJson())
    assertEquals(stateJson, reopened.loadReaderStateJson())
    assertEquals(prefsJson, reopened.loadToolPrefsJson())
  }
}
