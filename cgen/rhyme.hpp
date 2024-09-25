#include <fstream>
#include <nlohmann/json.hpp>
#include <iostream>

using json = nlohmann::json;

typedef json rh;

inline bool is_int(rh a) {
  return a.is_number_integer();
}

inline rh encode_int(int a) {
  return json(a);
}

inline int decode_int(rh a) {
  return (int)a;
}

inline rh rt_const_string(std::string a) {
  return json(a);
}

inline rh rt_const_obj() {
  return json::object();
}

inline rh rt_const_int(int a) {
  return encode_int(a);
}

inline rh rt_pure_plus(rh a, rh b) {
  return (int)a + (int)b;
}

inline rh rt_pure_and(rh a, rh b) {
  return decode_int(a) == 0 ? a : b;
}

inline rh rt_get(rh a, rh b) {
  return a[(std::string)b];
}

inline rh read_input() {
  std::ifstream f("cgen/inp.json");
  json inp = json::parse(f);
  return inp;
}

inline void write_result(rh x) {
  std::cout << x;
}
