import { batch, effect, signal } from "../dist/index.mjs";

const score = signal(0);
const maxScore = signal(() => {
  const max = Math.max(score.value, maxScore.value);
  return max;
}, 0);

effect(() => {
  console.log("score:", score.value);
});

effect(() => {
  console.log("maxScore:", maxScore.value);
});

for (let i = 0; i < 10; i++) {
  console.log("=".repeat(20));
  score.value = Math.ceil(Math.random() * 1000);
}

console.log("*".repeat(20));

const a = signal(0);
const b = a((val) => {
  console.log("b => a:", val);
  // console.log("d.value:", d.value);
  return val > 1 ? val * d.value : val;
});
const c = a((val) => {
  console.log("c => a:", val);
  return val ** 2;
});
const d = c((val) => {
  console.log("d => c:", val);
  return val * 2;
});

effect(() => {
  console.log(">>> d:", d.value);
  console.log(">>> c:", c.value);
  console.log(">>> b:", b.value);
  console.log(">>> a:", a.value);
});

for (let i = 0; i < 10; i++) {
  console.log("=".repeat(20));
  batch(() => {
    a.value += 0.2;
    console.log("?", a.value);
  });
}
