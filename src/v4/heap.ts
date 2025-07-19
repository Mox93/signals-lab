interface Bucket<T> {
  depth: number;
  nodes: (T | undefined)[];
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

  function enqueue(parentDepth: number, ...children: T[]) {
    const minDepth = parentDepth + 1;
    let child: T,
      slot: number | undefined,
      depth: number,
      bucket: Bucket<T> | undefined,
      head: Bucket<T> | undefined,
      nodes: (T | undefined)[],
      i: number,
      pushedDown = false;

    for (child of children) {
      slot = child.slot;

      if ((depth = child.depth) > parentDepth) {
        if (slot !== undefined) continue;
      } else {
        if (slot !== undefined && (bucket = cache[depth])) {
          nodes = bucket.nodes;
          if (slot !== (i = --bucket.size)) nodes[slot] = nodes[i];
          nodes[i] = undefined;
        }

        child.depth = depth = minDepth;
        pushedDown = true;
      }

      if ((bucket = cache[depth]))
        bucket.nodes[(child.slot = bucket.size++)] = child;
      else
        cache[depth] = bucket = {
          depth,
          nodes: [child],
          size: 1,
          index: (child.slot = 0),
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
      if (pushedDown) propagate?.(child);
    }
  }

  function flush() {
    if (!heapSize) return;
    isFlushing = true;

    let node: T, bucket: Bucket<T>, nodes: (T | undefined)[], i: number;

    while (true) {
      // TODO if a bucket was enqueued with a lower depth than the one currently running, them we need to investigate it.
      bucket = heap[0]!;
      i = bucket.index;

      while (i < bucket.size) {
        node = (nodes = bucket.nodes)[i]!;
        nodes[(bucket.index = i++)] = node.slot = undefined;
        run(node);
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
    let i: number, j: number, lhs: number, rhs: number, parent: Bucket<T>;
    j = i = bucket.slot!;

    while (true) {
      rhs = (lhs = (i << 1) + 1) + 1;
      parent = bucket;

      if (lhs < heapSize && heap[lhs]!.depth < parent.depth) j = lhs;
      if (rhs < heapSize && heap[rhs]!.depth < parent.depth) j = rhs;
      if ((parent = heap[j]!) === bucket) break;

      heap[(parent.slot = i)] = parent;
      heap[(bucket.slot = j)] = bucket;
      i = j;
    }
  }
}

export function stringifyBucket<T extends HeapNode>(bucket: Bucket<T>) {
  return `depth: ${bucket.depth}, size: ${bucket.size}, index: ${
    bucket.index
  }, slot: ${bucket.slot}, nodes: ${bucket.nodes.map(
    (node) => node?.id || "_"
  )}`;
}
