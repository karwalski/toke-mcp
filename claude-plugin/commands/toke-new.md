# /toke:new — Scaffold a New Toke Project

Create a minimal Toke project with a module, main function, and Makefile.

## Steps

1. Ask the user for a project name. If they already provided one (e.g., `/toke:new myproject`), use that.

2. Create a directory with the project name in the current working directory.

3. Create `<project>/main.tk` with this content:

```
m=<project>;
f=main():i64{
  <0
};
```

Replace `<project>` with the actual project name.

4. Create `<project>/Makefile` with this content:

```makefile
TKC ?= tkc

.PHONY: check build clean

check:
	$(TKC) --check --diag-json main.tk

build:
	$(TKC) -o main main.tk

clean:
	rm -f main *.o *.ll *.ifc
```

5. Call the `toke_check` MCP tool with the contents of `main.tk` to verify it compiles cleanly.

6. Report the created files and confirm the project is ready:
   - `<project>/main.tk` — entry point
   - `<project>/Makefile` — build commands (`make check`, `make build`, `make clean`)
