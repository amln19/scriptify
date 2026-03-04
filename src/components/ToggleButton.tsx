/**
 * Scriptify Settings Panel
 *
 * A modal settings panel for viewing and switching the current lyrics mode.
 * Triggered from the playbar button via right-click or from Spicetify.PopupModal.
 */

import { LyricsMode } from "../types";
import { getCurrentMode, setMode } from "../services/lyricsInterceptor";

/**
 * Create a settings panel as a DOM element.
 * Used with Spicetify.PopupModal.display() or as a standalone overlay.
 */
function createSettingsElement(): HTMLElement {
  const container = document.createElement("div");
  container.style.cssText = "padding: 8px 0;";

  const currentMode = getCurrentMode();

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
      Spicetify.showNotification(`Scriptify: ${label}`, false, 1500);
      // Update active state
      modeButtons.querySelectorAll(".scriptify-mode-btn").forEach((b) => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
    });
    modeButtons.appendChild(btn);
  }

  modeSection.appendChild(modeButtons);
  container.appendChild(modeSection);

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
