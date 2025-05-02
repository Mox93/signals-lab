import {
  Derived,
  createReactiveSystem,
  Subscriber,
  EFFECT,
  STALE,
  PENDING,
} from "./system";

interface RootNode extends Subscriber {
  [Root]: true;
}

interface EffectNode extends Derived {
  fn(): void;
}

interface SignalNode<T = unknown> extends Derived {
  currentValue: T;
  getter: (<U>(value: T) => U) | null;
}

export interface Signal<T = unknown> {
  value: T;
  <U>(value: T): DerivedSignal<U>;
}

export interface DerivedSignal<T> extends Signal<T> {
  readonly value: T;
}

const SIGNAL = Symbol("signal"),
  Root = Symbol("root");

let batchDepth = 0,
  activeSub: Subscriber | null = null,
  activeRoot: RootNode | null = null;

//#region Public functions
export function signal<T>(): Signal<T | undefined>;
export function signal<T>(fn: () => T): DerivedSignal<T>;
export function signal<T>(value: T): Signal<T>;
export function signal<T>(valueOrFn?: T) {}

export function isSignal(value: any) {
  try {
    return SIGNAL in value;
  } catch {
    return false;
  }
}

export function batch(fn: () => void) {
  batchHandler.call(fn);
}

export function batchCallback<A extends unknown[], T = void>(
  fn: (...args: A) => T
) {
  return batchHandler.bind(fn as any) as typeof fn;
}

export function untrack<T = void>(fn: () => T) {
  const prevSub = activeSub;
  activeSub = null;
  try {
    return fn();
  } finally {
    activeSub = prevSub;
  }
}

export function effect(fn: () => void) {
  const e: EffectNode = {
    fn,
    subsHead: null,
    subsTail: null,
    depsHead: null,
    depsTail: null,
    tick: 0,
    flags: EFFECT,
  };
  if (activeSub) link(e, activeSub);
  else if (activeRoot) link(e, activeRoot);
  runEffect(e);
  return unlink.bind(e);
}

export function root(fn: (unlink: () => void) => void) {
  const r: RootNode = {
    depsHead: null,
    depsTail: null,
    flags: EFFECT,
    tick: 0,
    [Root]: true,
  };
  const prevRoot = activeRoot;
  activeRoot = r;
  startTracking(r);
  const u = unlink.bind(r);
  try {
    fn(u);
  } finally {
    activeRoot = prevRoot;
    endTracking(r);
  }
  return u;
}
//#endregion

//#region Internal functions
const { link, propagate, startTracking, endTracking, processEffects } =
  createReactiveSystem({
    updateComputed(computed: SignalNode) {
      if (typeof computed.getter !== "function") return false;
      const prevSub = activeSub;
      activeSub = computed;
      startTracking(computed);
      try {
        const oldValue = computed.currentValue;
        const newValue = computed.getter(oldValue);
        if (oldValue === newValue) return false;
        computed.currentValue = newValue;
        return true;
      } catch {
        return false;
      } finally {
        activeSub = prevSub;
        endTracking(computed);
      }
    },
    runEffect,
  });

function runEffect(e: EffectNode) {
  const prevSub = activeSub;
  activeSub = e;
  startTracking(e);
  try {
    e.fn();
  } finally {
    activeSub = prevSub;
    endTracking(e);
  }
}
//#endregion

//#region Bound functions
function batchHandler<A extends unknown[], T = void>(
  this: (...args: A) => T,
  ...args: A
) {
  batchDepth++;
  try {
    return this.apply(this, args);
  } finally {
    if (!--batchDepth) processEffects();
  }
}

function unlink(this: Subscriber) {
  startTracking(this);
  endTracking(this);
}
//#endregion
