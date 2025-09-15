const { c, utils } = require("./utils")
const { symbol } = require("./symbol")
const { typing, types } = require('../typing')
const { TAG, value } = require("./value")

const HASH_SIZE = 16777216

const BUCKET_SIZE = 64
const DATA_SIZE = HASH_SIZE * BUCKET_SIZE

const HASH_MASK = HASH_SIZE - 1

const ARRAY_SIZE = 2048

let reset = () => {
}

let encodeName = name => "$" + name + "$"

let allocateStringBuffer = (buf, str, len, size, global, prolog0) => {
  if (global) {
    c.declareCharPtrPtr(prolog0)(str)
    c.declareIntPtr(prolog0)(len)
    c.stmt(buf)(c.assign(str, c.cast("char **", c.malloc("char *", size))))
    c.stmt(buf)(c.assign(len, c.cast("int *", c.malloc("int", size))))
  } else {
    c.declareCharPtrPtr(buf)(str, c.cast("char **", c.malloc("char *", size)))
    c.declareIntPtr(buf)(len, c.cast("int *", c.malloc("int", size)))
  }
}

let allocatePrimitiveBuffer = (buf, type, name, size, global, prolog0) => {
  if (global) {
    c.declarePtr(prolog0)(type, name)
    c.stmt(buf)(c.assign(name, c.cast(`${type} *`, c.malloc(type, size))))
  } else {
    c.declarePtr(buf)(type, name, c.cast(`${type} *`, c.malloc(type, size)))
  }
}

let emitHashMapKeyDecls = (buf, sym, keySchema) => {
  let keys = []
  for (let i in keySchema) {
    let schema = keySchema[i]
    if (typing.isString(schema)) {
      allocateStringBuffer(buf, `${sym}_keys_str${i}`, `${sym}_keys_len${i}`, HASH_SIZE)
      keys.push(value.string(schema, `${sym}_keys_str${i}`, `${sym}_keys_len${i}`))
    } else {
      let cType = convertToCType(schema)
      allocatePrimitiveBuffer(buf, cType, `${sym}_keys${i}`, HASH_SIZE)
      keys.push(value.primitive(schema, `${sym}_keys${i}`))
    }
  }
  return keys
}

let emitHashMapBucketsInit = (buf, sym, name, schema) => {
  throw new Error("Not fully implemented")
  // stateful "array" op
  c.declareInt(buf)(`${sym}_${name}_count`, "0")

  c.declareIntPtr(buf)(`${sym}_${name}_buckets`, c.cast("int *", c.malloc("int", DATA_SIZE)))
  c.declareIntPtr(buf)(`${sym}_${name}_bucket_counts`, c.cast("int *", c.malloc("int", HASH_SIZE)))
}

let emitHashMapValueInit = (buf, map, name, schema, sorted, prolog0) => {
  let sym = map.val.sym

  c.comment(buf)(`value of ${sym}: ${name}`)
  let res = { schema }
  if (typing.isObject(schema)) {
    // Nested hashmap
    throw new Error("Nested hashmap not supported for now")
  } if (typing.isString(schema)) {
    allocateStringBuffer(buf, `${sym}_${name}_str`, `${sym}_${name}_len`, HASH_SIZE, sorted, prolog0)
    res.val = { str: `${sym}_${name}_str`, len: `${sym}_${name}_len` }
  } else {
    // let convertToCType report "type not supported" errors
    let cType = utils.convertToCType(schema)
    allocatePrimitiveBuffer(buf, cType, `${sym}_${name}`, HASH_SIZE, sorted, prolog0)
    res.val = `${sym}_${name}`
  }

  map.val.values ??= {}
  map.val.values[name] = res
}

