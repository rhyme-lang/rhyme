/*
 * Implementations of "Advent of Code" challenges 2023
 *
 * Problem statements: https://adventofcode.com
 *
 * Solutions are inspired by existing solutions in:
 * - JQ: https://github.com/odnoletkov/advent-of-code-jq
 * - SQL: https://github.com/MaterializeInc/advent-of-code-2023
 * - Scala: https://scalacenter.github.io/scala-advent-of-code
 *
 */

const { api, rh, pipe } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')

let udf_stdlib = {
  split: d => s => s.split(d),
  toNum: x => (n => Number.isNaN(n) ? undefined : n)(Number(x)),
  asString: x => String(x),
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
  abs: x=> Math.abs(x),
  modulo: (x,y) => x % y,
  int2Char: x => String.fromCharCode(x),
  matchAll: (regex, flags) => x => [...x.matchAll(new RegExp(regex, flags))],
  logicalAnd: (x,y) => x && y,
  logicalOr: (x,y) => x || y,
  range: (start, stop, step) =>
      Array.from({ length: (stop - start + step - 1) / step }, (_, i) => start + (i * step)),
  slice: start => x => x.slice(start),
  join: delim => array => array.join(delim),
  sort: cmpFn => array => array.sort(cmpFn),
  values: o => Object.values(o),
  ifThenElse: (predicate, thenBr, elseBr) => predicate ? thenBr : elseBr,
}

let udf_std_typ = typing.parseType`{
  split: (string) => (string) => [string],
  toNum: (any) => f64,
  isGreaterThan: (f64, f64) => boolean,
  isGreaterOrEqual: (f64, f64) => boolean,
  isLessThan: (f64, f64) => boolean,
  isLessOrEqual: (f64, f64) => boolean,
  isEqual: (any, any) => boolean,
  notEqual: (any, any) => boolean,
  exp: (f64) => (f64) => f64,
  sqrt: (f64) => f64,
  floor: (f64) => f64,
  ceil: (f64) => f64,
  abs: (f64) => f64,
  modulo: (f64) => f64,
  int2Char: (f64) => string,
  matchAll: (string, string) => (string) => [[string]],
  logicalAnd: (boolean, boolean) => boolean,
  logicalOr: (boolean, boolean) => boolean,
  range: (u32, u32, u32) => [u32]
}`;
// TODO: Add typing support for slice and later functions.

