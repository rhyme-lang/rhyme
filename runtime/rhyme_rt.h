// Rhyme C value runtime.
//
// Mirrors src/simple-runtime.js: the JS backend is the reference semantics, so
// every operation here is written to produce what its rt.pure.* / rt.stateful.*
// counterpart produces. Where the two could differ -- numeric coercion, number
// formatting, object key order -- this file follows JavaScript, because the
// test corpus compares output against the JS backend.
//
// Values are a tagged union. Data read from an input document is BORROWED from
// the mmap'd yyjson document (tag RH_JSON), so loading stays zero-copy;
// computed values are native. Everything allocated here comes from a bump
// arena that is never freed until the process exits.

#ifndef RHYME_RT_H
#define RHYME_RT_H

#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "yyjson.h"

// ----- arena -----

typedef struct rh_chunk {
  struct rh_chunk *next;
  size_t used, cap;
  char data[];
} rh_chunk;

typedef struct { rh_chunk *head; } rh_arena;

static rh_arena rh_mem = {0};

#define RH_CHUNK_MIN (1 << 20)

static inline void *rh_alloc(size_t n) {
  n = (n + 15) & ~(size_t)15; // keep 16-byte alignment
  rh_chunk *c = rh_mem.head;
  if (!c || c->cap - c->used < n) {
    size_t cap = n > RH_CHUNK_MIN ? n : RH_CHUNK_MIN;
    c = (rh_chunk *)malloc(sizeof(rh_chunk) + cap);
    if (!c) {
      fprintf(stderr, "rhyme: out of memory\n");
      exit(1);
    }
    c->next = rh_mem.head;
    c->used = 0;
    c->cap = cap;
    rh_mem.head = c;
  }
  void *p = c->data + c->used;
  c->used += n;
  return p;
}

// ----- values -----

enum {
  RH_UNDEF = 0,
  RH_BOOL,
  RH_I64,
  RH_F64,
  RH_STR,
  RH_JSON, // borrowed from an input document
  RH_ARR,
  RH_MAP,
};

typedef struct {
  const char *ptr;
  uint32_t len;
} rh_str;

struct rh_arr;
struct rh_map;

typedef struct {
  uint8_t tag;
  union {
    bool b;
    int64_t i64;
    double f64;
    rh_str str;
    yyjson_val *json;
    struct rh_arr *arr;
    struct rh_map *map;
  } u;
} rh_val;

static const rh_val rh_undef = {RH_UNDEF, {0}};

static inline bool rh_is_undef(rh_val v) { return v.tag == RH_UNDEF; }

static inline rh_val rh_bool(bool b) {
  rh_val v = {RH_BOOL, {0}};
  v.u.b = b;
  return v;
}
static inline rh_val rh_i64(int64_t i) {
  rh_val v = {RH_I64, {0}};
  v.u.i64 = i;
  return v;
}
static inline rh_val rh_f64(double d) {
  rh_val v = {RH_F64, {0}};
  v.u.f64 = d;
  return v;
}
static inline rh_val rh_strv(const char *p, uint32_t n) {
  rh_val v = {RH_STR, {0}};
  v.u.str.ptr = p;
  v.u.str.len = n;
  return v;
}
static inline rh_val rh_jsonv(yyjson_val *j) {
  if (!j) return rh_undef;
  rh_val v = {RH_JSON, {0}};
  v.u.json = j;
  return v;
}

// Project a borrowed JSON scalar into a native tag. Containers stay RH_JSON so
// that reading them remains zero-copy; only leaves are unwrapped.
static inline rh_val rh_unwrap(rh_val v) {
  if (v.tag != RH_JSON) return v;
  yyjson_val *j = v.u.json;
  switch (yyjson_get_type(j)) {
    case YYJSON_TYPE_NULL: return rh_undef;
    case YYJSON_TYPE_BOOL: return rh_bool(yyjson_get_bool(j));
    case YYJSON_TYPE_NUM:
      if (yyjson_get_subtype(j) == YYJSON_SUBTYPE_REAL)
        return rh_f64(yyjson_get_real(j));
      return rh_i64(yyjson_get_sint(j));
    case YYJSON_TYPE_STR:
      return rh_strv(yyjson_get_str(j), (uint32_t)yyjson_get_len(j));
    default: return v; // arr / obj stay borrowed
  }
}

// ----- numeric coercion: JavaScript's Number(x) -----

