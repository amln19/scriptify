/**
 * Scriptify — Main Entry Point
 *
 * A Spicetify extension that adds a toggle to Spotify's lyrics view
 * for switching between Original and Romanized lyrics.
 *
 * Architecture (v3):
 * 1. Wait for Spicetify APIs to be fully loaded
 * 2. Inject CSS styles
 * 3. Initialize the lyrics interceptor (Spotify API + DOM processing)
 * 4. Register a Spicetify.Playbar.Button in the bottom-right now-playing bar
 *    (next to the lyrics/queue/volume controls)
 * 5. Right-click opens settings panel
 * 6. Restore saved user preferences (mode)
 */

import { LyricsMode } from "./types";
import { injectStyles, removeStyles } from "./components/styles";
import { showSettings } from "./components/ToggleButton";
import {
  initLyricsInterceptor,
  loadSavedMode,
  setMode,
  cycleMode,
  getCurrentMode,
  onModeChange,
  onLyricsAvailabilityChange,
  checkInitialLyricsAvailability,
  destroyLyricsInterceptor,
} from "./services/lyricsInterceptor";

// ─── SVG Icons ────────────────────────────────────────────────────────────────

/** SVG icon for the playbar button — a stylized script/language icon */
const SCRIPTIFY_ICON_SVG = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 3.5C2 2.67 2.67 2 3.5 2H6.5C7.33 2 8 2.67 8 3.5V4H6.5V3.5H3.5V7H5.5V8.5H3.5V12.5H6.5V12H8V12.5C8 13.33 7.33 14 6.5 14H3.5C2.67 14 2 13.33 2 12.5V3.5ZM9 6H14V7.5H12.25L13.75 12H14V13.5H12.25L11.5 11.25L10.75 13.5H9V12H9.25L10.75 7.5H9V6Z"/>
</svg>`;

const MODE_LABELS: Record<LyricsMode, string> = {
  [LyricsMode.Original]: "Original",
  [LyricsMode.Romanized]: "Romanized",
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function waitForSpicetify(): Promise<void> {
  const MAX_WAIT = 30_000;
  const INTERVAL = 300;
  let waited = 0;

  while (waited < MAX_WAIT) {
    if (
      typeof Spicetify !== "undefined" &&
      Spicetify.React &&
      Spicetify.ReactDOM &&
      Spicetify.Player &&
      Spicetify.Platform
    ) {
      return;
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
    waited += INTERVAL;
  }

  throw new Error("[Scriptify] Timed out waiting for Spicetify APIs");
}

// ─── Playbar Button (bottom-right, next to lyrics/queue/volume) ───────────────

let playbarButton: any = null;

/**
 * Create and register a Spicetify.Playbar.Button.
 * Left-click cycles modes, right-click opens settings.
 * The `active` property gives it a "toggled on" highlight, which
 * we set whenever a non-Original mode is active.
 */
function registerPlaybarButton(): void {
  try {
    const mode = getCurrentMode();
    const label = `Scriptify: ${MODE_LABELS[mode]}`;
    const isActive = mode !== LyricsMode.Original;

    playbarButton = new Spicetify.Playbar.Button(
      label,
      SCRIPTIFY_ICON_SVG,
      async () => {
        if (!lyricsAvailableForTrack) return;
        try {
          const newMode = await cycleMode();
          Spicetify.showNotification(
            `Scriptify: ${MODE_LABELS[newMode]}`,
            false,
            1500,
          );
          updatePlaybarButton(newMode);
        } catch (e) {
          console.warn("[Scriptify] Mode cycle failed:", e);
        }
      },
      false, // disabled
      isActive, // active
    );

    // Right-click → settings
    if (playbarButton?.element) {
      playbarButton.element.addEventListener("contextmenu", (e: Event) => {
        e.preventDefault();
        showSettings();
      });
      playbarButton.element.classList.add("scriptify-playbar-btn");
    }

    console.log("[Scriptify] Playbar button registered");
  } catch (e) {
    console.error("[Scriptify] Failed to register Playbar.Button:", e);
    console.log("[Scriptify] Falling back to keyboard shortcut only");
  }
}

/**
 * Update the playbar button tooltip and active state for the current mode.
 */
let lyricsAvailableForTrack = true;

function updatePlaybarButton(mode: LyricsMode): void {
  if (!playbarButton) return;
  try {
    playbarButton.label = `Scriptify: ${MODE_LABELS[mode]}`;
    playbarButton.active = mode !== LyricsMode.Original;
  } catch {}
}

function setPlaybarButtonDisabled(disabled: boolean): void {
  if (!playbarButton) return;
  lyricsAvailableForTrack = !disabled;
  try {
    if (disabled) {
      // No lyrics: gray out and hide the active dot
      playbarButton.active = false;
      if (playbarButton.element) {
        playbarButton.element.classList.add("scriptify-disabled");
      }
    } else {
      // Lyrics available: restore correct active state and remove gray
      const mode = getCurrentMode();
      playbarButton.active = mode !== LyricsMode.Original;
      if (playbarButton.element) {
        playbarButton.element.classList.remove("scriptify-disabled");
      }
    }
  } catch {}
}

// ─── Keyboard Shortcut ───────────────────────────────────────────────────────

function registerKeyboardShortcut(): void {
  document.addEventListener("keydown", async (e) => {
    // Ctrl/Cmd + Shift + L to cycle modes
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "L") {
      e.preventDefault();
      try {
        const newMode = await cycleMode();
        Spicetify.showNotification(
          `Scriptify: ${MODE_LABELS[newMode]}`,
          false,
          1500,
        );
        updatePlaybarButton(newMode);
      } catch (err) {
        console.warn("[Scriptify] Keyboard shortcut failed:", err);
      }
    }
    // Ctrl/Cmd + Shift + ; to open settings
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === ";") {
      e.preventDefault();
      showSettings();
    }
  });
}

// ─── Startup Lyrics Pane Close ────────────────────────────────────────────────
//
// If Spotify restarts with the lyrics pane already open, our MutationObserver
// can interfere with React's DOM ownership and make the native lyrics toggle
// unresponsive. Closing the pane once on startup avoids this issue — the user
// can reopen it cleanly and everything works.

function closeLyricsPaneOnStartup(): void {
  const btn = document.querySelector(
    'button[data-testid="lyrics-button"]',
  ) as HTMLButtonElement | null;

  if (btn?.getAttribute("aria-pressed") === "true") {
    btn.click();
    console.log("[Scriptify] Closed lyrics pane on startup");
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    console.log("[Scriptify] Initializing...");

    await waitForSpicetify();
    console.log("[Scriptify] Spicetify APIs ready");

    // Inject styles
    injectStyles();

    // Load saved preferences
    const savedMode = loadSavedMode();

    // Initialize lyrics processing pipeline
    await initLyricsInterceptor();

    // Restore saved mode
    if (savedMode && savedMode !== LyricsMode.Original) {
      await setMode(savedMode);
    }

    // Register the Playbar button (bottom-right, next to lyrics button)
    registerPlaybarButton();

    // Register keyboard shortcut (secondary UI)
    registerKeyboardShortcut();

    // Listen for mode changes to update the button
    onModeChange((mode) => {
      updatePlaybarButton(mode);
    });

    // Listen for lyrics availability changes to gray out button
    onLyricsAvailabilityChange((available) => {
      setPlaybarButtonDisabled(!available);
    });

    // Check availability for the initial track
    await checkInitialLyricsAvailability();

    console.log(
      "[Scriptify] Ready! Click the Scriptify button in the playbar to cycle lyrics modes.",
    );
    console.log(
      "[Scriptify] Keyboard: Ctrl+Shift+L to cycle, Ctrl+Shift+; for settings",
    );

    // Close lyrics pane if it was left open from a previous session
    closeLyricsPaneOnStartup();
  } catch (e) {
    console.error("[Scriptify] Initialization failed:", e);
  }
}

// Start the extension
main();

// Export cleanup for hot-reload support
(window as any).__scriptify_cleanup = () => {
  if (playbarButton?.deregister) {
    playbarButton.deregister();
  }
  removeStyles();
  destroyLyricsInterceptor();
  console.log("[Scriptify] Cleaned up");
};
