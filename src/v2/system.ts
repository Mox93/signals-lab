export interface Dependency {
  subsHead: LinkNode | null;
  subsTail: LinkNode | null;
  tick: number;
}

export interface Subscriber {
  flags: Flags;
  depsHead: LinkNode | null;
  depsTail: LinkNode | null;
  tick: number;
}

export interface Derived extends Dependency, Subscriber {}

export interface LinkNode {
  sub: Subscriber | Derived;
  dep: Dependency | Derived;
  prevSub: LinkNode | null;
  nextSub: LinkNode | null;
  nextDep: LinkNode | null;
}

export type Flags = number & { brand: "flags" };

export const DERIVED = (1 << 0) as Flags,
  EFFECT = (1 << 1) as Flags,
  STALE = (1 << 2) as Flags, // Needs to be reevaluated
  PENDING = (1 << 3) as Flags; // In the process of reevaluation

export function createReactiveSystem({
  updateComputed,
  runEffect,
}: {
  updateComputed(computed: Derived): boolean;
  runEffect(effect: Subscriber): void;
}) {
  const batch: (Subscriber | null)[] = [],
    queue: (LinkNode | null)[] = [];
  let batchSize = 0,
    batchIndex = 0,
    queueSize = 0,
    queueIndex = 0,
    tick = 0;

  return {
    /**
     * Links a given dependency and subscriber if they are not already linked.
     *
     * @param dep - The dependency to be linked.
     * @param sub - The subscriber that depends on this dependency.
     * @returns The newly created link object if the two are not already linked; otherwise `null`.
     */
    link(dep: Dependency, sub: Subscriber) {
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

      const newLink: LinkNode = {
        dep,
        sub,
        nextDep,
        nextSub: null,
        prevSub: null,
      };
      sub.depsTail = newLink;
      dep.subsTail = newLink;

      if (currentDep) currentDep.nextDep = newLink;
      else sub.depsHead = newLink;

      if (dep.subsHead) {
        const oldTail = dep.subsTail!;
        newLink.prevSub = oldTail;
        oldTail.nextSub = newLink;
      } else dep.subsHead = newLink;

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
    startTracking(sub: Subscriber) {
      sub.depsTail = null;
      sub.flags = ((sub.flags & ~STALE) | PENDING) as Flags;
    },

    /**
     * Concludes tracking of dependencies for the specified subscriber.
     *
     * It clears or unlinks any tracked dependency information, then
     * updates the subscriber's flags to indicate tracking is complete.
     *
     * @param sub - The subscriber whose tracking is ending.
     */
    endTracking(sub: Subscriber) {
      let depsTail = sub.depsTail,
        nextDep: LinkNode | null,
        link: LinkNode | null = null,
        dep: Derived,
        nextSub: LinkNode | null,
        prevSub: LinkNode | null;

      if (depsTail) {
        if ((nextDep = depsTail.nextDep)) {
          link = nextDep;
          depsTail.nextDep = null;
        }
      } else {
        link = sub.depsHead;
        sub.depsHead = null;
      }

      /**
       * Clears dependency-subscription relationships starting at the given link.
       *
       * Detaches the link from both the dependency and subscriber, then continues
       * to the next link in the chain. The link objects are returned to linkPool for reuse.
       */
      while (link) {
        dep = link.dep as Derived;

        nextSub = link.nextSub;
        prevSub = link.prevSub;
        if (nextSub) nextSub.prevSub = prevSub;
        else dep.subsTail = prevSub;
        if (prevSub) prevSub.nextSub = nextSub;
        else dep.subsHead = nextSub;

        nextDep = link.nextDep;
        /**
         * In the case of the dependency having dependencies (i.e. a derived signal),
         * if it does not have any more subscribes we disconnect it from its dependencies
         * to allow them to be freed from memory if no longer needed.
         */
        if (!dep.subsHead && dep.depsHead) {
          /**
           * Since this dependency is no longer subscribing to anything it should be considered
           * 'STALE' so it gets recomputed the next time it's subscribed to.
           * */
          dep.flags = (dep.flags | STALE) as Flags;
          link = dep.depsHead;
          dep.depsTail!.nextDep = nextDep;
          dep.depsHead = null;
          dep.depsTail = null;
          continue;
        }
        link = nextDep;
      }

      sub.flags = (sub.flags & ~PENDING) as Flags;
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
      let sub: Derived, subFlags: Flags, branch: LinkNode | null;
      queue[queueSize++] = link;

      while (queueIndex < queueSize) {
        link = queue[queueIndex]!;
        queue[queueIndex++] = null;

        do {
          sub = link.sub as Derived;
          subFlags = sub.flags;

          if (subFlags & (STALE | PENDING)) continue;
          sub.flags = (subFlags | STALE) as Flags;

          if (subFlags & EFFECT) batch[batchSize++] = sub;
          else if ((branch = sub.subsHead)) queue[queueSize++] = branch;
        } while ((link = link.nextSub!));
      }
      queueSize = queueIndex = 0;
    },

    /**
     * Processes queued effect notifications after a batch operation finishes.
     *
     * Iterates through all queued effects, calling notifyEffect on each.
     * If an effect remains partially handled, its flags are updated, and future
     * notifications may be triggered until fully handled.
     */
    processEffects() {
      let effect: Subscriber, flags: Flags;
      if (batchSize) tick++;
      while (batchIndex < batchSize) {
        effect = batch[batchIndex]!;
        batch[batchIndex++] = null;
        if ((flags = effect.flags) & STALE) {
          effect.flags = ((flags & ~STALE) | PENDING) as Flags;
          runEffect(effect);
          effect.tick = tick;
          effect.flags = (flags & ~PENDING) as Flags;
        }
      }
      batchSize = batchIndex = 0;
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
  function isValidLink(checkLink: LinkNode, sub: Subscriber) {
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
