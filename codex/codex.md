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

## Keywords (12 total)

| Keyword | Role |
|---------|------|
| `M` | Module declaration |
| `F` | Function definition |
| `T` | Struct type definition |
| `I` | Import declaration |
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

Reference types: `Str` (string), `Byte` (byte).

User-defined types: uppercase-initial names (e.g. `Vec2`).

Arrays: `[i64]` for array of i64. Maps: `[Str:i64]`.

Error unions: `i64!MathErr` -- function returns i64 or MathErr.

## Syntax Reference

### Module (required, must be first)

```
M=mymodule;
```

### Function

```
F=name(param1:type1;param2:type2):returntype{
  body
};
```

Parameters separated by `;` (never `,`). Trailing `;` after `}`.

### Return

```
F=add(a:i64;b:i64):i64{
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
T=Vec2{x:i64;y:i64};
let v=Vec2{x:3;y:4};
let px=v.x;
```

### Arrays

```
let nums=[10;20;30];
let first=arr[0];
let length=arr.len;
```

Elements separated by `;`.

### Imports

```
I=alias:module.path;
```

### Void Functions

```
F=greet():void{
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
M=test;
F=add(a:i64;b:i64):i64{
  <a+b
};
F=main():i64{
  <add(3;4)
};
```

### Example 2: Conditional Logic

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

### Example 3: Struct with Field Access

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

### Example 4: Mutable Counter

```
M=test;
F=counter():i64{
  let n=mut.0;
  n=n+1;
  <n
};
```

### Example 5: Array Indexing

```
M=test;
F=get(arr:[i64];i:i64):i64{
  <arr[i]
};
F=main():i64{
  let a=[10;20;30];
  <get(a;1)
};
```

## Common Mistakes

1. Using commas instead of semicolons -- Toke uses `;` everywhere
2. Writing `let mut x=0;` instead of `let x=mut.0;`
3. Using `==` for equality -- use single `=` inside expressions
4. Forgetting `=` after keywords -- write `M=name;` not `M name;`
5. Using `return` instead of `<` or `rt`
6. Using lowercase `m`/`f`/`t`/`i` -- the compiler requires uppercase `M`/`F`/`T`/`I`
7. Adding type annotations to let bindings -- types are inferred
8. Using `else` instead of `el`, `break` instead of `br`, `loop` instead of `lp`

## Error Code Ranges

| Range | Category |
|-------|----------|
| E1xxx | Lexer errors |
| E2xxx | Parser errors |
| E3xxx | Name resolution |
| E4xxx | Type checking |
| E5xxx | Arena/lifetime |
| E9xxx | Backend/codegen |
