import { api } from '../core.js';
import { expect, display } from './infra.js';

// some matrix stuff
// let A = [
//     {row: 0, col: 0, value: 1},
//     {row: 0, col: 1, value: 2},
//     {row: 1, col: 0, value: 3},
//     {row: 1, col: 1, value: 4},
// ]
let matA = [[1, 2], [3, 4]]

let batchedMatA = [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]

// B: 2x3
// let B = [
//     {row: 0, col: 0, value: 1},
//     {row: 0, col: 1, value: 2},
//     {row: 0, col: 2, value: 3},
//     {row: 1, col: 0, value: 4},
//     {row: 1, col: 1, value: 5},
//     {row: 1, col: 2, value: 6},
// ]
let matB = [[1, 2, 3], [4, 5, 6]]
let batchedMatB = [[[1, 2, 3], [4, 5, 6]], [[7, 8, 9], [10, 11, 12]]]

let vecA = [1, 2, 3]
let vecB  = [2, 1, 2]

function check(query, expected, testName, inp = { data }) {
    let exec = api.compile(query)
    display(exec.explain)
    let res = exec(inp)
    display(res)
    expect(res, expected, testName)
}

// transpose (can be any permute)
function transposeTest() {
    let transB = {"*j": {"*i": "mat.*i.*j"}}
    
    let expected = {0: {0: 1, 1: 4}, 1: {0: 2, 1: 5}, 2: {0: 3, 1: 6}}
    check(transB, expected, "transposeTest", {mat: matB})
}

function sumTest() {
    let sum = api.sum("mat.*i.*j")
    let expected = 21
    check(sum, expected, "sumTest", {mat: matB})
}

function columnSumTest() {
    // einsum: "ij->j"
    let colSum = {"*j": api.sum("mat.*i.*j")}
    let expected = {0: 5, 1: 7, 2: 9}
    check(colSum, expected, "columnSumTest", {mat: matB})
}

function rowSumTest() {
    // einsum: "ij->i"
    let rowSum = {"*i": api.sum("mat.*i.*j")}
    let expected = {0: 6, 1: 15}
    check(rowSum, expected, "rowSumTest", {mat: matB})
}

function matmulTest() {
    // einsum: "ik,kj->ij"
    let matmul = {"*i": {"*j": api.sum(api.times("A.*i.*k", "B.*k.*j")) }}
    let expected = {0: {0: 9, 1: 12, 2: 15}, 1: {0: 19, 1: 26, 2: 33}}
    check(matmul, expected, "matmulTest", {A: matA, B: matB})
}

function hadamardTest() {
    let hadamard = {"*i": {"*j": api.times("A.*i.*j", "B.*i.*j") }}
    let expected = {0: {0: 1, 1: 4}, 1: {0: 9, 1: 16}}
    check(hadamard, expected, "hadamardTest", {A: matA, B: matA})
}

function dotProduct() {
    let dot = api.sum(api.times("A.*i", "B.*i"))
    let expected = 10
    check(dot, expected, "dotProduct", {A: vecA, B: vecB})
}

function batchedMatmulTest() {
    // ijk,ikl->ijl
    let matmul = {"*i": {"*j": {"*l": api.sum(api.times("A.*i.*j.*k", "B.*i.*k.*l")) }}}
    let expected = {0: {0: {0: 9, 1: 12, 2: 15}, 1: {0: 19, 1: 26, 2: 33}}, 1: {0: {0: 95, 1: 106, 2: 117}, 1: {0: 129, 1: 144, 2: 159}}}
    check(matmul, expected, "matmulTest", {A: batchedMatA, B: batchedMatB})
}

function diagonalTest() {
    // ii -> i
    let diag = {"*i": "A.*i.*i"}
    let expected = {0: 1, 1: 4}
    check(diag, expected, "diagonalTest", {A: matA})
}

transposeTest()
sumTest()
columnSumTest()
rowSumTest()
matmulTest()
dotProduct()
hadamardTest()
batchedMatmulTest()
diagonalTest()
