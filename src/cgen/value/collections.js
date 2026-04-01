// Arrays & Hash tables

const { VAL_TAG, BUF_TAG } = require("./tags")
const { c, utils } = require("../utils")
const { typing, types } = require("../../typing")

const { quoteVar } = utils

const base = require("./base")

const { getSettings, resetSettings } = require("../settings")
const { symbol } = require("../symbol")

class CCollection extends base.CValue {
  sym
  size
  capacity

  tuple

  // The CBuffer that stores the values of this collection
  values

  constructor(schema, sym, capacity, tuple) {
    super(schema)
    this.sym = sym
    this.size = `${sym}_size$`
    this.capacity = capacity
    this.tuple = tuple
    this.values = tuple ? new base.CObjectBuffer(schema.objValue, this.capacity) : undefined
  }

  get(idx) {
    throw new Error("Not implemented")
  }

  setOrAddBuffer(name, buffer) {
    if (this.tuple) {
      this.values.addBuffer(name, buffer)
    } else {
      this.values = buffer
    }
  }

  addColumn(name, schema) {
    let bufferName = `${this.sym}_${name}`
    let newBuffer = typing.isString(schema) ?
      new base.CStringBuffer(schema, this.capacity, bufferName) :
      new base.CPrimBuffer(schema, this.capacity, bufferName)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  }

  getLoopTxt() {
    throw new Error("Not implemented")
  }
}

class CArray extends CCollection {
  constructor(schema, sym, capacity, tuple) {
    super(schema, sym, capacity, tuple)
  }

  get(idx) {
    return this.values.get(idx)
  }

  getLoopTxt(v, data) {
    return () => {
      let v1 = quoteVar(v)

      let initCursor = []
      let loopHeader = []

      let cType = utils.convertToCType(this.schema.objKey)
      loopHeader.push((this.cond ? `if (!${this.cond}) ` : "") +
        `for (${cType} ${v1} = 0; ${v1} < ${this.size}; ${v1}++) {`)

      let boundsChecking = []
      boundsChecking.push(`if (${v1} >= ${this.size}) break;`)

      return {
        info: [], data, initCursor, loopHeader, boundsChecking, rowScanning: []
      }
    }
  }

  // Code generation
  declare(buf) {
    c.comment(buf)(`declaring array "${this.sym}"`)
    c.declareInt(buf)(this.size, "0")
    this.values.allocate(buf)
  }

  insert(buf, value) {
    if (getSettings().boundCheck) {
      c.if(buf)(c.eq(this.size, this.capacity), (buf1) => {
        c.printErr(buf1)("array size reached its full capacity\\n")
        c.return(buf1)("1")
      })
    }
    let lhs = this.get(this.size)
    lhs.assign(buf, value)

    c.stmt(buf)(c.inc(this.size))
  }

  printJSON(buf, limit) {
    limit = limit ? c.ternary(c.lt(limit, this.size), limit, this.size) : this.size
    let cType = utils.convertToCType(this.schema.objKey)
    let iter = symbol.getSymbol("print_iter")
    c.printf(buf)("[")
    buf.push(`for (${cType} ${iter} = 0; ${iter} < ${this.size}; ${iter}++) {`)
    this.get(iter).printJSON(buf)
    c.if(buf)(c.ne(iter, c.sub(limit, 1)), buf1 => {
      c.printf(buf1)(",")
    })
    buf.push("}")
    c.printf(buf)("]")
  }

  print(buf, limit) {
    limit = limit ? c.ternary(c.lt(limit, this.size), limit, this.size) : this.size
    let cType = utils.convertToCType(this.schema.objKey)
    let iter = symbol.getSymbol("print_iter")
    buf.push(`for (${cType} ${iter} = 0; ${iter} < ${this.size}; ${iter}++) {`)
    this.get(iter).print(buf)
    c.printf(buf)("\n")
    buf.push("}")
  }
}

class CHashMap extends CCollection {
  htable

  multiKey
  keys

  constructor(schema, sym, capacity, tuple, multiKey) {
    super(schema, sym, capacity, tuple)
    this.htable = `${sym}_htable$`
    this.multiKey = multiKey
    this.keys = multiKey ? new base.CKeysBuffer(schema.objKey, capacity) : undefined
  }

  getKey(keyPos) {
    return this.keys.get(keyPos)
  }

  getVal(keyPos) {
    return this.values.get(keyPos)
  }

  get(keyPos) {
    return { key: this.getKey(keyPos), value: this.getVal(keyPos) }
  }

  getLoopTxt(v, data) {
    return () => {
      let v1 = quoteVar(v)

      let initCursor = []
      let loopHeader = []

      loopHeader.push((this.cond ? `if (!${this.cond}) ` : "") +
        `for (size_t ${v1} = 1; ${v1} <= ${this.size}; ${v1}++) {`)

      let boundsChecking = []
      boundsChecking.push(`if (${v1} > ${this.size}) break;`)

      return {
        info: [], data, initCursor, loopHeader, boundsChecking, rowScanning: []
      }
    }
  }

