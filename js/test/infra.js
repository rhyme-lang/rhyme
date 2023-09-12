export function expect(a, b, testName = "") {
    if (jsonIsEqual(a, b))
        console.log(testName + ": 🟢 OK")
    else
        console.log(testName + ": 🔴 ERROR: \nexpected:\n" + JSON.stringify(b) + "\ngot:\n" + JSON.stringify(a))
}

let debug = false

export function display(...args) {
    if (debug)
        console.log(...args)
}

function jsonIsEqual(obj1, obj2) {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) {
        return false;
    }

    for (const key of keys1) {
        if (!keys2.includes(key)) {
            return false;
        }

        const val1 = obj1[key];
        const val2 = obj2[key];

        if (typeof val1 === 'object' && typeof val2 === 'object') {
            if (!jsonIsEqual(val1, val2)) {
                return false;
            }
        } else if (val1 !== val2) {
            return false;
        }
    }

    return true;
}