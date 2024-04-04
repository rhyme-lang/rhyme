/*
 * Implementations of "Advent of Code" challenges
 *
 * Problem statements: https://adventofcode.com
 *
 * Solutions are inspired by existing solutions in:
 * - JQ: https://github.com/odnoletkov/advent-of-code-jq
 * - SQL: https://github.com/MaterializeInc/advent-of-code-2023
 * - Scala: https://scalacenter.github.io/scala-advent-of-code
 *
 */

const { api, pipe } = require('../src/rhyme')
const { rh } = require('../src/parser')

let udf_stdlib = {
  split: d => s => s.split(d),
  toNum: x => (n => Number.isNaN(n) ? undefined : n)(Number(x)),
  isGreaterThan: (x,y) => x > y,
  isGreaterOrEqual: (x,y) => x >= y,
  isLessThan: (x,y) => x < y,
  isLessOrEqual: (x,y) => x <= y,
  isEqual: (x,y) => x === y,
  notEqual: (x,y) => x !== y,
  exp: n => x => n ** x,
  sqrt: n => Math.sqrt(n),
  floor: x => Math.floor(x),
  ceil: x => Math.ceil(x),
  int2Char: x => String.fromCharCode(x),
  matchAll: (regex, flags) => x => [...x.matchAll(new RegExp(regex, flags))],
  logicalAnd: (x,y) => x && y,
  range: (start, stop, step) =>
      Array.from({ length: (stop - start + step - 1) / step }, (_, i) => start + (i * step)),
  slice: start => x => x.slice(start),
}


// 2023

test("day1-part1", () => {
  let input = `1abc2
pqr3stu8vwx
a1b2c3d4e5f
treb7uchet`
  let udf = udf_stdlib

  let digits  = rh`.input | udf.split "\\n" | .*line | udf.split "" | .*char | udf.toNum `
  let numbers = rh`first(${digits}) * 10 + last(${digits})`
  let query   = rh`${numbers} | group *line | sum .*`

  let func = api.compile(query)
  let res = func({input, udf})
  expect(res).toBe(142)
})

test("day1-part2", () => {
  let input = `two1nine
eightwothree
abcone2threexyz
xtwone3four
4nineeightseven2
zoneight234
7pqrstsixteen`

  let letters = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
  let digitregex = new RegExp(`[0-9]|${letters.join("|")}`, "g")

  // utilities to match digits and numbers
  let udf = {
    match: x => x.match(digitregex),
    toNumW: x => udf.toNum(x) ?? letters.indexOf(x) + 1,
    ...udf_stdlib
  }

  let digits  = rh`.input | udf.split "\\n" | .*line | udf.match | .*match | udf.toNumW`
  let numbers = rh`first(${digits}) * 10 + last(${digits})`
  let query   = rh`${numbers} | group *line | sum .*`

  let func = api.compile(query)
  let res = func({input, udf})
  expect(res).toBe(281)
})


test("day2-part1", () => {
  // used udfs to simulate behaviors of select, all, scan in jq
  let input = `Game 1: 3 blue, 4 red; 1 red, 2 green, 6 blue; 2 green
Game 2: 1 blue, 2 green; 3 green, 4 blue, 1 red; 1 green, 1 blue
Game 3: 8 green, 6 blue, 20 red; 5 blue, 4 red, 13 green; 5 green, 1 red
Game 4: 1 green, 3 red, 6 blue; 3 green, 6 red; 3 green, 15 blue, 14 red
Game 5: 6 red, 1 blue, 3 green; 2 blue, 1 red, 2 green`

  let bag = {
    red: 12,
    green: 13,
    blue: 14
  }

  let udf = udf_stdlib

  let line = rh`.input | udf.split "\\n" | .*line
                       | udf.split ":"`

  let game = rh`${line}.0 | udf.split " " | udf.toNum .1`

  let cube = rh`${line}.1 | udf.split ";" | .*hand
                          | udf.split "," | .*group
                          | udf.split " "`

  let num   = rh`${cube}.1 | udf.toNum`
  let color = rh`${cube}.2`

  let isPossible = rh`udf.isLessOrEqual ${num} bag.${color}` // TODO: x <= y syntax

  let lineRes = rh`min(${isPossible} | udf.toNum) * ${game}` // using "min" to express "forall"

  let query = rh`${lineRes} | group *line | sum .*`

  let func = api.compile(query)
  let res = func({input, udf, bag})
  expect(res).toBe(8)
})