// Initialize the key arrays
// The value arrays will be added and associated to this hashmap later
let emitHashMapInit = (buf, sym, keySchema) => {
  c.comment(buf)(`init hashmap for ${sym}`)
  // keys
  c.comment(buf)(`keys of ${sym}`)

  let keys = emitHashMapKeyDecls(buf, sym, keySchema)
  let count = `${sym}_key_count`
  let htable = `${sym}_htable`

  c.comment(buf)(`key count for ${sym}`)
  c.declareInt(buf)(count, "0")

  // htable
  c.comment(buf)(`hash table for ${sym}`)
  c.declareIntPtr(buf)(htable, c.cast("int *", c.malloc("int", HASH_SIZE)))

  // init htable entries to -1
  c.comment(buf)(`init hash table entries to -1 for ${sym}`)
  c.stmt(buf)(c.call("memset", htable, "-1", `sizeof(int) * ${HASH_SIZE}`))

  return { htable, count, keys }
}

// Emit the code that updates the hashMap value for the key at keyPos
// it will initialize the key if it is not there when checkExistance is set to true
let emitHashMapUpdate = (buf, map, keys, pos, keyPos, update1, update2, checkExistance) => {
  let sym = map.val.sym
  let lhs = getHashMapValueEntry(map, pos, keyPos)

  if (checkExistance) {
    c.if(buf)(c.eq(keyPos, "-1"), buf1 => {
      c.stmt(buf1)(c.assign(keyPos, map.val.count))
      c.stmt(buf1)(c.inc(map.val.count))
      c.stmt(buf1)(c.assign(`${map.val.htable}[${pos}]`, keyPos))

      for (let i in keys) {
        let key = keys[i]
        let schema = key.schema

        if (typing.isString(schema)) {
          let keyStr = `${map.val.keys[i].val.str}[${keyPos}]`
          let keyLen = `${map.val.keys[i].val.len}[${keyPos}]`

          c.stmt(buf1)(c.assign(keyStr, key.val.str))
          c.stmt(buf1)(c.assign(keyLen, key.val.len))
        } else {
          c.stmt(buf1)(c.assign(`${map.val.keys[i].val}[${keyPos}]`, key.val))
        }
      }
      update1(buf1, lhs, pos, keyPos)
    })
  }

  update2(buf, lhs, pos, keyPos)
}

// Calculate the hash value for a set of keys
let hash = (buf, keys) => {
  let hashed = symbol.getSymbol("hash")

  if (keys.length == 1) {
    let schema = keys[0].schema.type || keys[0].schema
    if (typing.isString(schema)) {
      c.declareULong(buf)(hashed, c.call("hash", keys[0].val.str, keys[0].val.len))
    } else if (typing.isNumber(schema) || schema.typeSym == typeSyms.date) {
      c.declareULong(buf)(hashed, c.cast("unsigned long", keys[0].val))
    } else {
      throw new Error("Cannot hash key with type " + typing.prettyPrintType(schema))
    }
    return hashed
  }

  c.declareULong(buf)(hashed, "0")
  for (let i in keys) {
    let key = keys[i]
    let schema = key.schema
    let tmpHash = symbol.getSymbol("tmp_hash")

    if (typing.isString(schema)) {
      c.declareULong(buf)(tmpHash, c.call("hash", key.val.str, key.val.len))
    } else if (typing.isNumber(schema) || schema.typeSym == typeSyms.date) {
      c.declareULong(buf)(tmpHash, c.cast("unsigned long", key.val))
    } else {
      throw new Error("Cannot hash key with type " + typing.prettyPrintType(schema))
    }

    c.stmt(buf)(c.assign(hashed, c.binary(hashed, "8", "<<")))
    c.stmt(buf)(c.assign(hashed, c.binary(hashed, tmpHash, "+=")))
  }

  return hashed
}

