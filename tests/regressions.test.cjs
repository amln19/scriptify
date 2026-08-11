const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildSync } = require("esbuild");

// Source modules intentionally log transport failures that the tests provoke.
// Keep the default TAP output readable; set SCRIPTIFY_TEST_VERBOSE=1 to inspect
// the extension's diagnostic logging while the suite runs.
const originalConsole = {
  log: console.log,
  warn: console.warn,
};
if (process.env.SCRIPTIFY_TEST_VERBOSE !== "1") {
  console.log = () => {};
  console.warn = () => {};
}

const buildDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "scriptify-regressions-"),
);

for (const entry of [
  "async",
  "lrclib",
  "lyricsInterceptor",
  "romanizer",
  "scriptDetector",
  "styles",
]) {
  const source =
    entry === "async"
      ? "src/utils/async.ts"
      : entry === "scriptDetector"
        ? "src/utils/scriptDetector.ts"
        : entry === "styles"
          ? "src/components/styles.ts"
      : `src/services/${entry}.ts`;
  buildSync({
    entryPoints: [source],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(buildDirectory, `${entry}.cjs`),
    logLevel: "silent",
  });
}

test.after(() => {
  fs.rmSync(buildDirectory, { recursive: true, force: true });
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
});

function freshModule(name) {
  const modulePath = path.join(buildDirectory, `${name}.cjs`);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function lyricsResponse(words, language = null) {
  return {
    lyrics: {
      language,
      lines: words.map((word, index) => ({
        startTimeMs: String(index * 1000),
        words: word,
      })),
    },
  };
}

function trackData(id) {
  return {
    item: {
      uri: `spotify:track:${id}`,
      name: `Track ${id}`,
      metadata: {
        title: `Track ${id}`,
        artist_name: "Artist",
        album_title: "Album",
      },
    },
    duration: 180_000,
    positionAsOfTimestamp: 0,
    timestamp: 0,
    isPaused: false,
  };
}

function installInterceptorEnvironment(trackId, cosmosGet) {
  const listeners = new Map();
  const intervals = new Set();
  const storage = new Map();
  const styleValues = new Map();

  global.document = {
    documentElement: {
      style: { setProperty: (name, value) => styleValues.set(name, value) },
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  global.requestAnimationFrame = (callback) => callback();
  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  global.setInterval = (callback) => {
    const token = { callback };
    intervals.add(token);
    return token;
  };
  global.clearInterval = (token) => intervals.delete(token);
  global.Spicetify = {
    CosmosAsync: { get: cosmosGet },
    LocalStorage: {
      get: (key) => storage.get(key) ?? null,
      set: (key, value) => storage.set(key, value),
    },
    Platform: {
      History: {
        location: { pathname: "/lyrics" },
        listen: (callback) => {
          listeners.set("history", callback);
          return () => listeners.delete("history");
        },
      },
    },
    Player: {
      data: trackData(trackId),
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name, callback) => {
        if (listeners.get(name) === callback) listeners.delete(name);
      },
    },
    URI: {
      from: (uri) => ({ id: uri.split(":").at(-1) }),
    },
  };

  return { intervals, listeners, storage, styleValues };
}

function jsonResponse(status, body, headers = {}) {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => normalized.get(key.toLowerCase()) ?? null },
    json: async () => body,
  };
}

function track(id, overrides = {}) {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: "Track",
    artist: "Artist",
    album: "Album",
    duration: 180_000,
    ...overrides,
  };
}

test("Japanese long vowels and modern compound kana are romanized", () => {
  const { romanize } = freshModule("romanizer");
  assert.equal(romanize("スーパー"), "Suupaa");
  assert.equal(romanize("ティ ファ"), "Ti fa");
});

test("canonically decomposed Korean Jamo matches precomposed Hangul", () => {
  const { romanize } = freshModule("romanizer");
  assert.equal(romanize("한글"), "Hangeul");
  assert.equal(romanize("한글"), romanize("한글"));
});