test("day2-part2", () => {
  let input = `Game 1: 3 blue, 4 red; 1 red, 2 green, 6 blue; 2 green
Game 2: 1 blue, 2 green; 3 green, 4 blue, 1 red; 1 green, 1 blue
Game 3: 8 green, 6 blue, 20 red; 5 blue, 4 red, 13 green; 5 green, 1 red
Game 4: 1 green, 3 red, 6 blue; 3 green, 6 red; 3 green, 15 blue, 14 red
Game 5: 6 red, 1 blue, 3 green; 2 blue, 1 red, 2 green`

  let udf = udf_stdlib

  let line = rh`.input | udf.split "\\n" | .*line
                       | udf.split ":"`

  let cube = rh`${line}.1 | udf.split ";" | .*hand
                          | udf.split "," | .*group
                          | udf.split " "`

  let num   = rh`${cube}.1 | udf.toNum`
  let color = rh`${cube}.2`

  let lineRes = rh`max ${num} | group ${color} | .red * .green * .blue`

  let query = rh`${lineRes} | group *line | sum .*`

  let func = api.compile(query)
  let res = func({input, udf})
  expect(res).toBe(2286)
})

test("day3-part1", () => {
// Compute the sum of all part numbers: the number that are adjacent, even diagonally, to a symbol (*, #, +, $, .etc)
let input =
`467..114..
...*......
..35..633.
......#...
617*......
.....+.58.
..592.....
......755.
...$.*....
.664.598..`

// utilities to split input, match digit and get the coordinate of adjacent symbols

let udf = {
  splitN: x => x.split("\n"),
  splitB: x => x.split(""),
  match: x => [...x.matchAll(/\d+/g)],
  // Get the coordinate of adjacent symbols
  getAdj: point => {
    let i = +point[0]
    let j = +point[1]
    return [[i-1, j-1], [i-1, j], [i-1, j+1], [i, j-1], [i, j+1], [i+1, j-1], [i+1, j], [i+1, j+1]]
  },
  // Get the corrdinates of the current match, i.e. [[row, match.start], ..., [row, match.end]]
  getCords: row => match => Array.from({length: match[0].length}, (_, i) => [+row, i + match.index]),
  // !!! Temporary hack for optional chaining, should change this afterwards
  optionalChaining: o => k => o?.[k],
  // Check if the current character is a symbol
  isSym: c => c != null && c !== '.' && Number.isNaN(+c),
  toNum: x => {
    let n = Number(x)
    if (Number.isNaN(n))
      return undefined
    else
      return n
  }
}
let root = {xxpath:"raw", xxparam: "inp"} // XXX

// Temporay matrix of characters, joined in later queries.
let matrix = pipe(root).get("input").map("udf.splitN").get("*i").map("udf.splitB").get("*j").group("*j").group("*i")

let matches = pipe(root).get("input").map("udf.splitN").get("*row").map("udf.match").get("*match")

// coordinates is element of: *row => match => [[*row, match.start], ..., [*row, match.end]].flatMap(getAdj)
let coordinates = pipe(api.apply(api.apply("udf.getCords", "*row"), matches)).get("*coord").map("udf.getAdj").get("*adj")

let numbers = pipe(api.apply("udf.toNum", matches))

// isPart indicate whether the number is a part number, i.e., adjacent to a symbol
// isPart: coordinates => coordinates.Some(coord => isSym(matrix[coord[0]]?.[coord[1]]))
// Some of the generated coordinates maybe invalid, e.g. [-1, -1], need hack for optional chaining ?.
// !!! api.max is a temporary hack for logic or, should change this after add all, some operator to rhyme
let isPart = pipe(api.apply(api.apply("udf.optionalChaining", matrix.get(coordinates.get("0"))), coordinates.get("1"))).map("udf.isSym").max()

// !!! api.times is a temporary hack for filtering,should change this after add filtering
let partNum = pipe(api.times(numbers, isPart))

// NOTE: change to group("*match").group("*row").get("*row").get("*match") will result in repeated generators because of coarse-grained dependencies
let query = partNum.group("*match").group("*row").get("*0").get("*1").sum()
let func = api.compile(query)
let res = func({input, udf})
expect(res).toBe(4361)
})

