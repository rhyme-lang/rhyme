/*
- update granularity? 
    right now, it's at the level of a single data item, but if we have larger data items,
    we might have to do it at a more granular level (updates = structural diffs)
    (this makes sense for a JSON analytics type of use case)

- output granularity?
    how to specify the output? simple way is to produce the next output. But in a setting where
    we e.g., updating a UI, a diff might be more useful/efficient
*/

let data =
[
    [{key: "A", value: 10}, 1],
    [{key: "B", value: 20}, 1],
    [{key: "A", value: 30}, 1],
    [{key: "A", value: 10}, -1],
    [{key: "B", value: 45}, 1],
]

function query1Test() {
    // let query = {
    //     total: api.sum("data.*.value"),
    //     "data.*.key": api.fdiv(api.sum("data.*.value"),api.sum("data.*B.value"))
    //   }

    let result = {
        total: 0,
    }

    function on_insert_data(data_item) {
        if (result[data_item.key] === undefined) {
            result[data_item.key] = 0;
        }
        result.total += data_item.value;
        result[data_item.key] += data_item.value / result.total;
    }

    function on_delete_data(data_item) {
        result.total -= data_item.value;
        result[data_item.key] -= data_item.value / result.total;
        if (result[data_item.key] === 0) {
            delete result[data_item.key];
        }
    }

    function driver() {
        // TODO: stream data
        for (let i = 0; i < data.length; i++) {
            if (data[i][1] === 1) {
                on_insert_data(data[i][0]);
            } else {
                on_delete_data(data[i][0]);
            }
            console.log("Result at t" + i + ":" + result);
        }
    }

    driver();
}

function pivotTableTest() {

    let data = [
        {insert: true, warehouse: "San Jose", product: "iPhone", model: "6s", quantity: 100},
        {insert: true, warehouse: "San Francisco", product: "iPhone", model: "6s", quantity: 50},
        {insert: true, warehouse: "San Jose", product: "iPhone", model: "7", quantity: 50},
        {insert: true, warehouse: "San Francisco", product: "iPhone", model: "7", quantity: 10},
        {insert: true, warehouse: "San Jose", product: "iPhone", model: "X", quantity: 150},
        {insert: true, warehouse: "San Francisco", product: "iPhone", model: "X", quantity: 200},
        {insert: true, warehouse: "San Jose", product: "Samsung", model: "Galaxy S", quantity: 200},
        {insert: true, warehouse: "San Francisco", product: "Samsung", model: "Galaxy S", quantity: 200},
        {insert: true, warehouse: "San Francisco", product: "Samsung", model: "Note 8", quantity: 100},
        {insert: true, warehouse: "San Jose", product: "Samsung", model: "Note 8", quantity: 150},
        {insert: false, warehouse: "San Jose", product: "iPhone", model: "6s", quantity: 50},
        {insert: false, warehouse: "San Francisco", product: "iPhone", model: "X", quantity: 200},
    ]
    
    /*

    // how to have a separate aggregate sum?
    let query: warehouse -> 

    

    query = {
        total: api.sum("data.*.quantity"),
        "data.*.warehouse": {
            total: api.sum("data.*.quantity"),
            percentage: api.fdiv(api.sum("data.*.quantity"), api.sum("data.*B.quantity")),
            "data.*.product": {
                total: api.sum("data.*.quantity"),
                percentage: api.fdiv(api.sum("data.*.quantity"), api.sum("data.*B.quantity")),  // TODO: how to do a relative sum over immediate parent? 
                "data.*.model": {                                                               //      (in this case, a way to compute/refer total in the parent)
                    total: api.sum("data.*.quantity"),                                          //      the form of code we generate is trivial, but how to express it?
                    percentage: api.fdiv(api.sum("data.*.quantity"), api.sum("data.*B.quantity"))
                }
            }
        }
    }

    query = {
        total: api.sum("data.*.quantity"),
        "data.*.warehouse": {
            total: api.sum("data.*.quantity"),
            percentage: api.fdiv(api.sum("data.*.quantity"), api.sum("data.*B.quantity")),
            "data.*.product": {
                total: api.sum("data.*.quantity"),
                percentage: api.fdiv(api.sum("data.*.quantity"), api.sum("data.*B.quantity[warehouse]")),  // TODO: how to do a relative sum over immediate parent? 
                "data.*.model": {                                                               //      (in this case, a way to compute/refer total in the parent)
                    total: api.sum("data.*.quantity"),                                          //      the form of code we generate is trivial, but how to express it?
                    .....
    */

    let result = {
        total: 0,
    }

    function on_insert_data(data_item) {
        // populate any missing keys
        if (result[data_item.warehouse] === undefined) {
            result[data_item.warehouse] = {
                total: 0,
                percentage: 0
            };
        }
        if (result[data_item.warehouse][data_item.product] === undefined) {
            result[data_item.warehouse][data_item.product] = {
                total: 0,
                percentage: 0
            };
        }
        if (result[data_item.warehouse][data_item.product][data_item.model] === undefined) {
            result[data_item.warehouse][data_item.product][data_item.model] = {
                total: 0,
                percentage: 0
            };
        }
        result.total += data_item.quantity;

        result[data_item.warehouse].total += data_item.quantity;
        result[data_item.warehouse].percentage = result[data_item.warehouse].total / result.total;

        result[data_item.warehouse][data_item.product].total += data_item.quantity;
        result[data_item.warehouse][data_item.product].percentage = result[data_item.warehouse][data_item.product].total / result[data_item.warehouse].total;

        result[data_item.warehouse][data_item.product][data_item.model].total += data_item.quantity;
        result[data_item.warehouse][data_item.product][data_item.model].percentage = result[data_item.warehouse][data_item.product][data_item.model].total / result[data_item.warehouse][data_item.product].total;
    }

    function on_delete_data(data_item) {
        // remove any keys that are now empty
        result.total -= data_item.quantity;

        result[data_item.warehouse].total -= data_item.quantity;
        result[data_item.warehouse].percentage = result[data_item.warehouse].total / result.total;

        result[data_item.warehouse][data_item.product].total -= data_item.quantity;
        result[data_item.warehouse][data_item.product].percentage = result[data_item.warehouse][data_item.product].total / result[data_item.warehouse].total;

        result[data_item.warehouse][data_item.product][data_item.model].total -= data_item.quantity;
        result[data_item.warehouse][data_item.product][data_item.model].percentage = result[data_item.warehouse][data_item.product][data_item.model].total / result[data_item.warehouse][data_item.product].total;

        if (result[data_item.warehouse][data_item.product][data_item.model].total === 0) {
            delete result[data_item.warehouse][data_item.product][data_item.model];
        }
        if (result[data_item.warehouse][data_item.product].total === 0) {
            delete result[data_item.warehouse][data_item.product];
        }
        if (result[data_item.warehouse].total === 0) {
            delete result[data_item.warehouse];
        }
    }

    function driver() {
        for (let i = 0; i < data.length; i++) {
            if (data[i].insert) {
                on_insert_data(data[i]);
            } else {
                on_delete_data(data[i]);
            }
            console.log("Result at t" + i + ":" + JSON.stringify(result));
        }
    }

    driver();
}

// TODO: joins, multiple tables, nested loops, etc.