test("day1-part1", () => {
  let input = `1abc2
pqr3stu8vwx
a1b2c3d4e5f
treb7uchet`
  let udf = udf_stdlib

  let digits  = rh`.input | udf.split "\\n" | .*line | udf.split "" | .*char | udf.toNum `
  let numbers = rh`first(${digits}) * 10 + last(${digits})`
  let query   = rh`${numbers} | group *line | sum .*`

  let func = api.compile(query, typing.parseType`{input: string, udf: ${udf_std_typ}}`)
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

  let udf_typ = typing.parseType`${udf_std_typ} & {
    match: (string) => [string],
    toNumW: (string) => i16
  }`

  let digits  = rh`.input | udf.split "\\n" | .*line | udf.match | .*match | udf.toNumW`
  let numbers = rh`first(${digits}) * 10 + last(${digits})`
  let query   = rh`${numbers} | group *line | sum .*`

  let func = api.compile(query, typing.parseType`{input: string, udf: ${udf_typ}}`)
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

  let func = api.compile(query, typing.parseType`{input: string, udf: ${udf_std_typ}, bag: {red: i32, green: i32, blue: i32}}`)
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

  let func = api.compile(query, typing.parseType`{input: string, udf: ${udf_std_typ}}`)
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
let udf_typ = typing.parseType`${udf_std_typ} & {
  splitN: (string) => {*u32=A: string},
  splitB: (string) => {*u32=B: string},
  match: (string) => [{*u32=D: string}],
  getAdj: (f64) => [[f64]],
  getCords: (f64) => ({*D: string}) => [f64],
  optionalChaining: ({*B: string}) => (f64) => f64,
  isSym: (f64) => boolean
}`
let root = api.input()

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
let isPart = pipe(api.apply(api.apply("udf.optionalChaining", matrix.get(coordinates.get("0"))), coordinates.get("1"))).map("udf.isSym").map("udf.toNum").max()

// !!! api.times is a temporary hack for filtering,should change this after add filtering
let partNum = pipe(api.times(numbers, rh`${isPart} | udf.toNum`))

// NOTE: change to group("*match").group("*row").get("*row").get("*match") will result in repeated generators because of coarse-grained dependencies
let query = partNum.group("*match").group("*row").get("*0").get("*1").sum()
let func = api.compile(query, typing.parseType`{input: string, udf: ${udf_typ}}`)
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
  let udf_typ = typing.parseType`${udf_std_typ} & {
    isAdj: (i32, i32, line, match) => boolean,
    filter: (boolean) => {*string: true} | {},
    andThen: (any, any) => any
  }`

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
  let udf_typ = typing.parseType`${udf_std_typ} & {
    getNums: (string) => [string]
  }`

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
                                      | udf.toNum | sum`

  let lineRes = rh`${matchCount} - 1 | udf.exp 2 | udf.floor`

  let query = rh`${lineRes} | group *line | sum .*`

  // TODO: Loop consolidation - "udf.getNums" returns an array with same keys, so winNum is consolidated with numYouHave, but this is very bad.
  let func = api.compile(query) // , typing.parseType`{input: string, udf: ${udf_typ}}`
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
  let udf_typ = typing.parseType`${udf_std_typ} & {
    andThen: (any, f64) => f64,
    incCard: ({id: f64, match: f64, count: i32}, f64) => f64
  }`

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
                                      | udf.toNum
                                      | sum`

  let lineRes = {
    "id": id,
    "match": matchCount,
    "count": 1
  }

  let matchCountObj = rh`${lineRes} | last | group ${id}` // XXX the 'last' is neccessary (eager
                                                          // vs reluctant use of free variables)

  // For each line i in the matchCountObject, it will look through the matchCountObject
  // to find every other line j that satisfies j.id > i.id and j.id <= i.id + i.match.
  // For each of these lines, it will increament j.count by i.count
  // udf.andThen here use the first argument as a side effect so that the final result will contain only the count

  let query = rh`${matchCountObj} | .*lineRes
                                  | udf.andThen (udf.incCard ${matchCountObj}.(${matchCountObj}.*j.id) ((udf.toNum (udf.logicalAnd (udf.isGreaterThan ${matchCountObj}.*j.id .id) (udf.isLessOrEqual ${matchCountObj}.*j.id (.id + .match)))) * .count)) .count
                                  | last | group *lineRes
                                  | sum .*`

  // TODO: Figure out why adding typing is so slow.
  // TODO: Loop consolidation makes typing this fail.
  let func = api.compile(query) // , typing.parseType`{input: string, udf: ${udf_typ}}`)
  let res = func({input, udf})
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

test("day5-part2", () => {
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
    max: (a,b) => Math.max(a, b),
    min: (a,b) => Math.min(a,b),
    ...udf_stdlib
  }

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let chunks = rh`.input | udf.split "\\n\\n"`

  let seeds = rh`${chunks}.0 | udf.split ":" | .1 | udf.matchAll "\\\\d+" "g" | .*seed | udf.toNum`

  let isEven = rh`udf.isEqual 0 (udf.modulo *seed 2)`

  let isOdd = rh`udf.isEqual 1 (udf.modulo *seed 2)`

  let starts = [rh`${seeds} | ${filterBy("*ev", isEven)}`]
  let lengths = [rh`${seeds} | ${filterBy("*od", isOdd)}`]

  let sources = [{
    start: rh`${starts} | .*source | udf.toNum`,
    end: rh`(${starts} | .*source | udf.toNum) + (${lengths} | .*source | udf.toNum) - 1`,
  }]

  let ranges = rh`${chunks} | udf.slice 1 | .*map | udf.split "\\n" | udf.slice 1 | .*range | udf.matchAll "\\\\d+" "g"`

  let intervals = [{
    start: rh`${ranges} | .1 | udf.toNum`,
    end: rh`(${ranges} | .1 | udf.toNum) + (${ranges} | .2 | udf.toNum) - 1`,
    diff: rh`(${ranges} | .0 | udf.toNum) - (${ranges} | .1 | udf.toNum)`
  }]

  let query = {
    sources: sources,
    maps: rh`${intervals} | group *map`
  }

  let f0 = api.compileNew(query)

  // XXX: c1_opt (new codegen) and c2 (semantic) are correct, c1 (old codegen) behaves differently
  let result = f0({input, udf})

  let source = rh`.src | .*s`
  let map = rh`.map`
  let isUnder = rh`udf.isLessThan ${source}.start ${map}.start`
  let isIn = rh`udf.isLessOrEqual (udf.max ${source}.start ${map}.start) (udf.min ${source}.end ${map}.end)`
  let isAbove = rh`udf.isGreaterThan ${source}.end ${map}.end`

  let underRange_ = {
    start: rh`${source}.start`,
    end: rh`udf.min (${map}.start - 1) ${source}.end`
  }

  let underRange = rh`${underRange_} | ${filterBy("*un", isUnder)}`

  let inRange_ = {
    start: rh`${map}.diff + (udf.max ${source}.start ${map}.start)`,
    end: rh`${map}.diff + (udf.min ${source}.end ${map}.end)`
  }

  let inRange = rh`${inRange_} | ${filterBy("*in", isIn)}`

  let aboveRange_ = {
    start: rh`udf.max ${source}.start (${map}.end + 1)`,
    end: rh`${source}.end`
  }

  let aboveRange = rh`${aboveRange_} | ${filterBy("*ab", isAbove)}`

  let oldRanges = [underRange, aboveRange]

  query = {
    remaining:oldRanges,
    new:[inRange]
  }

  let f1 = api.compile(query)

  let src = result.sources
  for (let m in result.maps) {
    let overlaps = []
    for (let map of result.maps[m]) {
      let res = f1({src, map, udf})
      src = res.remaining
      overlaps = overlaps.concat(res.new)
    }
    src = src.concat(overlaps)
  }

  query = rh`.src | .*src | .start | min`

  let f2 = api.compile(query)

  let min = f2({src})

  expect(min).toBe(46)
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

test("day7-part1", () => {
  let input = `32T3K 765
T55J5 684
KK677 28
KTJJT 220
QQQJA 483`

let ranks = {2:"a", 3:"b", 4:"c", 5:"d", 6:"e", 7:"f", 8:"g", 9:"h", T:"i", J:"j", Q:"k", K:"l", A:"m"}

let udf = {
    cmpFreq: (a, b) => b - a,
    cmpCard: (a, b) => {
      if (a.freq == b.freq) return a.card.localeCompare(b.card)
      else return a.freq.localeCompare(b.freq)
    },
    getRank: x => ranks[x],
    ...udf_stdlib
  }

  let line = rh`.input | udf.split "\\n" | .*line | udf.split " "`

  let card = rh`${line}.0 | udf.split "" | .*card`
  let cardscore = [rh`${card} | udf.getRank`]
  let freq_ = rh`count ${card} | group ${card}`
  let freq = rh`${freq_} | udf.values | udf.sort udf.cmpFreq | udf.join ""`
  let bid = rh`${line}.1 | udf.toNum`

  let stats = {card: rh`${cardscore} | udf.join ""`, freq, bid}

  let sortedCards = rh`${stats} | group *line | udf.values | udf.sort udf.cmpCard | .*sc`
  let query = rh`((udf.toNum *sc) + 1) * ${sortedCards}.bid | sum`

  let func = api.compile(query)
  let res = func({input, udf})
  expect(res).toBe(6440)
})

test("day7-part2", () => {
  let input = `32T3K 765
T55J5 684
KK677 28
KTJJT 220
QQQJA 483`

let ranks = {J:"a", 2:"b", 3:"c", 4:"d", 5:"e", 6:"f", 7:"g", 8:"h", 9:"i", T:"j", Q:"k", K:"l", A:"m"}

  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency,
    cmpFreq: (a, b) => a - b,
    cmpCard: (a, b) => {
      if (a.score == b.score) return a.card.localeCompare(b.card)
      else return b.score - a.score
    },
    getRank: x => ranks[x],
    ...udf_stdlib
  }

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let line = rh`.input | udf.split "\\n" | .*line | udf.split " "`

  let card = rh`${line}.0 | udf.split "" | .*card`
  let cardscore = [rh`${card} | udf.getRank`]
  let freq_ = rh`${card} | ${filterBy(`*f0`, rh`udf.notEqual ${card} "J"`)} | count | group ${card}`
  let jcount = rh`${card} | ${filterBy(`*f1`, rh`udf.isEqual ${card} "J"`)} | count`
  let freq = rh`${freq_} | udf.values | udf.sort udf.cmpFreq`
  let score = rh`(${freq} | udf.join "" | udf.toNum) + ${jcount}`
  let bid = rh`${line}.1 | udf.toNum`

  let stats = {card: rh`${cardscore} | udf.join ""`, score, bid}

  let sortedCards = rh`${stats} | group *line | udf.values | udf.sort udf.cmpCard | .*sc`
  let query = rh`((udf.toNum *sc) + 1) * ${sortedCards}.bid | sum`

  let func = api.compile(query)
  let res = func({input, udf})
  expect(res).toBe(5905)
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

test("day9-part1", () => {
  let input = `0 3 6 9 12 15
1 3 6 10 15 21
10 13 16 21 30 45`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency,
    ...udf_stdlib
  }

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let num = rh`.input | udf.split "\\n" | .*line | udf.split " " | .*num | udf.toNum`
  let q0 = {
    data:rh`${[num]} | group *line | udf.values`,
    sum:0
  }

  let f0 = api.compile(q0)
  let state = f0({input, udf})

  let data = rh`.state | .data`
  let line = rh`${data} | .*line`
  let val = rh`${line} | .*val`
  let firsts = [rh`${val} | ${filterBy(`*f0`, rh`udf.isLessThan *val (${line}.length - 1)`)}`]
  let seconds = [rh`${val} | ${filterBy(`*f1`, rh`udf.isGreaterThan *val 0 `)}`]
  let first = rh`${firsts} | .*bind`
  let second = rh`${seconds} | .*bind`
  let diff_ = rh`${second} - ${first}`
  let stat = {
    diff:[diff_],
    notallzero:rh`udf.notEqual ((udf.notEqual ${diff_} 0) | sum) 0`,
    last: rh`${val} | last`
  }
  // XXX FIXME: what we want is a nested aggregation, For example, a sum over last.
  // use andThen works in ref semantic but does not work in codegen as the initialization
  // for the inner aggregation is still only executed once (it is not put inside the loop for the outer aggregation).
  // So we have to first group the inner aggregation (last), then re-iterate over the grouped result
  // to do the outer one (sum).
  // Could we optimize this?
  let stats = rh`${stat} | group *line`

  let diff = rh`${stats} | .*s | .diff`
  let notallzero = rh`${stats} | .*s | .notallzero`
  let last = rh`${stats} | .*s | .last`

  let newdata = [rh`${diff} | ${filterBy(`*f2`, notallzero)}`]

  let q1 = {
    data:newdata,
    sum:rh`.state.sum + (sum ${last})`
  }
  let f1 = api.compile(q1)
  while (state.data.length) {
    state = f1({state, udf})
  }
  expect(state.sum).toBe(114)
})

test("day9-part2", () => {
  let input = `0 3 6 9 12 15
1 3 6 10 15 21
10 13 16 21 30 45`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency,
    ...udf_stdlib
  }

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let num = rh`.input | udf.split "\\n" | .*line | udf.split " " | .*num | udf.toNum`
  let q0 = {
    data:rh`${[num]} | group *line | udf.values`,
    sign:rh`1 | group *line | udf.values`,
    sum:0
  }

  let f0 = api.compile(q0)
  let state = f0({input, udf})

  let data = rh`.state | .data`
  let line = rh`${data} | .*line`
  let val = rh`${line} | .*val`
  let sign = rh`.state.sign | .*line`
  let firsts = [rh`${val} | ${filterBy(`*f0`, rh`udf.isLessThan *val (${line}.length - 1)`)}`]
  let seconds = [rh`${val} | ${filterBy(`*f1`, rh`udf.isGreaterThan *val 0 `)}`]
  let first = rh`${firsts} | .*bind`
  let second = rh`${seconds} | .*bind`
  let diff_ = rh`${second} - ${first}`
  let stat = {
    diff:[diff_],
    notallzero:rh`udf.notEqual ((udf.notEqual ${diff_} 0) | sum) 0`,
    head: rh`(${val} | first) * ${sign}`,
    newsign: rh`0 - ${sign}`
  }
  let stats = rh`${stat} | group *line`

  let diff = rh`${stats} | .*s | .diff`
  let notallzero = rh`${stats} | .*s | .notallzero`
  let head = rh`${stats} | .*s | .head`
  let newsign_ = rh`${stats} | .*s | .newsign`

  let newdata = [rh`${diff} | ${filterBy(`*f2`, notallzero)}`]
  let newsign = [rh`${newsign_} | ${filterBy(`*f2`, notallzero)}`]

  let q1 = {
    data:newdata,
    sign:newsign,
    sum:rh`.state.sum + (sum ${head})`
  }
  // XXX: in c1_opt (new codegen), the last *s loop is splitted into two loops.
  // This is because we require strict ordering of assignments to one tmp.
  let f1 = api.compile(q1)
  while (state.data.length) {
    state = f1({state, udf})
  }
  expect(state.sum).toBe(2)
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

test("day10-part2", () => {
  let input = `FF7FSF7F7F7F7F7F---7
L|LJ||||||||||||F--J
FL-7LJLJ||||||LJL-77
F--JF--7||LJLJ7F7FJ-
L---JF-JLJ.||-FJLJJ7
|F|F-JF---7F7-L7L|7|
|FFJF7L7F-JF7|JL---7
7-L-JL7||F7|L7F-7F7|
L.L7LFJ|||||FJL7||LJ
L7JLJL-JLJLJL--JLJ.L`

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

  let connectedSouth = {
    "|": true,
    "-": false,
    "L": false,
    "J": false,
    "7": true,
    "F": true,
    ".": false
  }

  let connectedNorth = {
    "|": true,
    "-": false,
    "L": true,
    "J": true,
    "7": false,
    "F": false,
    ".": false
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
    optionalChaining: (o, k) => o?.[k],
    toCoord: (i, j) => [i, j],
    inLoop: (i, j, path) => path[i]?.[j] ? true : false,
    getEnclosedArray: (i, path, grid) => (row) => {
      let enclosed = false
      let res = []
      for (let j in row) {
        if (udf.inLoop(i, j, path)) {
          enclosed = enclosed != (row[j] == "S" ? connectedSouth[grid[i - 1]?.[j]] : connectedNorth[row[j]])
        } else {
          res.push(enclosed)
        }
      }
      return res
    },
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
                                   | udf.toCoord (connected.(udf.optionalChaining ${grid}.(.*adj.0) (.*adj.1)).*neighbor.0 + .*adj.0) (connected.(udf.optionalChaining ${grid}.(.*adj.0) (.*adj.1)).*neighbor.1 + .*adj.1)
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

  let path = {}
  path[state.prev[0]] ??= {}
  path[state.prev[0]][state.prev[1]] = true
  path[state.curr[0]] ??= {}
  path[state.curr[0]][state.curr[1]] = true

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
  let pathObj = {
    prev: rh`state.curr`,
    curr: curr,
    cell: rh`${grid}.(${curr}.0).(${curr}.1)`,
  }

  let findPath = api.compile(pathObj)

  while (state.cell != "S") {
    state = findPath({input, udf, state, connected})
    path[state.curr[0]] ??= {}
    path[state.curr[0]][state.curr[1]] = true
  }

  let pathQuery = rh`.path`
  let query = rh`${grid}.*row | udf.getEnclosedArray *row ${pathQuery} ${grid} | sum .*enclosed | group *row | sum .*`
  let func = api.compile(query)

  let res = func({input, udf, connected, path})

  expect(res).toBe(10)
})

test("day11-part1", () => {
  let input =
`...#......
.......#..
#.........
..........
......#...
.#........
.........#
..........
.......#..
#...#.....`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency,
    ...udf_stdlib
  }

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let sym = rh`.input | udf.split "\\n" | .*row | udf.split "" | .*col`

  let isEmpty = rh`udf.isEqual ((udf.isEqual ${sym} "#") | sum) 0`
  let len_ = rh`(${isEmpty} | udf.toNum) + 1`
  let rowlen = rh`${len_} | group *row`
  let collen = rh`${len_} | group *col`
  let rowbound = rh`udf.isLessOrEqual (udf.toNum *r1) (udf.toNum *r0)`
  let rowSum = rh`(udf.andThen (${rowlen} | .*r0) (${rowlen} | .*r1)) | ${filterBy("*f0", rowbound)} | sum | group *r0`
  let colbound = rh`udf.isLessOrEqual (udf.toNum *c1) (udf.toNum *c0)`
  let colSum = rh`(udf.andThen (${collen} | .*c0) (${collen} | .*c1)) | ${filterBy("*f1", colbound)} | sum | group *c0`
  let isGalaxy = rh`udf.isEqual ${sym} "#"`
  let cords = {
    row:rh`*row`,
    col:rh`*col`
  }
  let galaxies = [rh`${cords} | ${filterBy("*f2", isGalaxy)}`]

  let g1 = rh`${galaxies} | .*g1`
  let g2 = rh`${galaxies} | .*g2`
  let rowdis = rh`(${rowSum} | .${rh`${g1}.row`}) - (${rowSum} | .${rh`${g2}.row`}) | udf.abs`
  let coldis = rh`(${colSum} | .${rh`${g1}.col`}) - (${colSum} | .${rh`${g2}.col`}) | udf.abs`
  let dis = rh`${rowdis} + ${coldis}`
  let query = rh`(${dis} | sum) / 2`
  // XXX: old codegen generates incorrect code
  let func = api.compileNew(query)
  let res = func({input, udf})
  expect(res).toBe(374)
})

test("day11-part2", () => {
  let input =
`...#......
.......#..
#.........
..........
......#...
.#........
.........#
..........
.......#..
#...#.....`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency,
    ...udf_stdlib
  }

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let sym = rh`.input | udf.split "\\n" | .*row | udf.split "" | .*col`

  let isEmpty = rh`udf.isEqual ((udf.isEqual ${sym} "#") | sum) 0`
  let len_ = rh`(${isEmpty} | udf.toNum) * 999999 + 1`
  let rowlen = rh`${len_} | group *row`
  let collen = rh`${len_} | group *col`
  let rowbound = rh`udf.isLessOrEqual (udf.toNum *r1) (udf.toNum *r0)`
  let rowSum = rh`(udf.andThen (${rowlen} | .*r0) (${rowlen} | .*r1)) | ${filterBy("*f0", rowbound)} | sum | group *r0`
  let colbound = rh`udf.isLessOrEqual (udf.toNum *c1) (udf.toNum *c0)`
  let colSum = rh`(udf.andThen (${collen} | .*c0) (${collen} | .*c1)) | ${filterBy("*f1", colbound)} | sum | group *c0`
  let isGalaxy = rh`udf.isEqual ${sym} "#"`
  let cords = {
    row:rh`*row`,
    col:rh`*col`
  }
  let galaxies = [rh`${cords} | ${filterBy("*f2", isGalaxy)}`]

  let g1 = rh`${galaxies} | .*g1`
  let g2 = rh`${galaxies} | .*g2`
  let rowdis = rh`(${rowSum} | .${rh`${g1}.row`}) - (${rowSum} | .${rh`${g2}.row`}) | udf.abs`
  let coldis = rh`(${colSum} | .${rh`${g1}.col`}) - (${colSum} | .${rh`${g2}.col`}) | udf.abs`
  let dis = rh`${rowdis} + ${coldis}`
  let query = rh`(${dis} | sum) / 2`
  let func = api.compileNew(query)
  let res = func({input, udf})
  expect(res).toBe(82000210)
})

test("day12-part1", () => {
  let input = `???.### 1,1,3
.??..??...?##. 1,1,3
?#?#?#?#?#?#?#? 1,3,1,6
????.#...#... 4,1,1
????.######..#####. 1,6,5
?###???????? 3,2,1`

  let udf = {
    result: (res) =>{
      return {
        input: [],
        ds: [],
        d: 0,
        res: res
      }
    },
    toArr1: (x) => [x],
    toArr2: (x, y) => [x, y],
    isNotUndef: (x) => x !== undefined,
    valueOrDefault: (x) => x !== undefined ? x : 0,
    ...udf_stdlib
  }

  let line = [{
    // the remaining input to process
    input: rh`.input | udf.split "\\n" | .*line
                     | udf.split " " | .0
                     | udf.split ""`,
    // a list of the numbers of damaged springs remaining to be placed
    ds: [rh`.input | udf.split "\\n" | .*line
                   | udf.split " " | .1
                   | udf.split "," | udf.toNum .*ds`],
    // the number of consecutive damaged springs seen so far
    d: 0 
  }]

  let lines = rh`${line} | group *line`

  let getPuzzles = api.compile(lines)
  let puzzles = getPuzzles({input, udf})

  let zero = rh`udf.result 0`
  let one = rh`udf.result 1`

  let currInput = rh`puzzle.*input`
  let validArrangement = rh`udf.logicalOr (udf.logicalAnd (udf.isEqual ${currInput}.ds.length 0) (udf.isEqual ${currInput}.d 0)) (udf.logicalAnd (udf.isEqual ${currInput}.ds.length 1) (udf.isEqual ${currInput}.d ${currInput}.ds.0))`
  
  let operationalRes1 = {
    input: rh`${currInput}.input | udf.slice 1`,
    ds: rh`${currInput}.ds`,
    d: 0
  }
  let operationalRes2 = {
    input: rh`${currInput}.input | udf.slice 1`,
    ds: rh`${currInput}.ds | udf.slice 1`,
    d: 0
  }
  let operationalCase = rh`udf.ifThenElse (udf.isEqual ${currInput}.d 0) ${operationalRes1} (udf.ifThenElse (udf.logicalAnd (udf.notEqual ${currInput}.ds.length 0) (udf.isEqual ${currInput}.d ${currInput}.ds.0)) ${operationalRes2} ${zero})`

  let damagedRes = {
    input: rh`${currInput}.input | udf.slice 1`,
    ds: rh`${currInput}.ds`,
    d: rh`${currInput}.d + 1`
  }
  let damagedCase = rh`udf.ifThenElse (udf.isEqual ${currInput}.ds.length 0) ${zero} (udf.ifThenElse (udf.isEqual ${currInput}.d ${currInput}.ds.0) ${zero} ${damagedRes})`

  let unknownCase = rh`udf.toArr2 ${operationalCase} ${damagedCase}`
  let nonEmptyCase = rh`udf.ifThenElse (udf.isEqual ${currInput}.input.0 ".") (udf.toArr1 ${operationalCase}) (udf.ifThenElse (udf.isEqual ${currInput}.input.0 "#") (udf.toArr1 ${damagedCase}) ${unknownCase})`
  let emptyCase = rh`udf.ifThenElse ${validArrangement} ${one} ${zero} | udf.toArr1`

  let query = {
    puzzle: [rh`udf.ifThenElse (udf.isNotUndef ${currInput}.res) (udf.toArr1 ${currInput}) (udf.ifThenElse (udf.isEqual ${currInput}.input.length 0) ${emptyCase} ${nonEmptyCase}) | .*new`],
    solved: rh`product (udf.isNotUndef ${currInput}.res)`,
    count: rh`sum (udf.valueOrDefault ${currInput}.res)`
  }

  let func = api.compile(query)

  let res = 0
  for (let i in puzzles) {
    let isSolved = 0
    let ret = null
    while (!isSolved) {
      ret = func({input, udf, puzzle: puzzles[i]})
      isSolved = ret.solved
      puzzles[i] = ret.puzzle
    }

    res += ret.count
  }
  
  expect(res).toBe(21)
})

test("day13-part1", () => {
  let input =`#.##..##.
..#.##.#.
##......#
##......#
..#.##.#.
..##..##.
#.#.##.#.

#...##..#
#....#..#
..##..###
#####.##.
#####.##.
..##..###
#....#..#`

  let udf = {
    andThen: (a,b) => b,
    reverse: (arr) => arr.reverse(),
    zip: (a, b) => [a, b],
    ...udf_stdlib
  }

  let pattern = {
    pattern: rh`.input | udf.split "\\n\\n" | .*chunk
                       | udf.split "\\n" | .*line
                       | udf.split "" | .*char
                       | group *char | group *line`,
    n: rh`.input | udf.split "\\n\\n" | .*chunk
                 | udf.split "\\n" | .length`
  }

  let transposedPattern = {
    pattern: rh`.input | udf.split "\\n\\n" | .*chunk
                       | udf.split "\\n" | .*line
                       | udf.split "" | .*char
                       | group *line | group *char`,
    n: rh`.input | udf.split "\\n\\n" | .*chunk
                 | udf.split "\\n" | .0.length`
  }

  let patterns = rh`${pattern} | group *chunk`
  let transposedPatterns = rh`${transposedPattern} | group *chunk`

  let upper = rh`udf.range 0 (${patterns}.*pattern.n - 1) 1 | udf.andThen .*rowSplitted (udf.reverse (udf.range 0 ((udf.toNum *rowSplitted) + 1) 1)) | ${patterns}.*pattern.pattern.(.*idx).*tile`
  let lower = rh`udf.range 0 (${patterns}.*pattern.n - 1) 1 | udf.andThen .*rowSplitted (udf.range ((udf.toNum *rowSplitted) + 1) (${patterns}.*pattern.n) 1) | ${patterns}.*pattern.pattern.(.*idx).*tile`

  let findHorizontal = rh`udf.toNum (udf.isEqual ${upper} ${lower}) | product`
  let horizontal = rh`udf.ifThenElse ${findHorizontal} ((udf.toNum(*rowSplitted) + 1) * 100) 0 | group *rowSplitted | group *pattern | sum .*a.*b`

  let left = rh`udf.range 0 (${transposedPatterns}.*pattern.n - 1) 1 | udf.andThen .*rowSplittedT (udf.reverse (udf.range 0 ((udf.toNum *rowSplittedT) + 1) 1)) | ${transposedPatterns}.*pattern.pattern.(.*idxT).*tileT`
  let right = rh`udf.range 0 (${transposedPatterns}.*pattern.n - 1) 1 | udf.andThen .*rowSplittedT (udf.range ((udf.toNum *rowSplittedT) + 1) (${transposedPatterns}.*pattern.n) 1) | ${transposedPatterns}.*pattern.pattern.(.*idxT).*tileT`

  let findVertical = rh`udf.toNum (udf.isEqual ${left} ${right}) | product`
  let vertical = rh`udf.ifThenElse ${findVertical} (udf.toNum(*rowSplittedT) + 1) 0 | group *rowSplittedT | group *pattern | sum .*aT.*bT`

  let query = rh`${horizontal} + ${vertical}`

  let func = api.compileNew(query)
  let res = func({input, udf})

  expect(res).toBe(405)
})

test("day14-part1", () => {
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
    getOrDefault: (o, k) => o[k] ?? 0,
    ...udf_stdlib
  }

  let lines = rh`.input | udf.split "\\n"`
  let platform = rh`${lines} | .*line1 | udf.split "" | group *line1`
  let n = rh`${lines} | count .*line2`

  let whereCanIFall = rh`${platform} | .(state.row)
                                     | ((udf.getOrDefault state.whereCanIFall *col) + 1) * (udf.isEqual .*col "O") +
                                       (state.row + 1) * (udf.isEqual .*col "#") +
                                       (udf.getOrDefault state.whereCanIFall *col) * (udf.isEqual .*col ".")`

  let load = rh`${platform} | .(state.row)
                            | (${n} - (udf.getOrDefault state.whereCanIFall *col)) * (udf.isEqual .*col "O")
                            | sum`

  let state = {
    whereCanIFall: {},
    load: 0,
    row: 0,
    n: Infinity
  }

  let query = {
    whereCanIFall: [whereCanIFall],
    load: rh`state.load + ${load}`,
    row: rh`state.row + 1`,
    n: n
  }

  let func = api.compile(query)
  while (state.row < state.n) {
    state = func({input, udf, state})
  }
  expect(state.load).toBe(136)
})

test("day15-part1", () => {

  let udf = {
      ifThenElse: (predicate, thenBr, elseBr) => predicate ? thenBr : elseBr,
      charCode: (string, index) => string.charCodeAt(index),
      filter: c => c ? { [c]: true } : {},
      andThen: (a,b) => b, // just to add a as dependency
      ...udf_stdlib
  };

  let input = "rn=1,cm-,qp=3,cm=2,qp-,pc=4,ot=9,ab=5,pc-,pc=6,ot=7";

  let parseInput = api.compile(api.array({
      string: rh`.input | udf.split "," | .*group`,
      hash: 0
  }));

  let state = {
      strings: parseInput({input, udf}),
      index: 0,
      sum: 0,
  };

  let stringObj = api.array({
      string: rh`state.strings.*.string`,
      hash: rh`(
          17 * (state.strings.*.hash + (
              udf.charCode (state.strings.*.string) (state.index)
          ))
      ) % 256`
  });

  let updateStrings = rh`${stringObj} | .*strings`;

  let partSum = rh`sum(${updateStrings} | udf.ifThenElse (udf.isEqual (.string.length) (state.index+1)) .hash 0)`

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`
  let filterStrings = rh`${updateStrings} | ${filterBy("*f", rh`udf.notEqual state.strings.*strings.string.length (state.index+1)`)}`

  let run = api.compile({
      strings: api.array(filterStrings),
      index: rh`state.index + 1`,
      sum: rh`state.sum + ${partSum}`
  });

  while (state.strings.length > 0) {
      state = run({state, udf});
  }

  expect(state.sum).toEqual(1320);
});

test("day15-part2", () => {

  let udf = {
      ifThenElse: (predicate, thenBr, elseBr) => predicate ? thenBr : elseBr,
      charCode: (string, index) => string.charCodeAt(index),
      filter: c => c ? { [c]: true } : {},
      andThen: (a, b) => b, // just to add a as dependency
      andThenB: (a) => (b) => b,
      andThenA: (a) => (b) => a, // hack to add pipe as dependency without utilizing it's data.
      merge: (a, b, c) => [...a, b, ...c],
      pushBack: (a, b) => [...a, b],
      ...udf_stdlib
  };

  let ifElsePred = (predicate, thenBr, elseBr) => rh`udf.ifThenElse ${predicate} ${thenBr} ${elseBr}`;
  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`;

  let input = "rn=1,cm-,qp=3,cm=2,qp-,pc=4,ot=9,ab=5,pc-,pc=6,ot=7";

  let steps = api.array(rh`.input | udf.split "," | .*group`);

  let instrs = ifElsePred(rh`udf.isEqual (${steps}.*.(${steps}.*.length - 1)) "-"`, {
      type: "deletion",
      key: rh`${steps}.* | udf.split "-" | .0`,
      hash: 0,
  }, {
      type: "insertion",
      key: rh`${steps}.* | udf.split "=" | .0`,
      value: rh`${steps}.* | udf.split "=" | .1 | udf.toNum`,
      hash: 0,
  })

  let parseInput = api.compile({
      instrs: api.array(instrs),
      maxIndex: api.max(rh`${steps}.*.length - 1`),
      index: 0
  });

  let hashState = parseInput({input, udf});

  let runHash = api.compile({
      instrs: api.array({
          type: "state.instrs.*.type",
          key: "state.instrs.*.key",
          value: "state.instrs.*.value", // Could be undefined, but that's fine.
          hash: ifElsePred(rh`udf.isGreaterOrEqual state.index state.instrs.*.key.length`, "state.instrs.*.hash",
              rh`(
                  17 * (state.instrs.*.hash + (
                      udf.charCode (state.instrs.*.key) (state.index)
                  ))
              ) % 256`
          )
      }),
      maxIndex: ".state.maxIndex",
      index: rh`.state.index + 1`
  });

  while (hashState.index < hashState.maxIndex) {
      hashState = runHash({state: hashState, udf});
  }

  let symIndex = 0;
  let freshSym = (name) => ("*" + name + (symIndex++));

  let subListPre = (arr, indexSym, to) => api.array(rh`${arr} | ${filterBy(freshSym("f"), rh`udf.isLessThan ${indexSym} ${to}`)}`);
  let subListPost = (arr, indexSym, from) => api.array(rh`${arr} | ${filterBy(freshSym("f"), rh`udf.isGreaterThan ${indexSym} ${from}`)}`);
  let replaceArrItem = (arr, indexSym, index, newItem) =>
      rh`udf.merge ${subListPre(arr, indexSym, index)} ${newItem} ${subListPost(arr, indexSym, index)}`;

  // TODO: Find alternative to "udf.andThenA"
  // Right now it's used to return "valueToFind" while utilizing the piped in filter to filter results.
  let findValue = (arr, predicate, valueToFind) => api.first(rh`${arr} | ${filterBy(freshSym("find"), predicate)} | udf.andThenA (${valueToFind})`);

  let insertion = ifElsePred(
      // If a lens with the same key doesn't exist,
      rh`udf.isEqual 0 ${api.array(rh`.hashMap.(instr.hash).*sameLens | ${filterBy("*sameLensFilter", rh`udf.isEqual .hashMap.(instr.hash).*sameLens.key .instr.key`)}`)}.length`,
      // Then add it to the end.
      rh`udf.pushBack ${api.array(".hashMap.(instr.hash).*copyLens")} ${{
          key: ".instr.key",
          value: ".instr.value"
      }}`,
      // Otherwise replace it.
      replaceArrItem(rh`.hashMap.(instr.hash).*replaceLens`, "*replaceLens", findValue(
          rh`.hashMap.(instr.hash).*findSameLens`,
          rh`udf.isEqual (.hashMap.(instr.hash).*findSameLens.key) (.instr.key)`,
          "*findSameLens"
      ), {
          key: ".instr.key",
          value: ".instr.value"
      }),
  );

  let newList = ifElsePred(
      rh`udf.isEqual .instr.type "deletion"`,
      api.array(rh`.hashMap.(instr.hash).*delLens | ${filterBy("*del", rh`udf.notEqual (.hashMap.(instr.hash).*delLens.key) (.instr.key)`)}`),
      insertion
  )

  let run = api.compile(replaceArrItem(rh`.hashMap.*box`, "*box", ".instr.hash", newList));

  let hashMap = new Array(256).fill([]);

  // Run each instruction to either insert or delete in hash map.
  for (let instr of hashState.instrs) {
      hashMap = run({hashMap, instr, udf});
  }

  // Loop variables using "index in array" syntax are strings, so must be converted to numbers to avoid string concatenation.
  // Probably want to change this, given a generator index is a number.
  let getFocusingPower = api.compile(api.sum(rh`.hashMap.*a.*b.value * ((udf.toNum *a) + 1) * ((udf.toNum *b) + 1)`));
  let focusPower = getFocusingPower({hashMap, udf});

  expect(focusPower).toEqual(145);
});

test("day16-part1", () => {
  let input = `.|...\\....
|.-.\\.....
.....|-...
........|.
..........
.........\\
..../.\\\\..
.-.-/..|..
.|....-|.\\
..//.|....`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency,
    getAdj: point => {
      let i = +point[0]
      let j = +point[1]
      return [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]
    },
    onDot: (curr) => [[curr[0] + curr[2], curr[1] + curr[3], curr[2], curr[3]]],
    onPipe: (curr) => curr[2] == 0 ? [[curr[0] - 1, curr[1], -1, 0], [curr[0] + 1, curr[1], 1, 0]] : udf.onDot(curr),
    onDash: (curr) => curr[3] == 0 ? [[curr[0], curr[1] - 1, 0, -1], [curr[0], curr[1] + 1, 0, 1]] : udf.onDot(curr),
    onSlash: (curr) => [[curr[0] - curr[3], curr[1] - curr[2], -curr[3], -curr[2]]],
    onBackslash: (curr) => [[curr[0] + curr[3], curr[1] + curr[2], curr[3], curr[2]]],
    optionalChaining: (o, k) => o?.[k],
    notVisited: (visited, curr) => visited[curr[0]]?.[curr[1]]?.[curr[2]]?.[curr[3]] == undefined,
    merge: (o1, o2) => {
      return {...o1, ...o2}
    },
    ...udf_stdlib
  }

  let lines = rh`.input | udf.split "\\n"`
  let mat = rh`${lines} | .*line | udf.split "" | group *line`

  // The ray is represented by combining the position and direction [x, y, vx, vy]
  let state = {
    curr: [[0, 0, 0, 1]],      // top-left corner
    visited: {'0': {'0': {'0': {'1': true}}}}
  }

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let getCell = rh`udf.optionalChaining (udf.optionalChaining ${mat} (state.curr.*curr.0)) (state.curr.*curr.1)`

  let isDash = rh`udf.isEqual "-" ${getCell}`
  let isPipe = rh`udf.isEqual "|" ${getCell}`
  let isDot = rh`udf.isEqual "." ${getCell}`
  let isSlash = rh`udf.isEqual "/" ${getCell}`

  let newPosAndDir = [rh`udf.ifThenElse ${isDot} (udf.onDot state.curr.*curr) (udf.ifThenElse ${isPipe} (udf.onPipe state.curr.*curr) (udf.ifThenElse ${isDash} (udf.onDash state.curr.*curr) (udf.ifThenElse ${isSlash} (udf.onSlash state.curr.*curr) (udf.onBackslash state.curr.*curr)))) | .*new`]

  let inRange = rh`udf.optionalChaining (udf.optionalChaining ${mat} (${newPosAndDir}.*newPos.0)) (${newPosAndDir}.*newPos.1)`
  let notVisited = rh`udf.notVisited state.visited ${newPosAndDir}.*newPos`
  let valid = rh`udf.logicalAnd ${inRange} ${notVisited}`
  let filteredPosAndDir = [rh`${newPosAndDir}.*newPos | ${filterBy("*f", valid)}`]
  let nextState = {
    curr: filteredPosAndDir,
    visited: rh`state.visited`
  }

  let getNextState = api.compile(nextState)
  
  while (state.curr.length > 0) {
    state = getNextState({input, udf, state})
    for (let i in state.curr) {
      let curr = state.curr[i]
      state.visited[curr[0]] ??= {}
      state.visited[curr[0]][curr[1]] ??= {}
      state.visited[curr[0]][curr[1]][curr[2]] ??= {}
      state.visited[curr[0]][curr[1]][curr[2]][curr[3]] = true
    }
  }

  let query = rh`count state.visited.*i.*j`

  let func = api.compile(query)
  let res = func({state})

  expect(res).toBe(46)
})

test("day17-part1-array", () => {
  let input = `2413432311323
3215453535623
3255245654254
3446585845452
4546657867536
1438598798454
4457876987766
3637877979653
4654967986887
4564679986453
1224686865563
2546548887735
4322674655533`

  // left: [0, 1] => [-1, 0], [1, 0] => [0, 1], [0, -1] => [1, 0], [-1, 0] => [0, -1]
  // right: [0, 1] => [1, 0], [1, 0] => [0, -1], [0, -1] => [-1, 0], [-1, 0] => [0, 1]
  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a, b) => b, // just to add a as dependency
    getNeighbors: (curr) => {
      let straight = [curr[0] + curr[2], curr[1] + curr[3], curr[2], curr[3], curr[4] + 1]
      let left = [curr[0] - curr[3], curr[1] + curr[2], -curr[3], curr[2], 1]
      let right = [curr[0] + curr[3], curr[1] - curr[2], curr[3], -curr[2], 1]
      return [straight, left, right]
    },
    getNode: (graph, i, j) => graph?.[i]?.[j],
    notContain: (map, k) => map[k] === undefined,
    mapGet: (map, k) => map[k],
    toStr: (state) => state.join(" "),
    mergeObj: (o1, o2) => {
      return {...o1, ...o2}
    },
    getKeys: (o) => Object.keys(o),
    ...udf_stdlib
  }
  
  let lines = rh`.input | udf.split "\\n" | .*line
                        | udf.split "" | .*char
                        | group *char | group *line`
  let n = rh`.input | udf.split "\\n" | .length`
  let m = rh`.input | udf.split "\\n" | .0.length`

  let graphQuery = {
    graph: lines, n, m
  }

  // no need to process input in every iteration
  let getGraph = api.compile(graphQuery)
  let graph = getGraph({input, udf})

  let state = {
    visiting: [0, 0, 0, 1, 0],
  }
  let queue = {}
  let minHeatLoss = {
    "0 0 0 1 0": 0
  }

  // Get the list of possible next positions
  // Caldulate the heat loss for each of them
  // Get the next position to be visited (min in the queue)

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let neighbors = rh`udf.getNeighbors state.visiting | .*neighbors`
  let inRangeAndNotVisited = rh`udf.logicalAnd (udf.logicalAnd (udf.getNode graph.graph ${neighbors}.0 ${neighbors}.1) (udf.notContain .minHeatLoss (udf.toStr ${neighbors}))) (udf.isLessOrEqual ${neighbors}.4 3)`

  let newState = rh`${neighbors} | ${filterBy("*f", inRangeAndNotVisited)}`

  let newHeatLoss = rh`(udf.mapGet .minHeatLoss (udf.toStr state.visiting)) + (udf.toNum (udf.getNode graph.graph ${newState}.0 ${newState}.1)) | first | group (udf.toStr ${newState})`
  let newHeatLoss1 = rh`1 | group (udf.toStr ${newState})`
  
  let newMap = rh`udf.mergeObj .minHeatLoss ${newHeatLoss}`
  let newQueue = rh`udf.mergeObj .queue ${newHeatLoss1}`

  let min1 = rh`min (udf.mapGet .minHeatLoss (udf.getKeys .queue).*find1)`
  let isMin1 = rh`udf.isEqual (udf.mapGet .minHeatLoss (udf.getKeys .queue).*find2) ${min1}`

  let oldQueueMin = rh`(udf.getKeys .queue).*find2 | ${filterBy("*f1", isMin1)} | first`

  let min2 = rh`min ${newHeatLoss}.*find3`
  let isMin2 = rh`udf.isEqual ${newHeatLoss}.*find4 ${min2}`

  let newQueueMin = rh`udf.andThen ${newHeatLoss}.*find4 *find4 | ${filterBy("*f2", isMin2)} | first`

  let nextToVisit = rh`udf.ifThenElse (udf.isLessOrEqual ${min1} ${min2}) ${oldQueueMin} ${newQueueMin}`
  let next = rh`udf.ifThenElse ${oldQueueMin} (udf.ifThenElse ${newQueueMin} ${nextToVisit} ${oldQueueMin}) ${newQueueMin}`

  let query = {
    newQueue: newQueue,
    newMap: newMap,
    next: [rh`${next} | udf.split " " | udf.toNum .*`]
  }

  let func = compile(query)

  while (state.visiting[0] != graph.n - 1 || state.visiting[1] != graph.m - 1) {
    let {newQueue, newMap, next} = func({input, udf, state, minHeatLoss, graph, queue})

    minHeatLoss = newMap
    queue = newQueue

    delete queue[next.join(" ")]
    state.visiting = next
  }

  let res = minHeatLoss[udf.toStr(state.visiting)]
  expect(res).toBe(102)
})

