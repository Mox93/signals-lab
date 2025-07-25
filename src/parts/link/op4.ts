export interface ReactiveNode {
  id: number;
  // runId: number;
  flags: Flags;
  // subId: number | undefined;
  // subRunId: number | undefined;
  subsHead: LinkNode | undefined;
  subsTail: LinkNode | undefined;
  depsHead: LinkNode | undefined;
  depsTail: LinkNode | undefined;
}

export interface LinkNode {
  sub: ReactiveNode;
  dep: ReactiveNode;
  prevSub: LinkNode | undefined;
  nextSub: LinkNode | undefined;
  nextDep: LinkNode | undefined;
}

export type Flags = number & { brand: "flags" };

export const COMPUTED = 1 as Flags,
  EFFECT = (1 << 1) as Flags,
  STALE = (1 << 2) as Flags, // Must be re-evaluated unconditionally, bypassing source checks.
  PENDING = (1 << 3) as Flags, // Potentially needs re-evaluation; sources must be checked.
  RUNNING = (1 << 4) as Flags; // In the process of re-evaluation

const DIRTY = STALE | PENDING;

export const debug = {
  lastRunLinkInOrder: 0,
  lastRunLinkOutOfOrder: 0,
  thisRunLink: 0,
  newLink: 0,
};

export function link(dep: ReactiveNode, sub: ReactiveNode) {
  const prevDep = sub.depsTail;
  if (prevDep !== undefined && prevDep.dep === dep) return;

  // const subId = sub.id,
  //   runId = sub.runId;
  // if (subId === dep.subId && runId === dep.subRunId) return;
  // dep.subId = subId;
  // dep.subRunId = runId;

  const nextDep = prevDep !== undefined ? prevDep.nextDep : sub.depsHead;
  if (nextDep !== undefined && nextDep.dep === dep) {
    sub.depsTail = nextDep;
    return;
  }

  const prevSub = dep.subsTail;
  if (prevSub !== undefined && prevSub.sub === sub && isValidLink(prevSub, sub))
    return;

  const newLink =
    (sub.depsTail =
    dep.subsTail =
      {
        dep,
        sub,
        nextDep,
        prevSub,
        nextSub: undefined,
      });

  if (prevSub) prevSub.nextSub = newLink;
  else dep.subsHead = newLink;

  if (prevDep) prevDep.nextDep = newLink;
  else sub.depsHead = newLink;
}

export function startTracking(sub: ReactiveNode) {
  sub.depsTail = undefined;
  sub.flags = ((sub.flags & ~DIRTY) | RUNNING) as Flags;
  // sub.runId++;
}

export function endTracking(sub: ReactiveNode) {
  let depsTail = sub.depsTail,
    nextDep: LinkNode | undefined,
    link: LinkNode | undefined;

  if (depsTail === undefined) {
    link = sub.depsHead;
    sub.depsHead = undefined;
  } else if ((nextDep = depsTail.nextDep)) {
    link = nextDep;
    depsTail.nextDep = undefined;
  }

  sub.flags = (sub.flags & ~RUNNING) as Flags;
  if (link === undefined) return;

  let dep: ReactiveNode,
    nextSub: LinkNode | undefined,
    prevSub: LinkNode | undefined;

  while (link !== undefined) {
    dep = link.dep;
    nextSub = link.nextSub;
    prevSub = link.prevSub;
    nextDep = link.nextDep;

    if (nextSub !== undefined) nextSub.prevSub = prevSub;
    else dep.subsTail = prevSub;

    if (prevSub !== undefined) prevSub.nextSub = nextSub;
    else dep.subsHead = nextSub;

    if (dep.subsHead === undefined && dep.depsHead) {
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

function isValidLink(checkLink: LinkNode, sub: ReactiveNode) {
  const depsTail = sub.depsTail;
  if (depsTail !== undefined) {
    let link = sub.depsHead;
    while (link !== undefined) {
      if (link === checkLink) return true;
      if (link === depsTail) break;
      link = link.nextDep;
    }
  }
  return false;
}

let id = 0;

export const nodes: ReactiveNode[] = Array.from({ length: 100 }, () => ({
  id: id++,
  flags: COMPUTED,
  runId: 0,
  subId: undefined,
  subRunId: undefined,
  depsHead: undefined,
  depsTail: undefined,
  subsHead: undefined,
  subsTail: undefined,
}));

export const name = "signals exp 3";
export const depsKey = "depsHead";
export const subsKey = "subsHead";