test("day3-part2", () => {
  // Compute the sum of all part numbers: the number that are adjacent, even diagonally, to a symbol (*, #, +, $, .etc)
  let input = `467..114..
...*......
..35..633.
......#...
617*......
.....+.58.
..592.....
......755.
...$.*....
.664.598..`

  let udf = {
    // check whether a symbol and a match is adjacent
    isAdj: (i, j, line, match) => i >= +line - 1 && i <= +line + 1 && j >= match.index - 1 && j <= match.index + match[0].length,
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency
    ...udf_stdlib
  }

  // filter x by the value of p
  // XXX: need a fresh generator for different filters, otherwise the generated code will be incorrect
  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let syms = rh`.input | udf.split "\\n" | .*i | udf.split "" | .*j`
  // 42 is *
  let isStar = rh`udf.isEqual ${syms} (udf.int2Char 42)`
  let matches = rh`.input | udf.split "\\n" | .*line | udf.matchAll "\\\\d+" "g" | .*match`
  // Check whether a symbolc at (i, j) is adjacent to a match
  let isAdj = rh`udf.isAdj *i *j *line ${matches}`
  // The array of adjacent part numbers for each * symbol, ungrouped
  let partNumsPerGear_ungrouped = [rh`${matches} | udf.toNum | ${filterBy("*f0", isAdj)} | ${filterBy("*f1", isStar)}`]
  // The array of adjacent part numbers for each * symbol, grouped by each symbol (gear)
  let partNumsPerGear = rh`${partNumsPerGear_ungrouped} | group *j | group *i | .*0 | .*1`
  // We only aggregate over the gears that are adjacent to exactly two part numbers
  let query = rh`${partNumsPerGear} | ${filterBy("*f2", rh`udf.isEqual ${partNumsPerGear}.length 2`)} | .0 * .1 | sum`
  let func = api.compile(query)
  let res = func({input, udf})

  expect(res).toBe(467835)
})

test("day4-part1", () => {
  let input = `Card 1: 41 48 83 86 17 | 83 86  6 31 17  9 48 53
Card 2: 13 32 20 16 61 | 61 30 68 82 17 32 24 19
Card 3:  1 21 53 59 44 | 69 82 63 72 16 21 14  1
Card 4: 41 92 73 84 69 | 59 84 76 51 58  5 54 83
Card 5: 87 83 26 28 32 | 88 30 70 12 93 22 82 36
Card 6: 31 18 13 56 72 | 74 77 10 23 35 67 36 11`

  let udf = {
    getNums: s => s.match(/(\d+)/g),
    ...udf_stdlib
  }

  let line = rh`.input | udf.split "\\n" | .*line
                       | udf.split ":" | .1
                       | udf.split "|"`

  let winNumber = rh`${line}.0 | udf.getNums | .*winNum`
  let numberYouHave = rh`${line}.1 | udf.getNums | .*numYouHave`

  let number = rh`${api.array(winNumber, numberYouHave)} | .*num`

  // "count number | group number" groups the count of each number by number
  // which gives us the frequencies of numbers in an object

  // We then to look for numbers with frequency = 2
  // with the underlying assumption that
  // each winning number and each number you have is unique
  let matchCount = rh`count ${number} | group ${number}
                                      | udf.isEqual .*freq 2
                                      | sum`

  let lineRes = rh`${matchCount} - 1 | udf.exp 2 | udf.floor`

  let query = rh`${lineRes} | group *line | sum .*`

  // let query = {"*line": lineRes}

  let func = api.compile(query)
  // console.log(func.explain2.pseudo)
  // console.log(func.explain2.code)
  let res = func({input, udf})
  expect(res).toBe(13)
})

