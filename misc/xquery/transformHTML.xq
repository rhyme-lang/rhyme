xquery version "3.1";

declare namespace output = "http://www.w3.org/2010/xslt-xquery-serialization";

declare option output:method "html";
declare option output:indent "yes";

(: recursive transform function :)
declare function local:transform($node as node()) as node() {
  typeswitch ($node)
    case element(p) return
      <h5>{ $node/@* }</h5>
    case element() return
      element { node-name($node) } {
        $node/@*, (: copy attributes :)
        for $child in $node/node()
        return local:transform($child)
      }
    default return $node
};

let $html := 
  <html>
    <body>
      <h1>This is a heading</h1>
      <p>This is a paragraph</p>
      <div>
        <p>Nested paragraph</p>
        <p>Another nested paragraph</p>
      </div>
    </body>
  </html>

return
  local:transform($html)

(: how to  write this in our front-end?? :)
(: Data.**A
a.b.c
a

 :)