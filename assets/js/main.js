/* =========================================================
   Zhengjian Li — site behaviour
   - Theme (light/dark) toggle with persistence
   - Multilingual UI with a glitch / scramble effect

   How translation works
   ---------------------
   English is the canonical language and lives directly in the HTML
   (the text inside [data-i18n="key"] elements). Every other language
   is a JSON file at assets/i18n/<code>.json mapping the same keys to
   their translations. Files are fetched on demand and cached. Any key
   missing from a translation falls back to the English in the HTML.

   To add a language:
     1. add an entry to I18N.langs below (code + button label), and
     2. create assets/i18n/<code>.json with the keys you want translated.
   No other code changes needed — the toggle rebuilds itself.

   Note: fetching JSON needs the site to be served over http(s)
   (a local server or GitHub Pages). Opening the file via file://
   will block the fetch and the page simply stays in English.
   ========================================================= */

const I18N = {
  default: "en",          // canonical language, sourced from the HTML
  dir: "assets/i18n/",    // where <code>.json translation files live
  langs: [                // order defines the toggle's cycle order
    { code: "en", label: "EN" },
    { code: "fr", label: "FR" },
  ],
};

const dicts = {};                 // code -> { key: text }, lazily populated
let currentLang = I18N.default;

const STORE = { theme: "zl-theme", lang: "zl-lang" };
// sessionStorage flag: set when leaving via an internal nav link, so the next
// page knows to play the switch-in effect (a hard refresh has no flag).
const TRANSITION_FLAG = "zl-transit";
const prefersReducedMotion =
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Theme ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(STORE.theme, theme); } catch (e) {}
}

function initTheme() {
  let theme;
  try { theme = localStorage.getItem(STORE.theme); } catch (e) {}
  if (!theme) {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }
  applyTheme(theme);

  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.addEventListener("click", () => {
      const next =
        document.documentElement.getAttribute("data-theme") === "dark"
          ? "light" : "dark";
      applyTheme(next);
    });
  }
}

/* ---------- Glitch / scramble text effect ---------- */
const GLITCH_CHARS = "!<>-_\\/[]{}=+*^?#@$%&░▒▓01";

// Split an HTML string into tokens: HTML tags and entities are kept whole,
// everything else becomes a single visible character. This lets the scramble
// animate the visible text while emitting tags (e.g. links) untouched.
function tokenizeHTML(html) {
  const tokens = [];
  const re = /<[^>]+>|&[^;]+;|[\s\S]/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = m[0];
    tokens.push({ tag: t[0] === "<", value: t });
  }
  return tokens;
}

class TextScramble {
  constructor(el) {
    this.el = el;
    this.update = this.update.bind(this);
  }
  setText(newHTML) {
    // Old visible characters (tags stripped), positionally matched to the new.
    const oldChars = tokenizeHTML(this.el.innerHTML)
      .filter((t) => !t.tag)
      .map((t) => t.value);
    const newTokens = tokenizeHTML(newHTML);

    const promise = new Promise((resolve) => (this.resolve = resolve));
    this.queue = [];
    let vi = 0; // index into the visible characters
    const rndSpan = () => {
      const start = Math.floor(Math.random() * 28);
      return { start, end: start + Math.floor(Math.random() * 28) + 8 };
    };
    for (const tok of newTokens) {
      if (tok.tag) {
        this.queue.push({ literal: tok.value }); // emit tags verbatim
      } else {
        this.queue.push({ from: oldChars[vi] || "", to: tok.value, char: null, ...rndSpan() });
        vi++;
      }
    }
    // Any leftover old characters scramble away to nothing.
    for (; vi < oldChars.length; vi++) {
      this.queue.push({ from: oldChars[vi], to: "", char: null, ...rndSpan() });
    }

    cancelAnimationFrame(this.frameRequest);
    this.frame = 0;
    this.el.classList.add("i18n-glitch");
    this.update();
    return promise;
  }
  update() {
    let output = "";
    let complete = 0;
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i];
      if (item.literal !== undefined) {
        output += item.literal;
        complete++;
        continue;
      }
      let { from, to, start, end, char } = item;
      if (this.frame >= end) {
        complete++;
        output += to;
      } else if (this.frame >= start) {
        if (!char || Math.random() < 0.28) {
          char = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
          item.char = char;
        }
        output += `<span class="dud">${char}</span>`;
      } else {
        output += from;
      }
    }
    this.el.innerHTML = output;
    if (complete === this.queue.length) {
      this.el.classList.remove("i18n-glitch");
      this.resolve && this.resolve();
    } else {
      this.frameRequest = requestAnimationFrame(this.update);
      this.frame++;
    }
  }
}

/* ---------- Language ---------- */

// Capture the canonical (English) strings straight from the HTML so they
// double as the source of truth and the fallback for missing keys.
// We capture innerHTML (not textContent) so inline markup like links is
// preserved; translation JSON files may include the same HTML.
function captureDefaultDict() {
  const dict = {};
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    // Collapse source line breaks / indentation into single spaces so they
    // don't leak into the rendered text or the scramble effect.
    dict[el.getAttribute("data-i18n")] = el.innerHTML.replace(/\s+/g, " ").trim();
  });
  dicts[I18N.default] = dict;
}

