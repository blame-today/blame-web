import { describe, it, expect } from 'vitest';
import { checkContent } from '$lib/filter';

// Auto-maintained by scripts/vulgarity-audit.mjs (issue #22). Each run appends the entries gemini
// flagged that day, as a standing regression that they stay blocked. Do not hand-edit.
describe('audited vulgar blocklist', () => {
  it('audit 2026-07-03: blocks the flagged vulgar entries', () => {
    for (const t of ["Donkey Boy","Boom Boom"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-07-03: blocks the flagged vulgar entries', () => {
    for (const t of ["Shrex","Gas pains"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-07-04: blocks the flagged vulgar entries', () => {
    for (const t of ["vomiting at you deliberately","Epstein","Mushy miralax mound","the divorce lawyer"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-07-07: blocks the flagged vulgar entries', () => {
    for (const t of ["aliens making you gay"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-07-11: blocks the flagged vulgar entries', () => {
    for (const t of ["libido"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
});
