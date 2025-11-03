CC = gcc
CFLAGS = -O3
AR = ar
ARFLAGS = rcs

OUT_DIR = out
TARGET = $(OUT_DIR)/libyyjson.a
OBJ = $(OUT_DIR)/yyjson.o

all: $(TARGET)

$(TARGET): $(OBJ)
	$(AR) $(ARFLAGS) $@ $^

$(OBJ): yyjson.c yyjson.h | $(OUT_DIR)
	$(CC) $(CFLAGS) -c -o $@ $<

$(OUT_DIR):
	mkdir -p $(OUT_DIR)

clean:
	rm -rf $(OUT_DIR)

.PHONY: all clean