// Fetch (once) and cache a language's translation file.
async function loadDict(lang) {
  if (dicts[lang]) return dicts[lang];
  try {
    const res = await fetch(I18N.dir + lang + ".json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    dicts[lang] = await res.json();
  } catch (e) {
    console.warn(`i18n: could not load "${lang}" — staying in ${I18N.default}.`, e);
    dicts[lang] = {}; // empty dict => everything falls back to English
  }
  return dicts[lang];
}

function updateLangUI(lang) {
  document.querySelectorAll(".lang-opt").forEach((opt) => {
    opt.classList.toggle("is-active", opt.getAttribute("data-lang-opt") === lang);
  });
}

// opts.skipHeader = don't scramble elements inside the site header (used for
// the page-load intro, where the nav/brand should stay stable across switches).
async function applyLang(lang, animate, opts) {
  const dict = await loadDict(lang);
  const base = dicts[I18N.default];
  const doAnimate = animate && !prefersReducedMotion;
  const skipHeader = !!(opts && opts.skipHeader);

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = key in dict ? dict[key] : base[key];
    if (text == null) return;
    // The scramble is markup-aware, so links animate too (tags stay intact).
    const animateEl = doAnimate && !(skipHeader && el.closest(".site-header"));
    if (animateEl) new TextScramble(el).setText(text);
    else el.innerHTML = text;
  });

  currentLang = lang;
  document.documentElement.setAttribute("lang", lang);
  updateLangUI(lang);
  try { localStorage.setItem(STORE.lang, lang); } catch (e) {}
}

// Build the toggle's contents from I18N.langs so it stays in sync
// automatically when languages are added/removed. Clicking cycles.
function buildLangToggle() {
  const btn = document.getElementById("langToggle");
  if (!btn) return;
  btn.textContent = "";
  I18N.langs.forEach((l, i) => {
    if (i) {
      const sep = document.createElement("span");
      sep.className = "lang-sep";
      sep.textContent = "/";
      btn.appendChild(sep);
    }
    const span = document.createElement("span");
    span.className = "lang-opt";
    span.setAttribute("data-lang-opt", l.code);
    span.textContent = l.label;
    btn.appendChild(span);
  });
  btn.addEventListener("click", () => {
    const codes = I18N.langs.map((l) => l.code);
    const next = codes[(codes.indexOf(currentLang) + 1) % codes.length];
    applyLang(next, true);
  });
}

// Pick a language from the browser/OS preferences: the first preferred
// language we support wins (e.g. French → "fr"), otherwise English.
function detectLang(codes) {
  const prefs =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ""];
  for (const pref of prefs) {
    const code = pref.slice(0, 2).toLowerCase();
    if (codes.includes(code)) return code;
  }
  return I18N.default;
}

function initLang() {
  captureDefaultDict();
  buildLangToggle();

  const codes = I18N.langs.map((l) => l.code);

  // A previous explicit choice (the toggle) wins; otherwise auto-detect.
  let lang;
  try { lang = localStorage.getItem(STORE.lang); } catch (e) {}
  if (!codes.includes(lang)) lang = detectLang(codes);

  // Only play the switch-in effect when we arrived via an internal nav click
  // (the flag is set in playOutro). A hard refresh / direct visit has no flag,
  // so the page just loads with no effect. The header is left stable either
  // way — it only scrambles on an actual language change (the toggle).
  let viaSwitch = false;
  try {
    viaSwitch = sessionStorage.getItem(TRANSITION_FLAG) === "1";
    if (viaSwitch) sessionStorage.removeItem(TRANSITION_FLAG);
  } catch (e) {}
  if (viaSwitch) document.body.classList.add("is-switching");

  applyLang(lang, viaSwitch, { skipHeader: true });
}

/* ---------- Page-switch transition ---------- */
// Glitch the current page out, then run `done` (the navigation). The text
// dissolves to nothing and the photo glitches out via CSS (.is-leaving).
function playOutro(done) {
  document.body.classList.add("is-leaving");
  if (!prefersReducedMotion) {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (el.closest(".site-header")) return; // header stays put
      new TextScramble(el).setText("");
    });
  }
  setTimeout(done, prefersReducedMotion ? 0 : 420);
}

// Intercept internal nav links so switching pages plays out → navigate → in.
function initPageTransition() {
  const current = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (!href || /^(https?:|\/\/|#|mailto:)/.test(href)) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if ((href.split("/").pop() || "index.html") === current) return; // same page
      e.preventDefault();
      try { sessionStorage.setItem(TRANSITION_FLAG, "1"); } catch (_) {}
      playOutro(() => { location.href = href; });
    });
  });
}

/* ---------- Misc ---------- */
function initActiveNav() {
  const page = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-link").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === page || (page === "" && href === "index.html")) {
      link.classList.add("is-active");
    }
  });
}

/* Assemble email at runtime so it stays out of the static HTML source
   (basic anti-scraping). Address = data-user + "@" + data-domain. */
function initEmail() {
  // Clickable mailto links.
  document.querySelectorAll(".email-link").forEach((a) => {
    const user = a.getAttribute("data-user");
    const domain = a.getAttribute("data-domain");
    if (!user || !domain) return;
    a.href = "mailto:" + user + "@" + domain;
  });

  // Explicit, non-clickable version — readable, but visitors must type it
  // out themselves (and there's no "@" in the source for scrapers).
  document.querySelectorAll(".email-plain").forEach((el) => {
    const user = el.getAttribute("data-user");
    const domain = el.getAttribute("data-domain");
    if (!user || !domain) return;
    const spell = (s) => s.replace(/\./g, " [dot] ");
    el.textContent = spell(user) + " [at] " + spell(domain);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initLang();
  initActiveNav();
  initEmail();
  initPageTransition();
});
