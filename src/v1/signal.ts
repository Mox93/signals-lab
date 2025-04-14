import { assert, Callable, counter, generateId } from "./utils";

export interface Signal<T = unknown> {
  <U>(fn: (value: T) => U): DerivedSignal<U>;
  // @ts-ignore
  // map: T extends (infer I)[] | { [key: string | symbol | number]: infer I }
  //   ? <E, F>(
  //       fn: (item: I, index: keyof T, obj: T) => E,
  //       fallback: F
  //     ) => DerivedSignal<E[] | F | undefined>
  //   : never;
}

export class Signal<T = unknown> extends Callable {
  constructor(valueOrFn: T | (() => T)) {
    super();
    graph.addSignal(this, valueOrFn);
  }

  protected _call<U>(fn: (value: T) => U) {
    return new Signal<U>(() => fn(this.value));
  }

  get value() {
    return graph.getValue(this) as T;
  }

  set value(value: T) {
    if (typeof value !== "function") graph.setValue(this, value);
  }

  set(value: T): void;
  set(fn: (value: T) => T): void;
  set(valueOrFn: T | ((value: T) => T)) {
    graph.setValue(this, valueOrFn);
  }

  peek() {
    return untrack(this);
  }

  // TODO properly implement methods (map, and, or)

  and<E, F>(truthy: E, falsy?: F) {
    return this((value) => (value ? truthy : falsy));
  }

  or<F, E>(falsy: F, truthy?: E) {
    return this((value) => (value ? truthy : falsy));
  }
}

export class ArraySignal<T extends unknown[]> extends Signal<T> {
  map<E, F>(
    callback: (item: T[number], index: number, obj: T) => E,
    fallback?: F
  ) {
    return this((value) => {
      let result: E[] = [],
        i: number,
        len = value.length;
      for (i = 0; i < len; i++) result.push(callback(value[i], i, value));
      return result.length ? result : fallback;
    });
  }
}

// TODO wrap signal value with this
export const reactive = (() => {
  const PROXY = Symbol("proxy");
  return function wrapper<T extends {}>(target: T): T {
    type K = keyof T;
    if (target[PROXY as K]) return target;
    return new Proxy(target, {
      get(target, prop) {
        if (prop === PROXY) return true;
        const value = target[prop as K];
        return typeof value === "object" && value ? wrapper(value) : value;
      },
      set(target, prop, value) {
        if (prop === PROXY) return false;
        if (value === target[prop as K]) return true;
        target[prop as K] = value;
        return true;
      },
      deleteProperty(target, prop) {
        if (prop === PROXY) return false;
        delete target[prop as K];
        return true;
      },
    });
  };
})();

export interface DerivedSignal<T = unknown> extends Omit<Signal<T>, "set"> {
  <U>(fn: (value: T) => U): DerivedSignal<U>;
  readonly value: T;
}

export function signal<T>(): Signal<T | undefined>;
export function signal<T>(fn: () => T): DerivedSignal<T>;
export function signal<T>(value: T): Signal<T>;
export function signal<T>(value?: T) {
  return new Signal(value);
}

interface BatchOptions {
  isolated?: boolean;
}

export interface Batch {
  (isolated?: boolean): void;
}

export class Batch extends Callable {
  constructor(callback: () => void) {
    super();
    graph.addBatch(this, callback);
  }

  protected _call(isolated?: boolean) {
    graph.runBatch(this, isolated);
  }
}

export function batch(callback: () => void, options?: BatchOptions) {
  new Batch(callback)(options?.isolated);
}

export function batchCallback<A extends unknown[], R = void>(
  callback: (...args: A) => R,
  options?: BatchOptions
) {
  let _args!: A, result!: R;
  const batch = new Batch(() => {
    result = callback.apply(callback, _args);
  });
  return (...args: A) => {
    _args = args;
    batch(options?.isolated);
    return result;
  };
}

export interface Effect {
  (): void;
}

export class Effect extends Callable {
  constructor(callback: () => void, deferred?: boolean) {
    super();
    graph.addEffect(this, callback, deferred);
  }

  protected _call() {
    graph.runEffect(this);
  }
}

export function effect(callback: () => void) {
  new Effect(batchCallback(callback), true)();
}

export function inlineEffect(callback: () => void) {
  new Effect(batchCallback(callback))();
}