  addKey(keySchema) {
    let bufferName
    if (this.multiKey) {
      bufferName = `${this.sym}_key${this.keys.buffers.length}`
    } else {
      bufferName = `${this.sym}_key$`
    }
    let newBuffer = typing.isString(keySchema) ?
      new base.CStringBuffer(keySchema, this.capacity, bufferName) :
      new base.CPrimBuffer(keySchema, this.capacity, bufferName)
    if (this.multiKey) {
      this.keys.addBuffer(newBuffer)
    } else {
      this.keys = newBuffer
    }
  }

  // Code generation
  declare(buf) {
    c.comment(buf)(`declaring hashmap "${this.sym}"`)
    c.declareIntPtr(buf)(this.htable,
      c.cast("int *", c.calloc("int", this.capacity)))
    c.declareInt(buf)(this.size, "0")
    c.comment(buf)(`keys for hashmap "${this.sym}"`)
    this.keys.allocate(buf)
    c.comment(buf)(`values for hashmap "${this.sym}"`)
    this.values.allocate(buf)
  }

  addNestedArrayCol(name, schema, arrCapacity, arrTuple) {
    let bufferName = `${this.sym}_${name}`
    let newBuffer = new CNestedArrayBuffer(
      schema, arrCapacity, this.capacity, arrTuple, bufferName)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  }

  addNestedHashMapCol(name, schema, mapSym, mapCapacity, mapTuple) {
    let bufferName = `${this.sym}_${name}`
    let newBuffer = new CNestedHashMapBuffer(
      schema, mapCapacity, this.capacity, mapTuple, mapSym, bufferName)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  }

  find(buf, key) {
    let mask = this.capacity - 1

    let pos = symbol.getSymbol("tmp_pos") + "$" // aid cse
    let keyPos = symbol.getSymbol("key_pos") + "$"

    let stmt = {
      map: this,
      key,
      out: [pos, keyPos],
      emit(buf) {
        let hashed = key.hash(buf)

        let [pos, keyPos] = this.out
        c.declareULong(buf)(pos, c.binary(hashed, mask, "&"))

        let dynKeyPos = `${this.map.htable}[${pos}]`
        let keyAtPos = this.map.getKey(dynKeyPos)

        // increment the position until we find a match or an empty slot
        c.while(buf)(
          c.and(c.ne(dynKeyPos, "0"), c.not(keyAtPos.compare("==", this.key))),
          buf1 => {
            c.stmt(buf1)(c.assign(pos, c.binary(c.add(pos, "1"), mask, "&")))
          }
        )
        c.declareInt(buf)(keyPos, dynKeyPos)
      }
    }

    buf.push(stmt)
    return [pos, keyPos]
  }

  insert(buf, key, pos, keyPos, update1, update2, checkExistance) {
    let entry = this.get(keyPos)

    if (checkExistance) {
      c.if(buf)(c.eq(keyPos, "0"), buf1 => {
        c.stmt(buf1)(c.inc(this.size))
        c.stmt(buf1)(c.assign(keyPos, this.size))

        c.stmt(buf1)(c.assign(this.htable + "[" + pos + "]", keyPos))
        entry.key.assign(buf1, key)

        update1(buf1, entry, pos, keyPos)
      })
    }

    update2(buf, entry, pos, keyPos)
  }

  findAndInsert(buf, key, update1, update2, checkExistance) {
    if (checkExistance) {
      c.if(buf)(c.eq(this.size, this.capacity), buf1 => {
        c.printErr(buf1)("hashmap size reached its full capacity\\n")
        c.return(buf1)("1")
      })
    }

    let [pos, keyPos] = this.find(buf, key)

    this.insert(buf, key, pos, keyPos, update1, update2, checkExistance)

    return [pos, keyPos]
  }

  printJSON(buf, limit) {
    limit = limit ? c.ternary(c.lt(limit, this.size), limit, this.size) : this.size
    let iter = symbol.getSymbol("print_iter")
    c.printf(buf)("{")
    buf.push(`for (int ${iter} = 1; ${iter} <= ${this.size}; ${iter}++) {`)
    let entry = this.get(iter)
    entry.key.printJSON(buf, true)
    c.printf(buf)(":")
    entry.value.printJSON(buf)
    c.if(buf)(c.ne(iter, limit), buf1 => {
      c.printf(buf1)(",")
    })
    buf.push("}")
    c.printf(buf)("}")
  }
}

class CNestedHashMap extends CHashMap {
  ptr

  constructor(schema, sym, capacity, tuple, multiKey, ptr) {
    super(schema, sym, capacity, tuple, multiKey)
    this.ptr = ptr
  }

  allocate(buf) {
    c.stmt(buf)(c.assign(this.ptr, c.cast(`struct ${this.sym} *`, c.malloc(`struct ${this.sym}`, 1))))
    c.stmt(buf)(c.assign(this.htable, c.cast("int *", c.calloc("int", this.capacity))))
    c.stmt(buf)(c.assign(this.size, "0"))
    this.keys.allocateAssign(buf)
    this.values.allocateAssign(buf)
  }
}

class CCollectionBuffer extends base.CBuffer {
  parentCapacity

  tuple
  values

