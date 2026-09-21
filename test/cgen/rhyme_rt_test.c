#include <unistd.h>
#include "rhyme_rt.h"

static int fails = 0;
static void ck(const char *what, int ok) {
  if (!ok) { printf("FAIL: %s\n", what); fails++; }
}
static void ck_print(const char *what, rh_val v, const char *want) {
  fflush(stdout);
  char buf[512]; FILE *f = tmpfile(); int saved = dup(1);
  fflush(stdout); dup2(fileno(f), 1);
  rh_print_val(v); fflush(stdout);
  dup2(saved, 1); close(saved);
  rewind(f); size_t n = fread(buf, 1, sizeof(buf)-1, f); buf[n] = 0; fclose(f);
  if (strcmp(buf, want) != 0) { printf("FAIL: %s -> got %s want %s\n", what, buf, want); fails++; }
}

// The contract is that the text parses back to the same double, not that it
// matches JavaScript character for character.
static void ck_roundtrip(double d) {
  char buf[64];
  rh_fmt_double(buf, sizeof buf, d);
  if (strtod(buf, NULL) != d) {
    printf("FAIL: %.17g did not round-trip (printed %s)\n", d, buf);
    fails++;
  }
}

int main(void) {
  // numbers need not print the way JS does -- only round-trip exactly
  ck_roundtrip(70);
  ck_roundtrip(-3);
  ck_roundtrip(0.5);
  ck_roundtrip(1.0/3.0);
  ck_roundtrip(0.1+0.2);
  ck_roundtrip(0);
  ck_roundtrip(1e15);
  ck_roundtrip(1e21);
  ck_roundtrip(5e-7);
  ck_roundtrip(1234567890123456789.0);
  ck_roundtrip(5e-324);                  // denormal
  ck_roundtrip(1.7976931348623157e308);  // near DBL_MAX
  ck_print("integral prints without a point", rh_f64(70), "70");
  ck_print("nan is null", rh_f64(0.0/0.0), "null");

  // comparisons: true or undefined, never false
  ck("lt true", rh_pure_lessThan(rh_i64(1), rh_i64(2)).tag == RH_BOOL);
  ck("lt undef", rh_is_undef(rh_pure_lessThan(rh_i64(2), rh_i64(1))));
  ck("eq str", rh_pure_equal(rh_strv("ab",2), rh_strv("ab",2)).tag == RH_BOOL);
  ck("eq str neq", rh_is_undef(rh_pure_equal(rh_strv("ab",2), rh_strv("ac",2))));
  ck("eq undef prop", rh_is_undef(rh_pure_equal(rh_undef, rh_i64(1))));
  ck("str lt lex", rh_pure_lessThan(rh_strv("a",1), rh_strv("b",1)).tag == RH_BOOL);

  // undefined propagation / short circuit
  ck("plus undef", rh_is_undef(rh_pure_plus(rh_undef, rh_i64(1))));
  ck("and undef", rh_is_undef(rh_pure_and(rh_undef, rh_i64(1))));
  ck("and passes", rh_pure_and(rh_i64(0), rh_i64(7)).u.i64 == 7);
  ck("orElse takes b", rh_pure_orElse(rh_undef, rh_i64(9)).u.i64 == 9);
  ck("orElse keeps a", rh_pure_orElse(rh_i64(3), rh_i64(9)).u.i64 == 3);

  // arithmetic coercion
  ck("plus", rh_num(rh_pure_plus(rh_i64(40), rh_i64(30))) == 70);
  ck("plus str", rh_num(rh_pure_plus(rh_strv("40",2), rh_i64(2))) == 42);
  ck("div trunc", rh_num(rh_pure_div(rh_i64(7), rh_i64(2))) == 3);
  ck("fdiv", rh_num(rh_pure_fdiv(rh_i64(7), rh_i64(2))) == 3.5);
  ck("num empty str", rh_num(rh_strv("",0)) == 0);
  ck("num bad str", isnan(rh_num(rh_strv("12abc",5))));

  // stateful
  rh_val s = rh_stateful_sum_init();
  s = rh_stateful_sum(s, rh_i64(40));
  s = rh_stateful_sum(s, rh_undef);
  s = rh_stateful_sum(s, rh_i64(30));
  ck("sum skips undef", rh_num(s) == 70);
  rh_val c = rh_stateful_count_init();
  c = rh_stateful_count(c, rh_i64(5));
  c = rh_stateful_count(c, rh_undef);
  ck("count skips undef", rh_num(c) == 1);
  rh_val mn = rh_stateful_min_init();
  mn = rh_stateful_min(mn, rh_i64(10));
  mn = rh_stateful_min(mn, rh_i64(4));
  ck("min", rh_num(mn) == 4);
  rh_val mx = rh_stateful_max_init();
  mx = rh_stateful_max(mx, rh_i64(10));
  mx = rh_stateful_max(mx, rh_i64(4));
  ck("max", rh_num(mx) == 10);

  // map: insertion order, whatever the keys look like
  rh_map *m = rh_map_new();
  rh_map_set(m, rh_str_dup("B",1), rh_i64(20));
  rh_map_set(m, rh_str_dup("A",1), rh_i64(40));
  ck_print("map insertion order", rh_mapv(m), "{\"B\":20,\"A\":40}");
  rh_map *m2 = rh_map_new();
  rh_map_set(m2, rh_str_dup("x",1), rh_i64(1));
  rh_map_set(m2, rh_str_dup("10",2), rh_i64(2));
  rh_map_set(m2, rh_str_dup("2",1), rh_i64(3));
  ck_print("numeric keys are not reordered", rh_mapv(m2), "{\"x\":1,\"10\":2,\"2\":3}");
  rh_map *m3 = rh_map_new();
  rh_map_set(m3, rh_str_dup("k",1), rh_undef);
  ck_print("undef dropped", rh_mapv(m3), "{}");

  // map growth / reindex
  rh_map *big = rh_map_new();
  for (int i = 0; i < 5000; i++) {
    char b[16]; int n = snprintf(b, sizeof(b), "k%d", i);
    rh_map_set(big, rh_str_dup(b, n), rh_i64(i));
  }
  int ok = 1;
  for (int i = 0; i < 5000; i++) {
    char b[16]; int n = snprintf(b, sizeof(b), "k%d", i);
    if (rh_num(rh_map_get(big, rh_str_dup(b, n))) != i) ok = 0;
  }
  ck("map 5000 entries round-trip", ok);
  ck("map count", big->count == 5000);
  ck("map miss", rh_is_undef(rh_map_get(big, rh_str_dup("nope",4))));

  // keys are borrowed, not copied: anything that reaches a map must outlive it.
  // rh_to_key renders numbers into a stack buffer, so that path must copy --
  // check the key still reads correctly long after that frame is gone, and
  // after the entries array has been grown and reindexed underneath it.
  rh_map *borrow = rh_map_new();
  for (int i = 0; i < 200; i++)
    rh_map_set(borrow, rh_to_key(rh_i64(i)), rh_i64(i * 10));
  rh_map_set(borrow, rh_to_key(rh_f64(2.5)), rh_i64(99));
  rh_map_set(borrow, rh_to_key(rh_bool(true)), rh_i64(1));
  int borrowed_ok = 1;
  for (int i = 0; i < 200; i++)
    if (rh_num(rh_map_get(borrow, rh_to_key(rh_i64(i)))) != i * 10) borrowed_ok = 0;
  ck("numeric keys survive their stack frame", borrowed_ok);
  ck("float key", rh_num(rh_map_get(borrow, rh_to_key(rh_f64(2.5)))) == 99);
  ck("bool key is a literal", rh_num(rh_map_get(borrow, rh_to_key(rh_bool(true)))) == 1);

  // concat is strings only -- a non-string propagates undefined rather than
  // being rendered into the result the way js does
  ck_print("concat two strings", rh_pure_concat(rh_strv("ab",2), rh_strv("cd",2)), "\"abcd\"");
  ck("concat number is undefined", rh_is_undef(rh_pure_concat(rh_i64(1), rh_strv("b",1))));
  ck("concat undefined propagates", rh_is_undef(rh_pure_concat(rh_undef, rh_strv("b",1))));
  ck_print("concat empty", rh_pure_concat(rh_strv("",0), rh_strv("x",1)), "\"x\"");

  // string escaping
  ck_print("escape", rh_strv("a\"b\n",4), "\"a\\\"b\\n\"");

  if (fails == 0) printf("all runtime tests passed\n");
  return fails != 0;
}
