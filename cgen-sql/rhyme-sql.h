#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdlib.h>
#include <sys/time.h>
#include <string.h>

int fsize(int fd) {
    struct stat stat;
    int res = fstat(fd, &stat);
    return stat.st_size;
}

unsigned long hash(const char *str, int len) {
    unsigned char *str1 = (unsigned char *)str;
    unsigned long hash = 5381;
    int i = 0;
    while (i < len) {
        hash = ((hash << 5) + hash) + str[i]; /* hash * 33 + c */
        i++;
    }
    return hash;
}

int extract_int(const char *file, int start, int end) {
    int res = 0;
    int curr = start;
    while (curr < end) {
        res *= 10;
        res += file[curr] - '0';
        curr++;
    }
    return res;
}

void extract_str(const char *file, int start, int end, char *dest) {
    int i = 0;
    while (start + i < end) {
        dest[i] = file[start + i];
        i++;
    }
    dest[i] = '\0';
}

void extract_str1(const char *str, int len, char *dest) {
    int i = 0;
    while (i < len) {
        dest[i] = str[i];
        i++;
    }
    dest[i] = '\0';
}

int compare_str(const char *str1, const char *str2) {
    while (*str1 && (*str1 == *str2)) {
        str1++;
        str2++;
    }
    return *(unsigned char *)str1 - *(unsigned char *)str2;
}

int compare_str1(const char *file1, int start1, int end1, const char *file2,
                 int start2, int end2) {
    int len1 = end1 - start1;
    int len2 = end2 - start2;
    int min_len = (len1 < len2) ? len1 : len2;
    for (int i = 0; i < min_len; i++) {
        char c1 = file1[start1 + i];
        char c2 = file2[start2 + i];
        if (c1 != c2) {
            return c1 - c2;
        }
    }
    return len1 - len2;
}

int compare_str2(const char *str1, int len1, const char *str2, int len2) {
    int min_len = (len1 < len2) ? len1 : len2;
    for (int i = 0; i < min_len; i++) {
        char c1 = str1[i];
        char c2 = str2[i];
        if (c1 != c2) {
            return c1 - c2;
        }
    }
    return len1 - len2;
}

void println(const char *file, int start, int end) {
    int curr = start;
    while (curr < end) {
        putchar(file[curr]);
        curr++;
    }
    putchar('\n');
}

void println1(const char *str, int len) {
    int i = 0;
    while (i < len) {
        putchar(str[i]);
        i++;
    }
    putchar('\n');
}

void print(const char *str, int len) {
    int i = 0;
    while (i < len) {
        putchar(str[i]);
        i++;
    }
}

void print_date(int date) {
    int year = date / 10000;          // Extract the year
    int month = (date / 100) % 100;  // Extract the month
    int day = date % 100;            // Extract the day

    printf("%04d-%02d-%02d", year, month, day); // Print in yyyy-mm-dd format
}
