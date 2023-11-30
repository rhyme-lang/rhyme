const { api } = require('../src/rhyme')

// sample tensors for testing
// A: 2x2
let matA = [[1, 2], [3, 4]]
let batchedMatA = [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]

// B: 2x3
let matB = [[1, 2, 3], [4, 5, 6]]
let batchedMatB = [[[1, 2, 3], [4, 5, 6]], [[7, 8, 9], [10, 11, 12]]]

let vecA = [1, 2, 3]
let vecB  = [2, 1, 2]

test("transpose", () => {
    let query = {"*j": {"*i": "mat.*i.*j"}}
    let res = api.compile(query)({ mat: matB })
    let expected = {0: {0: 1, 1: 4}, 1: {0: 2, 1: 5}, 2: {0: 3, 1: 6}}
    expect(res).toEqual(expected)
})

test("sum", () => {
    let query = api.sum("mat.*i.*j")
    let res = api.compile(query)({ mat: matB })
    let expected = 21
    expect(res).toEqual(expected)
})

test("columnSum", () => {
    // einsum: "ij->j"
    let query = {"*j": api.sum("mat.*i.*j")}
    let res = api.compile(query)({ mat: matB })
    let expected = {0: 5, 1: 7, 2: 9}
    expect(res).toEqual(expected)
})

test("rowSum", () => {
    // einsum: "ij->i"
    let query = {"*i": api.sum("mat.*i.*j")}
    let res = api.compile(query)({ mat: matB })
    let expected = {0: 6, 1: 15}
    expect(res).toEqual(expected)
})

test("matmul", () => {
    // einsum: "ik,kj->ij"
    let query = {"*i": {"*j": api.sum(api.times("A.*i.*k", "B.*k.*j")) }}
    let res = api.compile(query)({ A: matA, B: matB })
    let expected = {0: {0: 9, 1: 12, 2: 15}, 1: {0: 19, 1: 26, 2: 33}}
    expect(res).toEqual(expected)
})

test("hadamard", () => {
    // einsum: "ij,ij->ij"
    let query = {"*i": {"*j": api.times("A.*i.*j", "B.*i.*j") }}
    let res = api.compile(query)({ A: matA, B: matA })
    let expected = {0: {0: 1, 1: 4}, 1: {0: 9, 1: 16}}
    expect(res).toEqual(expected)
})

test("dotProduct", () => {
    let query = api.sum(api.times("A.*i", "B.*i"))
    let res = api.compile(query)({ A: vecA, B: vecB })
    let expected = 10
    expect(res).toEqual(expected)
})

test("batchedMatmul", () => {
    // einsum: ijk,ikl->ijl
    let query = {"*i": {"*j": {"*l": api.sum(api.times("A.*i.*j.*k", "B.*i.*k.*l")) }}}
    let res = api.compile(query)({ A: batchedMatA, B: batchedMatB })
    let expected = {0: {0: {0: 9, 1: 12, 2: 15}, 1: {0: 19, 1: 26, 2: 33}}, 1: {0: {0: 95, 1: 106, 2: 117}, 1: {0: 129, 1: 144, 2: 159}}}
    expect(res).toEqual(expected)
})

test("diagonal", () => {
    // einsum: ii -> i
    let query = {"*i": "A.*i.*i"}
    let res = api.compile(query)({ A: matA })
    let expected = {0: 1, 1: 4}
    expect(res).toEqual(expected)
})