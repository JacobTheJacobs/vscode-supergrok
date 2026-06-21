import * as vscode from "vscode";
import { GrokSidebar } from "./sidebar-provider";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Grok CLI Copilot");
  const sidebar = new GrokSidebar(context, output);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GrokSidebar.viewId, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    output,
    { dispose: () => sidebar.dispose() },
    vscode.commands.registerCommand("superGrok.open", () =>
      vscode.commands.executeCommand("workbench.view.extension.superGrokSidebar"),
    ),
    vscode.commands.registerCommand("superGrok.newSession", () => sidebar.newSession()),
    vscode.commands.registerCommand("superGrok.compact", () => {
      vscode.window.showInformationMessage(
        "Type /compact in the composer to compress the conversation.",
      );
    }),
    vscode.commands.registerCommand("superGrok.pickModel", () => sidebar.pickModel()),
    vscode.commands.registerCommand("superGrok.toggleMode", () => sidebar.openModePopover()),
    vscode.commands.registerCommand("superGrok.sendSelection", () =>
      sidebar.insertActiveMention({ selection: true }),
    ),
    vscode.commands.registerCommand(
      "superGrok.sendFile",
      (uri?: vscode.Uri) => sidebar.insertActiveMention({ uri }),
    ),
    vscode.commands.registerCommand("superGrok.insertAtMention", () =>
      sidebar.insertActiveMention(),
    ),
    vscode.commands.registerCommand("superGrok.showLogs", () => output.show()),
    vscode.commands.registerCommand("superGrok.logout", () => sidebar.logout()),
    vscode.commands.registerCommand("superGrok._debugDummyPlan", () => sidebar.debugShowDummyPlan()),
  );
}

export function deactivate(): void {
}
