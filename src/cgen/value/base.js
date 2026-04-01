// Value rep objects for low level C code
// primitive values

const { c, utils } = require("../utils")
const { typing, types, typeSyms } = require("../../typing")
const { symbol } = require("../symbol")

exports.copy = function(obj) {
  return Object.assign(Object.create(Object.getPrototypeOf(obj)), obj)
}

class CValue {
  schema

  constructor(schema) {
    this.schema = schema
  }

  printJSON() {
    throw new Error("Not implemented")
  }

  print() {
    throw new Error("Not implemented")
  }
}

class CBasicValue extends CValue {
  hash() {
    throw new Error("Not implemented")
  }

  assign() {
    throw new Error("Not implemented")
  }

  compare() {
    throw new Error("Not implemented")
  }
}

class CPrim extends CBasicValue {
  val

  constructor(schema, val) {
    super(schema)
    this.val = val
  }

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

  assign(buf, rhs) {
    c.stmt(buf)(c.assign(this.val, rhs.val))
  }

  compare(op, rhs) {
    return c.binary(this.val, rhs.val, op)
  }

  printJSON(buf, quoted) {
    if (this.schema.typeSym == typeSyms.date) {
      if (quoted) c.printf(buf)("\\\"")
      c.stmt(buf)(c.call("print_date", this.val))
      if (quoted) c.printf(buf)("\\\"")
    } else if (quoted) {
      c.printf(buf)(`\\"%${utils.getFormatSpecifier(this.schema)}\\"`, this.val)
    } else {
      c.printf(buf)(`%${utils.getFormatSpecifier(this.schema)}`, this.val)
    }
  }

  print(buf) {
    this.printJSON(buf)
  }
}

class CString extends CBasicValue {
  str
  len

  constructor(schema, str, len) {
    super(schema)
    this.str = str
    this.len = len
  }

  hash(buf, hashed) {
    hashed = hashed || symbol.getSymbol("hash")
    c.declareULong(buf)(hashed, c.call("hash", this.str, this.len))
    return hashed
  }

  assign(buf, rhs) {
    c.stmt(buf)(c.assign(this.str, rhs.str))
    c.stmt(buf)(c.assign(this.len, rhs.len))
  }

  compare(op, rhs) {
    let str1 = this.str
    let len1 = this.len
    let str2 = rhs.str
    let len2 = rhs.len
    return c.binary(
      c.call("strncmp", str1, str2, c.ternary(c.lt(len1, len2), len1, len2)),
      "0", op
    )
  }

  printJSON(buf) {
    c.printf(buf)(`\\"%.*s\\"`, this.len, this.str)
  }

  print(buf) {
    c.printf(buf)(`%.*s`, this.len, this.str)
  }
}

class CCompoundValue extends CBasicValue {
  values

  constructor(schema, values) {
    super(schema)
    this.values = values
  }

  addValue() {
    throw new Error("Not implemented")
  }

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

  assign(buf, rhs) {
    for (let key in this.values) {
      let value = this.values[key]
      value.assign(buf, rhs.values[key])
    }
  }

  compare(op, rhs) {
    let res
    for (let key in this.values) {
      let value = this.values[key]
      let cmp = value.compare(op, rhs.values[key])
      if (res) {
        res = c.and(res, cmp)
      } else {
        res = cmp
      }
    }
    return res
  }

  print(buf) {
    for (let k in this.values) {
      let v = this.values[k]
      v.print(buf)
      c.printf(buf)("|");
    }
  }
}

class CObject extends CCompoundValue {
  constructor(schema) {
    super(schema, {})
  }

  addValue(key, value) {
    this.values[key] = value
  }

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
  }
}

class CKeys extends CCompoundValue {
  constructor(schema) {
    super(schema, [])
  }

  addKey(key) {
    this.values.push(key)
  }

  // Same as addKey
  addValue(value) {
    this.values.push(value)
  }

  printJSON(buf) {
    c.printf(buf)("\\\"");
    for (let i in this.values) {
      let key = this.values[i]
      key.print(buf)
      if (i != this.values.length - 1) {
        c.printf(buf)(",")
      }
    }
    c.printf(buf)("\\\"");
  }
}

class CBuffer {
  schema
  capacity

  constructor(schema, capacity) {
    this.schema = schema
    this.capacity = capacity
  }

  get() {
    throw new Error("Not implemented")
  }

  shift() {
    throw new Error("Not implemented")
  }

  derefFrom() {
    throw new Error("Not implemented")
  }

  allocate() {
    throw new Error("Not implemented")
  }

  declare() {
    throw new Error("Not implemented")
  }

  allocateAssign() {
    throw new Error("Not implemented")
  }
}

class CPrimBuffer extends CBuffer {
  valBuf

  constructor(schema, capacity, valBuf) {
    super(schema, capacity)
    this.valBuf = valBuf
  }

  get(idx) {
    let val = `${this.valBuf}[${idx}]`
    return new CPrim(this.schema, val)
  }

  shift(offset) {
    let newBuffer = new CPrimBuffer(
      this.schema, this.capacity, c.add(this.valBuf, offset))
    return newBuffer
  }

  derefFrom(ptr) {
    let newBuffer = new CPrimBuffer(
      this.schema, this.capacity, `${ptr}->${this.valBuf}`)
    return newBuffer
  }

  declare(buf) {
    let cType = utils.convertToCType(this.schema)
    c.declarePtr(buf)(cType, this.valBuf)
  }

