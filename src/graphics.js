exports.display = (o, domParent) => {
    function createElement(type, props, ...children) {
        const dom = type.startsWith("svg:")
            ? document.createElementNS("http://www.w3.org/2000/svg", type.slice(4))
            : document.createElement(type)
        for (let k in props) {
            if (isEvent(k)) {
                dom.addEventListener(eventName(k), props[k])
            } else if (k == "style") { // special case for style ...
                for (let j in props[k])
                    dom[k][j] = props[k][j]
            } else {
                if (dom.setAttribute)
                    dom.setAttribute(k, props[k]) // XXX for SVG!
                dom[k] = props[k]
            }
        }
        for (let child of children) {
            if (!(child instanceof Node))
                child = document.createTextNode(child)
            dom.appendChild(child)
        }
        return dom
    }
    function isEvent(key) {
        return key.startsWith("on")
    }
    function eventName(key) {
        return key.toLowerCase().substring(2)
    }
    function render(element, container = o) {
        container.innerHTML = ""
        container.appendChild(element)
    }
    const e = createElement
    function dom(...es) {
        return e("span", {}, ...es)
    }

    // ambient scope

    function Amb() {
        this.get = function () {
            return { ...this }
        }
        this.set = function (s) {
            for (let k in this)
                delete this[k]
            for (let k in s)
                this[k] = s[k]
        }
        this.begin = function () {
            this.save = this.get()
        }
        this.end = function () {
            console.assert(this.save, "too many m.end!", this)
            this.set(this.save)
        }
        this.enter = function (s) {
            this.begin()
            this.set(s)
        }
        this.exit = function () {
            this.end()
        }
    }
    let m = new Amb()
    // m.begin = function begin(key) {
    //   let oldDyn = m
    //   m = {...oldDyn}
    //   m.end = () => { m = oldDyn }
    //   return
    // }
    //
    // m.enter = function enter(a) {
    //   let oldDyn = m
    //   s = { parent: s, m: oldDyn }
    //   m = a
    //   return a
    // }
    //
    // m.exit = function exit() {
    //   m = s.m
    //   s = s.parent
    // }
    //
    m.local = function (f) {
        let cur = this.get()
        return (...e) => { this.enter(cur); let res = f(...e); this.exit(); return res }
    }
    //
    //
    // dom parent management
    //
    let beg = m.begin
    m.beg = beg
    m.begin = arg => {
        m.beg()
        if (!arg) arg = ""
        if (typeof (arg) == "string") arg = m.styled(arg)
        m.domParent = arg
    }
    //
    m.add = b => {
        m.domParent.appendChild(b)
        return b
    }
    //
    // plain dom components
    //
    m.div = function div(...content) {
        return m.add(e("div", {}, ...content))
    }
    m.styled = function styled(className, ...content) {
        return m.add(e("div", { className }, ...content))
    }
    m.li = function li(...content) {
        return m.add(e("li", {}, ...content))
    }
    m.pre = function div(className, ...content) {
        return m.add(e("pre", { className }, ...content))
    }
    m.img = function img(className, src, alt) {
        return m.add(e("img", { className, src, alt }))
    }
    m.link = function link(className, href, ...contents) {
        return m.add(e("a", { className, href }, ...contents))
    }
    m.button = function button(className, ...contents) {
        return m.add(e("button", { className }, ...contents))
    }
    m.input = function input(className, ...contents) {
        return m.add(e("input", { className }, ...contents))
    }
    m.table = function (...content) {
        return m.add(e("table", {}, ...content))
    }
    m.thead = function (...content) {
        return m.add(e("thead", {}, ...content))
    }
    m.tbody = function (...content) {
        return m.add(e("tbody", {}, ...content))
    }
    m.col = function (...content) {
        return m.add(e("col", {}, ...content))
    }
    m.th = function (...content) {
        return m.add(e("th", {}, ...content))
    }
    m.td = function (...content) {
        return m.add(e("td", {}, ...content))
    }
    m.tr = function (...content) {
        return m.add(e("tr", {}, ...content))
    }
    //
    //

    m.domParent = domParent

    // object inspector
    function toDetailString(a, depth) {
        let maxLen = depth * 20
        if (depth == 0) return "..."
        if (a instanceof Array) {
            let acc = ["["]
            for (let k = 0; k < a.length; k++) {
                if (acc.length > 1) acc.push(", ")
                acc.push(toDetailString(a[k], depth - 1))
            }
            acc.push("]")
            let str = acc.join("")
            if (str.length > maxLen)
                str = str.substring(0, maxLen) + "..."
            return str
        }
        let str
        if (a && typeof (a) == "object") {
            let acc = []
            if (a.constructor != Object)
                acc.push(a.constructor.name, " ")
            acc.push("{")
            let j = acc.length
            for (let k of Object.keys(a)) {
                if (acc.length > j) acc.push(", ")
                acc.push(k, ": ", toDetailString(a[k], depth - 1))
            }
            acc.push("}")
            str = acc.join("")
        } else if (typeof (a) == "function") {
            str = "function"
        } else {
            str = String(a)
        }
        if (str.length > maxLen)
            str = str.substring(0, maxLen) + "..."
        return str
    }
    function toDomLine(a, key) {
        let d
        if (a && typeof (a) == "object") {
            d = e("div", {})
            let open = false
            function toggle() {
                open = !open
                render()
            }
            function render() {
                let btn = e("span", { onClick: toggle }, open ? "▽ " : "▷ ")
                btn.style.display = "inline-block"
                //btn.style.float = "left"
                btn.style.width = "2ch"
                d.innerText = ""
                d.appendChild(btn)
                if (key)
                    d.appendChild(dom(key, ": "))
                if (!open) {
                    let str = toDetailString(a, 3)
                    d.appendChild(dom(str))
                }
                if (open) {
                    d.appendChild(dom(a?.constructor.name))
                    let ks = []
                    for (let k of Object.keys(a))
                        ks.push(toDomLine(a[k], k))
                    let inner = e("div", {}, ...ks)
                    inner.style.marginLeft = "2ch" // key ? "4ch" : "2ch"
                    d.appendChild(inner)
                }
            }
            render()
        } else if (typeof (a) == "function") {
            // TODO: make expandable
            if (key) {
                d = e("div", {}, key, ": ", "function")
                d.style.marginLeft = "2ch"
            } else
                d = e("div", {}, "function")
        } else {
            if (key) {
                d = e("div", {}, key, ": ", String(a))
                d.style.marginLeft = "2ch"
            } else
                d = e("div", {}, String(a))
        }
        return d
    }
    function inspector(a) {
        return toDomLine(a)
    }
    function inspect(...args) {
        if (args.length == 0) return
        if (args.length == 1) {
            o.appendChild(toDomLine(args[0]))
        } else
            o.appendChild(toDomLine(args))
    }

    // data table
    //
    // table with nested row and col heads, and custom cell rendering
    //
    function table3d(rowsArg, colsArg, obj, template, renderCell, renderHead) {
        //
        // m.domParent.className += "relative w-full"
        let rows = []
        let cols = []
        let numRows = 0
        let numCols = 0
        let extraRows = 0 // add extra label if top level is special
        //
        if (rowsArg) {
            if (typeof (rowsArg) == "number")
                numRows = rowsArg
            else {
                rows = rowsArg
                numRows = rowsArg.length
            }
        }
        if (colsArg) {
            if (typeof (colsArg) == "number")
                numCols = colsArg
            else {
                cols = colsArg
                numCols = colsArg.length
            }
        }
        if (!renderHead)
            renderHead = (x, k) => {
                if (x != "") { // e.g. 0,0 cell is empty
                    m.domParent.style["border"] = "thin solid black"
                    m.domParent.style["background"] = "#EEEEEE"
                    m.domParent.style["padding"] = "0px 5px 0px 5px"
                    m.styled("inline", String(x))
                }
            }
        if (!renderCell)
            renderCell = (x, k) => {
                m.domParent.style["border"] = "thin solid lightgray"
                m.domParent.style["padding"] = "0px 5px 0px 5px"
                m.domParent.style["vertical-align"] = "middle"
                display_(x)
            }
        //
        // TODO: add a slow mode for col template: compute all cols
        // for everything!! Right now we rely on the (explicit or
        // implicit) 'template' argument to define the column
        // structure.
        //
        // column template
        if (!template) {
            template = obj
            for (let i = 0; i < numRows; i++)
                template = template["Total"] || template[0] || template[Object.keys(template)[0]]
        }
        //
        //
        // Normal objects only have children (indexed by key),
        // special objects can also have own properties (in
        // field 'props') in addition to children (in field
        // 'children')
        //
        function isSpecialObject(obj) {
            return (obj instanceof Object && "children" in obj)
        }
        //
        // computes spans and indexes of row/col headers
        function computeMeta(obj, depth) {
            function rec(obj, key, index, d) {
                let sub = {}
                let span = 0
                let special
                if (isSpecialObject(obj)) {
                    obj = obj.children
                    special = true
                    span = 1
                }
                if (d < depth) {
                    let i = 0
                    for (let k in obj) {
                        sub[k] = rec(obj[k], k, i++, d + 1)
                        span += sub[k].span
                    }
                } else {
                    span = 1
                }
                return { span, key, index, sub, special }
            }
            return rec(obj, "root", 0, 0)
        }
        //
        let colmeta1 = computeMeta(template, numCols)
        let rowmeta1 = computeMeta(obj, numRows)
        //
        // console.log("meta", rowmeta1, colmeta1)
        //
        function iterateMeta(meta, obj, depth, f) {
            let stack = []
            function rec(meta, obj, d) {
                stack[d] = meta
                if (d < depth) {
                    if (meta.special && obj) {
                        f(meta, obj.props, stack, d)
                        obj = obj.children
                    }
                    for (let k in meta.sub) {
                        rec(meta.sub[k], obj ? obj[k] : null, d + 1)
                    }
                } else {
                    f(meta, obj, stack, d)
                }
            }
            rec(meta, obj, 0)
        }
        //
        // adjust - show root head only if special
        if (rowmeta1.special)
            extraRows += 1
        //
        //
        /*
        //
        // Pseudocode for 2D tables:
        //
        // compute colmeta
        for (let c in template) {
            colmeta[c] = { span: 0, sub: {} }
            for (let d in template[c]) {
            colmeta[c].sub[d] = { span: 1, sub: {} }
            colmeta[c].span++
            }
        }
        // compute rowmeta
        for (let c in obj) {
            rowmeta[c] = { span: 0, sub: {} }
            for (let d in obj[c]) {
            // compute index in immediate parent (to show/hide)
            rowmeta[c].sub[d] = { span: 1, index: rowmeta[c].span, sub: {} }
            rowmeta[c].span++
            }
        }
        */
        //
        m.begin("min-w-full max-w-xl overflow-auto") // hscroll
        //
        m.begin(m.table())
        m.domParent.className = "table-fixed xxmin-w-full"
        m.domParent.style["border-collapse"] = "collapse"
        //m.domParent.style["border"] = "1px solid black"
        //m.domParent.style["width"] = "100%"
        //m.domParent.style["text-align"] = "left"
        //
        // emit col declarations
        let totalCols = numRows + extraRows + colmeta1.span
        for (let i = 0; i < totalCols; i++) {
            m.col().className = "w-48"
        }
        //
        m.begin(m.thead())
        m.domParent.className = "border-b border-gray-200 divide-gray-200"
        //
        // thead and tbody
        for (let i = 0; i < numCols; i++) {
            // header row
            m.begin(m.tr())
            //m.domParent.className = "text-right w-"+w+" max-w-sm truncate"
            if (i == 0 && numCols && (numRows + extraRows)) {
                m.begin(m.th()) // top left empty
                m.domParent.rowSpan = numCols
                m.domParent.colSpan = numRows + extraRows // account for root
                renderHead("")
                m.end()
            }
            // colums
            iterateMeta(colmeta1, null, i + 1, node => {
                m.begin(m.th())
                m.domParent.colSpan = node.span
                m.domParent.className = "text-right truncate"
                renderHead(node.key)
                m.end()
            })
            m.end()
        }
        //
        /*
        //
        // Pseudocode for 2D tables:
        //
        // 1st header row
        m.begin(m.tr())
            m.begin(m.th()) // top left empty
            m.domParent.rowSpan = numCols
            m.domParent.colSpan = numRows
            m.end()
        for (let c in colmeta) {
            let meta1 = colmeta[c]
            m.begin(m.th())
            m.domParent.colSpan = meta1.span
            m.domParent.className = "text-left max-w-sm truncate"
            m.styled("inline", c)
            m.end()
        }
        m.end()
        // 2nd header row
        m.begin(m.tr())
        for (let c in colmeta) {
        for (let d in colmeta[c].sub) {
            let meta1 = colmeta[c]
            let meta2 = meta1.sub[d]
            m.begin(m.th())
            m.domParent.colSpan = meta2.span
            m.domParent.className = "text-left max-w-sm truncate"
            m.styled("inline", d)
            m.end()
        }
        }
        m.end()
        */
        //
        m.end()
        m.begin(m.tbody())
        m.domParent.className = "table-fixed xxmin-w-full divide-y divide-gray-200"
        //
        //
        //
        iterateMeta(rowmeta1, obj, numRows, (node, obj, stack, depth) => {
            // row header
            m.begin(m.tr())
            // row header: only at index 0 or if special node
            let lastNonZero = 0
            let lastSpecial = 0
            for (let i = 0; i < depth; i++) {
                if (stack[i + 1].index != 0)
                    lastNonZero = i + 1
                if (stack[i].special && i < depth)
                    lastSpecial = i
            }
            // row headers
            for (let i = Math.max(lastNonZero, lastSpecial); i < depth; i++) {
                if (i == 0 && !stack[0].special) continue; // don't show root...
                m.begin(m.th())
                let { key, span, special } = stack[i]
                if (special) span -= 1
                m.domParent.rowSpan = span
                m.domParent.className = "text-left max-w-sm truncate"
                if (special)
                    renderCell(" ") // placeholder only
                else
                    renderHead(key)
                m.end()
            }
            // is this a special object? (interior node with own props)
            if (depth < numRows) {
                m.begin(m.th())
                m.domParent.colSpan = 1 + numRows - depth
                m.domParent.className = "text-left max-w-sm truncate"
                //m.domParent.style.color = "navy"
                renderHead(stack[depth].key)
                m.end()
            } else {
                m.begin(m.th())
                //m.domParent.colSpan = 1
                m.domParent.className = "text-left max-w-sm truncate"
                //m.domParent.style.color = "pink"
                renderHead(stack[depth].key)
                m.end()
            }
            // column data
            iterateMeta(colmeta1, obj, numCols, (node, obj, stack) => {
                m.begin(m.td())
                m.domParent.className = "text-right max-w-sm truncate"
                renderCell(obj, stack[stack.length - 1].key)
                m.end()
            })
            m.end()
        })
        //
        //
        //
        /*
        //
        // Pseudocode for 2D tables:
        //
        for (let row1 in obj) {
        for (let row2 in obj[row1]) {
        let obj1 = obj[row1]
        let obj2 = obj1[row2]
        let meta1 = rowmeta[row1]
        let meta2 = meta1.sub[row2]
        m.begin(m.tr())
            // row headers
            if (meta2.index == 0) {
            m.begin(m.th())
            m.domParent.rowSpan = meta1.span
            m.domParent.className = "text-left max-w-sm truncate"
            m.styled("inline", row1)
            m.end()
            }
            m.begin(m.th())
            m.domParent.rowSpan = meta2.span
            m.domParent.className = "text-left max-w-sm truncate"
            m.styled("inline", row2)
            m.end()
            // column data
            for (let c in template) {
            for (let d in template[c]) {
            m.begin(m.td())
                m.domParent.className = "max-w-sm truncate"
                m.styled("inline", String(obj2[c][d]))
            m.end()
            }
            }
        m.end()
        }
        }
        */
        m.end()
        m.end()
        m.end()
    }

    // generic display
    //
    //
    function display_(o) {
        switch (o?.["$display"]) {
            case "table":
                return table3d(o.rows, o.cols, o.data, o.template)
            case "select":
                return tabGroups(o.data)
            case "slider":
                return sliderGroups(o.data)
            case "bar":
                let x = o.value
                let dd = m.add(e("span", {}))
                //dd.style["vertical-align"] = "baseline"
                dd.style.display = "inline-block"
                dd.style.border = "1px solid black"
                dd.style.backgroundColor = "#EEEEEE"
                dd.style.width = x + "px"
                dd.style.height = "0.7em"
                return dd
            case "dom":
                let type = o.type ?? "span"
                let props = o.props ?? {}
                let children = o.children ?? {}
                let children1 = []
                for (let i in children) {
                    let child = children[i]
                    if (typeof (child) === "string")
                        children1.push(child) // do not recurse on strings
                    else
                        children1.push(display_(child))
                }
                return m.add(e(type, props, ...children1))
            default:
                return m.add(inspector(o))
        }
    }
    //
    // select / tab group panel
    //
    function tabGroups(data) {
        let keys = Object.keys(data)
        if (!keys.length) return d
        function styleButton(btn, selected) {
            btn.style.display = "inline-block"
            btn.style.border = "1px solid black"
            //btn.style.borderRadius = "6px"
            btn.style.padding = "1px 10px 1px 10px"
            //btn.style.marginRight = "10px"
            btn.style.cursor = "pointer"
            if (selected) {
                btn.style.color = "white"
                btn.style.background = "black"
            } else {
                btn.style.background = "white"
                btn.style.color = "black"
            }
        }
        let selected = keys[0]
        let buttons = {}
        let d
        m.begin()
        m.begin()
        m.domParent.style.marginBottom = "5px"
        for (let k of keys) {
            let btn = buttons[k] = m.add(e("span", {}, k))
            btn.onclick = m.local(ev => render(selected = k))
        }
        m.end()
        d = m.div()
        m.end()
        function render() {
            d.innerText = ""
            m.begin(d)
            for (let k of keys)
                styleButton(buttons[k], k == selected)
            display_(data[selected])
            m.end()
        }
        render()
    }
    //
    // slider select panel
    //
    function sliderGroups(data) {
        let keys = Object.keys(data)
        if (!keys.length) return d
        let index = 0
        let selected = keys[index]
        let d
        m.begin()
        m.begin()
        m.domParent.style.marginBottom = "5px"
        let slider = m.add(e("input", {
            "type": "range", "min": 0, "max": keys.length-1, "value": index
        }))
        slider.oninput = m.local(ev => render(selected = keys[index = slider.value]))
        let value = m.add(e("span", {}))
        m.end()
        d = m.div()
        m.end()
        function render() {
            d.innerText = ""
            value.innerText = selected
            m.begin(d)
            display_(data[selected])
            m.end()
        }
        render()
    }
    display_(o)
}
