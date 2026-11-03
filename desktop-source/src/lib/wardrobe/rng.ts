/**
 * CPython `random.Random` 的 TypeScript 移植（MT19937）。
 *
 * 为什么不用项目里现成的 mulberry32：Wardrobe 的硬要求是「同 seed 与插件
 * 逐字一致」。插件的抽取全部走 Python 的 `random.Random(seed)`，只移植业务
 * 逻辑而不移植随机源，结果会从第一位就分叉。
 *
 * 只实现引擎真正用到的接口：random() / getrandbits() / randrange() /
 * sample() / getstate() / setstate()。算法与 CPython 3.13 的 _randommodule.c
 * 对齐（init_by_array + genrand_res53 + 拒绝采样）。
 */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

export type RandomState = { mt: number[]; index: number };

/** 把 Python int 拆成 32 位小端字；0 也要有一个字（CPython 的行为）。 */
function seedWords(seed: number): number[] {
  if (!Number.isFinite(seed)) return [0];
  let n = BigInt(Math.trunc(seed));
  if (n < 0n) n = -n;
  const words: number[] = [];
  while (n > 0n) {
    words.push(Number(n & 0xffffffffn));
    n >>= 32n;
  }
  return words.length ? words : [0];
}

export class WardrobeRandom {
  private mt = new Uint32Array(N);
  private index = N + 1;

  constructor(seed?: number | null) {
    if (seed === undefined || seed === null) {
      // 未指定种子：效果等同 Python 的 random.Random()（不可复现）。
      // 用 32 位熵填满状态，避免所有实例从同一序列开始。
      const words: number[] = [];
      for (let i = 0; i < 8; i += 1) words.push((Math.random() * 0x100000000) >>> 0);
      this.initByArray(words);
      return;
    }
    this.initByArray(seedWords(seed));
  }

  private initGenrand(s: number): void {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < N; i += 1) {
      const prev = this.mt[i - 1];
      this.mt[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
    this.index = N;
  }

  private initByArray(key: number[]): void {
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    let k = Math.max(N, key.length);
    for (; k > 0; k -= 1) {
      const prev = this.mt[i - 1];
      this.mt[i] =
        ((this.mt[i] ^ Math.imul(prev ^ (prev >>> 30), 1664525)) + (key[j] >>> 0) + j) >>> 0;
      i += 1;
      j += 1;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (k = N - 1; k > 0; k -= 1) {
      const prev = this.mt[i - 1];
      this.mt[i] = ((this.mt[i] ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i) >>> 0;
      i += 1;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1];
        i = 1;
      }
    }
    this.mt[0] = UPPER_MASK;
  }

  private generate(): void {
    for (let k = 0; k < N; k += 1) {
      const y = (this.mt[k] & UPPER_MASK) | (this.mt[(k + 1) % N] & LOWER_MASK);
      this.mt[k] = (this.mt[(k + M) % N] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
    }
    this.index = 0;
  }

  /** 单次 32 位 MT 输出（含 tempering）。 */
  genrandUint32(): number {
    if (this.index >= N) this.generate();
    let y = this.mt[this.index];
    this.index += 1;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** CPython genrand_res53：两个 32 位输出拼成 53 位精度浮点。 */
  random(): number {
    const a = this.genrandUint32() >>> 5;
    const b = this.genrandUint32() >>> 6;
    return (a * 67108864 + b) * (1.0 / 9007199254740992);
  }

  getrandbits(k: number): number {
    if (k <= 0) return 0;
    if (k <= 32) return this.genrandUint32() >>> (32 - k);
    let result = 0n;
    let shift = 0n;
    let remaining = k;
    while (remaining > 0) {
      const take = Math.min(32, remaining);
      const word = this.genrandUint32() >>> (32 - take);
      result |= BigInt(word) << shift;
      shift += 32n;
      remaining -= take;
    }
    return Number(result);
  }

  /** CPython `_randbelow_with_getrandbits`：拒绝采样。 */
  randbelow(n: number): number {
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`randbelow 需要正整数，收到 ${n}`);
    }
    const k = n <= 1 ? 1 : Math.floor(Math.log2(n)) + 1;
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** 引擎只用单参形式（`randrange(len(cand))`），但保留三参语义方便测试。 */
  randrange(start: number, stop?: number, step = 1): number {
    const lo = stop === undefined ? 0 : start;
    const hi = stop === undefined ? start : stop;
    const width = hi - lo;
    if (step === 1) return lo + this.randbelow(width);
    const n = Math.ceil(width / step);
    return lo + step * this.randbelow(n);
  }

  /**
   * CPython `random.sample` 的无 counts 版本。
   * 两个分支都要实现：k 小且池大走「选中集合」，池小走「pool 交换」。
   * 只接受数字索引数组（引擎唯一的调用是 `range(len(pool))`）。
   */
  sample(population: ArrayLike<number>, k: number): number[] {
    const n = population.length;
    if (!Number.isInteger(k) || k < 0) throw new Error(`sample 的 k 非法：${k}`);
    if (k > n) throw new Error(`sample 的 k (${k}) 大于总体 (${n})`);

    const result: number[] = new Array(k);
    let setsize = 21;
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));

    if (n <= setsize) {
      const pool = Array.from({ length: n }, (_, i) => population[i]);
      for (let i = 0; i < k; i += 1) {
        const j = this.randbelow(n - i);
        result[i] = pool[j];
        pool[j] = pool[n - i - 1];
      }
    } else {
      const selected = new Set<number>();
      for (let i = 0; i < k; i += 1) {
        let j = this.randbelow(n);
        while (selected.has(j)) j = this.randbelow(n);
        selected.add(j);
        result[i] = population[j];
      }
    }
    return result;
  }

