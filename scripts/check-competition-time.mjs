import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationTimeline, renderCompetitionRuler, renderCompetitionFilters } from '../src/platform/competition-view.ts';

const instant = (at, timeZone = 'Asia/Shanghai') => ({ precision: 'datetime', at, date: null, timeZone });
const date = (value, timeZone = 'Asia/Shanghai') => ({ precision: 'date', date: value, at: null, timeZone });
const model = (start, end, now) => registrationTimeline({ registrationStart: start, registrationEnd: end }, Date.parse(now));

test('an exact window has truthful boundaries, a half-way point and a finished state', () => {
  const start = instant('2026-09-01T00:00:00+08:00'), end = instant('2026-09-11T00:00:00+08:00');
  assert.equal(model(start, end, '2026-08-31T23:59:59+08:00').progress, 0);
  assert.equal(model(start, end, '2026-08-31T23:59:59+08:00').phase, 'upcoming');
  assert.equal(model(start, end, '2026-09-01T00:00:00+08:00').phase, 'open');
  assert.equal(model(start, end, '2026-09-06T00:00:00+08:00').progress, .5);
  assert.equal(model(start, end, '2026-09-10T23:59:59+08:00').remaining, '剩余 不足 1 分钟');
  assert.equal(model(start, end, '2026-09-11T00:00:00+08:00').phase, 'closed');
  assert.equal(model(start, end, '2026-09-12T00:00:00+08:00').progress, 1);
});

test('exact instants handle offset changes across a DST fall-back', () => {
  const start = instant('2026-11-01T00:00:00-04:00', 'America/New_York');
  const end = instant('2026-11-01T04:00:00-05:00', 'America/New_York');
  assert.equal(model(start, end, '2026-11-01T01:30:00-05:00').progress, .5);
});

test('unknown, partial, invalid and contradictory source data never creates a progress value', () => {
  const known = instant('2026-09-10T00:00:00Z');
  for (const [start, end] of [[null, null], [undefined, known], [known, { precision: 'unknown' }], [date('2026-02-30'), date('2026-03-04')], [known, known], [instant('2026-09-12T00:00:00Z'), known], [instant('2026-02-30T00:00:00Z'), known], [instant('2026-09-01T00:00:00Z', 'Invalid/Zone'), known]]) {
    const value = model(start, end, '2026-09-05T00:00:00Z');
    assert.equal(value.progress, null); assert.equal(value.phase, 'unknown');
  }
  assert.equal(model(date('2026-09-01'), known, '2026-09-05T00:00:00Z').progress, null);
  assert.equal(model(date('2026-09-01', 'Asia/Shanghai'), date('2026-09-10', 'America/New_York'), '2026-09-05T00:00:00Z').progress, null);
});

test('date precision changes at the source IANA midnight, never at the viewer UTC midnight', () => {
  const start = date('2026-03-07', 'America/New_York'), end = date('2026-03-10', 'America/New_York');
  assert.equal(model(start, end, '2026-03-08T04:59:59Z').progress, .125);
  assert.equal(model(start, end, '2026-03-08T05:00:00Z').progress, .375);
  // The next local day begins after a 23-hour DST day.
  assert.equal(model(start, end, '2026-03-09T03:59:59Z').progress, .375);
  assert.equal(model(start, end, '2026-03-09T04:00:00Z').progress, .625);
});

test('a calendar deadline remains date-only for the whole named local day', () => {
  const start = date('2026-09-28', 'Pacific/Kiritimati'), end = date('2026-09-28', 'Pacific/Kiritimati');
  const before = model(start, end, '2026-09-27T09:59:59Z');
  const first = model(start, end, '2026-09-27T10:00:00Z');
  const last = model(start, end, '2026-09-28T09:59:59Z');
  const after = model(start, end, '2026-09-28T10:00:00Z');
  assert.equal(before.phase, 'upcoming');
  assert.equal(first.progress, .5); assert.equal(last.progress, .5);
  assert.equal(first.remaining, '今日截止 · 时刻待公布');
  assert.equal(after.phase, 'closed');
  assert.doesNotMatch(first.remaining, /小时|分钟|秒/);
});

test('repeated DST hours do not advance a date-only marker', () => {
  const start = date('2026-10-31', 'America/New_York'), end = date('2026-11-02', 'America/New_York');
  assert.equal(model(start, end, '2026-11-01T01:30:00-04:00').progress, model(start, end, '2026-11-01T01:30:00-05:00').progress);
});

test('unknown rulers have no fill/needle and preserve required filter parameter names safely', () => {
  const html = renderCompetitionRuler({ registrationStart: null, registrationEnd: null });
  assert.doesNotMatch(html, /pf-competition-scale-fill|pf-competition-needle|--competition-progress/);
  assert.match(html, /待公布 \/ 待核实/);
  const filters = renderCompetitionFilters(new URLSearchParams({ q: '"><script>alert(1)</script>', phase: 'open', year: '2026', sort: 'deadline', direction: 'ai' }), { ai: 'AI 与智能系统' });
  for (const name of ['q', 'direction', 'phase', 'year', 'sort']) assert.match(filters, new RegExp(`name="${name}"`));
  assert.match(filters, /data-pf-form="filter"/); assert.doesNotMatch(filters, /<script>/); assert.match(filters, /value="deadline" selected/);
});
