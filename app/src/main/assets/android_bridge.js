(function () {
  if (window.__androidBridgeInstalled) return;
  window.__androidBridgeInstalled = true;
  window.AndroidApp = true;

  // Enforce single UI (UI 2) & responsive viewport before kanji.html reads localStorage
  try {
    var rawKcs = localStorage.getItem('kcs');
    var parsedKcs = rawKcs ? JSON.parse(rawKcs) : {};
    if (!parsedKcs || typeof parsedKcs !== 'object') parsedKcs = {};
    if (!parsedKcs.s || typeof parsedKcs.s !== 'object') parsedKcs.s = {};
    if (parsedKcs.s.layout !== 'ui2' || parsedKcs.s.view !== 'auto') {
      parsedKcs.s.layout = 'ui2';
      parsedKcs.s.view = 'auto';
      localStorage.setItem('kcs', JSON.stringify(parsedKcs));
    }
  } catch (_) {}

  // 1. Native Text-to-Speech fallback if WebView lacks window.speechSynthesis
  if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) {
    window.SpeechSynthesisUtterance = function (text) {
      this.text = text == null ? '' : String(text);
      this.lang = '';
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this.voice = null;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    };

    window.__ttsCallbacks = {};
    window.__ttsSeq = 0;

    window.__onTtsEvent = function (id, type) {
      var u = window.__ttsCallbacks[id];
      if (!u) return;
      if (type === 'start') {
        if (window.speechSynthesis) window.speechSynthesis.speaking = true;
        if (typeof u.onstart === 'function') {
          try { u.onstart({ utterance: u }); } catch (_) {}
        }
      } else {
        delete window.__ttsCallbacks[id];
        if (window.speechSynthesis && Object.keys(window.__ttsCallbacks).length === 0) {
          window.speechSynthesis.speaking = false;
        }
        if (type === 'end' && typeof u.onend === 'function') {
          try { u.onend({ utterance: u }); } catch (_) {}
        } else if (type === 'error' && typeof u.onerror === 'function') {
          try { u.onerror({ utterance: u }); } catch (_) {}
        }
      }
    };

    window.__onVoicesChanged = function () {
      if (window.speechSynthesis && typeof window.speechSynthesis.onvoiceschanged === 'function') {
        try { window.speechSynthesis.onvoiceschanged(); } catch (_) {}
      }
      try { window.dispatchEvent(new Event('voiceschanged')); } catch (_) {}
    };

    window.speechSynthesis = {
      speaking: false,
      pending: false,
      paused: false,
      onvoiceschanged: null,
      getVoices: function () {
        try {
          if (window.AndroidBridge && AndroidBridge.getVoicesJson) {
            return JSON.parse(AndroidBridge.getVoicesJson() || '[]');
          }
        } catch (_) {}
        return [];
      },
      speak: function (u) {
        if (!u || !window.AndroidBridge || !AndroidBridge.speak) return;
        var id = 'u_' + (++window.__ttsSeq);
        window.__ttsCallbacks[id] = u;
        var voiceName = u.voice && u.voice.name ? String(u.voice.name) : '';
        AndroidBridge.speak(
          id,
          String(u.text || ''),
          String(u.lang || ''),
          voiceName,
          Number(u.rate || 1)
        );
      },
      cancel: function () {
        var ids = Object.keys(window.__ttsCallbacks);
        if (window.AndroidBridge && AndroidBridge.cancelSpeech) {
          AndroidBridge.cancelSpeech();
        }
        window.speechSynthesis.speaking = false;
        ids.forEach(function (id) {
          var u = window.__ttsCallbacks[id];
          delete window.__ttsCallbacks[id];
          if (u && typeof u.onerror === 'function') {
            try { u.onerror({ utterance: u }); } catch (_) {}
          }
        });
      },
      pause: function () {},
      resume: function () {}
    };
  }

  // 2. Native SpeechRecognizer bridge for webkitSpeechRecognition
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    window.__srMap = {};
    window.__srSeq = 0;

    window.webkitSpeechRecognition = function () {
      this.lang = 'id-ID';
      this.interimResults = true;
      this.continuous = false;
      this.maxAlternatives = 1;
      this.onstart = null;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this._id = 'sr_' + (++window.__srSeq);
    };

    window.webkitSpeechRecognition.prototype.start = function () {
      window.__srMap[this._id] = this;
      if (window.AndroidBridge && AndroidBridge.startSpeech) {
        AndroidBridge.startSpeech(this._id, String(this.lang || 'id-ID'));
      } else {
        if (typeof this.onerror === 'function') this.onerror({ error: 'audio-capture' });
        if (typeof this.onend === 'function') this.onend();
      }
    };

    window.webkitSpeechRecognition.prototype.stop = function () {
      if (window.AndroidBridge && AndroidBridge.stopSpeech) {
        AndroidBridge.stopSpeech(this._id);
      }
    };

    window.webkitSpeechRecognition.prototype.abort = function () {
      if (window.AndroidBridge && AndroidBridge.stopSpeech) {
        AndroidBridge.stopSpeech(this._id);
      }
      delete window.__srMap[this._id];
    };

    window.__onSpeechStart = function (id) {
      var r = window.__srMap[id];
      if (r && typeof r.onstart === 'function') {
        try { r.onstart(); } catch (_) {}
      }
    };

    window.__onSpeechResult = function (id, text, isFinal) {
      var r = window.__srMap[id];
      if (r && typeof r.onresult === 'function') {
        var entry = Object.assign([{ transcript: String(text || '') }], { isFinal: !!isFinal });
        try { r.onresult({ results: [entry] }); } catch (_) {}
      }
    };

    window.__onSpeechError = function (id, code) {
      var r = window.__srMap[id];
      if (r && typeof r.onerror === 'function') {
        try { r.onerror({ error: String(code || 'aborted') }); } catch (_) {}
      }
    };

    window.__onSpeechEnd = function (id) {
      var r = window.__srMap[id];
      delete window.__srMap[id];
      if (r && typeof r.onend === 'function') {
        try { r.onend(); } catch (_) {}
      }
    };
  }

  // 3. Hook <a download href="blob:..."> so exports (.xlsx, .csv, .json) save via Android SAF
  var origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var anchor = this;
    var href = anchor.getAttribute('href') || anchor.href || '';
    var dl = anchor.getAttribute('download') || anchor.download || '';
    if (dl && href.indexOf('blob:') === 0 && window.AndroidBridge && AndroidBridge.saveDownloadedFile) {
      fetch(href)
        .then(function (resp) {
          var mime = resp.headers.get('content-type') || 'application/octet-stream';
          return resp.arrayBuffer().then(function (buf) {
            var bytes = new Uint8Array(buf);
            var chunks = [];
            var chunkSize = 0x4000;
            for (var i = 0; i < bytes.length; i += chunkSize) {
              chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
            }
            AndroidBridge.saveDownloadedFile(dl, mime, btoa(chunks.join('')));
          });
        })
        .catch(function () {
          origAnchorClick.call(anchor);
        });
      return;
    }
    return origAnchorClick.apply(this, arguments);
  };

  // 4. Fix Chromium WebView getCoalescedEvents() returning empty arrays on touch moves
  if (window.PointerEvent && PointerEvent.prototype.getCoalescedEvents) {
    var origCoalesced = PointerEvent.prototype.getCoalescedEvents;
    PointerEvent.prototype.getCoalescedEvents = function () {
      try {
        var list = origCoalesced.call(this);
        if (list && list.length > 0) return list;
      } catch (_) {}
      return [this];
    };
  }

  // 5. Mark Minna 1 picker clicks before opening SAF document chooser
  var origInputClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.id === 'mnuin' && window.AndroidBridge && AndroidBridge.markMinnaPicker) {
      AndroidBridge.markMinnaPicker();
    }
    return origInputClick.apply(this, arguments);
  };

  // 6. Sync active theme background & dark state with Android system bars
  function notifyTheme() {
    if (!window.AndroidBridge || !AndroidBridge.onThemeChanged) return;
    var root = document.documentElement;
    var isDark = root.classList.contains('dk');
    var bg = '';
    if (document.body) {
      bg = getComputedStyle(document.body).backgroundColor || '';
    }
    if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
      bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    }
    AndroidBridge.onThemeChanged(bg, isDark);
  }

  // 7. Minna 1 Permanent File Persistence, Save Button, Book-Flip Scroll, & Pen/Highlight/Eraser Customizer
  function installMinnaEnhancements() {
    if (typeof window.minna1Page !== 'function' || typeof window.mnUp !== 'function') return;

    function qs(sel) {
      return document.querySelector(sel);
    }

    function escHtml(t) {
      return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    // Tool preferences (persisted in native filesDir + localStorage)
    var DEFAULT_PREFS = {
      pen: { sizePx: 3, color: '#E5322D' },
      hl: { sizePx: 21, color: '#FFE600', transparency: 62 },
      eraser: { sizePx: 24 }
    };

    var PEN_PRESETS = ['#E5322D', '#18181B', '#2563EB', '#16A34A', '#7C3AED', '#EA580C', '#DB2777', '#FFFFFF'];
    var HL_PRESETS = ['#FFE600', '#4ADE80', '#38BDF8', '#F472B6', '#FB923C', '#C084FC'];

    function loadToolPrefs() {
      var parsed = null;
      try {
        if (window.AndroidBridge && AndroidBridge.loadMinnaToolPrefs) {
          var raw = AndroidBridge.loadMinnaToolPrefs();
          if (raw) parsed = JSON.parse(raw);
        }
      } catch (_) {}
      if (!parsed) {
        try {
          parsed = JSON.parse(localStorage.getItem('mn1toolprefs') || 'null');
        } catch (_) {}
      }
      var res = {
        pen: Object.assign({}, DEFAULT_PREFS.pen, parsed && parsed.pen ? parsed.pen : {}),
        hl: Object.assign({}, DEFAULT_PREFS.hl, parsed && parsed.hl ? parsed.hl : {}),
        eraser: Object.assign({}, DEFAULT_PREFS.eraser, parsed && parsed.eraser ? parsed.eraser : {})
      };
      res.pen.sizePx = Math.max(1, Math.min(24, Number(res.pen.sizePx) || 3));
      res.pen.color = normalizeHex(res.pen.color) || '#E5322D';
      res.hl.sizePx = Math.max(8, Math.min(60, Number(res.hl.sizePx) || 21));
      res.hl.color = normalizeHex(res.hl.color) || '#FFE600';
      res.hl.transparency = Math.max(10, Math.min(90, Number(res.hl.transparency) || 62));
      res.eraser.sizePx = Math.max(8, Math.min(80, Number(res.eraser.sizePx) || 24));
      return res;
    }

    function saveToolPrefs() {
      var json = JSON.stringify(toolPrefs);
      try { localStorage.setItem('mn1toolprefs', json); } catch (_) {}
      if (window.AndroidBridge && AndroidBridge.saveMinnaToolPrefs) {
        try { AndroidBridge.saveMinnaToolPrefs(json); } catch (_) {}
      }
    }

    function normalizeHex(raw) {
      if (!raw) return null;
      var s = String(raw).trim();
      if (s.charAt(0) !== '#') s = '#' + s;
      if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
      if (/^#[0-9a-fA-F]{3}$/.test(s)) {
        return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toUpperCase();
      }
      return null;
    }

    var toolPrefs = loadToolPrefs();
    var hasUnsavedInk = false;
    var activePopTool = null; // 'pen' | 'hl' | 'eraser' | null
    var lastImgObjectUrl = null;
    var suppressDefaultShow = false;
    var suppressSwipeUntil = 0;
    var restoringMinna = false;
    var flipBusy = false;

    // Restore saved annotations & reader state from native storage on boot
    function restorePersistentAnnotationsAndState() {
      try {
        if (window.AndroidBridge && AndroidBridge.loadMinnaAnnotations) {
          var annRaw = AndroidBridge.loadMinnaAnnotations();
          if (annRaw) {
            var nativeInk = JSON.parse(annRaw);
            if (nativeInk && typeof nativeInk === 'object') {
              var merged = Object.assign({}, nativeInk);
              if (window.MI && typeof window.MI === 'object') {
                Object.keys(window.MI).forEach(function (k) {
                  if ((!merged[k] || !merged[k].length) && window.MI[k] && window.MI[k].length) {
                    merged[k] = window.MI[k];
                  }
                });
              }
              window.MI = merged;
              try { localStorage.setItem('mn1ink', JSON.stringify(window.MI)); } catch (_) {}
            }
          }
        }
      } catch (_) {}

      try {
        if (window.AndroidBridge && AndroidBridge.loadMinnaReaderState) {
          var stRaw = AndroidBridge.loadMinnaReaderState();
          if (stRaw) {
            var stObj = JSON.parse(stRaw);
            if (stObj && typeof stObj === 'object') {
              if (stObj.mn1s && typeof stObj.mn1s === 'object') {
                window.MNS = {
                  n: (+stObj.mn1s.n | 0) || 1,
                  f: (stObj.mn1s.f >= 1 && stObj.mn1s.f <= 4) ? +stObj.mn1s.f : 1,
                  b: Array.isArray(stObj.mn1s.b) ? stObj.mn1s.b.filter(function (x) { return x > 0 && x <= 204; }) : []
                };
                try { localStorage.setItem('mn1s', JSON.stringify(window.MNS)); } catch (_) {}
              }
              if (stObj.mn1u && typeof stObj.mn1u === 'object') {
                var curU = {};
                try { curU = JSON.parse(localStorage.getItem('mn1u') || '{}') || {}; } catch (_) {}
                var mergedU = Object.assign({}, stObj.mn1u, curU);
                try { localStorage.setItem('mn1u', JSON.stringify(mergedU)); } catch (_) {}
              }
            }
          }
        }
      } catch (_) {}
    }

    restorePersistentAnnotationsAndState();

    // Inject styles for enhanced Minna 1 toolbar, Save button, customizer popover, and 3D book-flip viewer
    if (!document.getElementById('mn-android-style')) {
      var st = document.createElement('style');
      st.id = 'mn-android-style';
      st.textContent =
        '.mn-uf{display:flex!important;align-items:center;justify-content:space-between;gap:10px;' +
        'margin-bottom:8px;padding:7px 12px;border-radius:14px;background:var(--sf);' +
        'border:1px solid var(--ln);font-size:12px;font-weight:700;color:var(--tx)}' +
        '.mn-uf span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.mn-uf button{flex:none;min-height:32px;border:1px solid color-mix(in srgb,var(--ac) 40%,var(--ln));' +
        'background:color-mix(in srgb,var(--ac) 12%,var(--sf));color:var(--ac);border-radius:999px;' +
        'padding:4px 12px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}' +

        '.mn-tl{display:grid!important;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;margin-bottom:8px}' +
        '.mn-tl .kz-tb{width:100%!important;min-height:44px;height:44px;padding:0;border-radius:13px;' +
        'display:flex;align-items:center;justify-content:center;position:relative}' +
        '.mn-tl .kz-tb .i{width:20px;height:20px}' +
        '.mn-tl-dot{position:absolute;top:5px;right:6px;width:7px;height:7px;border-radius:50%;' +
        'border:1px solid rgba(0,0,0,.28)}' +
        '.mn-tl-er-dot{position:absolute;top:5px;right:6px;border-radius:50%;' +
        'border:1.5px solid currentColor;background:transparent}' +
        '.mn-active-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;' +
        'padding:5px 10px;border-radius:12px;background:var(--sf);border:1px solid var(--ln);font-size:11.5px;font-weight:700}' +
        '.mn-active-bar[hidden]{display:none}' +
        '.mn-ab-cfg{border:0;background:none;color:var(--tx);padding:4px 6px;min-height:32px;' +
        'display:inline-flex;align-items:center;gap:6px;font:inherit;font-weight:700;cursor:pointer;min-width:0}' +
        '.mn-ab-sw{width:10px;height:10px;border-radius:50%;border:1px solid rgba(0,0,0,.25);flex:none}' +
        '.mn-ab-done{flex:none;border:1px solid var(--ln);background:var(--s2);color:var(--tx);border-radius:999px;' +
        'padding:4px 12px;min-height:32px;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer}' +

        '.mn-sv{background:var(--sf);border:1px solid var(--ln);color:var(--tx);position:relative}' +
        '.mn-sv.dirty{background:var(--pr);color:var(--on);border-color:var(--pr);' +
        'box-shadow:0 6px 14px -6px color-mix(in srgb,var(--pr) 70%,transparent)}' +
        '.mn-sv.saved{border-color:var(--ok);color:var(--ok);background:color-mix(in srgb,var(--ok) 11%,var(--sf))}' +
        '.mn-sv-dot{position:absolute;top:5px;right:6px;width:7px;height:7px;border-radius:50%;background:var(--wa)}' +

        '.mn-pop-anchor{position:relative}' +
        '.mn-tool-pop{position:absolute;left:0;right:0;top:2px;z-index:30;max-width:460px;margin-inline:auto;' +
        'background:var(--sf);border:1px solid var(--ln);border-radius:18px;padding:12px 14px;' +
        'box-shadow:0 18px 40px -10px rgba(0,0,0,.38);display:grid;gap:10px}' +
        '.mn-tool-pop[hidden]{display:none}' +
        '.mn-pop-hd{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
        '.mn-pop-hd b{font-size:13.5px;font-weight:800}' +
        '.mn-pop-close{border:1px solid var(--ln);background:var(--s2);color:var(--tx);border-radius:999px;' +
        'padding:4px 12px;min-height:30px;font-size:11.5px;font-weight:700;cursor:pointer}' +
        '.mn-pop-row{display:grid;gap:6px}' +
        '.mn-pop-lbl{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:700;color:var(--mu)}' +
        '.mn-pop-lbl em{font-style:normal;color:var(--tx);font-weight:800}' +
        '.mn-rng{width:100%;accent-color:var(--pr);height:24px;margin:0}' +
        '.mn-chips-mini{display:flex;gap:6px;flex-wrap:wrap}' +
        '.mn-chips-mini button{border:1px solid var(--ln);background:var(--s2);color:var(--tx);border-radius:999px;' +
        'padding:4px 10px;min-height:28px;font-size:11.5px;font-weight:700;cursor:pointer}' +
        '.mn-chips-mini button.on{background:var(--pr);color:var(--on);border-color:var(--pr)}' +
        '.mn-swatches{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
        '.mn-sw{width:30px;height:30px;border-radius:50%;border:2px solid var(--ln);padding:0;cursor:pointer;position:relative}' +
        '.mn-sw.on{border-color:var(--tx);transform:scale(1.1);box-shadow:0 0 0 2px var(--pr)}' +
        '.mn-hex-row{display:flex;align-items:center;gap:8px}' +
        '.mn-col-btn{position:relative;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ln);' +
        'background:var(--s2);color:var(--tx);border-radius:10px;padding:6px 10px;min-height:36px;' +
        'font-size:12px;font-weight:700;cursor:pointer;overflow:hidden}' +
        '.mn-col-btn input[type=color]{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}' +
        '.mn-col-swatch{width:16px;height:16px;border-radius:5px;border:1px solid rgba(0,0,0,.25);flex:none}' +
        '.mn-hex-in{flex:1;min-width:0;height:36px;border-radius:10px;border:1px solid var(--ln);' +
        'background:var(--s2);color:var(--tx);padding:0 10px;font:700 16px/1 monospace;text-transform:uppercase}' +
        '.mn-prev-box{position:relative;height:44px;border-radius:12px;border:1px solid var(--ln);' +
        'background:#fff;color:#141414;display:grid;place-items:center;overflow:hidden;padding:0 12px}' +
        '.mn-prev-text{font-size:14px;font-weight:700;position:relative;z-index:1;white-space:nowrap}' +
        '.mn-prev-stroke{position:absolute;left:16px;right:16px;top:50%;transform:translateY(-50%);' +
        'border-radius:999px;pointer-events:none;z-index:2}' +
        '.mn-er-prev{border-radius:50%;border:2px dashed #555;background:rgba(229,50,45,.12)}' +
        '.mn-hint-sm{font-size:11px;color:var(--mu);line-height:1.3}' +

        '.mn-ln{display:none!important}' +
        '.mn-hd-act{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}' +
        '.mn-hd-act .kz-tb{width:42px;height:42px;padding:0;justify-content:center;border-radius:13px}' +
        '.mn-hd-act .kz-tb:disabled{opacity:.35;cursor:default}' +
        '.mn-tb-bot{margin:10px 0 0!important}' +
        '.mn-pg input{font-size:16px!important}' +
        'html.mn1-locked,html.mn1-locked body,html.mn1-locked .app,html.mn1-locked #scr{' +
        'height:100%!important;max-height:none!important;overflow:hidden!important;overscroll-behavior:none!important;touch-action:manipulation}' +
        'html.mn1-locked.u2 #scr{margin-left:0!important}' +
        'html.mn1-locked #scr>.kz-hd{flex:none!important;position:relative;z-index:25;touch-action:manipulation}' +
        'html.mn1-locked #scr>.page.kz-pg{flex:1!important;min-height:0!important;display:flex!important;' +
        'flex-direction:column!important;overflow:hidden!important;padding-top:6px!important;padding-bottom:14px!important}' +
        'html.mn1-locked .mn-tl,html.mn1-locked .mn-active-bar,' +
        'html.mn1-locked .mn-pop-anchor,html.mn1-locked .mn-bk,html.mn1-locked .mn-uf,html.mn1-locked .mn-tb-bot{' +
        'flex:none!important;position:relative;z-index:20;touch-action:manipulation}' +
        'html.mn1-locked #mnv{flex:1!important;min-height:0!important;height:auto!important;' +
        'overflow:auto!important;overscroll-behavior:contain!important;position:relative;z-index:1;' +
        'contain:layout paint;touch-action:pan-x pan-y}' +
        'html.mn1-locked.mn-drawing #mnv{touch-action:none!important}' +
        'html.kt-locked,html.kt-locked body,html.kt-locked .app,html.kt-locked #scr{' +
        'height:100%!important;max-height:none!important;overflow:hidden!important;overscroll-behavior:none!important;touch-action:manipulation}' +
        'html.kt-locked.u2 #scr{margin-left:0!important}' +
        'html.kt-locked #scr>.kz-hd{flex:none!important;position:relative;z-index:25;touch-action:manipulation}' +
        'html.kt-locked #scr>.page.kz-pg.tw{flex:1!important;min-height:0!important;display:flex!important;' +
        'flex-direction:column!important;overflow:hidden!important;padding-top:6px!important;padding-bottom:12px!important}' +
        'html.kt-locked .tw-sg,html.kt-locked #twa>.tw-ch,' +
        'html.kt-locked #twa>.tw-tb,html.kt-locked #twa>.tw-st,html.kt-locked #twa>.nt-top,html.kt-locked #twa>.nt-bk{' +
        'flex:none!important;position:relative;z-index:20;touch-action:manipulation}' +
        'html.kt-locked #twa>.kt-h{display:none!important}' +
        'html.kt-locked #twa{flex:1!important;min-height:0!important;display:flex!important;flex-direction:column!important;overflow:hidden!important}' +
        'html.kt-locked .kt-vp{flex:1!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;' +
        'overscroll-behavior:contain!important;position:relative;z-index:1;contain:layout paint;margin-top:10px;border-radius:26px;' +
        '-webkit-overflow-scrolling:touch;touch-action:pan-y}' +
        'html.kt-locked .kt-vp>#twg{margin-top:0!important}' +
        'html.kt-locked #twa>.tw-sh:not(#twg){flex:1!important;min-height:0!important;overflow-y:auto!important;' +
        'overscroll-behavior:contain!important;margin-top:10px;touch-action:pan-y}' +
        'html.kt-locked #twa>.nt-ls{flex:1!important;min-height:0!important;overflow-y:auto!important;' +
        'overscroll-behavior:contain!important;align-content:start;padding-bottom:8px;touch-action:pan-y}' +
        '@media(max-height:520px){' +
          'html.kt-locked .tw-tb,html.kt-locked .tw-st{margin-top:6px}' +
        '}' +
        'html.kt-locked .tw-tb{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin-top:10px}' +
        '@media(max-width:360px){html.kt-locked .tw-tb{gap:4px}}' +
        'html.kt-locked .tw-tb .kz-tb,html.kt-locked .tw-tb .tw-sv{' +
          'width:100%!important;min-width:0;min-height:44px;height:44px!important;padding:0!important;' +
          'border-radius:13px!important;display:flex!important;align-items:center;justify-content:center;' +
          'flex:none!important;position:relative;box-sizing:border-box}' +
        'html.kt-locked .tw-tb .kz-tb .i,html.kt-locked .tw-tb .tw-sv .i{width:20px;height:20px}' +
        'html.kt-locked .tw-tb .tw-sv{background:transparent!important;border:1px solid var(--ln)!important;color:var(--tx)!important;box-shadow:none!important}' +
        'html.kt-locked .tw-tb .tw-sv:active{transform:scale(.96)}' +
        '.kz-two{display:block!important}' +
        '.kz-two>.kz-st{display:none!important}' +
        '.kz-two .kz-gp{margin:0 0 12px!important}' +
        '#mnc{perspective:1400px;transform-style:preserve-3d;overflow:visible;position:relative}' +
        '#mnv.mn-flipping #mnc{overflow:hidden}' +
        '#mnst{transform-style:preserve-3d;will-change:transform;backface-visibility:hidden}' +
        '.mn-flip-shade{position:absolute;inset:0;pointer-events:none;z-index:5;opacity:0;' +
        'transition:opacity .15s}' +

        '@media(max-width:360px){' +
          '.mn-tl{gap:4px}' +
          '.u2 .page,.page{padding-inline:12px}' +
          '.u2-chips{gap:6px}.u2-chips>div{padding:8px 9px}.u2-chips b{font-size:19px}' +
          '.u2-big b{font-size:36px}' +
        '}' +
        '@media(min-width:600px) and (max-width:699px){' +
          '#scr>header,#scr>.page{padding-inline:24px}' +
          '.u2-bar{left:50%;right:auto;width:min(560px,calc(100% - 28px));transform:translateX(-50%)}' +
          '.ov{align-items:center;justify-content:center}' +
          '.u2 .sheet,.sheet{width:min(520px,calc(100% - 40px));border-radius:28px;border:1px solid var(--ln);max-height:88%;padding-bottom:22px}' +
          '.sheet:before{display:none}' +
          '.u2-lst:not(.gr){grid-template-columns:repeat(2,minmax(0,1fr));column-gap:20px}' +
          '.u2-lst.gr{grid-template-columns:repeat(3,minmax(0,1fr))}' +
          '.u2-dict{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:20px}' +
        '}' +
        '@media(min-width:700px){' +
          '#scr>header:has(+ .page>.gh2){padding-inline:max(24px,calc((100% - 700px)/2))}' +
        '}' +
        '@media(min-width:1100px){' +
          '#scr>header:has(+ .page>.gh2){padding-inline:max(32px,calc((100% - 760px)/2))}' +
        '}' +

        '.mn-doc{position:relative;word-break:break-word}' +
        '.mn-doc pre{margin:0;white-space:pre-wrap;word-break:break-word;font:13px/1.6 Figtree,system-ui,sans-serif}' +
        '.mn-doc-note{display:inline-block;margin-bottom:10px;padding:4px 10px;border-radius:999px;' +
        'background:#eef1f7;color:#444;font-size:11px;font-weight:700}' +
        '.mn-bin-card{display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'text-align:center;padding:36px 20px;gap:12px;min-height:260px}' +
        '.mn-bin-ext{padding:8px 16px;border-radius:12px;background:#eef1f7;color:#222;' +
        'font-weight:800;font-size:15px;letter-spacing:.06em;text-transform:uppercase}' +
        '.mn-bin-btn{border:0;border-radius:12px;padding:10px 18px;background:var(--pr);color:var(--on);' +
        'font:inherit;font-weight:700;font-size:13px;cursor:pointer}';
      document.head.appendChild(st);
    }

    function revokeImgUrl() {
      if (lastImgObjectUrl) {
        try { URL.revokeObjectURL(lastImgObjectUrl); } catch (_) {}
        lastImgObjectUrl = null;
      }
    }

    function clearLegacyIndexedDb() {
      try {
        var req = indexedDB.open('mn1file', 1);
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains('f')) req.result.createObjectStore('f');
        };
        req.onsuccess = function () {
          try {
            var tx = req.result.transaction('f', 'readwrite');
            tx.objectStore('f').delete('last');
          } catch (_) {}
        };
      } catch (_) {}
    }

    function activeInkKey() {
      if (window.MNH && window.MNH.id) return window.MNH.id + ':1';
      return mnK();
    }

    function persistAllAnnotations(showToast) {
      var inkJson = '{}';
      try {
        inkJson = JSON.stringify(window.MI || {});
        localStorage.setItem('mn1ink', inkJson);
      } catch (_) {}

      var stateObj = {
        mn1s: window.MNS || { n: 1, f: 1, b: [] },
        mn1u: {}
      };
      try {
        stateObj.mn1u = JSON.parse(localStorage.getItem('mn1u') || '{}') || {};
      } catch (_) {}

      var ok = true;
      if (window.AndroidBridge && AndroidBridge.saveMinnaAnnotations) {
        ok = AndroidBridge.saveMinnaAnnotations(inkJson) && ok;
      }
      if (window.AndroidBridge && AndroidBridge.saveMinnaReaderState) {
        ok = AndroidBridge.saveMinnaReaderState(JSON.stringify(stateObj)) && ok;
      }

      hasUnsavedInk = false;
      updateSaveButtonState(true);
      if (showToast && typeof window.toast === 'function') {
        window.toast(ok ? 'Tulisan & highlight berhasil disimpan' : 'Gagal menyimpan anotasi');
      }
    }

    function markInkDirty() {
      hasUnsavedInk = true;
      try { localStorage.setItem('mn1ink', JSON.stringify(window.MI || {})); } catch (_) {}
      updateSaveButtonState(false);
    }

    function updateSaveButtonState(justSaved) {
      var btn = qs('#mnsv');
      if (!btn) return;
      btn.classList.toggle('dirty', !!hasUnsavedInk);
      btn.classList.toggle('saved', !hasUnsavedInk && !!justSaved);
      var label = justSaved && !hasUnsavedInk ? 'Tersimpan' : 'Simpan';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      var dot = btn.querySelector('.mn-sv-dot');
      if (dot) dot.hidden = !hasUnsavedInk;
    }

    function getActiveStrokeConfig() {
      if (window.MT === 'pen') {
        return {
          t: 'p',
          w: toolPrefs.pen.sizePx / 650,
          c: toolPrefs.pen.color
        };
      }
      if (window.MT === 'hl') {
        return {
          t: 'h',
          w: toolPrefs.hl.sizePx / 650,
          c: toolPrefs.hl.color,
          a: Math.max(0.1, Math.min(0.9, (100 - toolPrefs.hl.transparency) / 100))
        };
      }
      return {
        t: 'e',
        w: toolPrefs.eraser.sizePx / 650
      };
    }

    // Override mnPaint globally to honor per-stroke color & transparency %
    window.mnPaint = function (cv, k) {
      var x = cv.getContext('2d');
      var W = cv.width;
      var H = cv.height;
      x.clearRect(0, 0, W, H);
      x.lineCap = 'round';
      x.lineJoin = 'round';
      var list = (window.MI && window.MI[k]) || [];
      for (var idx = 0; idx < list.length; idx++) {
        var s = list[idx];
        if (!s || !s.p || !s.p.length) continue;
        x.globalCompositeOperation = s.t === 'e' ? 'destination-out' : 'source-over';
        if (s.t === 'h') {
          x.globalAlpha = typeof s.a === 'number' ? Math.max(0.05, Math.min(0.95, s.a)) : 0.38;
          x.strokeStyle = s.c || '#FFE600';
        } else if (s.t === 'e') {
          x.globalAlpha = 1;
          x.strokeStyle = '#000000';
        } else {
          x.globalAlpha = 1;
          x.strokeStyle = s.c || '#E5322D';
        }
        x.lineWidth = Math.max(1, s.w * W);
        x.beginPath();
        for (var i = 0; i < s.p.length; i++) {
          var q = s.p[i];
          if (i === 0) x.moveTo(q[0] * W, q[1] * H);
          else x.lineTo(q[0] * W, q[1] * H);
        }
        if (s.p.length === 1) {
          x.lineTo(s.p[0][0] * W + 0.01, s.p[0][1] * H);
        }
        x.stroke();
      }
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'source-over';
    };

    function bindCanvasDrawingHandlers(ik, inkKey) {
      var cur = null;
      var pt = function (e) {
        var r = ik.getBoundingClientRect();
        return [
          +((e.clientX - r.left) / Math.max(1, r.width)).toFixed(4),
          +((e.clientY - r.top) / Math.max(1, r.height)).toFixed(4)
        ];
      };
      ik.onpointerdown = function (e) {
        if (window.MT === 'hand' || !e.isPrimary) return;
        closeToolPopover();
        e.preventDefault();
        try { ik.setPointerCapture(e.pointerId); } catch (_) {}
        var cfg = getActiveStrokeConfig();
        cur = Object.assign({}, cfg, { p: [pt(e)] });
        window.MI[inkKey] = window.MI[inkKey] || [];
        window.MI[inkKey].push(cur);
        window.MR[inkKey] = [];
        window.mnPaint(ik, inkKey);
      };
      ik.onpointermove = function (e) {
        if (!cur) return;
        var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (var i = 0; i < evs.length; i++) cur.p.push(pt(evs[i]));
        window.mnPaint(ik, inkKey);
      };
      var end = function () {
        if (cur) {
          cur = null;
          markInkDirty();
          window.mnTb();
        }
      };
      ik.onpointerup = end;
      ik.onpointercancel = end;
      ik.cancelStroke = function () {
        if (cur) {
          (window.MI[inkKey] || []).pop();
          cur = null;
          window.mnPaint(ik, inkKey);
        }
      };
    }

    function updateToolBadges() {
      var penDot = qs('#mt-pen .mn-tl-dot');
      if (penDot) penDot.style.background = toolPrefs.pen.color;
      var hlDot = qs('#mt-hl .mn-tl-dot');
      if (hlDot) {
        hlDot.style.background = toolPrefs.hl.color;
        hlDot.style.opacity = String(Math.max(0.25, (100 - toolPrefs.hl.transparency) / 100));
      }
      var erDot = qs('#mt-eraser .mn-tl-er-dot');
      if (erDot) {
        var d = Math.round(5 + (toolPrefs.eraser.sizePx - 8) * 7 / 72);
        erDot.style.width = d + 'px';
        erDot.style.height = d + 'px';
      }
    }

    function updateActiveToolBar() {
      var bar = qs('#mn-active-bar');
      if (!bar) return;
      if (window.MT === 'hand') {
        bar.hidden = true;
        return;
      }
      bar.hidden = false;
      var sw = bar.querySelector('.mn-ab-sw');
      var lbl = bar.querySelector('.mn-ab-txt');
      if (window.MT === 'pen') {
        if (sw) { sw.hidden = false; sw.style.background = toolPrefs.pen.color; sw.style.opacity = '1'; }
        if (lbl) lbl.textContent = 'Atur Pen · ' + toolPrefs.pen.sizePx + 'px · ' + toolPrefs.pen.color;
      } else if (window.MT === 'hl') {
        if (sw) {
          sw.hidden = false;
          sw.style.background = toolPrefs.hl.color;
          sw.style.opacity = String(Math.max(0.25, (100 - toolPrefs.hl.transparency) / 100));
        }
        if (lbl) lbl.textContent = 'Atur Highlight · ' + toolPrefs.hl.sizePx + 'px · ' + toolPrefs.hl.transparency + '%';
      } else {
        if (sw) sw.hidden = true;
        if (lbl) lbl.textContent = 'Ukuran Penghapus · ' + toolPrefs.eraser.sizePx + 'px';
      }
    }

    function closeToolPopover() {
      activePopTool = null;
      var pop = qs('#mn-tool-pop');
      if (pop) pop.hidden = true;
    }

    function renderToolPopover(tool) {
      var pop = qs('#mn-tool-pop');
      if (!pop) return;
      if (!tool || tool === 'hand') {
        closeToolPopover();
        return;
      }
      activePopTool = tool;
      pop.hidden = false;

      if (tool === 'pen') {
        var p = toolPrefs.pen;
        pop.innerHTML =
          '<div class="mn-pop-hd"><b>Pengaturan Pen</b><button type="button" class="mn-pop-close" id="mnPopClose">Selesai</button></div>' +
          '<div class="mn-prev-box" id="mnPrevBox"><div class="mn-prev-stroke" id="mnPrevLine"></div></div>' +
          '<div class="mn-pop-row">' +
            '<div class="mn-pop-lbl"><span>Ketebalan (Thickness)</span><em id="mnPenSzVal">' + p.sizePx + ' px</em></div>' +
            '<input type="range" class="mn-rng" id="mnPenSz" min="1" max="24" step="1" value="' + p.sizePx + '">' +
            '<div class="mn-chips-mini" id="mnPenSzPresets">' +
              [2, 4, 8, 14].map(function (v) {
                return '<button type="button" data-v="' + v + '" class="' + (p.sizePx === v ? 'on' : '') + '">' + v + 'px</button>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="mn-pop-row">' +
            '<div class="mn-pop-lbl"><span>Warna Pen</span><em id="mnColLabel">' + escHtml(p.color) + '</em></div>' +
            '<div class="mn-swatches" id="mnPenSw">' +
              PEN_PRESETS.map(function (c) {
                return '<button type="button" class="mn-sw' + (p.color === c ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="Warna ' + c + '"></button>';
              }).join('') +
            '</div>' +
            '<div class="mn-hex-row">' +
              '<label class="mn-col-btn"><span class="mn-col-swatch" id="mnCustomSwatch" style="background:' + p.color + '"></span><span>Custom</span><input type="color" id="mnColPick" value="' + p.color + '" aria-label="Pilih warna custom"></label>' +
              '<input type="text" class="mn-hex-in" id="mnColHex" maxlength="7" value="' + p.color + '" placeholder="#E5322D" aria-label="Kode warna Hex">' +
            '</div>' +
          '</div>';

        var updatePenUi = function () {
          var line = qs('#mnPrevLine');
          if (line) {
            line.style.background = p.color;
            line.style.height = Math.max(2, Math.min(26, p.sizePx)) + 'px';
          }
          var box = qs('#mnPrevBox');
          if (box) box.style.background = p.color === '#FFFFFF' ? '#202028' : '#FFFFFF';
          var szVal = qs('#mnPenSzVal');
          if (szVal) szVal.textContent = p.sizePx + ' px';
          var lbl = qs('#mnColLabel');
          if (lbl) lbl.textContent = p.color;
          var sw = qs('#mnCustomSwatch');
          if (sw) sw.style.background = p.color;
          var pk = qs('#mnColPick');
          if (pk && pk.value.toUpperCase() !== p.color) pk.value = p.color;
          var hx = qs('#mnColHex');
          if (hx && document.activeElement !== hx) hx.value = p.color;
          pop.querySelectorAll('#mnPenSzPresets button').forEach(function (b) {
            b.classList.toggle('on', +b.dataset.v === p.sizePx);
          });
          pop.querySelectorAll('#mnPenSw .mn-sw').forEach(function (b) {
            b.classList.toggle('on', b.dataset.c === p.color);
          });
          updateToolBadges();
          updateActiveToolBar();
          saveToolPrefs();
        };

        qs('#mnPenSz').oninput = function (e) { p.sizePx = +e.target.value; updatePenUi(); };
        pop.querySelectorAll('#mnPenSzPresets button').forEach(function (b) {
          b.onclick = function () { p.sizePx = +b.dataset.v; qs('#mnPenSz').value = p.sizePx; updatePenUi(); };
        });
        pop.querySelectorAll('#mnPenSw .mn-sw').forEach(function (b) {
          b.onclick = function () { p.color = b.dataset.c; updatePenUi(); };
        });
        qs('#mnColPick').oninput = function (e) {
          var hx = normalizeHex(e.target.value);
          if (hx) { p.color = hx; updatePenUi(); }
        };
        qs('#mnColHex').oninput = function (e) {
          var hx = normalizeHex(e.target.value);
          if (hx) { p.color = hx; updatePenUi(); }
        };
        qs('#mnColHex').onblur = function (e) { e.target.value = p.color; };
        qs('#mnPopClose').onclick = closeToolPopover;
        updatePenUi();
        return;
      }

      if (tool === 'hl') {
        var h = toolPrefs.hl;
        pop.innerHTML =
          '<div class="mn-pop-hd"><b>Pengaturan Highlight</b><button type="button" class="mn-pop-close" id="mnPopClose">Selesai</button></div>' +
          '<div class="mn-prev-box"><span class="mn-prev-text">日本語・漢字 — Contoh teks di bawah highlight</span><div class="mn-prev-stroke" id="mnHlPrev"></div></div>' +
          '<div class="mn-pop-row">' +
            '<div class="mn-pop-lbl"><span>Ketebalan (Thickness)</span><em id="mnHlSzVal">' + h.sizePx + ' px</em></div>' +
            '<input type="range" class="mn-rng" id="mnHlSz" min="8" max="60" step="1" value="' + h.sizePx + '">' +
            '<div class="mn-chips-mini" id="mnHlSzPresets">' +
              [12, 21, 32, 46].map(function (v) {
                return '<button type="button" data-v="' + v + '" class="' + (h.sizePx === v ? 'on' : '') + '">' + v + 'px</button>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="mn-pop-row">' +
            '<div class="mn-pop-lbl"><span>% Transparan</span><em id="mnHlTrVal">' + h.transparency + '%</em></div>' +
            '<input type="range" class="mn-rng" id="mnHlTr" min="10" max="90" step="1" value="' + h.transparency + '">' +
            '<div class="mn-chips-mini" id="mnHlTrPresets">' +
              [30, 50, 62, 80].map(function (v) {
                return '<button type="button" data-v="' + v + '" class="' + (h.transparency === v ? 'on' : '') + '">' + v + '%</button>';
              }).join('') +
            '</div>' +
            '<span class="mn-hint-sm">Makin tinggi %, tulisan di bawah highlight makin jelas terlihat.</span>' +
          '</div>' +
          '<div class="mn-pop-row">' +
            '<div class="mn-pop-lbl"><span>Warna Highlight</span><em id="mnColLabel">' + escHtml(h.color) + '</em></div>' +
            '<div class="mn-swatches" id="mnHlSw">' +
              HL_PRESETS.map(function (c) {
                return '<button type="button" class="mn-sw' + (h.color === c ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="Warna ' + c + '"></button>';
              }).join('') +
            '</div>' +
            '<div class="mn-hex-row">' +
              '<label class="mn-col-btn"><span class="mn-col-swatch" id="mnCustomSwatch" style="background:' + h.color + '"></span><span>Custom</span><input type="color" id="mnColPick" value="' + h.color + '" aria-label="Pilih warna custom"></label>' +
              '<input type="text" class="mn-hex-in" id="mnColHex" maxlength="7" value="' + h.color + '" placeholder="#FFE600" aria-label="Kode warna Hex">' +
            '</div>' +
          '</div>';

        var updateHlUi = function () {
          var prev = qs('#mnHlPrev');
          var alpha = Math.max(0.1, Math.min(0.9, (100 - h.transparency) / 100));
          if (prev) {
            prev.style.background = h.color;
            prev.style.opacity = String(alpha);
            prev.style.height = Math.max(6, Math.min(38, Math.round(h.sizePx * 0.72))) + 'px';
          }
          var szVal = qs('#mnHlSzVal');
          if (szVal) szVal.textContent = h.sizePx + ' px';
          var trVal = qs('#mnHlTrVal');
          if (trVal) trVal.textContent = h.transparency + '%';
          var lbl = qs('#mnColLabel');
          if (lbl) lbl.textContent = h.color;
          var sw = qs('#mnCustomSwatch');
          if (sw) sw.style.background = h.color;
          var pk = qs('#mnColPick');
          if (pk && pk.value.toUpperCase() !== h.color) pk.value = h.color;
          var hx = qs('#mnColHex');
          if (hx && document.activeElement !== hx) hx.value = h.color;
          pop.querySelectorAll('#mnHlSzPresets button').forEach(function (b) {
            b.classList.toggle('on', +b.dataset.v === h.sizePx);
          });
          pop.querySelectorAll('#mnHlTrPresets button').forEach(function (b) {
            b.classList.toggle('on', +b.dataset.v === h.transparency);
          });
          pop.querySelectorAll('#mnHlSw .mn-sw').forEach(function (b) {
            b.classList.toggle('on', b.dataset.c === h.color);
          });
          updateToolBadges();
          updateActiveToolBar();
          saveToolPrefs();
        };

        qs('#mnHlSz').oninput = function (e) { h.sizePx = +e.target.value; updateHlUi(); };
        qs('#mnHlTr').oninput = function (e) { h.transparency = +e.target.value; updateHlUi(); };
        pop.querySelectorAll('#mnHlSzPresets button').forEach(function (b) {
          b.onclick = function () { h.sizePx = +b.dataset.v; qs('#mnHlSz').value = h.sizePx; updateHlUi(); };
        });
        pop.querySelectorAll('#mnHlTrPresets button').forEach(function (b) {
          b.onclick = function () { h.transparency = +b.dataset.v; qs('#mnHlTr').value = h.transparency; updateHlUi(); };
        });
        pop.querySelectorAll('#mnHlSw .mn-sw').forEach(function (b) {
          b.onclick = function () { h.color = b.dataset.c; updateHlUi(); };
        });
        qs('#mnColPick').oninput = function (e) {
          var hx = normalizeHex(e.target.value);
          if (hx) { h.color = hx; updateHlUi(); }
        };
        qs('#mnColHex').oninput = function (e) {
          var hx = normalizeHex(e.target.value);
          if (hx) { h.color = hx; updateHlUi(); }
        };
        qs('#mnColHex').onblur = function (e) { e.target.value = h.color; };
        qs('#mnPopClose').onclick = closeToolPopover;
        updateHlUi();
        return;
      }

      if (tool === 'eraser') {
        var er = toolPrefs.eraser;
        pop.innerHTML =
          '<div class="mn-pop-hd"><b>Ukuran Penghapus</b><button type="button" class="mn-pop-close" id="mnPopClose">Selesai</button></div>' +
          '<div class="mn-prev-box"><div class="mn-er-prev" id="mnErPrev"></div></div>' +
          '<div class="mn-pop-row">' +
            '<div class="mn-pop-lbl"><span>Ukuran</span><em id="mnErSzVal">' + er.sizePx + ' px</em></div>' +
            '<input type="range" class="mn-rng" id="mnErSz" min="8" max="80" step="1" value="' + er.sizePx + '">' +
            '<div class="mn-chips-mini" id="mnErSzPresets">' +
              [['Kecil', 12], ['Sedang', 24], ['Besar', 40], ['Ekstra', 64]].map(function (item) {
                return '<button type="button" data-v="' + item[1] + '" class="' + (er.sizePx === item[1] ? 'on' : '') + '">' + item[0] + ' (' + item[1] + 'px)</button>';
              }).join('') +
            '</div>' +
          '</div>';

        var updateErUi = function () {
          var prev = qs('#mnErPrev');
          if (prev) {
            var d = Math.max(8, Math.min(38, Math.round(er.sizePx * 0.55)));
            prev.style.width = d + 'px';
            prev.style.height = d + 'px';
          }
          var szVal = qs('#mnErSzVal');
          if (szVal) szVal.textContent = er.sizePx + ' px';
          pop.querySelectorAll('#mnErSzPresets button').forEach(function (b) {
            b.classList.toggle('on', +b.dataset.v === er.sizePx);
          });
          updateToolBadges();
          updateActiveToolBar();
          saveToolPrefs();
        };

        qs('#mnErSz').oninput = function (e) { er.sizePx = +e.target.value; updateErUi(); };
        pop.querySelectorAll('#mnErSzPresets button').forEach(function (b) {
          b.onclick = function () { er.sizePx = +b.dataset.v; qs('#mnErSz').value = er.sizePx; updateErUi(); };
        });
        qs('#mnPopClose').onclick = closeToolPopover;
        updateErUi();
      }
    }

    // Book-opening / page-turn 3D animation helper
    function ensureFlipShade() {
      var st = qs('#mnst');
      if (!st) return null;
      var sh = st.querySelector('.mn-flip-shade');
      if (!sh) {
        sh = document.createElement('div');
        sh.className = 'mn-flip-shade';
        st.appendChild(sh);
      }
      return sh;
    }

    function applyFlipTransform(dir, progress) {
      var vEl = qs('#mnv');
      if (vEl) vEl.classList.add('mn-flipping');
      var st = qs('#mnst');
      if (!st) return;
      var sh = ensureFlipShade();
      var p = Math.max(0, Math.min(1, progress));
      st.style.transition = 'none';
      if (dir === 1) {
        st.style.transformOrigin = 'left center';
        st.style.transform = 'translateX(' + (-p * 16).toFixed(1) + 'px) rotateY(' + (-p * 78).toFixed(1) + 'deg)';
        if (sh) {
          sh.style.background = 'linear-gradient(to left, rgba(0,0,0,.28), rgba(0,0,0,.05) 38%, rgba(255,255,255,.14) 72%, transparent)';
          sh.style.opacity = String(Math.min(0.9, p * 1.15));
        }
      } else {
        st.style.transformOrigin = 'right center';
        st.style.transform = 'translateX(' + (p * 16).toFixed(1) + 'px) rotateY(' + (p * 78).toFixed(1) + 'deg)';
        if (sh) {
          sh.style.background = 'linear-gradient(to right, rgba(0,0,0,.28), rgba(0,0,0,.05) 38%, rgba(255,255,255,.14) 72%, transparent)';
          sh.style.opacity = String(Math.min(0.9, p * 1.15));
        }
      }
    }

    function resetFlipTransform(animate) {
      var st = qs('#mnst');
      if (!st) {
        var vEl = qs('#mnv');
        if (vEl) vEl.classList.remove('mn-flipping');
        return;
      }
      var sh = st.querySelector('.mn-flip-shade');
      if (animate) {
        st.style.transition = 'transform 220ms cubic-bezier(.22,.61,.36,1), opacity 220ms ease';
      } else {
        st.style.transition = 'none';
      }
      st.style.transform = 'translateX(0px) rotateY(0deg)';
      st.style.opacity = '1';
      if (sh) {
        sh.style.opacity = '0';
      }
      setTimeout(function () {
        var curV = qs('#mnv');
        if (curV && !flipBusy) curV.classList.remove('mn-flipping');
      }, animate ? 230 : 0);
    }

    function performBookTurn(targetPage, dir) {
      var total = mnN();
      var clamped = Math.min(total, Math.max(1, targetPage));
      if (clamped === mnP() || flipBusy) {
        resetFlipTransform(true);
        return;
      }
      flipBusy = true;
      var vEl = qs('#mnv');
      if (vEl) vEl.classList.add('mn-flipping');
      var st = qs('#mnst');
      var sh = ensureFlipShade();

      function showIncoming() {
        var p = window.mnShow(clamped, false, true);
        Promise.resolve(p).then(function () {
          var nextSt = qs('#mnst');
          if (nextSt) {
            nextSt.style.transition = 'none';
            nextSt.style.transformOrigin = dir === 1 ? 'left center' : 'right center';
            nextSt.style.transform = 'rotateY(' + (dir === 1 ? 34 : -34) + 'deg)';
            nextSt.style.opacity = '0.88';
            void nextSt.offsetWidth;
            nextSt.style.transition = 'transform 260ms cubic-bezier(.22,.61,.36,1), opacity 220ms ease';
            nextSt.style.transform = 'rotateY(0deg)';
            nextSt.style.opacity = '1';
          }
          setTimeout(function () {
            var curV = qs('#mnv');
            if (curV) curV.classList.remove('mn-flipping');
          }, 270);
          flipBusy = false;
        }).catch(function () {
          var curV = qs('#mnv');
          if (curV) curV.classList.remove('mn-flipping');
          flipBusy = false;
        });
      }

      if (st) {
        st.style.transition = 'transform 170ms cubic-bezier(.4,0,.6,1), opacity 160ms ease';
        st.style.transformOrigin = dir === 1 ? 'left center' : 'right center';
        st.style.transform = 'translateX(' + (dir === 1 ? -24 : 24) + 'px) rotateY(' + (dir === 1 ? -86 : 86) + 'deg)';
        st.style.opacity = '0.25';
        if (sh) sh.style.opacity = '0.85';
        setTimeout(showIncoming, 165);
      } else {
        showIncoming();
      }
    }

    function bytesToBase64(u8) {
      var out = [];
      var step = 0x4000;
      for (var i = 0; i < u8.length; i += step) {
        out.push(String.fromCharCode.apply(null, u8.subarray(i, i + step)));
      }
      return btoa(out.join(''));
    }

    function persistBufferChunks(file, buf) {
      if (!window.AndroidBridge || !AndroidBridge.saveMinnaChunkBegin) return false;
      var sid = 'mn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      AndroidBridge.saveMinnaChunkBegin(sid);
      var bytes = new Uint8Array(buf);
      var chunkBytes = 192 * 1024;
      for (var offset = 0; offset < bytes.length; offset += chunkBytes) {
        var slice = bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.length));
        if (!AndroidBridge.saveMinnaChunkAppend(sid, bytesToBase64(slice))) {
          return false;
        }
      }
      return AndroidBridge.saveMinnaChunkCommit(
        sid,
        file.name,
        file.type || '',
        Number(file.lastModified || 0)
      );
    }

    function formatSize(bytes) {
      if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function decodeLegacyDocText(buf) {
      var u8 = new Uint8Array(buf);
      var runs = [];
      var cur = '';
      for (var i = 0; i + 1 < u8.length; i += 2) {
        var code = u8[i] | (u8[i + 1] << 8);
        var ok =
          (code >= 0x20 && code <= 0x7e) ||
          code === 0x09 ||
          code === 0x0a ||
          code === 0x0d ||
          (code >= 0x3000 && code <= 0x9fff) ||
          (code >= 0xff00 && code <= 0xffef);
        if (ok) {
          cur += code === 0x0d ? '\n' : String.fromCharCode(code);
        } else {
          if (cur.trim().length >= 8) runs.push(cur.trim());
          cur = '';
        }
      }
      if (cur.trim().length >= 8) runs.push(cur.trim());

      if (runs.length < 2) {
        var ascii = '';
        var aRuns = [];
        for (var j = 0; j < u8.length; j++) {
          var b = u8[j];
          if ((b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d || b === 0x09) {
            ascii += b === 0x0d ? '\n' : String.fromCharCode(b);
          } else {
            if (ascii.trim().length >= 12) aRuns.push(ascii.trim());
            ascii = '';
          }
        }
        if (ascii.trim().length >= 12) aRuns.push(ascii.trim());
        runs = runs.concat(aRuns);
      }

      var filtered = runs.filter(function (s) {
        return !/^(Microsoft|Word\.Document|Normal\.dotm|Times New Roman|Calibri|Root Entry|WordDocument)/i.test(s);
      });
      return filtered.join('\n\n');
    }

    function decodeRtfText(raw) {
      return raw
        .replace(/\\par[d]?\b/g, '\n')
        .replace(/\\tab\b/g, '\t')
        .replace(/\\'([0-9a-fA-F]{2})/g, function (_, h) {
          return String.fromCharCode(parseInt(h, 16));
        })
        .replace(/\{\\\*[^}]*\}/g, '')
        .replace(/\\[a-z]+-?\d* ?/gi, '')
        .replace(/[{}]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function sanitizeHtmlSnippet(html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script,iframe,object,embed,link[rel="stylesheet"]').forEach(function (el) {
        el.remove();
      });
      doc.querySelectorAll('*').forEach(function (el) {
        Array.from(el.attributes).forEach(function (attr) {
          if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) {
            el.removeAttribute(attr.name);
          }
        });
      });
      return doc.body ? doc.body.innerHTML : '';
    }

    function mountDocWithInk(docNode, docId) {
      var c = qs('#mnc');
      var v = qs('#mnv');
      var ms = qs('#mnm');
      if (!c || !v) return;

      var st = document.createElement('div');
      st.id = 'mnst';
      st.style.cssText = 'position:relative;width:100%;min-height:100%';

      var ik = document.createElement('canvas');
      ik.id = 'mnik';
      ik.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;' +
        'touch-action:' + (window.MT === 'hand' ? 'auto' : 'none') + ';' +
        'pointer-events:' + (window.MT === 'hand' ? 'none' : 'auto') + ';z-index:2';

      st.appendChild(docNode);
      st.appendChild(ik);
      c.replaceChildren(st);

      var k = docId + ':1';
      window.MI[k] = window.MI[k] || [];

      function sizeCanvas() {
        var cssW = Math.max(200, st.clientWidth || v.clientWidth || 320);
        var cssH = Math.max(v.clientHeight || 320, docNode.scrollHeight || st.scrollHeight || 320);
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var scale = Math.min(dpr, 2000 / cssW, 4096 / cssH);
        var nextW = Math.max(1, Math.round(cssW * scale));
        var nextH = Math.max(1, Math.round(cssH * scale));
        ik.style.width = cssW + 'px';
        ik.style.height = cssH + 'px';
        if (ik.width !== nextW || ik.height !== nextH) {
          ik.width = nextW;
          ik.height = nextH;
        }
        window.mnPaint(ik, k);
      }

      sizeCanvas();
      if (window.ResizeObserver) {
        new ResizeObserver(sizeCanvas).observe(docNode);
      }

      bindCanvasDrawingHandlers(ik, k);

      var pg = qs('#mnpg');
      var pv = qs('#mnpv');
      var nx = qs('#mnnx');
      if (pg) {
        pg.value = 1;
        pg.max = 1;
        pg.disabled = true;
        if (pg.nextElementSibling) pg.nextElementSibling.textContent = '/ 1';
      }
      if (pv) pv.disabled = true;
      if (nx) nx.disabled = true;
      if (ms) ms.hidden = true;
      v.scrollTop = 0;
      window.mnTb();
    }

    window.mnBar = function () {
      var o = qs('#mnuf');
      var nm = window.MNU ? window.MNU.name : window.MNH ? window.MNH.name : '';
      if (!nm) {
        if (o) o.remove();
        return;
      }
      if (o) {
        o.firstChild.textContent = nm;
        return;
      }
      var v = qs('#mnv');
      if (!v) return;
      var bar = document.createElement('div');
      bar.className = 'mn-uf';
      bar.id = 'mnuf';
      var sp = document.createElement('span');
      sp.textContent = nm;
      var bt = document.createElement('button');
      bt.type = 'button';
      bt.textContent = 'Hapus file';
      bt.onclick = function () {
        var performDelete = function () {
          if (window.AndroidBridge && AndroidBridge.deleteSavedMinnaFile) {
            AndroidBridge.deleteSavedMinnaFile();
          }
          clearLegacyIndexedDb();
          revokeImgUrl();
          window.MNU = null;
          window.MNH = null;
          window.mnShow(window.MNS.n);
          if (typeof window.toast === 'function') window.toast('File dihapus');
        };
        if (typeof window.ask === 'function') {
          window.ask('Hapus file tersimpan "' + nm + '"?', performDelete, 'Hapus');
        } else {
          performDelete();
        }
      };
      bar.append(sp, bt);
      v.parentNode.insertBefore(bar, v);
    };

    var origMnShow = window.mnShow;
    window.mnShow = async function (n, keep, fromBookFlip) {
      if (suppressDefaultShow && !window.MNU && !window.MNH) return;
      if (!fromBookFlip && Date.now() < suppressSwipeUntil) return;
      var pg = qs('#mnpg');
      if (pg) pg.disabled = false;
      return origMnShow.call(this, n, keep);
    };

    var origMnStage = window.mnStage;
    window.mnStage = function (c, cv, w, h, k) {
      origMnStage.apply(this, arguments);
      var ik = qs('#mnik');
      if (ik) {
        ik.style.pointerEvents = window.MT === 'hand' ? 'none' : 'auto';
        ik.style.touchAction = window.MT === 'hand' ? 'auto' : 'none';
        bindCanvasDrawingHandlers(ik, k);
      }
    };

    var origMnTb = window.mnTb;
    window.mnTb = function () {
      origMnTb.apply(this, arguments);
      var k = activeInkKey();
      var u = qs('#mnun');
      var r = qs('#mnre');
      var ik = qs('#mnik');
      var bb = qs('#mnbm');
      var bar = qs('#mnbk');
      if (u) u.disabled = !(window.MI[k] && window.MI[k].length);
      if (r) r.disabled = !(window.MR[k] && window.MR[k].length);
      if (ik) {
        ik.style.touchAction = window.MT === 'hand' ? 'auto' : 'none';
        ik.style.pointerEvents = window.MT === 'hand' ? 'none' : 'auto';
      }
      if (window.MNH) {
        if (bb) {
          bb.disabled = true;
          bb.classList.remove('on');
          var svg = bb.querySelector('svg');
          if (svg) svg.style.fill = 'none';
        }
        if (bar) bar.hidden = true;
      } else if (bb) {
        bb.disabled = false;
      }
      updateToolBadges();
      updateActiveToolBar();
      updateSaveButtonState(!hasUnsavedInk && false);
      document.documentElement.classList.toggle('mn-drawing', !!window.MN1 && window.MT !== 'hand');
    };

    window.mnUp = async function (f) {
      var c = qs('#mnc');
      var v = qs('#mnv');
      var ms = qs('#mnm');
      if (!c || !v || !ms || !f) return;

      closeToolPopover();
      var ext = (f.name.split('.').pop() || '').toLowerCase();
      var mime = (f.type || '').toLowerCase();
      var t = ++MNT;
      if (MNR) {
        try { MNR.cancel(); } catch (_) {}
      }
      ms.textContent = f._r ? 'Memulihkan file tersimpan…' : 'Memuat & menyimpan file…';
      ms.hidden = false;

      try {
        var buf = await f.arrayBuffer();
        if (t !== MNT) return;

        if (!f._r) {
          clearLegacyIndexedDb();
          var synced = false;
          if (window.AndroidBridge && AndroidBridge.syncMinnaMeta) {
            synced = AndroidBridge.syncMinnaMeta(
              f.name,
              f.type || '',
              Number(f.size || buf.byteLength || 0),
              Number(f.lastModified || 0)
            );
          }
          if (!synced) {
            persistBufferChunks(f, buf);
          }
        }

        var id = f.name + '|' + (f.size || buf.byteLength) + '|' + (f.lastModified || 0);
        var savedUi = {};
        try {
          savedUi = (JSON.parse(localStorage.getItem('mn1u') || '{}') || {})[id] || {};
        } catch (_) {}

        var isPdf = ext === 'pdf' || mime === 'application/pdf';
        var isImage =
          ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].indexOf(ext) >= 0 ||
          mime.indexOf('image/') === 0;
        var isSheet = ['xlsx', 'xls', 'csv', 'ods'].indexOf(ext) >= 0;
        var isDocx = ext === 'docx';
        var isDoc = ext === 'doc';
        var isText =
          ['txt', 'md', 'json', 'log', 'xml', 'srt', 'vtt', 'tsv', 'yaml', 'yml'].indexOf(ext) >= 0 ||
          mime.indexOf('text/') === 0;

        if (isPdf) {
          revokeImgUrl();
          var L = await mnLib();
          var d = await L.getDocument({ data: new Uint8Array(buf) }).promise;
          if (t !== MNT) return;
          var u = {
            t: 'pdf',
            d: d,
            n: d.numPages,
            id: id,
            name: f.name,
            p: Math.min(d.numPages, Math.max(1, (+savedUi.p | 0) || 1)),
            b: Array.isArray(savedUi.b) ? savedUi.b.filter(function (z) { return z > 0 && z <= d.numPages; }) : []
          };
          window.MNU = u;
          window.MNH = null;
          await window.mnShow(u.p, false, true);
          if (!f._r && typeof window.toast === 'function') window.toast('File PDF tersimpan permanen');
          return;
        }

        if (isImage) {
          revokeImgUrl();
          var blob = new Blob([buf], { type: f.type || 'image/*' });
          var url = URL.createObjectURL(blob);
          lastImgObjectUrl = url;
          var im = new Image();
          await new Promise(function (ok, no) {
            im.onload = ok;
            im.onerror = no;
            im.src = url;
          });
          if (t !== MNT) return;
          var iu = {
            t: 'img',
            d: im,
            n: 1,
            id: id,
            name: f.name,
            p: 1,
            b: Array.isArray(savedUi.b) ? savedUi.b.filter(function (z) { return z === 1; }) : []
          };
          window.MNU = iu;
          window.MNH = null;
          await window.mnShow(1, false, true);
          if (!f._r && typeof window.toast === 'function') window.toast('Gambar tersimpan permanen');
          return;
        }

        var w = document.createElement('div');
        w.className = 'mn-doc';

        if (isSheet) {
          if (!window.XLSX) {
            await mnScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
          }
          if (t !== MNT) return;
          var wb = window.XLSX.read(buf, { type: 'array' });
          if (t !== MNT) return;
          w.innerHTML = wb.SheetNames.map(function (n) {
            return (
              '<h3>' + escHtml(n) + '</h3>' +
              window.XLSX.utils
                .sheet_to_html(wb.Sheets[n], { header: '', footer: '' })
                .replace(/<\/?(html|head|body|meta|title)[^>]*>/gi, '')
            );
          }).join('');
        } else if (isDocx) {
          if (!window.mammoth) {
            await mnScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
          }
          if (t !== MNT) return;
          var res = await window.mammoth.convertToHtml({ arrayBuffer: buf });
          if (t !== MNT) return;
          w.innerHTML = res.value || '<p>(Dokumen kosong)</p>';
        } else if (isDoc) {
          var head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
          if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
            if (!window.mammoth) {
              await mnScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
            }
            if (t !== MNT) return;
            var resDoc = await window.mammoth.convertToHtml({ arrayBuffer: buf });
            if (t !== MNT) return;
            w.innerHTML = resDoc.value || '<p>(Dokumen kosong)</p>';
          } else {
            var rawText = new TextDecoder('utf-8', { fatal: false }).decode(buf);
            var trimmed = rawText.trimStart();
            if (/^(<!doctype|<html|<body|<p\b|<div\b|<table\b)/i.test(trimmed)) {
              w.innerHTML = sanitizeHtmlSnippet(rawText) || '<p>(Dokumen kosong)</p>';
            } else if (trimmed.indexOf('{\\rtf') === 0) {
              w.innerHTML = '<div class="mn-doc-note">Dokumen RTF (.doc)</div><pre>' + escHtml(decodeRtfText(rawText)) + '</pre>';
            } else {
              var extracted = decodeLegacyDocText(buf);
              if (extracted.trim().length > 0) {
                w.innerHTML =
                  '<div class="mn-doc-note">Dokumen .doc (teks terekstrak)</div><pre>' +
                  escHtml(extracted) +
                  '</pre>';
              } else {
                w.innerHTML =
                  '<div class="mn-bin-card">' +
                  '<div class="mn-bin-ext">DOC</div>' +
                  '<b>' + escHtml(f.name) + '</b>' +
                  '<span>' + formatSize(f.size || buf.byteLength) + ' — File .doc biner tersimpan permanen di aplikasi.</span>' +
                  '<button type="button" class="mn-bin-btn" id="mnExpBtn">Simpan / Buka di Aplikasi Lain</button>' +
                  '</div>';
              }
            }
          }
        } else if (isText) {
          var txt = new TextDecoder('utf-8', { fatal: false }).decode(buf);
          w.innerHTML = '<pre>' + escHtml(txt) + '</pre>';
        } else {
          w.innerHTML =
            '<div class="mn-bin-card">' +
            '<div class="mn-bin-ext">' + escHtml(ext || 'FILE') + '</div>' +
            '<b>' + escHtml(f.name) + '</b>' +
            '<span>' + formatSize(f.size || buf.byteLength) + ' — File tersimpan permanen di aplikasi.</span>' +
            '<button type="button" class="mn-bin-btn" id="mnExpBtn">Simpan / Buka di Aplikasi Lain</button>' +
            '</div>';
        }

        revokeImgUrl();
        window.MNU = null;
        window.MNH = { id: id, name: f.name, node: w };
        window.mnBar();
        mountDocWithInk(w, id);
        var expBtn = w.querySelector('#mnExpBtn');
        if (expBtn && window.AndroidBridge && AndroidBridge.exportSavedMinnaFile) {
          expBtn.onclick = function () { AndroidBridge.exportSavedMinnaFile(); };
        }
        if (!f._r && typeof window.toast === 'function') window.toast('File tersimpan permanen');
      } catch (err) {
        if (t !== MNT) return;
        ms.textContent = 'Gagal membuka file. Pastikan file tidak rusak dan formatnya didukung.';
        ms.hidden = false;
      }
    };

    function restoreSavedMinnaFile() {
      if (restoringMinna || !window.MN1 || window.MNU || window.MNH) return;
      if (!window.AndroidBridge || !AndroidBridge.hasSavedMinnaFile || !AndroidBridge.hasSavedMinnaFile()) {
        return;
      }
      restoringMinna = true;
      var ms = qs('#mnm');
      if (ms) {
        ms.textContent = 'Memuat file tersimpan…';
        ms.hidden = false;
      }
      var meta = {};
      try {
        meta = JSON.parse(AndroidBridge.getSavedMinnaMetaJson() || '{}') || {};
      } catch (_) {}

      fetch('https://appassets.androidplatform.net/__minna_saved_file__', { cache: 'no-store' })
        .then(function (resp) {
          if (!resp.ok) throw new Error('missing');
          return resp.arrayBuffer();
        })
        .then(function (buf) {
          if (!window.MN1 || window.MNU || window.MNH) return;
          var file = new File([buf], meta.name || 'minna_file', {
            type: meta.mimeType || '',
            lastModified: meta.lastModified || 0
          });
          file._r = 1;
          return window.mnUp(file);
        })
        .catch(function () {
          if (window.MN1 && !window.MNU && !window.MNH) {
            origMnShow(mnP());
          }
        })
        .finally(function () {
          restoringMinna = false;
        });
    }

    function setupEnhancedMinnaToolbarAndGestures(m) {
      var tl = qs('.mn-tl');
      if (!tl) return;

      var handBtn = qs('#mt-hand');
      var penBtn = qs('#mt-pen');
      var hlBtn = qs('#mt-hl');
      var erBtn = qs('#mt-eraser');
      var unBtn = qs('#mnun');
      var reBtn = qs('#mnre');

      var topTb = qs('.mn-tb');
      var bmBtn = qs('#mnbm');
      var upBtn = qs('#mnup');
      var uIn = qs('#mnuin');
      var hd = qs('.kz-hd');
      var pageEl = qs('.kz-pg');
      var viewerEl = qs('#mnv');

      // Remove bottom "Buka PDF asli" links & Gulir icon/button
      var pdfLinks = qs('.mn-ln');
      if (pdfLinks) {
        pdfLinks.remove();
      }
      if (handBtn) {
        handBtn.remove();
      }

      // Move Bookmark & Upload to header right, and move page navigation (< 1 / 204 >) below PDF viewer
      if (hd && (bmBtn || upBtn)) {
        var hdAct = document.createElement('div');
        hdAct.className = 'mn-hd-act';
        if (bmBtn) hdAct.appendChild(bmBtn);
        if (upBtn) hdAct.appendChild(upBtn);
        hd.appendChild(hdAct);
      }
      if (uIn && pageEl) {
        pageEl.appendChild(uIn);
      }
      if (pageEl) {
        pageEl.style.paddingBottom = '18px';
      }
      if (topTb && viewerEl && viewerEl.parentNode) {
        topTb.classList.add('mn-tb-bot');
        viewerEl.parentNode.insertBefore(topTb, viewerEl.nextSibling);
      }
      if (penBtn) {
        penBtn.setAttribute('aria-label', 'Pen');
        penBtn.setAttribute('title', 'Pen (Ketebalan & Warna)');
        penBtn.innerHTML =
          '<span class="mn-tl-dot"></span>' +
          '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>' +
          '</svg>';
      }
      if (hlBtn) {
        hlBtn.setAttribute('aria-label', 'Highlight');
        hlBtn.setAttribute('title', 'Highlight (Ketebalan, Warna & Transparansi)');
        hlBtn.innerHTML =
          '<span class="mn-tl-dot"></span>' +
          '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M9 14l6-6 3 3-6 6H9z"/><path d="M9 17l-4 3h5"/><path d="M15 8l2-2 3 3-2 2"/>' +
          '</svg>';
      }
      if (erBtn) {
        erBtn.setAttribute('aria-label', 'Penghapus');
        erBtn.setAttribute('title', 'Penghapus (Ukuran)');
        erBtn.innerHTML =
          '<span class="mn-tl-er-dot"></span>' +
          '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M5 14l8-8 6 6-6 6H8z"/><path d="M10 11l6 6M12 20h8"/>' +
          '</svg>';
      }
      if (unBtn) {
        unBtn.setAttribute('aria-label', 'Urungkan');
        unBtn.setAttribute('title', 'Urungkan');
        unBtn.innerHTML =
          '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>';
      }
      if (reBtn) {
        reBtn.setAttribute('aria-label', 'Ulangi');
        reBtn.setAttribute('title', 'Ulangi');
        reBtn.innerHTML =
          '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/></svg>';
      }

      var saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'kz-tb mn-sv';
      saveBtn.id = 'mnsv';
      saveBtn.setAttribute('aria-label', 'Simpan tulisan dan highlight');
      saveBtn.setAttribute('title', 'Simpan permanen tulisan & highlight');
      saveBtn.innerHTML =
        '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>' +
          '<path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>' +
        '</svg>' +
        '<span class="mn-sv-dot" hidden></span>';
      saveBtn.onclick = function () {
        closeToolPopover();
        persistAllAnnotations(true);
      };
      tl.appendChild(saveBtn);

      // Compact active-tool status bar (only visible while Pen/Highlight/Hapus is active)
      var activeBar = document.createElement('div');
      activeBar.className = 'mn-active-bar';
      activeBar.id = 'mn-active-bar';
      activeBar.hidden = window.MT === 'hand';
      activeBar.innerHTML =
        '<button type="button" class="mn-ab-cfg" id="mnAbCfg"><span class="mn-ab-sw"></span><span class="mn-ab-txt"></span></button>' +
        '<button type="button" class="mn-ab-done" id="mnAbDone">Selesai</button>';
      tl.parentNode.insertBefore(activeBar, tl.nextSibling);

      activeBar.querySelector('#mnAbCfg').onclick = function () {
        if (activePopTool === window.MT) closeToolPopover();
        else renderToolPopover(window.MT);
      };
      activeBar.querySelector('#mnAbDone').onclick = function () {
        window.MT = 'hand';
        closeToolPopover();
        window.mnTb();
      };

      // Anchor popover right below active bar, floating cleanly over viewer
      var popAnchor = document.createElement('div');
      popAnchor.className = 'mn-pop-anchor';
      var pop = document.createElement('div');
      pop.className = 'mn-tool-pop';
      pop.id = 'mn-tool-pop';
      pop.hidden = true;
      popAnchor.appendChild(pop);
      activeBar.parentNode.insertBefore(popAnchor, activeBar.nextSibling);

      // Tool click behaviors: tap inactive tool to activate + open settings; tap active tool again to return to scroll/book-flip
      if (penBtn) {
        penBtn.onclick = function () {
          if (window.MT === 'pen') {
            window.MT = 'hand';
            closeToolPopover();
            window.mnTb();
          } else {
            window.MT = 'pen';
            window.mnTb();
            renderToolPopover('pen');
          }
        };
      }
      if (hlBtn) {
        hlBtn.onclick = function () {
          if (window.MT === 'hl') {
            window.MT = 'hand';
            closeToolPopover();
            window.mnTb();
          } else {
            window.MT = 'hl';
            window.mnTb();
            renderToolPopover('hl');
          }
        };
      }
      if (erBtn) {
        erBtn.onclick = function () {
          if (window.MT === 'eraser') {
            window.MT = 'hand';
            closeToolPopover();
            window.mnTb();
          } else {
            window.MT = 'eraser';
            window.mnTb();
            renderToolPopover('eraser');
          }
        };
      }

      if (unBtn) {
        unBtn.onclick = function () {
          var k = activeInkKey();
          var s = (window.MI[k] || []).pop();
          if (s) {
            (window.MR[k] = window.MR[k] || []).push(s);
            var ik = qs('#mnik');
            if (ik) window.mnPaint(ik, k);
            markInkDirty();
            window.mnTb();
          }
        };
      }
      if (reBtn) {
        reBtn.onclick = function () {
          var k = activeInkKey();
          var s = (window.MR[k] || []).pop();
          if (s) {
            (window.MI[k] = window.MI[k] || []).push(s);
            var ik = qs('#mnik');
            if (ik) window.mnPaint(ik, k);
            markInkDirty();
            window.mnTb();
          }
        };
      }

      var pvBtn = qs('#mnpv');
      var nxBtn = qs('#mnnx');
      if (pvBtn) {
        pvBtn.onclick = function () {
          if (window.MNH) return;
          performBookTurn(mnP() - 1, -1);
        };
      }
      if (nxBtn) {
        nxBtn.onclick = function () {
          if (window.MNH) return;
          performBookTurn(mnP() + 1, 1);
        };
      }

      var pg = qs('#mnpg');
      if (pg) {
        pg.onchange = function (e) {
          if (window.MNH) {
            e.target.value = 1;
            return;
          }
          var target = +e.target.value;
          var dir = target >= mnP() ? 1 : -1;
          performBookTurn(target, dir);
        };
      }

      // Interactive 3D book-page flip gesture in Gulir mode (#mnv)
      var v = qs('#mnv');
      if (v) {
        var bSx = 0, bSy = 0, bTime = 0, bCan = false, bDir = 0, bProgress = 0;

        v.addEventListener('touchstart', function (e) {
          if (activePopTool) closeToolPopover();
          bDir = 0;
          bProgress = 0;
          if (window.MT !== 'hand' || window.MNH || flipBusy || e.touches.length !== 1) {
            bCan = false;
            return;
          }
          var atHorizontalFit = v.scrollWidth <= v.clientWidth + 4;
          var atLeftEdge = v.scrollLeft <= 2;
          var atRightEdge = v.scrollLeft + v.clientWidth >= v.scrollWidth - 2;
          bCan = atHorizontalFit || atLeftEdge || atRightEdge;
          if (bCan) {
            bSx = e.touches[0].clientX;
            bSy = e.touches[0].clientY;
            bTime = Date.now();
          }
        }, { passive: true });

        v.addEventListener('touchmove', function (e) {
          if (!bCan || window.MT !== 'hand' || window.MNH || flipBusy) return;
          if (e.touches.length !== 1) {
            if (bDir !== 0) {
              bDir = 0;
              resetFlipTransform(true);
            }
            bCan = false;
            return;
          }
          var t = e.touches[0];
          var dx = t.clientX - bSx;
          var dy = t.clientY - bSy;

          if (bDir === 0) {
            if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
              bCan = false;
              return;
            }
            if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.2) {
              var wantDir = dx < 0 ? 1 : -1;
              var cur = mnP();
              var total = mnN();
              var edgeOk =
                v.scrollWidth <= v.clientWidth + 4 ||
                (wantDir === 1 && v.scrollLeft + v.clientWidth >= v.scrollWidth - 2) ||
                (wantDir === -1 && v.scrollLeft <= 2);
              if (edgeOk && ((wantDir === 1 && cur < total) || (wantDir === -1 && cur > 1))) {
                bDir = wantDir;
              } else {
                bCan = false;
                return;
              }
            } else {
              return;
            }
          }

          if (bDir !== 0) {
            e.preventDefault();
            var span = Math.max(200, v.clientWidth * 0.82);
            bProgress = bDir === 1 ? (-dx / span) : (dx / span);
            bProgress = Math.max(0, Math.min(1, bProgress));
            applyFlipTransform(bDir, bProgress);
          }
        }, { passive: false });

        var finishFlip = function (e) {
          if (bDir === 0) {
            bCan = false;
            return;
          }
          suppressSwipeUntil = Date.now() + 250;
          var dir = bDir;
          var prog = bProgress;
          var elapsed = Math.max(1, Date.now() - bTime);
          var t = (e.changedTouches && e.changedTouches[0]) || null;
          var dx = t ? (t.clientX - bSx) : 0;
          var velocity = Math.abs(dx) / elapsed;
          bDir = 0;
          bCan = false;
          bProgress = 0;

          if (prog > 0.2 || Math.abs(dx) > 65 || (velocity > 0.35 && Math.abs(dx) > 28)) {
            performBookTurn(mnP() + dir, dir);
          } else {
            resetFlipTransform(true);
          }
        };

        v.addEventListener('touchend', finishFlip, { passive: true });
        v.addEventListener('touchcancel', function () {
          if (bDir !== 0) {
            bDir = 0;
            bCan = false;
            bProgress = 0;
            resetFlipTransform(true);
          }
        }, { passive: true });
      }

      updateToolBadges();
      updateSaveButtonState(false);
    }

    function lockMinnaShell(locked) {
      document.documentElement.classList.toggle('mn1-locked', !!locked);
      if (!locked) {
        document.documentElement.classList.remove('mn-drawing');
      } else {
        window.scrollTo(0, 0);
        var sc = qs('#scr');
        if (sc) sc.scrollTop = 0;
        var pgEl = qs('.kz-pg');
        if (pgEl) pgEl.scrollTop = 0;
      }
    }

    function lockKanaTestShell(locked) {
      document.documentElement.classList.toggle('kt-locked', !!locked);
      if (locked) {
        window.scrollTo(0, 0);
        var sc = qs('#scr');
        if (sc) sc.scrollTop = 0;
        var pgEl = qs('.kz-pg.tw');
        if (pgEl) pgEl.scrollTop = 0;
      }
    }

    function wrapKanaTestViewport() {
      var g = qs('#twg');
      var twa = qs('#twa');
      if (!twa || !g || !g.parentNode || qs('#ktvp')) return;

      var vp = document.createElement('div');
      vp.className = 'kt-vp';
      vp.id = 'ktvp';
      g.parentNode.insertBefore(vp, g);
      vp.appendChild(g);

      var pts = new Map();
      var ktPin = null;
      g.addEventListener('pointerdown', function (e) {
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2) {
          var z = qs('#twz');
          if (!z) return;
          var s0 = Math.max(1, z.getBoundingClientRect().width / Math.max(1, z.offsetWidth));
          var arr = Array.from(pts.values());
          var cy0 = (arr[0][1] + arr[1][1]) / 2;
          var r0 = g.getBoundingClientRect();
          ktPin = { qy: (cy0 - r0.top) / s0 };
        }
      }, { passive: true });

      g.addEventListener('pointermove', function (e) {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size < 2 || !ktPin) return;
        var z = qs('#twz');
        if (!z) return;
        var s1 = Math.max(1, z.getBoundingClientRect().width / Math.max(1, z.offsetWidth));
        var arr = Array.from(pts.values());
        var cy1 = (arr[0][1] + arr[1][1]) / 2;
        var vpTop = vp.getBoundingClientRect().top;
        vp.scrollTop = Math.max(0, vpTop + ktPin.qy * s1 - cy1);
      }, { passive: true });

      var endPt = function (e) {
        pts.delete(e.pointerId);
        if (pts.size < 2) ktPin = null;
      };
      g.addEventListener('pointerup', endPt, { passive: true });
      g.addEventListener('pointercancel', endPt, { passive: true });

      g.addEventListener('touchstart', function (e) {
        if (e.touches && e.touches.length >= 2) {
          vp.style.touchAction = 'none';
        }
      }, { passive: true });
      g.addEventListener('touchmove', function (e) {
        if (e.touches && e.touches.length >= 2) {
          e.preventDefault();
        }
      }, { passive: false });
      var resetTouch = function (e) {
        if (!e.touches || e.touches.length < 2) {
          vp.style.touchAction = 'pan-y';
        }
      };
      g.addEventListener('touchend', resetTouch, { passive: true });
      g.addEventListener('touchcancel', resetTouch, { passive: true });
    }

    function styleKanaTestToolbar() {
      var ktHint = qs('#twa > .kt-h');
      if (ktHint) ktHint.remove();
      var tb = qs('#twa .tw-tb');
      if (!tb || qs('#kt-pen')) return;

      var unBtn = qs('#twu');
      var reBtn = qs('#twd');
      var erBtn = qs('#twe');
      var chkBtn = qs('#twk');
      var delBtn = qs('#twx');
      var svBtn = qs('#tws');

      var penBtn = document.createElement('button');
      penBtn.type = 'button';
      penBtn.className = 'kz-tb';
      penBtn.id = 'kt-pen';
      penBtn.setAttribute('aria-label', 'Pen');
      penBtn.setAttribute('title', 'Pen');
      penBtn.innerHTML =
        '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>' +
        '</svg>';

      if (erBtn) {
        erBtn.setAttribute('aria-label', 'Penghapus');
        erBtn.setAttribute('title', 'Penghapus');
        erBtn.innerHTML =
          '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M5 14l8-8 6 6-6 6H8z"/><path d="M10 11l6 6M12 20h8"/>' +
          '</svg>';
      }
      if (unBtn) {
        unBtn.setAttribute('aria-label', 'Urungkan');
        unBtn.setAttribute('title', 'Urungkan');
        unBtn.innerHTML =
          '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>';
      }
      if (reBtn) {
        reBtn.setAttribute('aria-label', 'Ulangi');
        reBtn.setAttribute('title', 'Ulangi');
        reBtn.innerHTML =
          '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/></svg>';
      }
      if (svBtn) {
        svBtn.setAttribute('aria-label', 'Simpan');
        svBtn.setAttribute('title', 'Simpan');
        svBtn.innerHTML =
          '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>' +
            '<path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>' +
          '</svg>';
      }

      tb.appendChild(penBtn);
      if (erBtn) tb.appendChild(erBtn);
      if (unBtn) tb.appendChild(unBtn);
      if (reBtn) tb.appendChild(reBtn);
      if (chkBtn) tb.appendChild(chkBtn);
      if (delBtn) tb.appendChild(delBtn);
      if (svBtn) tb.appendChild(svBtn);

      var syncKtPenState = function () {
        var erOn = !!(erBtn && erBtn.classList.contains('on'));
        penBtn.classList.toggle('on', !erOn);
        penBtn.setAttribute('aria-pressed', erOn ? 'false' : 'true');
        if (erBtn) erBtn.setAttribute('aria-pressed', erOn ? 'true' : 'false');
      };

      penBtn.onclick = function () {
        if (erBtn && erBtn.classList.contains('on')) {
          erBtn.click();
        } else {
          syncKtPenState();
          if (typeof window.toast === 'function') window.toast('Mode Pen aktif');
        }
      };

      if (erBtn && typeof erBtn.onclick === 'function' && !erBtn.__ktPenWrapped) {
        erBtn.__ktPenWrapped = true;
        var origErClick = erBtn.onclick;
        erBtn.onclick = function () {
          var out = origErClick.apply(this, arguments);
          syncKtPenState();
          return out;
        };
      }

      if (svBtn && typeof svBtn.onclick === 'function' && !svBtn.__ktSaveDedupWrapped) {
        svBtn.__ktSaveDedupWrapped = true;
        var origSvClick = svBtn.onclick;
        svBtn.onclick = function () {
          var prevTop = (typeof NTS !== 'undefined' && Array.isArray(NTS) && NTS.length) ? NTS[0] : null;
          var out = origSvClick.apply(this, arguments);
          if (typeof NTS !== 'undefined' && Array.isArray(NTS) && NTS.length && NTS[0] !== prevTop) {
            var newest = NTS[0];
            var dk = getLocalDateKey(newest.ts);
            if (dedupeKanaTestNotesByDay(newest.sc, dk) && typeof window.toast === 'function') {
              window.toast('Catatan hari ini diperbarui');
            }
          }
          return out;
        };
      }

      syncKtPenState();
    }

    function getLocalDateKey(ts) {
      var d = new Date(ts || 0);
      return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function dedupeKanaTestNotesByDay(onlySc, onlyDateKey) {
      try {
        if (typeof NTS === 'undefined' || !Array.isArray(NTS) || NTS.length < 2) return false;
        var bestIdx = Object.create(null);
        var i;
        for (i = 0; i < NTS.length; i++) {
          var item = NTS[i];
          if (!item || !item.r) continue;
          var dk = getLocalDateKey(item.ts);
          if (onlySc && (item.sc !== onlySc || dk !== onlyDateKey)) continue;
          var key = (item.sc || '') + '|' + dk;
          if (bestIdx[key] === undefined || (item.ts || 0) > (NTS[bestIdx[key]].ts || 0)) {
            bestIdx[key] = i;
          }
        }
        var changed = false;
        for (i = NTS.length - 1; i >= 0; i--) {
          var cur = NTS[i];
          if (!cur || !cur.r) continue;
          var dk2 = getLocalDateKey(cur.ts);
          if (onlySc && (cur.sc !== onlySc || dk2 !== onlyDateKey)) continue;
          var key2 = (cur.sc || '') + '|' + dk2;
          if (bestIdx[key2] !== undefined && bestIdx[key2] !== i) {
            NTS.splice(i, 1);
            changed = true;
          }
        }
        if (changed && typeof ntSave === 'function') {
          ntSave();
        }
        return changed;
      } catch (_) {
        return false;
      }
    }

    dedupeKanaTestNotesByDay();

    function enhanceKanaTestPage() {
      var twa = qs('#twa');
      if (!twa) {
        lockKanaTestShell(false);
        return;
      }
      lockKanaTestShell(true);
      styleKanaTestToolbar();
      wrapKanaTestViewport();

      if (!twa.__ktObserverAttached) {
        twa.__ktObserverAttached = true;
        new MutationObserver(function () {
          styleKanaTestToolbar();
          wrapKanaTestViewport();
        }).observe(twa, { childList: true });
      }

      var pgEl = qs('.kz-pg.tw');
      if (pgEl && !pgEl.__ktScrollClamped) {
        pgEl.__ktScrollClamped = true;
        pgEl.addEventListener('scroll', function () {
          if (pgEl.scrollTop !== 0) pgEl.scrollTop = 0;
          if (pgEl.scrollLeft !== 0) pgEl.scrollLeft = 0;
        }, { passive: true });
      }

      var backBtn = qs('#kzb');
      if (backBtn && !backBtn.__ktBackHooked && typeof backBtn.onclick === 'function') {
        backBtn.__ktBackHooked = true;
        var origKanaBack = backBtn.onclick;
        backBtn.onclick = function () {
          lockKanaTestShell(false);
          return origKanaBack.apply(this, arguments);
        };
      }
    }

    if (!window.__mnShellGuardsInstalled) {
      window.__mnShellGuardsInstalled = true;
      document.addEventListener('touchstart', function (e) {
        var r = document.documentElement;
        if (r.classList.contains('mn1-locked')) {
          if (e.touches && e.touches.length > 1 && (!e.target || !e.target.closest('#mnv'))) {
            e.preventDefault();
          }
        } else if (r.classList.contains('kt-locked')) {
          if (e.touches && e.touches.length > 1 && (!e.target || !e.target.closest('#twg'))) {
            e.preventDefault();
          }
        }
      }, { passive: false });
      document.addEventListener('touchmove', function (e) {
        var r = document.documentElement;
        if (r.classList.contains('mn1-locked')) {
          if (e.touches && e.touches.length > 1 && (!e.target || !e.target.closest('#mnv'))) {
            e.preventDefault();
          }
        } else if (r.classList.contains('kt-locked')) {
          if (e.touches && e.touches.length > 1 && (!e.target || !e.target.closest('#twg'))) {
            e.preventDefault();
          }
        }
      }, { passive: false });
      window.addEventListener('scroll', function () {
        var r = document.documentElement;
        if (r.classList.contains('mn1-locked') || r.classList.contains('kt-locked')) {
          window.scrollTo(0, 0);
        }
      }, { passive: true });
    }

    var origRender = window.render;
    if (typeof origRender === 'function') {
      window.render = function () {
        var out = origRender.apply(this, arguments);
        if (!window.MN1) lockMinnaShell(false);
        if (qs('#twa')) enhanceKanaTestPage();
        else lockKanaTestShell(false);
        return out;
      };
    }

    var origKanaPage = window.kanaPage;
    if (typeof origKanaPage === 'function') {
      window.kanaPage = function () {
        var out = origKanaPage.apply(this, arguments);
        enhanceKanaTestPage();
        return out;
      };
    }

    var origKzTest = window.kzTest;
    if (typeof origKzTest === 'function') {
      window.kzTest = function () {
        var out = origKzTest.apply(this, arguments);
        enhanceKanaTestPage();
        return out;
      };
    }

    var origMinna1Page = window.minna1Page;
    window.minna1Page = function (m) {
      var hasNativeSaved =
        !window.MNU &&
        !window.MNH &&
        window.AndroidBridge &&
        AndroidBridge.hasSavedMinnaFile &&
        AndroidBridge.hasSavedMinnaFile();

      suppressDefaultShow = !!hasNativeSaved;
      try {
        origMinna1Page.apply(this, arguments);
      } finally {
        suppressDefaultShow = false;
      }

      lockMinnaShell(true);
      setupEnhancedMinnaToolbarAndGestures(m);

      var backBtn = qs('#kzb');
      if (backBtn && typeof backBtn.onclick === 'function') {
        var origBack = backBtn.onclick;
        backBtn.onclick = function () {
          lockMinnaShell(false);
          return origBack.apply(this, arguments);
        };
      }
      var pgEl = qs('.kz-pg');
      if (pgEl) {
        pgEl.addEventListener('scroll', function () {
          if (pgEl.scrollTop !== 0) pgEl.scrollTop = 0;
          if (pgEl.scrollLeft !== 0) pgEl.scrollLeft = 0;
        }, { passive: true });
      }

      if (window.MNH) {
        window.mnBar();
        mountDocWithInk(window.MNH.node, window.MNH.id || window.MNH.name);
      } else if (hasNativeSaved) {
        restoreSavedMinnaFile();
      }
    };

    if (window.MN1) {
      window.render();
    }
  }

  function installSingleUiAndResponsive() {
    try {
      if (typeof ST !== 'undefined' && ST) {
        ST.layout = 'ui2';
        ST.view = 'auto';
        if (typeof saveST === 'function') saveST();
      }
    } catch (_) {}

    var origApplyUI = window.applyUI;
    window.applyUI = function () {
      try {
        if (typeof ST !== 'undefined' && ST) {
          ST.layout = 'ui2';
          ST.view = 'auto';
        }
      } catch (_) {}
      if (typeof origApplyUI === 'function') {
        origApplyUI.apply(this, arguments);
      }
      var r = document.documentElement;
      r.dataset.layout = 'ui2';
      r.classList.add('u2');
      r.classList.remove('vmob');
      notifyTheme();
    };

    window.layoutHTML = function () {
      return '';
    };
    window.bindLayout = function () {};

    var needRerender =
      !document.documentElement.classList.contains('u2') ||
      document.documentElement.classList.contains('vmob');
    window.applyUI();
    if (needRerender && typeof window.render === 'function') {
      window.render();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp) {
      vp.setAttribute(
        'content',
        'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content'
      );
    }
    notifyTheme();
    var obs = new MutationObserver(function () {
      requestAnimationFrame(notifyTheme);
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-ui', 'data-theme']
    });
    installMinnaEnhancements();
    installSingleUiAndResponsive();
  });
})();