test("day17-part1-rbtree", () => {
  let input = `2413432311323
3215453535623
3255245654254
3446585845452
4546657867536
1438598798454
4457876987766
3637877979653
4654967986887
4564679986453
1224686865563
2546548887735
4322674655533`

  // (Sedgewick's left leaning variant)

  function lookup(elem, key) {
    if (!elem) return undefined
    if (key < elem.key)
      return lookup(elem.left, key)
    else if (key == elem.key)
      return elem.value
    else
      return lookup(elem.right, key)
  }
  function insert(elem, key, value) {
    if (!elem) return {key,value,red:true}
    if (key < elem.key)
      elem = {...elem, left: insert(elem.left,key,value)}
    // else if (key == elem.key)
    //   elem = {...elem, value}
    else
      elem = {...elem, right: insert(elem.right,key,value)}
    if (isRed(elem.right) && !isRed(elem.left))
      elem = rotateLeft(elem)
    if (isRed(elem.left) && isRed(elem.left.left))
      elem = rotateRight(elem)
    if (isRed(elem.left) && isRed(elem.right))
      elem = colorFlip(elem)
    return elem
  }
  function isRed(elem) {
    return elem && elem.red
  }
  function colorFlip(elem) {
    // we know both children are red
    elem.red = !elem.red
    elem.left.red = !elem.left.red
    elem.right.red = !elem.right.red
    return elem
  }
  function rotateLeft(elem) {
    // assert(isRed(elem.right))
    let x = elem.right
    elem.right = x.left
    x.left = elem
    x.red = elem.red//!x.left.red
    //x.left.red = true
    elem.red = true
    return x
  }
  function rotateRight(elem) {
    // assert(isRed(elem.left) && isRed(elem.left.left))
    let x = elem.left
    elem.left = x.right
    x.right = elem
    x.red = elem.red//x.right.red
    //x.right.red = true
    elem.red = true
    return x
  }
  function moveRedLeft(elem) {
    colorFlip(elem)
    if (isRed(elem.right.left)) {
      elem.right = rotateRight(elem.right)
      elem = rotateLeft(elem)
      colorFlip(elem)
    }
    return elem
  }
  function deleteMin(elem) {
    if (!elem.left) return undefined
    
    if (!isRed(elem.left) && !isRed(elem.left.left))
      elem = moveRedLeft(elem)

    elem.left = deleteMin(elem.left)

    if (isRed(elem.right))
      elem = rotateLeft(elem)
    if (isRed(elem.left) && isRed(elem.left.left))
      elem = rotateRight(elem)
    if (isRed(elem.left) && isRed(elem.right))
      elem = colorFlip(elem)
    return elem
  }
  function getMin(elem) {
    return elem.left ? getMin(elem.left) : [elem.key, elem.value]
  }
  function emit(elem, buf, depth) {
    if (!elem) return
    let tmp = ". ".repeat(depth) + `k: ${elem.key}, v: ${elem.value} color: ${elem.red ? "R" : "B"}`

    buf.push(tmp)
    emit(elem.left, buf, depth + 1)
    emit(elem.right, buf, depth + 1)
  }

  let RedBlackTreeProxy = {
    get(target, prop, receiver) {
      if (prop === "toString") {
        let buf = []
        emit(target.root, buf, 0)
        return buf.join("\n")
      }
      if (prop === "min") {
        return target.root ? getMin(target.root) : undefined
      }
      if (prop === Symbol.iterator) {
        return (function*() {
          let rec = function* rec(elem) {
            if (!elem) return
            yield* rec(elem.left)
            yield ([elem.key, elem.value])
            yield* rec(elem.right)
          }
          yield* rec(target.root)
        })
      }
      return lookup(target.root, prop)
    },
    has(target, prop) {
      return lookup(target.root, prop) ?? false
    },
    set(target, prop, value) {
      let key = Number(prop.split(";")[0])
      target.root = insert(target.root, key, value)
      target.root.red = false
      return target.root
    },
    deleteProperty(target, prop) {
      if (prop === "min" && target.root) {
        target.root = deleteMin(target.root)
        target.root.red = false
        return true
      }
      return false
    },
    ownKeys(target) {
      let res = new Array
      let rec = elem => {
        if (!elem) return
        rec(elem.left)
        res.push(elem.key)
        rec(elem.right)
      }
      rec(target.root)
      return res
    },
    getOwnPropertyDescriptor(target, prop) {
      return { configurable: true, enumerable: true }
    }
  }

  let RedBlackTree = () => {
    return new Proxy({root:null}, RedBlackTreeProxy)
  }

  // left: [0, 1] => [-1, 0], [1, 0] => [0, 1], [0, -1] => [1, 0], [-1, 0] => [0, -1]
  // right: [0, 1] => [1, 0], [1, 0] => [0, -1], [0, -1] => [-1, 0], [-1, 0] => [0, 1]
  let id = 0
  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a, b) => b, // just to add a as dependency
    getNeighbors: (curr) => {
      let straight = [curr[0] + curr[2], curr[1] + curr[3], curr[2], curr[3], curr[4] + 1]
      let left = [curr[0] - curr[3], curr[1] + curr[2], -curr[3], curr[2], 1]
      let right = [curr[0] + curr[3], curr[1] - curr[2], curr[3], -curr[2], 1]
      return [straight, left, right]
    },
    getNode: (graph, i, j) => graph?.[i]?.[j],
    notContain: (map, k) => map[k] === undefined,
    toIdStr: (a, b) => `${a};${b}`,
    deleteMin: (_, q) => delete q.min,
    ...udf_stdlib
  }
  
  let lines = rh`.input | udf.split "\\n" | .*line
                        | udf.split "" | .*char
                        | group *char | group *line`
  let n = rh`.input | udf.split "\\n" | .length`
  let m = rh`.input | udf.split "\\n" | .0.length`

  let graphQuery = {
    graph: lines, n, m
  }

  // no need to process input in every iteration
  let getGraph = api.compile(graphQuery)
  let graph = getGraph({input, udf})

  // The current node we are visiting
  // [posi, posj, diri, dirj, streak]
  let visiting = [0, 0, 0, 1, 0]
  let queue = RedBlackTree()
  let minHeatLoss = {
    "0 0 0 1 0": 0
  }

  // Get the list of possible next positions
  // Caldulate the heat loss for each of them
  // Get the next position to be visited (min in the queue)

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let neighbors = rh`udf.getNeighbors .visiting | .*neighbors`
  let inRangeAndNotVisited = rh`udf.logicalAnd (udf.logicalAnd (udf.getNode graph.graph ${neighbors}.0 ${neighbors}.1) (udf.notContain .minHeatLoss (${neighbors} | udf.join " "))) (udf.isLessOrEqual ${neighbors}.4 3)`

  // The term "state" refers to the array representing the current position, direction and streak
  // [posi, posj, diri, dirj, streak]
  let newState = rh`${neighbors} | ${filterBy("*f", inRangeAndNotVisited)}`

  // Stores the new entries in the minHeatLoss map
  let newMapEntries = rh`.minHeatLoss.(.visiting | udf.join " ") + (udf.toNum (udf.getNode graph.graph ${newState}.0 ${newState}.1)) | first | group (${newState} | udf.join " ")`

  // Perform inplace update on map and queue 
  let updatedMap = rh`update_inplace .minHeatLoss *heatLoss first(${newMapEntries}.*heatLoss)`
  let updatedQueue = rh`update_inplace .queue (udf.toIdStr ${newMapEntries}.*heatLoss *heatLoss) first(*heatLoss)`

  // Find the next node to be visited from the queue
  let next = rh`${updatedQueue}.min.1 | udf.split " " | udf.toNum .* | array`

  // Delete the min from the queue
  let deleted = rh`udf.deleteMin ${next} ${updatedQueue}`

  let query = {
    next: rh`${updatedQueue}.min.1 | udf.split " " | udf.toNum .* | array`,
    updatedMap, deleted
  }

  let func = compile(query)

  while (visiting[0] != graph.n - 1 || visiting[1] != graph.m - 1) {
    let {next, deleted} = func({input, udf, visiting, minHeatLoss, graph, queue})
    console.assert(deleted)
    visiting = next
  }

  let res = minHeatLoss[visiting.join(" ")]
  expect(res).toBe(102)
})