static inline double rh_num(rh_val v) {
  v = rh_unwrap(v);
  switch (v.tag) {
    case RH_BOOL: return v.u.b ? 1.0 : 0.0;
    case RH_I64: return (double)v.u.i64;
    case RH_F64: return v.u.f64;
    case RH_STR: {
      // Number("") is 0; Number("12abc") is NaN -- the whole string must parse
      char buf[64];
      uint32_t n = v.u.str.len;
      if (n == 0) return 0.0;
      if (n >= sizeof(buf)) return NAN;
      memcpy(buf, v.u.str.ptr, n);
      buf[n] = 0;
      char *end;
      double d = strtod(buf, &end);
      while (*end == ' ' || *end == '\t' || *end == '\n' || *end == '\r') end++;
      return *end ? NAN : d;
    }
    default: return NAN;
  }
}

// ----- number formatting -----
//
// %.17g, which is enough significant digits that every double round-trips
// exactly. The text need not match what JavaScript prints -- 1/3 comes out as
// 0.33333333333333331 rather than 0.3333333333333333 -- because the consumer
// parses it back to a double, and both spellings parse to the same one.
//
// NaN and infinity print as null: JSON has no syntax for them, and that is
// what JSON.stringify does.
static inline int rh_fmt_double(char *out, size_t cap, double d) {
  if (isnan(d) || isinf(d)) return snprintf(out, cap, "null");
  return snprintf(out, cap, "%.17g", d);
}

// ----- string helpers -----

static inline bool rh_str_eq(rh_str a, rh_str b) {
  return a.len == b.len && memcmp(a.ptr, b.ptr, a.len) == 0;
}

// Borrow a string that already lives long enough (a literal, the input
// document, or the arena). rh_str never owns its bytes.
static inline rh_str rh_str_lit(const char *p, uint32_t n) {
  rh_str s = {p, n};
  return s;
}

// Copy into the arena. Needed only when the bytes are transient -- in practice
// just the stack buffer rh_to_key renders numbers into.
static inline rh_str rh_str_dup(const char *p, uint32_t n) {
  char *d = (char *)rh_alloc(n + 1);
  memcpy(d, p, n);
  d[n] = 0;
  rh_str s = {d, n};
  return s;
}

static inline unsigned long rh_hash_str(const char *s, uint32_t n) {
  unsigned long h = 5381;
  for (uint32_t i = 0; i < n; i++) h = ((h << 5) + h) + (unsigned char)s[i];
  return h;
}

// Render any value as the string JS would use for an object key.
static inline rh_str rh_to_key(rh_val v) {
  v = rh_unwrap(v);
  char buf[64];
  switch (v.tag) {
    case RH_STR: return v.u.str;
    case RH_I64: return rh_str_dup(buf, (uint32_t)snprintf(buf, sizeof(buf), "%lld",
                                                           (long long)v.u.i64));
    case RH_F64: return rh_str_dup(buf, (uint32_t)rh_fmt_double(buf, sizeof(buf), v.u.f64));
    case RH_BOOL: return rh_str_lit(v.u.b ? "true" : "false", v.u.b ? 4 : 5);
    default: return rh_str_lit("undefined", 9);
  }
}

// ----- pure operations (src/simple-runtime.js:75-257) -----
//
// Comparisons return true or undefined -- never false. That is the filtering
// semantics the language relies on, not an oversight.

#define RH_UNDEF_IF_MISSING2(a, b) \
  if (rh_is_undef(a) || rh_is_undef(b)) return rh_undef;

static inline bool rh_loose_eq(rh_val a, rh_val b) {
  a = rh_unwrap(a);
  b = rh_unwrap(b);
  if (a.tag == RH_STR && b.tag == RH_STR) return rh_str_eq(a.u.str, b.u.str);
  if (a.tag == RH_STR || b.tag == RH_STR) return false; // === is type-strict
  if (a.tag == RH_BOOL || b.tag == RH_BOOL) return a.tag == b.tag && a.u.b == b.u.b;
  return rh_num(a) == rh_num(b);
}

static inline rh_val rh_pure_equal(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  return rh_loose_eq(a, b) ? rh_bool(true) : rh_undef;
}
static inline rh_val rh_pure_notEqual(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  return !rh_loose_eq(a, b) ? rh_bool(true) : rh_undef;
}

