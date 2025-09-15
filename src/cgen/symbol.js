let map

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
