xquery version "3.1";

(: might have to set Java 17 to run basex to compile this: `sdk use java 17.0.7-oracle` :)
declare variable $message as xs:string := "Hello, World!";


(: Following progarm creates  :)

<data>{ $message }</data>