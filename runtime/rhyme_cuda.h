// CUDA support for the c-new backend.
//
// Included in place of rhyme_rt.h when a query uses a device operation, so an
// ordinary build never sees a CUDA header.
//
// What lives here is the mechanical part -- moving a JSON array onto the
// device, allocating a result vector, printing one back -- and it is named for
// the device rather than for cuBLAS, because none of it is specific to that
// library. The library call itself is emitted into the generated program
// (src/cgen2/emit.js), where its buffers, sizes and strides stay visible; that
// is the part a reader of the generated C wants to see, and the part a later
// optimization pass would rewrite.
//
// The names that do say cublas are cuBLAS's own -- cublasSdot, the handle it
// takes, the status code RH_CUBLAS_CHECK tests -- and a second library would
// bring its own alongside them. RH_CUDA_CHECK, right below, is the same idea
// for a cudaError_t; they stay separate because the two report failures
// differently.
//
// ----- device vectors and device scalars -----
//
// A device vector is a pair: a device pointer and a length. A device scalar is
// a device pointer on its own -- one float, the result of a reduction. They are
// distinct kinds of value (src/cgen2/value.js), and the functions here reflect
// that: a vector's take a length, a scalar's do not.
//
// Neither needs a runtime struct, because the length is known at compile time
// -- the emitter carries it as a C expression, the same way v.cStr carries its
// length. So the generated program passes (float *dev, size_t n) or just
// (float *dev), and nothing is boxed.
//
// Elements are float, not double: cublasSdot is the single-precision kernel,
// and the type checker gives `dot` the result type f32 (src/typing.js:1092).

#ifndef RHYME_CUDA_H
#define RHYME_CUDA_H

#include <cuda_runtime.h>
#include <cublas_v2.h>

#include "rhyme_rt.h"

// Same failure policy as rh_load_json: say what went wrong and stop. A query
// that silently ran on garbage because a cudaMalloc failed is worse than one
// that did not run.
#define RH_CUDA_CHECK(call)                                              \
  do {                                                                   \
    cudaError_t rh_err_ = (call);                                        \
    if (rh_err_ != cudaSuccess) {                                        \
      fprintf(stderr, "rhyme: %s failed: %s\n", #call,                   \
              cudaGetErrorString(rh_err_));                              \
      exit(1);                                                           \
    }                                                                    \
  } while (0)

#define RH_CUBLAS_CHECK(call)                                            \
  do {                                                                   \
    cublasStatus_t rh_st_ = (call);                                      \
    if (rh_st_ != CUBLAS_STATUS_SUCCESS) {                               \
      fprintf(stderr, "rhyme: %s failed with cublas status %d\n", #call, \
              (int)rh_st_);                                               \
      exit(1);                                                           \
    }                                                                    \
  } while (0)

// The cuBLAS handle is a process-wide resource, so it is created once rather
// than threaded through the generated code. rh_cuda_begin/end bracket main and
// stand for the device session as a whole: a second library's handle would be
// set up in the same pair.
static cublasHandle_t rh_cublas_handle;

static inline void rh_cuda_begin(void) {
  RH_CUBLAS_CHECK(cublasCreate(&rh_cublas_handle));
  // Results land in device memory, so that the value a device operation
  // produces is another device vector and nothing has to round-trip through
  // the host between two of them. Set once: every cuBLAS call the backend
  // emits writes its result to a device pointer.
  RH_CUBLAS_CHECK(cublasSetPointerMode(rh_cublas_handle,
                                       CUBLAS_POINTER_MODE_DEVICE));
}

static inline void rh_cuda_end(void) {
  RH_CUBLAS_CHECK(cublasDestroy(rh_cublas_handle));
}

// A zeroed device vector. Zeroed because cuBLAS leaves a result untouched when
// a length is zero or negative, and reading back uninitialized device memory
// would make an empty input print garbage instead of 0.
static inline float *rh_cuda_alloc(size_t n) {
  float *dev = NULL;
  size_t bytes = (n ? n : 1) * sizeof(float);
  RH_CUDA_CHECK(cudaMalloc((void **)&dev, bytes));
  RH_CUDA_CHECK(cudaMemset(dev, 0, bytes));
  return dev;
}

// Copy a JSON array onto the device, and report its length. The host staging
// buffer is freed before returning; only the device pointer escapes.
//
// A non-array yields an empty vector, and an element that is not a number
// contributes 0 -- both are schema violations, and the backend only takes this
// path when the type checker has declared a dense vector of numbers.
static inline float *rh_cuda_from_json(yyjson_val *arr, size_t *n_out) {
  size_t n = yyjson_arr_size(arr);
  *n_out = n;

  float *host = (float *)malloc((n ? n : 1) * sizeof(float));
  if (!host) {
    fprintf(stderr, "rhyme: out of memory staging %zu floats\n", n);
    exit(1);
  }
  size_t i, max;
  yyjson_val *e;
  yyjson_arr_foreach(arr, i, max, e) host[i] = (float)yyjson_get_num(e);

  float *dev = rh_cuda_alloc(n);
  if (n)
    RH_CUDA_CHECK(cudaMemcpy(dev, host, n * sizeof(float),
                             cudaMemcpyHostToDevice));
  free(host);
  return dev;
}

// Read a device vector back. cudaMemcpy on the default stream is ordered after
// the cuBLAS calls that produced it, so this doubles as the synchronization
// point before the host looks at the values.
static inline void rh_cuda_to_host(const float *dev, float *host, size_t n) {
  if (n)
    RH_CUDA_CHECK(cudaMemcpy(host, (const void *)dev, n * sizeof(float),
                             cudaMemcpyDeviceToHost));
}

// The same for a device scalar, which needs no buffer. This is what the backend
// emits when a device result meets host code: four bytes back across the bus,
// and the value is an ordinary C float from there on.
static inline float rh_cuda_to_host_scalar(const float *dev) {
  float host = 0;
  rh_cuda_to_host(dev, &host, 1);
  return host;
}

// ----- output -----
//
// Both printers go through rh_fmt_double, so a device value prints the way
// every other number in this runtime does: %.17g, with nan and infinity
// rendered as null because JSON has no syntax for them. A float widened to
// double round-trips exactly, so no precision is invented here.

static inline void rh_cuda_print_vec(const float *dev, size_t n) {
  char buf[64];
  float *host = (float *)malloc((n ? n : 1) * sizeof(float));
  if (!host) {
    fprintf(stderr, "rhyme: out of memory reading back %zu floats\n", n);
    exit(1);
  }
  rh_cuda_to_host(dev, host, n);

  putchar('[');
  for (size_t i = 0; i < n; i++) {
    if (i) putchar(',');
    rh_fmt_double(buf, sizeof(buf), (double)host[i]);
    fputs(buf, stdout);
  }
  putchar(']');
  free(host);
}

// A one-element vector standing for a scalar -- what a reduction like `dot`
// produces. Printed without the brackets, because the query's type is f32.
static inline void rh_cuda_print_scalar(const float *dev) {
  char buf[64];
  rh_fmt_double(buf, sizeof(buf), (double)rh_cuda_to_host_scalar(dev));
  fputs(buf, stdout);
}

#endif // RHYME_CUDA_H
