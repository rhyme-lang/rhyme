#include <fstream>
#include <nlohmann/json.hpp>
#include <iostream>
#include <memory>
#include <vector>
#include <type_traits>
#include <cassert>
#include <sstream>

using json = nlohmann::json;

template <class T>
class CSVector {
  std::shared_ptr<std::vector<T>> data;
  std::shared_ptr<std::vector<int>> cols;
  int start_idx;
  int end_idx;
  public:
  class iterator {
    private:
      const CSVector<T>* container;
      int index;
    public:
    explicit iterator(const CSVector<T>* container, int index) : container(container), index(index) {}
    std::pair<int, T> operator*() const {
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
  iterator begin() const {
    return iterator(this, start_idx);
  }
  iterator end() const {
    return iterator(this, end_idx);
  }
  explicit CSVector(std::shared_ptr<std::vector<T>> data, std::shared_ptr<std::vector<int>> cols, int start_idx, int end_idx) : data(data), cols(cols), start_idx(start_idx), end_idx(end_idx) {}

  CSVector(const CSVector& other) : data(other.data), cols(other.cols), start_idx(other.start_idx), end_idx(other.end_idx) {}
  CSVector(CSVector&& other) : data(std::move(other.data)), cols(std::move(other.cols)), start_idx(std::move(other.start_idx)), end_idx(std::move(other.end_idx)) {}
};

template <class T>
class CSRMatrix {
  std::shared_ptr<std::vector<T>> data;
  std::shared_ptr<std::vector<int>> cols;
  std::shared_ptr<std::vector<int>> rows;
  public:
  class iterator {
    private:
      const CSRMatrix<T>* container;
      int index;
    public:
    explicit iterator(const CSRMatrix<T>* container, int index) : container(container), index(index) {}
    std::pair<int, CSVector<T>> operator*() const {
      int start_idx = (*container->rows)[index];
      int end_idx = index == container->rows->size() - 1 ? container->data->size() : (*container->rows)[index+1];
      return std::make_pair(std::move(index), std::move(::CSVector<T>(container->data, container->cols, start_idx, end_idx)));
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
  explicit CSRMatrix(std::shared_ptr<std::vector<T>> data, std::shared_ptr<std::vector<int>> cols, std::shared_ptr<std::vector<int>> rows) : data(data), cols(cols), rows(rows) {}
  CSRMatrix(const CSRMatrix& other) : data(other.data), cols(other.cols), rows(other.rows) {}
  CSRMatrix(CSRMatrix&& other) : data(std::move(other.data)), cols(std::move(other.cols)), rows(std::move(other.rows)) {}
};

template <typename T>
inline T parse_elem(std::string data) {
  T res;
  if constexpr (std::is_same<T, int>::value) {
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

template <typename T>
inline CSVector<T> parse_1D_sparse_tensor(std::string data) {
  std::shared_ptr<std::vector<T>> data_p = std::make_shared<std::vector<T>>();
  std::shared_ptr<std::vector<int>> cols_p = std::make_shared<std::vector<int>>();
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
  *cols_p = std::move(parse_1D_dense_tensor<int>(data.substr(start, end - start + 1)));
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
  return CSVector<T>(data_p, cols_p, start_idx, end_idx);
}

template <typename T>
inline CSRMatrix<T> parse_2D_sparse_tensor(std::string data) {
  std::shared_ptr<std::vector<T>> data_p = std::make_shared<std::vector<T>>();
  std::shared_ptr<std::vector<int>> cols_p = std::make_shared<std::vector<int>>();
  std::shared_ptr<std::vector<int>> rows_p = std::make_shared<std::vector<int>>();
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
  *cols_p = std::move(parse_1D_dense_tensor<int>(data.substr(start, end - start + 1)));
  assert(data.substr(end+3, 4) == "rows");
  start = end+9;
  end = start+1;
  assert(data[start] == '[');
  while (data[end]!=']') {
    end++;
  }
  *rows_p = std::move(parse_1D_dense_tensor<int>(data.substr(start, end - start + 1)));
  return CSRMatrix<T>(data_p, cols_p, rows_p);
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

template <typename T>
inline CSVector<T> read_1D_sparse_tensor(const char *filename) {
  READFILECODE
  return parse_1D_sparse_tensor<T>(data);
}

template <typename T>
inline CSRMatrix<T> read_2D_sparse_tensor(const char *filename) {
  READFILECODE
  return parse_2D_sparse_tensor<T>(data);
}

template <typename T>
inline void write_result(T x) {
  std::cout << x;
}
