interface Bucket<T> {
  depth: number;
  subs: (T | undefined)[];
  size: number;
  index: number;
  slot?: number;
}

interface MinHeapOptions<T> {
  run: (node: T) => void;
  propagate?: (node: T) => void;
}

export interface HeapNode {
  id: number;
  depth: number;
  slot?: number;
}

export interface HeapLink<T> {
  sub: T;
  nextSub?: HeapLink<T>;
}

export interface MinHeapTestOptions<T> extends MinHeapOptions<T> {
  testMode?: true;
}

export interface MinHeapTest {
  __test__: {};
}

export function createMinHeap<T extends HeapNode>(options: MinHeapOptions<T>) {
  const { run, propagate, testMode } = options as MinHeapTestOptions<T>,
    cache: (Bucket<T> | undefined)[] = [],
    heap: (Bucket<T> | undefined)[] = [];
  let heapSize = 0,
    isFlushing = false;

  const methods = { enqueue, flush, flushing };

  if (testMode)
    Object.defineProperty(methods, "__test__", {
      value: {
        get cache() {
          return cache;
        },
        get queue() {
          return heap;
        },
        get heapSize() {
          return heapSize;
        },
        clear() {
          cache.length = heap.length = heapSize = 0;
          isFlushing = false;
        },
        getBucket(depth: number) {
          return cache[depth];
        },
      },
    });

  return methods;

  function enqueue(link: HeapLink<T>, parentDepth: number) {
    const minDepth = parentDepth + 1,
      subList = [];
    let sub: T,
      slot: number | undefined,
      depth: number,
      bucket: Bucket<T> | undefined,
      head: Bucket<T> | undefined,
      subs: (T | undefined)[],
      i: number,
      pushedDown = false;

    do {
      slot = (sub = link.sub).slot;
      subList.push(`id: ${sub.id}, depth: ${sub.depth}`);

      if ((depth = sub.depth) > parentDepth) {
        if (slot !== undefined) continue;
      } else {
        if (slot !== undefined && (bucket = cache[depth])) {
          subs = bucket.subs;
          if (slot !== (i = --bucket.size)) subs[slot] = subs[i];
          subs[i] = undefined;
        }

        sub.depth = depth = minDepth;
        pushedDown = true;
      }

      if ((bucket = cache[depth]))
        bucket.subs[(sub.slot = bucket.size++)] = sub;
      else
        cache[depth] = bucket = {
          depth,
          subs: [sub],
          size: 1,
          index: (sub.slot = 0),
        };

      if (bucket.slot === undefined) {
        if (heapSize && (head = heap[0]) && head.index === head.size) {
          head.size = head.index = 0;
          head.slot = undefined;
          heap[(bucket.slot = 0)] = bucket;
          heapDown(bucket);
        } else {
          heap[(bucket.slot = heapSize++)] = bucket;
          heapUp(bucket);
        }
      }
      if (pushedDown && propagate) propagate(sub);
    } while ((link = link.nextSub!));
  }

  function flush() {
    if (!heapSize) return;
    isFlushing = true;

    let sub: T, bucket: Bucket<T>, subs: (T | undefined)[], i: number;

    while (true) {
      // TODO if a bucket was enqueued with a lower depth than the one currently running, them we need to investigate it.
      bucket = heap[0]!;
      i = bucket.index;

      while (i < bucket.size) {
        sub = (subs = bucket.subs)[i]!;
        subs[i] = sub.slot = undefined;
        bucket.index = ++i;
        run(sub);
      }

      if (bucket.slot !== undefined) {
        bucket.size = bucket.index = 0;
        bucket.slot = undefined;
        heap[0] = bucket = heap[--heapSize]!;
        heap[heapSize] = undefined;

        if (heapSize) {
          bucket.slot = 0;
          heapDown(bucket);
        } else break;
      }
    }

    isFlushing = false;
  }

  function flushing() {
    return isFlushing;
  }

  function heapUp(bucket: Bucket<T>) {
    const depth = bucket.depth;
    let i = bucket.slot!,
      j: number,
      parent: Bucket<T>;

    while (i && depth < (parent = heap[(j = (i - 1) >> 1)]!).depth) {
      heap[(parent.slot = i)] = parent;
      heap[(bucket.slot = j)] = bucket;
      i = j;
    }
  }

  function heapDown(bucket: Bucket<T>) {
    let i: number,
      j: number,
      lhs: number,
      rhs: number,
      lBucket: Bucket<T>,
      rBucket: Bucket<T>,
      parent: Bucket<T>;
    j = i = bucket.slot!;

    while (true) {
      rhs = (lhs = (i << 1) + 1) + 1;
      parent = bucket;

      if (lhs < heapSize && (lBucket = heap[lhs]!).depth < parent.depth) {
        parent = lBucket;
        j = lhs;
      }
      if (rhs < heapSize && (rBucket = heap[rhs]!).depth < parent.depth) {
        parent = rBucket;
        j = rhs;
      }
      if (parent === bucket) break;

      heap[(parent.slot = i)] = parent;
      heap[(bucket.slot = j)] = bucket;
      i = j;
    }
  }
}

export function stringifyBucket<T extends HeapNode>(bucket: Bucket<T>) {
  return `depth: ${bucket.depth}, size: ${bucket.size}, index: ${
    bucket.index
  }, slot: ${bucket.slot}, subs: ${bucket.subs.map((sub) => sub?.id || "_")}`;
}
