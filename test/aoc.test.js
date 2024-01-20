const { api, pipe } = require('../src/rhyme')
const { rh } = require('../src/parser')

// 2023

test("day1", () => {
    let input = `1abc2
pqr3stu8vwx
a1b2c3d4e5f
treb7uchet`
  // utilities to split input
  let udf = {
    splitN: x => x.split("\n"),
    splitB: x => x.split(""),
    toNum: x => {
      let n = Number(x)
      if (Number.isNaN(n))
        return undefined
      else
        return n
    }
  }
  let root = {xxpath:"raw", xxparam: "inp"} // XXX
  let digits =
    pipe(root).get("input")
    .map("udf.splitN").get("*line")
    .map("udf.splitB").get("*char")
    .map("udf.toNum")
  let numbers =
    api.plus(api.times(api.first(digits), 10),  api.last(digits))
  let query =
    pipe(numbers).group("*line").get("*").sum()
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

// utilities to split input and match digit
let udf = {
  splitN: x => x.split("\n"),
  match: x => x.match(digitregex),
  toNum: x => {
    let n = Number(x)
    if (Number.isNaN(n))
      return letters.indexOf(x) + 1
    else
      return n
  }
}
let root = {xxpath:"raw", xxparam: "inp"} // XXX
let digits =
  pipe(root).get("input")
  .map("udf.splitN").get("*line")
  .map("udf.match").get("*match")
  .map("udf.toNum")
let numbers =
  api.plus(api.times(api.first(digits), 10),  api.last(digits))
let query =
  pipe(numbers).group("*line").get("*").sum()
let func = api.compile(query)
let res = func({input, udf})
expect(res).toBe(281)
})

test("day2", () => {
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
  
  let udf = {
    splitN: x => x.split("\n"),
    splitColon: x => x.split(":"),
    scan: x => {
      // use udf to match regex
      const re = /(\d+) (red|green|blue)/g
      return x.match(re)
    },
    extractId: x => Number(x.substring(5)),
    all: x => x.every(v => v) ? 1 : 0,
    check: x => {
      // x is expected to be in the form of '<number> <color>'
      let s = x.trim()
      let split = s.split(" ")
      let n = Number(split[0])
      return n <= bag[split[1]]
    }
  }

  let root = {xxpath:"raw", xxparam: "inp"} // XXX

  let lines =
    pipe(root).get("input")
    .map("udf.splitN").get("*line")
    .map("udf.splitColon").get("*part")

  let id = api.apply("udf.extractId", api.first(lines))
  let isPossible = api.array(api.apply("udf.check", api.get(api.apply("udf.scan", api.last(lines)), "*match")))

  let lineRes = api.times(id, api.apply("udf.all", isPossible))

  let query = 
    pipe(lineRes).group("*line").get("*").sum()

  let func = api.compile(query)

  let res = func({input, udf})

  expect(res).toBe(8)
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