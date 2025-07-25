export interface ReactiveNode {
  deps?: Link;
  depsTail?: Link;
  subs?: Link;
  subsTail?: Link;
  flags: ReactiveFlags;
}

export interface Link {
  dep: ReactiveNode;
  sub: ReactiveNode;
  prevSub: Link | undefined;
  nextSub: Link | undefined;
  prevDep: Link | undefined;
  nextDep: Link | undefined;
}

export enum ReactiveFlags {
  None = 0,
  Mutable = 1 << 0,
  Watching = 1 << 1,
  RecursedCheck = 1 << 2,
  Recursed = 1 << 3,
  Dirty = 1 << 4,
  Pending = 1 << 5,
}

export function link(dep: ReactiveNode, sub: ReactiveNode): void {
  const prevDep = sub.depsTail;
  if (prevDep !== undefined && prevDep.dep === dep) {
    return;
  }
  let nextDep: Link | undefined = undefined;
  const recursedCheck = sub.flags & (4 satisfies ReactiveFlags.RecursedCheck);
  if (recursedCheck) {
    nextDep = prevDep !== undefined ? prevDep.nextDep : sub.deps;
    if (nextDep !== undefined && nextDep.dep === dep) {
      sub.depsTail = nextDep;
      return;
    }
  }
  const prevSub = dep.subsTail;
  if (
    prevSub !== undefined &&
    prevSub.sub === sub &&
    (!recursedCheck || isValidLink(prevSub, sub))
  ) {
    return;
  }
  const newLink =
    (sub.depsTail =
    dep.subsTail =
      {
        dep,
        sub,
        prevDep,
        nextDep,
        prevSub,
        nextSub: undefined,
      });
  if (nextDep !== undefined) {
    nextDep.prevDep = newLink;
  }
  if (prevDep !== undefined) {
    prevDep.nextDep = newLink;
  } else {
    sub.deps = newLink;
  }
  if (prevSub !== undefined) {
    prevSub.nextSub = newLink;
  } else {
    dep.subs = newLink;
  }
}

export function startTracking(sub: ReactiveNode): void {
  sub.depsTail = undefined;
  sub.flags =
    (sub.flags &
      ~(56 as
        | ReactiveFlags.Recursed
        | ReactiveFlags.Dirty
        | ReactiveFlags.Pending)) |
    (4 satisfies ReactiveFlags.RecursedCheck);
}

export function endTracking(sub: ReactiveNode): void {
  const depsTail = sub.depsTail;
  let toRemove = depsTail !== undefined ? depsTail.nextDep : sub.deps;
  while (toRemove !== undefined) {
    toRemove = unlink(toRemove, sub);
  }
  sub.flags &= ~(4 satisfies ReactiveFlags.RecursedCheck);
}

function isValidLink(checkLink: Link, sub: ReactiveNode): boolean {
  const depsTail = sub.depsTail;
  if (depsTail !== undefined) {
    let link = sub.deps!;
    do {
      if (link === checkLink) {
        return true;
      }
      if (link === depsTail) {
        break;
      }
      link = link.nextDep!;
    } while (link !== undefined);
  }
  return false;
}

function unlink(link: Link, sub = link.sub): Link | undefined {
  const dep = link.dep;
  const prevDep = link.prevDep;
  const nextDep = link.nextDep;
  const nextSub = link.nextSub;
  const prevSub = link.prevSub;
  if (nextDep !== undefined) {
    nextDep.prevDep = prevDep;
  } else {
    sub.depsTail = prevDep;
  }
  if (prevDep !== undefined) {
    prevDep.nextDep = nextDep;
  } else {
    sub.deps = nextDep;
  }
  if (nextSub !== undefined) {
    nextSub.prevSub = prevSub;
  } else {
    dep.subsTail = prevSub;
  }
  if (prevSub !== undefined) {
    prevSub.nextSub = nextSub;
  } else if ((dep.subs = nextSub) === undefined) {
    unwatched(dep);
  }
  return nextDep;
}

function unwatched(node: ReactiveNode) {
  if ("getter" in node) {
    let toRemove = node.deps;
    if (toRemove !== undefined) {
      node.flags = 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty;
      do {
        toRemove = unlink(toRemove, node);
      } while (toRemove !== undefined);
    }
  } else if (!("previousValue" in node)) {
    effectOper.call(node);
  }
}

function effectOper(this: ReactiveNode): void {
  let dep = this.deps;
  while (dep !== undefined) {
    dep = unlink(dep, this);
  }
  const sub = this.subs;
  if (sub !== undefined) {
    unlink(sub);
  }
  this.flags = 0 satisfies ReactiveFlags.None;
}

export const nodes: ReactiveNode[] = Array.from({ length: 100 }, () => ({
  flags: ReactiveFlags.RecursedCheck,
}));

export const name = "alien signals";
export const depsKey = "deps";
export const subsKey = "subs";
