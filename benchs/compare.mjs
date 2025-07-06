import { op1, op2, op3, op4 } from "../dist/parts/index.mjs";

const TESTS = { op1, op2, op3, op4 },
  key = process.argv[process.argv.length - 1],
  op = TESTS[key];

if (op) runLinkBench(op);
else {
  // runLinkBench(op1);
  runLinkBench(op2);
  runLinkBench(op3);
  runLinkBench(op4);
}

function runLinkBench({
  debug,
  endTracking,
  key,
  link,
  nodes,
  name,
  startTracking,
}) {
  console.log("=".repeat(50));
  console.log(">> NAME:", name);

  let time = 0,
    dep,
    sub;

  const subs = Array.from({ length: 3 }, () => nodes.pop()),
    deps = Array.from({ length: 7 }, () => nodes.pop()),
    iters = 250_000;

  cleanUp();

  for (let i = 0; i < iters; i++) {
    for (let j = 0; j < subs.length; j++) {
      sub = subs[j];

      reset(sub);

      for (let k = 0; k < deps.length; k++) {
        dep = deps[k];

        time -= performance.now();
        link(dep, sub);
        time += performance.now();
      }
    }
  }

  console.log(">> FIRST LINK:", time.toFixed(2));

  cleanUp();

  for (let i = 0; i < iters; i++) {
    for (let j = 0; j < subs.length; j++) {
      sub = subs[j];

      time -= performance.now();
      startTracking(sub);
      time += performance.now();

      for (let k = 0; k < deps.length; k++) {
        dep = deps[k];

        time -= performance.now();
        link(dep, sub);
        time += performance.now();
      }

      time -= performance.now();
      endTracking(sub);
      time += performance.now();
    }
  }

  console.log(">> STABLE RUNS:", time.toFixed(2));

  cleanUp();

  for (let i = 0; i < iters; i++) {
    for (let j = 0; j < subs.length; j++) {
      sub = subs[j];

      time -= performance.now();
      startTracking(sub);
      time += performance.now();

      for (let k = 0; k < deps.length; k++) {
        dep = deps[0];

        time -= performance.now();
        link(dep, sub);
        time += performance.now();
      }

      time -= performance.now();
      endTracking(sub);
      time += performance.now();
    }
  }

  console.log(">> SAME DEPS:", time.toFixed(2));

  cleanUp();

  for (let i = 0; i < iters; i++) {
    for (let j = 0; j < subs.length; j++) {
      sub = subs[j];

      time -= performance.now();
      startTracking(sub);
      time += performance.now();

      for (let x = 1; x < 3; x++) {
        for (let k = 0; k < deps.length; k++) {
          dep = deps[x === 1 || i % 2 === 0 ? k : deps.length - k - 1];

          time -= performance.now();
          link(dep, sub);
          time += performance.now();
        }

        if (x === 1) {
          dep = nodes[nodes.length - 1];

          time -= performance.now();
          link(dep, sub);
          time += performance.now();
        }
      }

      time -= performance.now();
      endTracking(sub);
      time += performance.now();
    }
  }

  console.log(">> UNSTABLE RUNS:", time.toFixed(2));

  const depsCounts = [];

  for (let i = 0; i < subs.length; i++) {
    depsCounts[i] = 0;
    dep = subs[i][key];
    while (dep) {
      depsCounts[i]++;
      dep = dep.nextDep;
    }
  }

  console.log(">> DEPS COUNT:", depsCounts);
  console.log("=".repeat(50));

  function cleanUp() {
    // logDebug();
    time = 0;
    resetAll();
    globalThis.gc();
  }

  function resetAll() {
    for (let i = 0; i < subs.length; i++) reset(subs[i]);
  }

  function reset(sub) {
    startTracking(sub);
    endTracking(sub);
  }

  function logDebug() {
    if (!debug) return;

    console.log(debug);

    Object.assign(debug, {
      lastRunLinkInOrder: 0,
      lastRunLinkOutOfOrder: 0,
      thisRunLink: 0,
      newLink: 0,
    });
  }
}
