/**
 * Ask for a Marketplace review — once, from people who actually use the thing.
 *
 * The rules here exist because review nags are the most hated pattern in
 * extensions, and a badly timed one costs more goodwill than the review is
 * worth:
 *   - only after sustained real use, not on install
 *   - only after a turn that succeeded
 *   - once per machine, ever, whatever the answer
 *   - "Not now" means never asked again, not asked next week
 */

import * as vscode from "vscode";

const TURNS_KEY = "grok.completedTurns";
const ASKED_KEY = "grok.reviewAsked";

/** Enough turns that the user has formed an opinion worth writing down. */
const TURNS_BEFORE_ASKING = 25;

const REVIEW_URL =
  "https://marketplace.visualstudio.com/items?itemName=jacobthejacobs.grok-cli-copilot&ssr=false#review-details";
const ISSUES_URL = "https://github.com/JacobTheJacobs/vscode-supergrok/issues/new";

/**
 * In-process latch. globalState.update() is a Thenable and the new value is not
 * guaranteed readable until it resolves, so the persisted flag alone does not
 * stop two turns that finish in the same tick from both asking — and every open
 * session has its own promptComplete listener. This closes synchronously.
 */
let askedThisProcess = false;

/**
 * Record a completed turn and, at the threshold, ask once.
 * Never throws and never blocks the turn it was called from.
 */
export function noteCompletedTurn(context: vscode.ExtensionContext): void {
  try {
    if (askedThisProcess) return;
    if (context.globalState.get<boolean>(ASKED_KEY)) return;

    const turns = (context.globalState.get<number>(TURNS_KEY) ?? 0) + 1;
    swallow(context.globalState.update(TURNS_KEY, turns));
    if (turns < TURNS_BEFORE_ASKING) return;

    // Latch before any await so concurrent callers cannot get past this line.
    askedThisProcess = true;
    swallow(context.globalState.update(ASKED_KEY, true));
    void ask(context);
  } catch {
    // Counting reviews is never worth breaking a session over.
  }
}

/** Storage can fail; a rejected write must not surface as an unhandled error. */
function swallow(p: Thenable<unknown> | undefined): void {
  Promise.resolve(p).catch(() => undefined);
}

async function ask(context: vscode.ExtensionContext): Promise<void> {
  // Offer the honest alternative too: someone who is unhappy should be able to
  // say so somewhere useful rather than be funnelled into a public rating.
  const choice = await vscode.window.showInformationMessage(
    "Getting use out of Grok CLI Copilot? A short Marketplace review helps other people find it.",
    "Write a review",
    "Report a problem",
    "No thanks"
  );

  if (choice === "Write a review") {
    void vscode.env.openExternal(vscode.Uri.parse(REVIEW_URL));
  } else if (choice === "Report a problem") {
    void vscode.env.openExternal(vscode.Uri.parse(ISSUES_URL));
  }
}

/** Test seam: clears the persisted counters and the in-process latch. */
export function _reset(context: vscode.ExtensionContext): void {
  askedThisProcess = false;
  swallow(context.globalState.update(TURNS_KEY, 0));
  swallow(context.globalState.update(ASKED_KEY, false));
}

export const _internals = { TURNS_KEY, ASKED_KEY, TURNS_BEFORE_ASKING, REVIEW_URL };