test("Korean romanization handles common liaison and palatalization", () => {
  const { romanize } = freshModule("romanizer");
  assert.equal(romanize("한국어"), "Hangugeo");
  assert.equal(romanize("같이"), "Gachi");
  assert.equal(romanize("먹어요"), "Meogeoyo");
});

test("unmapped CJK does not advertise unavailable romanization", () => {
  const { hasRomanizableScript, romanize } = freshModule("romanizer");
  assert.equal(romanize("龘"), "龘");
  assert.equal(hasRomanizableScript("龘"), false);
});

test("CJK inside Japanese or Korean lyrics is not given a Mandarin reading", () => {
  const { romanize } = freshModule("romanizer");
  assert.equal(romanize("心の中で"), "心no中de");
  assert.equal(romanize("한글 中"), "Hangeul 中");
});

test("literal Indic tildes and Malayalam dictionary output survive post-processing", () => {
  const { romanize } = freshModule("romanizer");
  assert.equal(romanize("தமிழ் ~ நல்ல"), "Tamizh ~ nalla");
  assert.equal(romanize("വീട്ടിലേക്ക്"), "Veettilekku");
});

test("every claimed romanization engine converts a representative sample", () => {
  const { romanize, setLanguageHint } = freshModule("romanizer");
  const cases = [
    ["hi", "नमस्ते", "Namaste"],
    ["mr", "नमस्कार", "Namaskaar"],
    ["sa", "नमस्ते", "Namaste"],
    ["pa", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "Sat sri akaal"],
    ["bn", "বাংলা", "Banla"],
    ["gu", "ગુજરાતી", "Gujaraati"],
    ["or", "ଓଡ଼ିଆ", "Odaiaa"],
    ["ta", "தமிழ்", "Tamizh"],
    ["te", "తెలుగు", "Telugu"],
    ["kn", "ಕನ್ನಡ", "Kannada"],
    ["ml", "മലയാളം", "Malayaalam"],
    ["ja", "がっこう", "Gakkou"],
    ["ko", "안녕하세요", "Annyeonghaseyo"],
    [null, "你好", "Nǐ hǎo"],
  ];

  for (const [language, input, expected] of cases) {
    setLanguageHint(language);
    assert.equal(romanize(input), expected, `${language ?? "cjk"}: ${input}`);
  }
});

test("romanizer preserves Latin text, routes mixed scripts, and rejects unsupported scripts", () => {
  const { hasRomanizableScript, romanize } = freshModule("romanizer");
  assert.equal(romanize("Already Latin"), null);
  assert.equal(romanize("   \n"), null);
  assert.equal(romanize("Hello नमस्ते ਪੰਜਾਬੀ"), "Hello namaste panjaabi");
  assert.equal(romanize("Привет"), null);
  assert.equal(romanize("مرحبا"), null);
  assert.equal(romanize("สวัสดี"), null);
  assert.equal(hasRomanizableScript("१२३"), true);
  assert.equal(hasRomanizableScript("Привет"), false);
});

test("unknown Devanagari uses neutral transliteration instead of Hindi-only rules", () => {
  const { romanize, setLanguageHint } = freshModule("romanizer");
  setLanguageHint("hi-IN");
  assert.equal(romanize("कर्म"), "Karm");
  setLanguageHint(null);
  assert.equal(romanize("कर्म"), "Karma");
  setLanguageHint("mr-IN");
  assert.equal(romanize("विचारलं"), "Vichaarla");
});

test("script detection identifies dominant, mixed, and shared CJK scripts", () => {
  const { ScriptType, detectAllScripts, detectScript, hasNonLatinScript } =
    freshModule("scriptDetector");
  assert.equal(detectScript("hello"), ScriptType.Latin);
  assert.equal(detectScript("नमस्ते"), ScriptType.Devanagari);
  assert.equal(detectScript("日本語"), ScriptType.CJK);
  assert.equal(detectScript("日本語です"), ScriptType.Japanese);
  assert.equal(detectScript("한국어 中"), ScriptType.Korean);
  assert.equal(detectScript("123 !"), ScriptType.Unknown);
  assert.deepEqual(
    [...detectAllScripts("Hello नमस्ते")].sort(),
    [ScriptType.Latin, ScriptType.Devanagari].sort(),
  );
  assert.equal(hasNonLatinScript("Hello 123"), false);
  assert.equal(hasNonLatinScript("Hello नमस्ते"), true);
});