  getstate(): RandomState {
    return { mt: Array.from(this.mt), index: this.index };
  }

  setstate(state: RandomState): void {
    if (!state || state.mt.length !== N) throw new Error("setstate 状态非法");
    this.mt.set(state.mt);
    this.index = state.index;
  }

  clone(): WardrobeRandom {
    const copy = Object.create(WardrobeRandom.prototype) as WardrobeRandom;
    const self = copy as unknown as { mt: Uint32Array; index: number };
    self.mt = new Uint32Array(this.mt);
    self.index = this.index;
    return copy;
  }
}

/* ------------------------------------------------------------------ *
 * Python 小工具
 * ------------------------------------------------------------------ */

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** zlib.crc32（UTF-8 字节），与 Python 的 derive_seed 同一算法。 */
export function crc32(text: string): number {
  const bytes = new TextEncoder().encode(text);
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Python `"|".join(str(p) for p in parts)` + zlib.crc32。 */
export function deriveSeed(...parts: Array<string | number>): number {
  return crc32(parts.map((part) => String(part)).join("|"));
}

/**
 * Python round()：银行家舍入，且按二进制浮点的**精确十进制展开**判断。
 *
 * 不能写成 `Math.round(x * 10**nd) / 10**nd`：2.675 的实际值是
 * 2.67499999999999982…，Python 得 2.67，而乘法会先把它抬成 267.5 → 2.68。
 * 这里先用 toFixed 取足够长的十进制展开，再对目标位做 half-even。
 */
export function pyRound(value: number, nd = 0): number {
  if (!Number.isFinite(value)) return value;
  const negative = value < 0;
  const abs = Math.abs(value);
  if (abs >= 1e21) return value; // 比值不会到这个量级，交给原生
  const places = Math.min(100, Math.max(0, nd) + 20);
  const text = abs.toFixed(places);
  const [intPart, fracPart = ""] = text.split(".");
  const kept = intPart + fracPart.slice(0, nd);
  const next = fracPart[nd] ?? "0";
  const rest = fracPart.slice(nd + 1);
  let n = BigInt(kept || "0");
  const restNonZero = /[1-9]/.test(rest);
  if (next > "5" || (next === "5" && (restNonZero || n % 2n === 1n))) n += 1n;
  const scaled = Number(n) / 10 ** nd;
  return negative ? -scaled : scaled;
}

export function clampProb(p: number): number {
  // 对齐 Python 的 max(0, min(1, p))：NaN 参与比较恒为 False，
  // 于是 min(1, nan) 返回 1、max(0, 1) 返回 1（不是 NaN）。
  const upper = p < 1 ? p : 1;
  return upper > 0 ? upper : 0;
}