test("day17-part1-old", () => {
  let input = `2413432311323
3215453535623
3255245654254
3446585845452
4546657867536
1438598798454
4457876987766
3637877979653
4654967986887
4564679986453
1224686865563
2546548887735
4322674655533`

  // left: [0, 1] => [-1, 0], [1, 0] => [0, 1], [0, -1] => [1, 0], [-1, 0] => [0, -1]
  // right: [0, 1] => [1, 0], [1, 0] => [0, -1], [0, -1] => [-1, 0], [-1, 0] => [0, 1]
  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a, b) => b, // just to add a as dependency
    getNeighbors: (curr) => {
      let straight = [curr[0] + curr[2], curr[1] + curr[3], curr[2], curr[3], curr[4] + 1]
      let left = [curr[0] - curr[3], curr[1] + curr[2], -curr[3], curr[2], 1]
      let right = [curr[0] + curr[3], curr[1] - curr[2], curr[3], -curr[2], 1]
      return [straight, left, right]
    },
    getNode: (graph, i, j) => graph?.[i]?.[j],
    notContain: (map, k) => map[k] === undefined,
    mapGet: (map, k) => map[k],
    merge: (a, b) => [...a, ...b],
    toStr: (state) => state.join(" "),
    ...udf_stdlib
  }
  
  let lines = rh`.input | udf.split "\\n" | .*line
                        | udf.split "" | .*char
                        | group *char | group *line`
  let n = rh`.input | udf.split "\\n" | .length`
  let m = rh`.input | udf.split "\\n" | .0.length`

  let graphQuery = {
    graph: lines, n, m
  }

  // no need to process input in every iteration
  let getGraph = api.compile(graphQuery)
  let graph = getGraph({input, udf})

  // console.log(graph)

  let state = {
    visiting: [0, 0, 0, 1, 0],
  }
  let queue = new Set()
  let minHeatLoss = {
    "0 0 0 1 0": 0
  }
  // console.log(minHeatLoss)

  // Get the list of possible next positions
  // Caldulate the heat loss for each of them
  // Get the next position to be visited (min in the queue)

  // Need a priority queue implementation?

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let neighbors = rh`udf.getNeighbors state.visiting | .*neighbors`
  let inRangeAndNotVisited = rh`udf.logicalAnd (udf.logicalAnd (udf.getNode graph.graph ${neighbors}.0 ${neighbors}.1) (udf.notContain .minHeatLoss (udf.toStr ${neighbors}))) (udf.isLessOrEqual ${neighbors}.4 3)`

  let newMinHeatLoss = {
    state: neighbors,
    heatLoss: rh`(udf.mapGet .minHeatLoss (udf.toStr state.visiting)) + (udf.toNum (udf.getNode graph.graph ${neighbors}.0 ${neighbors}.1))`
  }
  let query = [rh`${newMinHeatLoss} | ${filterBy("*f", inRangeAndNotVisited)}`]

  let func = compile(query)

  while (state.visiting[0] != graph.n - 1 || state.visiting[1] != graph.m - 1) {
    let updated = func({input, udf, state, minHeatLoss, graph})

    for (let i in updated) {
      queue.add(updated[i].state)
      minHeatLoss[udf.toStr(updated[i].state)] = updated[i].heatLoss
    }

    let minState = undefined
    let min = Number.MAX_VALUE
    queue.forEach(k => {
      if (minHeatLoss[udf.toStr(k)] < min) {
        minState = k
        min = minHeatLoss[udf.toStr(k)]
      }
    })

    state.visiting = minState
    queue.delete(minState)
  }

  let res = minHeatLoss[udf.toStr(state.visiting)]
  expect(res).toBe(102)
})

