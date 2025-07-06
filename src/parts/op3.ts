interface DepMap {
  [id: number]: LinkNode | undefined;
}

export interface ReactiveNode {
  subsHead?: LinkNode;
  subsTail?: LinkNode;
  depsHead?: LinkNode;
  depsTail?: LinkNode;
  id: number;
  run?: DepMap;
  runId: number;
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
  STALE = (1 << 2) as Flags, // Must be re-evaluated unconditionally, bypassing source checks.
  PENDING = (1 << 3) as Flags, // Potentially needs re-evaluation; sources must be checked.
  RUNNING = (1 << 4) as Flags; // In the process of re-evaluation

const DIRTY = STALE | PENDING;

let id = 0;

export const debug = {
  lastRunLinkInOrder: 0,
  lastRunLinkOutOfOrder: 0,
  thisRunLink: 0,
  newLink: 0,
};

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
}

export function startTracking(sub: ReactiveNode) {
  sub.depsTail = undefined;
  sub.flags = ((sub.flags & ~DIRTY) | RUNNING) as Flags;
  sub.runId = ++sub.runId & 1;
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
    depMap;

  while (link) {
    dep = link.dep;
    nextSub = link.nextSub;
    prevSub = link.prevSub;
    nextDep = link.nextDep;

    if (nextSub) nextSub.prevSub = prevSub;
    else dep.subsTail = prevSub;

    if (prevSub) prevSub.nextSub = nextSub;
    else dep.subsHead = nextSub;

    if ((depMap = link.sub.run)) depMap[dep.id] = undefined;

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

export const nodes: ReactiveNode[] = Array.from({ length: 100 }, () => ({
  id: id++,
  flags: COMPUTED,
  run: {},
  runId: 0,
}));

export const name = "signals experiment";
export const key = "depsHead";
