/*
 * Implementations of (some) "Advent of Code" challenges 2024
 *
 * Problem statements: https://adventofcode.com
 *
 * Solutions are inspired by existing solutions in:
 * - JQ: https://github.com/odnoletkov/advent-of-code-jq
 * - Scala: https://scalacenter.github.io/scala-advent-of-code
 *
 */


const { api, pipe } = require('../src/rhyme')
const { rh } = require('../src/parser')
const { compile } = require('../src/simple-eval')

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
