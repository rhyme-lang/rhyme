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
  let int = new value.CPrim(types.i32, "x")
  let two = new value.CPrim(types.i32, "2")
  int.assign(code, two)

  c.declareConstCharPtr(code)("str", "\"hello\"")
  c.declareInt(code)("len", "5")
  let str = new value.CString(types.string, "str", "len")
  let hello = new value.CString(types.string, "\"hello\"", "5")
  str.assign(code, hello)

  int.printJSON(code)
  c.printf(code)("\\n")
  str.printJSON(code)

  let res = await run("testBasic", code)
  expect(res.split("\n").map(JSON.parse)).toEqual([2, "hello"])
})

test("testArray1", async () => {
  let arr = new value.CArray(typing.parseType("{*u32:u32}"), "arr", 32, false)
  arr.addColumn("_DEFAULT_", types.u32)

  let code = []
  arr.declare(code)
  arr.insert(code, new value.CPrim(types.u32, "1"))
  arr.insert(code, new value.CPrim(types.u32, "2"))
  arr.insert(code, new value.CPrim(types.u32, "3"))
  arr.insert(code, new value.CPrim(types.u32, "4"))

  arr.printJSON(code)

  let res = await run("testArray1", code)
  expect(JSON.parse(res)).toEqual([1, 2, 3, 4])
})

test("testArray2", async () => {
  let arr = new value.CArray(typing.parseType("{*u32:string}"), "arr", 64, false)
  arr.addColumn("_DEFAULT_", types.string)

  let code = []
  arr.declare(code)
  arr.insert(code, new value.CString(types.string, '"Hello"', 5))
  arr.insert(code, new value.CString(types.string, '"World"', 5))

  arr.printJSON(code)

  let res = await run("testArray2", code)
  expect(JSON.parse(res)).toEqual(["Hello", "World"])
})

test("testArray3", async () => {
  let arr = new value.CArray(typing.parseType("{*u32:{int: i32, str: string}}"), "arr", 64, true)
  arr.addColumn("int", types.i32)
  arr.addColumn("str", types.string)

  let code = []
  arr.declare(code)
  let obj1 = new value.CObject(typing.parseType("{ int: i32, str: string }"))
  obj1.addValue("int", new value.CPrim(types.u32, "10"))
  obj1.addValue("str", new value.CString(types.string, '"Hello"', 5))
  arr.insert(code, obj1)

  let obj2 = new value.CObject(typing.parseType("{ int: i32, str: string }"))
  obj2.addValue("int", new value.CPrim(types.u32, "20"))
  obj2.addValue("str", new value.CString(types.string, '"World"', 5))
  arr.insert(code, obj2)

  let obj3 = new value.CObject(typing.parseType("{ int: i32, str: string }"))
  obj3.addValue("int", new value.CPrim(types.u32, "30"))
  obj3.addValue("str", new value.CString(types.string, '"!"', 1))
  arr.insert(code, obj3)

  arr.printJSON(code)

  let res = await run("testArray3", code)
  expect(JSON.parse(res)).toEqual(
    [{ int: 10, str: "Hello" }, { int: 20, str: "World" }, { int: 30, str: "!" }]
  )
})

test("testHashMap1", async () => {
  let map = new value.CHashMap(typing.parseType("{*string: i32}"), "hashmap", 256, false, true)
  map.addKey(types.string)
  map.addKey(types.i32)
  map.addColumn("_DEFAULT_", types.i32)

  let code = []
  map.declare(code)

  let key = new value.CKeys()
  key.addKey(new value.CString(types.string, `"Hello"`, 5))
  key.addKey(new value.CPrim(types.i32, "10"))

  let val = new value.CPrim(types.i32, "123")
  map.findAndInsert(code, key, (buf, entry) => {
    entry.value.assign(buf, val)
  }, () => { }, true)

  let code1 = []
  code.map(line => {
    if (typeof line == "object") {
      return line.emit(code1)
    } else {
      code1.push(line)
    }
  })

  map.printJSON(code1)

  let res = await run("testHashMap1", code1)
  expect(JSON.parse(res)).toEqual({ "Hello,10": 123 })
})