// Emit the code that finds the key in the hashmap.
// Linear probing is used for resolving collisions.
// Comparison of keys is based on different key types.
// The actual storage of the values / data does not affect the lookup
let emitHashLookUp = (buf, map, keys) => {
  let hashed = hash(buf, keys)

  let sym = map.val.sym

  let pos = symbol.getSymbol("pos")
  c.declareULong(buf)(pos, c.binary(hashed, HASH_MASK, "&"))

  let keyPos = `${map.val.htable}[${pos}]`

  let compareKeys = undefined

  for (let i in keys) {
    let key = keys[i]
    let schema = key.schema

    if (typing.isString(schema)) {
      let keyStr = `${map.val.keys[i].val.str}[${keyPos}]`
      let keyLen = `${map.val.keys[i].val.len}[${keyPos}]`

      let { str, len } = key.val
      let comparison = c.ne(c.call("compare_str2", keyStr, keyLen, str, len), "0")
      compareKeys = compareKeys ? c.or(compareKeys, comparison) : comparison
    } else {
      let comparison = c.ne(`${map.val.keys[i].val}[${keyPos}]`, key.val)
      compareKeys = compareKeys ? c.or(compareKeys, comparison) : comparison
    }

  }

  // increment the position until we find a match or an empty slot
  c.while(buf)(
    c.and(c.ne(keyPos, "-1"), "(" + compareKeys + ")"),
    buf1 => {
      c.stmt(buf1)(c.assign(pos, c.binary("(" + c.add(pos, "1") + ")", HASH_MASK, "&")))
    }
  )

  keyPos = symbol.getSymbol("key_pos")
  c.declareInt(buf)(keyPos, `${map.val.htable}[${pos}]`)

  return [pos, keyPos]
}

// Emit the code that performs a lookup of the key in the hashmap, then
// if the key is found:
//   does nothing
// if the key is not found:
//   inserts a new key into the hashmap and initializes it
let emitHashLookUpOrUpdate = (buf, map, keys, update) =>
  emitHashLookUpAndUpdateCust(buf, map, keys, update, () => { }, true)

// Emit the code that performs a lookup of the key in the hashmap, then
// if the key is found:
//   updates the value
// if the key is not found:
//   inserts a new key into the hashmap and initializes it
let emitHashLookUpAndUpdate = (buf, map, keys, update, checkExistance) =>
  emitHashLookUpAndUpdateCust(buf, sym, keys, () => { }, update, checkExistance)

let emitHashLookUpAndUpdateCust = (buf, map, keys, update1, update2, checkExistance) => {
  c.if(buf)(c.eq(map.val.count, HASH_SIZE), buf1 => {
    c.printErr(buf1)("hashmap size reached its full capacity\\n")
    c.return(buf1)("1")
  })

  let [pos, keyPos] = emitHashLookUp(buf, map, keys)

  emitHashMapUpdate(buf, map, keys, pos, keyPos, update1, update2, checkExistance)

  return [pos, keyPos]
}

// Emit the code that gets the hashMap value for the key at keyPos
let getHashMapValueEntry = (map, pos, keyPos) => {
  let res = {}
  let indexing = "[" + keyPos + "]"

  res.schema = map.schema.objValue
  res.tag = TAG.OBJECT
  res.val = {}

  for (let key in map.val.values) {
    let value = map.val.values[key]
    res.val[key] = JSON.parse(JSON.stringify(value))
    if (typing.isString(value.schema)) {
      res.val[key].val.str += indexing
      res.val[key].val.len += indexing
    } else {
      res.val[key].val += indexing
    }
  }

  // If it is just a single value, don't return the object
  // but the value directly
  if (Object.keys(map.val.values).length == 1 && Object.keys(map.val.values)[0] == "_DEFAULT_") {
    res.val["_DEFAULT_"].cond = c.eq(pos, "-1")
    return res.val["_DEFAULT_"]
  }

  res.cond = c.eq(pos, "-1")

  return res
}

let hashmap = {
  reset,
  emitHashMapInit,
  emitHashMapValueInit,
  emitHashMapBucketsInit,

  emitHashLookUpOrUpdate,
  emitHashLookUpAndUpdate,
  emitHashLookUpAndUpdateCust,
  getHashMapValueEntry,
  emitHashMapUpdate
}

module.exports = {
  hashmap
}
