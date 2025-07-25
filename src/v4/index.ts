import { createMinHeap } from "./heap";

interface ReactiveNode {
  id: number;
  depth: number;
  stale: boolean | undefined;
  subId: number | undefined;
  subRunId: number | undefined;
  depsHead: LinkNode | undefined;
  depsTail: LinkNode | undefined;
  subsHead: LinkNode | undefined;
  subsTail: LinkNode | undefined;
}

interface LinkNode {
  sub: ComputedNode;
  dep: ReactiveNode;
  nextDep: LinkNode | undefined;
  prevSub: LinkNode | undefined;
  nextSub: LinkNode | undefined;
}

interface ComputedNode extends ReactiveNode {
  value: unknown | undefined;
  fn(): Generator;
  runId: number;
  slot?: number;
  running?: boolean;
  recursive?: boolean;
  gen?: Generator;
  step?: IteratorResult<unknown>;
}

interface SourceNode extends ReactiveNode {
  value: unknown;
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
  if (value instanceof GeneratorFunction) {
    const node: ComputedNode = {
      id: id++,
      fn: value as () => Generator,
      stale: true,
      depth: 0,
      runId: 0,
      value: undefined,
      subId: undefined,
      subRunId: undefined,
      depsHead: undefined,
      depsTail: undefined,
      subsHead: undefined,
      subsTail: undefined,
    };
    return Object.setPrototypeOf({ [SIGNAL]: node }, DERIVED_PROTO);
  }

  const node: SourceNode = {
    id: id++,
    value,
    depth: -1,
    stale: undefined,
    subId: undefined,
    subRunId: undefined,
    depsHead: undefined,
    depsTail: undefined,
    subsHead: undefined,
    subsTail: undefined,
  };
  return Object.setPrototypeOf({ [SIGNAL]: node }, SOURCE_PROTO);
}

export function isSignal<T = Signal<unknown>>(value: any): value is T {
  return !!(value && value[SIGNAL]);
}

export function batch(fn: () => void) {
  batchHandler.call(fn);
}

export function effect(fn: () => Generator) {
  run({
    id: id++,
    fn,
    stale: true,
    depth: 0,
    runId: 0,
    value: undefined,
    subId: undefined,
    subRunId: undefined,
    depsHead: undefined,
    depsTail: undefined,
    subsHead: undefined,
    subsTail: undefined,
  });
}

const { enqueue, flush, flushing } = createMinHeap({ run, propagate });