// JS relational operators compare strings lexicographically, numbers otherwise
static inline int rh_cmp(rh_val a, rh_val b) {
  a = rh_unwrap(a);
  b = rh_unwrap(b);
  if (a.tag == RH_STR && b.tag == RH_STR) {
    uint32_t n = a.u.str.len < b.u.str.len ? a.u.str.len : b.u.str.len;
    int r = memcmp(a.u.str.ptr, b.u.str.ptr, n);
    if (r) return r < 0 ? -1 : 1;
    return a.u.str.len == b.u.str.len ? 0 : (a.u.str.len < b.u.str.len ? -1 : 1);
  }
  double x = rh_num(a), y = rh_num(b);
  if (isnan(x) || isnan(y)) return 2; // "unordered": every comparison is false
  return x < y ? -1 : (x > y ? 1 : 0);
}

#define RH_CMP_OP(name, test)                       \
  static inline rh_val rh_pure_##name(rh_val a, rh_val b) { \
    RH_UNDEF_IF_MISSING2(a, b)                       \
    int c = rh_cmp(a, b);                            \
    if (c == 2) return rh_undef;                     \
    return (test) ? rh_bool(true) : rh_undef;        \
  }
RH_CMP_OP(lessThan, c < 0)
RH_CMP_OP(lessThanOrEqual, c <= 0)
RH_CMP_OP(greaterThan, c > 0)
RH_CMP_OP(greaterThanOrEqual, c >= 0)
#undef RH_CMP_OP

static inline rh_val rh_pure_plus(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  return rh_f64(rh_num(a) + rh_num(b));
}
static inline rh_val rh_pure_minus(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  return rh_f64(rh_num(a) - rh_num(b));
}
static inline rh_val rh_pure_times(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  return rh_f64(rh_num(a) * rh_num(b));
}
static inline rh_val rh_pure_fdiv(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  return rh_f64(rh_num(a) / rh_num(b));
}
static inline rh_val rh_pure_div(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  return rh_f64(trunc(rh_num(a) / rh_num(b)));
}
static inline rh_val rh_pure_mod(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  return rh_f64(fmod(rh_num(a), rh_num(b)));
}

// Strings only. JS concatenates String(x1) + String(x2), so it happily renders
// a number into the result; here a non-string is treated as a missing value
// and propagates undefined, the same as any other type mismatch.
static inline rh_val rh_pure_concat(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  a = rh_unwrap(a);
  b = rh_unwrap(b);
  if (a.tag != RH_STR || b.tag != RH_STR) return rh_undef;
  rh_str x = a.u.str, y = b.u.str;
  char *d = (char *)rh_alloc(x.len + y.len + 1);
  memcpy(d, x.ptr, x.len);
  memcpy(d + x.len, y.ptr, y.len);
  d[x.len + y.len] = 0;
  return rh_strv(d, x.len + y.len);
}

// and/andAlso/orElse do NOT propagate undefined the usual way
static inline rh_val rh_pure_and(rh_val a, rh_val b) {
  return rh_is_undef(a) ? rh_undef : b;
}
static inline rh_val rh_pure_andAlso(rh_val a, rh_val b) {
  return rh_is_undef(a) ? rh_undef : b;
}
static inline rh_val rh_pure_orElse(rh_val a, rh_val b) {
  return rh_is_undef(a) ? b : a;
}
static inline rh_val rh_pure_ifElse(rh_val c, rh_val t, rh_val e) {
  return !rh_is_undef(c) ? t : e;
}

#define RH_CONVERT_INT(name, type)                   \
  static inline rh_val rh_pure_convert_##name(rh_val v) {    \
    if (rh_is_undef(v)) return rh_undef;              \
    return rh_i64((int64_t)(type)(int64_t)rh_num(v)); \
  }
RH_CONVERT_INT(u8, uint8_t)
RH_CONVERT_INT(u16, uint16_t)
RH_CONVERT_INT(u32, uint32_t)
RH_CONVERT_INT(i8, int8_t)
RH_CONVERT_INT(i16, int16_t)
RH_CONVERT_INT(i32, int32_t)
RH_CONVERT_INT(i64, int64_t)
#undef RH_CONVERT_INT

static inline rh_val rh_pure_convert_f64(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  return rh_f64(rh_num(v));
}
static inline rh_val rh_pure_convert_f32(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  return rh_f64((float)rh_num(v));
}
static inline rh_val rh_pure_convert_string(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  rh_str s = rh_to_key(v);
  return rh_strv(s.ptr, s.len);
}

// ----- stateful operations (src/simple-runtime.js:289-400) -----