test("withTimeout rejects a request that never settles and runs cleanup", async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let timeoutCallback;
  let cleanedUp = false;
  global.setTimeout = (callback) => {
    timeoutCallback = callback;
    return 1;
  };
  global.clearTimeout = () => {};

  try {
    const { TimeoutError, withTimeout } = freshModule("async");
    const pending = withTimeout(
      new Promise(() => {}),
      8_000,
      "test request",
      () => {
        cleanedUp = true;
      },
    );
    timeoutCallback();
    await assert.rejects(pending, TimeoutError);
    assert.equal(cleanedUp, true);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("a late mode request cannot restart or notify after mode changes", async () => {
  const request = deferred();
  const environment = installInterceptorEnvironment("A", () => request.promise);
  const interceptor = freshModule("lyricsInterceptor");
  await interceptor.initLyricsInterceptor();

  const modes = [];
  interceptor.onModeChange((mode) => modes.push(mode));
  const staleMode = interceptor.setMode("romanized");
  const currentMode = interceptor.setMode("original");
  request.resolve(lyricsResponse(["नमस्ते"], "hi"));

  await Promise.all([staleMode, currentMode]);
  assert.deepEqual(modes, ["original"]);
  assert.equal(environment.intervals.size, 0);
  interceptor.destroyLyricsInterceptor();
});

test("destroy prevents late lyrics completion from mutating lifecycle state", async () => {
  const request = deferred();
  const environment = installInterceptorEnvironment("A", () => request.promise);
  const interceptor = freshModule("lyricsInterceptor");
  await interceptor.initLyricsInterceptor();

  const modes = [];
  interceptor.onModeChange((mode) => modes.push(mode));
  const pendingMode = interceptor.setMode("romanized");
  interceptor.destroyLyricsInterceptor();
  request.resolve(lyricsResponse(["नमस्ते"], "hi"));

  await pendingMode;
  assert.deepEqual(modes, []);
  assert.equal(environment.intervals.size, 0);
  assert.equal(environment.listeners.has("songchange"), false);
});

test("a track change invalidates an in-flight mode build", async () => {
  const request = deferred();
  const environment = installInterceptorEnvironment("A", () => request.promise);
  const interceptor = freshModule("lyricsInterceptor");
  await interceptor.initLyricsInterceptor();

  const modes = [];
  interceptor.onModeChange((mode) => modes.push(mode));
  const staleMode = interceptor.setMode("romanized");
  global.Spicetify.Player.data = trackData("B");
  environment.listeners.get("songchange")();
  request.resolve(lyricsResponse(["नमस्ते"], "hi"));

  await staleMode;
  assert.deepEqual(modes, []);
  assert.equal(environment.intervals.size, 0);
  interceptor.destroyLyricsInterceptor();
});

test("stale track availability cannot overwrite the current track", async () => {
  const requests = new Map([
    ["A", deferred()],
    ["B", deferred()],
  ]);
  const environment = installInterceptorEnvironment("A", (url) =>
    requests.get(url.match(/track\/([^?]+)/)[1]).promise,
  );
  const interceptor = freshModule("lyricsInterceptor");
  await interceptor.initLyricsInterceptor();

  const availability = [];
  interceptor.onLyricsAvailabilityChange((value) => availability.push(value));
  const staleCheck = interceptor.checkInitialLyricsAvailability();

  global.Spicetify.Player.data = trackData("B");
  environment.listeners.get("songchange")();
  requests.get("B").resolve(lyricsResponse(["already Latin"], "en"));
  await Promise.resolve();
  await Promise.resolve();
  requests.get("A").resolve(lyricsResponse(["नमस्ते"], "hi"));
  await staleCheck;

  assert.deepEqual(availability, [false]);
  interceptor.destroyLyricsInterceptor();
});

test("availability falls back to LRCLIB when Spotify fails", async () => {
  installInterceptorEnvironment("fallback", async () => {
    throw new Error("Spotify unavailable");
  });
  let clientHeader;
  global.fetch = async (_url, options) => {
    clientHeader = options.headers["Lrclib-Client"];
    return jsonResponse(200, {
      duration: 180,
      syncedLyrics: "[00:01.00]नमस्ते",
    });
  };
  const interceptor = freshModule("lyricsInterceptor");
  await interceptor.initLyricsInterceptor();

  const availability = [];
  interceptor.onLyricsAvailabilityChange((value) => availability.push(value));
  await interceptor.checkInitialLyricsAvailability();

  assert.deepEqual(availability, [true]);
  assert.match(clientHeader, /^Scriptify v1\.0 \(https:\/\/github\.com\/amln19\/scriptify\)$/);
  interceptor.destroyLyricsInterceptor();
});

test("LRCLIB records Retry-After as a non-blocking cooldown and later recovers", async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return jsonResponse(429, null, { "Retry-After": "2" });
    }
    return jsonResponse(200, {
      duration: 180,
      syncedLyrics: "[00:01.20][00:02.345]chorus",
    });
  };

  try {
    const { fetchLyrics } = freshModule("lrclib");
    const requestedTrack = {
      id: "rate-limit",
      uri: "spotify:track:rate-limit",
      name: "Track",
      artist: "Artist",
      album: "Album",
      duration: 180_000,
    };
    assert.equal(await fetchLyrics(requestedTrack), null);
    assert.equal(calls.length, 1);
    // A second caller observes the server's cooldown without another request.
    assert.equal(await fetchLyrics(requestedTrack), null);
    assert.equal(calls.length, 1);

    now += 2_000;
    const lines = await fetchLyrics(requestedTrack);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.headers["Lrclib-Client"].startsWith("Scriptify v1.0"), true);
    assert.deepEqual(lines, [
      { startTimeMs: 1_200, text: "chorus" },
      { startTimeMs: 2_345, text: "chorus" },
    ]);
  } finally {
    Date.now = originalNow;
  }
});

