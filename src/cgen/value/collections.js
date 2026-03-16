// Arrays & Hash tables

const { VAL_TAG, BUF_TAG } = require("./tags")
const { c, utils } = require("../utils")
const { pretty } = require('../../prettyprint')
const { typing, types } = require("../../typing")

const { quoteVar } = utils

const base = require("./base")

const { getSettings, resetSettings } = require("../settings")

let allocateBuffer = (buf, name, schema, size) => {
  if (typing.isString(schema)) {
    let buffer = base.stringBuffer(schema, name, size)
    buffer.allocate(buf)
    return buffer
  } else {
    let buffer = base.primitiveBuffer(schema, name, size)
    buffer.allocate(buf)
    return buffer
  }
}

// Array
exports.array = (schema, sym, capacity, tuple) => ({
  tag: VAL_TAG.ARRAY,
  schema,
  sym,
  size: `${sym}_size$`,
  capacity,
  buffer: tuple ? base.objectBuffer(schema.objValue) : undefined,
  tuple,
  // helpers
  get(idx) {
    return this.buffer.get(idx)
  },
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
  },
  setOrAddBuffer(name, buffer) {
    if (this.tuple) {
      this.buffer.addBufferField(name, buffer)
    } else {
      this.buffer = buffer
    }
  },
  // Code generation
  init(buf) {
    c.comment(buf)(`init array for ${this.sym}`)
    c.declareInt(buf)(this.size, "0")
  },
  addColumn(buf, name, schema) {
    c.comment(buf)(`columm ${name} for ${this.sym}`)
    let bufferName = `${this.sym}_${name}`
    let newBuffer = allocateBuffer(buf, bufferName, schema, this.capacity)
    this.setOrAddBuffer(name, newBuffer)
  },
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
  },
})

exports.hashBucketBuffer = (schema, name, capacity, parentCapacity, tuple) => ({
  tag: BUF_TAG.HASHMAP_BUCKET,
  schema,
  name,
  sizeBuf: `${name}_bucket_sizes$`,
  parentCapacity,
  capacity,
  buffer: tuple ? base.objectBuffer(schema.objValue) : undefined,
  tuple,
  get(idx) {
    let newBuffer = this.buffer.shift(c.mul(idx, capacity))
    let res = exports.array(this.schema, this.name, this.capacity, this.tuple)
    res.size = `${this.sizeBuf}[${idx}]`
    res.buffer = newBuffer
    return res
  },
  addColumn(buf, name, schema) {
    let bufferName = `${this.name}_${name}`
    let newBuffer = allocateBuffer(buf, bufferName, schema,
      this.parentCapacity * this.capacity)
    if (tuple) {
      this.buffer.addBufferField(name, newBuffer)
    } else {
      this.buffer = newBuffer
    }
  },
  allocate(buf) {
    // Allocate the array that stores the sizes of all buckets in the buffer
    c.declareIntPtr(buf)(this.sizeBuf,
      c.cast("int *", c.malloc("int", parentCapacity)))
  }
})

exports.hashLinkedBucketBuffer = (schema, name, factor, parentCapacity, tuple) => ({
  tag: BUF_TAG.HASHMAP_LINKED_BUCKET,
  schema,
  name,
  headBuf: `${name}_list_head$`,
  prevBuf: `${name}_list_prev$`,
  parentCapacity,
  factor,
  buffer: tuple ? base.objectBuffer(schema.objValue) : undefined,
  tuple,
  get(idx) {
    utils.internalError("not implemented")
  },
  addColumn(buf, name, schema) {
    let bufferName = `${this.name}_${name}`
    let newBuffer = allocateBuffer(buf, bufferName, schema,
      this.parentCapacity * this.factor)
    if (tuple) {
      this.buffer.addBufferField(name, newBuffer)
    } else {
      this.buffer = newBuffer
    }
  },
  allocate(buf) {
    // Allocate the array that stores the sizes of all buckets in the buffer
    c.declareIntPtr(buf)(this.headBuf,
      c.cast("int *", c.malloc("int", this.parentCapacity)))
    c.declareIntPtr(buf)(this.prevBuf,
      c.cast("int *", c.malloc("int", this.parentCapacity * this.factor)))
  }
})

