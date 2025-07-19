import { createMinHeap } from "./heap";

interface ReactiveNode {
  id: number;
  depth: number;
  stale?: boolean;
  deps?: Set<ReactiveNode>;
  subs?: Set<ComputedNode>;
}

interface ComputedNode extends ReactiveNode {
  value?: unknown;
  fn(): Generator;
  slot?: number;
  running?: boolean;
  gen?: Generator;
  step?: IteratorResult<unknown>;
  prevDeps?: Set<ReactiveNode>;
}

interface InternalSignal {
  [SIGNAL]: ComputedNode;
}

export interface Signal<T> {
  get(): T;
  set(value: T | ((value: T) => T)): void;
}

export interface DerivedSignal<T> {
  get(): T;
}

export function signal<T>(fn: () => Generator<unknown, T>): DerivedSignal<T>;
export function signal<T>(value: T): Signal<T>;
export function signal<T>(): Signal<T | undefined>;
export function signal(value?: unknown) {
  return value instanceof GeneratorFunction
    ? Object.setPrototypeOf(
        {
          [SIGNAL]: {
            id: id++,
            fn: value as () => Generator,
            depth: 0,
            stale: true,
          },
        },
        DERIVED_PROTO
      )
    : Object.setPrototypeOf(
        { [SIGNAL]: { id: id++, value, depth: -1 } },
        SOURCE_PROTO
      );
}

export function isSignal<T = Signal<unknown>>(value: any): value is T {
  return !!value?.[SIGNAL];
}

export function batch(fn: () => void) {
  batchHandler.call(fn);
}

export function effect(fn: () => Generator) {
  const sub: ComputedNode = {
    id: id++,
    fn,
    depth: 0,
    stale: true,
  };

  run(sub);
}

function run(sub: ComputedNode) {
  if (sub.running) {
    console.error("[ERROR] Circular dependency detected at", sub.id);
    sub.gen = sub.step = sub.prevDeps = undefined;
    sub.stale = sub.running = false;
    return;
  }
  sub.running = true;

  let gen = sub.gen,
    step: IteratorResult<unknown> | undefined,
    target: unknown,
    dep: ComputedNode,
    prevDeps: Set<ReactiveNode> | undefined,
    deps: Set<ReactiveNode> | undefined,
    subs: Set<ComputedNode> | undefined,
    depth = sub.depth,
    maxDepth = depth - 1,
    depDepth: number,
    pending = false,
    value: unknown;

  if (gen) {
    step = sub.step;
    prevDeps = sub.prevDeps;
    sub.gen = sub.step = sub.prevDeps = undefined;
    deps = sub.deps!;
    pending = true;
  } else {
    gen = sub.fn();
    prevDeps = sub.deps;
    deps = sub.deps = new Set<ReactiveNode>();
  }

  try {
    if (!step) step = gen.next();

    while (!step.done) {
      target = step.value;
      if (!isSignal<InternalSignal>(target)) {
        console.warn("Yielding non-signal value");
        step = gen.next(target);
        continue;
      }

      dep = target[SIGNAL];

      linking: if (!deps.has(dep)) {
        depDepth = dep.depth;

        if (dep.stale) {
          run(dep);
          depDepth = dep.depth;
        } else if (!(sub.stale || depth > depDepth)) {
          if (pending) break linking;
          else {
            sub.gen = gen;
            sub.step = step;
            sub.prevDeps = prevDeps;
            sub.running = false;

            enqueue(depDepth, sub);
            if (!flushing()) flush();
            return;
          }
        }

        if (depDepth > maxDepth) maxDepth = depDepth;

        deps.add(dep);
        if (!prevDeps?.delete(dep))
          if ((subs = dep.subs)) subs.add(sub);
          else dep.subs = new Set([sub]);
      }

      pending = false;
      step = gen.next(dep.value);
    }

    value = step.value;
  } catch (error) {
    console.error("[ERROR] as sub: ", sub);
    console.error(error);
  }

  sub.stale = sub.running = false;
  if (++maxDepth > depth) sub.depth = depth = maxDepth;
  if (prevDeps?.size) unlink(sub, prevDeps);

  if (sub.value === value) return;
  sub.value = value;
  if ((subs = sub.subs)?.size) enqueue(depth, ...subs);
}

function unlink(sub: ComputedNode, deps: Set<ReactiveNode>) {
  let dep: ReactiveNode,
    subs: Set<ComputedNode> | undefined,
    depDeps: Set<ReactiveNode> | undefined;
  for (dep of deps) {
    (subs = dep.subs)?.delete(sub);
    if (!subs?.size && (depDeps = dep.deps)?.size) {
      dep.deps = undefined;
      dep.stale = true;
      unlink(dep as ComputedNode, depDeps);
    }
  }
}

const { enqueue, flush, flushing } = createMinHeap({ run, propagate });

function propagate(dep: ComputedNode) {
  if (!dep.subs?.size) return;

  const subs = dep.subs,
    depDepth = dep.depth,
    minDepth = depDepth + 1;
  let sub: ComputedNode, depth: number;

  for (sub of subs) {
    if ((depth = sub.depth) > depDepth) continue;

    if (sub.slot === undefined) {
      sub.depth = depth = minDepth;
      propagate(sub);
    } else enqueue(depDepth, sub);
  }
}

const GeneratorFunction = function* () {}.constructor,
  SIGNAL = Symbol("signal"),
  SOURCE_PROTO = {
    get(this: InternalSignal) {
      return this[SIGNAL].value;
    },
    set(this: InternalSignal, value: unknown) {
      const dep = this[SIGNAL],
        oldValue = dep.value;
      value = typeof value === "function" ? value(oldValue) : value;
      if (value === oldValue) return;
      dep.value = value;
      const subs = dep.subs;
      if (!subs) return;
      enqueue(-1, ...subs);
      if (!batchDepth) flush();
    },
  },
  DERIVED_PROTO = {
    get(this: InternalSignal) {
      const dep = this[SIGNAL] as ComputedNode;
      if (dep.stale) run(dep);
      return dep.value;
    },
  };

let id = 0,
  batchDepth = 0,
  batchTick = 0;

function batchHandler(this: Function, ...args: unknown[]) {
  batchDepth++;
  try {
    return this.apply(this, args);
  } catch (error) {
    console.error(error);
  } finally {
    if (!--batchDepth) {
      flush();
      batchTick++;
    }
  }
}
