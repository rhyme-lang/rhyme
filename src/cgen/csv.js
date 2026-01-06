const { symbol } = require("./symbol")
const { c, utils } = require("./utils")
const { pretty } = require('../prettyprint')

const { typing, types, typeSyms } = require('../typing')

let { quoteVar } = utils

// Emit code that opens the CSV file and calls mmap
let emitLoadCSV = (buf, filename, ext) => {
  let mappedFile = symbol.getSymbol(`file_${ext}`)

  let fd = symbol.getSymbol("fd")

  let size = symbol.getSymbol("n")

  c.declareInt(buf)(fd, c.open(filename))
  c.if(buf)(c.binary(fd, "-1", "=="), buf1 => {
    c.printErr(buf1)("Unable to open file %s\\n", filename)
    c.return(buf1)("1")
  })
  c.declareSize(buf)(size, c.call("fsize", fd))
  c.declareCharPtr(buf)(mappedFile, c.mmap(fd, size))
  c.stmt(buf)(c.close(fd))

  return { mappedFile, size }
}

// Skip the column until the delimiter is found
let scanColumn = (buf, mappedFile, cursor, size, delim) => {
  c.while1(buf)(
    c.ne(`${mappedFile}[${cursor}]`, delim),
    c.inc(cursor)
  )
  c.stmt(buf)(c.inc(cursor))
}

// Scan the column and store the start and end position
let scanString = (buf, mappedFile, cursor, size, delim, start, end) => {
  c.declareSize(buf)(start, cursor)
  c.while1(buf)(
    c.ne(`${mappedFile}[${cursor}]`, delim),
    c.inc(cursor)
  )
  c.declareSize(buf)(end, cursor)
  c.stmt(buf)(c.inc(cursor))
}

// Scan the column and calculate the integer value
let scanInteger = (buf, mappedFile, cursor, size, delim, name, type) => {
  c.declareVar(buf)(utils.convertToCType(type), name, "0")
  let negative = symbol.getSymbol("tmp_negative")
  c.declareVar(buf)(utils.convertToCType(type), negative, "0")
  c.if(buf)(c.eq(`${mappedFile}[${cursor}]`, `'-'`), buf1 => {
    c.stmt(buf1)(c.assign(negative, "1"))
    c.stmt(buf1)(c.inc(cursor))
  })
  c.while(buf)(
    c.ne(`${mappedFile}[${cursor}]`, delim),
    buf1 => {
      c.comment(buf1)("extract integer")
      c.stmt(buf1)(c.assign(name, c.add(c.mul(name, "10"), c.sub(`${mappedFile}[${cursor}]`, "'0'"), "+")))
      c.stmt(buf1)(c.inc(cursor))
    }
  )
  c.stmt(buf)(c.inc(cursor))
  c.if(buf)(negative, buf1 => {
    c.stmt(buf1)(c.assign(name, "-" + name))
  })
}

// Scan the column and calculate the decimal value
let scanDecimal = (buf, mappedFile, cursor, size, delim, name, type) => {
  let number = symbol.getSymbol("number")
  let scale = symbol.getSymbol("scale")

  c.declareLong(buf)(number, "0")
  c.declareLong(buf)(scale, "1")

  let negative = symbol.getSymbol("tmp_negative")
  c.declareInt(buf)(negative, "0")
  c.if(buf)(c.eq(`${mappedFile}[${cursor}]`, `'-'`), buf1 => {
    c.stmt(buf1)(c.assign(negative, "1"))
    c.stmt(buf1)(c.inc(cursor))
  })

  // calculate integer part
  c.while(buf)(
    c.and(
      c.ne(`${mappedFile}[${cursor}]`, "'.'"),
      c.ne(`${mappedFile}[${cursor}]`, delim),
    ),
    buf1 => {
      c.comment(buf1)("extract integer part")
      c.stmt(buf1)(c.assign(number, c.add(c.mul(number, "10"), c.sub(`${mappedFile}[${cursor}]`, "'0'"), "+")))
      c.stmt(buf1)(c.inc(cursor))
    }
  )

  // check if we have a dot after integer part
  c.if(buf)(
    c.eq(`${mappedFile}[${cursor}]`, "'.'"),
    buf1 => {
      c.stmt(buf1)(c.inc(cursor))
      c.while(buf1)(
        c.ne(`${mappedFile}[${cursor}]`, delim),
        buf2 => {
          c.comment(buf2)("extract fractional part")
          c.stmt(buf1)(c.assign(number, c.add(c.mul(number, "10"), c.sub(`${mappedFile}[${cursor}]`, "'0'"), "+")))
          c.stmt(buf1)(c.assign(scale, c.mul(scale, "10")))
          c.stmt(buf2)(c.inc(cursor))
        }
      )
    }
  )
  c.declareVar(buf)(utils.convertToCType(type), name,
    c.div(c.cast("double", number), scale)
  )
  c.stmt(buf)(c.inc(cursor))

  c.if(buf)(negative, buf1 => {
    c.stmt(buf1)(c.assign(name, "-" + name))
  })
}

