#include <stdio.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>

// sum(loadCSV(...).*.value)
int query(char *file, int size) {
  // result of sum() aggregation
  int res = 0;

  // one index that goes from 0 to size - 1
  int i = 0;
  while (file[i] != '\n') {
    i++;
  }
  while (1) {
    if (i >= size) break;

    int tmp0 = i;
    while (1) {
      char tmp1 = file[i];
      if (tmp1 == ',') break;
      i++;
    }
    int tmp2 = i;
    i++;

    int tmp3 = i;
    while (1) {
      char tmp4 = file[i];
      if (tmp4 == ',') break;
      i++;
    }
    int tmp5 = i;
    i++;

    int tmp6 = i;
    while (1) {
      char tmp7 = file[i];
      if (tmp7 == ',') break;
      i++;
    }
    int tmp8 = i;
    i++;

    int tmp9 = i;
    while (1) {
      char tmp10 = file[i];
      if (tmp10 == '\n') break;
      i++;
    }
    int tmp11 = i;
    i++;

    // For number value, we convert string into number
    int tmp12 = 0;
    int tmp13 = tmp11 - 1;
    int tmp14 = 1;
    while (tmp13 >= tmp9) {
      tmp12 += (file[tmp13] - '0') * tmp14;
      tmp14 *= 10;
      tmp13--;
    }

    res += tmp12;
  }

  return res;
}

int fsize(int fd) {
  struct stat stat;
  int res = fstat(fd,&stat);
  return stat.st_size;
}

int main(int argc, char *argv[]) {
  if (argc < 2) {
    printf("Usage: %s <csv_file>\n", argv[0]);
    return 1;
  }

  // perform the actual loadCSV operation here
  int fd = open(argv[1], 0);
  int size = fsize(fd);
  char* file = mmap(0, size, PROT_READ, MAP_FILE | MAP_SHARED, fd, 0);

  int res = query(file, size);

  printf("%d\n", res);

  return 0;
}