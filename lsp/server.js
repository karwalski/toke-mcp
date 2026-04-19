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
  CompletionItemKind,
} from 'vscode-languageserver/node.js';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/* ── Stdlib module + function documentation (71.4.3, 71.4.5) ───── */

const STDLIB_MODULES = [
  'str', 'math', 'file', 'env', 'time', 'crypto', 'process', 'log',
  'json', 'http', 'router', 'ws', 'sse', 'encoding', 'args', 'path',
  'toml', 'md', 'yaml', 'db', 'template', 'html', 'svg', 'canvas',
  'chart', 'image', 'auth', 'encrypt', 'dashboard', 'i18n', 'toon',
];

/** Map of module -> array of { name, signature, doc } */
const STDLIB_FUNCTIONS = {
  str: [
    { name: 'split',       signature: 'str.split(s $str, sep $str) -> [$str]',           doc: 'Split a string by separator, returning an array of substrings.' },
    { name: 'join',        signature: 'str.join(parts [$str], sep $str) -> $str',         doc: 'Join an array of strings with a separator.' },
    { name: 'trim',        signature: 'str.trim(s $str) -> $str',                         doc: 'Remove leading and trailing whitespace.' },
    { name: 'upper',       signature: 'str.upper(s $str) -> $str',                        doc: 'Convert all characters to uppercase.' },
    { name: 'lower',       signature: 'str.lower(s $str) -> $str',                        doc: 'Convert all characters to lowercase.' },
    { name: 'contains',    signature: 'str.contains(s $str, sub $str) -> $bool',          doc: 'Check whether a string contains a substring.' },
    { name: 'replace',     signature: 'str.replace(s $str, old $str, new $str) -> $str',  doc: 'Replace all occurrences of old with new.' },
    { name: 'starts_with', signature: 'str.starts_with(s $str, prefix $str) -> $bool',    doc: 'Check whether a string starts with prefix.' },
    { name: 'ends_with',   signature: 'str.ends_with(s $str, suffix $str) -> $bool',      doc: 'Check whether a string ends with suffix.' },
    { name: 'len',         signature: 'str.len(s $str) -> $int',                          doc: 'Return the length of a string in bytes.' },
    { name: 'slice',       signature: 'str.slice(s $str, start $int, end $int) -> $str',  doc: 'Return a substring from start to end index.' },
    { name: 'repeat',      signature: 'str.repeat(s $str, n $int) -> $str',               doc: 'Repeat a string n times.' },
    { name: 'pad_left',    signature: 'str.pad_left(s $str, width $int, ch $str) -> $str', doc: 'Pad a string on the left to reach width.' },
    { name: 'pad_right',   signature: 'str.pad_right(s $str, width $int, ch $str) -> $str', doc: 'Pad a string on the right to reach width.' },
  ],
  math: [
    { name: 'abs',    signature: 'math.abs(x $float) -> $float',                doc: 'Return the absolute value.' },
    { name: 'ceil',   signature: 'math.ceil(x $float) -> $int',                 doc: 'Round up to the nearest integer.' },
    { name: 'floor',  signature: 'math.floor(x $float) -> $int',                doc: 'Round down to the nearest integer.' },
    { name: 'round',  signature: 'math.round(x $float) -> $int',                doc: 'Round to the nearest integer.' },
    { name: 'sqrt',   signature: 'math.sqrt(x $float) -> $float',               doc: 'Return the square root.' },
    { name: 'pow',    signature: 'math.pow(base $float, exp $float) -> $float',  doc: 'Raise base to the power of exp.' },
    { name: 'min',    signature: 'math.min(a $float, b $float) -> $float',       doc: 'Return the smaller of two values.' },
    { name: 'max',    signature: 'math.max(a $float, b $float) -> $float',       doc: 'Return the larger of two values.' },
    { name: 'log',    signature: 'math.log(x $float) -> $float',                 doc: 'Return the natural logarithm.' },
    { name: 'sin',    signature: 'math.sin(x $float) -> $float',                 doc: 'Return the sine of x in radians.' },
    { name: 'cos',    signature: 'math.cos(x $float) -> $float',                 doc: 'Return the cosine of x in radians.' },
    { name: 'tan',    signature: 'math.tan(x $float) -> $float',                 doc: 'Return the tangent of x in radians.' },
    { name: 'random', signature: 'math.random() -> $float',                      doc: 'Return a random float between 0.0 and 1.0.' },
    { name: 'pi',     signature: 'math.pi -> $float',                            doc: 'The constant pi (3.14159...).' },
  ],
  file: [
    { name: 'read',      signature: 'file.read(path $str) -> $str',                     doc: 'Read entire file contents as a string.' },
    { name: 'write',     signature: 'file.write(path $str, data $str) -> $nil',          doc: 'Write a string to a file, creating or overwriting.' },
    { name: 'append',    signature: 'file.append(path $str, data $str) -> $nil',         doc: 'Append a string to the end of a file.' },
    { name: 'exists',    signature: 'file.exists(path $str) -> $bool',                   doc: 'Check whether a file or directory exists.' },
    { name: 'remove',    signature: 'file.remove(path $str) -> $nil',                    doc: 'Delete a file.' },
    { name: 'mkdir',     signature: 'file.mkdir(path $str) -> $nil',                     doc: 'Create a directory and any necessary parents.' },
    { name: 'readdir',   signature: 'file.readdir(path $str) -> [$str]',                 doc: 'List directory contents as an array of names.' },
    { name: 'stat',      signature: 'file.stat(path $str) -> FileInfo',                  doc: 'Return metadata about a file (size, modified time, etc.).' },
  ],
  env: [
    { name: 'get',    signature: 'env.get(key $str) -> $str',                doc: 'Get an environment variable value. Returns empty string if unset.' },
    { name: 'set',    signature: 'env.set(key $str, val $str) -> $nil',      doc: 'Set an environment variable.' },
    { name: 'has',    signature: 'env.has(key $str) -> $bool',               doc: 'Check whether an environment variable is set.' },
    { name: 'all',    signature: 'env.all() -> @($str: $str)',               doc: 'Return all environment variables as a map.' },
    { name: 'cwd',    signature: 'env.cwd() -> $str',                        doc: 'Return the current working directory.' },
    { name: 'home',   signature: 'env.home() -> $str',                       doc: 'Return the home directory path.' },
    { name: 'os',     signature: 'env.os() -> $str',                         doc: 'Return the operating system name (linux, darwin, windows).' },
    { name: 'arch',   signature: 'env.arch() -> $str',                       doc: 'Return the CPU architecture (arm64, x86_64).' },
  ],
  http: [
    { name: 'get',     signature: 'http.get(url $str) -> Response',                  doc: 'Send an HTTP GET request.' },
    { name: 'post',    signature: 'http.post(url $str, body $str) -> Response',       doc: 'Send an HTTP POST request with a body.' },
    { name: 'put',     signature: 'http.put(url $str, body $str) -> Response',        doc: 'Send an HTTP PUT request with a body.' },
    { name: 'delete',  signature: 'http.delete(url $str) -> Response',                doc: 'Send an HTTP DELETE request.' },
    { name: 'serve',   signature: 'http.serve(addr $str, handler F) -> $nil',         doc: 'Start an HTTP server listening on the given address.' },
    { name: 'listen',  signature: 'http.listen(port $int, handler F) -> $nil',        doc: 'Start an HTTP server on the given port.' },
  ],
  log: [
    { name: 'info',    signature: 'log.info(msg $str) -> $nil',    doc: 'Log an informational message.' },
    { name: 'warn',    signature: 'log.warn(msg $str) -> $nil',    doc: 'Log a warning message.' },
    { name: 'error',   signature: 'log.error(msg $str) -> $nil',   doc: 'Log an error message.' },
    { name: 'debug',   signature: 'log.debug(msg $str) -> $nil',   doc: 'Log a debug message.' },
    { name: 'fatal',   signature: 'log.fatal(msg $str) -> $nil',   doc: 'Log a fatal message and exit.' },
  ],
  json: [
    { name: 'parse',     signature: 'json.parse(s $str) -> any',        doc: 'Parse a JSON string into a value.' },
    { name: 'stringify',  signature: 'json.stringify(v any) -> $str',    doc: 'Serialize a value to a JSON string.' },
  ],
  time: [
    { name: 'now',    signature: 'time.now() -> $int',                     doc: 'Return current Unix timestamp in seconds.' },
    { name: 'sleep',  signature: 'time.sleep(ms $int) -> $nil',            doc: 'Sleep for the given number of milliseconds.' },
    { name: 'format', signature: 'time.format(ts $int, fmt $str) -> $str', doc: 'Format a Unix timestamp as a string.' },
  ],
  crypto: [
    { name: 'sha256',      signature: 'crypto.sha256(data $str) -> $str',             doc: 'Compute SHA-256 hash, returning hex string.' },
    { name: 'random_bytes', signature: 'crypto.random_bytes(n $int) -> $str',          doc: 'Generate n cryptographically random bytes as hex.' },
    { name: 'uuid',         signature: 'crypto.uuid() -> $str',                        doc: 'Generate a random UUID v4.' },
  ],
  process: [
    { name: 'exit',  signature: 'process.exit(code $int) -> $nil',                doc: 'Exit the process with the given status code.' },
    { name: 'args',  signature: 'process.args() -> [$str]',                        doc: 'Return command-line arguments.' },
    { name: 'exec',  signature: 'process.exec(cmd $str, args [$str]) -> ExecResult', doc: 'Execute a shell command and return its output.' },
    { name: 'pid',   signature: 'process.pid() -> $int',                            doc: 'Return the current process ID.' },
  ],
  path: [
    { name: 'join',     signature: 'path.join(parts ...$str) -> $str',   doc: 'Join path segments with the OS separator.' },
    { name: 'dirname',  signature: 'path.dirname(p $str) -> $str',       doc: 'Return the directory portion of a path.' },
    { name: 'basename', signature: 'path.basename(p $str) -> $str',      doc: 'Return the last component of a path.' },
    { name: 'ext',      signature: 'path.ext(p $str) -> $str',           doc: 'Return the file extension.' },
    { name: 'resolve',  signature: 'path.resolve(p $str) -> $str',       doc: 'Resolve a path to an absolute path.' },
  ],
};

