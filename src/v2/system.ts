export interface Dependency {
  subsHead: LinkNode | undefined;
  subsTail: LinkNode | undefined;
}

export interface Subscriber {
  flags: Flags;
  depsHead: LinkNode | undefined;
  depsTail: LinkNode | undefined;
}

interface Computed extends Dependency, Subscriber {}

export interface LinkNode {
  sub: Subscriber | Computed;
  dep: Dependency | Computed;
  prevSub: LinkNode | undefined;
  nextSub: LinkNode | undefined;
  nextDep: LinkNode | undefined;
}

export type Flags = number & { brand: "flags" };

interface OneWayLink<T> {
  target: T;
  linked: OneWayLink<T> | undefined;
}

export const COMPUTED = (1 << 0) as Flags,
  EFFECT = (1 << 1) as Flags,
  TRACKING = (1 << 2) as Flags,
  NOTIFIED = (1 << 3) as Flags,
  RECURSED = (1 << 4) as Flags,
  DIRTY = (1 << 5) as Flags,
  PENDING = (1 << 6) as Flags,
  PROPAGATED = (DIRTY | PENDING) as Flags;

export function createReactiveSystem({
  updateComputed,
  notifyEffect,
}: {
  updateComputed(computed: Computed): boolean;
  notifyEffect(effect: Subscriber): boolean;
}) {
  const notifyBuffer: (Subscriber | undefined)[] = [];
  let bufferSize = 0;
  let notifyIndex = 0;

  return {
    link,
    startTracking,
    endTracking,
    // propagate,
    // processEffectNotifications,
    // processComputedUpdate,
    // 'updateDirtyFlag' & 'processPendingInnerEffects' should not be exposed
  };

  /**
   * Links a given dependency and subscriber if they are not already linked.
   *
   * @param dep - The dependency to be linked.
   * @param sub - The subscriber that depends on this dependency.
   * @returns The newly created link object if the two are not already linked; otherwise `undefined`.
   */
  function link(dep: Dependency, sub: Subscriber) {
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
      nextSub: undefined,
      prevSub: undefined,
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
  }

  /**
   * Prepares the given subscriber to track new dependencies.
   *
   * It resets the subscriber's internal pointers (e.g., depsTail) and
   * sets its flags to indicate it is now tracking dependency links.
   *
   * @param sub - The subscriber to start tracking.
   */
  function startTracking(sub: Subscriber) {
    sub.depsTail = undefined;
    sub.flags = ((sub.flags & ~(NOTIFIED | RECURSED | PROPAGATED)) |
      TRACKING) as Flags;
  }

  /**
   * Concludes tracking of dependencies for the specified subscriber.
   *
   * It clears or unlinks any tracked dependency information, then
   * updates the subscriber's flags to indicate tracking is complete.
   *
   * @param sub - The subscriber whose tracking is ending.
   */
  function endTracking(sub: Subscriber) {
    let depsTail = sub.depsTail,
      nextDep: LinkNode | undefined,
      link: LinkNode | undefined,
      dep: Dependency | Computed,
      nextSub: LinkNode | undefined,
      prevSub: LinkNode | undefined,
      cmpDeps: LinkNode | undefined;

    if (depsTail) {
      if ((nextDep = depsTail.nextDep)) {
        link = nextDep;
        depsTail.nextDep = undefined;
      }
    } else {
      link = sub.depsHead;
      sub.depsHead = undefined;
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
      if (!dep.subsHead && "depsHead" in dep) {
        dep.flags = (dep.flags | DIRTY) as Flags;
        if ((cmpDeps = dep.depsHead)) {
          link = cmpDeps;
          dep.depsTail!.nextDep = nextDep;
          dep.depsHead = undefined;
          dep.depsTail = undefined;
          continue;
        }
      }
      link = nextDep;
    }

    sub.flags = (sub.flags & ~TRACKING) as Flags;
  }

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
