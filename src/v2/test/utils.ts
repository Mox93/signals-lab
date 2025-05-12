// test-utils.ts (or place in your test file)
import { ReactiveNode, LinkNode, Flags } from "../system";

// Helper function to create mock nodes
export const createMockNode = (
  type: "dep" | "sub" | "derived",
  initialFlags: Flags = 0 as Flags
): ReactiveNode | ReactiveNode | ReactiveNode => {
  const base = {};
  if (type === "dep") {
    return base as ReactiveNode;
  }
  const subBase = {
    ...base,
    flags: initialFlags,
  };
  if (type === "sub") {
    return subBase as ReactiveNode;
  }
  // Derived
  return subBase as ReactiveNode;
};

// Helper function to create a link object
export const createLink = (
  dep: ReactiveNode | ReactiveNode,
  sub: ReactiveNode | ReactiveNode
): LinkNode => ({
  dep,
  sub,
});

// Helper to link a dependency and a subscriber, updating both lists
export const linkNodes = (
  dep: ReactiveNode | ReactiveNode,
  sub: ReactiveNode | ReactiveNode
): LinkNode => {
  const newLink = createLink(dep, sub);

  // Add to dependency's subscriber list (subs)
  if (!dep.subsHead) {
    dep.subsHead = newLink;
    dep.subsTail = newLink;
  } else {
    newLink.prevSub = dep.subsTail;
    dep.subsTail!.nextSub = newLink;
    dep.subsTail = newLink;
  }

  // Add to subscriber's dependency list (deps)
  // Note: This part isn't strictly necessary for testing propagate itself,
  // but it creates a more consistent graph state.
  if (!sub.depsHead) {
    sub.depsHead = newLink;
    sub.depsTail = newLink;
  } else {
    // Find the correct place to insert based on sub.depsTail (simplified for testing)
    sub.depsTail!.nextDep = newLink;
    sub.depsTail = newLink;
  }
  return newLink;
};
