# Rhyme syntax

This describes the textual query syntax — what `` rh`...` `` and
`api.compile("...")` accept — as implemented by `src/parser.js`. It is a
description, not a specification: where the two disagree, the parser wins and
this file is wrong.

Reading order follows the parser: first how text becomes tokens, then how tokens
become expressions. That split matters more than usual here, because several
surprises in the syntax come from the tokenizer rather than from the rules.

**Notation.** `x*` is zero or more, `x+` one or more, `x?` optional, `|`
alternatives, `(...)` grouping, and `"..."` a literal. Whitespace (and comments)
may appear between any two tokens except where a rule says *no gap*.

## Tokens

```
number      →  digit+                                   # unsigned integers only
ident       →  (letter | "_") (letter | digit | "_")*
            |  "*"+ (letter | digit | "_")+             # generator variable: *A, **y
string      →  '"' (any char but '"' or newline)* '"'   # no escape sequences
operator    →  opchar+                                  # longest run, see below
opchar      →  one of  + - * / % < > = ! ? | & ^ ~ :
comment     →  "#" (any char but newline)*              # counts as whitespace
hole        →  "${" ... "}"                             # rh`...` templates only
```

Newlines are ordinary whitespace everywhere except as a `let` terminator.
Anything not matching a token above — `.` `,` `(` `)` `[` `]` `{` `}` — is a
single-character token in its own right.

**Maximal munch.** An operator token is the *longest* run of `opchar`s, so runs
you read as two operators lex as one:

```
{x:-1}      # error: ':-' is one token, so the object never gets its ':'
a *+ b      # error: '*+' is one token
```

Write `{x: -1}` and `a * (+b)`.

**`*` is two things.** A `*`-run followed by an identifier character is an
identifier; otherwise it is an operator. So multiplication written without a
space on the right is not multiplication at all:

```
a * b       # times(a, b)
a*(b)       # times(a, b)     -- '(' cannot continue an identifier
a*b         # apply(a, *b)    -- '*b' is one identifier!
2*3         # apply(2, *3)    -- likewise
```

Put spaces around `*` unless the right operand starts with `(`. Note also that
`**` and `*?` are single operator tokens, so neither can be used as a key.

## Expressions

```
expression  →  let-expr | pipe-expr
pipe-expr   →  application ("|" application)*
application →  binop-expr binop-expr*                   # juxtaposition is a call
binop-expr  →  path (binary-op path)*                   # by precedence, see below
```

Levels, loosest to tightest; every binary operator is left-associative:

| Level | Form | Meaning |
|---|---|---|
| 1 | `x \| f` | pipe: applies `f` to `x` — `x \| sum` is `sum(x)` |
| 2 | `f x y` | application |
| 3 | `a & b` | `and` |
| 4 | `a \|\| b` | `orElse` |
| 5 | `a && b` | `andAlso` |
| 6 | `a < b`, `<=`, `>`, `>=`, `==`, `!=` | comparisons |
| 7 | `a :: b` | `concat` |
| 8 | `a + b`, `a - b` | |
| 9 | `a * b`, `a / b`, `a // b`, `a % b` | `/` is float division, `//` integer |
| 10 | `a.b`, `a[b]`, `a(b)` | paths, below |

Application sitting *between* `|` and every other operator is the unusual part,
and it has a consequence worth internalizing: an argument extends as far right as
any operator except `|` allows.

```
f x & g y       is   f (x & g) y
sum a + b       is   sum (a + b)
a + b | sum     is   sum (a + b)
```

Parenthesize if you want `f x` as an operand.

## `let`

```
let-expr    →  "let" ident ident* "=" binop-expr (";" | newline) expression
```

```
let x = 1; x
let x = [1,2,3]
    {all: x}
let f a b = [a,b]; f 1 2
```

Parameters desugar to nested functions, and the body is the rest of the
expression. Since the right-hand side is a `binop-expr`, it stops at the loosest
operator and cannot be a bare application: `let x = f 1; x` is an error, write
`let x = (f 1); x`. The body after the terminator has no such restriction.

## Paths

```
path        →  ("." key-atom | atom) "?"? accessor*      # no gap between elements
accessor    →  "." key-atom "?"?                         # field access
            |  "[" expression "]"                       # index access
            |  "(" expression ")"                       # call
key-atom    →  number | ident | "*" | hole | "(" expression ")"
```

Two constraints the rules above do not carry:

- **`?` only attaches to an identifier or a field access.** `a?` and `a.b?` mark
  an optional access; `(a+b)?`, `"x"?` and `5?` are errors.
- **A number at the head is terminal.** It is an int or a float and nothing more,
  so no accessor and no `?` may follow: `5.foo`, `1.5.3`, `1.5[0]`, `1(x)` and
  `5?` are all errors. `[1,2][0]` is fine — the head is an array.

**No whitespace inside a path.** A gap ends the path and juxtaposition takes
over, which is how the same characters mean two different things:

```
f.a         # field access:  inp.f.a
f .a        # application:   f(inp.a)
a. b        # error
a + f(x)    # a + f(x)      -- the call is part of the path, so it binds tight
a + f (x)   # (a + f)(x)    -- the gap ends the path, and application is looser than '+'
```

**Heads.** A path may start with an atom, or with a leading `.` for a field of the
implicit input: `.input` is `inp.input`, and `.*.value` iterates it. A bare
identifier head is also read against the input once the path continues, so `a.b`
is `inp.a.b`, and `*.foo` and `.*.foo` are the same path.

**Keys are narrower than expressions.** After a `.` only a `key-atom` is allowed
— no strings, arrays or objects:

```
a.1  a.b  a.*  a.${k}  a.(f x)      # fine
a."x"   a.[1]   a.{x:1}             # errors -- write a["x"], a[[1]], ...
```

## Atoms

```
atom        →  number ("." number)?                     # 42, 1.5
            |  string | ident | "*" | hole
            |  "(" expression ")"
            |  array
            |  object
array       →  "[" (expression ("," expression)*)? "]"
object      →  "{" (entry ("," entry)*)? "}"
entry       →  expression (":" expression)?             # shorthand: {x} is {x: x}
```

`true` and `false` lex as identifiers and become boolean constants. A float is
two number tokens joined by `.`, so `1.5` is an atom but `1.5.3` is not. Object
keys are full expressions, not just names, and a trailing comma is allowed in
neither literal.

## Where this lives in the code

`src/parser.js` has one function per rule above:

| Rule | Function |
|---|---|
| expression | `expr` |
| let-expr | `letExpr` |
| pipe-expr | `pipe` |
| application | `application` |
| binop-expr | `binop`, over the `binops` table and `climb` |
| path, accessor | `path` |
| key-atom | `keyAtom` |
| atom, array, object | `atom`, `array`, `object` |
| tokens | `read`, `whitespace` |

Precedence and associativity live in the `binops` table at the top of that file;
the level table above is that table plus application and paths, which are
structural rather than table-driven.
