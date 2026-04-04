/**
 * toke_spec_lookup — search the toke language specification by keyword.
 * Pure reference tool, no compilation.  All content is built-in.
 */

const SPEC_SECTIONS = [
  // ── Character sets ────────────────────────────────────────────────────
  {
    title: "Character Set — Phase 1 (80 Characters)",
    keywords: ["character set", "phase 1", "characters", "ascii", "symbols", "profile 1"],
    content: `Phase 1 uses exactly 80 characters. No character outside this set shall appear in toke source except within string literal content.

Lowercase:  a-z  (26)
Uppercase:  A-Z  (26)
Digits:     0-9  (10)
Symbols:    ( ) { } [ ] = : . ; + - * / < > ! |  (18)

Excluded: whitespace is structurally meaningless, no comment syntax, @#$%^&~\`\\'\\,? not assigned.
String literals use " as delimiter; within strings, any valid UTF-8 is permitted.

Escape sequences: \\" \\\\ \\n \\t \\r \\0 \\xNN`,
  },
  {
    title: "Character Set — Phase 2 (56 Characters)",
    keywords: ["phase 2", "sigils", "type sigils", "dollar", "at sign", "$", "@"],
    content: `Phase 2 is the normative default profile, a reduced 56-character set.

Lowercase:  a-z  (26)
Digits:     0-9  (10)
Symbols:    ( ) { } = : . ; + - * / < > ! | $ @  (18)
Reserved:   ^ ~  (2)

Key transformations from Phase 1:
- Uppercase type names become $-prefixed lowercase: User -> $user, Str -> $str
- Array literals [...] become @(...)
- Array indexing a[n] becomes a.n (constant) or a.get(n) (variable)

Tokenizer efficiency: $user, $str, @( each tokenize as single tokens.`,
  },

  // ── Keywords ──────────────────────────────────────────────────────────
  {
    title: "Keywords",
    keywords: ["keywords", "reserved", "F", "T", "I", "M", "if", "el", "lp", "br", "let", "mut", "as", "rt"],
    content: `The 12 reserved keywords:

| Keyword | Role |
|---------|------|
| F       | function definition |
| T       | type definition |
| I       | import declaration |
| M       | module declaration |
| if      | conditional branch |
| el      | else branch (follows if block only) |
| lp      | loop (the single loop construct) |
| br      | break — exits innermost loop |
| let     | immutable binding |
| mut     | mutable qualifier on binding |
| as      | type cast |
| rt      | return (long-form alternative to <) |

Boolean literals 'true' and 'false' are predefined identifiers, not keywords.`,
  },

  // ── Type system ───────────────────────────────────────────────────────
  {
    title: "Type System — Primitive Types",
    keywords: ["types", "type system", "primitives", "integer", "float", "bool", "str", "byte", "i64", "u64", "f64", "i32", "u32"],
    content: `Primitive types:

| Type | Description     | Width    |
|------|-----------------|----------|
| u8   | unsigned integer | 8-bit   |
| u16  | unsigned integer | 16-bit  |
| u32  | unsigned integer | 32-bit  |
| u64  | unsigned integer | 64-bit  |
| i8   | signed integer   | 8-bit   |
| i16  | signed integer   | 16-bit  |
| i32  | signed integer   | 32-bit  |
| i64  | signed integer   | 64-bit  |
| f32  | IEEE 754 binary32| 32-bit  |
| f64  | IEEE 754 binary64| 64-bit  |
| bool | boolean          | 1 bit   |
| Str  | UTF-8 string     | heap    |
| Byte | single byte      | 8-bit   |

No implicit coercions. Use 'as' for explicit casts. Default integer type is i64, default float is f64.`,
  },
  {
    title: "Type System — Arrays",
    keywords: ["arrays", "array", "list", "collection", "len", "index"],
    content: `Array type: [T] — dynamically-sized array of elements of type T.

Arrays are heap-allocated within the current arena.
- .len returns u64 (array length)
- a[i] returns type T; out-of-bounds is a runtime trap
- Array literal: [elem1;elem2;elem3]
- Array type in signatures: [i64], [Str], etc.
- In Phase 2: array literal is @(elem1;elem2;elem3)

Example:
  F=sum(arr:[i64]):i64{
    let acc=mut.0;
    lp(let i=0;i<arr.len;i=i+1){acc=acc+arr[i]};
    <acc
  };`,
  },
  {
    title: "Type System — Structs (Record Types)",
    keywords: ["struct", "structs", "record", "field", "fields", "type declaration"],
    content: `Struct declaration: T=Name{field1:Type1;field2:Type2};

- All field names are lowercase identifiers
- Fields accessed with .fieldname
- Structs are value types — assignment copies
- No recursive structs without indirection (E2015)

Example:
  T=User{id:u64;name:Str;email:Str};

Struct literal:
  User{id:1;name:"alice";email:"a@b.com"}`,
  },
  {
    title: "Type System — Sum Types (Tagged Unions)",
    keywords: ["sum type", "tagged union", "enum", "variant", "variants", "error type"],
    content: `Sum type declaration: T=Name{Variant1:PayloadType;Variant2:PayloadType};

- All field names begin with uppercase (TYPE_IDENT)
- Mixing lowercase and uppercase field names is E2011
- Zero-payload variant uses type bool with implicit true

Example:
  T=UserErr{NotFound:u64;BadInput:Str;DbErr:Str};

The built-in Result type:  T=Result{Ok:T;Err:E}
All partial functions return Result implicitly, expressed as :T!E in the signature.`,
  },
  {
    title: "Type System — No Implicit Coercion",
    keywords: ["coercion", "cast", "as", "conversion", "implicit"],
    content: `No implicit type coercions are defined. Prohibited:
- Numeric widening (i32 -> i64 automatically) — use 'as'
- String conversion (integer to string) — use stdlib str functions
- Truthiness conversion (integer to bool) — use explicit comparison

Explicit cast: let wide = narrow as i64;
Casts that could truncate generate warning W1001 and a runtime trap if value doesn't fit.`,
  },

  // ── Source model ──────────────────────────────────────────────────────
  {
    title: "Source File Structure",
    keywords: ["source file", "file structure", "declaration order", "module", "import order"],
    content: `A toke source file (.tk) must follow this declaration order:

1. M= (module declaration) — exactly one, required
2. I= (import declarations) — zero or more
3. T= (type declarations) — zero or more
4. Constants — zero or more
5. F= (function declarations) — zero or more

No other ordering is valid. Violation emits E2001.
Each file should export one primary construct (convention, not enforced by compiler).

Example:
  M=api.user;
  I=db:std.db;
  I=json:std.json;
  T=User{id:u64;name:Str};
  F=getuser(id:u64):User!Err{...};`,
  },

  // ── Module and imports ────────────────────────────────────────────────
  {
    title: "Module Declaration",
    keywords: ["module", "M=", "module path", "namespace"],
    content: `Every source file begins with exactly one module declaration:

  M=module.path;

The module path is a dot-separated sequence of lowercase identifiers.
Two files with the same module path are part of the same module unless they conflict (E2005).

Example:  M=api.user;`,
  },
  {
    title: "Import Declarations",
    keywords: ["import", "imports", "I=", "require", "use"],
    content: `Import syntax:  I=localAlias:module.path;

- localAlias is the name used to access exports: alias.func(), alias.Type
- module.path is the fully qualified module path
- Wildcard imports are prohibited (E2006)
- Optional version constraint: I=io:std.io "1.0";

Example:
  I=http:std.http;
  I=db:std.db;
  I=json:std.json;

After import: http.get(...), db.open(...), json.enc(...)`,
  },

  // ── Functions ─────────────────────────────────────────────────────────
  {
    title: "Function Declarations",
    keywords: ["function", "functions", "F=", "params", "parameters", "return", "signature"],
    content: `Function syntax:
  F=name(param1:Type1;param2:Type2):ReturnType!ErrorType{ body };

- All parameter types and return type must be explicit
- !ErrorType marks fallible functions
- Function without !ErrorType is total (cannot use ! propagation)

Return forms:
  <expr       — short form, preferred for single expressions
  rt expr     — long form, preferred in deeply nested code

Example (total):
  F=add(a:i64;b:i64):i64{<a+b};

Example (partial):
  F=getuser(id:u64):User!UserErr{
    r=db.one("SELECT id,name FROM users WHERE id=?",[id])!UserErr.DbErr;
    <User{id:r.u64(id);name:r.str(name)}
  };`,
  },

  // ── Control flow ──────────────────────────────────────────────────────
  {
    title: "Conditionals — if/el",
    keywords: ["if", "else", "el", "conditional", "branch", "if statement", "if expression"],
    content: `Conditional syntax:

  if(condition){ body }
  if(condition){ true_body }el{ false_body }

- Condition must be type bool (E4001 for non-bool)
- el is only valid immediately after a closing } of an if block
- No "else if" shorthand; use nested if inside el{}

Example:
  if(x>0){<x}el{<0-x}

Nested:
  if(a){body_a}el{if(b){body_b}el{body_c}}`,
  },
  {
    title: "Loop — lp",
    keywords: ["loop", "lp", "for", "while", "iteration", "break", "br"],
    content: `toke has exactly one loop construct:

  lp(init_stmt;condition;step_stmt){ body }

- init_stmt: binding or assignment, executed once before the loop
- condition: bool expression, evaluated before each iteration
- step_stmt: statement executed after each iteration body
- br exits the innermost loop

There is no while, do-while, for-each, or until.

Example:
  lp(let i=0;i<arr.len;i=i+1){
    acc=acc+arr[i]
  };`,
  },
  {
    title: "Match Expression",
    keywords: ["match", "pattern matching", "switch", "case", "exhaustive"],
    content: `Match expression syntax:

  expr|{
    Variant1:binding1 result_expr;
    Variant2:binding2 result_expr
  }

- Match is exhaustive: must cover all variants (E4010)
- All arms must return the same type (E4011)
- Match is an expression, not a statement

Example:
  getuser(id)|{
    Ok:u   <Res.ok(json.enc(u));
    Err:e  <Res.err(json.enc(e))
  }`,
  },

  // ── Bindings ──────────────────────────────────────────────────────────
  {
    title: "Bindings — let and mut",
    keywords: ["let", "mut", "binding", "variable", "mutable", "immutable", "assignment"],
    content: `Immutable binding:
  let name=expr;
After binding, name cannot be reassigned (E3010).

Mutable binding:
  let name=mut.initial_value;
The mut. qualifier marks the binding as mutable. Reassign with:
  name=new_value;

Assigning to an immutable binding is E3010.
Assigning to an undeclared name is E3011.
Duplicate declaration in same scope is E3012.`,
  },

  // ── Error model ───────────────────────────────────────────────────────
  {
    title: "Error Propagation",
    keywords: ["error", "errors", "propagation", "!", "bang", "result", "try", "error handling"],
    content: `Error propagation syntax:

  expr!ErrorVariant

- If expr evaluates to Err(e), the current function returns Err(ErrorVariant(e))
- If expr evaluates to Ok(v), execution continues with value v
- The right-hand side must be a variant of the function's declared error type

Function signature with error type:
  F=handle(req:Req):Res!ApiErr{ ... };

Example:
  body=json.dec(req.body)!ApiErr.BadRequest;
  user=db.getuser(body.id)!ApiErr.DbError;
  <http.Res.ok(json.enc(user))`,
  },

  // ── Memory model ──────────────────────────────────────────────────────
  {
    title: "Arena Memory Model",
    keywords: ["arena", "memory", "allocation", "heap", "scope", "lifetime"],
    content: `Memory follows a lexical arena discipline:
- All heap allocations within a function or explicit arena block are freed on scope exit
- No manual heap allocation or freeing in v0.1
- No garbage collector or reference counting

Arena block syntax:
  {arena
    stmts
  }

- Creates a lexically scoped allocation region
- All allocations freed when block exits (normal, return, or error propagation)
- Returning arena-allocated values across the boundary is E5001
- Returning a pointer to arena-local allocation is E5002`,
  },

  // ── Operators ─────────────────────────────────────────────────────────
  {
    title: "Operators and Precedence",
    keywords: ["operators", "precedence", "arithmetic", "comparison", "binary", "unary", "plus", "minus"],
    content: `Expression precedence (low to high):

1. Match:      expr|{ arms }
2. Compare:    < > =
3. Add:        + -
4. Multiply:   * /
5. Unary:      - (negate), ! (not / propagate)
6. Call:       func(args)
7. Postfix:    expr.field

Operators:
  +   addition
  -   subtraction (binary) or negation (unary)
  *   multiplication
  /   division
  <   less than
  >   greater than
  =   equality (in expression context)
  !   logical not (unary) or error propagation (postfix)
  |   match pipe`,
  },

  // ── Semicolons ────────────────────────────────────────────────────────
  {
    title: "Semicolons",
    keywords: ["semicolon", "semicolons", "separator", "terminator"],
    content: `Semicolons serve as statement separators.

- Required between consecutive statements in a block
- May be elided before } or EOF (trailing-semicolon elision)
- Used as separator in parameter lists: (a:i64;b:i64)
- Used as separator in array literals: [1;2;3]
- Missing semicolon between statements emits E2003`,
  },

  // ── String literals ───────────────────────────────────────────────────
  {
    title: "String Literals",
    keywords: ["string", "strings", "str", "literal", "escape", "interpolation"],
    content: `String literals are delimited by double-quote (").
Any valid UTF-8 is permitted within strings.

Escape sequences:
  \\"   literal double-quote
  \\\\   literal backslash
  \\n   newline
  \\t   horizontal tab
  \\r   carriage return
  \\0   null byte
  \\xNN byte with hex value NN

String interpolation \\(expr) is recognized but not supported in Profile 1 (warning W1010).
Use str.concat() instead.

Invalid escape sequences emit E1001.
Unterminated strings emit E1002.`,
  },

  // ── Diagnostics ───────────────────────────────────────────────────────
  {
    title: "Structured Diagnostics",
    keywords: ["diagnostic", "diagnostics", "error format", "json", "diag", "compiler output"],
    content: `All compiler output uses structured JSON diagnostics (Layer B).

Each diagnostic contains:
- schema_version: "1.0"
- error_code: e.g. "E1001"
- severity: "error" or "warning"
- message: human-readable description
- pos: { offset, line (1-based), col (1-based) }
- fix: optional suggested fix string
- text: optional source text snippet

Use --diag-json flag for JSON output.
Error code series: E1xxx (lexer), E2xxx (parser), E3xxx (names), E4xxx (types), E5xxx (arena), E9xxx (codegen).`,
  },

  // ── Design principles ─────────────────────────────────────────────────
  {
    title: "Design Principles",
    keywords: ["design", "principles", "philosophy", "machine-first", "LLM", "token efficiency"],
    content: `toke design principles:

1. Machine-first syntax — exactly one canonical form per construct
2. Deterministic structure — LL(1) grammar, one unambiguous parse tree
3. Token efficiency — minimise verbosity, every token carries semantic info
4. Strong explicit typing — all types stated, no inference in v0.1
5. Structured failure — machine-readable diagnostics with stable error codes
6. Incremental compilability — each file independently parseable
7. No hidden behaviour — no implicit conversions or undefined behaviour
8. Native execution target — self-contained binaries, no runtime/GC
9. Arena memory discipline — lexical arena allocation, deterministic freeing

Primary optimisation target: machine generation reliability and token efficiency.`,
  },

  // ── Numeric literals ──────────────────────────────────────────────────
  {
    title: "Numeric Literals",
    keywords: ["number", "integer", "float", "literal", "hex", "binary", "numeric"],
    content: `Integer literals:
- Decimal: 0, 42, 1024
- Hexadecimal: 0xFF, 0x1A
- Binary: 0b1010, 0b0

No suffix. Default type is i64 if context doesn't resolve.

Float literals:
- Decimal with fraction: 3.14, 0.5
- With exponent: 1.0e9, 2.5E-3

No suffix. Default type is f64.`,
  },

  // ── Extern / FFI ──────────────────────────────────────────────────────
  {
    title: "Extern Functions (FFI)",
    keywords: ["extern", "ffi", "foreign", "c", "pointer", "bodyless"],
    content: `Extern (bodyless) functions declare FFI bindings:

  F=c_strlen(s:*u8):u64;

- No function body (no {})
- Pointer types (*T) only valid in extern signatures (E2010)
- Linked at compile time via clang

Pointer types are not available in non-extern toke functions.`,
  },
];

