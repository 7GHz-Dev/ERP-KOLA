/** The queue displays at most 100 jobs; preserve its selection order in the preview. */
export function doPaySelectionIds(value: string | string[] | undefined): string[] {
  const ids = [...new Set((typeof value === 'string' ? [value] : value ?? []).map(id => id.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 100 || ids.some(id => id.length > 80)) return [];
  return ids;
}
