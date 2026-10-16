import { addSums, zeroSums, type OrgNode, type Sums } from './types.ts';

/** Orders live nodes into roots and attached children, folds subtree sums, and returns nodes that no root reaches. */
export function buildTree(nodes: Record<string, OrgNode>): { roots: string[]; unattached: string[] } {
  const ids = Object.keys(nodes);
  for (const id of ids) nodes[id]!.children = [];
  const roots: string[] = [];
  const orphanRoots: string[] = [];
  for (const id of ids) {
    const n = nodes[id]!;
    if (n.reportsTo && nodes[n.reportsTo] && n.reportsTo !== id) nodes[n.reportsTo]!.children.push(id);
    else if (n.reportsTo) orphanRoots.push(id);   // manager missing or terminated
    else roots.push(id);
  }
  const visited = new Set<string>();
  const fold = (id: string, depth: number): Sums => {
    const n = nodes[id]!;
    visited.add(id);
    n.depth = depth;
    n.children = n.children.filter((c) => !visited.has(c));
    let sub = n.own;
    let prior = n.prior?.own ?? null;
    for (const c of n.children) {
      sub = addSums(sub, fold(c, depth + 1));
      const cp = nodes[c]!.prior?.subtree;
      if (prior && cp) prior = addSums(prior, cp);
    }
    n.children.sort((a, b) => nodes[b]!.subtree.tokens - nodes[a]!.subtree.tokens || nodes[a]!.name.localeCompare(nodes[b]!.name));
    n.subtree = sub;
    if (n.prior && prior) n.prior.subtree = prior;
    return sub;
  };
  for (const id of roots) fold(id, 0);
  for (const id of orphanRoots) if (!visited.has(id)) fold(id, 0);
  // Cycles: nodes no root reached. They stay listed, flat, with only their own usage.
  const cyclic = ids.filter((id) => !visited.has(id));
  for (const id of cyclic) { const n = nodes[id]!; n.depth = 0; n.children = []; n.subtree = n.own; }
  const byTokens = (a: string, b: string) => nodes[b]!.subtree.tokens - nodes[a]!.subtree.tokens || nodes[a]!.name.localeCompare(nodes[b]!.name);
  roots.sort(byTokens);
  return { roots, unattached: [...orphanRoots.sort(byTokens), ...cyclic] };
}

export function sumRoots(nodes: Record<string, OrgNode>, roots: string[], unattached: string[], extra: Sums[]): Sums {
  let t = zeroSums();
  for (const id of roots) t = addSums(t, nodes[id]!.subtree);
  for (const id of unattached) t = addSums(t, nodes[id]!.subtree);
  for (const e of extra) t = addSums(t, e);
  return t;
}
