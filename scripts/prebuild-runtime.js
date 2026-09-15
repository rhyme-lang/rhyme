#!/usr/bin/env node
// Build the C runtime's compiled dependencies into the shared cache, so that
// the first query of a run does not pay for it. CI wants this before `npm
// test`: jest allows a few seconds per test and compiling yyjson.c can use
// that up on its own, in every worker process.

const { prepareRuntime } = require('../src/cgen/codegen')

let compiler = process.env.CC || "gcc"

let t0 = Date.now()
prepareRuntime({ compiler }).then(obj => {
  console.log(`runtime ready in ${Date.now() - t0}ms: ${obj}`)
}).catch(e => {
  // not fatal for a build: the compiler falls back to building yyjson.c
  // alongside the query, it is just slower
  console.error(`could not prebuild the C runtime (${e.message.split("\n")[0]})`)
  console.error(`queries will compile yyjson from source instead`)
})
