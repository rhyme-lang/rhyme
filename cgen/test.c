#include <stdio.h>
#include "rhyme.h"
int main() {
    rh inp = 0; // input?
    rh tmp = rt_const_obj();
    // --- tmp0 ---
    // XXX NOT IMPLEMENTED
    // --- res ---
    rh res = rt_pure_and(rt_const_int(1),rt_get(tmp, rt_const_int(0)));
    write_result(res);
}