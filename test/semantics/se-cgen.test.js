const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')


const fs = require('node:fs/promises')
const os = require('node:child_process')


// ---------- begin C gen tests -------- //


let execPromise = function(cmd) {
    return new Promise(function(resolve, reject) {
        os.exec(cmd, function(err, stdout) {
            if (err) return reject(err);
            resolve(stdout);
        });
    });
}

let buildCSV = vec => {
  let data = []
  let cols = []
  let start = 0
  for (let x in vec) {
    if (vec[x]) {
      cols.push(Number(x))
      data.push(vec[x])
    }
  }
  let end = data.length
  return {data, cols, start, end}
}

let buildCSR = mat => {
  let data = []
  let cols = []
  let rows = []
  for (let y in mat) {
    rows.push(data.length)
    for (let x in mat[y]) {
      if (mat[y][x]) {
        cols.push(Number(x))
        data.push(mat[y][x])
      }
    }
  }
  return {data, cols, rows}
}

test("testRoundtrip0", async () => {
  let content =
`#include <stdio.h>
#include "rhyme.h"
int main() {
  puts("Hello C!");
}
`
  await fs.writeFile('cgen/test.c', content);
  await execPromise('gcc cgen/test.c -o cgen/test.out')
  let res = await execPromise('cgen/test.out')

  expect(res).toEqual("Hello C!\n")
})


let data = {}

test("testTrivial0", async () => {
  let query = rh`1 + 4`

  let func = compile(query, { backend : "c" })
  // console.log(func.explain.code)
  let res = await func({data})

  expect(res).toEqual("5")
})


// XXX TODO:
// - access input data
// - string, array/obj
// - implement assignments

test("testTrivial1", async () => {
  let query = rh`data.A.value`

  let func = compile(query, { backend : "c" })
  // console.log(func.explain.code)
  let res = await func({data})

  expect(res).toEqual("undefined")
})

test("testScalar1", async () => {
  let query = rh`sum data.*.value`

  let func = compile(query, { backend : "c" })
  // console.log(func.explain.code)
  let res = await func({data})

  expect(res).toEqual("undefined")
})

test("testHint1", async () => {
  let query = rh`(hint dense data) & (sum data.*.value)`

  let func = compile(query, { backend : "c" })
  // console.log(func.explain.code)
  // console.log(func.explain.pseudo)
  let res = await func({data})

  expect(res).toEqual("undefined")
})

data = {
  A: { key: "U", value: 40 },
  B: { key: "U", value: 20 },
  C: { key: "V", value: 10 },
}

test("testTrivial1CPP", async () => {
  let query = rh`data.A.value`

  let func = compile(query, { backend : "cpp" })
  // console.log(func.explain.code)
  let res = await func({data})

  expect(res).toEqual("40")
}, 10000)

test("testScalar1CPP", async () => {
  let query = rh`sum data.*.value`

  let func = compile(query, { backend : "cpp" })
  // console.log(func.explain.code)
  let res = await func({data})

  expect(res).toEqual("70")
}, 10000)

test("testHint1CPP", async () => {
  let query = rh`(hint dense data) & (sum data.*.value)`

  let func = compile(query, { backend : "cpp" })
  // console.log(func.explain.code)
  // console.log(func.explain.pseudo)
  let res = await func({data})

  expect(res).toEqual("70")
}, 10000)

test("testHint2VectorCPP", async () => {
  let queryRh = rh`sum(vec.*i)`
  let queryDense = rh`(hint vec \"dense,1d,int\") & sum(vec.*i)`
  let querySparse = rh`(hint csv \"sparse,1d,int\") & sum(csv.*i)`

  let vec = [0, 0, 10, 20, 30, 0, 0, 0, 40, 50, 0, 0, 0, 0, 0, 60, 0, 0, 70, 0, 0, 80]

  let csv = buildCSV(vec)

  let funcRh = compile(queryRh, { backend : "cpp" })
  let resRh = await funcRh({vec})

  let funcDense = compile(queryDense, { backend : "cpp" })
  let resDense = await funcDense({vec})

  let funcSparse = compile(querySparse, { backend : "cpp" })
  let resSparse = await funcSparse({csv})

  expect(resRh).toEqual("360")
  expect(resDense).toEqual("360")
  expect(resSparse).toEqual("360")
}, 10000)

test("testHint3MatrixCPP", async () => {
  let queryRh = rh`sum(mat.*i.*j)`
  let queryDense = rh`(hint mat \"dense,2d,int\") & sum(mat.*i.*j)`
  let querySparse = rh`(hint csr \"sparse,2d,int\") & sum(csr.*i.*j)`

  let mat = [
    [10, 20,  0,  0,  0,  0,  0],
    [ 0, 30,  0, 40,  0,  0,  0],
    [ 0,  0, 50, 60, 70,  0,  0],
    [ 0,  0,  0,  0,  0, 80,  0],
    [ 0,  0,  0,  0,  0,  0,  0],
  ]

  let csr = buildCSR(mat)

  let funcRh = compile(queryRh, { backend : "cpp" })
  let resRh = await funcRh({mat})

  let funcDense = compile(queryDense, { backend : "cpp" })
  let resDense = await funcDense({mat})

  let funcSparse = compile(querySparse, { backend : "cpp" })
  let resSparse = await funcSparse({csr})

  expect(resRh).toEqual("360")
  expect(resDense).toEqual("360")
  expect(resSparse).toEqual("360")
}, 10000)