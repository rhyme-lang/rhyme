import { api } from '../core.js';
import { expect } from './infra.js';

// some matrix stuff
// let A = [
//     {row: 0, col: 0, value: 1},
//     {row: 0, col: 1, value: 2},
//     {row: 1, col: 0, value: 3},
//     {row: 1, col: 1, value: 4},
// ]
let A = [[1, 2], [3, 4]]

// B: 2x3
// let B = [
//     {row: 0, col: 0, value: 1},
//     {row: 0, col: 1, value: 2},
//     {row: 0, col: 2, value: 3},
//     {row: 1, col: 0, value: 4},
//     {row: 1, col: 1, value: 5},
//     {row: 1, col: 2, value: 6},
// ]
let B = [[1, 2, 3], [4, 5, 6]]

// transpose
function transposeTest() {
    let transB = {"*j": {"*i": "mat.*i.*j"}}
    let exec = api.compile(transB)
    let res = exec({mat: B})
    console.log(res)
}


function matmulTest() {
    // einsum: "ik,kj->ij"
    let matmul = {"*i": {"*j": api.sum(api.times("A.*i.*k", "B.*k.*j")) }}
    let exec = api.compile(matmul)
    let res = exec({A, B})
    console.log(res)
}

// transposeTest()
matmulTest()
