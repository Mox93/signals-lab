// import {} from "../../dist/parts/fnVsGen/index.mjs";

test1();

function get(signal) {
  return signal.value;
}

async function pGet(signal) {
  return Promise.resolve(get(signal));
}

async function test1() {
  const a = { value: 1 };
  const b = { value: 2 };
  const c = { value: 3 };
  const d = { value: 4 };

  const iters = 250_000;
  const total = { fn: 0, gen: 0, async: 0 };

  let time = 0,
    i,
    gen,
    step,
    stepCount = 0;

  for (i = 0; i < iters; i++) {
    time -= performance.now();
    gen = genFn();
    step = gen.next();
    while (!step.done) {
      stepCount++;
      step = gen.next(get(step.value));
    }
    time += performance.now();
    total.gen += step.value;
  }

  console.log("gen:", time.toFixed(2));
  console.log("steps:", stepCount);

  time = 0;

  for (i = 0; i < iters; i++) {
    time -= performance.now();
    time += performance.now();
    total.fn += fn();
  }

  console.log("fn:", time.toFixed(2));

  time = 0;

  for (i = 0; i < iters; i++) {
    time -= performance.now();
    total.async += await asyncFn();
    time += performance.now();
  }

  console.log("async:", time.toFixed(2));

  console.log(total);

  function* genFn() {
    let result = 0;
    for (let i = 0; i < 10; i++) {
      result += yield a;
      result += yield b;
      result += yield c;
      result += yield d;
    }
    return result;
  }

  async function asyncFn() {
    let result = 0;
    for (let i = 0; i < 10; i++) {
      result += await pGet(a);
      result += await pGet(b);
      result += await pGet(c);
      result += await pGet(d);
    }
    return result;
  }

  function fn() {
    let result = 0;
    for (let i = 0; i < 10; i++) {
      result += get(a);
      result += get(b);
      result += get(c);
      result += get(d);
    }
    return result;
  }
}
