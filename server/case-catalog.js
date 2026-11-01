/** Initial shelf metadata. Keep both maxima used by the unchanged public UI. */
export function caseSummary(c) {
  const normal = c.items.filter(i => i.kind === 'item').reduce((best, i) => !best || i.value > best.value ? i : best, null);
  const maximum = c.items.reduce((best, i) => !best || i.value > best.value ? i : best, null);
  return { ...c, items: [...new Set([normal, maximum].filter(Boolean))], detailsLoaded: false };
}
