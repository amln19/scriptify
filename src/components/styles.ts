/**
 * CSS Styles for Scriptify Components
 *
 * Injected at runtime. Uses Spotify's CSS custom properties for native look.
 * The main toggle is via Spicetify.Playbar.Button — these styles are for the
 * settings panel and any overlay UI.
 */

export function injectStyles(): void {
  if (document.getElementById("scriptify-styles")) return;

  const style = document.createElement("style");
  style.id = "scriptify-styles";
  style.textContent = `
    /* ─── Playbar Button Styling ────────────────────────────────── */
    .scriptify-playbar-btn {
      position: relative;
    }

    .scriptify-playbar-btn.scriptify-disabled {
      opacity: 0.3;
      pointer-events: none;
    }

    /* ─── Settings Panel ────────────────────────────────────────── */
    .scriptify-settings-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(4px);
      animation: scriptify-fade-in 0.15s ease;
    }

    .scriptify-settings-panel {
      background: var(--background-elevated-base, #282828);
      border-radius: 12px;
      padding: 24px;
      width: 360px;
      max-width: 90vw;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      animation: scriptify-slide-up 0.2s ease;
    }

    .scriptify-settings-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-base, #ffffff);
      margin: 0 0 20px 0;
      font-family: var(--font-family, 'CircularSp', 'Helvetica Neue', Helvetica, Arial, sans-serif);
    }

    .scriptify-settings-section {
      margin-bottom: 16px;
    }

    .scriptify-settings-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-subdued, #a7a7a7);
      margin: 0 0 8px 0;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      font-family: var(--font-family, 'CircularSp', 'Helvetica Neue', Helvetica, Arial, sans-serif);
    }

    .scriptify-settings-select {
      width: 100%;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.07);
      color: var(--text-base, #ffffff);
      font-size: 14px;
      font-family: var(--font-family, 'CircularSp', 'Helvetica Neue', Helvetica, Arial, sans-serif);
      appearance: none;
      cursor: pointer;
      outline: none;
    }

    .scriptify-settings-select:focus {
      border-color: var(--text-bright-accent, #1db954);
    }

    .scriptify-mode-buttons {
      display: flex;
      gap: 8px;
    }

    .scriptify-mode-btn {
      flex: 1;
      padding: 10px 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-subdued, #a7a7a7);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: center;
      font-family: var(--font-family, 'CircularSp', 'Helvetica Neue', Helvetica, Arial, sans-serif);
    }

    .scriptify-mode-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-base, #ffffff);
    }

    .scriptify-mode-btn.active {
      background: rgba(29, 185, 84, 0.2);
      border-color: var(--text-bright-accent, #1db954);
      color: var(--text-bright-accent, #1db954);
    }

    .scriptify-settings-close {
      width: 100%;
      padding: 10px;
      border: none;
      border-radius: 500px;
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-base, #ffffff);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s ease;
      font-family: var(--font-family, 'CircularSp', 'Helvetica Neue', Helvetica, Arial, sans-serif);
      margin-top: 8px;
    }

    .scriptify-settings-close:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .scriptify-settings-info {
      font-size: 12px;
      color: var(--text-subdued, #a7a7a7);
      margin: 8px 0 0 0;
      line-height: 1.4;
      font-family: var(--font-family, 'CircularSp', 'Helvetica Neue', Helvetica, Arial, sans-serif);
    }

    /* ─── Dual-line Romanized Sub-element ───────────────────────── */
    .scriptify-romanized {
      font-size: var(--scriptify-font-size, 0.72em);
      opacity: 0;
      margin-top: 2px;
      letter-spacing: 0.01em;
      line-height: 1.3;
      /* Inherit parent color so Spotify's active/inactive transitions
         automatically apply to the romanized line too */
      color: currentColor;
      font-family: var(--font-family, 'CircularSp', 'Helvetica Neue', Helvetica, Arial, sans-serif);
      pointer-events: none;
      transition: opacity 0.3s ease, transform 0.3s ease;
      transform: translateY(-4px);
    }

    .scriptify-romanized.scriptify-visible {
      opacity: 0.65;
      transform: translateY(0);
    }

    /* ─── Replace-only Mode ─────────────────────────────────────── */
    /* Hides original text and promotes romanized to primary display */
    .scriptify-replace-line > *:not(.scriptify-romanized) {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
      padding: 0;
      margin: -1px;
    }

    .scriptify-replace-line > .scriptify-romanized {
      font-size: inherit;
      opacity: 1;
      margin-top: 0;
      transform: none;
      pointer-events: auto;
      transition: none;
    }

    /* ─── Keyboard Shortcuts Guide ──────────────────────────────── */
    .scriptify-shortcuts {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .scriptify-shortcut-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .scriptify-shortcut-desc {
      font-size: 12px;
      color: var(--text-subdued, #a7a7a7);
      font-family: var(--font-family, 'CircularSp', 'Helvetica Neue', Helvetica, Arial, sans-serif);
    }

    .scriptify-shortcut-keys {
      display: flex;
      gap: 3px;
    }

    .scriptify-kbd {
      display: inline-block;
      padding: 2px 6px;
      font-size: 10px;
      font-weight: 600;
      color: var(--text-base, #ffffff);
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      font-family: var(--font-family, 'CircularSp', 'Helvetica Neue', Helvetica, Arial, sans-serif);
    }

    /* ─── Animations ────────────────────────────────────────────── */
    @keyframes scriptify-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes scriptify-slide-up {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `;

  document.head.appendChild(style);
}

export function removeStyles(): void {
  const style = document.getElementById("scriptify-styles");
  if (style) style.remove();
}
