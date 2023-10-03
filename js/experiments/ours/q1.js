import { api } from "../../core.js"
// import { data } from "../data/toy.js" 
import { data } from "../data/data10M.js"

let query = api.sum("data.*.value")
let exec = api.compile(query)

let start = Date.now()
let res = exec({data})
let end = Date.now()

let elapsed = end - start
console.log(elapsed + "ms")

console.log(res)