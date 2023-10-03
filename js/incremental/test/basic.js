import { api } from "../../core.js"
import { testQueryIncremental } from "./common.js"


// these tests work with triggers that mirrors non-incremental
function simple() {
    let data = [
        [{ key: "A", value: 10 }, 1],
        [{ key: "B", value: 20 }, 1],
        [{ key: "A", value: 30 }, 1],
        [{ key: "A", value: 10 }, -1],
        [{ key: "B", value: 45 }, 1],
    ]
    // TODO: {"A": 20} --> {"A": -20} should we remove "A"? or keep it as "A": 0? how to differentiate this with removal of all A
    // Note - we can do this by maintaining a separate counter for each key
    function simple1() {
        let query = { "data.*.key": api.sum("data.*.value") }
        testQueryIncremental(query, data, "simple1")
    }

    function simple2() {
        let query = {
            total: api.sum("data.*.value"),
            "data.*.key": api.sum("data.*.value"),
        }
        testQueryIncremental(query, data, "simple2")
    }

    simple1()
    simple2()
}

simple()
