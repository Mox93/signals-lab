import { signal, effect } from "../dist/v4/index.mjs";

test1();
test2();
test3();
test4();

function test1() {
  console.log("#".repeat(50));
  console.log("<<<TEST 1>>>");

  let i = 0;

  const a = signal(0);
  const b = signal(function* () {
    return (yield a) > 1 ? (yield a) * (yield d) : yield a;
  });
  const c = signal(function* () {
    return (yield a) ** 2;
  });
  const d = signal(function* () {
    console.log(`[${i}] inside d`);
    const cVal = yield c;
    console.log(`[${i}] cVal:`, cVal);
    i++;
    return 2 ** cVal;
  });

  console.log("outside effect", d.get());

  effect(function* () {
    console.log("=".repeat(20));
    console.log(`# a = ${yield a}`);
    console.log(`# b = ${yield b}`);
    console.log(`# c = ${yield c}`);
    console.log(`# d = ${yield d}`);
  });

  for (let i = 0; i < 10; i++) {
    console.log("*".repeat(15), i, "*".repeat(15));
    a.set((val) => val + 0.25);
  }

  console.log("*".repeat(30));
  a.set(-1);

  console.log(
    `
  a = ${a.get()}
  b = ${b.get()}
  c = ${c.get()}
  d = ${d.get()}
  `
  );
}

function test2() {
  console.log("#".repeat(50));
  console.log("<<<TEST 2>>>");

  const sums = {};
  const counts = {};
  const w = 5;
  const h = 5;
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

  for (let i = 0; i < 10; i++) {
    counts[key]++;
    src.set((val) => val + 1);
  }

  console.log(sums, counts);
}

function test3() {
  console.log("#".repeat(50));
  console.log("<<<TEST 3>>>");

  const n = signal(-1);

  const w = signal(function* () {
    // return (yield z) * 2;
    return ((yield n) < 0 ? yield n : yield z) * 2;
  });
  const x = signal(function* () {
    return (yield w) * 3;
  });
  const y = signal(function* () {
    return (yield x) * 4;
  });
  const z = signal(function* () {
    return (yield y) * 5;
  });

  effect(function* () {
    console.log("=".repeat(20));
    console.log(`# w = ${yield w}`);
    console.log(`# x = ${yield x}`);
    console.log(`# y = ${yield y}`);
    console.log(`# z = ${yield z}`);
  });

  console.log("*".repeat(30));
  n.set(1);
  console.log("*".repeat(30));
  n.set(2);
}

function test4() {
  console.log("#".repeat(50));
  console.log("<<<TEST 4>>>");

  // id: 42, depth: -1
  const s = signal(0);
  // id: 43, depth: 0
  const a1 = signal(function* () {
    return (yield s) + 1;
  });
  // id: 44, depth: 1
  const a2 = signal(function* () {
    console.log("inside a2", a1.get());
    return (yield a1) < 5 ? yield b1 : (yield b2) + (yield b3);
  });
  // id: 45, depth: 0
  const b1 = signal(function* () {
    return (yield s) + 2;
  });
  // id: 46, depth: 1
  const b2 = signal(function* () {
    console.log("inside b2", b1.get());
    return (yield b1) + 2;
  });
  // id: 47, depth: 2
  const b3 = signal(function* () {
    console.log("inside b3", b2.get());
    return (yield b2) + 2;
  });
  // id: 48, depth: 2
  const c1 = signal(function* () {
    yield s;
    return (yield a2) + 3;
  });
  // id:49, depth: 3
  const c2 = signal(function* () {
    return (yield c1) + 3;
  });

  // id: 50, depth: 4
  effect(function* () {
    console.log("=".repeat(20));
    console.log(`# b2 = ${yield b2}`);
    console.log(`# b3 = ${yield b3}`);
    console.log(`# c2 = ${yield c2}`);
  });

  for (let i = 0; i < 10; i++) {
    console.log("*".repeat(15), i, "*".repeat(15));
    s.set((val) => val + 1);
  }
}
