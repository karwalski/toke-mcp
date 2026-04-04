/**
 * toke_stdlib_ref — look up toke standard library module and function info.
 * Pure reference tool, no compilation.  All data is built-in from the
 * normative signatures in toke-spec/spec/stdlib-signatures.md.
 */

const STDLIB = {
  str: {
    module: "std.str",
    description: "String operations — length, concatenation, slicing, splitting, case conversion, and search.",
    functions: {
      len:      { sig: "f=len(s:$str):i64",                      desc: "Return the length of the string in bytes." },
      concat:   { sig: "f=concat(a:$str;b:$str):$str",           desc: "Concatenate two strings." },
      slice:    { sig: "f=slice(s:$str;start:i64;end:i64):$str",  desc: "Return a substring from start (inclusive) to end (exclusive)." },
      split:    { sig: "f=split(s:$str;sep:$str):@$str",          desc: "Split the string by separator, returning an array of substrings." },
      upper:    { sig: "f=upper(s:$str):$str",                    desc: "Convert string to uppercase." },
      lower:    { sig: "f=lower(s:$str):$str",                    desc: "Convert string to lowercase." },
      trim:     { sig: "f=trim(s:$str):$str",                     desc: "Remove leading and trailing whitespace." },
      contains: { sig: "f=contains(s:$str;sub:$str):bool",        desc: "Return true if s contains the substring sub." },
      replace:  { sig: "f=replace(s:$str;old:$str;new:$str):$str",desc: "Replace all occurrences of old with new in s." },
      starts:   { sig: "f=starts(s:$str;prefix:$str):bool",       desc: "Return true if s starts with prefix." },
      ends:     { sig: "f=ends(s:$str;suffix:$str):bool",         desc: "Return true if s ends with suffix." },
    },
    example: 'I=str:std.str;\nlet n=str.len("hello");  // 5\nlet u=str.upper("hello");  // "HELLO"',
  },
  math: {
    module: "std.math",
    description: "Mathematical functions. Note: std.math is listed in the project plan but does not yet have normative signatures. Basic arithmetic uses built-in operators (+, -, *, /).",
    functions: {},
    example: "// Use built-in operators for arithmetic:\nlet x=a+b;\nlet y=a*b;\nlet z=a/b;",
  },
  io: {
    module: "std.io",
    description: "Input/output operations. In toke, I/O is handled through std.file (file I/O) and std.http (HTTP). There is no separate std.io module with normative signatures yet.",
    functions: {},
    example: "// Use std.file for file I/O:\nI=fs:std.file;\nlet data=fs.read(\"input.txt\");",
  },
  fs: {
    module: "std.file",
    description: "File I/O — read, write, append, list directory, and delete files.",
    functions: {
      read:   { sig: "f=read(path:$str):$str",             desc: "Read the entire contents of a file as a string." },
      write:  { sig: "f=write(path:$str;data:$str):void",  desc: "Write data to a file, creating or overwriting it." },
      append: { sig: "f=append(path:$str;data:$str):void", desc: "Append data to the end of a file." },
      list:   { sig: "f=list(dir:$str):@$str",             desc: "List file names in a directory." },
      delete: { sig: "f=delete(path:$str):void",           desc: "Delete a file." },
    },
    example: 'I=fs:std.file;\nlet data=fs.read("config.txt");\nfs.write("output.txt";"hello");',
  },
  file: {
    module: "std.file",
    description: "Alias for 'fs'. File I/O — read, write, append, list directory, and delete files.",
    aliasOf: "fs",
  },
  env: {
    module: "std.env",
    description: "Environment variable access — get and set environment variables.",
    functions: {
      get: { sig: "f=get(key:$str):$str",            desc: "Get the value of an environment variable." },
      set: { sig: "f=set(key:$str;val:$str):void",   desc: "Set an environment variable." },
    },
    example: 'I=env:std.env;\nlet port=env.get("PORT");',
  },
  time: {
    module: "std.time",
    description: "Time operations — get current time, format timestamps, measure elapsed time.",
    functions: {
      now:   { sig: "f=now():i64",                        desc: "Return the current Unix timestamp in nanoseconds." },
      fmt:   { sig: "f=fmt(ts:i64;layout:$str):$str",     desc: "Format a timestamp using the given layout string." },
      since: { sig: "f=since(ts:i64):i64",                desc: "Return elapsed nanoseconds since the given timestamp." },
    },
    example: 'I=time:std.time;\nlet t=time.now();\nlet s=time.fmt(t;"2006-01-02");',
  },
  crypto: {
    module: "std.crypto",
    description: "Cryptographic operations — SHA-256 hashing, HMAC-SHA-256, and hex encoding.",
    functions: {
      sha256: { sig: "f=sha256(data:$str):$str",          desc: "Compute the SHA-256 hash of data, returned as raw bytes." },
      hmac:   { sig: "f=hmac(key:$str;data:$str):$str",   desc: "Compute HMAC-SHA-256 of data with the given key." },
      hex:    { sig: "f=hex(data:$str):$str",              desc: "Encode raw bytes as a hexadecimal string." },
    },
    example: 'I=crypto:std.crypto;\nlet h=crypto.hex(crypto.sha256("hello"));',
  },
  process: {
    module: "std.process",
    description: "Subprocess spawning and control — execute commands, spawn processes, wait, and kill.",
    functions: {
      exec:  { sig: "f=exec(cmd:$str):$str",   desc: "Execute a shell command and return its stdout." },
      spawn: { sig: "f=spawn(cmd:$str):i64",    desc: "Spawn a subprocess, returning its PID." },
      wait:  { sig: "f=wait(pid:i64):i64",      desc: "Wait for a subprocess to exit, returning its exit code." },
      kill:  { sig: "f=kill(pid:i64):void",      desc: "Send SIGTERM to a subprocess." },
    },
    example: 'I=proc:std.process;\nlet out=proc.exec("ls -la");',
  },
  log: {
    module: "std.log",
    description: "Structured logging — info, warn, error, and debug level messages.",
    functions: {
      info:  { sig: "f=info(msg:$str):void",  desc: "Log a message at INFO level." },
      warn:  { sig: "f=warn(msg:$str):void",  desc: "Log a message at WARN level." },
      error: { sig: "f=error(msg:$str):void", desc: "Log a message at ERROR level." },
      debug: { sig: "f=debug(msg:$str):void", desc: "Log a message at DEBUG level." },
    },
    example: 'I=log:std.log;\nlog.info("server started");\nlog.error("connection failed");',
  },
  tktest: {
    module: "std.test",
    description: "Test assertions — equality, inequality, boolean assertions, and explicit failure.",
    functions: {
      eq:   { sig: "f=eq(a:i64;b:i64):void",  desc: "Assert that a equals b. Traps on failure." },
      neq:  { sig: "f=neq(a:i64;b:i64):void", desc: "Assert that a does not equal b. Traps on failure." },
      ok:   { sig: "f=ok(cond:bool):void",     desc: "Assert that the condition is true. Traps on failure." },
      fail: { sig: "f=fail(msg:$str):void",    desc: "Unconditionally fail the test with a message." },
    },
    example: 'I=t:std.test;\nt.eq(add(1;2);3);\nt.ok(str.contains("hello";"ell"));',
  },
  test: {
    module: "std.test",
    description: "Alias for 'tktest'. Test assertions.",
    aliasOf: "tktest",
  },
  db: {
    module: "std.db",
    description: "Database queries — SQLite3 backend. Open, execute, query, and close databases.",
    functions: {
      open:  { sig: "f=open(path:$str):i64",            desc: "Open a SQLite3 database file, returning a handle." },
      exec:  { sig: "f=exec(db:i64;sql:$str):i64",      desc: "Execute a SQL statement (no result rows). Returns rows affected." },
      query: { sig: "f=query(db:i64;sql:$str):$str",     desc: "Execute a SQL query and return result rows as a JSON string." },
      close: { sig: "f=close(db:i64):void",               desc: "Close a database handle." },
    },
    example: 'I=db:std.db;\nlet h=db.open("app.db");\nlet rows=db.query(h;"SELECT * FROM users");\ndb.close(h);',
  },
  json: {
    module: "std.json",
    description: "JSON encoding, decoding, and typed field extraction.",
    functions: {
      enc:   { sig: "f=enc(val:i64):$str",               desc: "Encode a value as a JSON string." },
      dec:   { sig: "f=dec(s:$str):i64",                  desc: "Decode a JSON string to a value." },
      str:   { sig: "f=str(s:$str;key:$str):$str",        desc: "Extract a string field from a JSON object by key." },
      i64:   { sig: "f=i64(s:$str;key:$str):i64",         desc: "Extract an i64 field from a JSON object by key." },
      f64:   { sig: "f=f64(s:$str;key:$str):f64",         desc: "Extract an f64 field from a JSON object by key." },
      bool:  { sig: "f=bool(s:$str;key:$str):bool",       desc: "Extract a boolean field from a JSON object by key." },
      arr:   { sig: "f=arr(s:$str;key:$str):@$str",       desc: "Extract an array field from a JSON object by key." },
      parse: { sig: "f=parse(s:$str):i64",                desc: "Parse a JSON string into an opaque handle." },
      print: { sig: "f=print(val:i64):void",              desc: "Pretty-print a JSON value to stdout." },
    },
    example: 'I=json:std.json;\nlet name=json.str(body;"name");\nlet out=json.enc(42);',
  },
  toon: {
    module: "std.toon",
    description: "TOON (Token-Oriented Object Notation) — the default toke serialization format. 30-60% fewer tokens than JSON for tabular data.",
    functions: {
      enc:       { sig: "f=enc(data:$str;schema:$str):$str",  desc: "Encode data using the given schema into TOON format." },
      dec:       { sig: "f=dec(s:$str):$str",                  desc: "Decode a TOON string to a data string." },
      str:       { sig: "f=str(s:$str;key:$str):$str",         desc: "Extract a string field from a TOON object by key." },
      i64:       { sig: "f=i64(s:$str;key:$str):i64",          desc: "Extract an i64 field from a TOON object by key." },
      f64:       { sig: "f=f64(s:$str;key:$str):f64",          desc: "Extract an f64 field from a TOON object by key." },
      bool:      { sig: "f=bool(s:$str;key:$str):bool",        desc: "Extract a boolean field from a TOON object by key." },
      arr:       { sig: "f=arr(s:$str):@$str",                 desc: "Extract an array from a TOON string." },
      from_json: { sig: "f=from_json(s:$str;name:$str):$str",  desc: "Convert a JSON string to TOON format using the named schema." },
      to_json:   { sig: "f=to_json(s:$str):$str",              desc: "Convert a TOON string to JSON format." },
    },
    example: 'I=toon:std.toon;\nlet t=toon.from_json(data;"users");\nlet j=toon.to_json(t);',
  },
  yaml: {
    module: "std.yaml",
    description: "YAML encoding, decoding, and typed field extraction.",
    functions: {
      enc:       { sig: "f=enc(data:$str):$str",               desc: "Encode data as a YAML string." },
      dec:       { sig: "f=dec(s:$str):$str",                   desc: "Decode a YAML string to data." },
      str:       { sig: "f=str(s:$str;key:$str):$str",          desc: "Extract a string field from a YAML document by key." },
      i64:       { sig: "f=i64(s:$str;key:$str):i64",           desc: "Extract an i64 field from a YAML document by key." },
      f64:       { sig: "f=f64(s:$str;key:$str):f64",           desc: "Extract an f64 field from a YAML document by key." },
      bool:      { sig: "f=bool(s:$str;key:$str):bool",         desc: "Extract a boolean field from a YAML document by key." },
      arr:       { sig: "f=arr(s:$str;key:$str):@$str",         desc: "Extract an array field from a YAML document by key." },
      from_json: { sig: "f=from_json(s:$str):$str",             desc: "Convert a JSON string to YAML format." },
      to_json:   { sig: "f=to_json(s:$str):$str",               desc: "Convert a YAML string to JSON format." },
    },
    example: 'I=yaml:std.yaml;\nlet y=yaml.enc(data);\nlet name=yaml.str(y;"name");',
  },
  i18n: {
    module: "std.i18n",
    description: "Internationalisation — locale-aware string bundles with placeholder substitution.",
    functions: {
      load:   { sig: "f=load(path:$str):$str",                    desc: "Load a string bundle from a file path." },
      get:    { sig: "f=get(bundle:$str;key:$str):$str",           desc: "Get a localised string by key." },
      fmt:    { sig: "f=fmt(bundle:$str;key:$str;args:$str):$str", desc: "Get a localised string and substitute placeholders with args." },
      locale: { sig: "f=locale():$str",                            desc: "Return the current locale string." },
    },
    example: 'I=i18n:std.i18n;\nlet b=i18n.load("strings.toon");\nlet msg=i18n.fmt(b;"greeting";"Alice");',
  },
  http: {
    module: "std.http",
    description: "HTTP request/response handling and routing.",
    functions: {
      get:    { sig: "f=get(url:$str):$str",                      desc: "Perform an HTTP GET request, returning the response body." },
      post:   { sig: "f=post(url:$str;body:$str):$str",           desc: "Perform an HTTP POST request with a body, returning the response." },
      listen: { sig: "f=listen(addr:$str;handler:$str):void",     desc: "Start an HTTP server listening on addr with the given handler." },
    },
    example: 'I=http:std.http;\nlet body=http.get("https://api.example.com/users");\nhttp.listen(":8080";"handler");',
  },
};

