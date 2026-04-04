# Toke Language Instructions

Toke is a compiled, statically typed language designed for LLM-optimised code generation. It uses a minimal character set and short keywords to reduce token counts.

## MCP Tools

Connect to the Toke MCP server to check and compile code. Two tools are available:

- **toke_check** -- validate Toke source code. Pass `source` (string) as the parameter. Returns JSON diagnostics with error code, line, column, message, and fix suggestion.
- **toke_compile** -- compile Toke source to LLVM IR. Pass `source` (string). Returns IR on success, diagnostics on failure.

## Check-Repair Loop

When writing Toke code, always follow this pattern:

1. Generate the `.tk` source using this reference
2. Call `toke_check` with the source content
3. Parse the JSON response for errors
4. Fix each diagnostic using the error code, line number, and fix suggestion
5. Call `toke_check` again with the corrected source
6. Repeat until diagnostics are clean (zero errors)

Never present Toke code as complete without passing it through `toke_check`.

## Character Set — 56 characters

Lowercase `a-z`, digits `0-9`, symbols `( ) { } = : . ; + - * / < > ! | $ @`, reserved `^ ~`, whitespace.

No uppercase letters. No square brackets. `$` marks reference and user-defined types. `@` marks arrays and maps.

## Keywords (12 total)

| Keyword | Role |
|---------|------|
| `m` | Module declaration |
| `f` | Function definition |
| `t` | Struct type definition |
| `i` | Import declaration |
| `if` | Conditional |
| `el` | Else branch |
| `lp` | Loop |
| `br` | Break |
| `let` | Immutable binding |
| `mut` | Mutable qualifier |
| `as` | Type cast |
| `rt` | Return (long form) |

The `<` operator is short-form return (idiomatic). Both `<expr` and `rt expr` are valid.

## Type System

Scalar types: `i8`, `i16`, `i32`, `i64`, `u8`, `u16`, `u32`, `u64`, `f32`, `f64`, `bool`, `void`.

Reference types: `$str` (string), `$byte` (byte).

User-defined types: `$`-prefixed lowercase names (e.g. `$vec2`, `$config`).

Arrays: `@i64` for array of i64. Maps: `@($str:i64)`.

Error unions: `i64!$matherr` -- function returns i64 or $matherr.

## Syntax Reference

### Module (required, must be first)

```
m=mymodule;
```

### Function

```
f=name(param1:type1;param2:type2):returntype{
  body
};
```

Parameters separated by `;` (never `,`). Trailing `;` after `}`.

### Return

```
f=add(a:i64;b:i64):i64{
  <a+b
};
```

### Let Bindings

```
let x=42;
let name="hello";
```

Types are inferred -- there is no `let x:i64=42;` form.

### Mutable Bindings

```
let count=mut.0;
count=count+1;
```

The `mut.` prefix goes before the initial value, separated by a dot.

### If/Else

```
if(condition){
  statements
}el{
  statements
};
```

### Loops

```
lp(let i=0;i<10;i=i+1){
  statements
};
```

Three parts separated by `;`: initialiser, condition, step. Use `br` to break.

### Structs

```
t=$vec2{x:i64;y:i64};
let v=$vec2{x:3;y:4};
let px=v.x;
```

### Arrays

```
let nums=@(10;20;30);
let first=arr.0;
let nth=arr.get(i);
let length=arr.len;
```

Elements separated by `;`. Constant index: `arr.0`. Variable index: `arr.get(i)`.

### Imports

```
i=alias:module.path;
```

### Void Functions

```
f=greet():void{
  let x=42
};
```

### Function Calls

```
let result=add(3;4);
greet();
```

Arguments separated by `;` (never `,`).

### Type Casting

```
let y=x as f64;
```

## Comparison Operators

| Operator | Meaning |
|----------|---------|
| `<` | Less than (also short return -- context-dependent) |
| `>` | Greater than |
| `=` | Equality (in expressions) / Assignment (at statement level) |

There is no `==`, `!=`, `<=`, or `>=`.

## Semicolon Rules

- Statements end with `;`
- The last statement before a closing `}` or EOF may omit the trailing `;`
- Function arguments, struct fields, and array elements use `;` as separator
- Commas do not exist in Toke

## Source File Order

1. Module declaration (exactly one, first)
2. Import declarations
3. Type declarations
4. Constant declarations
5. Function declarations

This order is enforced by the compiler.

## Working Examples

### Example 1: Addition

```
m=test;
f=add(a:i64;b:i64):i64{
  <a+b
};
f=main():i64{
  <add(3;4)
};
```

### Example 2: Conditional Logic

```
m=test;
f=main():i64{
  let x=5;
  if(x>3){
    <1
  }el{
    <0
  }
};
```

### Example 3: Struct with Field Access

```
m=test;
t=$vec2{x:i64;y:i64};
f=add(a:$vec2;b:$vec2):$vec2{<$vec2{x:a.x+b.x;y:a.y+b.y}};
f=main():i64{
  let a=$vec2{x:3;y:4};
  let b=$vec2{x:10;y:20};
  let c=add(a;b);
  <c.x
};
```

### Example 4: Mutable Counter

```
m=test;
f=counter():i64{
  let n=mut.0;
  n=n+1;
  <n
};
```

### Example 5: Array Search

```
m=test;
f=firstneg(arr:@i64):i64{
  lp(let i=0;i<arr.len;i=i+1){
    if(arr.get(i)<0){<arr.get(i)};
  };
  <0
};
f=main():i64{
  let a=@(10;-5;30);
  <firstneg(a)
};
```

## Common Mistakes

1. Using commas instead of semicolons -- Toke uses `;` everywhere
2. Writing `let mut x=0;` instead of `let x=mut.0;`
3. Using `==` for equality -- use single `=` inside expressions
4. Forgetting `=` after keywords -- write `m=name;` not `m name;`
5. Using `return` instead of `<` or `rt`
6. Using uppercase `M`/`F`/`T`/`I` -- declaration keywords are lowercase `m`/`f`/`t`/`i`
7. Adding type annotations to let bindings -- types are inferred
8. Using `else` instead of `el`, `break` instead of `br`, `loop` instead of `lp`
9. Using square brackets for arrays -- use `@(...)` for literals, `@type` for array types
10. Using uppercase type names -- use `$str` not `Str`, `$vec2` not `Vec2`

## Error Code Ranges

| Range | Category |
|-------|----------|
| E1xxx | Lexer errors |
| E2xxx | Parser errors |
| E3xxx | Name resolution |
| E4xxx | Type checking |
| E5xxx | Arena/lifetime |
| E9xxx | Backend/codegen |
