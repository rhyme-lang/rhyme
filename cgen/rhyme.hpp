#include <stdint.h>

#include <fstream>
#include <nlohmann/json.hpp>
#include <iostream>
#include <memory>
#include <vector>
#include <type_traits>
#include <cassert>
#include <sstream>
#include <initializer_list>

using json = nlohmann::json;

using indexTy = int;

template <class T, class K>
class CSVector {
  std::vector<T>* data;
  std::vector<K>* cols;
  K start_idx;
  K end_idx;
  public:
  class iterator {
    private:
      const CSVector<T, K>* container;
      indexTy index;
    public:
    explicit iterator(const CSVector<T, K>* container, indexTy index) : container(container), index(index) {}
    std::pair<K, T> operator*() const {
      return std::make_pair((*container->cols)[index], (*container->data)[index]);
    }
    iterator& operator++() {
      ++index;
      return *this;
    }
    bool operator!=(const iterator& other) const {
      return container != other.container || index != other.index;
    }
    bool operator==(const iterator& other) const {
      return container == other.container && index == other.index;
    }
  };
  class multi_iterator {
    private:
      std::vector<const CSVector<T, K>*> containers;
      std::vector<indexTy> indexes;
      indexTy length;
      bool finished;
    public:
    inline T getdata(indexTy idx) const {
      return (*containers[idx]->data)[indexes[idx]];
    }
    inline K getcol(indexTy idx) const {
      return (*containers[idx]->cols)[indexes[idx]];
    }
    inline indexTy getlength(indexTy idx) const {
      return (*containers[idx]->cols).size();
    }
    inline void skip(indexTy idx, K max_col) {
      indexTy n = getlength(idx);
      while (indexes[idx] < n && getcol(idx) < max_col) {
        indexes[idx]++;
      }
      if (indexes[idx] >= n) finished = true;
    }
    inline bool ready() const {
      K key = getcol(0);
      for (indexTy i = 1; i < length; i++) {
        if (getcol(i) != key) return false;
      }
      return true;
    }
    inline void next(bool start = false) {
      if (!start && ready()) {
        for (indexTy i = 0; i < length; i++) {
          indexes[i]++;
          if (indexes[i] >= getlength(i)) {
            finished = true;
            return;
          }
        }
      }
      while(!ready() && !finished) {
        K max_key = getcol(0);
        for (indexTy i = 1; i < length; i++) {
          K curr_key = getcol(i);
          max_key = curr_key > max_key ? curr_key : max_key;
        }
        for (indexTy i = 0; i < length; i++) {
          skip(i, max_key);
        }
      }
      return;
    }
    explicit multi_iterator(std::initializer_list<const CSVector<T, K>*> containers) {
      this->containers = std::vector<const CSVector<T, K>*>{containers};
      length = containers.size();
      assert(length > 1 && "too few arguments!");
      indexes = std::vector<indexTy>(length, 0);
      finished = false;
      next(true);
    }
    std::pair<K, std::vector<T>> operator*() const {
      std::vector<T> vals;
      for (indexTy i = 0; i < length; i++) {
        vals.emplace_back(getdata(i));
      }
      return std::make_pair(getcol(0), std::move(vals));
    }
    multi_iterator& operator++() {
      next();
      return *this;
    }
    bool finish() {
      return finished;
    }
  };
  iterator begin() const {
    return iterator(this, start_idx);
  }
  iterator end() const {
    return iterator(this, end_idx);
  }
  explicit CSVector(std::vector<T>* data, std::vector<K>* cols, K start_idx, K end_idx) : data(data), cols(cols), start_idx(start_idx), end_idx(end_idx) {}

  CSVector(const CSVector& other) : data(other.data), cols(other.cols), start_idx(other.start_idx), end_idx(other.end_idx) {}
  CSVector(CSVector&& other) : data(std::move(other.data)), cols(std::move(other.cols)), start_idx(std::move(other.start_idx)), end_idx(std::move(other.end_idx)) {}
};

