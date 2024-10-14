#include "rhyme.hpp"
int main() {
    rh inp = read_input(); // input?
    rh tmp = rt_const_obj();
    tmp["0"]=0;
    for (auto& [D0, D0_val] : inp["data"].items()) {
        tmp["0"]=rt_pure_plus(tmp["0"],inp["data"][D0]["value"]);
    }
    // --- res ---
    rh res = rt_pure_and(rt_const_int(1),tmp["0"]);
    write_result(res);
}