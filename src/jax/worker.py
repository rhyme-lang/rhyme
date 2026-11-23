# JAX worker for Rhyme's accelerated stages (see src/jax/bridge.js).
#
# Protocol over two FIFOs; every message is
#     u64 little-endian header length | JSON header | raw f64 buffers
# request:  {"src": Python source defining stage(**inputs) -> tuple,
#            "inputs": [[name, shape], ...]}
# response: {"shapes": [shape, ...]}  or  {"error": "..."}
#
# Exits when the request pipe is closed (the node process went away).
import sys, json, struct, traceback

import numpy as np
import jax

# JS numbers are doubles: compute in f64 so results match the JS backend
jax.config.update("jax_enable_x64", True)
import jax.numpy as jnp

PRELUDE = '''
def _align(x, src, dst, inner):
    # src/dst name the leading axes; the trailing `inner` axes stay in place
    perm = [src.index(v) for v in dst if v in src] + list(range(len(src), len(src) + inner))
    x = jnp.transpose(x, perm)
    for i, v in enumerate(dst):
        if v not in src:
            x = jnp.expand_dims(x, i)
    return x
'''

def main(req_path, resp_path):
    req = open(req_path, "rb")
    resp = open(resp_path, "wb")
    cache = {}  # stage source -> jitted function (jit caches per shape)

    def read_exact(n):
        buf = bytearray()
        while len(buf) < n:
            chunk = req.read(n - len(buf))
            if not chunk:
                sys.exit(0)
            buf += chunk
        return bytes(buf)

    def send(header, arrays=()):
        h = json.dumps(header).encode()
        resp.write(struct.pack("<Q", len(h)) + h)
        for a in arrays:
            resp.write(np.ascontiguousarray(a, dtype="<f8").tobytes())
        resp.flush()

    while True:
        (n,) = struct.unpack("<Q", read_exact(8))
        header = json.loads(read_exact(n))
        inputs = {}
        for name, shape in header["inputs"]:
            count = int(np.prod(shape)) if shape else 1
            inputs[name] = np.frombuffer(read_exact(8 * count), dtype="<f8").reshape(shape)
        try:
            fn = cache.get(header["src"])
            if fn is None:
                ns = {"jax": jax, "jnp": jnp}
                exec(PRELUDE + header["src"], ns)
                fn = cache[header["src"]] = jax.jit(ns["stage"])
            outs = [np.asarray(o) for o in fn(**inputs)]
            send({"shapes": [list(o.shape) for o in outs]}, outs)
        except Exception:
            send({"error": traceback.format_exc()})

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
