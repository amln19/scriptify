/**
 * Scriptify Settings Panel
 *
 * A modal settings panel for viewing and switching the current lyrics mode,
 * display style, and romanization font size.
 * Triggered from the playbar button via right-click or from Spicetify.PopupModal.
 */

import { LyricsMode, DisplayStyle } from "../types";
import {
  getCurrentMode,
  setMode,
  getDisplayStyle,
  setDisplayStyle,
  getRomanizedFontSizeMultiplier,
  setRomanizedFontSize,
} from "../services/lyricsInterceptor";

/**
 * Create a settings panel as a DOM element.
 * Used with Spicetify.PopupModal.display() or as a standalone overlay.
 */
function createSettingsElement(): HTMLElement {
  const container = document.createElement("div");
  container.style.cssText = "padding: 8px 0;";

  const currentMode = getCurrentMode();
  const currentDisplayStyle = getDisplayStyle();
  const currentMultiplier = getRomanizedFontSizeMultiplier();
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent);
  const modKey = isMac ? "\u2318" : "Ctrl";
  const isOriginal = currentMode === LyricsMode.Original;

  // Helper to set disabled/enabled state on a settings section
  function setSectionDisabled(section: HTMLElement, disabled: boolean): void {
    section.style.opacity = disabled ? "0.35" : "1";
    section.style.pointerEvents = disabled ? "none" : "";
  }

  // ─── Mode Selector ───────────────────────────────────────────
  const modeSection = document.createElement("div");
  modeSection.className = "scriptify-settings-section";

  const modeLabel = document.createElement("p");
  modeLabel.className = "scriptify-settings-label";
  modeLabel.textContent = "Lyrics Mode";
  modeSection.appendChild(modeLabel);

  const modeButtons = document.createElement("div");
  modeButtons.className = "scriptify-mode-buttons";

  const modes = [
    { mode: LyricsMode.Original, label: "Original" },
    { mode: LyricsMode.Romanized, label: "Romanized" },
  ];

  for (const { mode, label } of modes) {
    const btn = document.createElement("button");
    btn.className = "scriptify-mode-btn";
    if (mode === currentMode) {
      btn.classList.add("active");
    }
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      await setMode(mode);
      modeButtons.querySelectorAll(".scriptify-mode-btn").forEach((b) => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      // Gray out / restore dependent sections
      const nowOriginal = mode === LyricsMode.Original;
      setSectionDisabled(styleSection, nowOriginal);
      setSectionDisabled(fontSizeSection, nowOriginal);
      // Also keep font size hidden if in replace mode
      if (!nowOriginal && getDisplayStyle() === DisplayStyle.ReplaceOnly) {
        fontSizeSection.style.display = "none";
      }
    });
    modeButtons.appendChild(btn);
  }

  modeSection.appendChild(modeButtons);
  container.appendChild(modeSection);

  // ─── Display Style ──────────────────────────────────────────
  const styleSection = document.createElement("div");
  styleSection.className = "scriptify-settings-section";
  setSectionDisabled(styleSection, isOriginal);

  const styleLabel = document.createElement("p");
  styleLabel.className = "scriptify-settings-label";
  styleLabel.textContent = "Display Style";
  styleSection.appendChild(styleLabel);

  const styleButtons = document.createElement("div");
  styleButtons.className = "scriptify-mode-buttons";

  const styles = [
    {
      style: DisplayStyle.DualLine,
      label: "Dual Line",
    },
    {
      style: DisplayStyle.ReplaceOnly,
      label: "Replace",
    },
  ];

  for (const { style, label } of styles) {
    const btn = document.createElement("button");
    btn.className = "scriptify-mode-btn";
    if (style === currentDisplayStyle) {
      btn.classList.add("active");
    }
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      await setDisplayStyle(style);
      styleButtons.querySelectorAll(".scriptify-mode-btn").forEach((b) => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      // Show/hide font size section depending on display style
      if (style === DisplayStyle.ReplaceOnly) {
        fontSizeSection.style.display = "none";
      } else {
        fontSizeSection.style.display = "";
        setSectionDisabled(fontSizeSection, false);
      }
    });
    styleButtons.appendChild(btn);
  }

  styleSection.appendChild(styleButtons);
  container.appendChild(styleSection);

  // ─── Font Size (Discrete Buttons) ──────────────────────────
  const fontSizeSection = document.createElement("div");
  fontSizeSection.className = "scriptify-settings-section";
  // Hide when in replace-only mode, gray out in original mode
  if (!isOriginal && currentDisplayStyle === DisplayStyle.ReplaceOnly) {
    fontSizeSection.style.display = "none";
  }
  setSectionDisabled(fontSizeSection, isOriginal);

  const fontSizeLabel = document.createElement("p");
  fontSizeLabel.className = "scriptify-settings-label";
  fontSizeLabel.textContent = "Romanization Size";
  fontSizeSection.appendChild(fontSizeLabel);

  const sizeButtons = document.createElement("div");
  sizeButtons.className = "scriptify-mode-buttons";

  const sizeOptions = [
    { multiplier: 0.5, label: "0.5x" },
    { multiplier: 0.75, label: "0.75x" },
    { multiplier: 1.0, label: "1x" },
    { multiplier: 1.25, label: "1.25x" },
    { multiplier: 1.5, label: "1.5x" },
  ];

  for (const { multiplier, label } of sizeOptions) {
    const btn = document.createElement("button");
    btn.className = "scriptify-mode-btn";
    if (Math.abs(multiplier - currentMultiplier) < 0.01) {
      btn.classList.add("active");
    }
    btn.textContent = label;
    btn.addEventListener("click", () => {
      setRomanizedFontSize(multiplier);
      sizeButtons.querySelectorAll(".scriptify-mode-btn").forEach((b) => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
    });
    sizeButtons.appendChild(btn);
  }

  fontSizeSection.appendChild(sizeButtons);
  container.appendChild(fontSizeSection);

  // ─── Keyboard Shortcuts ─────────────────────────────────────
  const shortcutsSection = document.createElement("div");
  shortcutsSection.className = "scriptify-settings-section";

  const shortcutsLabel = document.createElement("p");
  shortcutsLabel.className = "scriptify-settings-label";
  shortcutsLabel.textContent = "Keyboard Shortcuts";
  shortcutsSection.appendChild(shortcutsLabel);

  const shortcutsList = document.createElement("div");
  shortcutsList.className = "scriptify-shortcuts";

  const shortcuts = [
    { keys: [modKey, "Shift", "L"], desc: "Toggle lyrics mode" },
    { keys: [modKey, "Shift", ";"], desc: "Open settings" },
    { keys: [modKey, "Shift", "J"], desc: "Jump to current line" },
  ];

  for (const { keys, desc } of shortcuts) {
    const row = document.createElement("div");
    row.className = "scriptify-shortcut-row";

    const descEl = document.createElement("span");
    descEl.className = "scriptify-shortcut-desc";
    descEl.textContent = desc;
    row.appendChild(descEl);

    const keysEl = document.createElement("span");
    keysEl.className = "scriptify-shortcut-keys";
    for (const key of keys) {
      const kbd = document.createElement("kbd");
      kbd.className = "scriptify-kbd";
      kbd.textContent = key;
      keysEl.appendChild(kbd);
    }
    row.appendChild(keysEl);

    shortcutsList.appendChild(row);
  }

  shortcutsSection.appendChild(shortcutsList);
  container.appendChild(shortcutsSection);

  // ─── Info Text ──────────────────────────────────────────────
  const info = document.createElement("p");
  info.className = "scriptify-settings-info";
  info.textContent =
    "Click the Scriptify button in the playbar to toggle. Right-click for settings.";
  container.appendChild(info);

  return container;
}

/**
 * Show the settings panel using Spicetify.PopupModal.
 */
export function showSettings(): void {
  try {
    Spicetify.PopupModal.display({
      title: "Scriptify Settings",
      content: createSettingsElement(),
      isLarge: false,
    });
  } catch (e) {
    console.warn(
      "[Scriptify] PopupModal not available, using overlay fallback",
    );
    showSettingsOverlay();
  }
}

/**
 * Fallback overlay settings panel (if PopupModal is unavailable).
 */
function showSettingsOverlay(): void {
  // Remove existing overlay
  const existing = document.getElementById("scriptify-settings-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "scriptify-settings-overlay";
  overlay.className = "scriptify-settings-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const panel = document.createElement("div");
  panel.className = "scriptify-settings-panel";

  const title = document.createElement("h3");
  title.className = "scriptify-settings-title";
  title.textContent = "Scriptify Settings";
  panel.appendChild(title);

  panel.appendChild(createSettingsElement());

  const closeBtn = document.createElement("button");
  closeBtn.className = "scriptify-settings-close";
  closeBtn.textContent = "Done";
  closeBtn.addEventListener("click", () => overlay.remove());
  panel.appendChild(closeBtn);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}