test("day18-part1", () => {
  let input = `R 6 (#70c710)
D 5 (#0dc571)
L 2 (#5713f0)
D 2 (#d2c081)
R 2 (#59c680)
D 2 (#411b91)
L 5 (#8ceee2)
U 2 (#caa173)
L 1 (#1b58a2)
U 2 (#caa171)
R 2 (#7807d2)
U 3 (#a77fa3)
L 2 (#015232)
U 2 (#7a21e3)`

  let udf = udf_stdlib
  
  let steps = rh`.input | udf.split "\\n" | .*line
                        | udf.split " " | .*part
                        | group *part | group *line`
  let n = rh`.input | udf.split "\\n" | .length`

  let digPlanQuery = {
    steps, n
  }

  // no need to process input in every iteration
  let getDigplan = api.compile(digPlanQuery)
  let digPlan = getDigplan({input, udf})

  let state = {
    curr: 0,
    x: 0,
    y: 0,
    area: 1
  }

  let dir = rh`digPlan.steps.(state.curr).0`
  let len = rh`udf.toNum digPlan.steps.(state.curr).1`

  let isRight = rh`udf.isEqual ${dir} "R"`
  let rightX = rh`(state.x + ${len}) * ${isRight}`
  let rightY = rh`state.y * ${isRight}`
  let rightArea = rh`(state.area + ${len}) * ${isRight}`

  let isDown = rh`udf.isEqual ${dir} "D"`
  let downX = rh`state.x * ${isDown}`
  let downY = rh`(state.y + ${len}) * ${isDown}`
  let downArea = rh`(state.area + (state.x + 1) * ${len}) * ${isDown}`

  let isLeft = rh`udf.isEqual ${dir} "L"`
  let leftX = rh`(state.x - ${len}) * ${isLeft}`
  let leftY = rh`state.y * ${isLeft}`
  let leftArea = rh`state.area * ${isLeft}`

  let isUp = rh`udf.isEqual ${dir} "U"`
  let upX = rh`state.x * ${isUp}`
  let upY = rh`(state.y - ${len}) * ${isUp}`
  let upArea = rh`(state.area - state.x * ${len}) * ${isUp}` 

  let x = rh`${rightX} + ${downX} + ${leftX} + ${upX}`
  let y = rh`${rightY} + ${downY} + ${leftY} + ${upY}`
  let area = rh`${rightArea} + ${downArea} + ${leftArea} + ${upArea}`

  let query = {
    curr: rh`state.curr + 1`,
    x, y, area
  }

  let func = api.compile(query)
  while (state.curr < digPlan.n) {
    state = func({digPlan, udf, state})
  }
  expect(state.area).toBe(62)
})

