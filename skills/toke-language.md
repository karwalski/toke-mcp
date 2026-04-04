# Toke Language Reference for AI Code Generation

Toke is a compiled, statically typed programming language designed for LLM-optimised code generation. It uses a minimal character set and short keywords to reduce token counts in language model interactions.

**Profile note:** The compiler (`tkc`) currently defaults to **Phase 1** syntax (uppercase declaration keywords, square bracket arrays). Phase 2 (all-lowercase, `$` type sigils, `@` array sigils) is the normative spec target but is not yet implemented in the compiler. This document covers **both profiles**, clearly marking which syntax the compiler accepts today.

---

## Character Set

### Phase 1 (compiler default) -- 80 characters

Lowercase `a-z`, uppercase `A-Z`, digits `0-9`, symbols `( ) { } [ ] = : . ; + - * / < > ! | "`, whitespace (space, tab, newline).

### Phase 2 (normative spec) -- 56 characters

Lowercase `a-z`, digits `0-9`, symbols `( ) { } = : . ; + - * / < > ! | $ @`, reserved `^ ~`, whitespace.

Uppercase letters and square brackets are removed in Phase 2. The `$` and `@` sigils are added.

---

## Keywords

Toke has 12 keywords. `true` and `false` are predefined identifiers, not keywords.

| Role | Phase 1 (compiler) | Phase 2 (spec) | Description |
|------|-------------------|----------------|-------------|
| Module | `M` | `m` | Module declaration |
| Function | `F` | `f` | Function definition |
| Type | `T` | `t` | Struct type definition |
| Import | `I` | `i` | Import declaration |
| Conditional | `if` | `if` | If branch |
| Else | `el` | `el` | Else branch |
| Loop | `lp` | `lp` | Loop statement |
| Break | `br` | `br` | Break out of loop |
| Binding | `let` | `let` | Immutable variable binding |
| Mutable | `mut` | `mut` | Mutable qualifier |
| Cast | `as` | `as` | Type cast |
| Return | `rt` | `rt` | Return (long form) |

The `<` operator is the **short-form return** -- it is the idiomatic way to return values. Both `<expr` and `rt expr` are valid return statements.

---

## Type System

### Scalar Types (both profiles)

| Type | Description |
|------|-------------|
| `i8`, `i16`, `i32`, `i64` | Signed integers |
| `u8`, `u16`, `u32`, `u64` | Unsigned integers |
| `f32`, `f64` | Floating point |
| `bool` | Boolean (`true` / `false`) |
| `void` | Unit type (no return value) |

### Reference Types

| Phase 1 (compiler) | Phase 2 (spec) | Description |
|--------------------|----------------|-------------|
| `Str` | `$str` | String type |
| `Byte` | `$byte` | Byte type |

### User-Defined Types

| Phase 1 (compiler) | Phase 2 (spec) | Description |
|--------------------|----------------|-------------|
| `User` | `$user` | Struct names: uppercase-initial in P1, `$`-prefixed lowercase in P2 |

### Collection Types

| Phase 1 (compiler) | Phase 2 (spec) | Description |
|--------------------|----------------|-------------|
| `[i64]` | `@i64` | Array of i64 |
| `[Str:i64]` | `@($str:i64)` | Map from Str to i64 |

### Error Unions

A function can return a result-or-error type: `i64!MathErr` (Phase 1) or `i64!$matherr` (Phase 2). The `!` after a call expression propagates the error.

### Pointer Types

`*T` denotes a raw pointer -- used only in FFI (`extern`) function signatures.

---

## Syntax Reference

All examples below use **Phase 1 syntax** (what the compiler accepts today). Phase 2 equivalents are noted where the syntax differs.

### Module Declaration

Every source file begins with a module declaration.

```
M=mymodule;
```

Phase 2: `m=mymodule;`

Dotted paths are allowed: `M=std.math;`

### Function Declaration

```
F=name(param1:type1;param2:type2):returntype{
  body
};
```

Phase 2: `f=name(...)...`

