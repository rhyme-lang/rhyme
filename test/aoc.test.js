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

// 2022

test("day1", () => {
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
  let root = {xxpath:"raw", xxparam: "inp"} // XXX
  let query =
    pipe(root).get("input")
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