test("testHashMap2", async () => {
  let map = new value.CHashMap(typing.parseType("{*string: {*i32: string}}"), "hashmap", 256, false, false)
  map.addKey(types.string)

  let bucket = map.addNestedArrayCol("_DEFAULT_", typing.parseType("{*i32: string}"), 8, false)
  bucket.addColumn("_DEFAULT_", types.string)

  let code = []
  map.declare(code)

  let key1 = new value.CString(types.string, `"Hello"`, 5)
  map.findAndInsert(code, key1, (buf, entry) => {
    c.stmt(buf)(c.assign(entry.value.size, 0))
  }, (buf, entry) => {
    entry.value.insert(buf, new value.CString(types.string, `"Hi"`, 2))
    entry.value.insert(buf, new value.CString(types.string, `"there"`, 5))
    entry.value.insert(buf, new value.CString(types.string, `"A"`, 1))
    entry.value.insert(buf, new value.CString(types.string, `"B"`, 1))
  }, true)

  let key2 = new value.CString(types.string, `"World"`, 5)
  map.findAndInsert(code, key2, (buf, entry) => {
    c.stmt(buf)(c.assign(entry.value.size, 0))
  }, (buf, entry) => {
    entry.value.insert(buf, new value.CString(types.string, `"C"`, 1))
    entry.value.insert(buf, new value.CString(types.string, `"DE"`, 2))
    entry.value.insert(buf, new value.CString(types.string, `"FGH"`, 3))
  }, true)

  map.findAndInsert(code, key1, (buf, entry) => {
    c.stmt(buf)(c.assign(entry.value.size, 0))
  }, (buf, entry) => {
    entry.value.insert(buf, new value.CString(types.string, `"C"`, 1))
    entry.value.insert(buf, new value.CString(types.string, `"DE"`, 2))
  }, true)

  let code1 = []
  code.map(line => {
    if (typeof line == "object") {
      return line.emit(code1)
    } else {
      code1.push(line)
    }
  })

  map.printJSON(code1)

  let res = await run("testHashMap2", code1)
  expect(JSON.parse(res)).toEqual({
    "Hello": ["Hi", "there", "A", "B", "C", "DE"],
    "World": ["C", "DE", "FGH"]
  })
})

test("testHashMap3", async () => {
  let map = new value.CHashMap(typing.parseType("{*string: {*string: i32}}"), "hashmap", 128, false, false)
  map.addKey(types.string)

  let nested = map.addNestedHashMapCol("_DEFAULT_", typing.parseType("{*string: i32}"), "nested", 64, false)
  nested.addKey(types.string)
  nested.addColumn("_NESTED_DEFAULT_", types.i32)

  let code = []

  nested.declareStruct(code)
  map.declare(code)

  let key1 = new value.CString(types.string, `"Hello"`, 5)
  map.findAndInsert(code, key1, (buf, entry) => {
    entry.value.allocate(buf)
  }, (buf, entry) => {
    let nestedMap = entry.value
    let key2 = new value.CString(types.string, `"World"`, 5)
    nestedMap.findAndInsert(buf, key2, (buf1, entry) => {
      entry.value.assign(buf1, new value.CPrim(types.i32, 123))
    }, () => { }, true)

    nestedMap.findAndInsert(buf, key2, () => {
    }, (buf1, entry) => { entry.value.assign(buf1, new value.CPrim(types.i32, 124)) }, true)
  }, true)

  let code1 = []
  code.map(line => {
    if (typeof line == "object") {
      return line.emit(code1)
    } else {
      code1.push(line)
    }
  })

  map.printJSON(code1)

  let res = await run("testHashMap3", code1)
  expect(JSON.parse(res)).toEqual({ Hello: { World: 124 } })
})

test("testHashMap4", async () => {
  let map = new value.CHashMap(typing.parseType("{*string: {*string: {*i32: string}}}"), "hashmap", 128, false, false)
  map.addKey(types.string)

  let nestedL1 = map.addNestedHashMapCol("_NESTEDL1BUF_", typing.parseType("{*string: {*i32: string}}"), "nestedL1", 64, false)

  nestedL1.addKey(types.string)
  let nestedL2 = nestedL1.addNestedHashMapCol("_NESTEDL2BUF_", typing.parseType("{*i32: string}"), "nestedL2", 64, false)

  nestedL2.addKey(types.i32)
  nestedL2.addColumn("_NESTEDL2_DEFAULT_", types.string)

  let code = []

  nestedL2.declareStruct(code)
  nestedL1.declareStruct(code)
  map.declare(code)

  let key1 = new value.CString(types.string, `"key1"`, 5)
  let key2 = new value.CString(types.string, `"key2"`, 5)
  let key3 = new value.CPrim(types.i32, "42")

  map.findAndInsert(code, key1, (buf, entry) => {
    entry.value.allocate(buf)
  }, () => { }, true)

  map.findAndInsert(code, key1, () => {}, (buf, entry) => {
    entry.value.findAndInsert(buf, key2, (buf1, entry1) => {
      entry1.value.allocate(buf1)
    }, () => {}, true)
  }, true)

  map.findAndInsert(code, key1, () => {}, (buf, entry) => {
    entry.value.findAndInsert(buf, key2, () => {}, (buf1, entry1) => {
      entry1.value.findAndInsert(buf1, key3, (buf2, entry2) => {
        entry2.value.assign(buf2, new value.CString(types.string, `"Hello"`, 5))
      }, () => {}, true)

      entry1.value.findAndInsert(buf1, key3, (buf2, entry2) => {
        entry2.value.assign(buf2, new value.CString(types.string, `"Hello"`, 123))
      }, () => {}, true)
    }, true)
  }, true)

  let code1 = []
  code.map(line => {
    if (typeof line == "object") {
      return line.emit(code1)
    } else {
      code1.push(line)
    }
  })

  map.printJSON(code1)

  let res = await run("testHashMap4", code1)
  console.log(JSON.parse(res))
})