test("day4-part2", () => {
  let input = `Card 1: 41 48 83 86 17 | 83 86  6 31 17  9 48 53
Card 2: 13 32 20 16 61 | 61 30 68 82 17 32 24 19
Card 3:  1 21 53 59 44 | 69 82 63 72 16 21 14  1
Card 4: 41 92 73 84 69 | 59 84 76 51 58  5 54 83
Card 5: 87 83 26 28 32 | 88 30 70 12 93 22 82 36
Card 6: 31 18 13 56 72 | 74 77 10 23 35 67 36 11`

  let udf = {
    andThen: (a,b) => b, // just to add a as dependency
    // Currently using incCard to update the count for each card
    incCard: (cards, n) => cards.count += n,
    ...udf_stdlib
  }

  let line = rh`.input | udf.split "\\n" | .*line
                       | udf.split ":"`

  let id = rh`${line}.0 | udf.matchAll "\\\\d+" "g" | .0 | udf.toNum`

  let numbers = rh`${line}.1 | udf.split "|"`

  let winNumber = rh`${numbers}.0 | udf.matchAll "\\\\d+" "g" | .*winNum | udf.toNum`
  let numberYouHave = rh`${numbers}.1 | udf.matchAll "\\\\d+" "g" | .*numYouHave | udf.toNum`

  let number = rh`${api.array(winNumber, numberYouHave)} | .*num`

  // "count number | group number" groups the count of each number by number
  // which gives us the frequencies of numbers in an object

  // We then to look for numbers with frequency = 2
  // with the underlying assumption that
  // each winning number and each number you have is unique

  let matchCount = rh`count ${number} | group ${number}
                                      | udf.isEqual .*freq 2
                                      | sum`

  let lineRes = {
    "id": id,
    "match": matchCount,
    "count": 1
  }

  let matchCountObj = rh`${lineRes} | group ${id}`

  // For each line i in the matchCountObject, it will look through the matchCountObject
  // to find every other line j that satisfies j.id > i.id and j.id <= i.id + i.match.
  // For each of these lines, it will increament j.count by i.count
  // udf.andThen here use the first argument as a side effect so that the final result will contain only the count

  let query = rh`${matchCountObj} | .*lineRes
                                  | udf.andThen (udf.incCard ${matchCountObj}.(${matchCountObj}.*j.id) ((udf.logicalAnd (udf.isGreaterThan ${matchCountObj}.*j.id .id) (udf.isLessOrEqual ${matchCountObj}.*j.id (.id + .match))) * .count)) .count
                                  | last | group *lineRes
                                  | sum .*`

  let func = api.compile(query)
  let res = func.c1({input, udf})
  expect(res).toBe(30)
})

test("day5-part1", () => {
  let input = `seeds: 79 14 55 13

seed-to-soil map:
50 98 2
52 50 48

soil-to-fertilizer map:
0 15 37
37 52 2
39 0 15

fertilizer-to-water map:
49 53 8
0 11 42
42 0 7
57 7 4

water-to-light map:
88 18 7
18 25 70

light-to-temperature map:
45 77 23
81 45 19
68 64 13

temperature-to-humidity map:
0 69 1
1 0 69

humidity-to-location map:
60 56 37
56 93 4`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency
    orElse: (a,b) => a ?? b,
    inRange: (x, start, len) => x >= start && x < start + len,
    ...udf_stdlib
  }

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let chunks = rh`.input | udf.split "\\n\\n"`

  let seeds = rh`${chunks}.0 | udf.split ":" | .1 | udf.matchAll "\\\\d+" "g" | .*seed | udf.toNum | group *seed`

  let ranges = [rh`${chunks} | udf.slice 1 | .*map | udf.split "\\n" | udf.slice 1 | .*range | udf.matchAll "\\\\d+" "g" | .*t0 | udf.toNum`]

  let maps = rh`${ranges} | group *range | group *map`

  // perform a range lookup in maps[id] on srcs
  let lookup = (id, srcs) => {
    let srcGen = `*src${id}`
    let rangeGen = `*range${id}`
    let src = rh`${srcs} | .${srcGen}`
    let range = rh`${maps} | .${id} | .${rangeGen}`
    // TODO: use this inRange is much more slower than a custom udf inRange,
    //       after initial profiling, most of the time seem to be spent on ir.createIR
    //       investigate this later!
    // GUESS: code duplication due to multiple uses of src and range (udf will be cse'd)
    //let inRange = rh`udf.logicalAnd (udf.isGreaterOrEqual ${src} ${range}.1) (udf.isLessThan ${src} (${range}.1 + ${range}.2))`
    let inRange = rh`udf.inRange ${src} ${range}.1 ${range}.2`
    // If src is not in any of the ranges, we map it to itself,
    let dests = rh`udf.orElse (${range}.0 + ${src} - ${range}.1 | ${filterBy(`*f${id}`, inRange)} | first) ${src} | group ${srcGen}`
    return dests
  }

  // use meta programming to do 7 chained lookups
  let locations = Array.from(Array(7).keys()).reduce(
    (acc, id) => lookup(id, acc),
    seeds,
  )

  let query = rh`${locations} | .*final | min`

  let func = api.compileFastPathOnly(query) // FIXME: can't run with ref semantics yet. No cse -> code blowup!
  let res = func.c1({input, udf})

  expect(res).toBe(35)
})

