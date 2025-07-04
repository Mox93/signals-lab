interface DepMap {
  [id: number]: LinkNode;
}

export interface ReactiveNode {
  subsHead?: LinkNode;
  subsTail?: LinkNode;
  depsHead?: LinkNode;
  depsTail?: LinkNode;
  id?: number;
  activeRun?: DepMap;
  prevRun?: DepMap;
  flags: Flags;
  // version: number;
}

export interface LinkNode {
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

const DIRTY = STALE | PENDING,
  PROPAGATING = DIRTY | RUNNING;

interface ReactiveSystemActions {
  update(relayer: ReactiveNode): boolean;
  notify(watcher: ReactiveNode): void;
}

export function createReactiveSystem({
  update,
  notify,
}: ReactiveSystemActions) {
  const queue: (LinkNode | undefined)[] = [];
  let queueSize = 0,
    queueIndex = 0,
    id = 0;

  return {
    link,
    startTracking,
    endTracking,
    propagate,
    checkDirty,
    shallowPropagate,
  };

  /**
   * Links a given dependency and subscriber if they are not already linked.
   *
   * @param dep - The dependency to be linked.
   * @param sub - The subscriber that depends on this dependency.
   */
  function link(dep: ReactiveNode, sub: ReactiveNode) {
    const prevDep = sub.depsTail;
    let nextDep: LinkNode | undefined,
      activeRun: DepMap | undefined,
      depId = dep.id,
      wasLiked = true;

    if (depId === undefined) {
      dep.id = depId = id++;
      wasLiked = false;
    }

    if (sub.flags & RUNNING)
      if (prevDep) {
        activeRun = sub.activeRun;

        if ((nextDep = prevDep.nextDep) && nextDep.dep === dep) {
          if (activeRun) activeRun[depId] = nextDep;
          else sub.activeRun = { [prevDep.dep.id!]: prevDep, [depId]: nextDep };
          sub.depsTail = nextDep;
          return;
        }

        if (prevDep.dep === dep) return;
        if (wasLiked && activeRun?.[depId]) return;
      } else if ((nextDep = sub.depsHead) && nextDep.dep === dep) {
        sub.depsTail = nextDep;
        return;
      }

    let newLink: LinkNode;

    if (wasLiked && (newLink = sub.prevRun?.[depId]!))
      newLink.nextDep = nextDep;
    else {
      const prevSub = dep.subsTail;
      newLink = sub.depsTail = { dep, sub, prevSub, nextDep };

      if (prevSub) prevSub.nextSub = newLink;
      else dep.subsHead = newLink;

      dep.subsTail = newLink;
    }

    if (prevDep) {
      prevDep.nextDep = newLink;
      if (activeRun) activeRun[depId] = newLink;
      else sub.activeRun = { [prevDep.dep.id!]: prevDep, [depId]: newLink };
    } else sub.depsHead = newLink;
  }

  /**
   * Prepares the given subscriber to track new dependencies.
   *
   * It resets the subscriber's internal pointers (e.g., depsTail) and
   * sets its flags to indicate it is now tracking dependency links.
   *
   * @param sub - The subscriber to start tracking.
   */
  function startTracking(sub: ReactiveNode) {
    sub.depsTail = undefined;
    sub.flags = ((sub.flags & ~DIRTY) | RUNNING) as Flags;
    sub.prevRun = sub.activeRun;
  }

  /**
   * Concludes tracking of dependencies for the specified subscriber.
   *
   * It clears or unlinks any tracked dependency information, then
   * updates the subscriber's flags to indicate tracking is complete.
   *
   * @param sub - The subscriber whose tracking is ending.
   */
  function endTracking(sub: ReactiveNode) {
    let depsTail = sub.depsTail,
      nextDep: LinkNode | undefined,
      link: LinkNode | undefined,
      dep: ReactiveNode,
      nextSub: LinkNode | undefined,
      prevSub: LinkNode | undefined;

    if (!depsTail) {
      link = sub.depsHead;
      sub.depsHead = undefined;
    } else if ((nextDep = depsTail.nextDep)) {
      link = nextDep;
      depsTail.nextDep = undefined;
    }

    /**
     * Clears dependency-subscription relationships starting at the given link.
     *
     * Detaches the link from both the dependency and subscriber, then continues
     * to the next link in the chain. The link objects are returned to linkPool for reuse.
     */
    while (link) {
      dep = link.dep;
      nextSub = link.nextSub;
      prevSub = link.prevSub;
      nextDep = link.nextDep;

      if (nextSub) nextSub.prevSub = prevSub;
      else dep.subsTail = prevSub;

      if (prevSub) prevSub.nextSub = nextSub;
      else dep.subsHead = nextSub;

      /**
       * In the case of the dependency having dependencies (i.e. computed signal),
       * if it does not have any more subscribes we disconnect it from its dependencies
       * to allow them to be freed from memory if no longer needed.
       */
      if (!dep.subsHead && dep.depsHead) {
        /**
         * Since this dependency is no longer subscribing to anything it should be considered
         * 'STALE' so it gets re-evaluated the next time it's subscribed to.
         */
        dep.flags = (dep.flags | STALE) as Flags;
        link = dep.depsHead;
        dep.depsTail!.nextDep = nextDep;
        dep.depsHead = undefined;
        dep.depsTail = undefined;
        continue;
      }
      link = nextDep;
    }

    sub.prevRun = undefined;
    sub.flags = (sub.flags & ~RUNNING) as Flags;
  }

  /**
   * Traverses and marks subscribers starting from the provided link.
   *
   * It sets flags (e.g., Dirty, PendingComputed, PendingEffect) on each subscriber
   * to indicate which ones require re-computation or effect processing.
   * This function should be called after a signal's value changes.
   *
   * @param link - The starting link from which propagation begins.
   */
  function propagate(link: LinkNode) {
    let sub: ReactiveNode,
      flags: Flags,
      branch: LinkNode | undefined,
      targetFlags: Flags;
    queue[queueSize++] = link;

    while (queueIndex < queueSize) {
      link = queue[queueIndex]!;
      queue[queueIndex++] = undefined;
      targetFlags = link.dep.flags & COMPUTED ? PENDING : STALE;

      do {
        flags = (sub = link.sub).flags;
        sub.flags = (flags | targetFlags) as Flags;

        if (flags & PROPAGATING) continue;
        if (flags & EFFECT) notify(sub);
        else if ((branch = sub.subsHead) && (flags & COMPUTED || update(sub)))
          queue[queueSize++] = branch;
      } while ((link = link.nextSub!));
    }
    queueSize = queueIndex = 0;
  }

  /**
   * Recursively checks and updates computed subscribers marked as PENDING,
   * until it finds the first fully updated path.
   *
   * It traverses the linked structure using a stack mechanism. While progressing
   * in depth it keeps track of the path is came through. Once it hist a STALE node,
   * the constructed path is backtracked calling update on each node till they all compleat
   * or a node that's value didn't change is found, in which case it moves on with checking other nodes.
   *
   * @param link - The starting link representing a sequence of PENDING computed.
   * @returns `true` if an updated path was found, otherwise `false`.
   */
  function checkDirty(link: LinkNode) {
    const stack: LinkNode[] = [];
    let depth = 0,
      dep: ReactiveNode,
      sub: ReactiveNode,
      subsHead: LinkNode,
      flags: Flags;

    top: while (link) {
      sub = link.sub;

      if (link !== stack[depth]) {
        if (
          (flags = (dep = link.dep).flags) & STALE &&
          update(dep)
          // || dep.version > sub.version
        ) {
          subsHead = dep.subsHead!;
          if (subsHead.nextSub) shallowPropagate(subsHead);
          while (depth)
            if (update((dep = (link = stack[--depth]).dep))) {
              subsHead = dep.subsHead!;
              if (subsHead.nextSub) shallowPropagate(subsHead);
            } else continue top;
          return true;
        }

        if (flags & PENDING) {
          stack[depth++] = link;
          link = dep.depsHead!;
          continue;
        }
      }

      if (!(link = link.nextDep!)) {
        sub.flags = (sub.flags & ~DIRTY) as Flags;
        if (depth) link = stack[--depth];
      }
    }

    return false;
  }

  function shallowPropagate(link: LinkNode) {
    let sub: ReactiveNode, flags: Flags;
    while (link) {
      flags = (sub = link.sub).flags;
      sub.flags = (flags | STALE) as Flags;
      if (flags & EFFECT) notify(sub);
      link = link.nextSub!;
    }
  }
}
