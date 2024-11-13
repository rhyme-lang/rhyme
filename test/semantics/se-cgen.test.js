const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')


const fs = require('node:fs/promises')
const os = require('node:child_process')
const { typing, types } = require('../../src/typing')


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

let dataInnerObj = typing.createSimpleObject({
    key: types.string,
    value: types.i16
});
let schema = typing.createSimpleObject({
    data: typing.objBuilder()
        .add(typing.createKey(types.string), dataInnerObj)
        .build()
});

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

  let func = compile(query, { backend : "c", schema: schema });
  // console.log(func.explain.code)
  let res = await func({data})

  expect(res).toEqual("undefined")
})

test("testHint1", async () => {
  let query = rh`sum data.*.value` // (hint dense data) &

  let func = compile(query, { backend : "c", schema: typing.createSimpleObject({
    data: typing.createVec("dense", types.string, 1, dataInnerObj),
  }) })
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

  let func = compile(query, { backend : "cpp", schema: schema })
  // console.log(func.explain.code)
  let res = await func({data})

  expect(res).toEqual("40")
}, 10000)
test("testScalar1CPP", async () => {
  let query = rh`sum data.*.value`

  let func = compile(query, { backend : "cpp", schema: schema })
  // console.log(func.explain.code)
  let res = await func({data})

  expect(res).toEqual("70")
}, 10000)

// TODO: Determine what is desired with this test.
// "Data" is indexed by a string, but dense vectors can only be indexed by a number.
/*test("testHint1CPP", async () => {
  let query = rh`sum data.*.value` // Where data is dense

  let func = compile(query, { backend : "cpp", schema: typing.createSimpleObject({
    data: typing.createVec("dense", types.string, 1, dataInnerObj),
  }) })
  // console.log(func.explain.code)
  // console.log(func.explain.pseudo)
  let res = await func({data})

  expect(res).toEqual("70")
}, 10000)*/


test("testHint2VectorCPP", async () => {
  let queryRh = rh`sum(vec.*i)`
  let queryDense = rh`sum(vec.*i)`
  let querySparse = rh`sum(csv.*i)`

  let vec = [0, 0, 10, 20, 30, 0, 0, 0, 40, 50, 0, 0, 0, 0, 0, 60, 0, 0, 70, 0, 0, 80]

  let csv = buildCSV(vec)

  let funcRh = compile(queryRh, { backend : "cpp", schema: typing.createSimpleObject({
    vec: typing.createVec("dense", types.u16, 1, types.u16)
  })});
  let resRh = await funcRh({vec})

  let funcDense = compile(queryDense, { backend : "cpp", schema: typing.createSimpleObject({
    vec: typing.createVec("dense", types.u16, 1, types.u16)
  })});
  let resDense = await funcDense({vec})

  let funcSparse = compile(querySparse, { backend : "cpp", schema: typing.createSimpleObject({
    csv: typing.createVec("sparse", types.u16, 1, types.u16)
  })});
  let resSparse = await funcSparse({csv})

  expect(resRh).toEqual("360")
  expect(resDense).toEqual("360")
  expect(resSparse).toEqual("360")
}, 10000)


test("testHint3MatrixCPP", async () => {
  let queryRh = rh`sum(mat.*i.*j)`
  let queryDense = rh`sum(mat.*i.*j)`
  let querySparse = rh`sum(csr.*i.*j)`

  let mat = [
    [10, 20,  0,  0,  0,  0,  0],
    [ 0, 30,  0, 40,  0,  0,  0],
    [ 0,  0, 50, 60, 70,  0,  0],
    [ 0,  0,  0,  0,  0, 80,  0],
    [ 0,  0,  0,  0,  0,  0,  0],
  ]

  let csr = buildCSR(mat)

  let funcRh = compile(queryRh, { backend : "cpp", schema: typing.createSimpleObject({
    mat: typing.objBuilder()
        .add(typing.createKey(types.string), typing.objBuilder()
            .add(typing.createKey(types.string), types.u16)
            .build())
        .build()
    })
  });
  let resRh = await funcRh({mat})

  let funcDense = compile(queryDense, { backend : "cpp", schema: typing.createSimpleObject({
    mat: typing.createVec("dense", types.u8, 2, types.u16)
  })});
  let resDense = await funcDense({mat})

  let funcSparse = compile(querySparse, { backend : "cpp", schema: typing.createSimpleObject({
    csr: typing.createVec("sparse", types.u8, 2, types.u16)
  })});
  let resSparse = await funcSparse({csr})

  expect(resRh).toEqual("360")
  expect(resDense).toEqual("360")
  expect(resSparse).toEqual("360")
}, 10000)

test("testHint4DotProductCPP", async () => {
  let query = rh`sum(vec1.*i * vec2.*i)`

  let data1 = [0, 0, 10, 20, 30, 0, 0, 0, 40, 50, 0, 0, 0, 0, 0, 60, 0, 0, 70, 0, 0, 80]
  let data2 = [0, 10, 0, 20, 0, 0, 30, 0, 40, 0, 50, 0, 0, 0, 0, 60, 0, 0, 70, 0, 80, 0]

  let vec1 = buildCSV(data1)
  let vec2 = buildCSV(data2)

  tys = typing.createVecs("sparse", types.i32, 1, [types.i32, types.i32])
  let func = compile(query, { backend : "cpp", schema: typing.createSimpleObject({
    vec1: tys[0],
    vec2: tys[1]
  })});
  let res = await func({vec1, vec2})
  expect(res).toEqual("10500")
}, 10000)