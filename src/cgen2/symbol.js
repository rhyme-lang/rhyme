// Fresh C identifiers. Copied from cgen/symbol.js so that cgen2 stays
// self-contained -- see cutils.js for the rest of what was brought over.
//
// reset() matters here beyond starting a fresh program: index.js re-emits the
// body when a tmp turns out not to be able to stay native, and without a reset
// every retry would keep allocating new numbers.

let map = {}

let symbol = {}

symbol.reset = () => {
  map = {}
}

symbol.getSymbol = (prefix) => {
  map[prefix] ??= 0
  let name = prefix + map[prefix]
  map[prefix] += 1
  return name
}

module.exports = {
  symbol
}