template <class T, class K>
class CSRMatrix {
  std::vector<T>* data;
  std::vector<K>* cols;
  std::vector<K>* rows;
  public:
  class iterator {
    private:
      const CSRMatrix<T, K>* container;
      indexTy index;
    public:
    explicit iterator(const CSRMatrix<T, K>* container, indexTy index) : container(container), index(index) {}
    std::pair<K, CSVector<T, K>> operator*() const {
      K start_idx = (*container->rows)[index];
      K end_idx = index == container->rows->size() - 1 ? container->data->size() : (*container->rows)[index+1];
      return std::make_pair(std::move(index), std::move(::CSVector<T, K>(container->data, container->cols, start_idx, end_idx)));
    }
    iterator& operator++() {
      ++index;
      return *this;
    }
    bool operator!=(const iterator& other) const {
      return container != other.container || index != other.index;
    }
    bool operator==(const iterator& other) const {
      return container == other.container && index == other.index;
    }
  };
  iterator begin() const {
    return iterator(this, 0);
  }
  iterator end() const {
    return iterator(this, rows->size());
  }
  explicit CSRMatrix(std::vector<T>* data, std::vector<K>* cols, std::vector<K>* rows) : data(data), cols(cols), rows(rows) {}
  CSRMatrix(const CSRMatrix& other) : data(other.data), cols(other.cols), rows(other.rows) {}
  CSRMatrix(CSRMatrix&& other) : data(std::move(other.data)), cols(std::move(other.cols)), rows(std::move(other.rows)) {}
};

template <typename T>
inline T parse_elem(std::string data) {
  T res;
  if constexpr (std::is_same<T, uint8_t>::value) {
    return std::stoi(data);
  } else if constexpr (std::is_same<T, uint16_t>::value) {
    return std::stoi(data);
  } else if constexpr (std::is_same<T, uint32_t>::value) {
    return std::stoi(data);
  } else if constexpr (std::is_same<T, uint64_t>::value) {
    return std::stoi(data);
  } else if constexpr (std::is_same<T, int8_t>::value) {
    return std::stoi(data);
  } else if constexpr (std::is_same<T, int16_t>::value) {
    return std::stoi(data);
  } else if constexpr (std::is_same<T, int32_t>::value) {
    return std::stoi(data);
  } else if constexpr (std::is_same<T, int64_t>::value) {
    return std::stoi(data);
  } else if (std::is_same<T, float>::value) {
    return std::stof(data);
  } else {
    assert(0 && "unsupported type!");
    return res;
  }
}

template <typename T>
inline std::vector<T> parse_1D_dense_tensor(std::string data) {
  std::vector<T> res;
  int len = data.size();
  assert(data[0] == '[');
  assert(data[len-1] == ']');
  int start = 1;
  int end = 2;
  while(end < len) {
    if (data[end] == ',' || data[end] == ']') {
      res.push_back(parse_elem<T>(data.substr(start, end - start)));
      start = end+1;
    }
    end++;
  }
  return res;
}

template <typename T>
inline std::vector<std::vector<T>> parse_2D_dense_tensor(std::string data) {
  std::vector<std::vector<T>> res;
  int len = data.size();
  assert(data[0] == '[');
  assert(data[len-1] == ']');
  int start = 1;
  int end = 2;
  while(end < len) {
    while (data[end]!=']') {
      end++;
    }
    res.push_back(std::move(parse_1D_dense_tensor<T>(data.substr(start, end - start + 1))));
    start = end+2;
    end = start+1;
  }
  return res;
}

template <typename T, typename K>
inline CSVector<T, K> parse_1D_sparse_tensor(std::string data) {
  std::vector<T>* data_p = new std::vector<T>();
  std::vector<K>* cols_p = new std::vector<K>();
  int start_idx;
  int end_idx;
  int len = data.size();
  assert(data[0] == '{');
  assert(data[len-1] == '}');
  assert(data.substr(2, 4) == "data");
  int start = 8;
  int end = 9;
  assert(data[start] == '[');
  while (data[end]!=']') {
    end++;
  }
  *data_p = std::move(parse_1D_dense_tensor<T>(data.substr(start, end - start + 1)));
  assert(data.substr(end+3, 4) == "cols");
  start = end+9;
  end = start+1;
  assert(data[start] == '[');
  while (data[end]!=']') {
    end++;
  }
  *cols_p = std::move(parse_1D_dense_tensor<K>(data.substr(start, end - start + 1)));
  assert(data.substr(end+3, 5) == "start");
  start = end+10;
  end = start+1;
  while (data[end]!=',') {
    end++;
  }
  start_idx = parse_elem<int>(data.substr(start, end - start));
  assert(data.substr(end+2, 3) == "end");
  start = end+7;
  end = start+1;
  while (data[end]!=',' && data[end]!='}') {
    end++;
  }
  end_idx = parse_elem<int>(data.substr(start, end - start));
  return CSVector<T, K>(data_p, cols_p, start_idx, end_idx);
}

