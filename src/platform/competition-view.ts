import type { ContentDTO, ContentPayload } from '../../shared/platform.ts';
import { escapeHtml } from '../html.ts';

const dayMs = 86_400_000;
const minuteMs = 60_000;
const escape = (value: unknown) => escapeHtml(String(value ?? ''));
type Phase = 'unknown' | 'upcoming' | 'open' | 'closing' | 'closed';
type Endpoint = { precision: 'date' | 'datetime'; zone: string; date: string; ordinal: number; at: number | null; label: string };
export interface RegistrationTimeline {
  phase: Phase;
  status: string;
  precision: 'unknown' | 'calendar' | 'exact';
  /** Null means that the source does not support a meaningful progress position. */
  progress: number | null;
  remaining: string;
  note: string;
  startLabel: string;
  endLabel: string;
  startZone: string;
  endZone: string;
  positionLabel: string;
}

function ordinal(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  // A Gregorian calendar index, not an inferred official start or deadline instant.
  return value.getTime() / dayMs;
}

function dateInZone(at: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

function endpoint(input: unknown): Endpoint | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (typeof value.timeZone !== 'string' || !value.timeZone) return null;
  try {
    // Reject unsupported zones before they can throw while rendering an entire list.
    new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format(0);
    if (value.precision === 'date' && typeof value.date === 'string' && value.at == null) {
      const index = ordinal(value.date);
      return index === null ? null : { precision: 'date', zone: value.timeZone, date: value.date, ordinal: index, at: null, label: value.date };
    }
    if (value.precision !== 'datetime' || typeof value.at !== 'string' || value.date != null) return null;
    const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(value.at);
    if (!iso || ordinal(iso[1]) === null || Number(iso[2]) > 23 || Number(iso[3]) > 59 || Number(iso[4] ?? 0) > 59) return null;
    const at = Date.parse(value.at);
    if (!Number.isFinite(at)) return null;
    const date = dateInZone(at, value.timeZone);
    const label = new Intl.DateTimeFormat('zh-CN', { timeZone: value.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    return { precision: 'datetime', zone: value.timeZone, date, ordinal: ordinal(date)!, at, label };
  } catch { return null; }
}

function duration(milliseconds: number): string {
  if (milliseconds >= dayMs) return `${Math.floor(milliseconds / dayMs)} 天 ${Math.floor(milliseconds / 3_600_000) % 24} 小时`;
  if (milliseconds >= 3_600_000) return `${Math.floor(milliseconds / 3_600_000)} 小时 ${Math.floor(milliseconds / minuteMs) % 60} 分`;
  return milliseconds < minuteMs ? '不足 1 分钟' : `${Math.ceil(milliseconds / minuteMs)} 分钟`;
}

/** Pure presentation model. Dates never acquire fabricated time-of-day values. */
export function registrationTimeline(details: ContentPayload['details'], now = Date.now()): RegistrationTimeline {
  const start = endpoint(details.registrationStart), end = endpoint(details.registrationEnd);
  const model: RegistrationTimeline = {
    phase: 'unknown', status: '待公布 / 待核实', precision: 'unknown', progress: null,
    remaining: '报名时间待核实', note: '报名开始与截止时间尚未完整公布。',
    startLabel: start?.label ?? '待公布 / 待核实', endLabel: end?.label ?? '待公布 / 待核实',
    startZone: start?.zone ?? '', endZone: end?.zone ?? '', positionLabel: '',
  };
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return { ...model, note: '当前时间不可用，暂不计算进度。' };
  if (!start || !end) return { ...model, note: !start && end ? '报名开始时间待公布，暂不计算进度。' : start && !end ? '报名截止时间待公布，暂不计算进度。' : model.note };
  if (start.precision !== end.precision) return { ...model, note: '开始与截止的时间精度不同，暂不计算比例。' };

  if (start.precision === 'datetime') {
    const beginning = start.at!, finish = end.at!;
    if (finish <= beginning) return { ...model, note: '截止时间未晚于开始时间，请以官方核实信息为准。' };
    const progress = Math.min(1, Math.max(0, (now - beginning) / (finish - beginning)));
    const phase: Phase = now < beginning ? 'upcoming' : now >= finish ? 'closed' : finish - now <= 3 * dayMs ? 'closing' : 'open';
    return {
      ...model, precision: 'exact', phase, progress,
      status: ({ upcoming: '未开始', open: '报名中', closing: '即将截止', closed: '已截止', unknown: '' })[phase],
      remaining: phase === 'upcoming' ? `距开始 ${duration(beginning - now)}` : phase === 'closed' ? '本轮报名已截止' : `剩余 ${duration(finish - now)}`,
      note: '按已公布的具体时刻计算；正式报名以赛事官方渠道为准。', positionLabel: phase === 'upcoming' ? '开始前' : phase === 'closed' ? '已结束' : '当前',
    };
  }

  if (start.zone !== end.zone) return { ...model, note: '日期采用不同时区，暂不推定跨时区报名区间。' };
  if (end.ordinal < start.ordinal) return { ...model, note: '截止日期早于开始日期，请核实赛事时间。' };
  const today = ordinal(dateInZone(now, start.zone))!;
  const totalDays = end.ordinal - start.ordinal + 1;
  const phase: Phase = today < start.ordinal ? 'upcoming' : today > end.ordinal ? 'closed' : end.ordinal - today <= 3 ? 'closing' : 'open';
  // The marker sits in the current calendar-day cell. This does not estimate the hour.
  const progress = today < start.ordinal ? 0 : today > end.ordinal ? 1 : (today - start.ordinal + 0.5) / totalDays;
  return {
    ...model, precision: 'calendar', phase, progress,
    status: ({ upcoming: '未开始', open: '报名中', closing: '即将截止', closed: '已截止', unknown: '' })[phase],
    remaining: phase === 'upcoming' ? `距开始日 ${start.ordinal - today} 天` : phase === 'closed' ? '本轮报名日期已过' : today === end.ordinal ? '今日截止 · 时刻待公布' : `距截止日 ${end.ordinal - today} 天`,
    note: '日期精度 · 标记表示当前日历日，具体开始 / 截止时刻待公布。',
    positionLabel: phase === 'upcoming' ? '开始前' : phase === 'closed' ? '已结束' : '今日',
  };
}

const ticks = Array.from({ length: 41 }, (_, index) => `<i class="${index % 10 === 0 ? 'is-major' : index % 5 === 0 ? 'is-mid' : ''}" aria-hidden="true"></i>`).join('');
export function renderCompetitionRuler(details: ContentPayload['details'], options: { now?: number; variant?: 'list' | 'detail' } = {}): string {
  const model = registrationTimeline(details, options.now);
  const position = model.progress === null ? '' : `style="--competition-progress:${(model.progress * 100).toFixed(4)}%"`;
  const label = `官方报名时间：${model.status}。${model.remaining}。开始 ${model.startLabel}，截止 ${model.endLabel}。${model.note}`;
  const times = escape(JSON.stringify({ registrationStart: details.registrationStart, registrationEnd: details.registrationEnd }));
  return `<section class="pf-competition-ruler${options.variant === 'detail' ? ' is-detail' : ''}" data-phase="${model.phase}" data-precision="${model.precision}" data-competition-times="${times}" aria-label="官方报名时间"><div class="pf-competition-clock"><span class="pf-competition-status">${escape(model.status)}</span><strong>${escape(model.remaining)}</strong></div><div class="pf-competition-scale" ${position} role="img" aria-label="${escape(label)}"><div class="pf-competition-scale-base"></div>${model.progress === null ? '' : '<div class="pf-competition-scale-fill"></div>'}<div class="pf-competition-ticks">${ticks}</div>${model.progress === null ? '<span class="pf-competition-unconfirmed">— —</span>' : `<span class="pf-competition-needle" data-edge="${model.progress < .08 ? 'start' : model.progress > .92 ? 'end' : 'middle'}"><b>${model.positionLabel}</b></span>`}</div><div class="pf-competition-endpoints"><div><span>报名开始</span><time>${escape(model.startLabel)}</time>${model.startZone ? `<small>${escape(model.startZone)}</small>` : ''}</div><div><span>报名截止</span><time>${escape(model.endLabel)}</time>${model.endZone ? `<small>${escape(model.endZone)}</small>` : ''}</div></div><p class="pf-competition-time-note">${escape(model.note)}</p></section>`;
}

/** Call from the existing minute/focus refresh, even while a filter input has focus. */
export function refreshCompetitionRulers(host: ParentNode, now = Date.now()): void {
  for (const element of host.querySelectorAll<HTMLElement>('[data-competition-times]')) {
    try {
      const details = JSON.parse(element.dataset.competitionTimes!);
      const wrapper = document.createElement('template');
      wrapper.innerHTML = renderCompetitionRuler(details, { now, variant: element.classList.contains('is-detail') ? 'detail' : 'list' });
      element.replaceWith(wrapper.content);
    } catch { /* A detached or obsolete view will be replaced by the route renderer. */ }
  }
}

export function renderCompetitionFilters(query: URLSearchParams, directions: Record<string, string>): string {
  const selected = (name: string, value: string, fallback = '') => (query.get(name) ?? fallback) === value ? ' selected' : '';
  const option = (name: string, value: string, text: string, fallback = '') => `<option value="${escape(value)}"${selected(name, value, fallback)}>${escape(text)}</option>`;
  return `<form class="pf-filters pf-competition-filters" data-pf-form="filter" aria-label="筛选赛事"><label class="pf-competition-search">搜索<input aria-label="搜索" name="q" type="search" placeholder="搜索赛事名称或关键词" value="${escape(query.get('q'))}" maxlength="200"/></label><label>方向<select aria-label="方向" name="direction">${option('direction', '', '全部方向')}${Object.entries(directions).map(([key, text]) => option('direction', key, text)).join('')}</select></label><label>报名状态<select aria-label="报名状态" name="phase">${Object.entries({ '': '全部状态', upcoming: '未开始', open: '报名中', closed: '已截止', unknown: '待核实' }).map(([key, text]) => option('phase', key, text)).join('')}</select></label><label>排序<select aria-label="排序" name="sort">${Object.entries({ newest: '最新发布', oldest: '最早发布', title: '标题', order: '编辑排序', deadline: '截止时间' }).map(([key, text]) => option('sort', key, text, 'newest')).join('')}</select></label><label class="pf-competition-year">年份<input aria-label="年份" name="year" type="number" min="2000" max="2200" placeholder="全部" value="${escape(query.get('year'))}"/></label><button type="submit">筛选</button></form>`;
}

export function renderCompetitionRow(item: ContentDTO, publishedLabel: string): string {
  const payload = item.payload, year = payload.details.year;
  return `<article class="pf-row pf-competition-row"><div><div class="pf-competition-row-heading"><div><div class="pf-meta">${payload.pinned ? '<b>置顶</b>' : ''}${payload.importance === 'important' ? '<b>重要</b>' : ''}${year ? `<span>${escape(year)}</span>` : ''}${payload.details.edition ? `<span>${escape(payload.details.edition)}</span>` : ''}</div><h3><a href="#/competitions/${escape(item.id)}" data-pf-link>${escape(payload.title)}</a></h3></div>${payload.coverId ? `<img class="pf-cover-thumb" src="/api/v1/media/${encodeURIComponent(payload.coverId)}/download" alt="" loading="lazy"/>` : ''}</div>${renderCompetitionRuler(payload.details)}${payload.summary ? `<p class="pf-competition-summary">${escape(payload.summary)}</p>` : ''}<div class="pf-meta pf-competition-published"><span>发布于</span><time>${escape(publishedLabel)}</time><a href="#/competitions/${escape(item.id)}" data-pf-link>赛事详情 ↗</a></div></div></article>`;
}