const graph = (() => {
  interface GraphNode {
    owner: GraphNode | null;
    owned?: GraphNode[];
    cleanups?: (() => void)[];
  }

  type Phase = number & { brand: "phase" };

  interface ReactiveNode {
    index: number;
    phase: Phase;
    type: typeof SIGNAL | typeof EFFECT;
    updatedAt: number;
    sources?: Record<number, SignalNode>;
  }

  interface SignalNode extends GraphNode, ReactiveNode {
    value: unknown;
    type: typeof SIGNAL;
    computed?: unknown;
    [EFFECT]?: Record<number, EffectNode>;
    [SIGNAL]?: Record<number, SignalNode>;
  }

  interface EffectNode extends GraphNode, ReactiveNode {
    fn(): void;
    type: typeof EFFECT;
    deferred?: boolean;
  }

  interface BatchNode {
    id: string;
    depth: number;
    fn(): void;
    updates?: Map<number, EffectNode>;
    uMinMax?: [number, number];
    effects?: Map<number, EffectNode>;
    eMinMax?: [number, number];
  }

  let currentObserver: SignalNode | EffectNode | null = null,
    currentOwner: GraphNode | null = null,
    currentBatch: BatchNode | null = null,
    flushingBatch = false,
    pendingBatches = new Map<Batch, boolean | undefined>();

  const NODE = Symbol("node"),
    SIGNAL = Symbol("signal"),
    EFFECT = Symbol("effect"),
    STALE = (1 << 0) as Phase,
    PENDING = (1 << 1) as Phase,
    COMPUTED = (1 << 2) as Phase,
    signalIndex = counter(),
    updateIndex = counter(),
    effectIndex = counter(),
    updateTime = counter();

  function addToOwner(node: GraphNode) {
    if (currentOwner)
      if (currentOwner.owned) currentOwner.owned.push(node);
      else currentOwner.owned = [node];
  }

  function setNode(target: Signal<any>, node: SignalNode): Signal<any>;
  function setNode(target: Effect, node: EffectNode): Effect;
  function setNode(target: Batch, node: BatchNode): Batch;
  function setNode(target: any, value: any) {
    return Object.defineProperty(target, NODE, {
      value,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  function getNode(target: Signal<any>): SignalNode;
  function getNode(target: Effect): EffectNode;
  function getNode(target: Batch): BatchNode;
  function getNode(target: any) {
    return target[NODE];
  }

  function disconnect(
    signal: SignalNode,
    observer: Pick<ReactiveNode, "sources" | "type" | "index">
  ) {
    delete signal[observer.type]?.[observer.index];
    delete observer.sources?.[signal.index];
  }

  function cleanup(node: GraphNode & Pick<ReactiveNode, "sources">) {
    const cleanups = node.cleanups;
    if (cleanups) {
      let fn;
      for (fn of cleanups)
        try {
          fn();
        } catch (error) {
          console.error(error);
        }
      delete node.cleanups;
    }
    const owned = node.owned;
    if (owned) {
      let child;
      for (child of owned) cleanup(child);
      delete node.owned;
    }
    const sources = node.sources;
    if (sources) {
      let key;
      for (key in sources) disconnect(sources[key], node as any);
      delete node.sources;
    }
  }

  function updateComputed(signal: SignalNode) {
    assert(signal.phase !== PENDING, "Circular dependency detected");

    const previousObserver = currentObserver,
      phase = signal.phase;
    currentObserver = signal;
    signal.phase = PENDING;
    try {
      // TODO dispose of previous dependencies
      cleanup(signal);
      const computed = (signal.value as () => unknown)();
      signal.phase = COMPUTED;
      if (computed === signal.computed) return;
      signal.computed = computed;
      signal.updatedAt = updateTime();
    } catch (error) {
      console.error(error);
      signal.phase = phase;
    } finally {
      currentObserver = previousObserver;
    }
  }

  function updateSource(signal: SignalNode) {
    if (signal.phase === COMPUTED) return signal.updatedAt;

    let wasUpdated = false,
      updatedAt: number;
    if (signal.sources) {
      let key, source: SignalNode;
      for (key in signal.sources) {
        source = signal.sources[key];
        updatedAt =
          source.phase === STALE ? updateSource(source) : source.updatedAt;
        if (!wasUpdated) wasUpdated = signal.updatedAt < updatedAt;
      }
    }
    if (wasUpdated || signal.updatedAt < 0) updateComputed(signal);

    return signal.updatedAt;
  }

  function runEffectNode(effect: EffectNode) {
    if (effect.phase === PENDING) return console.warn("Cycle detected");
    if (effect.phase === COMPUTED) return;
    let wasUpdated = false,
      updatedAt: number,
      sources = effect.sources;
    if (sources) {
      let key;
      for (key in sources) {
        updatedAt = updateSource(sources[key]);
        if (!wasUpdated) wasUpdated = effect.updatedAt < updatedAt;
      }
    }

    if (wasUpdated || effect.updatedAt < 0) {
      const previousObserver = currentObserver,
        phase = effect.phase;
      currentObserver = effect;
      effect.phase = PENDING;
      try {
        cleanup(effect);
        effect.fn();
        effect.updatedAt = updateTime();
        effect.phase = COMPUTED;
      } catch (error) {
        console.error(error);
        effect.phase = phase;
      } finally {
        currentObserver = previousObserver;
      }
    }
  }

  /**
   * TODO make sure order is maintained
   *
   *      a
   *    /   \
   *   b     c
   *  / \   / \
   * d   e f   g
   *
   * currently
   * a -> b -> d -> e -> c -> f -> g
   */
  function propagate(node: SignalNode) {
    // ? Handel effect observers if available
    const effects = node[EFFECT];
    if (effects) {
      let key, effect: EffectNode;
      if (currentBatch) {
        let index: number, minMax: [number, number];
        for (key in effects) {
          effect = effects[key];
          if (effect.phase === STALE) continue;
          effect.phase = STALE;
          index = effect.index;
          if (effect.deferred) {
            minMax = currentBatch.eMinMax!;
            currentBatch.effects!.set(index, effect);
          } else {
            minMax = currentBatch.uMinMax!;
            currentBatch.updates!.set(index, effect);
          }
          if (index < minMax[0]) minMax[0] = index;
          if (index > minMax[1]) minMax[1] = index;
        }
      } else
        for (key in effects) {
          effect = effects[key];
          effect.phase = STALE;
          runEffectNode(effect);
        }
    }

    // ? Handle signal observers if available
    const signals = node[SIGNAL];
    if (signals) {
      let key, signal: SignalNode;
      for (key in signals) {
        signal = signals[key];
        if (signal.phase === STALE) continue;
        signal.phase = STALE;

        // // ? Skip computation if there are no observers
        // if (!signal[EFFECT]?.size && !signal[SIGNAL]?.size) continue;

        // const lastUpdate = signal.updatedAt;
        // runComputedValue(signal);

        // // ? Skip propagation if no update happened
        // if (lastUpdate === signal.updatedAt) continue;

        propagate(signal);
      }
    }
  }

  function resolve<T>(signalOrFn: Signal<T> | (() => T)) {
    return signalOrFn instanceof Signal ? signalOrFn.value : signalOrFn();
  }

  return {
    addSignal<T>(signal: Signal<T>, value: unknown) {
      const computedSignal = typeof value === "function",
        node: SignalNode = {
          value,
          index: signalIndex(),
          type: SIGNAL,
          phase: computedSignal ? STALE : COMPUTED,
          updatedAt: computedSignal ? -1 : 0,
          owner: currentOwner,
        };
      setNode(signal, node);
      addToOwner(node);
    },

    addEffect(effect: Effect, callback: () => void, deferred?: boolean) {
      const node: EffectNode = {
        fn: callback,
        index: deferred ? effectIndex() : updateIndex(),
        type: EFFECT,
        phase: STALE,
        updatedAt: -1,
        deferred,
        owner: currentOwner,
      };
      setNode(effect, node);
      addToOwner(node);
    },

    addBatch(batch: Batch, fn: () => void) {
      setNode(batch, { id: generateId(), fn, depth: 0 });
    },

    getValue<T>(signal: Signal<T>) {
      const node = getNode(signal);

      if (currentObserver) {
        const key = currentObserver.type,
          currentIndex = currentObserver.index,
          index = node.index;
        if (!node[key]) node[key] = { [currentIndex]: currentObserver } as any;
        else node[key][currentIndex] = currentObserver as any;
        if (!currentObserver.sources)
          currentObserver.sources = { [index]: node };
        else currentObserver.sources[index] = node;
      }
      if (typeof node.value !== "function") return node.value;

      // ? Resolve computed value
      if (node.phase === STALE) updateComputed(node);

      return node.computed;
    },

    setValue<T>(signal: Signal<T>, valueOrFn: T | ((value: T) => T)) {
      const node = getNode(signal);

      // ? Skip if computed signal
      if (typeof node.value === "function") return;

      const value =
        typeof valueOrFn === "function"
          ? untrack(() =>
              (valueOrFn as (value: unknown) => unknown)(node.value)
            )
          : valueOrFn;

      // ? Skip if value didn't change
      if (node.value === value) return;

      node.value = value;
      node.updatedAt = updateTime();
      propagate(node);
    },

    runEffect(effect: Effect) {
      const node = getNode(effect),
        index = node.index;
      // TODO the goal here is to have the effect not run right away so we need to validate if this will work
      if (node.deferred && currentBatch) {
        currentBatch.updates!.set(index, node);
        const minMax = currentBatch.uMinMax!;
        if (index < minMax[0]) minMax[0] = index;
        if (index > minMax[1]) minMax[1] = index;
      } else runEffectNode(node);
    },

    runBatch(batch: Batch, isolated: boolean | undefined, shallow?: boolean) {
      if (flushingBatch) {
        pendingBatches.set(batch, isolated);
        return;
      }

      // ? if not isolated use the current batch if available otherwise use the provided one
      const node = (!isolated && currentBatch) || getNode(batch);

      const previousBatch = currentBatch;
      currentBatch = node;
      if (!node.depth) {
        node.updates = new Map();
        node.uMinMax = [Infinity, 0];
        node.effects = new Map();
        node.eMinMax = [Infinity, 0];
      }
      node.depth++;

      try {
        node.fn();
      } catch (error) {
        console.error(error);
      } finally {
        node.depth--;
        currentBatch = previousBatch;
      }

      if (!node.depth)
        try {
          flushingBatch = true;
          let i: number,
            min: number,
            max: number,
            effect: EffectNode | undefined;

          ([min, max] = node.uMinMax!), max++;
          for (i = min; i < max; i++)
            if ((effect = node.updates!.get(i))) runEffectNode(effect);
          if (node.updates!.size)
            console.log(`* update gaps: ${max - min - node.updates!.size}`);

          ([min, max] = node.eMinMax!), max++;
          for (i = min; i < max; i++)
            if ((effect = node.effects!.get(i))) runEffectNode(effect);
          if (node.effects!.size)
            console.log(`* effect gaps: ${min - max - node.effects!.size}`);
        } catch (error) {
          console.error(error);
        } finally {
          flushingBatch = false;
          node.updates = node.uMinMax = node.effects = node.eMinMax = undefined;
        }

      if (shallow) return;

      let count = 0;

      while (pendingBatches.size) {
        const queue = pendingBatches;
        // ? in case new batches were added while running the current one
        pendingBatches = new Map();
        // TODO need to test how this behaves in terms of batch execution order
        for (const [batch, isolated] of queue)
          this.runBatch(batch, isolated, true);

        assert(count++ < 1e4, "Potential infinite loop");
      }
    },

    root<T>(fn: (dispose: () => void) => T) {
      let previousOwner = currentOwner,
        root: GraphNode | null = { owner: null };
      currentOwner = root;

      try {
        return fn(() => {
          if (root) cleanup(root);
        });
      } finally {
        currentOwner = previousOwner;
        if (!fn.length) root = null;
      }
    },

    onCleanup(callback: () => void) {
      if (!currentOwner) return;
      if (currentOwner.cleanups) currentOwner.cleanups.push(callback);
      else currentOwner.cleanups = [callback];
    },

    untrack<T>(signalOrFn: Signal<T> | (() => T)) {
      const previousObserver = currentObserver;
      currentObserver = null;
      try {
        return resolve(signalOrFn);
      } finally {
        currentObserver = previousObserver;
      }
    },

    anchor(): {
      track: <T>(signalOrFn: Signal<T> | (() => T)) => T;
      eject(signal: Signal): void;
    } {
      if (currentObserver) {
        const observer = currentObserver;
        return {
          track(signalOrFn) {
            const previousObserver = currentObserver;
            currentObserver = observer;
            try {
              return resolve(signalOrFn);
            } finally {
              currentObserver = previousObserver;
            }
          },
          eject(signal) {
            disconnect(getNode(signal), observer);
          },
        };
      }
      return { track: resolve, eject: () => {} };
    },
  };
})();

export const anchor = graph.anchor.bind(graph);
export const onCleanup = graph.onCleanup.bind(graph);
export const root = graph.root.bind(graph);
export const untrack = graph.untrack.bind(graph);
