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
 * Record a completed turn and, at the threshold, ask once.
 * Never throws and never blocks the turn it was called from.
 */
export function noteCompletedTurn(context: vscode.ExtensionContext): void {
  try {
    if (context.globalState.get<boolean>(ASKED_KEY)) return;

    const turns = (context.globalState.get<number>(TURNS_KEY) ?? 0) + 1;
    void context.globalState.update(TURNS_KEY, turns);
    if (turns < TURNS_BEFORE_ASKING) return;

    void context.globalState.update(ASKED_KEY, true);
    void ask(context);
  } catch {
    // Counting reviews is never worth breaking a session over.
  }
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

/** Test seam: lets a test drive the threshold without 25 real turns. */
export function _reset(context: vscode.ExtensionContext): void {
  void context.globalState.update(TURNS_KEY, 0);
  void context.globalState.update(ASKED_KEY, false);
}

export const _internals = { TURNS_KEY, ASKED_KEY, TURNS_BEFORE_ASKING, REVIEW_URL };
