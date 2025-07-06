interface RunMap {
  [id: number]: LinkNode | undefined;
}

export interface ReactiveNode {
  subsHead?: LinkNode;
  subsTail?: LinkNode;
  depsHead?: LinkNode;
  depsTail?: LinkNode;
  run?: RunMap;
  id: number;
  runId: number;
  depth: number;
  flags: Flags;
}

export interface LinkNode {
  runId: number;
  sub: ReactiveNode;
  dep: ReactiveNode;
  prevSub?: LinkNode;
  nextSub?: LinkNode;
  nextDep?: LinkNode;
}

export type Flags = number & { brand: "flags" };

export const COMPUTED = 1 as Flags,
  EFFECT = (1 << 1) as Flags,
  STALE = (1 << 2) as Flags,
  RUNNING = (1 << 3) as Flags;

export function link(dep: ReactiveNode, sub: ReactiveNode) {
  const depId = dep.id,
    run = sub.run,
    runId = sub.runId;

  let newLink = run?.[depId];

  if (newLink) {
    if (newLink.runId === runId) return;
    newLink.runId = runId;
  } else {
    const prevSub = dep.subsTail;
    newLink = dep.subsTail = { runId, dep, sub, prevSub };

    if (prevSub) prevSub.nextSub = newLink;
    else dep.subsHead = newLink;

    if (run) run[depId] = newLink;
  }

  const prevDep = sub.depsTail;

  if (prevDep) prevDep.nextDep = newLink;
  else sub.depsHead = newLink;

  sub.depsTail = newLink;

  if (run) {
    const depth = dep.depth;
    if (sub.depth <= depth) sub.depth = depth + 1;
  }
}

export function startTracking(sub: ReactiveNode) {
  sub.depsTail = undefined;
  sub.flags = ((sub.flags & ~STALE) | RUNNING) as Flags;
  sub.runId = sub.runId ? 0 : 1;
  sub.depth = -1;
}

export function endTracking(sub: ReactiveNode) {
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

  sub.flags = (sub.flags & ~RUNNING) as Flags;
  if (!link) return;

  let dep: ReactiveNode,
    nextSub: LinkNode | undefined,
    prevSub: LinkNode | undefined,
    run;

  while (link) {
    dep = link.dep;
    nextSub = link.nextSub;
    prevSub = link.prevSub;
    nextDep = link.nextDep;

    if (nextSub) nextSub.prevSub = prevSub;
    else dep.subsTail = prevSub;

    if (prevSub) prevSub.nextSub = nextSub;
    else dep.subsHead = nextSub;

    if ((run = link.sub.run)) run[dep.id] = undefined;

    if (!dep.subsHead && dep.depsHead) {
      dep.flags = (dep.flags | STALE) as Flags;
      link = dep.depsHead;
      dep.depsTail!.nextDep = nextDep;
      dep.depsHead = undefined;
      dep.depsTail = undefined;
      continue;
    }
    link = nextDep;
  }
}

interface Bucket {
  depth: number;
  subs: (ReactiveNode | undefined)[];
  size: number;
  index: number;
}

const buckets: (Bucket | undefined)[] = [],
  queue: (Bucket | undefined)[] = [];
let queueSize = 0;

export function queuePush(link: LinkNode) {
  let sub: ReactiveNode,
    flags: Flags,
    depth: number,
    bucket: Bucket | undefined,
    i: number,
    j: number,
    parent: Bucket;

  do {
    flags = (sub = link.sub).flags;
    if (flags & STALE) continue;
    sub.flags = (flags | STALE) as Flags;

    if ((bucket = buckets[(depth = sub.depth)]))
      bucket.subs[(i = bucket.size++)] = sub;
    else {
      i = 0;
      buckets[depth] = bucket = { depth, subs: [sub], size: 1, index: 0 };
    }

    if (!i) {
      queue[(i = queueSize++)] = bucket;

      while (i && depth < (parent = queue[(j = (i - 1) >> 1)]!).depth) {
        queue[i] = parent;
        queue[j] = bucket;
        i = j;
      }
    }
  } while ((link = link.nextSub!));
}

interface CreateQueueFlushProps {
  updateComputed(node: ReactiveNode): boolean;
  runEffect(node: ReactiveNode): void;
}

export function createQueueFlush({
  updateComputed,
  runEffect,
}: CreateQueueFlushProps) {
  return function (depth?: number) {
    if (!queueSize) return;

    let sub: ReactiveNode,
      flags: Flags,
      bucket: Bucket,
      i: number,
      j: number,
      lhs: number,
      rhs: number,
      subsHead: LinkNode | undefined,
      leftChild: Bucket,
      rightChild: Bucket,
      target: Bucket;

    while (queueSize) {
      bucket = queue[0]!;
      if (depth && bucket.depth > depth) break;

      while ((i = bucket.index++) < bucket.size) {
        flags = (sub = bucket.subs[i]!).flags;
        bucket.subs[i] = undefined;
        if (flags & EFFECT) runEffect(sub);
        else if (updateComputed(sub) && (subsHead = sub.subsHead))
          queuePush(subsHead);
        sub.flags = (flags & ~STALE) as Flags;
      }
      bucket.size = bucket.index = 0;

      if (!queueSize) break;

      queue[0] = bucket = queue[--queueSize]!;
      queue[queueSize] = undefined;

      j = i = 0;
      lhs = (i << 1) + 1;
      rhs = lhs + 1;
      target = bucket;

      while (true) {
        if (lhs < queueSize && (leftChild = queue[lhs]!).depth < target.depth) {
          j = lhs;
          target = leftChild;
        }

        if (
          rhs < queueSize &&
          (rightChild = queue[rhs]!).depth < target.depth
        ) {
          j = rhs;
          target = rightChild;
        }

        if (target === bucket) break;

        queue[i] = target;
        queue[j] = bucket;
        i = j;
      }
    }
  };
}