test("day6-part1", () => {
  let input = `Time:      7  15   30
Distance:  9  40  200`

  let udf = {
    isInteger: (n) => Number.isInteger(n),
    ...udf_stdlib
  }

  let line = rh`.input | udf.split "\\n"`

  let time = rh`${line}.0 | udf.matchAll "\\\\d+" "g" | .*pair | udf.toNum`
  let dist = rh`${line}.1 | udf.matchAll "\\\\d+" "g" | .*pair | udf.toNum`

  let disc = rh`udf.sqrt (${time} * ${time} - 4 * ${dist})`

  let root1 = rh`${time} / 2 - ${disc} / 2`
  let root2 = rh`${time} / 2 + ${disc} / 2`

  let root1Int = rh`(udf.ceil ${root1}) + (udf.isInteger ${root1})`
  let root2Int = rh`(udf.floor ${root2}) - (udf.isInteger ${root2})`

  let query = rh`${root2Int} - ${root1Int} + 1 | group *pair | product .*`

  let func = api.compile(query)
  let res = func({input, udf})
  expect(res).toBe(288)
})

test("day6-part2", () => {
  let input = `Time:      7  15   30
Distance:  9  40  200`

  let udf = {
    isInteger: (n) => Number.isInteger(n),
    ...udf_stdlib
  }

  let line = rh`.input | udf.split "\\n"`

  let time = rh`${line}.0 | udf.matchAll "\\\\d+" "g" | .*pair
                          | sum | udf.toNum`
  let dist = rh`${line}.1 | udf.matchAll "\\\\d+" "g" | .*pair
                          | sum | udf.toNum`

  let disc = rh`udf.sqrt (${time} * ${time} - 4 * ${dist})`

  let root1 = rh`${time} / 2 - ${disc} / 2`
  let root2 = rh`${time} / 2 + ${disc} / 2`

  let root1Int = rh`(udf.ceil ${root1}) + (udf.isInteger ${root1})`
  let root2Int = rh`(udf.floor ${root2}) - (udf.isInteger ${root2})`

  let query = rh`${root2Int} - ${root1Int} + 1`

  let func = api.compile(query)
  let res = func({input, udf})
  expect(res).toBe(71503)
})

test("day8-part1", () => {
  let input = `LLR

AAA = (BBB, BBB)
BBB = (AAA, ZZZ)
ZZZ = (ZZZ, ZZZ)`

  let udf = {
    ...udf_stdlib
  }

  let chunks = rh`.input | udf.split "\\n\\n"`
  let lines = rh`${chunks}.1 | udf.split "\\n"`

  // decode instructions
  let instructions = rh`${chunks}.0 | udf.split ""`
  let instrStep = i => rh`${instructions}.(${i} % (count ${instructions}.*I))`

  // decode rules
  let ruleParts = rh`${lines} | .*line | udf.matchAll "[A-Z]{3}" "g"`
  let ruleBody = {
    L: rh`${ruleParts}.1.0`,
    R: rh`${ruleParts}.2.0`
  }
  let rules = rh`${ruleBody} | group ${ruleParts}.0.0`

  // main query
  let query = {
    state: rh`.state | ${rules}.(.state).(${instrStep} .steps)`,
    steps: rh`state.steps + 1`
  }

  let func = api.compile(query)

  // initial state and driver loop
  let state = {
    state: "AAA",
    steps: 0
  }
  while (state.state != "ZZZ") {
    state = func({input, udf, state})
  }
  expect(state.steps).toBe(6)

  // NOTE: each iteration of the loop re-parses the
  // entire input. We could eliminate this redundant
  // computation by pre-computing 'rules' and
  // 'instructions' before the loop.
  //
  // This would match the emerging pattern of having
  // separate 'init' and 'step' queries for recursive
  // recursive computations.
})

