const value = require("../../src/cgen/value/value")
const { typing, types } = require('../../src/typing')
const { c } = require("../../src/cgen/utils")

const fs = require("fs").promises
const os = require("child_process")

let sh = (cmd) => {
  return new Promise((resolve, reject) => {
    os.exec(cmd, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        resolve(stdout)
      }
    })
  })
}

let outDir = "cgen-sql/out/value/"

let prolog = ["#include \"rhyme-c.h\"", "int main() {"]
let epilog = ["return 0;", "}"]

beforeAll(async () => {
  await sh(`rm -rf ${outDir}`)
  await sh(`mkdir -p ${outDir}`)
  // await sh(`cp cgen-sql/yyjson.h ${outDir}`)
})

let cmd = (cFile, exec) => `gcc ${cFile} -o ${exec} -Icgen-sql`

let run = async (out, code) => {
  code = [...prolog, ...code, ...epilog]
  let exec = outDir + out
  let cFile = exec + ".c"
  await fs.writeFile(cFile, code.join("\n"))
  await sh(cmd(cFile, exec))
  return sh("./" + exec)
}

test("testBasic", async () => {
  let code = []
  c.declareVar(code)("uint32_t", "x", "0")
  let int = value.primitive(types.i32, "x")
  let two = value.primitive(types.i32, "2")
  int.assign(code, two)

  c.declareConstCharPtr(code)("str", "\"hello\"")
  c.declareInt(code)("len", "5")
  let str = value.string(types.string, "str", "len")
  let hello = value.string(types.string, "\"hello\"", "5")
  str.assign(code, hello)

  int.printJSON(code)
  c.printf(code)("\\n")
  str.printJSON(code)

  let res = await run("testBasic", code)
  expect(res.split("\n").map(JSON.parse)).toEqual([2, "hello"])
})

test("testArray1", async () => {
  let arr = value.array(typing.parseType("{*u32:u32}"), "arr", 32, false)
  arr.addColumn("_DEFAULT_", types.u32)

  let code = []
  arr.declare(code)
  arr.insert(code, value.primitive(types.u32, "1"))
  arr.insert(code, value.primitive(types.u32, "2"))
  arr.insert(code, value.primitive(types.u32, "3"))
  arr.insert(code, value.primitive(types.u32, "4"))

  arr.printJSON(code)

  let res = await run("testArray1", code)
  expect(JSON.parse(res)).toEqual([1, 2, 3, 4])
})

test("testArray2", async () => {
  let arr = value.array(typing.parseType("{*u32:string}"), "arr", 64, false)
  arr.addColumn("_DEFAULT_", types.string)

  let code = []
  arr.declare(code)
  arr.insert(code, value.string(types.string, '"Hello"', 5))
  arr.insert(code, value.string(types.string, '"World"', 5))

  arr.printJSON(code)

  let res = await run("testArray2", code)
  expect(JSON.parse(res)).toEqual(["Hello", "World"])
})

test("testArray3", async () => {
  let arr = value.array(typing.parseType("{*u32:{int: i32, str: string}}"), "arr", 64, true)
  arr.addColumn("int", types.i32)
  arr.addColumn("str", types.string)

  let code = []
  arr.declare(code)
  let obj1 = value.object(typing.parseType("{ int: i32, str: string }"))
  obj1.addField("int", value.primitive(types.u32, "10"))
  obj1.addField("str", value.string(types.string, '"Hello"', 5))
  arr.insert(code, obj1)
  let obj2 = value.object(typing.parseType("{ int: i32, str: string }"))
  obj2.addField("int", value.primitive(types.u32, "20"))
  obj2.addField("str", value.string(types.string, '"World"', 5))
  arr.insert(code, obj2)
  let obj3 = value.object(typing.parseType("{ int: i32, str: string }"))
  obj3.addField("int", value.primitive(types.u32, "30"))
  obj3.addField("str", value.string(types.string, '"!"', 1))
  arr.insert(code, obj3)

  arr.printJSON(code)

  let res = await run("testArray3", code)
  expect(JSON.parse(res)).toEqual(
    [{ int: 10, str: "Hello" }, { int: 20, str: "World" }, { int: 30, str: "!" }]
  )
})

test("testHashMap1", async () => {
  let map = value.hashMap(typing.parseType("{*string: i32}"), "hashmap", 256, true, false)
  map.addKey(types.string)
  map.addKey(types.i32)
  map.addColumn("_DEFAULT_", types.i32)

  let code = []
  map.declare(code)
  let key = value.keys()
  key.addKey(value.string(types.string, `"Hello"`, 5))
  key.addKey(value.primitive(types.i32, "10"))
  map.lookup(code, key)
  let lookup = code[code.length - 1]
  code.splice(code.length - 1)

  lookup.emit(code)

  map.printJSON(code)

  let res = await run("testHashMap1", code)
  console.log(res)
})