/**
 * Search the spec knowledge base by keyword query.
 * @param {string} query - e.g. "arrays", "if statement", "type sigils"
 * @returns {{ query: string, results: Array<{ title: string, content: string }> }}
 */
export function tokeSpecLookup(query) {
  const q = query.toLowerCase().trim();
  const qWords = q.split(/\s+/);

  // Score each section by keyword relevance
  const scored = SPEC_SECTIONS.map((section) => {
    let score = 0;
    const titleLower = section.title.toLowerCase();
    const contentLower = section.content.toLowerCase();

    // Exact query match in title
    if (titleLower.includes(q)) score += 10;

    // Exact query match in keywords
    for (const kw of section.keywords) {
      if (kw === q) { score += 15; break; }
      if (kw.includes(q) || q.includes(kw)) score += 8;
    }

    // Per-word matching
    for (const word of qWords) {
      if (word.length < 2) continue;
      for (const kw of section.keywords) {
        if (kw === word) score += 6;
        else if (kw.includes(word)) score += 3;
      }
      if (titleLower.includes(word)) score += 4;
      if (contentLower.includes(word)) score += 1;
    }

    return { section, score };
  });

  // Filter and sort
  const results = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => ({ title: s.section.title, content: s.section.content }));

  if (results.length === 0) {
    return {
      query,
      results: [],
      message: `No spec sections matched "${query}". Try keywords like: types, arrays, if, loop, match, arena, keywords, imports, module, operators, strings, diagnostics, phase 2, sigils.`,
    };
  }

  return { query, results };
}