// Build a flat list of all module names for the "list" response
const ALL_MODULES = Object.keys(STDLIB).filter((k) => !STDLIB[k].aliasOf);

/**
 * Look up a stdlib module or a specific function within it.
 * @param {string} moduleName - e.g. "str", "db", "crypto"
 * @param {string} [functionName] - optional, e.g. "len", "sha256"
 * @returns {object}
 */
export function tokeStdlibRef(moduleName, functionName) {
  const mod = moduleName.toLowerCase().trim().replace(/^std\./, "");

  const entry = STDLIB[mod];
  if (!entry) {
    return {
      found: false,
      module: mod,
      message: `Unknown module "${mod}". Available modules: ${ALL_MODULES.join(", ")}.`,
    };
  }

  // Resolve alias
  const resolved = entry.aliasOf ? STDLIB[entry.aliasOf] : entry;

  // Specific function requested
  if (functionName) {
    const fn = functionName.toLowerCase().trim();
    const funcEntry = resolved.functions[fn];

    if (!funcEntry) {
      const available = Object.keys(resolved.functions);
      return {
        found: false,
        module: resolved.module,
        function: fn,
        message: available.length > 0
          ? `Function "${fn}" not found in ${resolved.module}. Available: ${available.join(", ")}.`
          : `Module ${resolved.module} has no normative function signatures yet.`,
      };
    }

    return {
      found: true,
      module: resolved.module,
      function: fn,
      signature: funcEntry.sig,
      description: funcEntry.desc,
      example: resolved.example,
    };
  }

  // Module overview
  const funcs = Object.entries(resolved.functions).map(([name, f]) => ({
    name,
    signature: f.sig,
    description: f.desc,
  }));

  return {
    found: true,
    module: resolved.module,
    description: resolved.description,
    functions: funcs,
    example: resolved.example,
  };
}
