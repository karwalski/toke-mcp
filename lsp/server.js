#!/usr/bin/env node

/**
 * toke-lsp — Language Server Protocol implementation for Toke.
 *
 * Wraps the tkc compiler to provide:
 *   - Diagnostics via `tkc --check --diag-json`
 *   - Hover via `tkc --emit-interface` + keyword descriptions
 *   - Document symbols via `tkc --emit-interface`
 *
 * Story: 10.12.20
 */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  SymbolKind,
} from 'vscode-languageserver/node.js';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/* ── Connection + document manager ────────────────────────────────── */

const connection = createConnection(ProposedFeatures.all);
const documents  = new TextDocuments(TextDocument);

/* ── Configuration defaults ───────────────────────────────────────── */

let tkcPath    = 'tkc';
let tkcStdlib  = '';

/* ── Keyword descriptions for hover ───────────────────────────────── */

const KEYWORD_INFO = {
  M:     'M — module declaration. Declares the module name for this file.',
  F:     'F — function declaration. Defines a named function.',
  T:     'T — struct declaration. Defines a named struct type.',
  I:     'I — import declaration. Imports a module by alias.',
  let:   'let — immutable binding. Binds a value that cannot be reassigned.',
  mut:   'mut — mutable binding. Binds a value that can be reassigned.',
  lp:    'lp — loop. Repeats the body until broken.',
  if:    'if — conditional. Executes the body when the condition is true.',
  el:    'el — else branch. Executes when the preceding if-condition is false.',
  match: 'match — pattern match. Dispatches on the value of an expression.',
  as:    'as — type cast. Converts a value to a different type.',
  rt:    'rt — return. Returns a value from the enclosing function.',
};

/* ── Helpers ──────────────────────────────────────────────────────── */

/** Create a unique temp file path with .tk extension. */
function tmpFile() {
  const name = `toke-lsp-${randomBytes(6).toString('hex')}.tk`;
  return join(tmpdir(), name);
}

/** Run tkc with the given args, resolve with { stdout, stderr, code }. */
function runTkc(args) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (tkcStdlib) env.TKC_STDLIB = tkcStdlib;

    execFile(tkcPath, args, { env, timeout: 10000 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code:   err ? (err.code === 'ENOENT' ? -1 : (err.status ?? 1)) : 0,
      });
    });
  });
}

/* ── Diagnostics ──────────────────────────────────────────────────── */

/** Map tkc error code prefix to LSP severity. */
function codeSeverity(errorCode) {
  if (!errorCode) return DiagnosticSeverity.Error;
  const c = errorCode.charAt(0);
  if (c === 'W') return DiagnosticSeverity.Warning;
  return DiagnosticSeverity.Error;
}

/** Map tkc error code to a human-readable source string. */
function codeSource(errorCode) {
  if (!errorCode) return 'tkc';
  const num = parseInt(errorCode.slice(1), 10);
  if (num >= 1000 && num <= 1999) return 'tkc/lexer';
  if (num >= 2000 && num <= 2999) return 'tkc/parser';
  if (num >= 3000 && num <= 3999) return 'tkc/name';
  if (num >= 4000 && num <= 4999) return 'tkc/type';
  if (num >= 9000 && num <= 9999) return 'tkc/limit';
  return 'tkc';
}

/** Parse one line of JSON diagnostic from tkc stderr. */
function parseDiagLine(line) {
  try {
    const d = JSON.parse(line);
    const ln   = Math.max((d.pos?.line ?? 1) - 1, 0);
    const col  = Math.max((d.pos?.col  ?? 1) - 1, 0);
    return {
      severity: codeSeverity(d.error_code),
      range: {
        start: { line: ln, character: col },
        end:   { line: ln, character: col },
      },
      message: d.message || 'unknown error',
      code:    d.error_code || undefined,
      source:  codeSource(d.error_code),
    };
  } catch {
    return null;
  }
}

const pendingDiag = new Map();   // uri -> timeout id
const DEBOUNCE_MS = 300;

function scheduleDiagnostics(doc) {
  const uri = doc.uri;
  if (pendingDiag.has(uri)) clearTimeout(pendingDiag.get(uri));
  pendingDiag.set(uri, setTimeout(() => {
    pendingDiag.delete(uri);
    runDiagnostics(doc);
  }, DEBOUNCE_MS));
}