Parameters are separated by `;` (not `,`). The function body is enclosed in `{}`. A trailing `;` follows the closing `}`.

### Return Values

Use `<` (short return) or `rt` (long return):

```
F=add(a:i64;b:i64):i64{
  <a+b
};
```

### Let Bindings (Immutable)

```
let x=42;
let name="hello";
```

### Mutable Bindings

Use `mut.` prefix on the initial value:

```
let count=mut.0;
count=count+1;
```

The `mut.` qualifier goes before the expression, separated by a dot. After binding, reassignment uses `name=expr;`.

### If/Else

```
if(condition){
  statements
}el{
  statements
};
```

The condition is in parentheses. Braces are required. `el` is the else keyword.

### Loops

```
lp(let i=0;i<10;i=i+1){
  statements
};
```

Three parts separated by `;`: initialiser, condition, step. Use `br` to break.

### Struct (Type) Declaration

```
T=Vec2{x:i64;y:i64};
```

Phase 2: `t=$vec2{x:i64;y:i64};`

Fields are separated by `;`. The declaration ends with `;`.

### Struct Literals

```
let v=Vec2{x:3;y:4};
```

Phase 2: `let v=$vec2{x:3;y:4};`

### Field Access

```
let px=v.x;
```

Dot notation, same in both profiles.

### Array Literals

```
let nums=[10;20;30];
```

Phase 2: `let nums=@(10;20;30);`

Elements separated by `;`. Empty array: `[]` (P1) or `@()` (P2).

### Array Indexing

```
let first=arr[0];
let nth=arr[i];
```

Phase 2: `let first=arr.0;` (constant) or `let nth=arr.get(i);` (variable).

### Array Length

```
arr.len
```

Same in both profiles.

### Import Declaration

```
I=alias:module.path;
```

Phase 2: `i=alias:module.path;`

### Void Functions

Functions that return nothing use `:void`:

```
F=greet():void{
  let x=42
};
```

### Function Calls

Arguments separated by `;`:

```
let result=add(3;4);
greet();
```

### Type Casting

```
let y=x as f64;
```

### Error Union Functions

```
F=safediv(a:i64;b:i64):i64!MathErr{
  if(b=0){
    <MathErr{msg:"div by zero"}
  };
  <a/b
};
```

The `!` after a return type declares an error union. The `!` after a call propagates errors.

---

## Semicolon Rules

- Statements end with `;`
- The **last statement** before a closing `}` or EOF may **omit** the trailing `;`
- Function arguments use `;` as separator (not `,`)
- Struct fields use `;` as separator
- Array elements use `;` as separator
- Commas do not exist in toke

---

## Comparison Operators

Toke uses single-character comparison:

| Operator | Meaning |
|----------|---------|
| `<` | Less than (also short return -- context-dependent) |
| `>` | Greater than |
| `=` | Equality test (in expression position) / Assignment (in statement position) |

There is no `==`, `!=`, `<=`, or `>=`. The `=` sign serves as both assignment and equality depending on context (assignment is `ident = expr;` at statement level; equality is `expr = expr` inside an expression like `if(x=5)`).

---

## Operator Precedence (lowest to highest)

1. Match expression (`|{...}`)
2. Comparison (`<`, `>`, `=`)
3. Addition/subtraction (`+`, `-`)
4. Multiplication/division (`*`, `/`)
5. Unary (`-`, `!`)
6. Cast (`as`)
7. Error propagation (`!`)
8. Function call (`(...)`)
9. Postfix / field access (`.`)

---

## Diagnostic Error Codes

The compiler emits structured JSON diagnostics with numeric error codes:

