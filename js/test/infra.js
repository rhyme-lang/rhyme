export function expect(a, b, testName = "") {
    if (JSON.stringify(a) == JSON.stringify(b))
        console.log(testName + ": 🟢 OK")
    else
        console.log(testName + ": 🔴 ERROR: \nexpected:\n" + JSON.stringify(b) + "\ngot:\n" + JSON.stringify(a))
}