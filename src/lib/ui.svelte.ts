// Shared view state (separate from the domain store). The active Blameboard filter, and the
// id of a just-blamed topic to "blaze" (briefly highlight) so it's obvious where it landed.
export const ui = $state<{ filter: 'all' | '24h' | 'mine' | 'news'; blazeId: string }>({
  filter: 'all',
  blazeId: '',
});

let blazeTimer: ReturnType<typeof setTimeout> | undefined;

// Jump to the Mine filter and flag a topic for the fiery highlight (chip + row).
export function showMine(id: string): void {
  ui.filter = 'mine';
  ui.blazeId = id;
  clearTimeout(blazeTimer);
  blazeTimer = setTimeout(() => (ui.blazeId = ''), 1300);
}
