import { effect, signal } from "../dist/index.mjs";

globalThis.gc();
let start = process.memoryUsage().heapUsed;

const signals = Array.from({ length: 10000 }, () => signal(0));

globalThis.gc();
let end = process.memoryUsage().heapUsed;

console.log(`signal: ${((end - start) / 1024).toFixed(2)} KB`);

start = end;

const computed = Array.from({ length: 10000 }, (_, i) =>
  signals[i]((v) => ++v)
);

globalThis.gc();
end = process.memoryUsage().heapUsed;

console.log(`computed: ${((end - start) / 1024).toFixed(2)} KB`);

start = end;

Array.from({ length: 10000 }, (_, i) => effect(() => computed[i].value));

globalThis.gc();
end = process.memoryUsage().heapUsed;

console.log(`effect: ${((end - start) / 1024).toFixed(2)} KB`);

start = end;

const w = 100;
const h = 100;
const src = signal(1);

for (let i = 0; i < w; i++) {
  let last = src;
  for (let j = 0; j < h; j++) {
    const prev = last;
    last = prev((v) => ++v);
    effect(() => last.value);
  }
}

src.value++;

globalThis.gc();
end = process.memoryUsage().heapUsed;

console.log(`tree: ${((end - start) / 1024).toFixed(2)} KB`);