template <typename T, typename K>
inline CSRMatrix<T, K> parse_2D_sparse_tensor(std::string data) {
  std::vector<T>* data_p = new std::vector<T>();
  std::vector<K>* cols_p = new std::vector<K>();
  std::vector<K>* rows_p = new std::vector<K>();
  int len = data.size();
  assert(data[0] == '{');
  assert(data[len-1] == '}');
  assert(data.substr(2, 4) == "data");
  int start = 8;
  int end = 9;
  assert(data[start] == '[');
  while (data[end]!=']') {
    end++;
  }
  *data_p = std::move(parse_1D_dense_tensor<T>(data.substr(start, end - start + 1)));
  assert(data.substr(end+3, 4) == "cols");
  start = end+9;
  end = start+1;
  assert(data[start] == '[');
  while (data[end]!=']') {
    end++;
  }
  *cols_p = std::move(parse_1D_dense_tensor<K>(data.substr(start, end - start + 1)));
  assert(data.substr(end+3, 4) == "rows");
  start = end+9;
  end = start+1;
  assert(data[start] == '[');
  while (data[end]!=']') {
    end++;
  }
  *rows_p = std::move(parse_1D_dense_tensor<K>(data.substr(start, end - start + 1)));
  return CSRMatrix<T, K>(data_p, cols_p, rows_p);
}

typedef json rh;

inline rh parse_json(std::string data) {
  return json::parse(data);
}

inline bool is_int(rh a) {
  return a.is_number_integer();
}

inline rh encode_int(int a) {
  return json(a);
}

inline int decode_int(rh a) {
  return (int)a;
}

inline rh rt_const_string(std::string a) {
  return json(a);
}

inline rh rt_const_obj() {
  return json::object();
}

inline rh rt_const_int(int a) {
  return encode_int(a);
}

inline rh rt_pure_plus(rh a, rh b) {
  return (int)a + (int)b;
}

inline rh rt_pure_times(rh a, rh b) {
  return (int)a * (int)b;
}

inline rh rt_pure_and(rh a, rh b) {
  return decode_int(a) == 0 ? a : b;
}

inline rh rt_get(rh a, rh b) {
  return a[(std::string)b];
}

inline rh read_input() {
  std::ifstream f("cgen/inp.json");
  json inp = json::parse(f);
  return inp;
}

#define READFILECODE std::ifstream f(filename);\
  std::stringstream strStream;\
  strStream << f.rdbuf();\
  std::string data = strStream.str();\

inline rh read_json(const char *filename) {
  READFILECODE
  return parse_json(data);
}

template <typename T>
inline T read_elem(const char *filename) {
  READFILECODE
  return parse_elem<T>(data);
}

template <typename T>
inline std::vector<T> read_1D_dense_tensor(const char *filename) {
  READFILECODE
  return parse_1D_dense_tensor<T>(data);
}

template <typename T>
inline std::vector<std::vector<T>> read_2D_dense_tensor(const char *filename) {
  READFILECODE
  return parse_2D_dense_tensor<T>(data);
}

template <typename T, typename K>
inline CSVector<T, K> read_1D_sparse_tensor(const char *filename) {
  READFILECODE
  return parse_1D_sparse_tensor<T, K>(data);
}

template <typename T, typename K>
inline CSRMatrix<T, K> read_2D_sparse_tensor(const char *filename) {
  READFILECODE
  return parse_2D_sparse_tensor<T, K>(data);
}

template <typename T>
inline void write_result(T x) {
  std::cout << x;
}