test("day18-part2", () => {
  let input = `R 6 (#70c710)
D 5 (#0dc571)
L 2 (#5713f0)
D 2 (#d2c081)
R 2 (#59c680)
D 2 (#411b91)
L 5 (#8ceee2)
U 2 (#caa173)
L 1 (#1b58a2)
U 2 (#caa171)
R 2 (#7807d2)
U 3 (#a77fa3)
L 2 (#015232)
U 2 (#7a21e3)`

  let udf = {
    extractDirAndLen: (hex) => [hex.substring(0, 5), hex.substring(5)],
    ...udf_stdlib
  }

  let steps = rh`.input | udf.split "\\n" | .*line
                        | udf.matchAll "[a-z0-9]{6}" "g" | .0.0
                        | udf.extractDirAndLen | udf.toNum ("0x" :: .*part)
                        | group *part | group *line`
  let n = rh`.input | udf.split "\\n" | .length`

  let digPlanQuery = {
    steps, n
  }

  // no need to process input in every iteration
  let getDigplan = api.compile(digPlanQuery)
  let digPlan = getDigplan({input, udf})

  let state = {
    curr: 0,
    x: 0,
    y: 0,
    area: 1
  }

  let dir = rh`digPlan.steps.(state.curr).1`
  let len = rh`udf.toNum digPlan.steps.(state.curr).0`

  let isRight = rh`udf.isEqual ${dir} 0`
  let rightX = rh`(state.x + ${len}) * ${isRight}`
  let rightY = rh`state.y * ${isRight}`
  let rightArea = rh`(state.area + ${len}) * ${isRight}`

  let isDown = rh`udf.isEqual ${dir} 1`
  let downX = rh`state.x * ${isDown}`
  let downY = rh`(state.y + ${len}) * ${isDown}`
  let downArea = rh`(state.area + (state.x + 1) * ${len}) * ${isDown}`

  let isLeft = rh`udf.isEqual ${dir} 2`
  let leftX = rh`(state.x - ${len}) * ${isLeft}`
  let leftY = rh`state.y * ${isLeft}`
  let leftArea = rh`state.area * ${isLeft}`

  let isUp = rh`udf.isEqual ${dir} 3`
  let upX = rh`state.x * ${isUp}`
  let upY = rh`(state.y - ${len}) * ${isUp}`
  let upArea = rh`(state.area - state.x * ${len}) * ${isUp}` 

  let x = rh`${rightX} + ${downX} + ${leftX} + ${upX}`
  let y = rh`${rightY} + ${downY} + ${leftY} + ${upY}`
  let area = rh`${rightArea} + ${downArea} + ${leftArea} + ${upArea}`

  let query = {
    curr: rh`state.curr + 1`,
    x, y, area
  }

  let func = api.compile(query)
  while (state.curr < digPlan.n) {
    state = func({digPlan, udf, state})
  }
  expect(state.area).toBe(952408144115)
})

