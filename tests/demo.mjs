import { effect, signal } from "../dist/index.mjs";

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
