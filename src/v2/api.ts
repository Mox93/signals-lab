import {
  COMPUTED,
  createReactiveSystem,
  EFFECT,
  type Flags,
  PENDING,
  type ReactiveNode,
  STALE,
} from "./system";

interface RootNode extends ReactiveNode {}

interface EffectNode extends ReactiveNode {
  fn(): void;
}

interface SignalNode<T = any> extends ReactiveNode {
  value: T;
}

interface ComputedNode<T = any> extends ReactiveNode {
  value: T | undefined;
  fn: (previousValue?: T) => T;
}

//#region Public functions
export function signal<T>(): {
  (): T | undefined;
  (value: T | undefined): void;
};
export function signal<T>(initialValue: T): {
  (): T;
  (value: T): void;
};
export function signal<T>(initialValue?: T): {
  (): T | undefined;
  (value: T | undefined): void;
} {
  return signalOpes.bind({
    value: initialValue,
    flags: 0 as Flags,
    run: {},
    runId: 0,
  }) as () => T | undefined;
}

export function computed<T>(fn: (previousValue?: T) => T): () => T {
  return computedOps.bind({
    value: undefined,
    flags: DERIVED,
    run: {},
    runId: 0,
    fn: fn as (previousValue?: unknown) => unknown,
  }) as () => T;
}

export function batch(fn: () => void) {
  batchHandler.call(fn);
}

export function batchCallback<A extends unknown[], T = void>(
  fn: (...args: A) => T
) {
  return batchHandler.bind(fn) as typeof fn;
}

export function untrack<T = void>(fn: () => T): T;
export function untrack(signalOrFn: Function) {
  const prevSub = activeSub;
  activeSub = undefined;
  try {
    return signalOrFn();
  } catch (error) {
  } finally {
    activeSub = prevSub;
  }
}

export function effect(fn: () => void) {
  const e: EffectNode = { fn, flags: EFFECT, run: {}, runId: 0 };
  if (activeSub) link(e, activeSub);
  else if (activeRoot) link(e, activeRoot);
  runEffect(e);
  return unlink.bind(e);
}

export function root(fn: (dispose: () => void) => void) {
  const r: RootNode = { flags: EFFECT, runId: 0 };
  if (activeRoot) link(r, activeRoot);
  const prevSub = activeSub;
  activeSub = undefined;
  const prevRoot = activeRoot;
  activeRoot = r;
  const dispose = unlink.bind(r);
  try {
    fn(dispose);
  } finally {
    activeRoot = prevRoot;
    activeSub = prevSub;
  }
  return dispose;
}
//#endregion

//#region Bound functions
function computedOps<T>(this: ComputedNode<T>): T {
  const flags = this.flags;
  if (flags & STALE || (flags & PENDING && settleDirty(this.depsHead!))) {
    if (updateComputed(this)) {
      const subsHead = this.subsHead;
      if (subsHead) shallowPropagate(subsHead);
    }
  } else if (flags & PENDING) this.flags = (flags & ~PENDING) as Flags;

  if (activeSub) link(this, activeSub);
  // else if (activeRoot) link(this, activeRoot);

  return this.value!;
}

function signalOpes<T>(this: SignalNode<T>, ...value: [T]): T | void {
  if (value.length) {
    const newValue = value[0];
    if (this.value !== (this.value = newValue)) {
      const subs = this.subsHead;
      if (subs) {
        propagate(subs);
        if (!batchDepth) flush();
      }
    }
  } else {
    if (activeSub) link(this, activeSub);
    return this.value;
  }
}

function batchHandler(this: Function, ...args: unknown[]) {
  batchDepth++;
  try {
    return this.apply(this, args);
  } catch (error) {
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
const batchQueue: (EffectNode | undefined)[] = [],
  DERIVED = (COMPUTED | STALE) as Flags;
let batchDepth = 0,
  batchSize = 0,
  batchIndex = 0,
  activeSub: ReactiveNode | undefined,
  activeRoot: RootNode | undefined;
const {
  link,
  startTracking,
  endTracking,
  propagate,
  checkDirty: settleDirty,
  shallowPropagate,
} = createReactiveSystem({
  update: updateComputed,
  notify(effect: EffectNode) {
    batchQueue[batchSize++] = effect;
  },
});

function updateComputed(c: ComputedNode) {
  const prevSub = activeSub;
  activeSub = c;
  startTracking(c);
  try {
    const newValue = c.fn();
    if (c.value === newValue) return false;
    c.value = newValue;
    return true;
  } catch (error) {
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
    if (
      (flags = effect.flags) & STALE ||
      (flags & PENDING && settleDirty(effect.depsHead!))
    )
      runEffect(effect);
  }
  batchSize = batchIndex = 0;
}
//#endregion