test("day19-part1", () => {
  let input = `px{a<2006:qkq,m>2090:A,rfg}
pv{a>1716:R,A}
lnx{m>1548:A,A}
rfg{s<537:gd,x>2440:R,A}
qs{s>3448:A,lnx}
qkq{x<1416:A,crn}
crn{x>2662:A,R}
in{s<1351:px,qqz}
qqz{s>2770:qs,m<1801:hdj,R}
gd{a>3333:R,R}
hdj{m>838:A,pv}

{x=787,m=2655,a=1222,s=2876}
{x=1679,m=44,a=2067,s=496}
{x=2036,m=264,a=79,s=2244}
{x=2461,m=1339,a=466,s=291}
{x=2127,m=1623,a=2188,s=1013}`;

  let udf = {
      ...udf_stdlib,
      splitNN: x => x.split("\n\n"),
      splitN: x => x.split("\n"),
      getValue: x => x.substring(2),
      decurly: x => x.substring(1, x.length - 1),
      ifThenElse: (predicate, thenBr, elseBr) => predicate ? thenBr : elseBr,
      getCharAt: (x) => (str) => str == undefined ? undefined : str.charAt(x),
      filter: c => c ? { [c]: true } : {},
      andThen: (a,b) => b, // just to add a as dependency
    };

  let symInd = 0;
  let freshSym = () => ("*tmp" + (symInd++));
  let arrayGroupBy = (group, obj) =>
      api.array(rh`${{
          [group]: obj
      }} | .${freshSym()}`);
  let ifElsePred = (predicate, thenBr, elseBr) => rh`udf.ifThenElse ${predicate} ${thenBr} ${elseBr}`;
  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`
  
  // Get each workflow.
  let workflow_str = rh`.input | udf.splitNN | .0 | udf.splitN | .*workflow_str`;
  // Identify the different paths inside of it.
  let options = arrayGroupBy("*options", rh`${workflow_str} | udf.split "{" | .1 | udf.split "}" | .0 | udf.split "," | .*options`);
  // Create objects for each workflow, containing the array of paths.
  let workflows = arrayGroupBy("*workflow_str", {
      name: rh`${workflow_str} | udf.split "{" | .0`,
      options: options
  });

  let parsePredicate = (predStr) => ({
      op: rh`${predStr} | udf.getCharAt 1`,
      key: rh`${predStr} | udf.getCharAt 0`,
      value: rh`${predStr} | udf.getValue | udf.toNum`
  });

  // Separate workflows into multiple "subworkflows" that check a single condiiton and go to a specific state based on the result.
  // This allows simpler running by flattening the workflows into singular operations.
  let workflow_split = {
      "-": api.keyval(rh`${rh`${workflows}.*wf.name`} :: (udf.asString *opt)`, (
          // Check if there is a predicate before the transition state.
          ifElsePred(rh`udf.isEqual (${workflows}.*wf.options.*opt | udf.split ":" | .length) 1`, {
              // A predicate isn't there, so create a fake one.
              predicate: {op: "\">\"", key: "a", value: "0"},
              trueBranch: rh`${workflows}.*wf.options.*opt :: "0"`,
              falseBranch: rh`${workflows}.*wf.options.*opt :: "0"`
          }, {
              // A preedicate is there, so parse it.
              predicate: parsePredicate(rh`${workflows}.*wf.options.*opt | udf.split ":" | .0`),
              // If true, go to the state for it.
              trueBranch: rh`(${workflows}.*wf.options.*opt | udf.split ":" | .1) :: "0"`,
              // Otherwise continue on the current workflow.
              falseBranch: rh`${workflows}.*wf.name :: (udf.asString ((udf.toNum *opt) + 1))`
          })
      ))
  };

  // Parse each line of parts
  let part_str = rh`.input | udf.splitNN | .1 | udf.splitN | .*part_str`;
  let parts_arr = rh`${part_str} | udf.decurly | udf.split "," | .*part_arr`;
  
  let partsObj = {
      "*part_str": {
          // Initial state is "in", at index 0 of the workflow.
          "state": "in0",
          "attrs": {
              // Parse values for x, m, a, and s as object properties.
              "-" : api.keyval(rh`${parts_arr} | udf.split "=" | .0`, 
                  rh`${parts_arr} | udf.split "=" | .1 | udf.toNum`
              )
          }
      }
  };

  let parse = api.compile({
      workflows: workflow_split,
      parts: partsObj
  });

  let parsedInput = parse({input, udf});

  // Now that the workflow and parts are parsed, running is simply iterating on the input state.
  let state = {
      transitions: parsedInput.workflows,
      parts: Object.values(parsedInput.parts),
      acceptedSum: 0,
  };

  // Get current state for each part.
  let currentState = api.get(".input.transitions", rh`.input.parts.*part.state`);
  // Determine the next state based on whether it passes the predicate.
  let nextState = ifElsePred(
      rh`udf.isEqual ${currentState}.predicate.op ">"`,
      ifElsePred(
          rh`udf.isGreaterThan ${api.get(rh`.input.parts.*part.attrs`, rh`${currentState}.predicate.key`)} ${currentState}.predicate.value`,
          rh`${currentState}.trueBranch`,
          rh`${currentState}.falseBranch`,
      ),
      ifElsePred(
          rh`udf.isLessThan ${api.get(rh`.input.parts.*part.attrs`, rh`${currentState}.predicate.key`)} ${currentState}.predicate.value`,
          rh`${currentState}.trueBranch`,
          rh`${currentState}.falseBranch`,
      )
  );

  let newParts = arrayGroupBy("*part", {
      state: nextState,
      attrs: rh`.input.parts.*part.attrs`,
  });
  
  // Filter for all accepted states.
  let acceptedStates = api.array(rh`${newParts} | .*parts | ${filterBy("*acc", rh`udf.isEqual ${newParts}.*parts.state "A0"`)}`);
  
  // Filter for all state that are neither accepted nor rejected.
  let notAcceptedStates = api.array(rh`${newParts} | .*parts | ${filterBy("*acc1", rh`udf.notEqual ${newParts}.*parts.state "A0"`)}`);
  let filteredStates = rh`${notAcceptedStates} | .*partsNotAccepted | ${filterBy("*rej", rh`udf.notEqual ${notAcceptedStates}.*partsNotAccepted.state "R0"`)}`;

  let run = api.compile({
      transitions: rh`.input.transitions`,
      // Continue work on states not accepted or rejected.
      parts: api.array(filteredStates),
      // Accumulate all accepted states' values.
      acceptedSum: api.plus(".input.acceptedSum", api.sum(rh`${acceptedStates}.*part4.attrs.*attr`)),
  });

  while (state.parts.length > 0) {
      state = run({input: state, udf});
  }

  expect(state.acceptedSum).toBe(19114);

});

test("day19-part2", () => {
  let input = `px{a<2006:qkq,m>2090:A,rfg}
pv{a>1716:R,A}
lnx{m>1548:A,A}
rfg{s<537:gd,x>2440:R,A}
qs{s>3448:A,lnx}
qkq{x<1416:A,crn}
crn{x>2662:A,R}
in{s<1351:px,qqz}
qqz{s>2770:qs,m<1801:hdj,R}
gd{a>3333:R,R}
hdj{m>838:A,pv}

{x=787,m=2655,a=1222,s=2876}
{x=1679,m=44,a=2067,s=496}
{x=2036,m=264,a=79,s=2244}
{x=2461,m=1339,a=466,s=291}
{x=2127,m=1623,a=2188,s=1013}`;

  let udf = {
      ...udf_stdlib,
      splitNN: x => x.split("\n\n"),
      splitN: x => x.split("\n"),
      getValue: x => x.substring(2),
      decurly: x => x.substring(1, x.length - 1),
      ifThenElse: (predicate, thenBr, elseBr) => predicate ? thenBr : elseBr,
      getCharAt: (x) => (str) => str == undefined ? undefined : str.charAt(x),
      filter: c => c ? { [c]: true } : {},
      andThen: (a,b) => b, // just to add a as dependency
      min: (a, b) => a < b ? a : b,
      max: (a, b) => a > b ? a : b,
      join: (a, b) => ({...a, ...b}),
  };

  //
  // Taken from day19-A
  //
  let symInd = 0;
  let freshSym = () => ("*tmp" + (symInd++));
  let arrayGroupBy = (group, obj) =>
      api.array(rh`${{
          [group]: obj
      }} | .${freshSym()}`);
  let ifElsePred = (predicate, thenBr, elseBr) => rh`udf.ifThenElse ${predicate} ${thenBr} ${elseBr}`;
  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let workflow_str = rh`.input | udf.splitNN | .0 | udf.splitN | .*workflow_str`;
  let options = arrayGroupBy("*options", rh`${workflow_str} | udf.split "{" | .1 | udf.split "}" | .0 | udf.split "," | .*options`);
  let workflows = arrayGroupBy("*workflow_str", {
      name: rh`${workflow_str} | udf.split "{" | .0`,
      options: options
  });

  let parsePredicate = (predStr) => ({
      op: rh`${predStr} | udf.getCharAt 1`,
      key: rh`${predStr} | udf.getCharAt 0`,
      value: rh`${predStr} | udf.getValue | udf.toNum`
  });

  let workflow_split = {
      "-": api.keyval(rh`${workflows}.*wf.name :: (udf.asString *opt)`, (
          ifElsePred(rh`udf.isEqual (${workflows}.*wf.options.*opt | udf.split ":" | .length) 1`, {
              // A predicate is expected, so make a random one and have both branches go to the same place.
              predicate: {op: "\">\"", key: "a", value: "0"},
              trueBranch: rh`${workflows}.*wf.options.*opt :: "0"`,
              falseBranch: rh`${workflows}.*wf.options.*opt :: "0"`
          }, {
              predicate: parsePredicate(rh`${workflows}.*wf.options.*opt | udf.split ":" | .0`),
              trueBranch: rh`(${workflows}.*wf.options.*opt | udf.split ":" | .1) :: "0"`,
              falseBranch: rh`${workflows}.*wf.name :: (udf.asString ((udf.toNum *opt) + 1))`
          })
      ))
  };

  // Since parts don't need to be parsed, they can safely be ignored.
  let parse = api.compile(workflow_split);

  let parsedInput = parse({input, udf});
  let state = {
      transitions: parsedInput,
      // Keep track of parts as "categories" with specific constraints
      // At each predicate, branch into different states for each possibility.
      parts: [{
          state: "in0",
          attrs: {
              x: {min: 1, max: 4000},
              m: {min: 1, max: 4000},
              a: {min: 1, max: 4000},
              s: {min: 1, max: 4000},
          }
      }],
      acceptedAmt: 0,
  };

  let join = (a, b) => rh`udf.join ${a} ${b}`;

  let currentState = api.get(".input.transitions", rh`.input.parts.*part.state`);
  let attrValue = api.get(rh`.input.parts.*part.attrs`, rh`${currentState}.predicate.key`);

  // Function to join previous attributes with the new overwritten attributes.
  let setMinsMaxes = (attr) => join(".input.parts.*part.attrs", {
      "-": api.keyval(rh`${currentState}.predicate.key`, attr)
  });
  // Reject state.
  const reject = {
      state: '"R0"',
      attrs: {x: {min: 0, max: 0}, m: {min: 0, max: 0}, a: {min: 0, max: 0}, s: {min: 0, max: 0}},
  };
  // Determine the new state and attributes for when the predicate evaluates to true.
  let trueBranch = ifElsePred(
      rh`udf.isEqual ${currentState}.predicate.op ">"`,
      // Verify there is some overlap.
      ifElsePred(rh`udf.isGreaterThan ${attrValue}.max ${currentState}.predicate.value`, {
          state: rh`${currentState}.trueBranch`,
          attrs: setMinsMaxes({
              // Set new mins and maxes based on overlap between predicate and current range.
              min: rh`udf.max (${currentState}.predicate.value + 1) ${attrValue}.min`,
              max: rh`${attrValue}.max`
          })
      }, reject), // If there is no overlap, immediately reject.
      ifElsePred(rh`udf.isLessThan ${attrValue}.min ${currentState}.predicate.value`, {
          state: rh`${currentState}.trueBranch`,
          attrs: setMinsMaxes({
              min: rh`${attrValue}.min`,
              max: rh`udf.min (${currentState}.predicate.value - 1) ${attrValue}.max`
          })
      }, reject),
  );
  let falseBranch = ifElsePred(
      rh`udf.isEqual ${currentState}.predicate.op ">"`,
      ifElsePred(rh`udf.isLessOrEqual ${attrValue}.min ${currentState}.predicate.value`, {
          state: rh`${currentState}.falseBranch`,
          attrs: setMinsMaxes({
              min: rh`${attrValue}.min`,
              max: rh`udf.min (${currentState}.predicate.value) ${attrValue}.max`
          })
      }, reject),
      ifElsePred(rh`udf.isGreaterOrEqual ${attrValue}.max ${currentState}.predicate.value`, {
          state: rh`${currentState}.falseBranch`,
          attrs: setMinsMaxes({
              min: rh`udf.max (${currentState}.predicate.value) ${attrValue}.min`,
              max: rh`${attrValue}.max`,
          })
      }, reject),
  );

  let trueBranches = arrayGroupBy("*part", trueBranch);
  let falseBranches = arrayGroupBy("*part", falseBranch);

  // Combine and accumulate all true and false branches from list of current states.
  let newParts = rh`${[trueBranches, falseBranches]} | .*a.*b`;
  
  // Filter for accepted states.
  let acceptedStates = rh`${newParts} | ${filterBy("*acc", rh`udf.isEqual ${newParts}.state "A0"`)}`;
  
  // Filter for states neither accepted nor rejected.
  let notAcceptedStates = rh`${newParts} | ${filterBy("*n_acc", rh`udf.notEqual ${newParts}.state "A0"`)}`;
  let filteredStates = rh`${notAcceptedStates} | ${filterBy("*rej", rh`udf.notEqual ${notAcceptedStates}.state "R0"`)}`;
  
  let attrs = rh`${acceptedStates} | .attrs`;

  let run = api.compile({
      transitions: rh`.input.transitions`,
      parts: api.array(filteredStates),
      // For all accepted states, sum the total number of potential parts accepted. (product of ranges)
      acceptedAmt: api.plus(".input.acceptedAmt", 
          api.sum(rh`
              (${attrs}.x.max - ${attrs}.x.min + 1)*
              (${attrs}.m.max - ${attrs}.m.min + 1)*
              (${attrs}.a.max - ${attrs}.a.min + 1)*
              (${attrs}.s.max - ${attrs}.s.min + 1)
          `)
      ),
  });

  while (state.parts.length > 0) {
      state = run({input: state, udf});
  }

  expect(state.acceptedAmt).toBe(167409079868000);

});

test("day20-part1", () => {
  let input = `broadcaster -> a
%a -> inv, con
&inv -> b
%b -> con
&con -> output`

  let udf = {
    ifThenElse: (predicate, thenBr, elseBr) => predicate ? thenBr : elseBr,
    ifThen: (predicate, thenBr) => predicate ? thenBr : undefined,
    removePrefix: (str) => str.substring(1),
    emptyObject: () => { return {} },
    copyAndUpdate: (o, k, v) => {
      let res = {...o}
      res[k] = v
      return res
    },
    flip: (n) => n ^= 1,
    getObjSize: (o) => Object.keys(o).length,
    optionalChaining: (o, k) => o?.[k],
    getAdjOrDefault: (o) => o ? o["adj"] : [],
    mergeArrays: (a, b) => [...a, ...b],
    ...udf_stdlib
  }

  let lines = rh`.input | udf.split "\\n"`

  let node = rh`${lines}.*line | udf.split " -> " 
                               | udf.ifThenElse (udf.isEqual .0 "broadcaster") .0 (udf.removePrefix .0)`
  let dest = rh`${lines}.*line | udf.split " -> " | .1
                               | udf.split ", "`

  let inDegree = rh`count ${dest}.*dest | group ${dest}.*dest`

  let nodeObj = {
    type: rh`${lines}.*line | udf.split " -> " | udf.ifThenElse (udf.isEqual .0 "broadcaster") .0 .0.0`,
    adj: dest
  }

  let initialNodeState = rh`${lines}.*line | udf.split " -> " | udf.ifThen (udf.notEqual .0 "broadcaster") (udf.ifThenElse (udf.isEqual .0.0 "%") 0 (udf.emptyObject 0))`

  let graphQuery = {
    nodes: rh`${nodeObj} | group ${node}`,
    inDegree,
    nodeStates: rh`${initialNodeState} | group ${node}`,
  }

  let getGraph = api.compile(graphQuery)
  let graph = getGraph({input, udf})
  
  let broadcaster = {
    src: rh`state.pulses.0.dest`,
    dest: rh`(udf.getAdjOrDefault state.graph.nodes.(state.pulses.0.dest)).*adj`,
    pulse: rh`state.pulses.0.pulse`
  }

  let flipFlop = {
    src: rh`state.pulses.0.dest`,
    dest: rh`(udf.getAdjOrDefault state.graph.nodes.(state.pulses.0.dest)).*adj`,
    pulse: rh`udf.flip state.graph.nodeStates.(state.pulses.0.dest)`
  }

  let stateCopy = rh`udf.copyAndUpdate state.graph.nodeStates.(state.pulses.0.dest) state.pulses.0.src state.pulses.0.pulse`
  let conj = {
    src: rh`state.pulses.0.dest`,
    dest: rh`(udf.getAdjOrDefault state.graph.nodes.(state.pulses.0.dest)).*adj`,
    pulse: rh`udf.flip (udf.toNum (udf.logicalAnd (product ${stateCopy}.*input) (udf.isEqual state.graph.inDegree.(state.pulses.0.dest) (udf.getObjSize ${stateCopy}))))`
  }

  let isBroadcaster = rh`udf.isEqual state.pulses.0.dest "broadcaster"`
  let isFlipFlop = rh`udf.isEqual (udf.optionalChaining state.graph.nodes.(state.pulses.0.dest) "type") "%"`
  let isConj = rh`udf.isEqual (udf.optionalChaining state.graph.nodes.(state.pulses.0.dest) "type") "&"`

  let newPulses = [rh`udf.ifThenElse ${isBroadcaster} ${broadcaster} (udf.ifThenElse ${isFlipFlop} (udf.ifThen (udf.isEqual state.pulses.0.pulse 0) ${flipFlop}) ${conj})`]

  let query = {
    graph: rh`state.graph`,
    pulses: rh`udf.mergeArrays (state.pulses | udf.slice 1) ${newPulses}`,
    flipped: rh`udf.ifThen (udf.logicalAnd ${isFlipFlop} (udf.isEqual state.pulses.0.pulse 0)) state.pulses.0.dest`,
    stateUpdated: rh`udf.ifThen ${isConj} state.pulses.0`,
    countLowPulse: rh`state.countLowPulse + (udf.toNum (udf.isEqual state.pulses.0.pulse 0))`,
    countHighPulse: rh`state.countHighPulse + (udf.toNum (udf.isEqual state.pulses.0.pulse 1))`
  }

  let state = {
    graph: graph,
    pulses: [{
      src: "button",
      dest: "broadcaster",
      pulse: 0
    }],
    countLowPulse: 0,
    countHighPulse: 0,
  }

  let func = api.compileNew(query)

  let i = 0;
  while (i < 1000) {
    state.pulses = [{
      src: "button",
      dest: "broadcaster",
      pulse: 0
    }]

    while (state.pulses.length > 0) {
      state = func({input, udf, state})
      // Update state manually
      if (state.flipped) {
        state.graph.nodeStates[state.flipped] ^= 1
      }
      if (state.stateUpdated) {
        state.graph.nodeStates[state.stateUpdated["dest"]][state.stateUpdated["src"]] = state.stateUpdated["pulse"]
      }
    }
    i++
  }

  let res = state.countLowPulse * state.countHighPulse
  expect(res).toBe(11687500)
})

test("day21-part1", () => {
  let input = `...........
.....###.#.
.###.##..#.
..#.#...#..
....#.#....
.##..S####.
.##..#...#.
.......##..
.##.#.####.
.##..##.##.
...........`

  let udf = {
    getAdj: point => {
      let i = +point[0]
      let j = +point[1]
      return [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]
    },
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency
    toCoordStr: (i, j) => `${i} ${j}`,
    toSet: (arr) => new Set(arr),
    toArr: (set) => Array.from(set),
    getCell: (grid, i, j) => grid?.[i]?.[j],
    ...udf_stdlib
  }
  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let grid = [rh`.input | udf.split "\\n" | .*line
                         | udf.split ""`]

  // Use filter to find the start position
  let isStart = rh`udf.isEqual ${grid}.*i.*j "S"`
  let startPos = [rh`udf.toCoordStr (udf.toNum *i) (udf.toNum *j) | ${filterBy("*f1", isStart)}`]

  let initialState = {
    curr: rh`udf.toSet ${startPos}`,
    grid: grid
  }

  let getInitialState = api.compile(initialState)
  let state = getInitialState({input, udf})

  // Iterate through each current cell and add the their neighbors to the array / set
  
  let adj = rh`udf.getAdj ((udf.toArr state.curr).*curr | udf.split " ")`
  let isGardenPlot = rh`udf.logicalAnd (udf.getCell state.grid ${adj}.*adj.0 ${adj}.*adj.1) (udf.notEqual (udf.getCell state.grid ${adj}.*adj.0 ${adj}.*adj.1) "#")`
  let neighbors = [rh`${adj} | udf.toCoordStr .*adj.0 .*adj.1 | ${filterBy("*f2", isGardenPlot)}`]

  let query = {
    curr: rh`udf.toSet ${neighbors}`,
    grid: rh`state.grid`
  }
  let func = api.compile(query)

  let i = 0
  while (i < 6) {
    state = func({input, udf, state})
    i++
  }

  let res = state.curr.size
  expect(res).toBe(16)
})

test("day22-part1", () => {
  let input = `1,0,1~1,2,1
0,0,2~2,0,2
0,2,3~2,2,3
0,0,4~0,2,4
2,0,5~2,2,5
0,1,6~2,1,6
1,1,8~1,1,9`

  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency,
    ifThenElse: (pred, thenBr, elseBr) => pred ? thenBr : elseBr,
    moveDown: (brick) => {
      // copy original brick and modify
      let newBrick = {"0": {...brick[0]}, "1": {...brick[1]}}
      newBrick[0][2] -= 1
      newBrick[1][2] -= 1
      return newBrick
    },
    // use rhyme for this function later
    collides: (a, b) => {
      let xOverlaps = (a, b) => {
        let minX = Math.min(a[0][0], a[1][0])
        let maxX = Math.max(a[0][0], a[1][0])
        let otherMinX = Math.min(b[0][0], b[1][0])
        let otherMaxX = Math.max(b[0][0], b[1][0])
        return maxX >= otherMinX && otherMaxX >= minX
      }
      let yOverlaps = (a, b) => {
        let minY = Math.min(a[0][1], a[1][1])
        let maxY = Math.max(a[0][1], a[1][1])
        let otherMinY = Math.min(b[0][1], b[1][1])
        let otherMaxY = Math.max(b[0][1], b[1][1])
        return maxY >= otherMinY && otherMaxY >= minY
      }
      let zOverlaps = (a, b) => {
        let minZ = Math.min(a[0][2], a[1][2])
        let maxZ = Math.max(a[0][2], a[1][2])
        let otherMinZ = Math.min(b[0][2], b[1][2])
        let otherMaxZ = Math.max(b[0][2], b[1][2])
        return maxZ >= otherMinZ && otherMaxZ >= minZ
      }
      return xOverlaps(a, b) && yOverlaps(a, b) && zOverlaps(a, b)
    },
    prepend: (value, arr) => [value, ...arr],
    cmpFn: (a, b) => {
      return Math.min(a[0][2], a[1][2]) - Math.min(b[0][2], b[1][2])
    },
    toSet: (arr) => new Set(arr),
    ...udf_stdlib
  }

  let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

  let lines = [rh`.input | udf.split "\\n" | .*line
                         | udf.split "~" | .*endpoint
                         | udf.split "," | .*coord
                         | group *coord | group *endpoint`]

  let bricksQuery = rh`${lines} | udf.sort udf.cmpFn`

  let getBricks = api.compile(bricksQuery)
  let bricks = getBricks({input, udf})

  let state = {
    bricks,
    droppedBricksKeys: [],
    droppedBricksValues: []
  }

  let brickMovedDown = rh`udf.moveDown state.bricks.0`
  let collides = rh`udf.collides state.droppedBricksKeys.*brick ${brickMovedDown}`
  let collisions = [rh`state.droppedBricksKeys.*brick | ${filterBy("*f", collides)}`]
  let collideWithGround = rh`udf.logicalOr (udf.isEqual ${brickMovedDown}.0.2 0) (udf.isEqual ${brickMovedDown}.1.2 0)`
  let collideWithGroundOrBrick = rh`udf.logicalOr (udf.notEqual ${collisions}.length 0) ${collideWithGround}`
  let nextState = {
    bricks: rh`udf.ifThenElse ${collideWithGroundOrBrick} (state.bricks | udf.slice 1) (udf.prepend ${brickMovedDown} (state.bricks | udf.slice 1))`,
    droppedBricksKeys: rh`udf.ifThenElse ${collideWithGroundOrBrick} (udf.prepend state.bricks.0 state.droppedBricksKeys) state.droppedBricksKeys`,
    droppedBricksValues: rh`udf.ifThenElse ${collideWithGroundOrBrick} (udf.prepend ${collisions} state.droppedBricksValues) state.droppedBricksValues`
  } 

  let next = api.compile(nextState)

  while (state.bricks.length > 0) {
    state = next({input, udf, state})
  }

  let onlyOneSupportingBrick = rh`udf.isEqual state.droppedBricksValues.*.length 1`
  let nonDisintegrableBricks = [rh`state.droppedBricksValues.*.0  | ${filterBy("*f", onlyOneSupportingBrick)}`]
  let query = rh`bricks.length - (udf.toSet ${nonDisintegrableBricks}).size`

  let func = api.compile(query)
  let res = func({input, udf, state, bricks})

  expect(res).toBe(5)
})

test("day23-part1", () => {

    let input = `#.#####################
#.......#########...###
#######.#########.#.###
###.....#.>.>.###.#.###
###v#####.#v#.###.#.###
###.>...#.#.#.....#...#
###v###.#.#.#########.#
###...#.#.#.......#...#
#####.#.#.#######.#.###
#.....#.#.#.......#...#
#.#####.#.#.#########v#
#.#...#...#...###...>.#
#.#.#v#######v###.###v#
#...#.>.#...>.>.#.###.#
#####v#.#.###v#.#.###.#
#.....#...#...#.#.#...#
#.#########.###.#.#.###
#...###...#...#...#.###
###.###.#.###v#####v###
#...#...#.#.>.>.#.>.###
#.###.###.#.###.#.#v###
#.....###...###...#...#
#####################.#`;

    let udf = {
        ...udf_stdlib,
        splitN: x => x.split("\n"),
        filter: c => c ? { [c]: true } : {},
        isWellDefined: n => n !== undefined && Number.isFinite(n),
        checkNearby: (grid, y, x, delta) => (
            (grid[y + delta.y] != undefined && grid[y + delta.y][x + delta.x] == ".")
        ),
        sort: (arr) => {
            arr.sort((elem1, elem2) => {
                for (var k of Object.keys(elem1)) {
                    if (elem1[k] > elem2[k])
                        return 1;
                    if (elem1[k] < elem2[k])
                        return -1;
                }
                return 0;
            });
            return arr;
        },
        combine: (a, b) => {
            if (Number.isNaN(a) || !Number.isFinite(a) || a === undefined) {
                if (Number.isNaN(b) || !Number.isFinite(b) || b === undefined) {
                    return undefined;
                }
                return [b];
            } else {
                if (Number.isNaN(b) || !Number.isFinite(b) || b === undefined) {
                    return [a];
                }
                return [a,b];
            }
        },
        isDefined: (a) => a === undefined ? false : true,
        andThen: (a,b) => b, // just to add a as dependency
    };
    let filterBy = (gen, p) => x => rh`udf.andThen (udf.filter ${p}).${gen} ${x}`

    let cells = rh`.input | udf.splitN | .*lines | udf.split "" | .*cells`;

    let grid = {
        "*lines": api.array(rh`${cells}`)
    };

    let deltas = [{x: -1, y: 0}, {x: 1, y: 0}, {x: 0, y: -1}, {x: 0, y: 1}];

    let steps = api.array({
        dep: rh`(udf.filter (udf.logicalAnd
                (udf.isEqual ${grid}.*y.*x ".")
                (udf.checkNearby ${grid} (udf.toNum *y) (udf.toNum *x) ${deltas}.*d)
            )).*f1`,
        xy1: rh`(udf.asString *x) :: "," :: (udf.asString *y)`,
        xy2: rh`(((udf.toNum *x) + ${deltas}.*d.x) | udf.asString) :: "," :: (((udf.toNum *y) + ${deltas}.*d.y) | udf.asString)`,
    });

    let tuples = [
        ["*fD", "\"v\"", 0, -1],
        ["*fU", "\"^\"", 0,  1],
        ["*fR", "\">\"", -1, 0],
        ["*fL", "\"<\"",  1, 0],
    ];

    let forceMap = (tup) => ({
        xy1: rh`(((udf.toNum *cells) + ${tup[2]}) | udf.asString) :: "," :: (((udf.toNum *lines) + ${tup[3]}) | udf.asString)`,
        xy2: rh`(((udf.toNum *cells) + ${-tup[2]}) | udf.asString) :: "," :: (((udf.toNum *lines) + ${-tup[3]}) | udf.asString)`,
        dep: rh`(udf.filter (udf.isEqual ${cells} ${tup[1]})).${tup[0]}`
    });
 
    let force = api.array(
        forceMap(tuples[0]),
        forceMap(tuples[1]),
        forceMap(tuples[2]),
        forceMap(tuples[3]),
    );

    let parse = api.compile({
        steps: rh`udf.sort ${steps}`,
        force: rh`udf.sort ${force}`,
        keys: api.array(rh`udf.andThen ${grid}.*y.*x ((udf.asString *y) :: "," :: (udf.asString *x))`),
        maxX: rh`max (udf.andThen ${grid}.*y.*x (udf.toNum *x))`,
        maxY: rh`max (udf.andThen ${grid}.*y.*x (udf.toNum *y))`,
    });

    let parsedRes = parse({udf, input});

    let distSteps = {"-": api.keyval(
        rh`.steps.*steps.xy2`,
        api.min(rh`.dists.(.steps.*steps.xy1).*A`)
    )};

    let distForces = {"-": api.keyval(
        rh`.forces.*forces.xy2`,
        api.max(rh`.dists.(.forces.*forces.xy1).*B`)
    )};

    let distsCalc = {
        "-": api.keyval(
            rh`.keys.*keys`,
            rh`udf.combine (${distSteps}.(.keys.*keys) + 1) (${distForces}.(.keys.*keys) + 2)`
        )
    };

    let func = api.compile(distsCalc);

    let distsObj = {"1,0": [0]};
    let lastRes = {};
    // Continue until the result converges.
    while (Object.keys(lastRes).length != Object.keys(distsObj).length || JSON.stringify(lastRes) !== JSON.stringify(distsObj)) {
        lastRes = distsObj;
        distsObj = func({
            steps: parsedRes.steps,
            forces: parsedRes.force,
            keys: parsedRes.keys,
            dists: distsObj,
            udf
        });
        distsObj["1,0"] = [0];
    }

    let results = distsObj[(parsedRes.maxX-1) + "," + parsedRes.maxY];
    
    expect(results[0]).toBe(94);

});

