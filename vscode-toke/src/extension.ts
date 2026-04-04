import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "Toke";
  statusBarItem.tooltip = "Toke Language Support";
  context.subscriptions.push(statusBarItem);

  // Show/hide status bar based on active editor
  const updateStatusBar = () => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === "toke") {
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar)
  );
  updateStatusBar();

  // LSP client
  const config = vscode.workspace.getConfiguration("toke.lsp");
  const lspEnabled = config.get<boolean>("enabled", true);
  const lspPath = config.get<string>("path", "toke-lsp");

  if (!lspEnabled) {
    return;
  }

  const serverOptions: ServerOptions = {
    command: lspPath,
    args: [],
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "toke" }],
  };

  client = new LanguageClient(
    "tokeLsp",
    "Toke Language Server",
    serverOptions,
    clientOptions
  );

  client.start().catch((err) => {
    // LSP server not found is expected if toke-lsp is not installed yet
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("ENOENT")) {
      vscode.window.showWarningMessage(
        `Toke LSP failed to start: ${msg}`
      );
    }
  });

  context.subscriptions.push({
    dispose: () => {
      if (client) {
        client.stop();
      }
    },
  });
}

export function deactivate(): Thenable<void> | undefined {
  if (client) {
    return client.stop();
  }
  return undefined;
}
