const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildSync } = require("esbuild");

const buildDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "scriptify-regressions-"),
);

for (const entry of ["async", "lrclib", "lyricsInterceptor", "romanizer"]) {
  const source =
    entry === "async"
      ? "src/utils/async.ts"
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

test.after(() => fs.rmSync(buildDirectory, { recursive: true, force: true }));

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

  global.document = {
    documentElement: { style: { setProperty() {} } },
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

  return { intervals, listeners };
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

test("LRCLIB honors Retry-After once and parses repeated timestamps", async () => {
  const originalSetTimeout = global.setTimeout;
  const calls = [];
  global.setTimeout = (callback, delay) => {
    if (delay === 2_000) {
      queueMicrotask(callback);
      return 1;
    }
    return originalSetTimeout(callback, delay);
  };
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
    const lines = await fetchLyrics({
      id: "rate-limit",
      uri: "spotify:track:rate-limit",
      name: "Track",
      artist: "Artist",
      album: "Album",
      duration: 180_000,
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.headers["Lrclib-Client"].startsWith("Scriptify v1.0"), true);
    assert.deepEqual(lines, [
      { startTimeMs: 1_200, text: "chorus" },
      { startTimeMs: 2_345, text: "chorus" },
    ]);
  } finally {
    global.setTimeout = originalSetTimeout;
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