| Range | Category | Examples |
|-------|----------|----------|
| E1xxx | Lexer | E1001 invalid escape sequence, E1002 unterminated string, E1003 character outside character set |
| W1xxx | Lexer warnings | W1010 string interpolation not supported in Profile 1 |
| E2xxx | Parser | E2001 declaration ordering, E2002 unexpected token, E2003 missing semicolon, E2004 unclosed delimiter, E2010 pointer outside extern |
| E2xxx | Imports | E2030 unresolved import, E2031 circular import, E2035 malformed version, E2036 no compatible version, E2037 version conflict |
| E3xxx | Name resolution | E3011 identifier not declared, E3012 identifier already declared, E3020 `!` on non-error-union |
| E4xxx | Type checking | E4010 non-exhaustive match, E4011 inconsistent match arm types, E4025 struct has no such field, E4031 type mismatch, E4040-E4043 map type errors, E4060 FFI type mismatch |
| E5xxx | Arena | E5001 value escapes arena scope |
| E9xxx | Backend | E9001 interface file write failed, E9002 LLVM IR emission failed, E9003 clang invocation failed, E9010 compiler limit exceeded |

---

## Source File Structure

A valid toke source file follows this order:

1. Module declaration (exactly one, first)
2. Import declarations (zero or more)
3. Type declarations (zero or more)
4. Constant declarations (zero or more)
5. Function declarations (zero or more)

This ordering is enforced by the parser (E2001).

---

## Complete Working Examples

### Example 1: Addition function

```
M=test;
F=add(a:i64;b:i64):i64{
  <a+b
};
F=main():i64{
  <add(3;4)
};
```

### Example 2: Conditional logic

```
M=test;
F=main():i64{
  let x=5;
  if(x>3){
    <1
  }el{
    <0
  }
};
```

### Example 3: Struct with field access

```
M=test;
T=Vec2{x:i64;y:i64};
F=add(a:Vec2;b:Vec2):Vec2{<Vec2{x:a.x+b.x;y:a.y+b.y}};
F=main():i64{
  let a=Vec2{x:3;y:4};
  let b=Vec2{x:10;y:20};
  let c=add(a;b);
  <c.x
};
```

### Example 4: Mutable variable and loop

```
M=test;
F=counter():i64{
  let n=mut.0;
  n=n+1;
  <n
};
```

### Example 5: Loop with break

```
M=test;
F=findfive():i64{
  lp(let i=0;i<100;i=i+1){
    if(i=5){br};
  };
  <5
};
```

### Example 6: Void function and function call

```
M=t;
F=greet():void{
  let x=42
};
F=main():i64{
  greet();
  <0
};
```

### Example 7: Array and loop (searching)

```
M=test;
F=firstneg(arr:[i64]):i64{
  lp(let i=0;i<arr.len;i=i+1){
    if(arr.get(i)<0){<arr.get(i)};
  };
  <0
};
```

---

## Common Mistakes to Avoid

1. **Using commas instead of semicolons.** Toke uses `;` everywhere: function arguments, struct fields, array elements. There is no `,` character.

2. **Missing `mut.` for mutable variables.** Write `let x=mut.0;` not `let mut x=0;`. The `mut` keyword is followed by a dot and then the initial value expression.

3. **Using `==` for equality.** Toke uses single `=` for both assignment and comparison. Context determines meaning: `if(x=5)` is equality; `x=5;` at statement level is assignment.

4. **Forgetting the `=` after declaration keywords.** Write `M=name;` and `F=func()...` not `M name` or `F func()`. The `=` is part of the declaration syntax.

5. **Wrong return syntax.** Use `<expr` (short return) or `rt expr`. There is no `return` keyword.

6. **Using lowercase `m`/`f`/`t`/`i` with the current compiler.** The compiler currently accepts Phase 1 syntax only: use uppercase `M`, `F`, `T`, `I`.

7. **Putting the type annotation on let bindings.** `let x=42;` is correct. There is no `let x:i64=42;` form -- types are inferred for local bindings.

8. **Forgetting the trailing `;` after `};` on declarations.** Function and type declarations end with `};` -- the semicolon after the closing brace is required (except as the last item in a file where semicolon elision applies).

9. **Using `else` instead of `el`.** The else keyword is abbreviated to `el`.

10. **Using `break` instead of `br`, `loop` instead of `lp`, or `return` instead of `rt`/`<`.** All keywords are abbreviated.