test("day10-part1", () => {
  let input = `7-F7-
.FJ|7
SJLL7
|F--J
LJ.LJ`

  // Each array element [x, y] represents the offset
  // on each dimension from the current position
  let connected = {
    "|": [[-1, 0], [1, 0]],
    "-": [[0, -1], [0, 1]],
    "L": [[-1, 0], [0, 1]],
    "J": [[-1, 0], [0, -1]],
    "7": [[1, 0], [0, -1]],
    "F": [[1, 0], [0, 1]],
    ".": []
  }

  let udf = {
    connected,
    getAdj: point => {
      let i = +point[0]
      let j = +point[1]
      return [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]
    },
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency
    toCoord: (i, j) => [i, j],
    ...udf_stdlib
  }
  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let lines = rh`.input | udf.split "\\n" | .*line
                        | udf.split ""`
  
  let grid = api.array(lines)

  // Use filter to find the start position
  let isStart = rh`udf.isEqual ${grid}.*i.*j "S"`
  let startPos = rh`udf.toCoord (udf.toNum *i) (udf.toNum *j) | ${filterBy("*f1", isStart)} | last`

  // Get all the adjacent cells of the start cell. Filter the neighbors by whether they
  // are connected with the start cell. i.e. coordinate of one of the connected cell
  // is identical to the start cell
  let isConnected = rh`${startPos} | udf.getAdj
                                   | udf.toCoord (connected.(${grid}.(.*adj.0).(.*adj.1)).*neighbor.0 + .*adj.0) (connected.(${grid}.(.*adj.0).(.*adj.1)).*neighbor.1 + .*adj.1)
                                   | udf.isEqual (udf.isEqual .0 ${startPos}.0) + (udf.isEqual .1 ${startPos}.1) 2`
  let startCell = rh`${startPos} | udf.getAdj | .*adj | ${filterBy("*f2", isConnected)} | first`

  // In the initial state, "curr" is actually the cell after we make the first move
  // The start cell becomes the first "prev" value which is used to check for visited cells
  let initialState = {
    prev: startPos,
    curr: startCell,
    cell: rh`${grid}.(${startCell}.0).(${startCell}.1)`
  }

  let getInitialState = api.compile(initialState)

  let state = getInitialState({input, udf, connected})
  state.count = 1

  // Each query moves from the current cell
  // to the next cell which are the not visited connected cells

  // The query checks the connected cells of the current cell
  // and find the one not visited

  // It stops when the current cell becomes S
  let notVisited = rh`udf.toCoord (connected.(${grid}.(state.curr.0).(state.curr.1)).*adj.0 + state.curr.0) (connected.(${grid}.(state.curr.0).(state.curr.1)).*adj.1 + state.curr.1)
                      | udf.notEqual (udf.isEqual .0 state.prev.0) + (udf.isEqual .1 state.prev.1) 2`
  let curr = rh`udf.toCoord (connected.(${grid}.(state.curr.0).(state.curr.1)).*adj.0 + state.curr.0) (connected.(${grid}.(state.curr.0).(state.curr.1)).*adj.1 + state.curr.1)
                | ${filterBy("*f", notVisited)} | first`

  // Main query
  let query = {
    prev: rh`state.curr`,
    curr: curr,
    cell: rh`${grid}.(${curr}.0).(${curr}.1)`,
    count: rh`state.count + 1`
  }

  let func = api.compile(query)

  while (state.cell != "S") {
    state = func({input, udf, state, connected})
  }

  let res = state.count / 2
  expect(res).toBe(8)
})

// test("aoc-day14-part1", () => {
//   let input = `O....#....
// O.OO#....#
// .....##...
// OO.#O....O
// .O.....O#.
// O.#..O.#.#
// ..O..#O..O
// .......O..
// #....###..
// #OO..#....`

//   let udf = {
//     filter: c => c ? { [c]: true } : {},
//     andThen: (a,b) => b,
//     onRock: (o, k, n) => (dummy) => {
//       o[k] ??= 0
//       let res = n - o[k]
//       o[k] += 1
//       return res
//     },
//     onCube: (o, k, n) => (dummy) => {
//       o[k] = n
//       return 0
//     },
//     ...udf_stdlib
//   }

//   let lines = rh`.input | udf.split "\\n"`
//   let platform = rh`${lines} | .*line | udf.split "" | group *line`
//   let n = rh`${lines} | count .*line`
//   let whereCanIFall = rh`.whereCanIFall`

