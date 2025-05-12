// system.test.ts
import {
  createReactiveSystem,
  ReactiveNode,
  LinkNode,
  Flags,
  STALE,
} from "../system";
import { createMockNode, linkNodes } from "./utils"; // Adjust path if needed

describe("propagate", () => {
  let propagate: (current: LinkNode) => void;

  beforeEach(() => {
    // Instantiate the system to get the propagate function.
    // The specific implementations of updateComputed and notifyEffect
    // are not needed for testing propagate's core logic.
    const system = createReactiveSystem({
      update: jest.fn(),
      runEffect: jest.fn(),
    });
    propagate = system.propagate;
  });

  test("should mark a single direct subscriber as STALE", () => {
    const depA = createMockNode("dep");
    const subB = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const linkAB = linkNodes(depA, subB); // A -> B

    expect(subB.flags & STALE).toBe(0); // Initially not STALE

    // Propagate starts from the first link in the dependency's subscriber list
    propagate(linkAB);

    expect(subB.flags & STALE).toBe(STALE);
  });

  test("should mark multiple direct subscribers as STALE", () => {
    const depA = createMockNode("dep");
    const subB = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const subC = createMockNode("derived", 0 as Flags) as ReactiveNode;

    const linkAB = linkNodes(depA, subB); // A -> B
    linkNodes(depA, subC); // A -> C (linkAB.nextSub will point to linkAC)

    expect(subB.flags & STALE).toBe(0);
    expect(subC.flags & STALE).toBe(0);

    propagate(linkAB); // Start propagation from the first subscriber link (linkAB)

    expect(subB.flags & STALE).toBe(STALE);
    expect(subC.flags & STALE).toBe(STALE); // Should also mark siblings
  });

  test("should mark subscribers in a chain as STALE", () => {
    // A -> B -> C
    const depA = createMockNode("dep");
    const subB = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const subC = createMockNode("derived", 0 as Flags) as ReactiveNode;

    const linkAB = linkNodes(depA, subB);
    linkNodes(subB, subC); // B -> C

    expect(subB.flags & STALE).toBe(0);
    expect(subC.flags & STALE).toBe(0);

    propagate(linkAB);

    expect(subB.flags & STALE).toBe(STALE);
    expect(subC.flags & STALE).toBe(STALE); // Should mark downstream nodes
  });

  test("should mark subscribers in a diamond dependency graph as STALE", () => {
    //   A
    //  / \
    // B   C
    //  \ /
    //   D
    const depA = createMockNode("dep");
    const subB = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const subC = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const subD = createMockNode("derived", 0 as Flags) as ReactiveNode;

    const linkAB = linkNodes(depA, subB); // A -> B
    linkNodes(depA, subC); // A -> C
    linkNodes(subB, subD); // B -> D
    linkNodes(subC, subD); // C -> D

    expect(subB.flags & STALE).toBe(0);
    expect(subC.flags & STALE).toBe(0);
    expect(subD.flags & STALE).toBe(0);

    propagate(linkAB); // Start from A's first subscriber link (linkAB)

    expect(subB.flags & STALE).toBe(STALE);
    expect(subC.flags & STALE).toBe(STALE); // Marks sibling C
    expect(subD.flags & STALE).toBe(STALE); // Marks D via both B and C paths
  });

  test("should handle propagation when a node is already STALE", () => {
    // A -> B -> C
    const depA = createMockNode("dep");
    const subB = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const subC = createMockNode("derived", STALE) as ReactiveNode; // C is already STALE

    const linkAB = linkNodes(depA, subB);
    linkNodes(subB, subC); // B -> C

    expect(subB.flags & STALE).toBe(0);
    expect(subC.flags & STALE).toBe(STALE);

    propagate(linkAB);

    expect(subB.flags & STALE).toBe(STALE);
    expect(subC.flags & STALE).toBe(STALE); // C remains STALE (flag is OR'd)
  });

  test("should handle nodes with no further subscribers", () => {
    // A -> B (B has no subscribers)
    const depA = createMockNode("dep");
    const subB = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const linkAB = linkNodes(depA, subB);

    expect(subB.flags & STALE).toBe(0);
    propagate(linkAB);
    expect(subB.flags & STALE).toBe(STALE); // B gets marked

    // Test propagation starting from a node that itself has subscribers,
    // but one of those subscribers is a leaf node.
    // A -> B -> C (leaf)
    //      \
    //       D (leaf)
    const depA2 = createMockNode("dep");
    const subB2 = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const subC2 = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const subD2 = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const linkA2B2 = linkNodes(depA2, subB2);
    linkNodes(subB2, subC2); // B2 -> C2
    linkNodes(subB2, subD2); // B2 -> D2

    propagate(linkA2B2);
    expect(subB2.flags & STALE).toBe(STALE);
    expect(subC2.flags & STALE).toBe(STALE); // Leaf node marked
    expect(subD2.flags & STALE).toBe(STALE); // Leaf node marked
  });

  test("should handle complex graph structures", () => {
    //    A --- B
    //   / \   / \
    //  C   D-E---F
    //   \ /   \ /
    //    G-----H
    const depA = createMockNode("dep");
    const subB = createMockNode("derived", 0 as Flags) as ReactiveNode; // B depends on A
    const subC = createMockNode("derived", 0 as Flags) as ReactiveNode; // C depends on A
    const subD = createMockNode("derived", 0 as Flags) as ReactiveNode; // D depends on A, B
    const subE = createMockNode("derived", 0 as Flags) as ReactiveNode; // E depends on B, D
    const subF = createMockNode("derived", 0 as Flags) as ReactiveNode; // F depends on E
    const subG = createMockNode("derived", 0 as Flags) as ReactiveNode; // G depends on C, D
    const subH = createMockNode("derived", 0 as Flags) as ReactiveNode; // H depends on E, F, G

    // Establish dependencies (only A's needed for starting propagation)
    const linkAC = linkNodes(depA, subC); // A -> C (Assume this is subsHead for A)
    linkNodes(depA, subD); // A -> D
    linkNodes(depA, subB); // A -> B (Order matters for subsHead/nextSub)

    // Other dependencies for graph structure
    linkNodes(subB, subD); // B -> D
    linkNodes(subB, subE); // B -> E
    linkNodes(subC, subG); // C -> G
    linkNodes(subD, subE); // D -> E
    linkNodes(subD, subG); // D -> G
    linkNodes(subE, subF); // E -> F
    linkNodes(subE, subH); // E -> H
    linkNodes(subF, subH); // F -> H
    linkNodes(subG, subH); // G -> H

    // Initial state check
    const allSubs = [subB, subC, subD, subE, subF, subG, subH];
    allSubs.forEach((sub) => expect(sub.flags & STALE).toBe(0));

    // Propagate starting from A (using linkAC as the first link)
    propagate(linkAC);

    // Check final state
    expect(subC.flags & STALE).toBe(STALE); // Directly reached
    expect(subD.flags & STALE).toBe(STALE); // Reached as sibling of C, also via B later
    expect(subB.flags & STALE).toBe(STALE); // Reached as sibling of D
    expect(subG.flags & STALE).toBe(STALE); // Reached via C and D
    expect(subE.flags & STALE).toBe(STALE); // Reached via B and D
    expect(subH.flags & STALE).toBe(STALE); // Reached via G and E (and F)
    expect(subF.flags & STALE).toBe(STALE); // Reached via E
  });

  test("should handle cycles without infinite loops", () => {
    // A -> B -> C -> A (conceptual cycle, A is also a Derived node)
    const subA = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const subB = createMockNode("derived", 0 as Flags) as ReactiveNode;
    const subC = createMockNode("derived", 0 as Flags) as ReactiveNode;

    const linkAB = linkNodes(subA, subB); // A -> B
    linkNodes(subB, subC); // B -> C
    linkNodes(subC, subA); // C -> A (Cycle link)

    expect(subA.flags & STALE).toBe(0);
    expect(subB.flags & STALE).toBe(0);
    expect(subC.flags & STALE).toBe(0);

    // Propagate starting from A's link to B
    propagate(linkAB);

    // All nodes in the cycle reachable from the start should be marked STALE
    expect(subA.flags & STALE).toBe(STALE); // Marked via C
    expect(subB.flags & STALE).toBe(STALE); // Marked via A
    expect(subC.flags & STALE).toBe(STALE); // Marked via B
  });
});
