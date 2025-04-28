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
