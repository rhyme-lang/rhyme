// runtime support for compiled rhyme queries

// notes:
// - currently only integers supported
// - should think how to support relevant type universe
//   (indirection, tagging scheme?)
// - general collection interface: need iteration plus random access
// - consider

typedef int rh;

// rh rt_const_string(char* a) {
//   ...  
// }

// rh rt_const_obj() {
//   ...  
// }

// rh rt_const_float(float a) {
//   return a;
// }

rh rt_const_int(int a) {
  return a;
}


rh rt_pure_plus(rh a, rh b) {
  return a + b;
}


void write_result(rh x) {
  printf("%d", x);
}
