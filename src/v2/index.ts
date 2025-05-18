import {
  COMPUTED,
  createReactiveSystem,
  EFFECT,
  type Flags,
  type LinkNode,
  PENDING,
  type ReactiveNode,
  RUNNING,
  STALE,
} from "./system";

const __DEV__ = true;

if (__DEV__) {
  const FLAGS = [
    ["COMPUTED", COMPUTED],
    ["EFFECT", EFFECT],
    ["STALE", STALE],
    ["PENDING", PENDING],
    ["RUNNING", RUNNING],
  ] as const;
  Object.assign(window, {
    flags(target: number) {
      const result: string[] = [];
      for (const [key, value] of FLAGS) if (target & value) result.push(key);
      console.log(result.toString());
    },
  });
}

interface RootNode extends ReactiveNode {}

interface EffectNode extends ReactiveNode {
  fn(): void;
}

interface SignalNode<T = unknown> extends ReactiveNode {
  currentValue: T;
  fn?(): T;
  signal: Signal<T>;
}

interface SignalBuilder<T = unknown> {
  <U>(fn: (value: T) => U): DerivedSignal<U>;
}

export interface Signal<T = unknown> extends SignalBuilder<T> {
  value: T;
}

interface BoundSignal<T = unknown> extends SignalBuilder<T> {
  (key: typeof SIGNAL): SignalNode<T>;
  source: {
    readonly [SIGNAL]: true;
    value: T;
  };
  computed: {
    readonly [SIGNAL]: true;
    readonly value: T;
  };
}

export interface DerivedSignal<T = unknown> extends SignalBuilder<T> {
  readonly value: T;
}

const SIGNAL = Symbol("signal"),
  DERIVED = (COMPUTED | STALE) as Flags,
  batchQueue: (EffectNode | undefined)[] = [];

let batchDepth = 0,
  batchIndex = 0,
  batchSize = 0,
  version = 0,
  activeSub: ReactiveNode | undefined,
  activeRoot: RootNode | undefined;

//#region Public functions
export function signal<T>(): Signal<T | undefined>;
export function signal<T>(fn: () => T): DerivedSignal<T>;
export function signal<T>(fn: () => T, initialValue: T): DerivedSignal<T>;
export function signal<T>(value: T): Signal<T>;
export function signal(valueOrFn?: unknown, initialValue?: unknown) {
  const instance =
    typeof valueOrFn === "function"
      ? Object.setPrototypeOf(
          _Signal.bind({
            currentValue: initialValue,
            fn: valueOrFn,
            flags: DERIVED,
            version: 0,
          }),
          _Signal.computed
        )
      : Object.setPrototypeOf(
          _Signal.bind({ currentValue: valueOrFn, flags: 0, version: 0 }),
          _Signal.source
        );
  instance(SIGNAL).signal = instance;
  return instance;
}

export function isSignal(value: any): value is Signal {
  try {
    return SIGNAL in value;
  } catch (error) {
    if (__DEV__) console.error(error);
    return false;
  }
}

export function batch(fn: () => void) {
  batchHandler.call(fn);
}

export function batched<A extends unknown[], T = void>(fn: (...args: A) => T) {
  return batchHandler.bind(fn) as typeof fn;
}

export function untrack<T>(signal: Signal<T>): T;
export function untrack<T = void>(fn: () => T): T;
export function untrack(signalOrFn: Function) {
  const prevSub = activeSub;
  activeSub = undefined;
  try {
    return isSignal(signalOrFn) ? signalOrFn.value : signalOrFn();
  } catch (error) {
    if (__DEV__) console.error(error);
  } finally {
    activeSub = prevSub;
  }
}

export function effect(fn: () => void) {
  const e: EffectNode = { fn, flags: EFFECT, version: 0 };
  if (activeSub) link(e, activeSub);
  else if (activeRoot) link(e, activeRoot);
  runEffect(e);
  return unlink.bind(e);
}

export function root(fn: (dispose: () => void) => void) {
  const r: RootNode = { flags: EFFECT, version: 0 };
  const prevSub = activeSub;
  activeSub = undefined;
  const prevRoot = activeRoot;
  activeRoot = r;
  const dispose = unlink.bind(r);
  try {
    fn(dispose);
  } catch (error) {
    if (__DEV__) console.error(error);
  } finally {
    activeRoot = prevRoot;
    activeSub = prevSub;
  }
  return dispose;
}
//#endregion

//#region Bound functions
const _Signal = function (this: SignalNode, keyOrFn: typeof SIGNAL | Function) {
  if (keyOrFn === SIGNAL) return this;
  // `this.signal` could be a source or a computed signal
  return signal(() => keyOrFn(this.signal.value));
} as BoundSignal;

_Signal.source = {} as BoundSignal["source"];
_Signal.computed = {} as BoundSignal["computed"];

markSignal(_Signal.source);
markSignal(_Signal.computed);

Object.defineProperty(_Signal.source, "value", {
  get(this: BoundSignal) {
    const node = this(SIGNAL);
    if (activeSub) link(node, activeSub);
    return node.currentValue;
  },
  set(this: BoundSignal, value: unknown) {
    const node = this(SIGNAL);
    if (node.currentValue === value) return;
    node.currentValue = value;
    const subs = node.subsHead;
    if (subs) {
      node.version = ++version;
      propagate(subs);
      if (!batchDepth) flush();
    }
  },
});

Object.defineProperty(_Signal.computed, "value", {
  get(this: BoundSignal) {
    const node = this(SIGNAL),
      flags = node.flags;
    if (activeSub && activeSub !== node) link(node, activeSub);
    if (flags & STALE || (flags & PENDING && checkDirty(node.depsHead!)))
      updateComputed(node);
    return node.currentValue;
  },
});

function batchHandler(this: Function, ...args: unknown[]) {
  batchDepth++;
  try {
    return this.apply(this, args);
  } catch (error) {
    if (__DEV__) console.error(error);
  } finally {
    if (!--batchDepth) flush();
  }
}

function unlink(this: ReactiveNode) {
  startTracking(this);
  endTracking(this);
}
//#endregion

//#region Internal functions
const { link, startTracking, endTracking, propagate, checkDirty } =
  createReactiveSystem({
    update: updateComputed,
    notify(effect: EffectNode) {
      batchQueue[batchSize++] = effect;
    },
  });

function updateComputed(computed: SignalNode) {
  const prevSub = activeSub;
  activeSub = computed;
  startTracking(computed);
  try {
    const newValue = computed.fn!();
    if (computed.currentValue === newValue) return false;
    computed.currentValue = newValue;
    computed.version = ++version;
    return true;
  } catch (error) {
    if (__DEV__) console.error(error);
    return false;
  } finally {
    endTracking(computed);
    activeSub = prevSub;
  }
}

function runEffect(e: EffectNode) {
  const prevSub = activeSub;
  activeSub = e;
  startTracking(e);
  try {
    e.fn();
    e.version = ++version;
  } catch (error) {
    if (__DEV__) console.error(error);
  } finally {
    endTracking(e);
    activeSub = prevSub;
  }
}

function flush() {
  let effect: EffectNode, link: LinkNode | undefined, flags: Flags;

  while (batchIndex < batchSize) {
    effect = batchQueue[batchIndex]!;
    batchQueue[batchIndex++] = undefined;
    if (
      (flags = effect.flags) & STALE ||
      (flags & PENDING && (link = effect.depsHead) && checkDirty(link))
    )
      runEffect(effect);
  }
  batchSize = batchIndex = 0;
}

function markSignal(prototype: Record<string | symbol, unknown>) {
  Object.defineProperty(prototype, SIGNAL, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}
//#endregion
