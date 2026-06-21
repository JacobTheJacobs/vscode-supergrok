import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const helperSrc = read("../media/webview/helpers.js");
const appSrc = read("../media/webview/app.js");

export const BODY = `
  <header class="top-bar">
    <div class="top-brand" aria-label="Grok CLI Copilot">
      <div class="top-brand-copy">
        <span class="top-brand-title">Grok CLI Copilot</span>
        <span class="top-brand-status">CLI agent</span>
      </div>
    </div>
    <div class="top-actions">
      <button id="history-btn"></button>
      <button id="new-btn"></button>
    </div>
    <div id="history-popover" hidden></div>
  </header>
  <main id="messages" class="messages">
    <div class="welcome" id="welcome">
      <p id="welcome-version" class="loading-dots">Starting</p>
      <div id="welcome-onboarding"></div>
    </div>
  </main>
  <footer class="composer">
    <div class="composer-input-wrap">
      <div id="attach-previews" hidden></div>
      <textarea id="input"></textarea>
    </div>
    <button id="add-btn"></button>
    <button id="slash-btn"></button>
    <div id="donut"><svg><circle id="donut-arc"/></svg><span id="donut-label"></span></div>
    <div id="chips"></div>
    <button id="mode-btn"></button>
    <button id="send-btn"></button>
    <div id="mode-popover" hidden></div>
    <div id="settings-popover" hidden></div>
    <div id="add-popover" hidden></div>
    <div id="context-popover" hidden></div>
    <div id="slash-popover" hidden></div>
  </footer>`;

export interface Posted { type: string; [k: string]: unknown }

export interface Harness {
  window: Window;
  posted: Posted[];
  doc: Document;
}

export function bootWebview(): Harness {
  const window = new Window({ url: "https://localhost/" });
  const posted: Posted[] = [];
  (window as any).acquireVsCodeApi = () => ({
    postMessage: (m: Posted) => posted.push(m),
    setState: () => {},
    getState: () => undefined,
  });
  const doc = (window as any).document as Document;
  doc.body.innerHTML = BODY;
  (window as any).eval(helperSrc);
  (window as any).eval(appSrc);
  posted.length = 0;
  return { window, posted, doc };
}

export function dispatch(window: Window, data: Posted): void {
  (window as any).dispatchEvent(new (window as any).MessageEvent("message", { data }));
}

export function click(window: Window, el: Element): void {
  el.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true, cancelable: true }));
}
