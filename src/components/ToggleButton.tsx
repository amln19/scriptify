/**
 * Scriptify Settings Panel
 *
 * A modal settings panel for configuring translation language and
 * viewing the current mode. Triggered from the playbar button via right-click
 * or from Spicetify.PopupModal.
 */

import { LyricsMode } from "../types";
import { getCurrentMode, setMode } from "../services/lyricsInterceptor";
import {
  getTargetLanguage,
  setTargetLanguage,
  clearTranslationCache,
} from "../services/translator";

const LANGUAGE_OPTIONS = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "bn", name: "Bengali" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "pa", name: "Punjabi" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "ar", name: "Arabic" },
  { code: "ru", name: "Russian" },
  { code: "it", name: "Italian" },
];

/**
 * Create a settings panel as a DOM element.
 * Used with Spicetify.PopupModal.display() or as a standalone overlay.
 */
function createSettingsElement(): HTMLElement {
  const container = document.createElement("div");
  container.style.cssText = "padding: 8px 0;";

  const currentMode = getCurrentMode();
  const currentLang = getTargetLanguage();

  // Mode selector section
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
    { mode: LyricsMode.Translated, label: "Translated" },
  ];

  for (const { mode, label } of modes) {
    const btn = document.createElement("button");
    btn.className = "scriptify-mode-btn";
    if (mode === currentMode) {
      btn.classList.add(
        mode === LyricsMode.Translated ? "translated-active" : "active",
      );
    }
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      await setMode(mode);
      Spicetify.showNotification(`Scriptify: ${label}`, false, 1500);
      // Update active state
      modeButtons.querySelectorAll(".scriptify-mode-btn").forEach((b) => {
        b.classList.remove("active", "translated-active");
      });
      btn.classList.add(
        mode === LyricsMode.Translated ? "translated-active" : "active",
      );
    });
    modeButtons.appendChild(btn);
  }

  modeSection.appendChild(modeButtons);
  container.appendChild(modeSection);

  // Language selector section
  const langSection = document.createElement("div");
  langSection.className = "scriptify-settings-section";

  const langLabel = document.createElement("p");
  langLabel.className = "scriptify-settings-label";
  langLabel.textContent = "Translation Language";
  langSection.appendChild(langLabel);

  const select = document.createElement("select");
  select.className = "scriptify-settings-select";
  select.value = currentLang;

  for (const lang of LANGUAGE_OPTIONS) {
    const option = document.createElement("option");
    option.value = lang.code;
    option.textContent = lang.name;
    if (lang.code === currentLang) option.selected = true;
    select.appendChild(option);
  }

  select.addEventListener("change", () => {
    setTargetLanguage(select.value);
    clearTranslationCache();
    if (getCurrentMode() === LyricsMode.Translated) {
      setMode(LyricsMode.Translated);
    }
  });

  langSection.appendChild(select);
  container.appendChild(langSection);

  // Info text
  const info = document.createElement("p");
  info.className = "scriptify-settings-info";
  info.textContent =
    "Click the Scriptify button in the playbar to cycle modes. Changes apply to visible lyrics immediately.";
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