exports.nestedHashMapBuffer = (schema, sym, name, capacity, parentCapacity, tuple) => ({
  tag: BUF_TAG.NESTED_HASHMAP,
  schema,
  sym,
  htable: `${sym}_htable$`,
  size: `${sym}_size$`,
  name,
  parentCapacity,
  capacity,
  // buffer: tuple ? base.objectBuffer(schema.objValue) : undefined,
  tuple,
  cstruct: c.struct(sym),
  get(idx) {
    // get the nested hashmap
    utils.internalError("not implemented")
  },
  init() {
    this.cstruct.addField("int *", this.htable)
    this.cstruct.addField("int", this.size)
  },
  initKeys(keySchema) {
    for (let i in keySchema) {
      let schema = keySchema[i]
      let prefix = `${this.sym}_key${i}`
      if (typing.isString(schema)) {
        this.cstruct.addField("const char **", `${prefix}_str`)
        this.cstruct.addField("int *", `${prefix}_len`)
      } else {
        let cType = utils.convertToCType(schema)
        this.cstruct.addField(cType + " *", prefix)
      }
    }
  },
  addColumn(name, schema) {
    if (typing.isString(schema)) {
      this.cstruct.addField("const char **", `${name}_str`)
      this.cstruct.addField("int *", `${name}_len`)
    } else {
      let cType = utils.convertToCType(schema)
      this.cstruct.addField(cType + " *", name)
    }
  },
  initStructDecl(buf) {
    c.declareStruct(buf)(this.cstruct)
  },
  allocate(buf) {
    c.declarePtrPtr(buf)(`struct ${sym}`, this.name,
      c.cast(`struct ${sym} *`, c.malloc(`struct ${sym}`, this.parentCapacity)))
  }
})

exports.hashMap = (schema, sym, capacity, tuple) => ({
  tag: VAL_TAG.HASHMAP,
  schema,
  sym,
  htable: `${sym}_htable$`,
  size: `${sym}_size$`,
  capacity,
  keys: [],
  buffer: tuple ? base.objectBuffer(schema.objValue) : undefined,
  tuple,
  getKey(keyPos) {
    return this.keys.map(key => key.get(keyPos))
  },
  getVal(keyPos) {
    return this.buffer.get(keyPos)
  },
  get(keyPos) {
    return { key: this.getKey(keyPos), val: this.getVal(keyPos) }
  },
  setOrAddBuffer(name, buffer) {
    if (this.tuple) {
      this.buffer.addBufferField(name, buffer)
    } else {
      this.buffer = buffer
    }
  },
  // Code generation
  init(buf) {
    c.comment(buf)(`init hashmap for ${this.sym}`)
    c.declareIntPtr(buf)(this.htable,
      c.cast("int *", c.calloc("int", capacity)))
    c.declareInt(buf)(this.size, "0")
  },
  initKeys(buf, keySchema) {
    for (let i in keySchema) {
      let schema = keySchema[i]
      let prefix = `${sym}_key${i}`
      this.keys.push(allocateBuffer(buf, prefix, schema, this.capacity))
    }
  },
  addColumn(buf, name, schema) {
    c.comment(buf)(`columm ${name} for ${this.sym}`)
    let bufferName = `${this.sym}_${name}`
    let newBuffer = allocateBuffer(buf, bufferName, schema, this.capacity)
    this.setOrAddBuffer(name, newBuffer)
  },
  addBucketCol(buf, name, schema, bucketCapacity, bucketTuple) {
    c.comment(buf)(`columm ${name} for ${this.sym}`)
    let bufferName = `${this.sym}_${name}`
    let newBuffer = exports.hashBucketBuffer(
      schema, bufferName, bucketCapacity, this.capacity, bucketTuple)
    newBuffer.allocate(buf)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  },
  addLinkedBucketCol(buf, name, schema, factor, bucketTuple) {
    c.comment(buf)(`columm ${name} for ${this.sym}`)
    let bufferName = `${this.sym}_${name}`
    let newBuffer = exports.hashLinkedBucketBuffer(
      schema, bufferName, factor, this.capacity, bucketTuple)
    newBuffer.allocate(buf)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  },
  addNestedHashMapCol(buf, name, schema, mapSym, mapCapacity, mapTuple) {
    c.comment(buf)(`columm ${name} for ${this.sym}`)
    let bufferName = `${this.sym}_${name}`
    let newBuffer =
      exports.nestedHashMapBuffer(
        schema, mapSym, bufferName, mapCapacity, mapTuple)
    newBuffer.init()
    newBuffer.allocate(buf)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  },
})
