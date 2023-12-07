const { parse2 } = require('../src/parser')
const api = require('../src/rhyme')

let parse = parse2

function ast_ident(a) {
    return { xxpath: "ident", xxparam: a }
}
function ast_raw(a) {
    return { xxpath: "raw", xxparam: a }
}
function ast_plus(a,b) {
    return { xxpath: "+", xxparam: [a,b] }
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
