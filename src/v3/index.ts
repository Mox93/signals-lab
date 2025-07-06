import {
  COMPUTED,
  EFFECT,
  endTracking,
  Flags,
  createQueueFlush,
  link,
  queuePush,
  ReactiveNode,
  STALE,
  startTracking,
} from "./system";

const __DEV__ = true;

interface RootNode extends ReactiveNode {}

interface EffectNode extends ReactiveNode {
  fn(): void;
}

interface SignalNode<T = unknown> extends ReactiveNode {
  value: T;
  fn?(): T;
  producer<T>(fn: () => T, initialValue?: T): DerivedSignal<T>;
  source: { readonly value: T };
  version: number;
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

//#region variables
const SIGNAL = Symbol("signal"),
  NEW_COMPUTED = (COMPUTED | STALE) as Flags,
  BRAND_VALUE = {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  } as const;

let id = 0,
  batchDepth = 0,
  version = 0,
  activeSub: ReactiveNode | undefined,
  activeRoot: RootNode | undefined;
//#endregion

//#region Public functions
export function signal<T>(): Signal<T | undefined>;
export function signal<T>(fn: () => T): DerivedSignal<T>;
export function signal<T>(fn: () => T, initialValue: T): DerivedSignal<T>;
export function signal<T>(value: T): Signal<T>;
export function signal(valueOrFn?: unknown, initialValue?: unknown) {
  let node: SignalNode | ComputedNode;
  const instance =
    typeof valueOrFn === "function"
      ? derivedFactory.bind(
          (node = {
            id: id++,
            value: initialValue,
            fn: valueOrFn as () => unknown,
            flags: NEW_COMPUTED,
            run: {},
            runId: 0,
            depth: -1,
            producer: signal,
            source: null as never,
          })
        )
      : sourceFactory.bind(
          (node = {
            id: id++,
            value: valueOrFn,
            flags: 0 as Flags,
            run: {},
            runId: 0,
            depth: -1,
            producer: signal,
            source: null as never,
            version: -1,
          })
        );
  node.source = instance;
  return instance;
}

export function isSignal(value: any): value is Signal {
  return value?.[SIGNAL] === true;
}

export function batch(fn: () => void) {
  batchHandler.call(fn);
}

export function batchCallback<A extends unknown[], T = void>(
  fn: (...args: A) => T
) {
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
  const e: EffectNode = {
    id: id++,
    fn,
    flags: EFFECT,
    run: {},
    runId: 0,
    depth: -1,
  };
  runEffect(e);
  if (activeSub) link(e, activeSub);
  else if (activeRoot) link(e, activeRoot);
  return unlink.bind(e);
}

export function root(fn: (dispose: () => void) => void) {
  const r: RootNode = { id: id++, flags: EFFECT, runId: 0, depth: -1 };
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

//#region Internal functions
const queueFlush = createQueueFlush({ updateComputed, runEffect });

function updateComputed(c: ComputedNode) {
  const prevSub = activeSub;
  activeSub = c;
  startTracking(c);
  try {
    const oldValue = c.value;
    const newValue = c.fn(oldValue);
    if (newValue === oldValue) return false;
    c.value = newValue;
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
  } catch (error) {
    if (__DEV__) console.error(error);
  } finally {
    endTracking(e);
    activeSub = prevSub;
  }
}

function factory(): {
  <T extends SignalNode | ComputedNode>(this: T, key: typeof SIGNAL): T;
  <T extends SignalNode | ComputedNode>(
    this: T,
    fn: Function,
    initialValue?: unknown
  ): DerivedSignal;
} {
  return function (this, keyOrFn, initialValue?: unknown) {
    if (keyOrFn === SIGNAL) return this;
    return this.producer(() => keyOrFn(this.source.value), initialValue);
  };
}
//#endregion

//#region Bound functions
const sourceFactory = Object.setPrototypeOf(
  factory(),
  Object.create(Function.prototype, {
    [SIGNAL]: BRAND_VALUE,
    value: {
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
          if (batchDepth) {
            if (node.version !== version) {
              node.version = version;
              queuePush(subs);
            }
          } else {
            queuePush(subs);
            queueFlush();
          }
        }
      },
    },
  })
);

const derivedFactory = Object.setPrototypeOf(
  factory(),
  Object.create(Function.prototype, {
    [SIGNAL]: BRAND_VALUE,
    value: {
      get(this: NodeHolder<ComputedNode>) {
        const node = this(SIGNAL),
          isStale = node.flags & STALE;
        if (isStale) updateComputed(node);
        if (activeSub && activeSub !== node) {
          const depDepth = node.depth,
            subDepth = activeSub.depth;
          link(node, activeSub);
          if (depDepth > subDepth) queueFlush(depDepth);
        }

        return node.value;
      },
    },
  })
);

function batchHandler(this: Function, ...args: unknown[]) {
  batchDepth++;
  try {
    return this.apply(this, args);
  } catch (error) {
    if (__DEV__) console.error(error);
  } finally {
    if (!--batchDepth) {
      queueFlush();
      version++;
    }
  }
}

function unlink(this: ReactiveNode) {
  startTracking(this);
  endTracking(this);
}
//#endregion
