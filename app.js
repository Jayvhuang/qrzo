/* Qrzo — bilingual QR code toolkit logic (client-side, no upload) */
(function () {
  "use strict";
  const langKey = "qrzo-lang", themeKey = "qrzo-theme";
  const QR = (window.qrcode || function () { throw new Error("qrcode lib missing"); });
  const jsQR = (window.jsQR || null);

  /* ---------- i18n ---------- */
  const I = {
    en: {
      enterContent: "(enter content to generate a QR code)",
      tooLong: "Content is too long to encode into a QR code. Try shortening it.",
      decodedOk: "Decoded successfully:",
      decoding: "Decoding…",
      noQR: "No QR code found. Try a clearer image.",
      cantRead: "Could not read the image.",
      copy: "Copy",
      copied: "Copied!",
      logoNote: "Best with High error correction."
    },
    "zh-CN": {
      enterContent: "（请输入内容以生成二维码）",
      tooLong: "内容过长，无法生成二维码。请尝试缩短。",
      decodedOk: "解码成功：",
      decoding: "正在解码…",
      noQR: "未能识别二维码，请换一张更清晰的图片。",
      cantRead: "图片无法读取。",
      copy: "复制",
      copied: "已复制！",
      logoNote: "使用高纠错级别效果最佳。"
    }
  };
  let lang = localStorage.getItem(langKey) || "en";
  function t(key) { return (I[lang] && I[lang][key]) || I.en[key]; }
  function applyLang(l) {
    lang = l;
    document.documentElement.lang = l === "zh-CN" ? "zh-CN" : "en";
    document.documentElement.setAttribute("data-lang", l);
    document.querySelectorAll("[data-en]").forEach((el) => {
      if (el.querySelector(":scope [data-en]")) return;
      el.textContent = l === "zh-CN" ? (el.dataset.zh || el.dataset.en) : el.dataset.en;
    });
    const seg = document.getElementById("lang-seg");
    if (seg) seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.langSet === l));
    if (activeTool && activeTool !== "scanner") generate();
  }

  /* ---------- theme ---------- */
  function applyTheme(th) {
    document.documentElement.setAttribute("data-theme", th);
    localStorage.setItem(themeKey, th);
  }

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  function vstr(id) { const el = $(id); return el ? el.value : ""; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ---------- QR engine state ---------- */
  const ENG = { size: 14, fg: "#000000", bg: "#ffffff", ecc: "M", margin: 4, logo: null, logoDataURL: null, payload: "", lastQR: null };
  let activeTool = "url";

  function esc(s) { return String(s || "").replace(/([\\;,:"])/g, "\\$1"); }

  const builders = {
    url: () => vstr("url-input").trim(),
    text: () => vstr("text-input"),
    wifi: () => {
      const ssid = esc(vstr("wifi-ssid").trim());
      const enc = vstr("wifi-enc");
      const pass = esc(vstr("wifi-pass"));
      const hidden = $("wifi-hidden").checked ? "true" : "";
      if (enc === "nopass") return "WIFI:T:nopass;S:" + ssid + ";;";
      return "WIFI:T:" + enc + ";S:" + ssid + ";P:" + pass + ";H:" + hidden + ";;";
    },
    contact: () => {
      const first = vstr("vc-first").trim(), last = vstr("vc-last").trim();
      const org = vstr("vc-org").trim(), title = vstr("vc-title").trim();
      const phone = vstr("vc-phone").trim(), email = vstr("vc-email").trim();
      const url = vstr("vc-url").trim(), addr = vstr("vc-addr").trim(), note = vstr("vc-note").trim();
      const fn = (first + " " + last).trim() || " ";
      let v = "BEGIN:VCARD\r\nVERSION:3.0\r\n";
      v += "N:" + last + ";" + first + ";;;\r\n";
      v += "FN:" + fn + "\r\n";
      if (org) v += "ORG:" + org + "\r\n";
      if (title) v += "TITLE:" + title + "\r\n";
      if (phone) v += "TEL;TYPE=CELL:" + phone + "\r\n";
      if (email) v += "EMAIL:" + email + "\r\n";
      if (url) v += "URL:" + url + "\r\n";
      if (addr) v += "ADR;TYPE=WORK:;;" + addr + "\r\n";
      if (note) v += "NOTE:" + note + "\r\n";
      v += "END:VCARD";
      return v;
    },
    email: () => {
      const to = encodeURIComponent(vstr("em-to").trim());
      const params = [];
      const subj = vstr("em-subject").trim(); if (subj) params.push("subject=" + encodeURIComponent(subj));
      const body = vstr("em-body"); if (body) params.push("body=" + encodeURIComponent(body));
      return "mailto:" + to + (params.length ? "?" + params.join("&") : "");
    },
    sms: () => "SMSTO:" + vstr("sms-to").trim() + ":" + vstr("sms-body"),
    event: () => {
      const title = vstr("ev-title").trim(), loc = vstr("ev-loc").trim(), desc = vstr("ev-desc").trim();
      const ical = (dt, tm) => { if (!dt) return ""; const p = dt.split("-"); const time = tm || "00:00"; const q = time.split(":"); return p[0] + p[1] + p[2] + "T" + q[0] + q[1] + "00"; };
      const start = ical(vstr("ev-start-date"), vstr("ev-start-time"));
      const end = ical(vstr("ev-end-date"), vstr("ev-end-time"));
      let v = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Qrzo//QR Event//EN\r\nBEGIN:VEVENT\r\n";
      v += "UID:qrzo-" + Date.now() + "@qrzo.com\r\nDTSTAMP:" + start + "\r\n";
      if (start) v += "DTSTART:" + start + "\r\n";
      if (end) v += "DTEND:" + end + "\r\n";
      if (title) v += "SUMMARY:" + title + "\r\n";
      if (loc) v += "LOCATION:" + loc + "\r\n";
      if (desc) v += "DESCRIPTION:" + desc + "\r\n";
      v += "END:VEVENT\r\nEND:VCALENDAR";
      return v;
    }
  };

  function clearCanvas(canvas) { canvas.width = canvas.width; const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height); }

  function renderCanvas(qr, canvas, o) {
    const n = qr.getModuleCount();
    const cell = o.size, m = o.margin, dim = (n + 2 * m) * cell;
    canvas.width = dim; canvas.height = dim;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = o.bg; ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = o.fg;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + m) * cell, (r + m) * cell, cell, cell);
    }
    if (o.logo) {
      const ls = Math.floor(dim * 0.22), lx = Math.floor((dim - ls) / 2), pad = Math.floor(ls * 0.16);
      ctx.fillStyle = o.bg; ctx.fillRect(lx - pad, lx - pad, ls + pad * 2, ls + pad * 2);
      try { ctx.drawImage(o.logo, lx, lx, ls, ls); } catch (e) {}
    }
  }

  function buildSVG(qr, o) {
    const n = qr.getModuleCount(), m = o.margin, dim = n + 2 * m, cell = 10;
    let rects = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) rects += '<rect x="' + (c + m) + '" y="' + (r + m) + '" width="1" height="1"/>';
    let logoSvg = "";
    if (o.logoDataURL) {
      const ls = (dim * 0.22).toFixed(2), lx = ((dim - ls) / 2).toFixed(2), pad = (ls * 0.16).toFixed(2);
      logoSvg = '<rect x="' + (lx - pad) + '" y="' + (lx - pad) + '" width="' + (+ls + +pad * 2) + '" height="' + (+ls + +pad * 2) + '" fill="' + o.bg + '"/>' +
        '<image x="' + lx + '" y="' + lx + '" width="' + ls + '" height="' + ls + '" href="' + o.logoDataURL + '"/>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" width="' + (dim * cell) + '" height="' + (dim * cell) + '">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + o.bg + '"/>' +
      '<g fill="' + o.fg + '">' + rects + '</g>' + logoSvg + '</svg>';
  }

  function generate() {
    const canvas = $("qr-canvas");
    if (!canvas) return; // landing pages have no generator canvas
    if (!builders[activeTool]) return;
    const payload = builders[activeTool]();
    ENG.payload = payload;
    const box = $("payload-box");
    if (!payload) { box.textContent = t("enterContent"); clearCanvas($("qr-canvas")); ENG.lastQR = null; return; }
    let qr;
    try {
      qr = QR(0, ENG.ecc);
      qr.addData(payload);
      qr.make();
    } catch (e) {
      box.textContent = t("tooLong");
      clearCanvas($("qr-canvas"));
      ENG.lastQR = null;
      return;
    }
    ENG.lastQR = qr;
    renderCanvas(qr, $("qr-canvas"), ENG);
    box.textContent = payload;
  }

  /* ---------- tabs ---------- */
  function activateTool(name) {
    activeTool = name;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tool === name));
    document.querySelectorAll(".form-panel").forEach((p) => p.classList.toggle("active", p.dataset.tool === name));
    const isScanner = name === "scanner";
    $("stage-generator").classList.toggle("hidden", isScanner);
    $("stage-scanner").classList.toggle("hidden", !isScanner);
    if (!isScanner) generate();
    history.replaceState(null, "", "#tool-" + name);
  }

  /* ---------- scanner ---------- */
  function decodeFile(file) {
    const res = $("scan-result");
    res.innerHTML = '<div class="status info show">' + t("decoding") + "</div>";
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      const max = 1024; let w = img.width, h = img.height;
      if (Math.max(w, h) > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      let out = null;
      try { if (jsQR) out = jsQR(data.data, w, h); } catch (e) {}
      if (out && out.data) {
        res.innerHTML = '<div class="status ok show">' + t("decodedOk") + '</div><div class="decoded">' + escapeHtml(out.data) + '</div><button class="btn ghost copy-btn" id="scan-copy">' + t("copy") + "</button>";
        $("scan-copy").addEventListener("click", () => {
          if (navigator.clipboard) navigator.clipboard.writeText(out.data).then(() => { const b = $("scan-copy"); const o = b.textContent; b.textContent = t("copied"); setTimeout(() => b.textContent = o, 1200); });
        });
      } else {
        res.innerHTML = '<div class="status err show">' + t("noQR") + "</div>";
      }
    };
    img.onerror = () => { res.innerHTML = '<div class="status err show">' + t("cantRead") + "</div>"; };
    img.src = URL.createObjectURL(file);
  }

  /* ---------- wire up ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    const seg = $("lang-seg");
    if (seg) seg.addEventListener("click", (e) => { const b = e.target.closest("button[data-lang-set]"); if (b) { applyLang(b.dataset.langSet); localStorage.setItem(langKey, b.dataset.langSet); } });
    const tt = $("theme-toggle");
    if (tt) tt.addEventListener("click", () => { const cur = document.documentElement.getAttribute("data-theme"); applyTheme(cur === "dark" ? "light" : "dark"); });

    applyLang(lang);
    applyTheme(localStorage.getItem(themeKey) || "light");

    if (!$("qr-canvas")) return; // landing pages: i18n + theme only

    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => activateTool(b.dataset.tool)));
    if (location.hash.startsWith("#tool-")) { const n = location.hash.slice("#tool-".length); if (builders[n] || n === "scanner") activeTool = n; }

    // generator inputs -> live update
    document.querySelectorAll(".form-panel input, .form-panel textarea, .form-panel select").forEach((el) => {
      el.addEventListener("input", () => { if (activeTool !== "scanner") generate(); });
      el.addEventListener("change", () => { if (activeTool !== "scanner") generate(); });
    });

    // customize controls
    const sizeEl = $("opt-size"), sizeVal = $("opt-size-val");
    sizeEl.addEventListener("input", () => { ENG.size = Number(sizeEl.value); sizeVal.textContent = sizeEl.value; generate(); });
    $("opt-fg").addEventListener("input", () => { ENG.fg = $("opt-fg").value; generate(); });
    $("opt-bg").addEventListener("input", () => { ENG.bg = $("opt-bg").value; generate(); });
    $("opt-ecc").addEventListener("change", () => { ENG.ecc = $("opt-ecc").value; generate(); });

    // logo
    $("opt-logo").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) { ENG.logo = null; ENG.logoDataURL = null; $("opt-logo-clear").style.display = "none"; generate(); return; }
      const rd = new FileReader();
      rd.onload = () => { const img = new Image(); img.onload = () => { ENG.logo = img; ENG.logoDataURL = rd.result; $("opt-logo-clear").style.display = "inline-block"; generate(); }; img.src = rd.result; };
      rd.readAsDataURL(f);
    });
    $("opt-logo-clear").addEventListener("click", () => { ENG.logo = null; ENG.logoDataURL = null; $("opt-logo").value = ""; $("opt-logo-clear").style.display = "none"; generate(); });

    // downloads
    $("dl-png").addEventListener("click", () => { if (ENG.lastQR) $("qr-canvas").toBlob((blob) => triggerDownload(blob, "qrzo-qr.png"), "image/png"); });
    $("dl-svg").addEventListener("click", () => { if (ENG.lastQR) triggerDownload(new Blob([buildSVG(ENG.lastQR, ENG)], { type: "image/svg+xml" }), "qrzo-qr.svg"); });

    // wifi encryption toggles password field
    $("wifi-enc").addEventListener("change", () => { $("wifi-pass-field").style.display = vstr("wifi-enc") === "nopass" ? "none" : ""; });

    // scanner
    const dz = $("scan-dz"), sinput = $("scan-file");
    sinput.addEventListener("change", () => { if (sinput.files[0]) decodeFile(sinput.files[0]); sinput.value = ""; });
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
    dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); if (e.dataTransfer.files[0]) decodeFile(e.dataTransfer.files[0]); });

    // initial render
    ENG.size = Number(sizeEl.value); sizeVal.textContent = sizeEl.value;
    $("wifi-pass-field").style.display = vstr("wifi-enc") === "nopass" ? "none" : "";
    activateTool(activeTool);
  });
})();
