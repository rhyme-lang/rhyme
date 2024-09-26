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