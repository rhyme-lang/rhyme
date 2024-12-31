const { parse, rh } = require('../../src/parser')
const { api } = require('../../src/rhyme')

function ast_ident(a) {
    return { xxkey: "ident", xxparam: [], xxop: a }
}
function ast_raw(a) {
    return { xxkey: "raw", xxparam: [], xxop: a }
}
function ast_plus(a,b) {
    return { xxkey: "plus", xxparam: [a,b] }
}
function ast_get(a,b) {
    return { xxkey: "get", xxparam: [a,b] }
}
function ast_apply(a,b) {
    return { xxkey: "apply", xxparam: [a,b] }
}
function ast_array(as) {
    return { xxkey: "array", xxparam: as }
}
function ast_object(as) {
    return { xxkey: "object", xxparam: as }
}


test("pathTest1", () => {
    let res = parse("a")
    let expected = ast_ident("a")
    expect(res).toEqual(expected)
})

test("pathTest2", () => {
    let res = parse("a + b // comment")
    let a = ast_ident("a")
    let b = ast_ident("b")
    let expected = ast_plus(a,b)
    expect(res).toEqual(expected)
})

test("pathTest3", () => {
    let res = parse("a.*.*c")
    let root = ast_raw("inp")
    let a = ast_ident("a")
    let b = ast_ident("*")
    let c = ast_ident("*c")
    let expected = ast_get(ast_get(ast_get(root, a), b), c)
    expect(res).toEqual(expected)
})

test("pathTest4", () => {
    let res = parse("(a)[b](c)")
    let root = ast_raw("inp")
    let a = ast_ident("a")
    let b = ast_ident("b")
    let c = ast_ident("c")
    let expected = ast_apply(ast_get(ast_get(root, a), b), c)
    expect(res).toEqual(expected)
})

test("templateTest1", () => {
    let res = rh`a.b.c`
    let root = ast_raw("inp")
    let a = ast_ident("a")
    let b = ast_ident("b")
    let c = ast_ident("c")
    let expected = ast_get(ast_get(ast_get(root, a), b), c)
    expect(res).toEqual(expected)
})

test("templateTest2", () => {
    let a = { foo: "bar" }
    let res = rh`${a}.b.c`
    let b = ast_ident("b")
    let c = ast_ident("c")
    let expected = ast_get(ast_get(a, b), c)
    expect(res).toEqual(expected)
})

test("templateTest3", () => {
    let a = { foo: "bar" }
    let b = rh`b`
    // let res = rh`${a}.${b}.c` <-- this currently isn't allowed -- should it be?
    let res = rh`${a}[${b}].c`
    let c = ast_ident("c")
    let expected = ast_get(ast_get(a, b), c)
    expect(res).toEqual(expected)
})

test("templateTest4", () => {
    let a = { foo: "bar" }
    let b = rh`b`
    let res = rh`${a}.${b}.c` // <-- this is now allowed
    let c = ast_ident("c")
    let expected = ast_get(ast_get(a, b), c)
    expect(res).toEqual(expected)
})


test("stringTest1", () => {
    let res = parse('"a"')
    let expected = ast_ident("a") // test stripping of quotes
    expect(res).toEqual(expected)
})


test("arrayTest0", () => {
    let res = parse("[]")
    let expected = ast_array([])
    expect(res).toEqual(expected)
})

test("arrayTest1", () => {
    let res = parse("[a,b,c]")
    let expected = ast_array([
        ast_ident("a"),
        ast_ident("b"),
        ast_ident("c")])
    expect(res).toEqual(expected)
})

test("objectTest0", () => {
    let res = parse("{}")
    let expected = ast_object([])
    expect(res).toEqual(expected)
})

test("objectTest1", () => {
    let res = parse("{a,b,c}")
    let expected = ast_object([
        ast_ident("a"), ast_ident("a"),
        ast_ident("b"), ast_ident("b"),
        ast_ident("c"), ast_ident("c")])
    expect(res).toEqual(expected)
})

test("objectTest2", () => {
    let res = parse("{a:a1,b:b1,c:c1}")
    let expected = ast_object([
        ast_ident("a"), ast_ident("a1"),
        ast_ident("b"), ast_ident("b1"),
        ast_ident("c"), ast_ident("c1")])
    expect(res).toEqual(expected)
})
