// runtime support for compiled rhyme queries

// notes:
// - currently only integers supported
// - simple tagging scheme to support relevant type universe
// - need generic collection interface:  iteration plus random access
// - consider macros instead of functions

#include <stdbool.h>
#include <stdio.h>

typedef void* rh;


// simple tagging scheme:
// - 0 is undefined/null
// - int is shifted << 1 and has lsb 1
// - lsb 0 means memory object (string, array, ...)

bool is_int(rh a) {
  return (((size_t)a) & 1) == 1;
}

rh encode_int(int a) {
  return (rh)(size_t)((a<<1)|1);
}

int decode_int(rh a) {
  return (int)((size_t)a) >> 1;
}



rh rt_const_string(char* a) {
  return 0; // TODO
}

rh rt_const_obj() {
  return 0; // TODO
}

// rh rt_const_float(float a) {
//   return a;
// }

rh rt_const_int(int a) {
  return encode_int(a);
}

rh rt_pure_plus(rh a, rh b) {
  // TODO: return null if a,b not int
  // TODO: operate on encoded repr
  return encode_int(decode_int(a) + decode_int(b));
}

rh rt_pure_and(rh a, rh b) {
  return a == 0 ? a : b;
}

rh rt_get(rh a, rh b) {
  return 0; // TODO
}



void write_result(rh x) {
  if (is_int(x))
    printf("%d", decode_int(x));
  else if (x == 0)
    printf("%s", "undefined");
  else
    printf("%s", "unknown value");
}