static inline rh_val rh_stateful_sum_init(void) { return rh_i64(0); }
static inline rh_val rh_stateful_sum(rh_val s, rh_val x) {
  if (rh_is_undef(x) || isnan(rh_num(x))) return s;
  if (rh_is_undef(s) || isnan(rh_num(s))) return x;
  return rh_f64(rh_num(s) + rh_num(x));
}

static inline rh_val rh_stateful_product_init(void) { return rh_i64(1); }
static inline rh_val rh_stateful_product(rh_val s, rh_val x) {
  if (rh_is_undef(x)) return s;
  if (rh_is_undef(s)) return x;
  return rh_f64(rh_num(s) * rh_num(x));
}

static inline rh_val rh_stateful_count_init(void) { return rh_i64(0); }
static inline rh_val rh_stateful_count(rh_val s, rh_val x) {
  if (rh_is_undef(x)) return s;
  if (rh_is_undef(s)) return rh_i64(1);
  return rh_f64(rh_num(s) + 1);
}

static inline rh_val rh_stateful_min_init(void) { return rh_f64(INFINITY); }
static inline rh_val rh_stateful_min(rh_val s, rh_val x) {
  if (rh_is_undef(x)) return s;
  if (rh_is_undef(s)) return x;
  return rh_cmp(s, x) <= 0 ? s : x;
}

static inline rh_val rh_stateful_max_init(void) { return rh_f64(-INFINITY); }
static inline rh_val rh_stateful_max(rh_val s, rh_val x) {
  if (rh_is_undef(x)) return s;
  if (rh_is_undef(s)) return x;
  int c = rh_cmp(s, x);
  return (c >= 0 && c != 2) ? s : x;
}

static inline rh_val rh_stateful_first(rh_val s, rh_val x) {
  if (rh_is_undef(x)) return s;
  if (rh_is_undef(s)) return x;
  return s;
}
static inline rh_val rh_stateful_last(rh_val s, rh_val x) {
  if (rh_is_undef(x)) return s;
  return x;
}
static inline rh_val rh_stateful_single(rh_val s, rh_val x) {
  if (rh_is_undef(x)) return s;
  if (rh_is_undef(s)) return x;
  return x;
}
static inline rh_val rh_stateful_any(rh_val s, rh_val x) {
  if (rh_is_undef(x)) return s;
  if (rh_is_undef(s)) return x;
  return s;
}
static inline rh_val rh_stateful_all_init(void) { return rh_bool(true); }
static inline rh_val rh_stateful_all(rh_val s, rh_val x) {
  if (rh_is_undef(x) || rh_is_undef(s)) return rh_undef;
  return s;
}

// ----- maps -----
//
// Insertion-ordered, because JSON.stringify of a JS object follows insertion
// order -- except for integer-like keys, which come first in ascending numeric
// order. rh_map_print reproduces both rules.

typedef struct {
  rh_str key;
  rh_val val;
  unsigned long hash;
} rh_entry;

typedef struct rh_map {
  rh_entry *entries; // insertion order
  uint32_t count, cap;
  int32_t *index; // open-addressed, -1 empty, else entry slot
  uint32_t index_cap;
} rh_map;

static inline rh_map *rh_map_new(void) {
  rh_map *m = (rh_map *)rh_alloc(sizeof(rh_map));
  m->cap = 8;
  m->count = 0;
  m->entries = (rh_entry *)rh_alloc(sizeof(rh_entry) * m->cap);
  m->index_cap = 16;
  m->index = (int32_t *)rh_alloc(sizeof(int32_t) * m->index_cap);
  memset(m->index, 0xff, sizeof(int32_t) * m->index_cap);
  return m;
}

static inline rh_val rh_mapv(rh_map *m) {
  rh_val v = {RH_MAP, {0}};
  v.u.map = m;
  return v;
}

static inline void rh_map_reindex(rh_map *m, uint32_t cap) {
  m->index_cap = cap;
  m->index = (int32_t *)rh_alloc(sizeof(int32_t) * cap);
  memset(m->index, 0xff, sizeof(int32_t) * cap);
  for (uint32_t i = 0; i < m->count; i++) {
    uint32_t p = (uint32_t)(m->entries[i].hash & (cap - 1));
    while (m->index[p] != -1) p = (p + 1) & (cap - 1);
    m->index[p] = (int32_t)i;
  }
}

