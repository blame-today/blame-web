import { describe, it, expect } from 'vitest';
import { checkContent } from '$lib/filter';

// Auto-maintained by scripts/vulgarity-audit.mjs (issue #22). Each run appends the entries the audit
// flagged that day, as a standing regression that they stay blocked. Do not hand-edit.
describe('audited vulgar blocklist', () => {
  it('audit 2026-07-03: blocks the flagged vulgar entries', () => {
    for (const t of ["Donkey Boy","Boom Boom"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-07-03: blocks the flagged vulgar entries', () => {
    for (const t of ["Shrex"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-07-04: blocks the flagged vulgar entries', () => {
    for (const t of ["vomiting at you deliberately","Mushy miralax mound"]) {
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
  it('audit 2026-07-13: blocks the flagged vulgar entries', () => {
    for (const t of ["Kuk","Chuj","Ching","capu"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-08-08: blocks the flagged vulgar entries', () => {
    for (const t of ["Epstein","Gwyneth Paltrow"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-08-10: blocks the flagged vulgar entries', () => {
    for (const t of ["the prompt cache 5-minute TTL","claude"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-08-16: blocks the flagged vulgar entries', () => {
    for (const t of ["Dua Lipa","swifties"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-08-19: blocks the flagged vulgar entries', () => {
    for (const t of ["silly web app side projects","empty heartbeats"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-09-04: blocks the flagged vulgar entries', () => {
    for (const t of ["Jenny"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-09-13: blocks the flagged vulgar entries', () => {
    for (const t of ["tom"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
  it('audit 2026-09-14: blocks the flagged vulgar entries', () => {
    for (const t of ["Kamala Harris","UFC"]) {
      expect(checkContent(t)).toBe('No bad words!');
    }
  });
});
