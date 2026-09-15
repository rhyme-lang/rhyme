const { parse } = require('../../src/parser')
const { ast } = require('../../src/shared')
const { api, rh } = require('../../src/rhyme')


test("pathTest1", () => {
    let res = parse("a")
    let expected = ast.ident("a")
    expect(res.rhyme_ast).toEqual(expected)
})

// test("pathTest2", () => {
//     let res = parse("a + b // comment")
//     let a = ast.ident("a")
//     let b = ast.ident("b")
//     let expected = ast.plus(a,b)
//     expect(res.rhyme_ast).toEqual(expected)
// })

test("pathTest3", () => {
    let res = parse("a.*.*c")
    let root = ast.raw("inp")
    let a = ast.ident("a")
    let b = ast.ident("*")
    let c = ast.ident("*c")
    let expected = ast.get(ast.get(ast.get(root, a), b), c)
    expect(res.rhyme_ast).toEqual(expected)
})

test("pathTest4", () => {
    let res = parse("(a)[b](c)")
    let root = ast.raw("inp")
    let a = ast.ident("a")
    let b = ast.ident("b")
    let c = ast.ident("c")
    let expected = ast.apply(ast.get(ast.get(root, a), b), c)
    expect(res.rhyme_ast).toEqual(expected)
})

test("templateTest1", () => {
    let res = rh`a.b.c`
    let root = ast.raw("inp")
    let a = ast.ident("a")
    let b = ast.ident("b")
    let c = ast.ident("c")
    let expected = ast.get(ast.get(ast.get(root, a), b), c)
    expect(res.rhyme_ast).toEqual(expected)
})

test("templateTest2", () => {
    let a = { foo: "bar" }
    let res = rh`${a}.b.c`
    let b = ast.ident("b")
    let c = ast.ident("c")
    let expected = ast.get(ast.get(ast.hole(a), b), c)
    expect(res.rhyme_ast).toEqual(expected)
})

test("templateTest3", () => {
    let a = { foo: "bar" }
    let b = rh`b`
    // let res = rh`${a}.${b}.c` <-- this currently isn't allowed -- should it be?
    let res = rh`${a}[${b}].c`
    let c = ast.ident("c")
    let expected = ast.get(ast.get(ast.hole(a), b.rhyme_ast), c)
    expect(res.rhyme_ast).toEqual(expected)
})

test("templateTest4", () => {
    let a = { foo: "bar" }
    let b = rh`b`
    let res = rh`${a}.${b}.c` // <-- this is now allowed
    let c = ast.ident("c")
    let expected = ast.get(ast.get(ast.hole(a), b.rhyme_ast), c)
    expect(res.rhyme_ast).toEqual(expected)
})


test("stringTest1", () => {
    let res = parse('"a"')
    let expected = ast.str("a") // test stripping of quotes
    expect(res.rhyme_ast).toEqual(expected)
})


test("arrayTest0", () => {
    let res = parse("[]")
    let expected = ast.array([])
    expect(res.rhyme_ast).toEqual(expected)
})

test("arrayTest1", () => {
    let res = parse("[a,b,c]")
    let expected = ast.array([
        ast.ident("a"),
        ast.ident("b"),
        ast.ident("c")])
    expect(res.rhyme_ast).toEqual(expected)
})

test("objectTest0", () => {
    let res = parse("{}")
    let expected = ast.object([])
    expect(res.rhyme_ast).toEqual(expected)
})

test("objectTest1", () => {
    let res = parse("{a,b,c}")
    let expected = ast.object([
        ast.ident("a"), ast.ident("a"),
        ast.ident("b"), ast.ident("b"),
        ast.ident("c"), ast.ident("c")])
    expect(res.rhyme_ast).toEqual(expected)
})

test("objectTest2", () => {
    let res = parse("{a:a1,b:b1,c:c1}")
    let expected = ast.object([
        ast.ident("a"), ast.ident("a1"),
        ast.ident("b"), ast.ident("b1"),
        ast.ident("c"), ast.ident("c1")])
    expect(res.rhyme_ast).toEqual(expected)
})


// ---------- paths: what may follow a '.' ----------

test("pathKeyAtomTest", () => {
    let root = ast.raw("inp")
    let a = ast.get(root, ast.ident("a"))
    // numbers, identifiers, '*' and parenthesized expressions are keys
    expect(parse("a.1").rhyme_ast).toEqual(ast.get(a, ast.num(1)))
    expect(parse("a.b").rhyme_ast).toEqual(ast.get(a, ast.ident("b")))
    expect(parse("a.*").rhyme_ast).toEqual(ast.get(a, ast.ident("*")))
    expect(parse("a.(b)").rhyme_ast).toEqual(ast.get(a, ast.ident("b")))
})

