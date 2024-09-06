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

