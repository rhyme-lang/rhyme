#include <stdio.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <limits.h>
#include <stdint.h>

int fsize(int fd) {
    struct stat stat;
    int res = fstat(fd,&stat);
    return stat.st_size;
}

int extract_int(char *file, int start, int end) {
  int res = 0;
  int curr = start;
  while (curr < end) {
    res *= 10;
    res += file[curr] - '0';
    curr++;
  }
  return res;
}