async function runDiagnostics(doc) {
  const tmp = tmpFile();
  try {
    writeFileSync(tmp, doc.getText(), 'utf8');
    const { stderr, code } = await runTkc(['--check', '--diag-json', tmp]);

    if (code === -1) {
      /* tkc binary not found — send a single informational diagnostic */
      connection.sendDiagnostics({
        uri: doc.uri,
        diagnostics: [{
          severity: DiagnosticSeverity.Warning,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          message: `tkc binary not found at '${tkcPath}'. Configure toke.tkc.path.`,
          source: 'toke-lsp',
        }],
      });
      return;
    }

    const diagnostics = stderr
      .split('\n')
      .filter(Boolean)
      .map(parseDiagLine)
      .filter(Boolean);

    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/* ── Hover ────────────────────────────────────────────────────────── */

/** Cache of interface data per URI. Refreshed alongside diagnostics. */
const ifaceCache = new Map();   // uri -> { version, exports }

async function getInterface(doc) {
  const cached = ifaceCache.get(doc.uri);
  if (cached && cached.version === doc.version) return cached.exports;

  const tmp = tmpFile();
  const tkiPath = tmp.replace(/\.tk$/, '.tki');
  try {
    writeFileSync(tmp, doc.getText(), 'utf8');
    const { code } = await runTkc(['--check', '--emit-interface', '--out', tkiPath, tmp]);
    if (code !== 0 && code !== -1) {
      /* Compilation errors — no interface available */
      ifaceCache.set(doc.uri, { version: doc.version, exports: null });
      return null;
    }
    try {
      const raw = readFileSync(tkiPath, 'utf8');
      const iface = JSON.parse(raw);
      ifaceCache.set(doc.uri, { version: doc.version, exports: iface.exports || [] });
      return iface.exports || [];
    } catch {
      ifaceCache.set(doc.uri, { version: doc.version, exports: null });
      return null;
    }
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    try { unlinkSync(tkiPath); } catch { /* ignore */ }
  }
}

/** Get the word at a position in a document. */
function wordAt(doc, position) {
  const text = doc.getText();
  const off  = doc.offsetAt(position);
  const idRe = /[A-Za-z_0-9]/;
  let start = off, end = off;
  while (start > 0 && idRe.test(text[start - 1])) start--;
  while (end < text.length && idRe.test(text[end])) end++;
  return text.slice(start, end);
}

connection.onHover(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const word = wordAt(doc, params.position);
  if (!word) return null;

  /* Check keywords first */
  if (KEYWORD_INFO[word]) {
    return { contents: { kind: 'plaintext', value: KEYWORD_INFO[word] } };
  }

  /* Look up in interface exports */
  const exports = await getInterface(doc);
  if (!exports) return null;

  for (const exp of exports) {
    if (exp.name !== word) continue;
    if (exp.kind === 'func') {
      const params_str = (exp.params || []).join(', ');
      const ret = exp.return || 'void';
      const ext = exp.extern ? ' (extern)' : '';
      return {
        contents: {
          kind: 'plaintext',
          value: `F ${word}(${params_str}) -> ${ret}${ext}`,
        },
      };
    }
    if (exp.kind === 'type') {
      const fields = (exp.fields || [])
        .map((f) => `  ${f.name}: ${f.type}`)
        .join('\n');
      return {
        contents: {
          kind: 'plaintext',
          value: `T ${word}\n${fields}`,
        },
      };
    }
    if (exp.kind === 'const') {
      return {
        contents: {
          kind: 'plaintext',
          value: `let ${word}: ${exp.type || 'unknown'}`,
        },
      };
    }
  }

  return null;
});

/* ── Document Symbols ─────────────────────────────────────────────── */

function exportKindToSymbolKind(kind) {
  switch (kind) {
    case 'func':  return SymbolKind.Function;
    case 'type':  return SymbolKind.Struct;
    case 'const': return SymbolKind.Variable;
    default:      return SymbolKind.Variable;
  }
}

connection.onDocumentSymbol(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const exports = await getInterface(doc);
  if (!exports) return [];

  return exports.map((exp) => ({
    name: exp.name,
    kind: exportKindToSymbolKind(exp.kind),
    location: {
      uri: doc.uri,
      range: {
        start: { line: 0, character: 0 },
        end:   { line: 0, character: 0 },
      },
    },
  }));
});

/* ── Lifecycle ────────────────────────────────────────────────────── */

connection.onInitialize((params) => {
  /* Read configuration from initializationOptions if provided */
  const opts = params.initializationOptions || {};
  if (opts.tkcPath)   tkcPath   = opts.tkcPath;
  if (opts.tkcStdlib) tkcStdlib = opts.tkcStdlib;

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      hoverProvider: true,
      documentSymbolProvider: true,
    },
  };
});

connection.onInitialized(() => {
  connection.console.log('toke-lsp: initialized');
});

/* Re-read config when the client signals a change */
connection.onDidChangeConfiguration((change) => {
  const settings = change.settings?.toke?.tkc || {};
  if (settings.path)   tkcPath   = settings.path;
  if (settings.stdlib) tkcStdlib = settings.stdlib;

  /* Re-run diagnostics on all open documents */
  for (const doc of documents.all()) {
    scheduleDiagnostics(doc);
  }
});

/* Trigger diagnostics on open / change / save */
documents.onDidOpen((e)        => scheduleDiagnostics(e.document));
documents.onDidChangeContent((e) => scheduleDiagnostics(e.document));
documents.onDidSave((e)        => scheduleDiagnostics(e.document));

/* Clean up when a document is closed */
documents.onDidClose((e) => {
  const uri = e.document.uri;
  if (pendingDiag.has(uri)) {
    clearTimeout(pendingDiag.get(uri));
    pendingDiag.delete(uri);
  }
  ifaceCache.delete(uri);
  connection.sendDiagnostics({ uri, diagnostics: [] });
});

/* Start listening */
documents.listen(connection);
connection.listen();