// Scan the column and calculate the date value
let scanDate = (buf, mappedFile, cursor, size, delim, name) => {
  // unrolled loop
  let digits = [
    `${mappedFile}[${cursor}]`,
    `${mappedFile}[${cursor} + 1]`,
    `${mappedFile}[${cursor} + 2]`,
    `${mappedFile}[${cursor} + 3]`,
    ,
    `${mappedFile}[${cursor} + 5]`,
    `${mappedFile}[${cursor} + 6]`,
    ,
    `${mappedFile}[${cursor} + 8]`,
    `${mappedFile}[${cursor} + 9]`,
  ]
  c.declareVar(buf)("int32_t", name,
    `(((((((${digits[0]} * 10 + ${digits[1]}) * 10 + ${digits[2]}) * 10 + ${digits[3]}) * 10 + ${digits[5]}) * 10 + ${digits[6]}) * 10 + ${digits[8]}) * 10 + ${digits[9]}) - 533333328`
  )
  c.stmt(buf)(c.assign(cursor, c.binary(cursor, "11", "+")))
}

// Scan the column and calculate the date value
let scanChar = (buf, mappedFile, cursor, size, delim, name) => {
  c.declareVar(buf)("char", name, `${mappedFile}[${cursor}]`);
  c.stmt(buf)(c.assign(cursor, c.binary(cursor, "2", "+")))
}

// Emit code that scans through each row in the CSV file.
// Will extract the value of a column if the column is used by the query.
let emitRowScanning = (f, file, cursor, schema, usedCols, first = true) => {
  let getDelim = (format, first) => {
    if (format == "csv") {
      return first ? "'\\n'" : "','"
    } else if (format == "tbl") {
      return "'|'"
    }
  }

  if (schema.objKey === null)
    return []
  let buf = []
  let v = f.arg[1].op
  let { mappedFile, size, format } = file.val

  let colName = schema.objKey
  let type = schema.objValue
  let prefix = pretty(f)
  let used = usedCols[prefix] && usedCols[prefix][colName]

  c.comment(buf)(`reading column ${colName}`)

  let name = [mappedFile, quoteVar(v), colName].join("_")
  let start = name + "_start"
  let end = name + "_end"

  let delim = getDelim(format, first)

  if (used) {
    if (typing.isInteger(type)) {
      scanInteger(buf, mappedFile, cursor, size, delim, name, type)
    } else if (type.typeSym === typeSyms.f32 || type.typeSym === typeSyms.f64) {
      scanDecimal(buf, mappedFile, cursor, size, delim, name, type)
    } else if (type.typeSym == typeSyms.date) {
      scanDate(buf, mappedFile, cursor, size, delim, name)
    } else if (type.typeSym == typeSyms.char) {
      scanChar(buf, mappedFile, cursor, size, delim, name)
    } else {
      scanString(buf, mappedFile, cursor, size, delim, start, end)
    }
  } else if (type.typeSym == typeSyms.date) {
    c.stmt(buf)(c.assign(cursor, c.binary(cursor, "11", "+")))
  } else {
    scanColumn(buf, mappedFile, cursor, size, delim)
  }

  // consume the newline character for tbl
  if (first && format == "tbl") c.stmt(buf)(c.inc(cursor))

  return [...emitRowScanning(f, file, cursor, schema.objParent, usedCols, false), ...buf]
}

let getCSVLoopTxt = (f, file, loadInput, usedCols) => () => {
  let v = f.arg[1].op
  let { mappedFile, size, format } = file.val

  let initCursor = []

  let info = [`// generator: ${v} <- ${pretty(f.arg[0])}`]

  v = quoteVar(v)

  let cursor = symbol.getSymbol("i")
  c.declareSize(initCursor)(cursor, "0")

  // for csv files, skip the schema line
  if (format == "csv") {
    c.while(initCursor)(
      c.and(
        c.lt(cursor, size),
        c.ne(`${mappedFile}[${cursor}]`, "'\\n'")
      ),
      buf1 => c.stmt(buf1)(c.inc(cursor))
    )
    c.stmt(initCursor)(c.inc(cursor))
  }

  let loopHeader = []
  // c.stmt(loopHeader)(c.assign(quoteVar(v), "-1"))
  loopHeader.push(`for (size_t ${v} = 0; ${cursor} < ${size}; ${v}++) {`)
  // c.stmt(loopHeader)(c.inc(quoteVar(v)))

  let boundsChecking = [`if (${cursor} >= ${size}) break;`]

  let schema = f.schema.type
  let rowScanning = emitRowScanning(f, file, cursor, schema, usedCols)

  return {
    info, data: loadInput, initCursor, loopHeader, boundsChecking, rowScanning
  }
}

let csv = {
  emitLoadCSV,
  getCSVLoopTxt
}

module.exports = {
  csv
}