function run(sub: ComputedNode) {
  if (sub.running) {
    console.error(
      "[ERROR] A circular dependency was detected on initialization."
    );
    sub.gen = sub.step = undefined;
    sub.running = false;
    sub.recursive = true;
    return;
  }
  sub.running = true;

  const subId = sub.id;
  let gen = sub.gen,
    step: IteratorResult<unknown> | undefined,
    target: unknown,
    depth = sub.depth,
    maxDepth = depth - 1,
    runId: number,
    revisit = false,
    dep: ComputedNode,
    depDepth: number,
    link: LinkNode | undefined,
    linkDep: ReactiveNode,
    nextDep: LinkNode | undefined,
    prevSub: LinkNode | undefined,
    prevDep: LinkNode | undefined,
    isNextDep: boolean,
    value: unknown;

  if (gen) {
    step = sub.step;
    prevDep = sub.depsTail;
    sub.gen = sub.step = undefined;
    runId = sub.runId;
    revisit = true;
  } else {
    gen = sub.fn();
    runId = ++sub.runId;
  }

  try {
    if (!step) step = gen.next();

    while (!step.done) {
      target = step.value;
      if (!isSignal<InternalSignal>(target)) {
        console.warn("[WARNING] Yielding non-signal value");
        step = gen.next(target);
        continue;
      }

      dep = target[SIGNAL];

      evaluation: {
        // The dep has been visited withing this run, so we can skip.
        if (dep.subId === subId && dep.subRunId === runId) break evaluation;

        if (
          !(isNextDep =
            (nextDep =
              prevDep !== undefined ? prevDep.nextDep : sub.depsHead) !==
              undefined && nextDep.dep === dep) &&
          prevDep !== undefined
        ) {
          link = sub.depsHead;

          while (link !== undefined) {
            (linkDep = link.dep).subId = subId;
            linkDep.subRunId = runId;
            if (linkDep === dep) break evaluation;
            if (link === prevDep) break;
            link = link.nextDep;
          }
        }

        depDepth = dep.depth;

        if (dep.stale) {
          run(dep);
          depDepth = dep.depth;
        } else if (!(sub.stale || depth > depDepth)) {
          if (revisit) {
            console.warn(
              "[WARNING] A circular dependency was detected on re-evaluation."
            );
            break evaluation;
          } else {
            sub.gen = gen;
            sub.step = step;
            sub.depsTail = prevDep;
            sub.running = false;

            if (!dep.recursive) {
              LINK.sub = sub;
              enqueue(LINK, depDepth);
              LINK.sub = undefined as never;
            }
            if (!flushing()) flush();
            return;
          }
        }

        if (depDepth > maxDepth) maxDepth = depDepth;

        dep.subId = subId;
        dep.subRunId = runId;

        // The dep has been visited within the past run, so we can relink and skip.
        if (isNextDep) {
          prevDep = nextDep;
          break evaluation;
        }

        link = dep.subsTail = {
          sub,
          dep,
          nextDep,
          prevSub: (prevSub = dep.subsTail),
          nextSub: undefined,
        };

        if (prevSub !== undefined) prevSub.nextSub = link;
        else dep.subsHead = link;

        if (prevDep !== undefined) prevDep.nextDep = link;
        else sub.depsHead = link;

        prevDep = link;
      }

      revisit = false;
      step = gen.next(dep.value);
    }

    value = step.value;
  } catch (error) {
    console.error("[ERROR] at sub: ", sub);
    console.error(error);
  }

  sub.depsTail = prevDep;
  sub.stale = sub.running = false;
  if (++maxDepth > depth) sub.depth = depth = maxDepth;
  unlink(sub);

  if (sub.value === value) return;
  sub.value = value;
  if (!sub.recursive && (link = sub.subsHead)) enqueue(link, depth);
}

function unlink(sub: ComputedNode) {
  let depsTail = sub.depsTail,
    nextDep: LinkNode | undefined,
    link: LinkNode | undefined;

  if (!depsTail) {
    link = sub.depsHead;
    sub.depsHead = undefined;
  } else if ((nextDep = depsTail.nextDep)) {
    link = nextDep;
    depsTail.nextDep = undefined;
  }

  if (!link) return;

  let dep: ReactiveNode,
    nextSub: LinkNode | undefined,
    prevSub: LinkNode | undefined;

  do {
    dep = link.dep;
    nextSub = link.nextSub;
    prevSub = link.prevSub;
    nextDep = link.nextDep;

    if (nextSub) nextSub.prevSub = prevSub;
    else dep.subsTail = prevSub;

    if (prevSub) prevSub.nextSub = nextSub;
    else dep.subsHead = nextSub;

    if (!dep.subsHead && dep.depsHead) {
      dep.stale = true;
      dep.depth = -1;
      link = dep.depsHead;
      dep.depsTail!.nextDep = nextDep;
      dep.depsHead = undefined;
      dep.depsTail = undefined;
      continue;
    }
  } while ((link = nextDep));
}

function propagate(dep: ComputedNode) {
  let link = dep.subsHead;
  if (!link) return;

  const depDepth = dep.depth,
    minDepth = depDepth + 1;
  let sub = link.sub;

  do {
    if (sub.recursive || sub.depth > depDepth) continue;
    else if (sub.slot === undefined) {
      sub.depth = minDepth;
      propagate(sub);
    } else {
      LINK.sub = sub;
      enqueue(LINK, depDepth);
      LINK.sub = undefined as never;
    }
  } while ((link = link.nextSub) && (sub = link.sub));
}

const GeneratorFunction = function* () {}.constructor,
  SIGNAL = Symbol("signal"),
  LINK = {} as LinkNode,
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
      const subs = dep.subsHead;
      if (!subs) return;
      enqueue(subs, -1);
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
