// Unit tests for runtime/rhyme_cuda.h, in the same style as
// rhyme_rt_test.c: a standalone program, run by hand.
//
//   nvcc test/cgen/rhyme_cuda_test.c -Iruntime -Ithird-party/yyjson
//        third-party/yyjson/yyjson.c -lcublas -o /tmp/rhyme_cublas_test
//
// The device transfers and the printers are what the generated program relies
// on and what a query cannot easily cover: `dot` always produces a one-element
// vector, so the general vector printer has no other exercise.

#include <unistd.h>
#include "rhyme_cuda.h"

static int fails = 0;

// Capture what a printer writes to stdout, as rhyme_rt_test.c does.
static void ck_out(const char *what, void (*body)(void *), void *arg,
                   const char *want) {
  char buf[512];
  fflush(stdout);
  FILE *f = tmpfile();
  int saved = dup(1);
  dup2(fileno(f), 1);
  body(arg);
  fflush(stdout);
  dup2(saved, 1);
  close(saved);
  rewind(f);
  size_t n = fread(buf, 1, sizeof(buf) - 1, f);
  buf[n] = 0;
  fclose(f);
  if (strcmp(buf, want) != 0) {
    printf("FAIL: %s -> got %s want %s\n", what, buf, want);
    fails++;
  }
}

typedef struct { const float *dev; size_t n; } vec;
static void print_vec(void *p) { vec *v = (vec *)p; rh_cuda_print_vec(v->dev, v->n); }
static void print_scalar(void *p) { rh_cuda_print_scalar(((vec *)p)->dev); }

static float *device_of(const float *host, size_t n) {
  float *dev = rh_cuda_alloc(n);
  RH_CUDA_CHECK(cudaMemcpy(dev, host, n * sizeof(float), cudaMemcpyHostToDevice));
  return dev;
}

int main(void) {
  rh_cuda_begin();

  // ----- transfers -----

  yyjson_doc *doc = yyjson_read("[1, 2, 3.5]", 11, 0);
  size_t n = 0;
  float *dev = rh_cuda_from_json(yyjson_doc_get_root(doc), &n);
  if (n != 3) { printf("FAIL: from_json length -> %zu want 3\n", n); fails++; }
  { vec v = {dev, n}; ck_out("from_json", print_vec, &v, "[1,2,3.5]"); }

  // a non-array is an empty vector rather than a crash
  yyjson_doc *scalarDoc = yyjson_read("7", 1, 0);
  size_t n0 = 99;
  float *dev0 = rh_cuda_from_json(yyjson_doc_get_root(scalarDoc), &n0);
  if (n0 != 0) { printf("FAIL: from_json non-array -> %zu want 0\n", n0); fails++; }
  { vec v = {dev0, 0}; ck_out("empty vector", print_vec, &v, "[]"); }

  // a fresh vector reads back as zeros, so an untouched cuBLAS result prints 0
  // rather than whatever was in device memory
  { vec v = {rh_cuda_alloc(2), 2}; ck_out("alloc is zeroed", print_vec, &v, "[0,0]"); }

  // ----- printers -----

  float one[] = {10};
  { vec v = {device_of(one, 1), 1}; ck_out("scalar", print_scalar, &v, "10"); }

  // the read-back the backend emits when a device result meets host code
  {
    float back = rh_cuda_to_host_scalar(device_of(one, 1));
    if (back != 10) { printf("FAIL: to_host_scalar -> %g want 10\n", back); fails++; }
  }
  { vec v = {device_of(one, 1), 1}; ck_out("one-element vector", print_vec, &v, "[10]"); }

  float neg[] = {-1.5f, 0, 2};
  { vec v = {device_of(neg, 3), 3}; ck_out("negatives", print_vec, &v, "[-1.5,0,2]"); }

  // JSON has no nan or infinity; both print as null, as in rh_fmt_double
  float inf[] = {(float)INFINITY};
  { vec v = {device_of(inf, 1), 1}; ck_out("infinity", print_scalar, &v, "null"); }

  // ----- the call the backend emits -----

  float a[] = {1, 2, 3}, b[] = {2, 1, 2};
  float *da = device_of(a, 3), *db = device_of(b, 3);
  float *res = rh_cuda_alloc(1);
  RH_CUBLAS_CHECK(cublasSdot(rh_cublas_handle, 3, da, 1, db, 1, res));
  { vec v = {res, 1}; ck_out("cublasSdot", print_scalar, &v, "10"); }

  rh_cuda_end();

  if (fails == 0) printf("all ok\n");
  return fails != 0;
}
