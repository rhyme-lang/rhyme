// Value rep objects for low level C code
// primitive values

const { VAL_TAG, BUF_TAG } = require("./tags")
const { c, utils } = require("../utils")
const { typing, types } = require("../../typing")
const { symbol } = require("../symbol")

// C primitive values. e.g. int, char etc.
exports.primitive = (schema, val) => ({
  tag: VAL_TAG.PRIMITIVE,
  schema,
  val,
  assign(buf, rhs) {
    console.log(rhs)
    c.stmt(buf)(c.assign(this.val, rhs.val))
  },
  hash(buf, hashed) {
    hashed = hashed || symbol.getSymbol("hash")
    if (!typing.isNumber(this.schema) &&
      this.schema.typeSym != typeSyms.char &&
      this.schema.typeSym != typeSyms.date) {
      utils.internalError(
        "Cannot hash value with type " + typing.prettyPrintType(this.schema))
    }
    c.declareULong(buf)(hashed, c.cast("unsigned long", this.val))
    return hashed
  }
})

// C strings
exports.string = (schema, str, len) => ({
  tag: VAL_TAG.STRING,
  schema,
  str,
  len,
  assign(buf, rhs) {
    c.stmt(buf)(c.assign(this.str, rhs.str))
    c.stmt(buf)(c.assign(this.len, rhs.len))
  },
  hash(buf, hashed) {
    hashed = hashed || symbol.getSymbol("hash")
    c.declareULong(buf)(hashed, c.call("hash", this.str, this.len))
    return hashed
  }
})

// Object with constant keys
exports.object = (schema) => ({
  tag: VAL_TAG.OBJECT,
  schema,
  values: {},
  assign(buf, rhs) {
    for (let key in this.values) {
      let value = this.values[key]
      value.assign(buf, rhs.values[key])
    }
  },
  addField(key, value) {
    this.values[key] = value
  },
  hash(buf, hashed) {
    hashed = hashed || symbol.getSymbol("hash")
    let result
    for (let key in this.values) {
      let value = this.values[key]
      let tmp = symbol.getSymbol("tmp_hash")
      let tmpHash = value.hash(buf, tmp)
      if (result) {
        result = c.add(c.mul(result, "31"), tmpHash)
      } else {
        result = tmpHash
      }
    }
    c.declareULong(buf)(hashed, result)
    return hashed
  }
})

// Buffers represent the C arrays that stores a collection of values
// which are typically seen under arrays or hashmaps
exports.primitiveBuffer = (schema, name, capacity) => ({
  tag: BUF_TAG.PRIMITIVE,
  schema,
  name,
  valBuf: name,
  capacity,
  get(idx) {
    let val = `${this.valBuf}[${idx}]`
    return exports.primitive(this.schema, val)
  },
  shift(offset) {
    let newBuffer = { ...this }
    newBuffer.valBuf = c.add(newBuffer.valBuf, offset)
    return newBuffer
  },
  allocate(buf) {
    // let convertToCType report "type not supported" errors
    let cType = utils.convertToCType(this.schema)
    c.declarePtr(buf)(cType, this.valBuf,
      c.cast(`${cType} *`, c.malloc(cType, this.capacity)))
  }
})

exports.stringBuffer = (schema, name, capacity) => ({
  tag: BUF_TAG.STRING,
  schema,
  name,
  strBuf: `${name}_str`,
  lenBuf: `${name}_len`,
  capacity,
  get(idx) {
    let str = `${this.strBuf}[${idx}]`
    let len = `${this.lenBuf}[${idx}]`
    return exports.string(this.schema, str, len)
  },
  shift(offset) {
    let newBuffer = { ...this }
    newBuffer.strBuf = c.add(newBuffer.valBuf, offset)
    newBuffer.lenBuf = c.add(newBuffer.valBuf, offset)
    return newBuffer
  },
  allocate(buf) {
    c.declareCharPtrPtr(buf)(this.strBuf,
      c.cast("const char **", c.malloc("const char *", this.capacity)))
    c.declareIntPtr(buf)(this.lenBuf,
      c.cast("int *", c.malloc("int", this.capacity)))
  }
})

exports.objectBuffer = (schema) => ({
  tag: BUF_TAG.OBJECT,
  schema,
  buffers: {},
  get(idx) {
    let res = exports.object(this.schema)
    for (let key in this.buffers) {
      let buffer = this.buffers[key]
      res.addField(key, buffer.get(idx))
    }
    return res
  },
  shift(offset) {
    let newBuffer = exports.objectBuffer(this.schema)
    for (let key in this.buffers) {
      let buffer = this.buffers[key].shift(offset)
      newBuffer.addBufferField(key, buffer)
    }
    return newBuffer
  },
  addBufferField(key, buffer) {
    this.buffers[key] = buffer
  }
})
