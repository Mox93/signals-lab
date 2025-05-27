import {
  COMPUTED,
  createReactiveSystem,
  EFFECT,
  type Flags,
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
  Object.assign(globalThis, {
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
  value: T;
  fn?(): T;
  producer<T>(fn: () => T, initialValue?: T): DerivedSignal<T>;
  source: { readonly value: T };
}

interface ComputedNode<T = unknown> extends ReactiveNode {
  value?: T;
  fn(previousValue: T | undefined): T;
  producer<T>(fn: (previousValue: T | undefined) => T): DerivedSignal<T>;
  source: { readonly value: T };
}

interface NodeHolder<T extends SignalNode | ComputedNode> {
  (key: typeof SIGNAL): T;
}

interface SignalProducer<T = unknown> {
  <U>(fn: (value: T) => U): DerivedSignal<U>;
}

export interface Signal<T = unknown> extends SignalProducer<T> {
  value: T;
}

export interface DerivedSignal<T = unknown> extends SignalProducer<T> {
  readonly value: T;
}

/**
 * const x = signal(1);
 * const y = x(v => v + 1); // evaluates on push
 * const z = signal(() => x.value + y.value); // evaluates on push
 * const a = computed(() => Array.from({length: x.value}), () => "Hello World"); // evaluates on pull
 * const b = a(v => v[0].toUpperCase());  // evaluates on pull
 */

//#region Public functions
export function signal<T>(): Signal<T | undefined>;
export function signal<T>(fn: () => T): DerivedSignal<T>;
export function signal<T>(fn: () => T, initialValue: T): DerivedSignal<T>;
export function signal<T>(value: T): Signal<T>;
export function signal(valueOrFn?: unknown, initialValue?: unknown) {
  let node: SignalNode;
  const instance =
    typeof valueOrFn === "function"
      ? Object.setPrototypeOf(
          factory.bind(
            (node = {
              value: initialValue,
              fn: valueOrFn as () => unknown,
              flags: STALE,
              // version: 0,
              producer: signal,
              source: null as never,
            })
          ),
          readOnlyValue
        )
      : Object.setPrototypeOf(
          factory.bind(
            (node = {
              value: valueOrFn,
              flags: 0 as Flags,
              // version: 0,
              producer: signal,
              source: null as never,
            })
          ),
          readWriteValue
        );
  node.source = instance;
  return instance;
}

export function computed<T>(
  fn: (previousValue: T | undefined) => T
): DerivedSignal<T>;
export function computed<T>(
  fn: (previousValue: T) => T,
  initialValue: T
): DerivedSignal<T>;
export function computed(
  fn: (previousValue: unknown) => unknown,
  initialValue?: unknown
) {
  let node: ComputedNode;
  const instance = Object.setPrototypeOf(
    factory.bind(
      (node = {
        value: initialValue,
        fn,
        flags: NEW_COMPUTED,
        // version: 0,
        producer: computed,
        source: null as never,
      })
    ),
    readOnlyValue
  );

  node.source = instance;
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
  const e: EffectNode = { fn, flags: EFFECT /* version: 0 */ };
  if (activeSub) link(e, activeSub);
  else if (activeRoot) link(e, activeRoot);
  runEffect(e);
  return unlink.bind(e);
}

export function root(fn: (dispose: () => void) => void) {
  const r: RootNode = { flags: EFFECT /* version: 0 */ };
  if (activeRoot) link(r, activeRoot);
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
function factory<T extends SignalNode | ComputedNode>(
  this: T,
  key: typeof SIGNAL
): T;
function factory<T extends SignalNode | ComputedNode>(
  this: T,
  fn: Function,
  initialValue?: unknown
): DerivedSignal;
function factory(
  this: SignalNode | ComputedNode,
  keyOrFn: typeof SIGNAL | Function,
  initialValue?: unknown
) {
  if (keyOrFn === SIGNAL) return this;
  return this.producer(() => keyOrFn(this.source.value), initialValue);
}

const readWriteValue = Object.defineProperty(markedSignal(), "value", {
  get(this: NodeHolder<SignalNode>) {
    const node = this(SIGNAL);
    if (activeSub) link(node, activeSub);
    return node.value;
  },
  set(this: NodeHolder<SignalNode>, value: unknown) {
    const node = this(SIGNAL);
    if (node.value === value) return;
    node.value = value;
    const subs = node.subsHead;
    if (subs) {
      // node.version = ++version;
      propagate(subs);
      if (!batchDepth) flush();
    }
  },
});

const readOnlyValue = Object.defineProperty(markedSignal(), "value", {
  get(this: NodeHolder<ComputedNode>) {
    const node = this(SIGNAL),
      flags = node.flags;
    if (activeSub && activeSub !== node) link(node, activeSub);
    if (flags & STALE || (flags & PENDING && checkDirty(node.depsHead!)))
      if (updateComputed(node)) {
        const subsHead = node.subsHead;
        if (subsHead) shallowPropagate(subsHead);
      }
    return node.value;
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
const SIGNAL = Symbol("signal"),
  QUEUED = (1 << 5) as Flags,
  NEW_COMPUTED = (COMPUTED | STALE) as Flags,
  batchQueue: (EffectNode | undefined)[] = [];

let batchDepth = 0,
  batchIndex = 0,
  batchSize = 0,
  // version = 0,
  activeSub: ReactiveNode | undefined,
  activeRoot: RootNode | undefined;

const {
  link,
  startTracking,
  endTracking,
  propagate,
  checkDirty,
  shallowPropagate,
} = createReactiveSystem({
  update: updateComputed,
  notify(effect: EffectNode) {
    const flags = effect.flags;

    if (!(flags & QUEUED)) {
      batchQueue[batchSize++] = effect;
      effect.flags = (flags | QUEUED) as Flags;
    }
  },
});

function updateComputed(c: ComputedNode) {
  const prevSub = activeSub;
  activeSub = c;
  startTracking(c);
  try {
    const oldValue = c.value;
    const newValue = c.fn(oldValue);
    if (newValue === oldValue) return false;
    c.value = newValue;
    // c.version = ++version;
    return true;
  } catch (error) {
    if (__DEV__) console.error(error);
    return false;
  } finally {
    endTracking(c);
    activeSub = prevSub;
  }
}

function runEffect(e: EffectNode) {
  const prevSub = activeSub;
  activeSub = e;
  startTracking(e);
  try {
    e.fn();
    // e.version = ++version;
  } catch (error) {
    if (__DEV__) console.error(error);
  } finally {
    endTracking(e);
    activeSub = prevSub;
  }
}

function flush() {
  let effect: EffectNode, flags: Flags;

  while (batchIndex < batchSize) {
    effect = batchQueue[batchIndex]!;
    batchQueue[batchIndex++] = undefined;
    flags = effect.flags;
    effect.flags = (flags & ~QUEUED) as Flags;

    if (flags & STALE || (flags & PENDING && checkDirty(effect.depsHead!)))
      runEffect(effect);
  }
  batchSize = batchIndex = 0;
}

function markedSignal() {
  return Object.defineProperty({}, SIGNAL, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  }) as { readonly [SIGNAL]: true; value: unknown };
}
//#endregion