test("day24-part1", () => {
  let input = `19, 13, 30 @ -2, 1, -2
18, 19, 22 @ -1, -1, -2
20, 25, 34 @ -2, -2, -4
12, 31, 28 @ -1, -2, -1
20, 19, 15 @ 1, -5, -3`

  let udf = {
    ifThenElse: (predicate, thenBr, elseBr) => predicate ? thenBr : elseBr,
    logicalAnd1: (a, b) => a && b ? 1 : 0,
    toCoord: (x, y) => [x, y],
    ...udf_stdlib
  }

  // parse input
  let hailstones = [rh`.input | udf.split "\\n" | .*line
                              | udf.split " @ " | .*part
                              | udf.split ", " | udf.toNum .*axis
                              | group *axis | group *part`]

  let x_1 = rh`${hailstones}.*hailstone1.0.0`
  let y_1 = rh`${hailstones}.*hailstone1.0.1`

  let x_2 = rh`${hailstones}.*hailstone2.0.0`
  let y_2 = rh`${hailstones}.*hailstone2.0.1`

  let vx_1 = rh`${hailstones}.*hailstone1.1.0`
  let vy_1 = rh`${hailstones}.*hailstone1.1.1`

  let vx_2 = rh`${hailstones}.*hailstone2.1.0`
  let vy_2 = rh`${hailstones}.*hailstone2.1.1`

  let a_1 = vy_1
  let b_1 = rh`0 - ${vx_1}`
  let c_1 = rh`${vx_1} * ${y_1} - ${vy_1} * ${x_1}`

  let a_2 = vy_2
  let b_2 = rh`0 - ${vx_2}`
  let c_2 = rh`${vx_2} * ${y_2} - ${vy_2} * ${x_2}`

  // if denominator is 0, then the two lines are parallel so they won't intersect
  let denominator = rh`${a_1} * ${b_2} - ${a_2} * ${b_1}`

  // calculate the intersection
  let intersection_x = rh`(${b_1} * ${c_2} - ${b_2} * ${c_1}) / ${denominator}`
  let intersection_y = rh`(${c_1} * ${a_2} - ${c_2} * ${a_1}) / ${denominator}`

  // calculate the time the hailstones reach the intersection
  let time_1 = rh`udf.ifThenElse ${vx_1} ((${intersection_x} - ${x_1}) / ${vx_1}) ((${intersection_y} - ${y_1}) / ${vy_1})`
  let time_2 = rh`udf.ifThenElse ${vx_2} ((${intersection_x} - ${x_2}) / ${vx_2}) ((${intersection_y} - ${y_2}) / ${vy_2})`

  // check if the intersection is within the desired area
  let intersect_within_area = rh`udf.logicalAnd (udf.isGreaterOrEqual ${intersection_x} 7) (udf.isLessOrEqual ${intersection_x} 27)`
  // check if the intersection is in the future
  let intersect_in_the_future = rh`udf.logicalAnd (udf.isGreaterOrEqual ${time_1} 0) (udf.isGreaterOrEqual ${time_2} 0)`

  // the two hailstones will intersect if both are true
  let will_intersect = rh`udf.logicalAnd1 ${intersect_within_area} ${intersect_in_the_future}`

  let will_intersect_all = [rh`udf.ifThenElse (udf.isLessThan *hailstone1 *hailstone2) (udf.ifThenElse ${denominator} (${will_intersect}) 0) 0`]

  // count the number of intersections
  let query = rh`${will_intersect_all} | sum .*`

  let func = api.compile(query)
  let res = func({input, udf})

  expect(res).toBe(2)
})

