// Rhyme C value runtime.
//
// Mirrors src/simple-runtime.js: the JS backend is the reference semantics, so
// every operation here is written to produce what its rt.pure.* / rt.stateful.*
// counterpart produces. Where the two could differ -- numeric coercion, number
// formatting, null -- this file follows JavaScript, because the test corpus
// compares output against the JS backend.
//
// Deliberate divergences from JS:
// - array indices are integer keys (0, 1, ...), not the strings "0", "1", ...
//   that for-in and Object.entries produce
// - objects keep plain insertion order; JS moves integer-like keys first
// - a path slot whose key is undefined is not created (JS writes the key
//   "undefined")
// - the sum reducer adds numerically; JS concatenates a numeric string onto
//   the running sum
//
// Values are a tagged union. Data read from an input document is BORROWED from
// the mmap'd yyjson document (tag RH_JSON), so loading stays zero-copy;
// computed values are native. Everything allocated here comes from a bump
// arena that is never freed until the process exits.

#ifndef RHYME_RT_H
#define RHYME_RT_H

#include <float.h>
#include <math.h>
#include <stdarg.h>
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
  RH_NULL, // JSON null: a present value, unlike undefined
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

// 16 bytes: a string's length sits in the padding after the tag, so the
// payload is a single word. Arrays and maps keep their count in the heap
// struct instead -- it changes as they grow, and every copy of the rh_val
// shares the pointer.
typedef struct {
  uint8_t tag;
  uint32_t len; // RH_STR: byte length
  union {
    bool b;
    int64_t i64;
    double f64;
    const char *str; // RH_STR
    yyjson_val *json;
    struct rh_arr *arr;
    struct rh_map *map;
  } u;
} rh_val;

_Static_assert(sizeof(rh_val) == 16, "rh_val should be two words");

static inline rh_str rh_val_str(rh_val v) {
  rh_str s = {v.u.str, v.len};
  return s;
}

static const rh_val rh_undef = {RH_UNDEF, 0, {0}};
static const rh_val rh_null = {RH_NULL, 0, {0}};

static inline bool rh_is_undef(rh_val v) { return v.tag == RH_UNDEF; }

static inline rh_val rh_bool(bool b) {
  rh_val v = {RH_BOOL, 0, {0}};
  v.u.b = b;
  return v;
}
static inline rh_val rh_i64(int64_t i) {
  rh_val v = {RH_I64, 0, {0}};
  v.u.i64 = i;
  return v;
}
static inline rh_val rh_f64(double d) {
  rh_val v = {RH_F64, 0, {0}};
  v.u.f64 = d;
  return v;
}
static inline rh_val rh_strv(const char *p, uint32_t n) {
  rh_val v = {RH_STR, n, {0}};
  v.u.str = p;
  return v;
}
static inline rh_val rh_jsonv(yyjson_val *j) {
  if (!j) return rh_undef;
  rh_val v = {RH_JSON, 0, {0}};
  v.u.json = j;
  return v;
}

// Project a borrowed JSON scalar into a native tag. Containers stay RH_JSON so
// that reading them remains zero-copy; only leaves are unwrapped.
static inline rh_val rh_unwrap(rh_val v) {
  if (v.tag != RH_JSON) return v;
  yyjson_val *j = v.u.json;
  switch (yyjson_get_type(j)) {
    case YYJSON_TYPE_NULL: return rh_null;
    case YYJSON_TYPE_BOOL: return rh_bool(yyjson_get_bool(j));
    case YYJSON_TYPE_NUM:
      if (yyjson_get_subtype(j) == YYJSON_SUBTYPE_REAL)
        return rh_f64(yyjson_get_real(j));
      if (yyjson_get_subtype(j) == YYJSON_SUBTYPE_UINT && yyjson_get_uint(j) > INT64_MAX)
        return rh_f64((double)yyjson_get_uint(j));
      return rh_i64(yyjson_get_sint(j));
    case YYJSON_TYPE_STR:
      return rh_strv(yyjson_get_str(j), (uint32_t)yyjson_get_len(j));
    default: return v; // arr / obj stay borrowed
  }
}

// null or undefined: what JS's `??` and `??=` test for
static inline bool rh_is_nullish(rh_val v) {
  return rh_is_undef(v) || rh_unwrap(v).tag == RH_NULL;
}