test("LRCLIB transport failures are not negative-cached", async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    if (calls === 1) throw new Error("temporary failure");
    return jsonResponse(200, {
      duration: 180,
      syncedLyrics: "[00:01.00]recovered",
    });
  };
  const { fetchLyrics } = freshModule("lrclib");
  const track = {
    id: "transient",
    uri: "spotify:track:transient",
    name: "Track",
    artist: "Artist",
    album: "Album",
    duration: 180_000,
  };

  assert.equal(await fetchLyrics(track), null);
  assert.deepEqual(await fetchLyrics(track), [
    { startTimeMs: 1_000, text: "recovered" },
  ]);
  assert.equal(calls, 2);
});

test("LRCLIB search uses structured identity and rejects wrong same-duration hits", async () => {
  const originalSetTimeout = global.setTimeout;
  const requests = [];
  global.setTimeout = (callback, delay) => {
    if (delay === 250) {
      queueMicrotask(callback);
      return 1;
    }
    return originalSetTimeout(callback, delay);
  };
  global.fetch = async (url) => {
    requests.push(url);
    if (url.includes("/get?")) return jsonResponse(404, {});
    return jsonResponse(200, [
      {
        trackName: "Different Song",
        artistName: "The Artist",
        albumName: "Album Name",
        duration: 180,
        syncedLyrics: "[00:02]wrong",
      },
      {
        trackName: "Song & Name",
        artistName: "The Artist",
        albumName: "Album Name",
        duration: 181,
        syncedLyrics: "[00:03]nearest",
      },
      {
        trackName: "Song & Name",
        artistName: "The Artist",
        albumName: "Album Name",
        duration: 190,
        syncedLyrics: "[00:04]too-far",
      },
    ]);
  };

  try {
    const { fetchLyrics } = freshModule("lrclib");
    const requestedTrack = track("search-cache", {
      name: "Song & Name",
      artist: "The Artist",
      album: "Album Name",
    });
    const first = await fetchLyrics(requestedTrack);
    const second = await fetchLyrics(requestedTrack);

    assert.equal(requests.length, 2);
    assert.match(requests[0], /track_name=Song/);
    assert.match(requests[0], /album_name=Album/);
    assert.match(requests[1], /\/search\?track_name=Song/);
    assert.match(requests[1], /artist_name=The/);
    assert.match(requests[1], /album_name=Album/);
    assert.doesNotMatch(requests[1], /(?:\?|&)q=/);
    assert.deepEqual(first, [{ startTimeMs: 3_000, text: "nearest" }]);
    assert.deepEqual(second, first);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("mode retries wait for DOM without repeating failed network requests", async () => {
  let spotifyCalls = 0;
  let lrclibCalls = 0;
  const environment = installInterceptorEnvironment("network-once", async () => {
    spotifyCalls++;
    throw new Error("Spotify unavailable");
  });
  global.fetch = async () => {
    lrclibCalls++;
    throw new Error("LRCLIB unavailable");
  };
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, delay, ...args) => {
    if (delay === 2_000) {
      queueMicrotask(() => callback(...args));
      return 1;
    }
    return originalSetTimeout(callback, delay, ...args);
  };

  try {
    const interceptor = freshModule("lyricsInterceptor");
    await interceptor.initLyricsInterceptor();
    await interceptor.setMode("romanized");
    assert.equal(spotifyCalls, 1);
    assert.equal(lrclibCalls, 1);
    assert.equal(environment.intervals.size, 0);
    interceptor.destroyLyricsInterceptor();
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("initial map collection has a deadline and invalidates its late result", async () => {
  const request = deferred();
  const environment = installInterceptorEnvironment("deadline", () => request.promise);
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = [];
  global.setTimeout = (callback, delay, ...args) => {
    const timer = { callback: () => callback(...args), delay, cancelled: false };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) timer.cancelled = true;
  };

  try {
    const interceptor = freshModule("lyricsInterceptor");
    await interceptor.initLyricsInterceptor();
    const pendingMode = interceptor.setMode("romanized");
    await Promise.resolve();

    const deadline = timers.find((timer) => timer.delay === 12_000);
    assert.ok(deadline);
    deadline.callback();
    await pendingMode;
    assert.equal(interceptor.getCurrentMode(), "romanized");
    assert.equal(environment.intervals.size, 0);

    // Completing the old request after the deadline must not commit a map or
    // restart the injection loop.
    request.resolve(lyricsResponse(["नमस्ते"], "hi"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(environment.intervals.size, 0);
    interceptor.destroyLyricsInterceptor();
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("recycled lyric lines clear stale romanization and wrap direct source text", async () => {
  const environment = installInterceptorEnvironment("recycled", async () =>
    lyricsResponse(["नमस्ते"], "hi"),
  );
  global.Node = { TEXT_NODE: 3 };

  const makeElement = (tagName) => {
    let ownText = "";
    const element = {
      nodeType: 1,
      tagName,
      className: "",
      childNodes: [],
      parentElement: null,
      isConnected: true,
      classNames: new Set(),
      get children() {
        return this.childNodes.filter((child) => child.nodeType === 1);
      },
      get textContent() {
        return this.childNodes.length > 0
          ? this.childNodes.map((child) => child.textContent || "").join("")
          : ownText;
      },
      set textContent(value) {
        ownText = value || "";
        this.childNodes = [];
      },
      classList: {
        add(name) {
          element.classNames.add(name);
        },
        remove(name) {
          element.classNames.delete(name);
        },
        contains(name) {
          return element.classNames.has(name);
        },
      },
      appendChild(child) {
        if (child.parentElement) {
          const index = child.parentElement.childNodes.indexOf(child);
          if (index >= 0) child.parentElement.childNodes.splice(index, 1);
        }
        this.childNodes.push(child);
        child.parentElement = this;
        return child;
      },
      insertBefore(child, reference) {
        const index = this.childNodes.indexOf(reference);
        this.childNodes.splice(index >= 0 ? index : this.childNodes.length, 0, child);
        child.parentElement = this;
        return child;
      },
      remove() {
        if (!this.parentElement) return;
        const index = this.parentElement.childNodes.indexOf(this);
        if (index >= 0) this.parentElement.childNodes.splice(index, 1);
        this.parentElement = null;
        this.isConnected = false;
      },
      querySelector(selector) {
        if (selector !== ".scriptify-romanized") return null;
        return this.childNodes.find(
          (child) => child.className === "scriptify-romanized",
        ) || null;
      },
      getAttribute() {
        return null;
      },
      getBoundingClientRect() {
        return { height: 0, top: 0 };
      },
      scrollIntoView() {},
    };
    return element;
  };

  const source = {
    nodeType: 3,
    parentElement: null,
    isConnected: true,
    textContent: "नमस्ते",
  };
  const line = makeElement("div");
  line.appendChild(source);
  global.document = {
    documentElement: { style: { setProperty() {} } },
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === ".scriptify-romanized") {
        const romanized = line.querySelector(selector);
        return romanized ? [romanized] : [];
      }
      if (selector === ".scriptify-replace-line") {
        return line.classList.contains("scriptify-replace-line") ? [line] : [];
      }
      return [line];
    },
    createElement: makeElement,
  };
  global.window = { innerHeight: 800 };

  const interceptor = freshModule("lyricsInterceptor");
  await interceptor.initLyricsInterceptor();
  await interceptor.setDisplayStyle("replace-only");
  await interceptor.setMode("romanized");

  const original = line.children.find(
    (child) => child.className === "scriptify-original",
  );
  assert.ok(original);
  assert.equal(original.textContent, "नमस्ते");
  assert.equal(line.querySelector(".scriptify-romanized").textContent, "Namaste");
  assert.equal(line.classList.contains("scriptify-replace-line"), true);

  // React reuses the same node for an unmapped Latin line.
  source.textContent = "English";
  for (const interval of environment.intervals) interval.callback();
  assert.equal(line.querySelector(".scriptify-romanized"), null);
  assert.equal(line.classList.contains("scriptify-replace-line"), false);
  interceptor.destroyLyricsInterceptor();
});

test("LRCLIB caches definitive misses but not malformed server responses", async () => {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, delay) => {
    if (delay === 250) {
      queueMicrotask(callback);
      return 1;
    }
    return originalSetTimeout(callback, delay);
  };
  let definitiveCalls = 0;
  global.fetch = async () => {
    definitiveCalls++;
    return jsonResponse(404, {});
  };

  try {
    const { fetchLyrics } = freshModule("lrclib");
    const definitiveMiss = track("definitive-miss");
    assert.equal(await fetchLyrics(definitiveMiss), null);
    assert.equal(await fetchLyrics(definitiveMiss), null);
    assert.equal(definitiveCalls, 2);

    let malformedCalls = 0;
    global.fetch = async () => {
      malformedCalls++;
      return jsonResponse(200, "not an LRCLIB object");
    };
    const malformed = track("malformed");
    assert.equal(await fetchLyrics(malformed), null);
    assert.equal(await fetchLyrics(malformed), null);
    assert.equal(malformedCalls, 2);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("getCurrentTrackInfo handles item, track fallback, and unavailable player data", () => {
  const { getCurrentTrackInfo } = freshModule("lrclib");
  global.Spicetify = {
    Player: { data: trackData("item") },
    URI: { from: (uri) => ({ id: uri.split(":").at(-1) }) },
  };
  assert.deepEqual(getCurrentTrackInfo(), track("item", { name: "Track item" }));

  global.Spicetify.Player.data = {
    track: {
      uri: "spotify:track:fallback",
      name: "Fallback",
      metadata: { artist_name: "Artist" },
    },
    duration: 12_000,
  };
  assert.deepEqual(getCurrentTrackInfo(), {
    id: "fallback",
    uri: "spotify:track:fallback",
    name: "Fallback",
    artist: "Artist",
    album: "",
    duration: 12_000,
  });

  global.Spicetify.Player.data = undefined;
  assert.equal(getCurrentTrackInfo(), null);
});

test("interceptor preferences persist valid values, reject invalid saved values, and clamp font size", async () => {
  const environment = installInterceptorEnvironment("preferences", async () =>
    lyricsResponse([]),
  );
  const interceptor = freshModule("lyricsInterceptor");
  environment.storage.set("scriptify:mode", "romanized");
  environment.storage.set("scriptify:displayStyle", "replace-only");
  environment.storage.set("scriptify:fontSizeMultiplier", "1.25");

  assert.equal(interceptor.loadSavedMode(), "romanized");
  assert.equal(interceptor.loadSavedDisplayStyle(), "replace-only");
  assert.equal(interceptor.loadSavedFontSize(), 1.25);
  assert.equal(environment.styleValues.get("--scriptify-font-size"), "0.8999999999999999em");

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = () => 0;
  try {
    interceptor.setRomanizedFontSize(5);
    assert.equal(interceptor.getRomanizedFontSizeMultiplier(), 1.5);
    assert.equal(environment.storage.get("scriptify:fontSizeMultiplier"), "1.5");
    interceptor.setRomanizedFontSize(0);
    assert.equal(interceptor.getRomanizedFontSizeMultiplier(), 0.5);
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  const modeEvents = [];
  const unsubscribe = interceptor.onModeChange((mode) => modeEvents.push(mode));
  await interceptor.setMode("original");
  unsubscribe();
  await interceptor.setMode("original");
  assert.deepEqual(modeEvents, ["original"]);
  interceptor.destroyLyricsInterceptor();

  const invalidEnvironment = installInterceptorEnvironment("invalid", async () =>
    lyricsResponse([]),
  );
  invalidEnvironment.storage.set("scriptify:mode", "invalid");
  invalidEnvironment.storage.set("scriptify:displayStyle", "invalid");
  invalidEnvironment.storage.set("scriptify:fontSizeMultiplier", "9");
  const freshInterceptor = freshModule("lyricsInterceptor");
  assert.equal(freshInterceptor.loadSavedMode(), "original");
  assert.equal(freshInterceptor.loadSavedDisplayStyle(), "dual-line");
  assert.equal(freshInterceptor.loadSavedFontSize(), 1);
  freshInterceptor.destroyLyricsInterceptor();
});

test("scrollToCurrentLine uses active lyric markers and has a safe no-lyrics result", () => {
  installInterceptorEnvironment("scroll", async () => lyricsResponse([]));
  const scrollCalls = [];
  const lines = [
    {
      getAttribute: () => null,
      className: "lyrics-line",
      scrollIntoView: (options) => scrollCalls.push(options),
    },
    {
      getAttribute: (name) => (name === "aria-current" ? "true" : null),
      className: "lyrics-line",
      scrollIntoView: (options) => scrollCalls.push(options),
    },
  ];
  global.document.querySelectorAll = () => lines;
  const interceptor = freshModule("lyricsInterceptor");
  assert.equal(interceptor.scrollToCurrentLine(), true);
  assert.deepEqual(scrollCalls, [{ behavior: "smooth", block: "center" }]);

  global.document.querySelectorAll = () => [];
  assert.equal(interceptor.scrollToCurrentLine(), false);
  interceptor.destroyLyricsInterceptor();
});

test("runtime styles inject once and remove cleanly", () => {
  const styles = new Map();
  let appendCount = 0;
  global.document = {
    getElementById: (id) => styles.get(id) ?? null,
    createElement: () => {
      const element = {
        id: "",
        textContent: "",
        remove() {
          styles.delete(this.id);
        },
      };
      return element;
    },
    head: {
      appendChild: (element) => {
        appendCount++;
        styles.set(element.id, element);
      },
    },
  };
  const { injectStyles, removeStyles } = freshModule("styles");
  injectStyles();
  injectStyles();
  assert.equal(appendCount, 1);
  assert.match(styles.get("scriptify-styles").textContent, /scriptify-romanized/);
  assert.match(styles.get("scriptify-styles").textContent, /scriptify-original/);
  removeStyles();
  assert.equal(styles.has("scriptify-styles"), false);
});