// Returns the entry slot, creating it if absent. *created reports which.
static inline rh_entry *rh_map_slot(rh_map *m, rh_str key, bool *created) {
  unsigned long h = rh_hash_str(key.ptr, key.len);
  uint32_t p = (uint32_t)(h & (m->index_cap - 1));
  while (m->index[p] != -1) {
    rh_entry *e = &m->entries[m->index[p]];
    if (e->hash == h && rh_str_eq(e->key, key)) {
      if (created) *created = false;
      return e;
    }
    p = (p + 1) & (m->index_cap - 1);
  }
  if (m->count == m->cap) {
    rh_entry *old = m->entries;
    m->cap *= 2;
    m->entries = (rh_entry *)rh_alloc(sizeof(rh_entry) * m->cap);
    memcpy(m->entries, old, sizeof(rh_entry) * m->count);
  }
  rh_entry *e = &m->entries[m->count];
  // Borrowed, not copied. Every rh_str in this runtime points at storage that
  // outlives the map -- the input document, a string literal, or the arena --
  // and rh_to_key already copies the one transient case, its own stack buffer
  // for rendered numbers. A caller that builds an rh_str over a local buffer
  // and inserts it must copy first.
  e->key = key;
  e->val = rh_undef;
  e->hash = h;
  m->index[p] = (int32_t)m->count;
  m->count++;
  if (m->count * 2 >= m->index_cap) rh_map_reindex(m, m->index_cap * 2);
  if (created) *created = true;
  return e;
}

static inline rh_val rh_map_get(rh_map *m, rh_str key) {
  unsigned long h = rh_hash_str(key.ptr, key.len);
  uint32_t p = (uint32_t)(h & (m->index_cap - 1));
  while (m->index[p] != -1) {
    rh_entry *e = &m->entries[m->index[p]];
    if (e->hash == h && rh_str_eq(e->key, key)) return e->val;
    p = (p + 1) & (m->index_cap - 1);
  }
  return rh_undef;
}

static inline void rh_map_set(rh_map *m, rh_str key, rh_val v) {
  rh_map_slot(m, key, NULL)->val = v;
}

static inline rh_val rh_singleton(rh_val x) {
  rh_map *m = rh_map_new();
  if (!rh_is_undef(x)) rh_map_set(m, rh_to_key(x), rh_bool(true));
  return rh_mapv(m);
}

// ----- generic get: obj[key] over maps and borrowed JSON -----

static inline rh_val rh_get(rh_val obj, rh_val key) {
  if (rh_is_undef(obj) || rh_is_undef(key)) return rh_undef;
  if (obj.tag == RH_MAP) return rh_map_get(obj.u.map, rh_to_key(key));
  if (obj.tag == RH_JSON) {
    yyjson_val *j = obj.u.json;
    if (yyjson_is_obj(j)) {
      rh_str k = rh_to_key(key);
      return rh_jsonv(yyjson_obj_getn(j, k.ptr, k.len));
    }
    if (yyjson_is_arr(j)) {
      double d = rh_num(key);
      if (isnan(d) || d < 0) return rh_undef;
      return rh_jsonv(yyjson_arr_get(j, (size_t)d));
    }
  }
  return rh_undef;
}

// rt.pure.singleton / mkset: a one-entry object keyed by the value
static inline rh_val rh_singleton(rh_val x);

// ----- iteration -----
//
// Mirrors JS `for (let k in obj)`: object keys in insertion order, array
// indices in order. Arrays yield an integer key, which rh_to_key renders as
// "0", "1", ... exactly as for-in does.

typedef struct {
  rh_val obj;
  uint32_t i, n;
  yyjson_obj_iter oit;
} rh_iter;

static inline rh_iter rh_iter_begin(rh_val v) {
  rh_iter it;
  memset(&it, 0, sizeof(it));
  it.obj = v;
  it.i = 0;
  it.n = 0;
  if (v.tag == RH_MAP) {
    it.n = v.u.map->count;
  } else if (v.tag == RH_JSON) {
    if (yyjson_is_obj(v.u.json)) {
      it.n = (uint32_t)yyjson_obj_size(v.u.json);
      yyjson_obj_iter_init(v.u.json, &it.oit);
    } else if (yyjson_is_arr(v.u.json)) {
      it.n = (uint32_t)yyjson_arr_size(v.u.json);
    }
  }
  return it;
}

