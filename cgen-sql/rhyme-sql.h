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

void extract_str(char *file, int start, int end, char *dest) {
  int i = 0;
  while (start + i < end) {
    dest[i] = file[start + i];
    i++;
  }
  dest[i] = '\0';
}

void println(char *file, int start, int end) {
  int curr = start;
  while (curr < end) {
    putchar(file[curr]);
    curr++;
  }
  putchar('\n');
}

int compare_str(const char *str1, const char *str2) {
    while (*str1 && (*str1 == *str2)) {
        str1++;
        str2++;
    }
    return *(unsigned char *)str1 - *(unsigned char *)str2;
}