//   let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`
//   let isRock = rh`${platform} | .*row | udf.isEqual .*col "O"`
//   let isCube = rh`${platform} | .*row | udf.isEqual .*col "#"`
//   let isEmpty = rh`${platform} | .*row | udf.isEqual .*col "."`
//   let queryRock = rh`${platform} | .*row | .*col
//                              | ${filterBy("*fRock", isRock)}
//                              | udf.onRock ${whereCanIFall} (udf.toNum *col) (${n}) | sum
//                              | group *row`
//   let queryCube = rh`${platform} | .*row | .*col
//                              | ${filterBy("*fCube", isCube)}
//                              | udf.onCube ${whereCanIFall} (udf.toNum *col) ((udf.toNum *row) + 1) | sum
//                              | group *row`

//   let query = {
//     rock: queryRock,
//     cube: queryCube
//   }

//   let func = api.compile(query)
//   console.log(func.explain.code)
//   console.log(func.explain_opt.code)
//   let res = func({input, udf, whereCanIFall: {}})
//   console.log(res)
// })

test("aoc-day14-part1", () => {
  let input = `O....#....
O.OO#....#
.....##...
OO.#O....O
.O.....O#.
O.#..O.#.#
..O..#O..O
.......O..
#....###..
#OO..#....`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b,
    onRock: (old, cell) => cell == "O" ? old + 1 : 0,
    onCube: (row, cell) => cell == "#" ? row + 1 : 0,
    ident: x => x,
    ...udf_stdlib
  }

  let lines = rh`.input | udf.split "\\n"`
  let platform = rh`${lines} | .*line | udf.split "" | group *line`
  let n = rh`${lines} | count .*line`

  let whereCanIFall = rh`${platform} | .(state.row)
                                     | (udf.onRock state.whereCanIFall.(udf.ident *col) .*col) + (udf.onCube state.row .*col)`

  let state = {
    whereCanIFall: {},
    row: 0,
    n: Infinity
  }

  let query = {
    platform: platform,
    whereCanIFall: api.array(whereCanIFall),
    row: rh`state.row + 1`,
    n: n
  }

  let func = api.compile(query)
  console.log(func.explain.code)
  // while (state.row < state.n) {
    state = func({input, udf, state})
  // }
})

// 2022

test("day1-A", () => {
    let input = `1000
2000
3000

4000

5000
6000

7000
8000
9000

10000`
  // utilities to split input
  let udf = {
    splitNN: x => x.split("\n\n"),
    splitN: x => x.split("\n"),
    toNum: x => Number(x),
  }
  // standard api:
  let query = api.max(api.get({
    "*chunk": api.sum(api.apply("udf.toNum",
        api.get(api.apply("udf.splitN",
          api.get(api.apply("udf.splitNN",
            ".input"),
          "*chunk")),
        "*line")))
  },"*"))
  let func = api.compile(query)
  let res = func({input, udf})
  expect(res).toBe(24000)
})

test("day1-B", () => {
    let input = `1000
2000
3000

4000

5000
6000

7000
8000
9000

10000`
  // utilities to split input
  let udf = {
    splitNN: x => x.split("\n\n"),
    splitN: x => x.split("\n"),
    toNum: x => Number(x),
  }
  // potential textual syntax:
  // input | split "\n\n"  | get *chunk
  //       | split "\n"    | get *line  | toNum
  //       | sum | group *chunk | get * | max
  let query =
    pipe("input")
    .map("udf.splitNN").get("*chunk")
    .map("udf.splitN").get("*line")
    .map("udf.toNum")
    .sum()
    .group("*chunk").get("*")
    .max()
  let func = api.compile(query)
  let res = func({input, udf})
  expect(res).toBe(24000)
})

test("day1-C", () => {
    let input = `1000
2000
3000

4000

5000
6000

7000
8000
9000

10000`
  // utilities to split input
  let udf = {
    splitNN: x => x.split("\n\n"),
    splitN: x => x.split("\n"),
    toNum: x => Number(x),
  }
  // potential textual syntax:
  // input | split "\n\n"  | get *chunk
  //       | split "\n"    | get *line  | toNum
  //       | sum | group *chunk | get * | max
  let query = rh`.input | udf.splitNN | .*chunk
                        | udf.splitN  | .*line | udf.toNum
                        | sum | group *chunk | .* | max`
  let func = api.compile(query)
  let res = func({input, udf})
  expect(res).toBe(24000)
})