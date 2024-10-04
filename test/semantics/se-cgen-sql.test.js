const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')


const fs = require('node:fs/promises')
const os = require('node:child_process')


// ---------- begin C gen tests -------- //

let data = [
  { key: "A", value: 10 },
  { key: "B", value: 20 },
  { key: "A", value: 30 }
]

let execPromise = function (cmd) {
  return new Promise(function (resolve, reject) {
    os.exec(cmd, function (err, stdout) {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}


test("testRoundtrip0", async () => {
  let content = `#include <stdio.h>
int main() {
  puts("Hello C!");

  return 0;
}
`

  await fs.writeFile('out/sql.c', content);
  await execPromise('gcc out/sql.c -o out/sql')
  let res = await execPromise('out/sql')

  expect(res).toEqual("Hello C!\n")
})

test("testExample", async () => {
  await execPromise('gcc cgen-sql/example.c -o out/example')
  let res = await execPromise('out/example cgen-sql/small_example.csv')

  expect(res).toEqual("41\n")
})

test("testSimpleSum0", async () => {
  // Currently using an object to represent CSV filename and schema
  let schema = ["Phrase", "Year", "MatchCount", "VolumeCount"]

  let query = rh`sum .*.VolumeCount`

  let func = compile(query, { backend: "c-sql", csvSchema: schema })

  let res = await func("cgen-sql/small_example.csv")
  expect(res).toEqual("41\n")
})

// test("testSimpleSum1", async () => {
//   // Currently using an object to represent CSV filename and schema
//   let schema = ["Phrase", "Year", "MatchCount", "VolumeCount"]

//   let query = rh`sum .*.VolumeCount`

//   let func = compile(query, { backend: "c-sql", csvSchema: schema })

//   let res = await func("out/example.csv")
//   console.log(res)
// })