/** Build a flat lookup: "module.func" -> { signature, doc } for hover. */
const STDLIB_HOVER = new Map();
for (const [mod, fns] of Object.entries(STDLIB_FUNCTIONS)) {
  for (const f of fns) {
    STDLIB_HOVER.set(`${mod}.${f.name}`, f);
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

  /* Check for stdlib module.function hover (71.4.5) */
  const line = doc.getText({
    start: { line: params.position.line, character: 0 },
    end:   { line: params.position.line, character: 9999 },
  });
  /* Find "module.func" around the cursor position */
  const col = params.position.character;
  const dotExpr = line.match(
    new RegExp(`\\b([a-z_][a-z_0-9]*)\\.([a-z_][a-z_0-9]*)\\b`, 'g'),
  );
  if (dotExpr) {
    for (const expr of dotExpr) {
      const idx = line.indexOf(expr);
      if (col >= idx && col <= idx + expr.length) {
        const info = STDLIB_HOVER.get(expr);
        if (info) {
          return {
            contents: {
              kind: 'markdown',
              value: `\`\`\`toke\n${info.signature}\n\`\`\`\n\n${info.doc}`,
            },
          };
        }
      }
    }
  }

  /* Check if the word itself is a stdlib module name */
  if (STDLIB_MODULES.includes(word)) {
    const fns = STDLIB_FUNCTIONS[word];
    const fnList = fns
      ? fns.map((f) => f.name).join(', ')
      : '(no function docs available)';
    return {
      contents: {
        kind: 'plaintext',
        value: `module ${word}\n\nFunctions: ${fnList}`,
      },
    };
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

/* ── Completion (71.4.3) ─────────────────────────────────────────── */

const TOKE_KEYWORDS = [
  'fn', 'let', 'mut', 'if', 'else', 'for', 'while', 'return',
  'import', 'type', 'match', 'true', 'false', 'nil',
];

const TYPE_SIGILS = ['$str', '$int', '$float', '$bool', '$nil'];

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const line = doc.getText({
    start: { line: params.position.line, character: 0 },
    end:   params.position,
  });

  /* ── Module function completions: "str." triggers str functions ── */
  const dotMatch = line.match(/\b([a-z_][a-z_0-9]*)\.([a-z_0-9]*)$/i);
  if (dotMatch) {
    const modName = dotMatch[1];
    const partial = dotMatch[2];
    const fns = STDLIB_FUNCTIONS[modName];
    if (fns) {
      return fns
        .filter((f) => f.name.startsWith(partial))
        .map((f) => ({
          label: f.name,
          kind: CompletionItemKind.Function,
          detail: f.signature,
          documentation: f.doc,
        }));
    }
    return [];
  }

  /* ── Import module completions: "I " or "import " ───────────── */
  const importMatch = line.match(/^\s*(?:I|import)\s+([a-z_]*)$/i);
  if (importMatch) {
    const partial = importMatch[1];
    return STDLIB_MODULES
      .filter((m) => m.startsWith(partial))
      .map((m) => ({
        label: m,
        kind: CompletionItemKind.Module,
        detail: `stdlib module: ${m}`,
      }));
  }

  /* ── Type sigil completions: "$" triggers type suggestions ──── */
  const sigilMatch = line.match(/\$([a-z]*)$/);
  if (sigilMatch) {
    const partial = '$' + sigilMatch[1];
    return TYPE_SIGILS
      .filter((t) => t.startsWith(partial))
      .map((t) => ({
        label: t,
        kind: CompletionItemKind.TypeParameter,
        detail: `type: ${t}`,
      }));
  }

  /* ── Keyword completions (default) ─────────────────────────── */
  const wordMatch = line.match(/\b([a-z]+)$/);
  const partial = wordMatch ? wordMatch[1] : '';
  return TOKE_KEYWORDS
    .filter((kw) => kw.startsWith(partial))
    .map((kw) => ({
      label: kw,
      kind: CompletionItemKind.Keyword,
      detail: `keyword: ${kw}`,
    }));
});

/* ── Go-to-definition (71.4.4) ───────────────────────────────────── */

connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const word = wordAt(doc, params.position);
  if (!word) return null;

  const text  = doc.getText();
  const lines = text.split('\n');

  /* Check the line at cursor for an import — resolve to .tki file */
  const curLine = lines[params.position.line] || '';
  const importMatch = curLine.match(/^\s*(?:I|import)\s+(\S+)/);
  if (importMatch && importMatch[1] === word) {
    /* Try to find the .tki interface file relative to the document */
    try {
      const docPath = fileURLToPath(doc.uri);
      const dir     = dirname(docPath);
      const tkiPath = join(dir, `${word}.tki`);
      if (existsSync(tkiPath)) {
        return {
          uri: `file://${tkiPath}`,
          range: {
            start: { line: 0, character: 0 },
            end:   { line: 0, character: 0 },
          },
        };
      }
      /* Also check stdlib path if configured */
      if (tkcStdlib) {
        const stdlibTki = join(tkcStdlib, `${word}.tki`);
        if (existsSync(stdlibTki)) {
          return {
            uri: `file://${stdlibTki}`,
            range: {
              start: { line: 0, character: 0 },
              end:   { line: 0, character: 0 },
            },
          };
        }
      }
    } catch { /* non-file URI — ignore */ }
    return null;
  }

  /* Search for function definitions: "F <name>" or "fn <name>" */
  for (let i = 0; i < lines.length; i++) {
    const fnMatch = lines[i].match(/^\s*(?:F|fn)\s+(\w+)/);
    if (fnMatch && fnMatch[1] === word) {
      const col = lines[i].indexOf(word);
      return {
        uri: doc.uri,
        range: {
          start: { line: i, character: col },
          end:   { line: i, character: col + word.length },
        },
      };
    }
  }

  /* Search for type definitions: "T <name>" or "type <name>" */
  for (let i = 0; i < lines.length; i++) {
    const typeMatch = lines[i].match(/^\s*(?:T|type)\s+(\w+)/);
    if (typeMatch && typeMatch[1] === word) {
      const col = lines[i].indexOf(word);
      return {
        uri: doc.uri,
        range: {
          start: { line: i, character: col },
          end:   { line: i, character: col + word.length },
        },
      };
    }
  }

  /* Search for let/mut bindings */
  for (let i = 0; i < lines.length; i++) {
    const bindMatch = lines[i].match(/^\s*(?:let|mut)\s+(\w+)/);
    if (bindMatch && bindMatch[1] === word) {
      const col = lines[i].indexOf(word);
      return {
        uri: doc.uri,
        range: {
          start: { line: i, character: col },
          end:   { line: i, character: col + word.length },
        },
      };
    }
  }

  return null;
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
      completionProvider: {
        triggerCharacters: ['.', '$'],
        resolveProvider: false,
      },
      definitionProvider: true,
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
