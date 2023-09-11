import { expect } from "../../test/infra.js";
import { api } from "../../core.js";
import { generateTriggers } from "../incremental.js";

// adds dataItemT to currData and re-evaluates query
function reevaluate(dataItemT, currData, exec) {
    // dataItemT -- data item arriving at time T
    if (dataItemT[1] === 1) {
        currData.push(dataItemT[0]);
    } else if (dataItemT[1] === -1) {
        let index = currData.findIndex(x => x.key === dataItemT[0].key);
        currData.splice(index, 1);
    }
    let res = exec({ data: currData })
    return res
}

export function testQueryIncremental(query, data, testName) {
    let exec = api.compile(query)
    let [initCode, insertCode, deleteCode] = generateTriggers(exec.explain.ir)
    let tmp = {} // globals

    let inp = {}  // represents "delta" for each t
    let currData = [] // for re-evaluation

    // init (for incremental)
    eval(initCode)

    for(let t = 0; t < data.length; t++) {
        // incremental
        // insert
        inp["data"] = [data[t][0]] // TODO: hardcoded "data" name
        if (data[t][1] === 1) {
            eval(insertCode)
        } else {
            eval(deleteCode)
        }
        let incRes = tmp[0]
        // re-evaluate
        let reevalRes = reevaluate(data[t], currData, exec)
        expect(incRes, reevalRes, testName)
    }
}