static inline bool rh_iter_next(rh_iter *it, rh_val *key, rh_val *val) {
  if (it->i >= it->n) return false;
  if (it->obj.tag == RH_MAP) {
    rh_entry *e = &it->obj.u.map->entries[it->i];
    // a slot holding undefined is absent as far as iteration is concerned
    while (rh_is_undef(e->val)) {
      it->i++;
      if (it->i >= it->n) return false;
      e = &it->obj.u.map->entries[it->i];
    }
    *key = rh_strv(e->key.ptr, e->key.len);
    *val = e->val;
  } else if (yyjson_is_obj(it->obj.u.json)) {
    yyjson_val *k = yyjson_obj_iter_next(&it->oit);
    if (!k) return false;
    *key = rh_strv(yyjson_get_str(k), (uint32_t)yyjson_get_len(k));
    *val = rh_jsonv(yyjson_obj_iter_get_val(k));
  } else {
    *key = rh_i64(it->i);
    *val = rh_jsonv(yyjson_arr_get(it->obj.u.json, it->i));
  }
  it->i++;
  return true;
}

// ----- path slots (src/simple-runtime.js:453-486) -----
//
// rt.init / rt.update walk a path of keys, auto-vivifying an object at each
// level, and bail out if any key is undefined. The C form returns a pointer to
// the destination slot, or NULL when the walk bails.

static inline rh_val *rh_slot(rh_val *root, const rh_val *keys, int n) {
  rh_val *cur = root;
  for (int i = 0; i < n; i++) {
    if (rh_is_undef(keys[i])) return NULL;
    if (cur->tag != RH_MAP) {
      if (!rh_is_undef(*cur)) return NULL; // not an object: cannot descend
      *cur = rh_mapv(rh_map_new());
    }
    rh_entry *e = rh_map_slot(cur->u.map, rh_to_key(keys[i]), NULL);
    cur = &e->val;
  }
  return cur;
}

// ----- output: JSON.stringify -----

static inline void rh_print_val(rh_val v);

static inline void rh_print_str(rh_str s) {
  putchar('"');
  for (uint32_t i = 0; i < s.len; i++) {
    char ch = s.ptr[i];
    switch (ch) {
      case '"': fputs("\\\"", stdout); break;
      case '\\': fputs("\\\\", stdout); break;
      case '\n': fputs("\\n", stdout); break;
      case '\r': fputs("\\r", stdout); break;
      case '\t': fputs("\\t", stdout); break;
      default:
        if ((unsigned char)ch < 0x20) printf("\\u%04x", ch);
        else putchar(ch);
    }
  }
  putchar('"');
}

static inline void rh_print_map(rh_map *m) {
  // insertion order. JSON.stringify would put integer-like keys first in
  // ascending numeric order; not worth reproducing, since consumers parse the
  // output back into an object where key order does not matter.
  putchar('{');
  bool first = true;
  for (uint32_t i = 0; i < m->count; i++) {
    rh_entry *e = &m->entries[i];
    if (rh_is_undef(e->val)) continue; // JSON.stringify drops undefined values
    if (!first) putchar(',');
    first = false;
    rh_print_str(e->key);
    putchar(':');
    rh_print_val(e->val);
  }
  putchar('}');
}

static inline void rh_print_json(yyjson_val *j) {
  char *s = yyjson_val_write(j, 0, NULL);
  if (s) {
    fputs(s, stdout);
    free(s);
  } else {
    fputs("null", stdout);
  }
}

static inline void rh_print_val(rh_val v) {
  char buf[64];
  switch (v.tag) {
    case RH_UNDEF: fputs("undefined", stdout); break;
    case RH_BOOL: fputs(v.u.b ? "true" : "false", stdout); break;
    case RH_I64: printf("%lld", (long long)v.u.i64); break;
    case RH_F64:
      rh_fmt_double(buf, sizeof(buf), v.u.f64);
      fputs(buf, stdout);
      break;
    case RH_STR: rh_print_str(v.u.str); break;
    case RH_JSON: rh_print_json(v.u.json); break;
    case RH_MAP: rh_print_map(v.u.map); break;
    default: fputs("null", stdout);
  }
}

// ----- input -----

static inline yyjson_doc *rh_load_json(const char *path) {
  yyjson_read_err err;
  yyjson_doc *doc = yyjson_read_file(path, 0, NULL, &err);
  if (!doc) {
    fprintf(stderr, "rhyme: cannot read %s: %s\n", path, err.msg);
    exit(1);
  }
  return doc;
}

#endif // RHYME_RT_H
