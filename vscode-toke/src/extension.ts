import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let statusBarItem: vscode.StatusBarItem;
let companionStatusItem: vscode.StatusBarItem;

/** Companion file extensions in priority order. */
const COMPANION_EXTS = [".tkc.md", ".tkc.yaml", ".tkc.json"];

/**
 * Find the companion file for a .tk source file.
 * Returns the URI if found, undefined otherwise.
 */
function findCompanion(tkUri: vscode.Uri): vscode.Uri | undefined {
  const tkPath = tkUri.fsPath;
  if (!tkPath.endsWith(".tk")) return undefined;
  const base = tkPath.slice(0, -3); // strip .tk
  for (const ext of COMPANION_EXTS) {
    const companionPath = base + ext;
    if (fs.existsSync(companionPath)) {
      return vscode.Uri.file(companionPath);
    }
  }
  return undefined;
}

/**
 * Open a companion file beside the current editor.
 */
async function openCompanionBeside(companionUri: vscode.Uri): Promise<void> {
  // Check if already open in a visible editor — don't open again
  const alreadyOpen = vscode.window.visibleTextEditors.some(
    (e) => e.document.uri.fsPath === companionUri.fsPath
  );
  if (alreadyOpen) return;

  await vscode.commands.executeCommand(
    "vscode.open",
    companionUri,
    vscode.ViewColumn.Beside
  );
}

/**
 * Update the companion status bar item based on the active editor.
 */
function updateCompanionStatus(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "toke") {
    companionStatusItem.hide();
    return;
  }

  const companion = findCompanion(editor.document.uri);
  if (companion) {
    const ext = COMPANION_EXTS.find((e) => companion.fsPath.endsWith(e)) || "";
    companionStatusItem.text = `$(file-symlink-file) companion: ${ext}`;
    companionStatusItem.tooltip = `Open companion file: ${path.basename(companion.fsPath)}`;
    companionStatusItem.command = "toke.openCompanion";
    companionStatusItem.color = undefined;
    companionStatusItem.show();
  } else {
    companionStatusItem.text = "$(file-symlink-file) no companion";
    companionStatusItem.tooltip = "No companion file found (.tkc.md, .tkc.yaml, .tkc.json)";
    companionStatusItem.command = undefined;
    companionStatusItem.color = new vscode.ThemeColor("disabledForeground");
    companionStatusItem.show();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  // ── Status bar: Toke indicator ──
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "Toke";
  statusBarItem.tooltip = "Toke Language Support";
  context.subscriptions.push(statusBarItem);

  // ── Status bar: Companion indicator ──
  companionStatusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  );
  context.subscriptions.push(companionStatusItem);

  // Show/hide status bar based on active editor
  const updateStatusBar = () => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === "toke") {
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
    updateCompanionStatus();
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar)
  );
  updateStatusBar();

  // ── Command: Open Companion File ──
  context.subscriptions.push(
    vscode.commands.registerCommand("toke.openCompanion", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "toke") {
        vscode.window.showInformationMessage("Open a .tk file first.");
        return;
      }
      const companion = findCompanion(editor.document.uri);
      if (companion) {
        try {
          await openCompanionBeside(companion);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Failed to open companion: ${msg}`);
        }
      } else {
        vscode.window.showInformationMessage(
          "No companion file found. Expected: .tkc.md, .tkc.yaml, or .tkc.json alongside the .tk file."
        );
      }
    })
  );

  // ── Auto-open companion on .tk file open ──
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId !== "toke") return;
      const config = vscode.workspace.getConfiguration("toke.companion");
      if (!config.get<boolean>("autoOpen", true)) return;

      const companion = findCompanion(doc.uri);
      if (companion) {
        // Small delay so the .tk file settles into its editor first
        setTimeout(() => openCompanionBeside(companion), 300);
      }
    })
  );

  // ── Watch for companion file creation/deletion ──
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.tkc.{md,yaml,json}");
  context.subscriptions.push(
    watcher.onDidCreate(() => updateCompanionStatus()),
    watcher.onDidDelete(() => updateCompanionStatus()),
    watcher
  );

  // ── LSP client ──
  const lspConfig = vscode.workspace.getConfiguration("toke.lsp");
  const lspEnabled = lspConfig.get<boolean>("enabled", true);
  const lspPath = lspConfig.get<string>("path", "toke-lsp");

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