test("pathKeyRejectTest", () => {
    // strings, arrays and objects are not keys -- use a["x"] instead
    expect(() => parse('a."x"')).toThrow(/field name expected/)
    expect(() => parse("a.[1]")).toThrow(/field name expected/)
    expect(() => parse("a.{x:1}")).toThrow(/field name expected/)
    expect(() => parse("a.+")).toThrow(/field name expected/)
})

test("pathNoSpaceTest", () => {
    // a gap ends the path: 'a. b' is neither field access nor application
    expect(() => parse("a. b")).toThrow(/no space allowed after '\.'/)
    expect(() => parse(". b")).toThrow(/no space allowed after '\.'/)
})

test("wildcardHeadTest", () => {
    let root = ast.raw("inp")
    // a bare '*' is an operand at the head of a path, e.g. api.get(o, "*")
    expect(parse("*").rhyme_ast).toEqual(ast.ident("*"))
    expect(parse("*A").rhyme_ast).toEqual(ast.ident("*A"))
    expect(parse("[*,1]").rhyme_ast).toEqual(ast.array([ast.ident("*"), ast.num(1)]))
    // '*.foo' is the same path as '.*.foo': a head ident gets wrapped in inp
    expect(parse("*.foo").rhyme_ast).toEqual(parse(".*.foo").rhyme_ast)
    expect(parse("*.foo").rhyme_ast).toEqual(
        ast.get(ast.get(root, ast.ident("*")), ast.ident("foo")))
})

test("wildcardOperatorTest", () => {
    // in operator position it is multiplication, never application:
    // 'a * b' can't reach the atom rule, and 'f *' has no right operand
    expect(parse("a * b").rhyme_ast).toEqual(
        { xxkey: "times", xxparam: [ast.ident("a"), ast.ident("b")] })
    expect(() => parse("f *")).toThrow(/atom expected/)
    // parens are the way to apply something to a bare '*'
    expect(parse("f (*)").rhyme_ast).toEqual(ast.apply(ast.ident("f"), ast.ident("*")))
    // '**' and '*?' lex as single operator tokens, so they stay errors
    expect(() => parse("**")).toThrow(/atom expected/)
    expect(() => parse("*?")).toThrow(/atom expected/)
})


// ---------- numbers are terminal at the head of a path ----------

test("numberLiteralTest", () => {
    expect(parse("5").rhyme_ast).toEqual(ast.num(5))
    expect(parse("1.5").rhyme_ast).toEqual(ast.num(1.5))
    expect(parse("[1,2][0]").rhyme_ast).toEqual( // array head still works
        ast.get(ast.array([ast.num(1), ast.num(2)]), ast.num(0)))
})

test("numberNotAPathTest", () => {
    expect(() => parse("5.foo")).toThrow(/number expected/)
    expect(() => parse("1.5.3")).toThrow(/cannot be followed by/)
    expect(() => parse("1.5[0]")).toThrow(/cannot be followed by/)
    expect(() => parse("1(x)")).toThrow(/cannot be followed by/)
    expect(() => parse("5?")).toThrow(/cannot be followed by/)
})


// ---------- '?' postfix ----------

test("optionalTest", () => {
    let root = ast.raw("inp")
    expect(parse("a?").rhyme_ast).toEqual(ast.ident("a?"))
    expect(parse("a.b?").rhyme_ast).toEqual(
        { xxkey: "get?", xxparam: [{ xxkey: "get?", xxparam: [root, ast.ident("a")] }, ast.ident("b")] })
    // meaningless anywhere else -- used to build an apply of an undefined '?'
    expect(() => parse("(a+b)?")).toThrow(/identifier or field access/)
    expect(() => parse('"x"?')).toThrow(/identifier or field access/)
})


// ---------- constants ----------

test("boolTest", () => {
    expect(parse("true").rhyme_ast).toEqual(ast.num(true))
    expect(parse("false").rhyme_ast).toEqual(ast.num(false))
})


// ---------- let ----------

test("letTerminatorTest", () => {
    let semi = parse("let x = 1; x")
    let newline = parse("let x = 1\n x") // newline terminates just as ';' does
    expect(newline.rhyme_ast).toEqual(semi.rhyme_ast)
    expect(() => parse("let x = 1 x")).toThrow(/';' or newline expected/)
})
