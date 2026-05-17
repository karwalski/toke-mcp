/**
 * toke_explain_error — look up a toke error code and return a human-readable
 * explanation with fix suggestions.  Pure reference, no compilation.
 */

const ERROR_CATALOG = {
  // ── Lexer errors (1xxx) ──────────────────────────────────────────────
  E1001: {
    stage: "lex",
    severity: "error",
    title: "Invalid escape sequence",
    message:
      "A backslash in a string literal is followed by a character that is not one of \", \\, n, t, r, 0, x, or (. Also emitted when \\x is not followed by exactly two hex digits.",
    fix: "Use only recognised escape sequences: \\\", \\\\, \\n, \\t, \\r, \\0, \\xNN. Remove or replace the invalid escape.",
    example: 'm=test;\nf=bad():Str{<"\\q"};',
  },
  E1002: {
    stage: "lex",
    severity: "error",
    title: "Unterminated string literal",
    message:
      "The lexer reached end-of-input before finding a closing double-quote for a string literal.",
    fix: "Add a closing \" to terminate the string literal.",
    example: 'm=test;\nf=bad():Str{<"unterminated};',
  },
  E1003: {
    stage: "lex",
    severity: "error",
    title: "Character outside Profile 1 character set",
    message:
      "A character that is not in the 80-character Profile 1 set was found in a structural position. Only a-z, A-Z, 0-9, and (){}[]=:.;+-*/<>!| are permitted outside string literals.",
    fix: "Remove or replace the offending character. Non-ASCII and symbols like @, #, $, %, ^, &, ~ are not allowed in structural positions.",
    example: "m=test;\nf=bad():i64{<1£};",
  },
  E1004: {
    stage: "lex",
    severity: "error",
    title: "Identifier beginning with a digit",
    message:
      "A token starting with a digit is not a valid numeric literal and cannot be used as an identifier.",
    fix: "Identifiers must begin with a letter (a-z or A-Z). Rename the identifier so it starts with a letter, e.g. 'x3' instead of '3x'.",
    example: "m=test;\nf=bad():i64{let 3x=1;<3x};",
  },
  E1005: {
    stage: "lex",
    severity: "error",
    title: "Non-UTF-8 byte sequence",
    message: "The source file contains a byte sequence that is not valid UTF-8.",
    fix: "Re-save the file as UTF-8. All toke source files must be UTF-8 encoded.",
  },
  E1010: {
    stage: "parse",
    severity: "error",
    title: "Reserved literal used as identifier",
    message:
      "The reserved literals 'true' and 'false' cannot be used as identifiers (e.g. variable names).",
    fix: "Choose a different identifier name. 'true' and 'false' are predefined boolean literals.",
    example: "m=test;\nf=bad():i64{let true=1;<true};",
  },

  // ── Warnings (W1xxx) ────────────────────────────────────────────────
  W1001: {
    stage: "type_check",
    severity: "warning",
    title: "Potentially truncating cast",
    message:
      "An explicit 'as' cast narrows the value (e.g. i64 to i32). Data may be silently truncated at runtime.",
    fix: "If truncation is intentional, the warning can be noted. Otherwise, avoid the narrowing cast or check the value range first.",
  },
  W1010: {
    stage: "lex",
    severity: "warning",
    title: "String interpolation not supported in Profile 1",
    message:
      "The \\( sequence inside a string literal is not supported in Profile 1.",
    fix: "Use str.concat() for string composition instead of \\(expr) interpolation.",
    example: 'm=test;\nf=interp():Str{<"hello \\(name)"};',
  },

  // ── Parser errors (2xxx) ────────────────────────────────────────────
  E2001: {
    stage: "parse",
    severity: "error",
    title: "Declaration ordering violation",
    message:
      "toke source files must follow the order: m (module), i (import), t (type), constants, f (function). A declaration appeared out of order or m= is missing.",
    fix: "Reorder declarations to follow m > i > t > constants > f. Ensure m= appears first.",
    example: "f=bad():i64{<0};",
  },
  E2002: {
    stage: "parse",
    severity: "error",
    title: "Unexpected token",
    message:
      "The parser encountered a token it cannot consume in the current grammatical context.",
    fix: "Check the surrounding syntax. Common causes: missing operator, extra symbol, or misplaced keyword.",
    example: "m=test;\nf=bad():i64{<1 @};",
  },
  E2003: {
    stage: "parse",
    severity: "error",
    title: "Missing semicolon",
    message:
      "A semicolon was expected between statements. Semicolons may be elided before } or EOF, but are required between consecutive statements.",
    fix: "Add a semicolon between the statements.",
    example: "m=test;\nf=bad():i64{let x=1 let y=2;<x};",
  },
  E2004: {
    stage: "parse",
    severity: "error",
    title: "Unclosed delimiter",
    message:
      "An opening (, [, or { was not matched by a closing ), ], or } before EOF.",
    fix: "Add the matching closing delimiter.",
    example: "m=test;\nf=bad():i64{<(1+2};",
  },
  E2005: {
    stage: "parse",
    severity: "error",
    title: "Duplicate module path across source files",
    message:
      "Two or more source files declare the same module path. Each module path must be unique within a compilation unit.",
    fix: "Rename one of the conflicting module declarations so each file has a unique m= path.",
  },
  E2006: {
    stage: "parse",
    severity: "error",
    title: "Wildcard import attempted",
    message:
      "toke does not support wildcard imports (e.g. i=*:std). All imports must be explicitly named.",
    fix: "Replace the wildcard with explicit named imports, e.g. i=str:std.str;",
  },
  E2010: {
    stage: "type_check",
    severity: "error",
    title: "Pointer type outside extern function",
    message:
      "Pointer types (*T) are only valid in extern (bodyless) function signatures for FFI declarations.",
    fix: "Remove the pointer type from the function signature. Use Str or Byte for data passing in non-extern functions.",
    example: "m=test;\nf=bad(s:*u8):i64{<42};",
  },
  E2011: {
    stage: "parse",
    severity: "error",
    title: "Mixed struct and sum fields in type declaration",
    message:
      "A type declaration must have either all-lowercase fields (struct) or all-uppercase-initial fields (sum type). Mixing is not allowed.",
    fix: "Separate into two type declarations, or ensure all fields follow the same convention.",
    example: "m=test;\nt=Bad{name:Str;NotFound:bool};",
  },
  E2015: {
    stage: "parse",
    severity: "error",
    title: "Recursive struct without indirection",
    message:
      "A struct type contains itself (directly or transitively) without indirection, which makes it infinite size.",
    fix: "Break the recursion by using an array or optional wrapper type instead of direct self-reference.",
  },
  E2030: {
    stage: "name_resolution",
    severity: "error",
    title: "Unresolved import",
    message:
      "The module path in an i= declaration does not resolve to any .tki interface file on the search path.",
    fix: "Check the module path spelling. Ensure the imported module is compiled and its .tki file is on the search path.",
  },
  E2031: {
    stage: "name_resolution",
    severity: "error",
    title: "Circular import detected",
    message:
      "The import graph contains a cycle. Module A imports B which (directly or transitively) imports A.",
    fix: "Break the circular dependency by extracting shared types into a third module that both can import.",
  },
  E2035: {
    stage: "name_resolution",
    severity: "error",
    title: "Malformed version string in import",
    message:
      "The version string in an import declaration does not match MAJOR.MINOR or MAJOR.MINOR.PATCH format.",
    fix: 'Use a valid version string, e.g. i=io:std.io "1.0";',
    example: 'm=test;\ni=io:std.io "abc";\nf=noop():bool{<true};',
  },
  E2036: {
    stage: "name_resolution",
    severity: "error",
    title: "No compatible version found",
    message:
      "Interface files exist for the module but none match the requested version constraint.",
    fix: "Check available versions and update the version constraint in the import.",
  },
  E2037: {
    stage: "name_resolution",
    severity: "error",
    title: "Version conflict between imports",
    message:
      "Two import declarations reference the same module path but with different major versions.",
    fix: "Align both imports to the same major version, or restructure to avoid the diamond dependency.",
  },

  // ── Name resolution errors (3xxx) ───────────────────────────────────
  E3011: {
    stage: "name_resolution",
    severity: "error",
    title: "Identifier not declared",
    message:
      "A reference to an identifier that does not exist in any enclosing scope.",
    fix: "Check the spelling. Ensure the variable or function is declared before use, or imported via i=.",
    example: "m=test;\nf=bad():i64{<x};",
  },
  E3012: {
    stage: "name_resolution",
    severity: "error",
    title: "Identifier already declared in this scope",
    message:
      "A second declaration of the same name in the same scope. Shadowing across scope boundaries is allowed; duplicate declaration within one scope is not.",
    fix: "Rename one of the declarations, or remove the duplicate.",
    example: "m=test;\nf=bad():i64{let x=1;let x=2;<x};",
  },
  E3020: {
    stage: "type_check",
    severity: "error",
    title: "'!' applied to non-error-union value",
    message:
      "The propagation operator ! can only be applied to a value whose type is an error union (T!Err), and only inside a function whose return type is also an error union.",
    fix: "Ensure the expression returns an error union type, and the enclosing function declares an error return type with !ErrType.",
  },

  // ── Type checker errors (4xxx) ──────────────────────────────────────
  E4001: {
    stage: "type_check",
    severity: "error",
    title: "Non-boolean condition in if/loop",
    message:
      "The condition expression in an if or lp construct must evaluate to type bool. No implicit truthiness conversion is performed.",
    fix: "Use an explicit comparison, e.g. 'if(x>0)' instead of 'if(x)'.",
    example: "m=test;\nf=bad():i64{if 1{<1}el{<0}};",
  },
  E4010: {
    stage: "type_check",
    severity: "error",
    title: "Non-exhaustive match",
    message:
      "A match expression does not cover all variants of the matched type. All variants must have a corresponding arm.",
    fix: "Add the missing match arm(s) for all variants.",
    example: "m=test;\nf=bad():i64{mt true{true=>{<1}}};",
  },
  E4011: {
    stage: "type_check",
    severity: "error",
    title: "Match arms have inconsistent types",
    message:
      "All arms of a match expression must evaluate to the same type.",
    fix: "Ensure every match arm returns the same type. Use 'as' to cast if necessary.",
  },
  E4020: {
    stage: "type_check",
    severity: "error",
    title: "Function call argument type mismatch",
    message:
      "A function call passes an argument whose type does not match the declared parameter type.",
    fix: "Pass a value of the correct type, or use 'as' to cast explicitly.",
    example: 'm=test;\nf=inc(x:i64):i64{<x+1};\nf=bad():i64{<inc("hello")};',
  },
  E4021: {
    stage: "type_check",
    severity: "error",
    title: "Return expression type mismatch",
    message:
      "The expression in a return statement does not match the function's declared return type.",
    fix: "Change the return expression to match the declared return type, or update the function signature.",
    example: 'm=test;\nf=bad():i64{<"hello"};',
  },
  E4025: {
    stage: "type_check",
    severity: "error",
    title: "Struct has no field with that name",
    message:
      "A field access expression (expr.field) references a field name that does not exist in the struct type.",
    fix: "Check the struct definition for available fields. Fix the field name spelling.",
  },
  E4026: {
    stage: "type_check",
    severity: "error",
    title: "Array index type error",
    message:
      "Array indexing requires the index expression to be an integer type. Using a non-integer type is a compile error.",
    fix: "Use an integer expression as the array index, e.g. a[0] or a[i] where i is i64/u64.",
    example: 'm=test;\nf=bad():i64{let a=@(1;2;3);<a["x"]};',
  },
  E4031: {
    stage: "type_check",
    severity: "error",
    title: "Type mismatch",
    message:
      "The workhorse type error. Emitted for mismatched operands in binary expressions, function arguments, binding annotations, assignment sides, and return values.",
    fix: "Use an explicit 'as' cast to convert between types, or change the expression to produce the expected type.",
  },
  E4040: {
    stage: "type_check",
    severity: "error",
    title: "Map key type mismatch (reserved)",
    message:
      "Reserved for map key type checking. Not yet emitted by the compiler.",
    fix: "Ensure all map keys have the same type as established by the first entry.",
  },
  E4041: {
    stage: "type_check",
    severity: "error",
    title: "Map value type mismatch (reserved)",
    message:
      "Reserved for map value type checking. Not yet emitted by the compiler.",
    fix: "Ensure all map values have the same type as established by the first entry.",
  },
  E4042: {
    stage: "type_check",
    severity: "error",
    title: "Method on non-collection type (reserved)",
    message:
      "Reserved for calling collection methods (e.g. .push, .get) on non-collection types. Not yet emitted.",
    fix: "Only call collection methods on array or map values.",
  },
  E4043: {
    stage: "type_check",
    severity: "error",
    title: "Inconsistent types in map literal",
    message:
      "All entries in a map literal must have the same key type and the same value type. The first entry establishes the expected types.",
    fix: "Ensure all map entries use consistent key and value types.",
    example: 'm=test;\nf=bad():i64{<[1:10; 2:"x"]};',
  },
  E4050: {
    stage: "type_check",
    severity: "error",
    title: "spawn argument not a callable function",
    message:
      "spawn(f) requires its argument to be a declared function.",
    fix: "Pass a declared function name to spawn().",
  },
  E4051: {
    stage: "type_check",
    severity: "error",
    title: "await argument not a Task",
    message:
      "await(t) requires its argument to have type Task<T>. Passing a value of any other type emits this error.",
    fix: "Ensure the argument to await() is the result of a spawn() call.",
    example: "m=test;\nf=notask():i64{<42};\nf=main():i64{<await(notask())};",
  },
  E4052: {
    stage: "type_check",
    severity: "error",
    title: "Spawned function has parameters",
    message:
      "In Profile 1 (v0.1), spawn only accepts nullary (zero-parameter) functions.",
    fix: "Wrap the function in a nullary closure or use a nullary wrapper function.",
  },
  E4060: {
    stage: "type_check",
    severity: "error",
    title: "FFI type mismatch (reserved)",
    message:
      "Reserved for type mismatches at FFI boundaries. Not yet emitted by the compiler.",
    fix: "Ensure types at FFI boundaries match the extern declaration exactly.",
  },

  // ── Arena errors (5xxx) ─────────────────────────────────────────────
  E5001: {
    stage: "arena_check",
    severity: "error",
    title: "Value escapes arena scope",
    message:
      "Inside an {arena ...} block, assigning to a variable declared in an outer scope would cause a dangling reference when the arena is freed.",
    fix: "Do not assign arena-allocated values to variables declared outside the arena block. Copy the data you need before the arena exits.",
    example: "m=test;\nf=bad():i64{let x=0;{arena x=1};<x};",
  },
  E5002: {
    stage: "arena_check",
    severity: "error",
    title: "Returned pointer to arena-local allocation",
    message:
      "A function returns a value that contains a pointer into an arena that will be freed when the function exits.",
    fix: "Copy the value out of the arena before returning, or allocate in the caller's arena.",
  },

  // ── Codegen / internal errors (9xxx) ────────────────────────────────
  E9001: {
    stage: "codegen",
    severity: "error",
    title: "Failed to write interface file",
    message:
      "The compiler could not open or flush the .tki interface file. This is an I/O error, not a source-level error.",
    fix: "Check file permissions and disk space. Ensure the output directory exists and is writable.",
  },
  E9002: {
    stage: "codegen",
    severity: "error",
    title: "LLVM IR emission failed",
    message:
      "The compiler could not create or write the .ll output file.",
    fix: "Check file permissions and disk space. Ensure the output directory exists and is writable.",
  },
  E9003: {
    stage: "codegen",
    severity: "error",
    title: "clang invocation failed",
    message:
      "After emitting LLVM IR, the compiler invokes clang to produce a binary. clang exited with a non-zero exit code.",
    fix: "Ensure clang is installed and on PATH. Check the clang error output for details.",
  },
  E9010: {
    stage: "codegen",
    severity: "error",
    title: "Compiler limit exceeded",
    message:
      "The program exceeds a hard compiler limit (e.g. too many functions, locals, imports, struct types, pointer locals, or name aliases).",
    fix: "Reduce the size of the compilation unit. Split large modules into smaller ones.",
  },
};

