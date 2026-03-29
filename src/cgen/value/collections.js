// Arrays & Hash tables

const { VAL_TAG, BUF_TAG } = require("./tags")
const { c, utils } = require("../utils")
const { typing, types } = require("../../typing")

const { quoteVar } = utils

const base = require("./base")

const { getSettings, resetSettings } = require("../settings")
const { symbol } = require("../symbol")

// Array
exports.array = (schema, sym, capacity, tuple) => ({
  tag: VAL_TAG.ARRAY,
  schema,
  sym,
  size: `${sym}_size$`,
  capacity,
  buffer: tuple ? base.objectBuffer(schema.objValue) : undefined,
  tuple,
  get(idx) {
    return this.buffer.get(idx)
  },
  addColumn(name, schema) {
    let bufferName = `${this.sym}_${name}`
    let newBuffer = typing.isString(schema) ?
      base.stringBuffer(schema, bufferName, this.capacity) :
      base.primitiveBuffer(schema, bufferName, this.capacity)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
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
  declare(buf) {
    c.comment(buf)(`declaring array "${this.sym}"`)
    c.declareInt(buf)(this.size, "0")
    this.buffer.allocate(buf)
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
  },
  print(buf, limit) {
    limit = limit ? c.ternary(c.lt(limit, this.size), limit, this.size) : this.size
    let cType = utils.convertToCType(this.schema.objKey)
    let iter = symbol.getSymbol("print_iter")
    buf.push(`for (${cType} ${iter} = 0; ${iter} < ${this.size}; ${iter}++) {`)
    this.get(iter).print(buf)
    // c.if(buf)(c.ne(iter, c.sub(limit, 1)), buf1 => {
    c.printf(buf)("\n")
    // })
    buf.push("}")
  }
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
  addColumn(name, schema) {
    let bufferName = `${this.name}_${name}`
    let bufferSize = this.parentCapacity * this.capacity
    let newBuffer = typing.isString(schema) ?
      base.stringBuffer(schema, bufferName, bufferSize) :
      base.primitiveBuffer(schema, bufferName, bufferSize)
    if (tuple) {
      this.buffer.addBufferField(name, newBuffer)
    } else {
      this.buffer = newBuffer
    }
    return newBuffer
  },
  allocate(buf) {
    // Allocate the array that stores the sizes of all buckets in the buffer
    c.declareIntPtr(buf)(this.sizeBuf,
      c.cast("int *", c.malloc("int", this.parentCapacity)))
    this.buffer.allocate(buf)
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
  addColumn(name, schema) {
    let bufferName = `${this.name}_${name}`
    let bufferSize = this.parentCapacity * this.factor
    let newBuffer = typing.isString(schema) ?
      base.stringBuffer(schema, bufferName, bufferSize) :
      base.primitiveBuffer(schema, bufferName, bufferSize)
    if (tuple) {
      this.buffer.addBufferField(name, newBuffer)
    } else {
      this.buffer = newBuffer
    }
    return newBuffer
  },
  allocate(buf) {
    // Allocate the array that stores the sizes of all buckets in the buffer
    c.declareIntPtr(buf)(this.headBuf,
      c.cast("int *", c.malloc("int", this.parentCapacity)))
    c.declareIntPtr(buf)(this.prevBuf,
      c.cast("int *", c.malloc("int", this.parentCapacity * this.factor)))
    this.buffer.allocate(buf)
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
  cstruct: c.struct(sym).addField("int *", this.htable).addField("int", this.size),
  get(idx) {
    // get the nested hashmap
    utils.internalError("not implemented")
  },
  addKeys(keySchema) {
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
  declareStruct(buf) {
    c.declareStruct(buf)(this.cstruct)
  },
  allocate(buf) {
    c.declarePtrPtr(buf)(`struct ${sym}`, this.name,
      c.cast(`struct ${sym} *`, c.malloc(`struct ${sym}`, this.parentCapacity)))
  }
})

exports.hashMap = (schema, sym, capacity, multiKey, tuple) => ({
  tag: VAL_TAG.HASHMAP,
  schema,
  sym,
  htable: `${sym}_htable$`,
  size: `${sym}_size$`,
  capacity,
  key: multiKey ? base.keysBuffer() : undefined,
  multiKey,
  buffer: tuple ? base.objectBuffer(schema.objValue) : undefined,
  tuple,
  getKey(keyPos) {
    return this.key.get(keyPos)
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
  addKey(keySchema) {
    let bufferName
    if (this.multiKey) {
      bufferName = `${this.sym}_key${this.key.buffers.length}`
    } else {
      bufferName = `${this.sym}_key`
    }
    let newBuffer = typing.isString(keySchema) ?
      base.stringBuffer(keySchema, bufferName, this.capacity) :
      base.primitiveBuffer(keySchema, bufferName, this.capacity)
    if (this.multiKey) {
      this.key.addBuffer(newBuffer)
    } else {
      this.key = newBuffer
    }
  },
  // Code generation
  declare(buf) {
    c.comment(buf)(`declaring hashmap "${this.sym}"`)
    c.declareIntPtr(buf)(this.htable,
      c.cast("int *", c.calloc("int", capacity)))
    c.declareInt(buf)(this.size, "0")
    c.comment(buf)(`keys for hashmap "${this.sym}"`)
    this.key.allocate(buf)
    c.comment(buf)(`values for hashmap "${this.sym}"`)
    this.buffer.allocate(buf)
  },
  addColumn(name, schema) {
    let bufferName = `${this.sym}_${name}`
    let newBuffer = typing.isString(schema) ?
      base.stringBuffer(schema, bufferName, this.capacity) :
      base.primitiveBuffer(schema, bufferName, this.capacity)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  },
  addBucketCol(name, schema, bucketCapacity, bucketTuple) {
    let bufferName = `${this.sym}_${name}`
    let newBuffer = exports.hashBucketBuffer(
      schema, bufferName, bucketCapacity, this.capacity, bucketTuple)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  },
  addLinkedBucketCol(name, schema, factor, bucketTuple) {
    let bufferName = `${this.sym}_${name}`
    let newBuffer = exports.hashLinkedBucketBuffer(
      schema, bufferName, factor, this.capacity, bucketTuple)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  },
  addNestedHashMapCol(name, schema, mapSym, mapCapacity, mapTuple) {
    let bufferName = `${this.sym}_${name}`
    let newBuffer =
      exports.nestedHashMapBuffer(
        schema, mapSym, bufferName, mapCapacity, this.capacity, mapTuple)
    this.setOrAddBuffer(name, newBuffer)
    return newBuffer
  },
  lookup(buf, key) {
    let mask = this.capacity - 1

    let pos = symbol.getSymbol("tmp_pos") + "$" // aid cse
    let keyPos = symbol.getSymbol("key_pos") + "$"

    let stmt = {
      map: this,
      key,
      out: [pos, keyPos],
      emit: function (buf) {
        let hashed = key.hash(buf)

        let [pos, keyPos] = this.out
        c.declareULong(buf)(pos, c.binary(hashed, mask, "&"))

        let dynKeyPos = `${this.map.htable}[${pos}]`
        let keyAtPos = this.map.getKey(dynKeyPos)
        let compareKeys = keyAtPos.compare("==", this.key)

        // increment the position until we find a match or an empty slot
        c.while(buf)(
          c.and(c.ne(dynKeyPos, "0"), c.not(compareKeys)),
          buf1 => {
            c.stmt(buf1)(c.assign(pos, c.binary(c.add(pos, "1"), mask, "&")))
          }
        )
        c.declareInt(buf)(keyPos, dynKeyPos)
      }
    }

    buf.push(stmt)
    return [pos, keyPos]
  },
  printJSON(buf, limit) {
    limit = limit ? c.ternary(c.lt(limit, this.size), limit, count) : this.size
    let iter = symbol.getSymbol("print_iter")
    c.printf(buf)("{")
    buf.push(`for (int ${iter} = 1; ${iter} < ${this.size}; ${iter}++) {`)
    let entry = this.get(iter)
    entry.key.printJSON(buf, true)
    c.printf(buf)(":")
    entry.val.printJSON(buf)
    c.if(buf)(c.ne(iter, limit), buf1 => {
      c.printf(buf1)(",")
    })
    buf.push("}")
    c.printf(buf)("}")
  }
})
