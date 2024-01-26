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
  isLessOrEqual: (x,y) => x <= y,
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

  let isPossible = rh`udf.isLessOrEqual ${num} bag.${color} | udf.toNum` // TODO: <= syntax

  let lineRes = rh`min(${isPossible}) * ${game}` // using "min" to express "forall"

  let query = rh`${lineRes} | group *line | sum .*`

  let func = api.compile(query)
  let res = func({input, udf, bag})
  expect(res).toBe(8)
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