  constructor(schema, capacity, parentCapacity, tuple) {
    super(schema, capacity)
    this.parentCapacity = parentCapacity
    this.values = tuple ? new base.CObjectBuffer(schema.objValue) : undefined
  }

  get() {
    throw new Error("Not implemented")
  }

  setOrAddBuffer(name, buffer) {
    if (this.tuple) {
      this.values.addBuffer(name, buffer)
    } else {
      this.values = buffer
    }
  }
}

class CNestedArrayBuffer extends CCollectionBuffer {
  prefix
  sizeBuf

  constructor(schema, capacity, parentCapacity, tuple, prefix) {
    super(schema, capacity, parentCapacity, tuple)
    this.prefix = prefix
    this.sizeBuf = `${prefix}_bucket_sizes$`
  }

  get(idx) {
    let newBuffer = this.values.shift(c.mul(idx, this.capacity))
    let res = new CArray(this.schema, undefined, this.capacity, this.tuple)
    res.size = `${this.sizeBuf}[${idx}]`
    res.values = newBuffer
    return res
  }

  addColumn(name, schema) {
    let bufferName = `${this.prefix}_${name}`
    let bufferSize = this.parentCapacity * this.capacity
    let newBuffer = typing.isString(schema) ?
      new base.CStringBuffer(schema, bufferSize, bufferName) :
      new base.CPrimBuffer(schema, bufferSize, bufferName)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  }

  allocate(buf) {
    // Allocate the array that stores the sizes of all buckets in the buffer
    c.declareIntPtr(buf)(this.sizeBuf,
      c.cast("int *", c.malloc("int", this.parentCapacity)))
    this.values.allocate(buf)
  }
}

class CNestedHashMapBuffer extends CCollectionBuffer {
  sym

  htable
  size
  structBuf

  keys

  constructor(schema, capacity, parentCapacity, tuple, sym, structBuf) {
    super(schema, capacity, parentCapacity, tuple)
    this.sym = sym
    this.htable = `${sym}_htable$`
    this.size = `${sym}_size$`
    this.structBuf = structBuf
  }

  get(idx) {
    let ptr = `${this.structBuf}[${idx}]`

    let res = new CNestedHashMap(
      this.schema, this.sym, this.capacity, this.tuple, false, ptr)
    res.htable = `${ptr}->${res.htable}`
    res.size = `${ptr}->${res.size}`
    res.keys = this.keys.derefFrom(ptr)
    res.values = this.values.derefFrom(ptr)

    return res
  }

  addKey(keySchema) {
    let bufferName = `${this.sym}_key$`
    let newBuffer = typing.isString(keySchema) ?
      new base.CStringBuffer(keySchema, this.capacity, bufferName) :
      new base.CPrimBuffer(keySchema, this.capacity, bufferName)
    this.keys = newBuffer
  }

  addColumn(name, schema) {
    let bufferName = `${this.sym}_${name}`
    let newBuffer = typing.isString(schema) ?
      new base.CStringBuffer(schema, this.capacity, bufferName) :
      new base.CPrimBuffer(schema, this.capacity, bufferName)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  }

  addNestedHashMapCol(name, schema, mapSym, mapCapacity, mapTuple) {
    let bufferName = `${this.sym}_${name}`
    let newBuffer = new CNestedHashMapBuffer(
      schema, mapCapacity, this.capacity, mapTuple, mapSym, bufferName)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  }

  declareStruct(buf) {
    c.comment(buf)(`declaring struct for hashmap "${this.sym}"`)
    buf.push(`struct ${this.sym} {`)
    c.declareIntPtr(buf)(this.htable)
    c.declareInt(buf)(this.size)
    c.comment(buf)(`keys for hashmap "${this.sym}"`)
    this.keys.declare(buf)
    c.comment(buf)(`values for hashmap "${this.sym}"`)
    this.values.declare(buf)
    buf.push("};")
  }

  derefFrom(ptr) {
    let newBuffer = new CNestedHashMapBuffer(
      this.schema, this.capacity, this.parentCapacity, this.tuple, this.sym,
      `${ptr}->${this.structBuf}`)
    newBuffer.keys = this.keys
    newBuffer.values = this.values
    return newBuffer
  }

  allocate(buf) {
    c.declarePtrPtr(buf)(`struct ${this.sym}`, this.structBuf,
      c.cast(`struct ${this.sym} **`, c.malloc(`struct ${this.sym} *`, this.parentCapacity)))
  }

  declare(buf) {
    c.declarePtrPtr(buf)(`struct ${this.sym}`, this.structBuf)
  }

  allocateAssign(buf) {
    c.stmt(buf)(c.assign(this.structBuf,
      c.cast(`struct ${this.sym} **`, c.malloc(`struct ${this.sym} *`, this.parentCapacity))))
  }
}

exports.CCollection = CCollection
exports.CArray = CArray
exports.CHashMap = CHashMap
exports.CNestedHashMap = CNestedHashMap
exports.CCollectionBuffer = CCollectionBuffer
exports.CNestedArrayBuffer = CNestedArrayBuffer
exports.CNestedHashMapBuffer = CNestedHashMapBuffer