/**
 * Look up a toke error code and return a human-readable explanation.
 * @param {string} errorCode - e.g. "E1001" or "W1010"
 * @returns {{ code: string, found: boolean, ... }}
 */
export function tokeExplainError(errorCode) {
  const code = errorCode.trim().toUpperCase();
  const entry = ERROR_CATALOG[code];

  if (!entry) {
    // Try to identify the series even if the specific code is unknown
    const series = code.match(/^([EW])(\d)/);
    const seriesNames = {
      E1: "Lexer",
      E2: "Parser",
      E3: "Name resolution",
      E4: "Type checker",
      E5: "Arena validator",
      E6: "IR lowerer",
      E9: "Codegen / internal",
      W1: "Warnings",
    };
    const seriesKey = series ? series[1] + series[2] : null;
    const seriesName = seriesKey ? seriesNames[seriesKey] : null;

    return {
      code,
      found: false,
      message: seriesName
        ? `Unknown error code ${code}. It falls in the ${seriesName} series (${seriesKey}xxx).`
        : `Unknown error code ${code}. Valid series: E1xxx (lexer), E2xxx (parser), E3xxx (names), E4xxx (types), E5xxx (arena), E9xxx (codegen), W1xxx (warnings).`,
    };
  }

  const result = {
    code,
    found: true,
    stage: entry.stage,
    severity: entry.severity,
    title: entry.title,
    explanation: entry.message,
    fix: entry.fix,
  };

  if (entry.example) {
    result.example_trigger = entry.example;
  }

  return result;
}
