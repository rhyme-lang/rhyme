exports.quoteVar = s => "KEY" + s.replaceAll("*", "_star_") // dollar, percent, ...
// string literal or iterator variable?
exports.isVar = s => s.startsWith("*") // || s.startsWith("$") || s.startsWith("%")

exports.debug = false // TODO: proper flags
exports.trace = false // TODO: proper flags

exports.print = (...args) => {
    if (this.debug) console.log(...args)
}

exports.inspect = (...args) => {
    if (this.debug) console.dir(...args)
}

exports.error = (...args) => {
    console.error(...args)
}

exports.warn = (...args) => {
    console.warn(...args)
}
