#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <math.h>

// #if (__clang__)
// #warning Compiling with LLVM/CLANG. For best results, use GCC.
// #endif

#ifndef MAP_FILE
#define MAP_FILE MAP_SHARED
#endif

// comparator prototype
typedef int (*__compar_fn_t)(const void *, const void *);

// helper functions
long fsize(int fd) {
  struct stat stat;
  int res = fstat(fd,&stat);
  return stat.st_size;
}

/*****************************************
 * Emitting Generated Code
 * *******************************************/
#include <sys/time.h>
#include <stdlib.h>
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

/*********** Datastructures ***********/
struct Anon689356909 {
int64_t l_extendedprice_119timesl_discount_120_cnt;
double l_extendedprice_119timesl_discount_120_sum;
};

/**************** Main ****************/
int32_t main(int32_t x0, char** x1) {
int32_t x2 = 0;
int32_t x3 = open("/home/ran/projects/tpch-dbgen/SF1/lineitem.tbl", 0);
int64_t x4 = fsize(x3);
char* x5 = (char*)mmap(0, x4, PROT_READ, MAP_FILE | MAP_SHARED, x3, 0);
while (x2 != 1) { 
struct timeval x6_t;
gettimeofday(&x6_t, NULL);
long x6 = x6_t.tv_sec * 1000000L + x6_t.tv_usec;
struct timeval x7_t;
gettimeofday(&x7_t, NULL);
long x7 = x7_t.tv_sec * 1000000L + x7_t.tv_usec;
struct timeval x8_t;
gettimeofday(&x8_t, NULL);
long x8 = x8_t.tv_sec * 1000000L + x8_t.tv_usec;
struct Anon689356909 x9 = { 0 };
struct Anon689356909* x10 = &x9;
x10->l_extendedprice_119timesl_discount_120_cnt = 0L;
x10->l_extendedprice_119timesl_discount_120_sum = 0.0;
int64_t x11 = 0L;
bool x12 = true;
while (x12 && x11 < x4) { 
if (x5[x11] == '-') x11 = x11 + 1L;
while (x5[x11] != '|') x11 = x11 + 1L;
int64_t x13 = x11 + 1L;
x11 = x13;
if (x5[x13] == '-') x11 = x13 + 1L;
while (x5[x11] != '|') x11 = x11 + 1L;
int64_t x14 = x11 + 1L;
x11 = x14;
if (x5[x14] == '-') x11 = x14 + 1L;
while (x5[x11] != '|') x11 = x11 + 1L;
int64_t x15 = x11 + 1L;
x11 = x15;
if (x5[x15] == '-') x11 = x15 + 1L;
while (x5[x11] != '|') x11 = x11 + 1L;
int64_t x16 = x11 + 1L;
x11 = x16;
bool x17 = x5[x16] == '-';
if (x17) x11 = x16 + 1L;
int64_t x18 = 0L;
int64_t x19 = 1L;
while (x5[x11] != '.' && x5[x11] != '|') { 
x18 = x18 * 10L + (int64_t)(x5[x11] - '0');
x11 = x11 + 1L;
}
if (x5[x11] == '.') { 
x11 = x11 + 1L;
while (x5[x11] != '|') { 
x18 = x18 * 10L + (int64_t)(x5[x11] - '0');
x19 = x19 * 10L;
x11 = x11 + 1L;
}
}
int64_t x20 = x11 + 1L;
x11 = x20;
bool x21 = x5[x20] == '-';
if (x21) x11 = x20 + 1L;
int64_t x22 = 0L;
int64_t x23 = 1L;
while (x5[x11] != '.' && x5[x11] != '|') { 
x22 = x22 * 10L + (int64_t)(x5[x11] - '0');
x11 = x11 + 1L;
}
if (x5[x11] == '.') { 
x11 = x11 + 1L;
while (x5[x11] != '|') { 
x22 = x22 * 10L + (int64_t)(x5[x11] - '0');
x23 = x23 * 10L;
x11 = x11 + 1L;
}
}
int64_t x24 = x11 + 1L;
x11 = x24;
bool x25 = x5[x24] == '-';
if (x25) x11 = x24 + 1L;
int64_t x26 = 0L;
int64_t x27 = 1L;
while (x5[x11] != '.' && x5[x11] != '|') { 
x26 = x26 * 10L + (int64_t)(x5[x11] - '0');
x11 = x11 + 1L;
}
if (x5[x11] == '.') { 
x11 = x11 + 1L;
while (x5[x11] != '|') { 
x26 = x26 * 10L + (int64_t)(x5[x11] - '0');
x27 = x27 * 10L;
x11 = x11 + 1L;
}
}
int64_t x28 = x11 + 1L;
x11 = x28;
if (x5[x28] == '-') x11 = x28 + 1L;
while (x5[x11] != '.' && x5[x11] != '|') x11 = x11 + 1L;
if (x5[x11] == '.') { 
x11 = x11 + 1L;
while (x5[x11] != '|') x11 = x11 + 1L;
}
int64_t x29 = x11 + 1L;
x11 = x29;
int64_t x30 = x29 + 2L;
x11 = x30;
int64_t x31 = x30 + 2L;
x11 = x31;
int32_t x32 = (((((((int32_t)x5[x31] * 10 + (int32_t)x5[x31 + 1L]) * 10 + (int32_t)x5[x31 + 2L]) * 10 + (int32_t)x5[x31 + 3L]) * 10 + (int32_t)x5[x31 + 5L]) * 10 + (int32_t)x5[x31 + 6L]) * 10 + (int32_t)x5[x31 + 8L]) * 10 + (int32_t)x5[x31 + 9L] - 533333328;
int64_t x33 = x31 + 11L;
x11 = x33;
int64_t x34 = x33 + 11L;
x11 = x34;
x11 = x34 + 11L;
while (x5[x11] != '|') x11 = x11 + 1L;
x11 = x11 + 1L;
while (x5[x11] != '|') x11 = x11 + 1L;
x11 = x11 + 1L;
while (x5[x11] != '|') x11 = x11 + 1L;
int64_t x35 = x11 + 1L;
x11 = x35;
x11 = x35 + 1L;
if (19940101 <= x32 && x32 < 19950101 && 0.05 <= (x25 ? -((double)x26 / (double)x27) : (double)x26 / (double)x27) && (x25 ? -((double)x26 / (double)x27) : (double)x26 / (double)x27) <= 0.07 && (x17 ? -((double)x18 / (double)x19) : (double)x18 / (double)x19) < 24.0) { 
double x36 = x10->l_extendedprice_119timesl_discount_120_sum;
x10->l_extendedprice_119timesl_discount_120_cnt = x10->l_extendedprice_119timesl_discount_120_cnt + 1L;
x10->l_extendedprice_119timesl_discount_120_sum = x36 + (x21 ? -((double)x22 / (double)x23) : (double)x22 / (double)x23) * (x25 ? -((double)x26 / (double)x27) : (double)x26 / (double)x27);
}
x12 = true;
}
printf("%.4f|\n", x10->l_extendedprice_119timesl_discount_120_cnt == 0L ? -1.7976931348623157E308 : x10->l_extendedprice_119timesl_discount_120_sum);
struct timeval x37_t;
gettimeofday(&x37_t, NULL);
long x37 = x37_t.tv_sec * 1000000L + x37_t.tv_usec;
fprintf(stderr, "Timing:\n\tInitializaton:\t%ld μs\n\tRuntime:\t%ld μs\n\tTotal:\t\t%ld μs\n",x8 - x6,x37 - x8,x37 - x6);
x2 = x2 + 1;
}
return 0;
}

/*****************************************
 * End of Generated Code
 * *******************************************/

