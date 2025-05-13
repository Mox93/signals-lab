export interface ReactiveNode {
  subsHead?: LinkNode;
  subsTail?: LinkNode;
  depsHead?: LinkNode;
  depsTail?: LinkNode;
  flags: Flags;
  version: number;
}

export interface LinkNode {
  sub: ReactiveNode;
  dep: ReactiveNode;
  prevSub?: LinkNode;
  nextSub?: LinkNode;
  nextDep?: LinkNode;
}

export type Flags = number & { brand: "flags" };

export const RELAYER = 1 as Flags,
  WATCHER = (1 << 1) as Flags,
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
    queueIndex = 0;

  return {
    /**
     * Links a given dependency and subscriber if they are not already linked.
     *
     * @param dep - The dependency to be linked.
     * @param sub - The subscriber that depends on this dependency.
     * @returns The newly created link object if the two are not already linked; otherwise `undefined`.
     */
    link(dep: ReactiveNode, sub: ReactiveNode) {
      /**
       * Here we're handling the case of accessing the same dep multiple
       * times with no other dep getting accessed in between them
       */
      const currentDep = sub.depsTail;
      if (currentDep?.dep === dep) return;

      /**
       * Here we're handling the case of on subsequent runs the deps are
       * accessed in the same order as the run before them otherwise we
       * start from the top (e.g., sub.depsHead)
       */
      const nextDep = currentDep ? currentDep.nextDep : sub.depsHead;
      if (nextDep?.dep === dep) {
        sub.depsTail = nextDep;
        return;
      }

      /**
       * Here we're handling the case of accessing the same dep multiple
       * times with event if other dep got accessed in between them
       * ------------
       * TODO investigate
       * Need to understand why only checking for the dep inside
       * its subsTail is sufficient enough for making sure no
       * duplication happen.
       ** - What if the dep was accessed by other subs in the subsequent
       **   runs, wouldn't that make the last sub be a different sub than
       **   one we're currently are linking.
       */
      const depLastSub = dep.subsTail;
      /**
       * TODO investigate
       * Is there a faster way to check if the dep is linked to the sub,
       * maybe through something like an id pair 'subId:depId'
       */
      if (depLastSub?.sub === sub && isValidLink(depLastSub, sub)) return;

      const newLink: LinkNode = { dep, sub, nextDep };

      if (currentDep) currentDep.nextDep = newLink;
      else sub.depsHead = newLink;

      if (dep.subsHead) {
        const oldTail = dep.subsTail!;
        newLink.prevSub = oldTail;
        oldTail.nextSub = newLink;
      } else dep.subsHead = newLink;

      sub.depsTail = newLink;
      dep.subsTail = newLink;
      return newLink;
    },

    /**
     * Prepares the given subscriber to track new dependencies.
     *
     * It resets the subscriber's internal pointers (e.g., depsTail) and
     * sets its flags to indicate it is now tracking dependency links.
     *
     * @param sub - The subscriber to start tracking.
     */
    startTracking(sub: ReactiveNode) {
      sub.depsTail = undefined;
      sub.flags = ((sub.flags & ~DIRTY) | RUNNING) as Flags;
    },

    /**
     * Concludes tracking of dependencies for the specified subscriber.
     *
     * It clears or unlinks any tracked dependency information, then
     * updates the subscriber's flags to indicate tracking is complete.
     *
     * @param sub - The subscriber whose tracking is ending.
     */
    endTracking(sub: ReactiveNode) {
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
        if (nextSub) nextSub.prevSub = prevSub;
        else dep.subsTail = prevSub;
        if (prevSub) prevSub.nextSub = nextSub;
        else dep.subsHead = nextSub;

        nextDep = link.nextDep;
        /**
         * In the case of the dependency having dependencies (i.e. computed signal),
         * if it does not have any more subscribes we disconnect it from its dependencies
         * to allow them to be freed from memory if no longer needed.
         */
        if (!dep.subsHead && dep.depsHead) {
          /**
           * Since this dependency is no longer subscribing to anything it should be considered
           * 'STALE' so it gets recomputed the next time it's subscribed to.
           */
          dep.flags = (dep.flags | PENDING) as Flags;
          link = dep.depsHead;
          dep.depsTail!.nextDep = nextDep;
          dep.depsHead = undefined;
          dep.depsTail = undefined;
          continue;
        }
        link = nextDep;
      }

      sub.flags = (sub.flags & ~RUNNING) as Flags;
    },

    /**
     * Traverses and marks subscribers starting from the provided link.
     *
     * It sets flags (e.g., Dirty, PendingComputed, PendingEffect) on each subscriber
     * to indicate which ones require re-computation or effect processing.
     * This function should be called after a signal's value changes.
     *
     * @param link - The starting link from which propagation begins.
     */
    propagate(link: LinkNode) {
      let sub: ReactiveNode,
        flags: Flags,
        branch: LinkNode | undefined,
        targetFlags = link.dep.flags & RELAYER ? PENDING : STALE;
      queue[queueSize++] = link;

      while (queueIndex < queueSize) {
        link = queue[queueIndex]!;
        queue[queueIndex++] = undefined;

        do {
          sub = link.sub;
          flags = sub.flags;
          sub.flags = (flags | targetFlags) as Flags;

          if (flags & PROPAGATING) continue;
          if (flags & WATCHER) notify(sub);
          else if ((branch = sub.subsHead)) queue[queueSize++] = branch;
        } while ((link = link.nextSub!));
        targetFlags = PENDING;
      }
      queueSize = queueIndex = 0;
    },

    /**
     * Recursively checks and updates all computed subscribers marked as pending.
     *
     * It traverses the linked structure using a stack mechanism. For each computed
     * subscriber in a pending state, updateComputed is called and shallowPropagate
     * is triggered if a value changes. Returns whether any updates occurred.
     *
     * @param link - The starting link representing a sequence of pending computed.
     * @returns `true` if a computed was updated, otherwise `false`.
     */
    checkStale(link: LinkNode) {
      const stack = [link],
        path: ReactiveNode[] = [];
      let size = 1,
        depth = 0,
        dep: ReactiveNode,
        flags: Flags,
        dirty: Flags,
        nextDep: LinkNode | undefined,
        branch: LinkNode | undefined,
        i: number;

      while (size && (link = stack[--size])) {
        do {
          dep = link.dep;

          if ((dirty = ((flags = dep.flags) & DIRTY) as Flags))
            path[depth] = dep;
          dep.flags = (flags & ~DIRTY) as Flags;
          if (!dirty || !(nextDep = dep.depsHead)) nextDep = link.nextDep;
          else {
            depth++;
            if ((branch = link.nextDep)) stack[size++] = branch;
          }

          backtrack: if (flags & STALE) {
            for (i = depth; i >= 0; i--) if (!update(path[i])) break backtrack;
            return true;
          }
        } while ((link = nextDep!));
        depth--;
      }

      return false;
    },
  };

  /**
   * Verifies whether the given link is valid for the specified subscriber.
   *
   * It iterates through the subscriber's link list (from sub.deps to sub.depsTail)
   * to determine if the provided link object is part of that chain.
   *
   * @param checkLink - The link object to validate.
   * @param sub - The subscriber whose link list is being checked.
   * @returns `true` if the link is found in the subscriber's list; otherwise `false`.
   */
  function isValidLink(checkLink: LinkNode, sub: ReactiveNode) {
    const depsTail = sub.depsTail;
    if (depsTail) {
      let link = sub.depsHead;
      while (link) {
        if (link === checkLink) return true;
        if (link === depsTail) break;
        link = link.nextDep;
      }
    }
    return false;
  }
}
