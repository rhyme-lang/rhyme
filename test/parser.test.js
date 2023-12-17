const { parse, rh } = require('../src/parser')
const { api } = require('../src/rhyme')

function ast_ident(a) {
    return { xxpath: "ident", xxparam: a }
}
function ast_raw(a) {
    return { xxpath: "raw", xxparam: a }
}
function ast_plus(a,b) {
    return { xxpath: "plus", xxparam: [a,b] }
}
function ast_get(a,b) {
    return { xxpath: "get", xxparam: [a,b] }
}
function ast_apply(a,b) {
    return { xxpath: "apply", xxparam: [a,b] }
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
    let res = rh`${a}.${b}.c` // <-- this currently isn't allowed -- should it be?
    // let res = rh`${a}[${b}].c`
    let c = ast_ident("c")
    let expected = ast_get(ast_get(a, b), c)
    expect(res).toEqual(expected)
})
