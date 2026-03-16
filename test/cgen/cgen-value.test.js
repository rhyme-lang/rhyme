const value = require("../../src/cgen/value/value")
const { typing, types } = require('../../src/typing')

test("testPrimitive", () => {
  let int = value.primitive(types.i32, "x")
  let two = value.primitive(types.i32, "2")
  let buf1 = []
  int.assign(buf1, two)

  let str = value.string(types.string, "str", "len")
  let hello = value.string(types.string, "\"hello\"", "5")
  let buf2 = []
  str.assign(buf2, hello)

  expect(buf1[0]).toEqual("(x = 2);")
  expect(buf2).toEqual(["(str = \"hello\");", "(len = 5);"])
})

test("testObjHash", () => {
  let o = value.object()
  let int = value.primitive(types.i32, "x")
  let hello = value.string(types.string, "\"hello\"", "5")
  let world = value.string(types.string, "\"world\"", "5")
  o.addField("s1", hello)
  o.addField("i", int)
  o.addField("s2", world)

  let t = []
  let hashed = o.hash(t)

  console.log(t, hashed)
})

test("testArray", () => {
  let arr = value.array(typing.parseType("{*u32:u32}"), "arr", 64, false)

  let buf = []
  arr.init(buf)
  // arr.addColumn(buf, "whatevers", types.string)
  arr.addColumn(buf, "whateveri", types.u32)
  console.log(arr.get("i"))
  let int = value.primitive(types.u32, "tttt")
  arr.insert(buf, int)

  console.log(arr)
  
  console.log(buf)

})

test("testHashMap", () => {
  let map = value.hashMap(typing.parseType("{*u32:{some_s: string}}"), "hashmap", 2048, true)

  let buf = []
  map.init(buf)
  map.initKeys(buf, [types.string])

  map.addColumn(buf, "some_s", types.string)
  let bucket = map.addBucketCol(buf, "bucket", typing.parseType("{*u32:i32}"), 64, false)
  let linked = map.addLinkedBucketCol(buf, "linked", undefined, 8, false)

  bucket.addColumn(buf, "buckValA", types.i32)
  linked.addColumn(buf, "buckValB", types.string)

  console.log(map)
  console.log(buf)
})

test("testNestedHashMap", () => {
  let map = value.hashMap(undefined, "hashmap", 2048, false)
  let prolog = []
  let buf = []
  map.init(buf)
  map.initKeys(buf, [types.string])

  let nested = map.addNestedHashMapCol(buf, "nested", undefined, "nestedmap", 256, false)

  nested.initKeys([types.string])
  nested.initStructDecl(prolog)

  console.log(map)
  console.log(prolog)
  console.log(buf)
})
