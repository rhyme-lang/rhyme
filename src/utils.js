exports.quoteVar = s => s.replaceAll("*", "x") // dollar, percent, ...

// exports.quoteVar = s => "KEY" + s.replaceAll("*", "_star_") // dollar, percent, ...

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
