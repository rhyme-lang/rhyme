// Value rep objects for low level C code
// primitive values

const { VAL_TAG, BUF_TAG } = require("./tags")
const { c, utils } = require("../utils")
const { typing, types, typeSyms } = require("../../typing")
const { symbol } = require("../symbol")

// C primitive values. e.g. int, char etc.
exports.primitive = (schema, val) => ({
  tag: VAL_TAG.PRIMITIVE,
  schema,
  val,
  assign(buf, rhs) {
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
  },
  compare(op, rhs) {
    return c.binary(this.val, rhs.val, op)
  },
  printJSON(buf, quoted) {
    if (this.schema.typeSym == typeSyms.date) {
      if (quoted) c.printf(buf)("\\\"")
      c.stmt(buf)(c.call("print_date", this.val))
      if (quoted) c.printf(buf)("\\\"")
    } else if (quoted) {
      c.printf(buf)(`"%${utils.getFormatSpecifier(this.schema)}"`, this.val)
    } else {
      c.printf(buf)(`%${utils.getFormatSpecifier(this.schema)}`, this.val)
    }
  },
  print(buf) {
    this.printJSON(buf)
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
  },
  compare(op, rhs) {
    let str1 = this.str
    let len1 = this.len
    let str2 = rhs.str
    let len2 = rhs.len
    return c.binary(
      c.call("strncmp", str1, str2, c.ternary(c.lt(len1, len2), len1, len2)),
      "0", op
    )
  },
  printJSON(buf) {
    c.printf(buf)(`\\"%.*s\\"`, this.len, this.str)
  },
  print(buf) {
    c.printf(buf)(`%.*s`, this.len, this.str)
  }
})

// Co with constant keys
exports.keys = () => ({
  tag: VAL_TAG.KEYS,
  keys: [],
  addKey(key) {
    this.keys.push(key)
  },
  assign(buf, rhs) {
    for (let i in this.keys) {
      let key = this.keys[i]
      key.assign(buf, rhs.keys[i])
    }
  },
  hash(buf, hashed) {
    hashed = hashed || symbol.getSymbol("hash")
    let result
    for (let i in this.keys) {
      let key = this.keys[i]
      let tmp = symbol.getSymbol("tmp_hash")
      let tmpHash = key.hash(buf, tmp)
      if (result) {
        result = c.add(c.mul(result, "31"), tmpHash)
      } else {
        result = tmpHash
      }
    }
    c.declareULong(buf)(hashed, result)
    return hashed
  },
  compare(op, rhs) {
    let res
    for (let i in this.keys) {
      let key = this.keys[i]
      let cmp = key.compare(op, rhs.keys[i])
      if (res) {
        res = c.and(res, cmp)
      } else {
        res = cmp
      }
    }
    return res
  },
  printJSON(buf) {
    c.printf(buf)("\\\"");
    for (let i in this.keys) {
      let key = this.keys[i]
      key.print(buf)
      if (i != this.keys.length - 1) {
        c.printf(buf)(",")
      }
    }
    c.printf(buf)("\\\"");
  },
  print(buf) {
    for (let i in this.keys) {
      let key = this.keys[i]
      key.print(buf)
      c.printf(buf)("|");
    }
  }
})

// Object with constant keys
exports.object = (schema) => ({
  tag: VAL_TAG.OBJECT,
  schema,
  values: {},
  get(key) {
    return this.values[key]
  },
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
  },
  printJSON(buf) {
    c.printf(buf)("{");
    for (let i in Object.keys(this.values)) {
      let k = Object.keys(this.values)[i]
      let v = this.values[k]
      c.printf(buf)(`\\"${k}\\":`)
      v.printJSON(buf)
      if (i != Object.keys(this.values).length - 1) {
        c.printf(buf)(",")
      }
    }
    c.printf(buf)("}");
  },
  print(buf) {
    for (let k in this.values) {
      let v = this.values[k]
      v.print(buf)
      c.printf(buf)("|");
    }
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
  derefFrom(ptr) {
    let newBuffer = { ...this }
    newBuffer.valBuf = `${ptr}->${newBuffer.valBuf}`
    return newBuffer
  },
  addToStruct(struct) {
    let cType = utils.convertToCType(this.schema)
    struct.addField(cType + " *", this.valBuf)
  },
  allocateAssign(buf) {
    // let convertToCType report "type not supported" errors
    let cType = utils.convertToCType(this.schema)
    c.stmt(buf)(c.assign(this.valBuf,
      c.cast(`${cType} *`, c.malloc(cType, this.capacity))))
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
    newBuffer.strBuf = c.add(newBuffer.strBuf, offset)
    newBuffer.lenBuf = c.add(newBuffer.lenBuf, offset)
    return newBuffer
  },
  derefFrom(ptr) {
    let newBuffer = { ...this }
    newBuffer.strBuf = `${ptr}->${newBuffer.strBuf}`
    newBuffer.lenBuf = `${ptr}->${newBuffer.lenBuf}`
    return newBuffer
  },
  addToStruct(struct) {
    struct.addField("const char **", this.strBuf)
    struct.addField("int *", this.lenBuf)
  },
  allocate(buf) {
    c.declareCharPtrPtr(buf)(this.strBuf,
      c.cast("const char **", c.malloc("const char *", this.capacity)))
    c.declareIntPtr(buf)(this.lenBuf,
      c.cast("int *", c.malloc("int", this.capacity)))
  },
  allocateAssign(buf) {
    c.stmt(buf)(c.assign(this.strBuf,
      c.cast("const char **", c.malloc("const char *", this.capacity))))
    c.stmt(buf)(c.assign(this.lenBuf,
      c.cast("int *", c.malloc("int", this.capacity))))
  },
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
  derefFrom(ptr) {
    let newBuffer = exports.objectBuffer(this.schema)
    for (let key in this.buffers) {
      let buffer = this.buffers[key].derefFrom(ptr)
      newBuffer.addBufferField(key, buffer)
    }
    return newBuffer
  },
  addToStruct(struct) {
    for (let key in this.buffers) {
      this.buffers[key].addToStruct(struct)
    }
  },
  addBufferField(key, buffer) {
    this.buffers[key] = buffer
  },
  allocate(buf) {
    for (let key in this.buffers) {
      this.buffers[key].allocate(buf)
    }
  },
  allocateAssign(buf) {
    for (let key in this.buffers) {
      this.buffers[key].allocateAssign(buf)
    }
  },
})

exports.keysBuffer = () => ({
  tag: BUF_TAG.KEYS,
  buffers: [],
  get(idx) {
    let res = exports.keys()
    for (let i in this.buffers) {
      let buffer = this.buffers[i]
      res.addKey(buffer.get(idx))
    }
    return res
  },
  shift(offset) {
    utils.internalError("not supported")
  },
  derefFrom(ptr) {
    let newBuffer = exports.keysBuffer()
    for (let i in this.buffers) {
      let buffer = this.buffers[i].derefFrom(ptr)
      newBuffer.addBuffer(buffer)
    }
    return newBuffer
  },
  addToStruct(struct) {
    for (let i in this.buffers) {
      this.buffers[i].addToStruct(struct)
    }
  },
  addBuffer(buffer) {
    this.buffers.push(buffer)
  },
  allocate(buf) {
    for (let i in this.buffers) {
      this.buffers[i].allocate(buf)
    }
  },
  allocateAssign(buf) {
    for (let i in this.buffers) {
      this.buffers[i].allocateAssign(buf)
    }
  },
})