static inline bool rh_is_arr(rh_val v) {
  return v.tag == RH_ARR || (v.tag == RH_JSON && yyjson_is_arr(v.u.json));
}
static inline bool rh_is_obj(rh_val v) {
  return v.tag == RH_MAP || (v.tag == RH_JSON && yyjson_is_obj(v.u.json));
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
// the stack buffers numbers are rendered into.
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

// Decode the UTF-8 code point at s[i]; *len gets its byte length. Malformed
// bytes decode as themselves, one byte each.
static inline uint32_t rh_utf8_at(const char *s, uint32_t n, uint32_t i, uint32_t *len) {
  unsigned char c = (unsigned char)s[i];
  uint32_t l = c < 0x80 ? 1 : (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : (c >> 3) == 30 ? 4 : 1;
  if (i + l > n) l = 1;
  if (l == 1) { *len = 1; return c; }
  uint32_t cp = c & (0x7f >> l);
  for (uint32_t k = 1; k < l; k++) cp = (cp << 6) | ((unsigned char)s[i + k] & 0x3f);
  *len = l;
  return cp;
}

// The first UTF-16 code unit of a code point
static inline uint32_t rh_utf16_lead(uint32_t cp) {
  return cp >= 0x10000 ? 0xD800 + ((cp - 0x10000) >> 10) : cp;
}

// JS string comparison: by UTF-16 code units. UTF-8 byte order is code point
// order, which agrees except when a supplementary character (a surrogate pair
// in UTF-16) meets one in U+E000..U+FFFF, so only that case is decoded.
static inline int rh_str_cmp(rh_str a, rh_str b) {
  uint32_t n = a.len < b.len ? a.len : b.len;
  uint32_t i = 0;
  while (i < n && a.ptr[i] == b.ptr[i]) i++;
  if (i == n) return a.len == b.len ? 0 : (a.len < b.len ? -1 : 1);
  while (i > 0 && ((unsigned char)a.ptr[i] & 0xC0) == 0x80) i--; // back to char start
  uint32_t la, lb;
  uint32_t ca = rh_utf8_at(a.ptr, a.len, i, &la), cb = rh_utf8_at(b.ptr, b.len, i, &lb);
  uint32_t ua = rh_utf16_lead(ca), ub = rh_utf16_lead(cb);
  if (ua != ub) return ua < ub ? -1 : 1;
  return ca < cb ? -1 : 1;
}

// ----- number to string: JavaScript's Number.prototype.toString -----
//
// The shortest digit string that reads back as the same double, laid out by
// the ECMAScript rules: plain digits for exponents up to 21, 0.000ddd down to
// 1e-7, exponent notation otherwise. `out` needs 32 bytes.
static inline int rh_num_to_str(char *out, size_t cap, double d) {
  if (isnan(d)) return snprintf(out, cap, "NaN");
  if (isinf(d)) return snprintf(out, cap, d > 0 ? "Infinity" : "-Infinity");
  if (d == 0) return snprintf(out, cap, "0"); // also -0
  if (d == trunc(d) && fabs(d) < 9007199254740992.0)
    return snprintf(out, cap, "%lld", (long long)d);

  char tmp[40];
  for (int p = 1; p <= 17; p++) {
    snprintf(tmp, sizeof tmp, "%.*e", p - 1, d);
    if (strtod(tmp, NULL) == d) break;
  }
  // tmp is [-]d[.ddd]e[+-]xx
  const char *t = tmp;
  bool neg = *t == '-';
  if (neg) t++;
  char digits[24];
  int k = 0;
  for (; *t != 'e'; t++)
    if (*t != '.') digits[k++] = *t;
  while (k > 1 && digits[k - 1] == '0') k--;
  int n = atoi(t + 1) + 1; // value is 0.digits * 10^n

  char *o = out;
  if (neg) *o++ = '-';
  if (k <= n && n <= 21) {
    memcpy(o, digits, k); o += k;
    for (int i = k; i < n; i++) *o++ = '0';
  } else if (0 < n && n <= 21) {
    memcpy(o, digits, n); o += n;
    *o++ = '.';
    memcpy(o, digits + n, k - n); o += k - n;
  } else if (-6 < n && n <= 0) {
    *o++ = '0'; *o++ = '.';
    for (int i = 0; i < -n; i++) *o++ = '0';
    memcpy(o, digits, k); o += k;
  } else {
    *o++ = digits[0];
    if (k > 1) { *o++ = '.'; memcpy(o, digits + 1, k - 1); o += k - 1; }
    o += snprintf(o, cap - (size_t)(o - out), "e%c%d", n - 1 < 0 ? '-' : '+', abs(n - 1));
  }
  *o = 0;
  return (int)(o - out);
}

// As JSON.stringify writes a number: like toString, but NaN and infinity have
// no JSON syntax and come out as null.
static inline int rh_fmt_double(char *out, size_t cap, double d) {
  if (isnan(d) || isinf(d)) return snprintf(out, cap, "null");
  return rh_num_to_str(out, cap, d);
}

// ----- string conversion: JavaScript's String(x) -----
//
// Arrays render as their join, objects as "[object Object]". Built in an
// arena-backed buffer, since an array's rendering has no length bound.

typedef struct {
  char *p;
  uint32_t len, cap;
} rh_sb;

static inline void rh_sb_put(rh_sb *b, const char *s, uint32_t n) {
  if (b->len + n + 1 > b->cap) {
    uint32_t cap = b->cap ? b->cap * 2 : 64;
    while (cap < b->len + n + 1) cap *= 2;
    char *p = (char *)rh_alloc(cap);
    if (b->len) memcpy(p, b->p, b->len);
    b->p = p;
    b->cap = cap;
  }
  memcpy(b->p + b->len, s, n);
  b->len += n;
  b->p[b->len] = 0;
}

static inline void rh_sb_join(rh_sb *b, rh_val arr);

static inline void rh_sb_string(rh_sb *b, rh_val v) {
  v = rh_unwrap(v);
  char buf[40];
  switch (v.tag) {
    case RH_UNDEF: rh_sb_put(b, "undefined", 9); break;
    case RH_NULL: rh_sb_put(b, "null", 4); break;
    case RH_BOOL: v.u.b ? rh_sb_put(b, "true", 4) : rh_sb_put(b, "false", 5); break;
    case RH_I64: rh_sb_put(b, buf, (uint32_t)snprintf(buf, sizeof buf, "%lld", (long long)v.u.i64)); break;
    case RH_F64: rh_sb_put(b, buf, (uint32_t)rh_num_to_str(buf, sizeof buf, v.u.f64)); break;
    case RH_STR: rh_sb_put(b, v.u.str, v.len); break;
    default:
      if (rh_is_arr(v)) rh_sb_join(b, v);
      else rh_sb_put(b, "[object Object]", 15);
  }
}

static inline rh_str rh_to_string(rh_val v) {
  v = rh_unwrap(v);
  switch (v.tag) {
    case RH_STR: return rh_val_str(v);
    case RH_UNDEF: return rh_str_lit("undefined", 9);
    case RH_NULL: return rh_str_lit("null", 4);
    case RH_BOOL: return rh_str_lit(v.u.b ? "true" : "false", v.u.b ? 4 : 5);
    default: {
      rh_sb b = {0};
      rh_sb_string(&b, v);
      if (!b.p) return rh_str_lit("", 0);
      return rh_str_lit(b.p, b.len);
    }
  }
}

// The string JS would use for an object key -- the same as String(x)
static inline rh_str rh_to_key(rh_val v) { return rh_to_string(v); }

// ----- numeric coercion: JavaScript's Number(x) -----

// Byte length of the JS whitespace or line terminator starting at s[i], or 0.
// Covers the full StrWhiteSpaceChar set, multibyte ones included.
static inline uint32_t rh_ws_at(const char *s, uint32_t n, uint32_t i) {
  unsigned char c = (unsigned char)s[i];
  if (c == ' ' || (c >= 0x09 && c <= 0x0d)) return 1;
  if (c < 0x80) return 0;
  uint32_t l, cp = rh_utf8_at(s, n, i, &l);
  if (cp == 0xA0 || cp == 0x1680 || (cp >= 0x2000 && cp <= 0x200A) || cp == 0x2028 ||
      cp == 0x2029 || cp == 0x202F || cp == 0x205F || cp == 0x3000 || cp == 0xFEFF)
    return l;
  return 0;
}

static inline double rh_parse_num(const char *s, uint32_t n) {
  uint32_t i = 0, l;
  while (i < n && (l = rh_ws_at(s, n, i))) i += l;
  // trailing whitespace: step back to each char start and test it
  while (n > i) {
    uint32_t j = n - 1;
    while (j > i && ((unsigned char)s[j] & 0xC0) == 0x80) j--;
    if (rh_ws_at(s, n, j) != n - j) break;
    n = j;
  }
  s += i;
  n -= i;
  if (n == 0) return 0.0;

  if (n == 8 && !memcmp(s, "Infinity", 8)) return INFINITY;
  if (n == 9 && !memcmp(s, "+Infinity", 9)) return INFINITY;
  if (n == 9 && !memcmp(s, "-Infinity", 9)) return -INFINITY;

  // 0x / 0o / 0b integers, unsigned only
  if (n > 2 && s[0] == '0') {
    int base = (s[1] | 0x20) == 'x' ? 16 : (s[1] | 0x20) == 'o' ? 8 : (s[1] | 0x20) == 'b' ? 2 : 0;
    if (base) {
      double d = 0;
      for (uint32_t k = 2; k < n; k++) {
        int c = (unsigned char)s[k], v;
        if (c >= '0' && c <= '9') v = c - '0';
        else if ((c | 0x20) >= 'a' && (c | 0x20) <= 'f') v = (c | 0x20) - 'a' + 10;
        else return NAN;
        if (v >= base) return NAN;
        d = d * base + v;
      }
      return d;
    }
  }

  // decimal: [+-] (ddd[.ddd] | .ddd) [e[+-]ddd], checked here so that strtod's
  // extras (hex floats, "inf", "nan") are not accepted
  uint32_t k = 0, digits = 0;
  if (s[k] == '+' || s[k] == '-') k++;
  while (k < n && s[k] >= '0' && s[k] <= '9') k++, digits++;
  if (k < n && s[k] == '.') {
    k++;
    while (k < n && s[k] >= '0' && s[k] <= '9') k++, digits++;
  }
  if (!digits) return NAN;
  if (k < n && (s[k] | 0x20) == 'e') {
    k++;
    if (k < n && (s[k] == '+' || s[k] == '-')) k++;
    uint32_t e = k;
    while (k < n && s[k] >= '0' && s[k] <= '9') k++;
    if (k == e) return NAN;
  }
  if (k != n) return NAN;

  char buf[64];
  char *z = n < sizeof buf ? buf : (char *)rh_alloc(n + 1);
  memcpy(z, s, n);
  z[n] = 0;
  return strtod(z, NULL);
}

static inline double rh_num(rh_val v) {
  v = rh_unwrap(v);
  switch (v.tag) {
    case RH_NULL: return 0.0;
    case RH_BOOL: return v.u.b ? 1.0 : 0.0;
    case RH_I64: return (double)v.u.i64;
    case RH_F64: return v.u.f64;
    case RH_STR: return rh_parse_num(v.u.str, v.len);
    case RH_UNDEF: return NAN;
    default: {
      // objects and arrays go through their string form: Number([5]) is 5
      rh_str s = rh_to_string(v);
      return rh_parse_num(s.ptr, s.len);
    }
  }
}

// ----- pure operations (src/simple-runtime.js:75-257) -----
//
// Comparisons return true or undefined -- never false. That is the filtering
// semantics the language relies on, not an oversight.

#define RH_UNDEF_IF_MISSING2(a, b) \
  if (rh_is_undef(a) || rh_is_undef(b)) return rh_undef;

// JS ===: type-strict, numbers by value, strings by content, objects and
// arrays by identity. A borrowed JSON container is the same object exactly
// when it is the same node.
static inline bool rh_strict_eq(rh_val a, rh_val b) {
  a = rh_unwrap(a);
  b = rh_unwrap(b);
  bool an = a.tag == RH_I64 || a.tag == RH_F64, bn = b.tag == RH_I64 || b.tag == RH_F64;
  if (an || bn) return an && bn && rh_num(a) == rh_num(b);
  if (a.tag != b.tag) return false;
  switch (a.tag) {
    case RH_UNDEF:
    case RH_NULL: return true;
    case RH_BOOL: return a.u.b == b.u.b;
    case RH_STR: return rh_str_eq(rh_val_str(a), rh_val_str(b));
    case RH_JSON: return a.u.json == b.u.json;
    case RH_ARR: return a.u.arr == b.u.arr;
    case RH_MAP: return a.u.map == b.u.map;
    default: return false;
  }
}

static inline rh_val rh_pure_equal(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  return rh_strict_eq(a, b) ? rh_bool(true) : rh_undef;
}
static inline rh_val rh_pure_notEqual(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  return !rh_strict_eq(a, b) ? rh_bool(true) : rh_undef;
}

// JS relational operators: objects and arrays first become their string form;
// then two strings compare lexicographically and anything else numerically.
static inline int rh_cmp(rh_val a, rh_val b) {
  a = rh_unwrap(a);
  b = rh_unwrap(b);
  if (rh_is_arr(a) || rh_is_obj(a)) { rh_str s = rh_to_string(a); a = rh_strv(s.ptr, s.len); }
  if (rh_is_arr(b) || rh_is_obj(b)) { rh_str s = rh_to_string(b); b = rh_strv(s.ptr, s.len); }
  if (a.tag == RH_STR && b.tag == RH_STR) return rh_str_cmp(rh_val_str(a), rh_val_str(b));
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

// String(x1) + String(x2)
static inline rh_val rh_pure_concat(rh_val a, rh_val b) {
  RH_UNDEF_IF_MISSING2(a, b)
  rh_str x = rh_to_string(a), y = rh_to_string(b);
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

// ----- conversions -----

// JS ToUint32: truncate, then wrap modulo 2^32; NaN and infinity are 0. The
// bitwise operators the js converts are written with all start from this.
static inline uint32_t rh_to_uint32(double d) {
  if (!isfinite(d)) return 0;
  double m = fmod(trunc(d), 4294967296.0);
  if (m < 0) m += 4294967296.0;
  return (uint32_t)m;
}

// Number(x) & 0xff, & 0xffff, >>> 0, | 0
static inline rh_val rh_pure_convert_u8(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  return rh_i64(rh_to_uint32(rh_num(v)) & 0xff);
}
static inline rh_val rh_pure_convert_u16(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  return rh_i64(rh_to_uint32(rh_num(v)) & 0xffff);
}
static inline rh_val rh_pure_convert_u32(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  return rh_i64(rh_to_uint32(rh_num(v)));
}
static inline rh_val rh_pure_convert_i32(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  return rh_i64((int32_t)rh_to_uint32(rh_num(v)));
}
// ((Number(x) + 0x80) & 0xff) - 0x80: the offset is added before truncating,
// so -1.5 becomes -2, not -1
static inline rh_val rh_pure_convert_i8(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  return rh_i64((int64_t)(rh_to_uint32(rh_num(v) + 0x80) & 0xff) - 0x80);
}
static inline rh_val rh_pure_convert_i16(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  return rh_i64((int64_t)(rh_to_uint32(rh_num(v) + 0x8000) & 0xffff) - 0x8000);
}

// BigInt(x), wrapped to 64 bits. BigInt throws on a non-integer, NaN, null or
// an object; those come out undefined here. Returns false for them.
static inline bool rh_to_uint64(rh_val v, uint64_t *out) {
  v = rh_unwrap(v);
  if (v.tag == RH_I64) { *out = (uint64_t)v.u.i64; return true; }
  if (v.tag != RH_F64 && v.tag != RH_BOOL && v.tag != RH_STR) return false;
  double d = rh_num(v);
  if (!isfinite(d) || d != trunc(d)) return false;
  if (d >= -9223372036854775808.0 && d < 9223372036854775808.0) {
    *out = (uint64_t)(int64_t)d;
    return true;
  }
  // |d| >= 2^63, so d is a multiple of 2^11 and the wrap is exact
  double m = fmod(d, 18446744073709551616.0);
  if (m < 0) m += 18446744073709551616.0;
  *out = (uint64_t)m;
  return true;
}
static inline rh_val rh_pure_convert_i64(rh_val v) {
  uint64_t u;
  if (rh_is_undef(v) || !rh_to_uint64(v, &u)) return rh_undef;
  return rh_i64((int64_t)u);
}
// A result above INT64_MAX does not fit the i64 tag and falls back to a
// double, which rounds it.
static inline rh_val rh_pure_convert_u64(rh_val v) {
  uint64_t u;
  if (rh_is_undef(v) || !rh_to_uint64(v, &u)) return rh_undef;
  return u > INT64_MAX ? rh_f64((double)u) : rh_i64((int64_t)u);
}

static inline rh_val rh_pure_convert_f64(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  return rh_f64(rh_num(v));
}
// Math.fround. A double beyond float range is undefined behaviour to cast, so
// the overflow is handled first: from FLT_MAX plus half an ulp (2^128 - 2^103,
// where round-half-even goes up) it is infinity, below that FLT_MAX.
static inline double rh_fround(double d) {
  if (!isfinite(d)) return d;
  double a = fabs(d);
  if (a >= 340282356779733661637539395458142568448.0) return copysign(INFINITY, d);
  if (a > FLT_MAX) return copysign(FLT_MAX, d);
  return (float)d;
}
static inline rh_val rh_pure_convert_f32(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  return rh_f64(rh_fround(rh_num(v)));
}
static inline rh_val rh_pure_convert_string(rh_val v) {
  if (rh_is_undef(v)) return rh_undef;
  rh_str s = rh_to_string(v);
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
  rh_val v = {RH_MAP, 0, {0}};
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
  // and rh_to_key builds rendered numbers in the arena. A caller that builds an rh_str over a local buffer
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

// ----- arrays -----
//
// Backs the `array` stateful op. Arena-allocated and grown by
// doubling; like everything else here it is never freed.

typedef struct rh_arr {
  rh_val *items;
  uint32_t count, cap;
} rh_arr;

static inline rh_val rh_arrv(rh_arr *a) {
  rh_val v = {RH_ARR, 0, {0}};
  v.u.arr = a;
  return v;
}

static inline rh_arr *rh_arr_new(void) {
  rh_arr *a = (rh_arr *)rh_alloc(sizeof(rh_arr));
  a->cap = 8;
  a->count = 0;
  a->items = (rh_val *)rh_alloc(sizeof(rh_val) * a->cap);
  return a;
}

static inline void rh_arr_push(rh_arr *a, rh_val x) {
  if (a->count == a->cap) {
    rh_val *old = a->items;
    a->cap *= 2;
    a->items = (rh_val *)rh_alloc(sizeof(rh_val) * a->cap);
    memcpy(a->items, old, sizeof(rh_val) * a->count);
  }
  a->items[a->count++] = x;
}

// rt.stateful.array: append, skipping undefined
static inline rh_val rh_stateful_array_init(void) { return rh_arrv(rh_arr_new()); }
static inline rh_val rh_stateful_array(rh_val s, rh_val x) {
  if (rh_is_undef(x)) return s;
  if (s.tag != RH_ARR) s = rh_stateful_array_init();
  rh_arr_push(s.u.arr, x);
  return s;
}

// ----- array rendering -----

// Array.prototype.join with ",": null and undefined elements render empty,
// everything else as String(x) -- nested arrays recursively.
static inline void rh_sb_join(rh_sb *b, rh_val x) {
  if (x.tag == RH_ARR) {
    for (uint32_t i = 0; i < x.u.arr->count; i++) {
      if (i) rh_sb_put(b, ",", 1);
      if (!rh_is_nullish(x.u.arr->items[i])) rh_sb_string(b, x.u.arr->items[i]);
    }
    return;
  }
  size_t idx, max;
  yyjson_val *it;
  yyjson_arr_foreach(x.u.json, idx, max, it) {
    if (idx) rh_sb_put(b, ",", 1);
    if (!yyjson_is_null(it)) rh_sb_string(b, rh_jsonv(it));
  }
}

// rt.pure.join: x1.join(). A non-array has no join method -- js throws, here
// it is undefined.
static inline rh_val rh_pure_join(rh_val x) {
  if (!rh_is_arr(x)) return rh_undef;
  rh_sb b = {0};
  rh_sb_join(&b, x);
  if (!b.p) return rh_strv("", 0);
  return rh_strv(b.p, b.len);
}

// rt.pure.flatten: the js definition takes a rest parameter and flattens the
// resulting array one level, so an array argument is spliced in and anything
// else -- including undefined -- is appended as it stands. Being variadic, it
// takes the argument count up front.
static inline rh_val rh_pure_flatten(int n, ...) {
  rh_arr *out = rh_arr_new();
  va_list ap;
  va_start(ap, n);
  for (int i = 0; i < n; i++) {
    rh_val a = va_arg(ap, rh_val);
    if (a.tag == RH_ARR) {
      for (uint32_t j = 0; j < a.u.arr->count; j++) rh_arr_push(out, a.u.arr->items[j]);
    } else if (a.tag == RH_JSON && yyjson_is_arr(a.u.json)) {
      size_t idx, max;
      yyjson_val *it;
      yyjson_arr_foreach(a.u.json, idx, max, it) rh_arr_push(out, rh_jsonv(it));
    } else {
      rh_arr_push(out, a);
    }
  }
  va_end(ap);
  return rh_arrv(out);
}

// ----- object construction -----

// rt.uniqueMutableCopy: {...x0}, a shallow copy, used by rt.stateful.update_init.
//
// The copy is the point, not an optimization detail. One source can seed
// several slots -- `{*A.key: {*B.key: ...}}` initializes tmp[K4][K5] from the
// same tmp3[K4] for every K5 -- and without it they would all share one map,
// so a later update to one would be visible through all of them.
//
// update_init copies whatever has typeof "object": a map, a borrowed JSON
// object (materialized, since the copy has to be mutable), an array (spread
// into index keys "0", "1", ...) and null (spread into {}). Anything else
// comes back unchanged, matching update_init's own `return x0`.
static inline rh_val rh_map_copy(rh_val v) {
  if (v.tag == RH_MAP) {
    rh_map *src = v.u.map;
    rh_map *m = rh_map_new();
    for (uint32_t i = 0; i < src->count; i++)
      rh_map_set(m, src->entries[i].key, src->entries[i].val);
    return rh_mapv(m);
  }
  if (v.tag == RH_JSON && yyjson_is_obj(v.u.json)) {
    rh_map *m = rh_map_new();
    yyjson_obj_iter it;
    yyjson_obj_iter_init(v.u.json, &it);
    yyjson_val *k;
    while ((k = yyjson_obj_iter_next(&it)))
      rh_map_set(m, rh_str_lit(yyjson_get_str(k), (uint32_t)yyjson_get_len(k)),
                 rh_jsonv(yyjson_obj_iter_get_val(k)));
    return rh_mapv(m);
  }
  if (v.tag == RH_ARR) {
    rh_map *m = rh_map_new();
    for (uint32_t i = 0; i < v.u.arr->count; i++)
      rh_map_set(m, rh_to_key(rh_i64(i)), v.u.arr->items[i]);
    return rh_mapv(m);
  }
  if (v.tag == RH_JSON && yyjson_is_arr(v.u.json)) {
    rh_map *m = rh_map_new();
    size_t idx, max;
    yyjson_val *it;
    yyjson_arr_foreach(v.u.json, idx, max, it)
      rh_map_set(m, rh_to_key(rh_i64((int64_t)idx)), rh_jsonv(it));
    return rh_mapv(m);
  }
  if (!rh_is_undef(v) && rh_unwrap(v).tag == RH_NULL) return rh_mapv(rh_map_new());
  return v;
}

// rt.pure.singleton / mkset: a one-entry object keyed by the value
static inline rh_val rh_singleton(rh_val x) {
  rh_map *m = rh_map_new();
  if (!rh_is_undef(x)) rh_map_set(m, rh_to_key(x), rh_bool(true));
  return rh_mapv(m);
}

// ----- generic get: obj[key] over maps, arrays, strings and borrowed JSON -----

// An array index the way JS recognizes one: a non-negative integer, or a
// string spelling one canonically ("3", not "03", "3.0" or "+3"). Anything
// else names a property no array has.
static inline bool rh_index(rh_val key, uint32_t *out) {
  key = rh_unwrap(key);
  double d;
  if (key.tag == RH_I64) {
    if (key.u.i64 < 0 || key.u.i64 >= 4294967295LL) return false;
    *out = (uint32_t)key.u.i64;
    return true;
  }
  if (key.tag == RH_F64) {
    d = key.u.f64;
  } else if (key.tag == RH_STR) {
    rh_str s = rh_val_str(key);
    if (s.len == 0 || s.len > 10 || (s.len > 1 && s.ptr[0] == '0')) return false;
    d = 0;
    for (uint32_t i = 0; i < s.len; i++) {
      if (s.ptr[i] < '0' || s.ptr[i] > '9') return false;
      d = d * 10 + (s.ptr[i] - '0');
    }
  } else {
    return false;
  }
  if (!(d >= 0 && d < 4294967295.0 && d == trunc(d))) return false;
  *out = (uint32_t)d;
  return true;
}

// The character at UTF-16 index i, as JS's s[i] reads it. Divergence: an index
// landing on half of a surrogate pair is undefined here, since a lone
// surrogate has no UTF-8 encoding.
static inline rh_val rh_str_index(rh_str s, uint32_t i) {
  uint32_t pos = 0, unit = 0, l;
  while (pos < s.len) {
    uint32_t cp = rh_utf8_at(s.ptr, s.len, pos, &l);
    uint32_t units = cp >= 0x10000 ? 2 : 1;
    if (unit == i) return units == 1 ? rh_strv(s.ptr + pos, l) : rh_undef;
    if (unit + units > i) return rh_undef;
    unit += units;
    pos += l;
  }
  return rh_undef;
}

static inline rh_val rh_get(rh_val obj, rh_val key) {
  if (rh_is_undef(obj) || rh_is_undef(key)) return rh_undef;
  uint32_t i;
  if (obj.tag == RH_MAP) return rh_map_get(obj.u.map, rh_to_key(key));
  if (obj.tag == RH_ARR) {
    if (!rh_index(key, &i) || i >= obj.u.arr->count) return rh_undef;
    return obj.u.arr->items[i];
  }
  if (obj.tag == RH_JSON) {
    yyjson_val *j = obj.u.json;
    if (yyjson_is_obj(j)) {
      rh_str k = rh_to_key(key);
      return rh_jsonv(yyjson_obj_getn(j, k.ptr, k.len));
    }
    if (yyjson_is_arr(j)) {
      if (!rh_index(key, &i)) return rh_undef;
      return rh_jsonv(yyjson_arr_get(j, i));
    }
    if (yyjson_is_str(j)) obj = rh_unwrap(obj);
  }
  if (obj.tag == RH_STR) {
    if (!rh_index(key, &i)) return rh_undef;
    return rh_str_index(rh_val_str(obj), i);
  }
  return rh_undef;
}

// ----- iteration -----
//
// Mirrors JS `for (let k in obj)`: object keys in insertion order, array and
// string indices in order. Indices are integer keys (rh_i64), a deliberate
// divergence from for-in's strings; rh_to_key still renders them as "0",
// "1", ... wherever they become object keys. Both array representations
// iterate -- a borrowed JSON array and an rh_arr built by the `array`
// stateful op.

// A borrowed JSON container is walked with yyjson's own cursor, never by
// position: yyjson_arr_get is linear whenever the array is not flat -- and an
// array of objects, which is the usual input shape, is not flat -- so indexing
// each step in turn would make a single loop quadratic.
typedef struct {
  rh_val obj;
  uint32_t i, n;
  uint32_t pos; // strings: byte offset of the next character
  union {
    yyjson_obj_iter obj_it;
    yyjson_arr_iter arr_it;
  } jit;
} rh_iter;

static inline rh_iter rh_iter_begin(rh_val v) {
  rh_iter it;
  memset(&it, 0, sizeof(it));
  if (v.tag == RH_JSON && yyjson_is_str(v.u.json)) v = rh_unwrap(v);
  it.obj = v;
  if (v.tag == RH_MAP) {
    it.n = v.u.map->count;
  } else if (v.tag == RH_ARR) {
    it.n = v.u.arr->count;
  } else if (v.tag == RH_STR) {
    it.n = v.len;
  } else if (v.tag == RH_JSON) {
    if (yyjson_is_obj(v.u.json)) {
      it.n = (uint32_t)yyjson_obj_size(v.u.json);
      yyjson_obj_iter_init(v.u.json, &it.jit.obj_it);
    } else if (yyjson_is_arr(v.u.json)) {
      it.n = (uint32_t)yyjson_arr_size(v.u.json);
      yyjson_arr_iter_init(v.u.json, &it.jit.arr_it);
    }
  }
  return it;
}

static inline bool rh_iter_next(rh_iter *it, rh_val *key, rh_val *val) {
  if (it->obj.tag == RH_STR) {
    // one entry per character, keyed by its UTF-16 index. Divergence: JS
    // yields a supplementary character as two lone surrogates; here it is one
    // entry and the next index is skipped.
    rh_str s = rh_val_str(it->obj);
    if (it->pos >= s.len) return false;
    uint32_t l, cp = rh_utf8_at(s.ptr, s.len, it->pos, &l);
    *key = rh_i64(it->i);
    *val = rh_strv(s.ptr + it->pos, l);
    it->pos += l;
    it->i += cp >= 0x10000 ? 2 : 1;
    return true;
  }
  if (it->i >= it->n) return false;
  if (it->obj.tag == RH_MAP) {
    // a slot holding undefined is still a key, as in JS
    rh_entry *e = &it->obj.u.map->entries[it->i];
    *key = rh_strv(e->key.ptr, e->key.len);
    *val = e->val;
  } else if (it->obj.tag == RH_ARR) {
    *key = rh_i64(it->i);
    *val = it->obj.u.arr->items[it->i];
  } else if (yyjson_is_obj(it->obj.u.json)) {
    yyjson_val *k = yyjson_obj_iter_next(&it->jit.obj_it);
    if (!k) return false;
    *key = rh_strv(yyjson_get_str(k), (uint32_t)yyjson_get_len(k));
    *val = rh_jsonv(yyjson_obj_iter_get_val(k));
  } else {
    yyjson_val *e = yyjson_arr_iter_next(&it->jit.arr_it);
    if (!e) return false;
    *key = rh_i64(it->i);
    *val = rh_jsonv(e);
  }
  it->i++;
  return true;
}

// ----- path slots (src/simple-runtime.js:453-486) -----
//
// rt.init / rt.update walk a path of keys, auto-vivifying an object at each
// level, and bail out if any key is undefined. The C form returns a pointer to
// the destination slot, or NULL when the walk bails.
//
// Like JS's `obj[ix] ??= {}`, a level holding null is replaced by a fresh
// object. rt.init's `obj[ix] ??= init()` on the final slot is the caller's:
// `if (rh_is_nullish(*p)) *p = init;`.

static inline rh_val *rh_slot(rh_val *root, const rh_val *keys, int n) {
  rh_val *cur = root;
  for (int i = 0; i < n; i++) {
    if (rh_is_undef(keys[i])) return NULL;
    if (cur->tag != RH_MAP) {
      if (!rh_is_nullish(*cur)) return NULL; // not an object: cannot descend
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
      case '\b': fputs("\\b", stdout); break;
      case '\f': fputs("\\f", stdout); break;
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
  // insertion order; see the divergences at the top of the file
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

// Walked here rather than handed to yyjson_val_write, so that borrowed numbers
// and strings print exactly as computed ones do -- yyjson writes a real 3.0 as
// "3.0", JSON.stringify as "3".
static inline void rh_print_json(yyjson_val *j) {
  if (yyjson_is_obj(j)) {
    putchar('{');
    yyjson_obj_iter it;
    yyjson_obj_iter_init(j, &it);
    yyjson_val *k;
    bool first = true;
    while ((k = yyjson_obj_iter_next(&it))) {
      if (!first) putchar(',');
      first = false;
      rh_print_str(rh_str_lit(yyjson_get_str(k), (uint32_t)yyjson_get_len(k)));
      putchar(':');
      rh_print_json(yyjson_obj_iter_get_val(k));
    }
    putchar('}');
  } else if (yyjson_is_arr(j)) {
    putchar('[');
    size_t idx, max;
    yyjson_val *e;
    yyjson_arr_foreach(j, idx, max, e) {
      if (idx) putchar(',');
      rh_print_json(e);
    }
    putchar(']');
  } else {
    rh_print_val(rh_unwrap(rh_jsonv(j)));
  }
}

static inline void rh_print_val(rh_val v) {
  char buf[40];
  switch (v.tag) {
    case RH_UNDEF: fputs("undefined", stdout); break;
    case RH_NULL: fputs("null", stdout); break;
    case RH_BOOL: fputs(v.u.b ? "true" : "false", stdout); break;
    case RH_I64: printf("%lld", (long long)v.u.i64); break;
    case RH_F64:
      rh_fmt_double(buf, sizeof(buf), v.u.f64);
      fputs(buf, stdout);
      break;
    case RH_STR: rh_print_str(rh_val_str(v)); break;
    case RH_JSON: rh_print_json(v.u.json); break;
    case RH_MAP: rh_print_map(v.u.map); break;
    case RH_ARR: {
      putchar('[');
      for (uint32_t i = 0; i < v.u.arr->count; i++) {
        if (i) putchar(',');
        // JSON.stringify has no undefined, and writes null in an array
        if (rh_is_undef(v.u.arr->items[i])) fputs("null", stdout);
        else rh_print_val(v.u.arr->items[i]);
      }
      putchar(']');
      break;
    }
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