  allocateAssign(buf) {
    // let convertToCType report "type not supported" errors
    let cType = utils.convertToCType(this.schema)
    c.stmt(buf)(c.assign(this.valBuf,
      c.cast(`${cType} *`, c.malloc(cType, this.capacity))))
  }

  allocate(buf) {
    // let convertToCType report "type not supported" errors
    let cType = utils.convertToCType(this.schema)
    c.declarePtr(buf)(cType, this.valBuf,
      c.cast(`${cType} *`, c.malloc(cType, this.capacity)))
  }
}

class CStringBuffer extends CBuffer {
  strBuf
  lenBuf

  constructor(schema, capacity, strBuf) {
    super(schema, capacity)
    this.strBuf = strBuf
    this.lenBuf = strBuf + "_len$"
  }

  get(idx) {
    let str = `${this.strBuf}[${idx}]`
    let len = `${this.lenBuf}[${idx}]`
    return new CString(this.schema, str, len)
  }

  shift(offset) {
    let newBuffer = new CStringBuffer(
      this.schema, this.capacity, this.strBuf)
    newBuffer.strBuf = c.add(this.strBuf, offset)
    newBuffer.lenBuf = c.add(this.lenBuf, offset)
    return newBuffer
  }

  derefFrom(ptr) {
    let newBuffer = new CStringBuffer(
      this.schema, this.capacity, this.strBuf)
    newBuffer.strBuf = `${ptr}->${this.strBuf}`
    newBuffer.lenBuf = `${ptr}->${this.lenBuf}`
    return newBuffer
  }

  declare(buf) {
    c.declareCharPtrPtr(buf)(this.strBuf)
    c.declareIntPtr(buf)(this.lenBuf)
  }

  allocateAssign(buf) {
    c.stmt(buf)(c.assign(this.strBuf,
      c.cast("const char **", c.malloc("const char *", this.capacity))))
    c.stmt(buf)(c.assign(this.lenBuf,
      c.cast("int *", c.malloc("int", this.capacity))))
  }

  allocate(buf) {
    c.declareCharPtrPtr(buf)(this.strBuf,
      c.cast("const char **", c.malloc("const char *", this.capacity)))
    c.declareIntPtr(buf)(this.lenBuf,
      c.cast("int *", c.malloc("int", this.capacity)))
  }
}

class CCompoundBuffer extends CBuffer {
  buffers

  constructor(schema, capacity, buffers) {
    super(schema, capacity)
    this.buffers = buffers
  }

  addBuffer() {
    throw new Error("Not implemented")
  }

  addBufferField(key, buffer) {
    this.buffers[key] = buffer
  }

  allocate(buf) {
    for (let key in this.buffers) {
      this.buffers[key].allocate(buf)
    }
  }

  allocateAssign(buf) {
    for (let key in this.buffers) {
      this.buffers[key].allocateAssign(buf)
    }
  }
}

class CObjectBuffer extends CCompoundBuffer {
  constructor(schema, capacity) {
    super(schema, capacity, {})
  }
  
  addBuffer(key, buffer) {
    this.buffers[key] = buffer
  }

  get(idx) {
    let res = new CObject(this.schema)
    for (let key in this.buffers) {
      let buffer = this.buffers[key]
      res.addValue(key, buffer.get(idx))
    }
    return res
  }

  shift(offset) {
    let newBuffer = new CObjectBuffer(this.schema, this.capacity)
    for (let key in this.buffers) {
      let buffer = this.buffers[key].shift(offset)
      newBuffer.addBuffer(key, buffer)
    }
    return newBuffer
  }

  derefFrom(ptr) {
    let newBuffer = new CObjectBuffer(this.schema, this.capacity)
    for (let key in this.buffers) {
      let buffer = this.buffers[key].derefFrom(ptr)
      newBuffer.addBuffer(key, buffer)
    }
    return newBuffer
  }
}

class CKeysBuffer extends CCompoundBuffer {
  constructor(schema, capacity) {
    super(schema, capacity, [])
  }
  
  addBuffer(buffer) {
    this.buffers.push(buffer)
  }

  get(idx) {
    let res = new CKeys(this.schema)
    for (let key in this.buffers) {
      let buffer = this.buffers[key]
      res.addValue(buffer.get(idx))
    }
    return res
  }

  shift(offset) {
    let newBuffer = new CKeysBuffer(this.schema, this.capacity)
    for (let key in this.buffers) {
      let buffer = this.buffers[key].shift(offset)
      newBuffer.addBuffer(buffer)
    }
    return newBuffer
  }

  derefFrom(ptr) {
    let newBuffer = new CKeysBuffer(this.schema, this.capacity)
    for (let key in this.buffers) {
      let buffer = this.buffers[key].derefFrom(ptr)
      newBuffer.addBuffer(buffer)
    }
    return newBuffer
  }
}

exports.CValue = CValue
exports.CBasicValue = CBasicValue
exports.CPrim = CPrim
exports.CString = CString
exports.CCompoundValue = CCompoundValue
exports.CObject = CObject
exports.CKeys = CKeys
exports.CBuffer = CBuffer
exports.CPrimBuffer = CPrimBuffer
exports.CStringBuffer = CStringBuffer
exports.CCompoundBuffer = CCompoundBuffer
exports.CObjectBuffer = CObjectBuffer
exports.CKeysBuffer = CKeysBuffer
