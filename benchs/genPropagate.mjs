import { bench, boxplot, run } from "mitata";
import { effect, signal } from "../dist/v4/experiment.mjs";

const sums = {};
const counts = {};

boxplot(() => {
  bench("propagate: $w * $h", function* (state) {
    const w = state.get("w");
    const h = state.get("h");
    const key = `${w}-${h}`;
    sums[key] = sums[key] || 0;
    counts[key] = counts[key] || 0;
    const src = signal(1);
    for (let i = 0; i < w; i++) {
      let last = src;
      for (let j = 0; j < h; j++) {
        const prev = last;
        last = signal(function* () {
          return (yield prev) + 1;
        });
      }
      effect(function* () {
        sums[key] += yield last;
      });
    }
    yield () => {
      counts[key]++;
      src.set((val) => val + 1);
    };
  })
    .args("h", [1, 10, 100])
    .args("w", [1, 10, 100]);
});

run({ format: "markdown" }).then(() => {
  console.log("sums", sums);
  console.log("counts", counts);
});
