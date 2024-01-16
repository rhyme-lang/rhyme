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