import { blankPayload, contentLabels, directionKeys, type ContentDTO, type ContentKind, type ContentPayload, type DateValue, type MediaDTO, type PageMeta, type SafeUser, type SiteSettings, type FavoriteDTO, type NotificationDTO, type ApplicationDTO, type ProjectMemberDTO, type RegistrationDTO, type CompetitionIntentDTO, type AdminContentDTO } from '../../shared/platform';
import { escapeHtml as esc } from '../html';
import { type StarMapUI } from '../ui/star-map-ui';
import { platformApi as api, ApiError, errorMessage } from './api';
import './platform.css';
import { renderCompetitionFilters, renderCompetitionRow, renderCompetitionRuler, registrationTimeline, refreshCompetitionRulers } from './competition-view';
import './competition-view.css';

const directions = { ai: 'AI 与智能系统', robotics: '具身智能与机器人', interaction: '新媒体与交互设计', visual: '文创与视觉设计', xr: 'XR 与交互娱乐', hardware: '智能硬件' };
const labels: Record<string, string> = { ...contentLabels, core: '社团介绍', learning: '学习中心', account: '个人中心', favorites: '我的收藏', applications: '项目申请', registrations: '活动报名', intents: '参赛意向', notifications: '站内通知', profile: '基础资料', security: '账户安全', projects: '参与项目', works: '我的投稿' };
const statusLabels: Record<string, string> = { PENDING: '待处理', APPROVED: '已批准', REJECTED: '已拒绝', WITHDRAWN: '已撤回', ACTIVE: '有效', CANCELLED: '已取消', LEFT: '已退出', REMOVED: '已移除', DRAFT: '草稿', REVIEW: '审核中', RETURNED: '已退回', PUBLISHED: '已发布', ARCHIVED: '已归档', REGISTERED: '已报名', BEGINNER: '入门', INTERMEDIATE: '进阶', ADVANCED: '高级', IDEA: '构思', BUILDING: '进行中', RECRUITING: '招募中', COMPLETED: '已结束', SCHEDULED: '活动预告', ARTICLE: '文章', VIDEO: '视频', COURSE: '课程', TOOL: '工具', FILE: '文件' };
const e = (value: unknown) => esc(String(value ?? ''));
const enc = encodeURIComponent;
const fmt = (value: unknown, zone = 'Asia/Shanghai') => value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(String(value))) : '待公布 / 待核实';
const deadline = (value: unknown) => {
  const date = value as DateValue | null;
  return !date || date.precision === 'unknown' ? '待公布 / 待核实' : date.precision === 'date' ? `${e(date.date)}（日期精度 · ${e(date.timeZone)}）` : `${e(fmt(date.at, date.timeZone))}（${e(date.timeZone)}）`;
};
const external = (url: unknown, label: string) => typeof url === 'string' && /^https?:\/\//i.test(url) ? `<a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(label)} ↗</a>` : '';
const nav = (path: string, label: string) => `<a href="#/${e(path)}" data-pf-link>${e(label)}</a>`;
const contentRoute = (item: ContentDTO) => item.kind === 'directions' ? `directions/${item.payload.details.key}` : `${item.kind}/${item.id}`;
const button = (action: string, label: string, attrs = '') => `<button type="button" data-pf="${action}" ${attrs}>${e(label)}</button>`;
const field = (name: string, label: string, value = '', type = 'text', extra = '') => `<label>${e(label)}<input aria-label="${e(label)}" name="${name}" type="${type}" value="${e(value)}" ${extra} /></label>`;
const textarea = (name: string, label: string, value = '', extra = '') => `<label>${e(label)}<textarea aria-label="${e(label)}" name="${name}" rows="5" ${extra}>${e(value)}</textarea></label>`;
const directionSelect = (value = '') => `<label>方向<select aria-label="方向" name="direction"><option value="">全部方向</option>${directionKeys.map(key => `<option value="${key}" ${key === value ? 'selected' : ''}>${directions[key]}</option>`).join('')}</select></label>`;
const choices = (name: string, values: readonly string[], current: string, names: Record<string, string>) => `<select aria-label="${e(({difficulty: '难度', phase: '报名状态', sort: '排序'} as Record<string,string>)[name] ?? name)}" name="${name}">${values.map(value => `<option value="${e(value)}" ${current === value ? 'selected' : ''}>${e(names[value] ?? value)}</option>`).join('')}</select>`;
const attachments = (ids: unknown, title = '附件') => Array.isArray(ids) && ids.length ? `<section class="pf-section"><h3>${title}</h3>${ids.map((id, i) => `<a class="pf-attachment" href="/api/v1/media/${enc(String(id))}/download" target="_blank" rel="noopener">下载附件 ${i + 1} ↗</a>`).join('')}</section>` : '';
type Position = { id: string; title: string; description: string; capacity: number; enabled: boolean };
type Author = { userId: string | null; name: string };
type Award = { title: string; evidenceUrl: string };
type Step = { title: string; body: string; resourceIds: string[]; sortOrder: number };

/** Business UI is a DOM layer inside the existing terminal. It never owns a renderer. */
export class PlatformUI {
  private active = false;
  private navigation = false;
  private generation = 0;
  private routeWork: Promise<void> = Promise.resolve();
  private lastRoute = location.hash;
  private abort?: AbortController;
  private settings?: SiteSettings;
  private content?: ContentDTO;
  private ownWorks: AdminContentDTO[] = [];
  private draft?: ContentPayload;
  private draftId?: string;
  private draftRevision?: number;
  private dirty = false;
  private favorites: FavoriteDTO[] = [];
  private actionState: { registered?: boolean; intent?: boolean; applied?: boolean } = {};
  private read = new Set<string>();
  private userId = api.session?.user?.id;
  private removeSession: () => void;
  private poll: ReturnType<typeof setInterval>;
  constructor(private map: StarMapUI, private options: { login: () => void }) {
    map.element.addEventListener('click', this.click);
    map.element.addEventListener('submit', this.submit);
    map.element.addEventListener('input', this.input);
    window.addEventListener('hashchange', this.routeChanged);
    window.addEventListener('popstate', this.routeChanged);
    window.addEventListener('focus', this.refresh);
    window.addEventListener('beforeunload', this.beforeUnload);
    this.removeSession = api.subscribe(session => {
      if (this.userId !== session?.user?.id) {
        this.userId = session?.user?.id; this.abort?.abort();
        this.draft = undefined; this.draftId = undefined; this.draftRevision = undefined;
        this.dirty = false; this.map.detailHost.replaceChildren();
      }
      this.favorites = []; this.ownWorks = []; this.content = undefined; this.read.clear();
      if (this.active) void this.showRoute(false);
    });
    this.poll = setInterval(this.refresh, 60000);
  }
  activate() { this.active = true; void this.loadSettings(); void this.showRoute(false); }
  suspend() { this.active = false; this.abort?.abort(); }
  openFromMap(id: string) {
    if (this.navigation) return;
    const route = directionKeys.some(key => key === id) ? `directions/${id}` : id;
    history.pushState(null, '', `#/${route}`); this.lastRoute = location.hash; void this.render(false);
  }
  closedFromMap() {
    if (this.navigation || !this.active) return;
    this.abort?.abort(); this.content = undefined; this.dirty = false;
    history.pushState(null, '', this.map.currentLevel === 'directions' ? '#/directions' : '#/');
    this.lastRoute = location.hash;
  }
  mainLevel() { if (this.navigation && this.route().parts[0] === 'core') return; void this.navigate('core'); }
  private route() {
    let value = location.hash.replace(/^#\/?/, '');
    if (value.startsWith('star/')) {
      const old = value.slice(5);
      value = directionKeys.some(key => key === old) ? `directions/${old}` : ({ project: 'projects', competition: 'competitions', salon: 'events', portfolio: 'works', join: 'core' } as Record<string, string>)[old] ?? old;
    }
    const [path, query = ''] = value.split('?');
    return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(query) };
  }
  private routeChanged = () => {
    if (!this.active || this.lastRoute === location.hash) return;
    if (!this.confirmClose()) { history.pushState(null, '', this.lastRoute); return; }
    if (!this.route().parts.length && this.map.currentLevel === 'directions') history.replaceState(null, '', '#/core');
    if (this.route().parts[0] !== 'directions') { this.map.cancelCoreEntry(); this.abort?.abort(); }
    this.lastRoute = location.hash; void this.showRoute(false);
  };
  confirmClose() { if (this.dirty && !confirm('有尚未保存的修改。确定离开？')) return false; this.dirty = false; return true; }
  private beforeUnload = (event: BeforeUnloadEvent) => { if (this.dirty) { event.preventDefault(); event.returnValue = ''; } };
  private input = (event: Event) => { if ((event.target as Element).closest('[data-pf-form="work"],[data-pf-form="profile"]')) this.dirty = true; };
  private refresh = () => {
    if (this.active && !document.hidden) refreshCompetitionRulers(this.map.detailHost);
    if (!this.active || this.navigation || document.hidden || this.dirty || this.map.element.querySelector('form')?.contains(document.activeElement)) return;
    void this.loadSettings(); if (this.map.activeStar) void this.render(true);
  };
  private async loadSettings() {
    try { const response = await api.request<SiteSettings>('/site-settings'); this.settings = response.data; this.map.updateSite(response.data); this.map.setConnection(true); }
    catch { this.map.setConnection(false); }
  }
  async navigate(path: string, replace = false) {
    if (this.dirty && !confirm('有尚未保存的修改。确定离开？')) return;
    this.dirty = false;
    if (!path && this.map.currentLevel === 'directions') path = 'core';
    if (!path.startsWith('directions')) { this.map.cancelCoreEntry(); this.abort?.abort(); }
    history[replace ? 'replaceState' : 'pushState'](null, '', `#/${path}`);
    this.lastRoute = location.hash;
    await this.showRoute(false);
  }
  private showRoute(refresh: boolean): Promise<void> {
    const route = location.hash;
    this.routeWork = this.routeWork.catch(() => {}).then(() => this.displayRoute(refresh, route));
    return this.routeWork;
  }
  private async displayRoute(refresh: boolean, route: string) {
    const current = () => this.active && location.hash === route;
    if (!current()) return;
    const { parts } = this.route();
    if (parts[0]?.startsWith('auth')) return;
    this.navigation = true;
    try {
      if (parts[0] === 'directions' && this.map.currentLevel !== 'directions') {
        const hasCoreContent = this.map.activeStar === 'core' && Boolean(this.map.detailHost.querySelector('.pf-content'));
        if (!(await this.map.navigateStar('core')) || !current()) return;
        this.map.prepareCoreEntry();
        if (!hasCoreContent) {
          const content = await this.coreForJourney();
          if (!current()) return;
          this.map.detailHost.innerHTML = content;
        }
        if (!(await this.map.enterDirections())) {
          if (current()) void this.navigate('core', true);
          return;
        }
        if (!current()) return;
      } else if (parts[0] !== 'directions' && this.map.currentLevel === 'directions') {
        if (this.map.activeStar) { this.map.closeDetail(); await this.waitClosed(); }
        if (!current()) return;
        const content = await this.coreForJourney();
        if (!current()) return;
        if (!(await this.map.leaveDirections(content))) return;
        if (!current()) return;
        if (parts[0] === 'core') return;
      }
      if (!parts.length || parts[0] === 'directions' && !parts[1]) {
        if (this.map.activeStar) { this.map.closeDetail(); await this.waitClosed(); }
        if (current()) this.map.setLevel(parts[0] === 'directions' ? 'directions' : 'main'); return;
      }
      const star = parts[0] === 'directions' ? parts[1] : ['resources','learning-paths'].includes(parts[0]) ? 'learning' : parts[0] === 'pages' ? 'core' : parts[0];
      if (!(await this.map.navigateStar(star))) {
        if (!current()) return;
        await this.map.navigateStar('core'); this.map.detailHost.innerHTML = this.heading('无法打开此栏目') + '<p class="pf-error">栏目不存在或已停用，请从星图选择其他栏目。</p>'; return;
      }
      if (!current()) return;
      await this.render(refresh);
    } finally { this.navigation = false; }
  }
  private async coreForJourney() {
    this.abort?.abort(); const controller = this.abort = new AbortController(); ++this.generation;
    this.content = undefined;
    try { return `<div class="pf-content">${await this.core(controller.signal)}</div>`; }
    catch (error) { return `<div class="pf-content">${this.heading('社团介绍 / IXD CORE')}<p class="pf-error">${e(errorMessage(error))}</p>${button('refresh','重新读取')}${button('directions','进入方向二级星图 →')}</div>`; }
  }
  private waitClosed() { return new Promise<void>(resolve => { const wait = () => this.map.activeStar ? requestAnimationFrame(wait) : resolve(); wait(); }); }
  private heading(title: string, subtitle = 'IXD / COMMUNITY PLATFORM') { return `<div class="pf-top"><p class="sm-detail-code">${e(subtitle)}</p><h2 id="sm-detail-title">${e(title)}</h2><div class="pf-feedback" role="status" aria-live="polite"></div></div>`; }
  private async render(refresh: boolean) {
    if (!this.map.activeStar) return;
    this.abort?.abort(); const controller = this.abort = new AbortController(), generation = ++this.generation;
    const host = this.map.detailHost, scrollTop = host.scrollTop;
    const { parts, query } = this.route();
    let key = parts[0] ?? this.map.activeStar;
    if (key === 'learning') key = 'resources';
    if (!refresh) host.innerHTML = this.heading(labels[key] ?? 'IXD') + '<p class="pf-empty" role="status">正在读取…</p>';
    try {
      let html: string;
      if (key === 'account') html = await this.account(parts[1] ?? 'profile', parts[2], query, controller.signal);
      else if (key === 'core') html = await this.core(controller.signal);
      else if (key === 'directions') {
        const list = await api.request<ContentDTO[]>('/directions?pageSize=100', { signal: controller.signal });
        const item = list.data.find(item => item.payload.details.key === parts[1]);
        html = item ? await this.detail(item, controller.signal) : this.heading(directions[parts[1] as keyof typeof directions] ?? '方向') + '<p class="pf-empty">此方向尚未发布介绍。</p>';
      } else if (key in contentLabels) {
        if (parts[1]) html = await this.detail((await api.request<ContentDTO>(`/${key}/${enc(parts[1])}`, { signal: controller.signal })).data, controller.signal);
        else html = await this.list(key as ContentKind, query, controller.signal);
      } else html = this.heading('无法打开') + '<p class="pf-error">没有这个页面。</p>';
      if (generation !== this.generation || controller.signal.aborted) return;
      host.innerHTML = `<div class="pf-content">${html}</div>`;
      host.scrollTop = refresh ? scrollTop : 0;
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation) return;
      if (refresh) this.feedback(errorMessage(error), true);
      else host.innerHTML = this.heading(labels[key] ?? 'IXD') + `<p class="pf-error">${e(errorMessage(error))}</p>${button('refresh','重新读取')}`;
    }
  }
  private pagination(meta: PageMeta | undefined) {
    if (!meta) return '';
    return `<nav class="pf-pagination" aria-label="分页">${button('page','上一页', `data-page="${meta.page - 1}" ${meta.page <= 1 ? 'disabled' : ''}`)}<span>第 ${meta.page} 页 · ${meta.total} 条</span>${button('page','下一页', `data-page="${meta.page + 1}" ${meta.page * meta.pageSize >= meta.total ? 'disabled' : ''}`)}</nav>`;
  }
  private async ownedPages<T>(path: string, signal: AbortSignal) {
    const rows: T[] = [];
    for (let page = 1; ; page++) {
      const result = await api.request<T[]>(`${path}?pageSize=100&page=${page}`, { signal });
      rows.push(...result.data);
      if (result.data.length < 100 || result.meta && rows.length >= result.meta.total) return rows;
    }
  }
  private async list(kind: ContentKind, query: URLSearchParams, signal: AbortSignal) {
    const allowed = new Set(['q','direction','year','difficulty','phase','sort','page']);
    const params = new URLSearchParams([...query].filter(([key,value]) => allowed.has(key) && value)); params.set('pageSize','12');
    const result = await api.request<ContentDTO[]>(`/${kind}?${params}`, { signal });
    const learning = kind === 'resources' || kind === 'learning-paths';
    const filters = kind === 'competitions' ? renderCompetitionFilters(query, directions) : `<form class="pf-filters" data-pf-form="filter">${field('q','搜索',query.get('q') ?? '', 'search', 'maxlength="200"')}${directionSelect(query.get('direction') ?? '')}${learning ? `<label>难度${choices('difficulty',['','BEGINNER','INTERMEDIATE','ADVANCED'],query.get('difficulty') ?? '',{ '':'全部难度',...statusLabels })}</label>` : ''}<label>排序${choices('sort',['newest','oldest','title','order',],query.get('sort') ?? 'newest',{newest:'最新发布',oldest:'最早发布',title:'标题',order:'编辑排序',deadline:'截止时间'})}</label><button type="submit">搜索 / 筛选</button></form>`;
    const descriptionKey = learning ? 'learning' : kind;
    return this.heading(contentLabels[kind]) + (this.settings ? `<p>${e(this.settings.sectionDescriptions[descriptionKey as keyof SiteSettings['sectionDescriptions']] ?? '')}</p>` : '') + (learning ? `<nav class="pf-tabs">${nav('resources','学习资源')}${nav('learning-paths','学习路线')}</nav>` : '') + filters +
      `<div class="pf-list">${result.data.map(item => kind === 'competitions' ? renderCompetitionRow(item, fmt(item.publishedAt)) : `<article class="pf-row">${item.payload.coverId ? `<img class="pf-cover-thumb" src="/api/v1/media/${enc(item.payload.coverId)}/download" alt="" loading="lazy"/>` : ''}<div><div class="pf-meta">${item.payload.pinned ? '<b>置顶</b>' : ''}${item.payload.importance === 'important' ? '<b>重要</b>' : ''}${kind === 'announcements' && api.session?.user ? `<span>${item.read ? '已读' : '未读'}</span>` : ''}<time>${e(fmt(item.publishedAt))}</time></div><h3>${nav(`${kind}/${item.id}`,item.payload.title)}</h3><p>${e(item.payload.summary)}</p></div></article>`).join('') || '<p class="pf-empty">暂无符合条件的已发布内容。</p>'}</div>` + this.pagination(result.meta);
  }
  private async core(signal: AbortSignal) {
    const { data } = await api.request<ContentDTO[]>('/pages?pageSize=100&sort=order', { signal });
    return this.heading('社团介绍 / IXD CORE') + `<p>认识 IXD，选择你的探索方向。</p>${button('directions','进入方向二级星图 →')}` + data.map(item => `<section class="pf-section"><h3>${e(item.payload.title)}</h3><p>${e(item.payload.summary)}</p><div class="pf-markdown">${item.bodyHtml}</div>${attachments(item.payload.attachmentIds)}</section>`).join('') + (!data.length ? '<p class="pf-empty">社团介绍尚未发布。</p>' : '') + (this.settings?.contact ? `<section class="pf-section"><h3>对外联系</h3><p class="pf-pre">${e(this.settings.contact)}</p></section>` : '');
  }
  private async detail(item: ContentDTO, signal: AbortSignal) {
    this.content = item; const p = item.payload, d = p.details;
    this.actionState = {};
    if (api.session?.user) {
      this.favorites = await this.ownedPages<FavoriteDTO>('/me/favorites', signal);
      if (item.kind === 'events') this.actionState.registered = (await this.ownedPages<RegistrationDTO>('/me/registrations', signal)).some(row => row.eventId === item.id && row.status !== 'CANCELLED');
      if (item.kind === 'competitions') this.actionState.intent = (await this.ownedPages<CompetitionIntentDTO>('/me/intents', signal)).some(row => row.competitionId === item.id && row.status !== 'WITHDRAWN');
      if (item.kind === 'projects') {
        const [applications, memberships] = await Promise.all([this.ownedPages<ApplicationDTO>('/me/applications', signal), this.ownedPages<ProjectMemberDTO>('/me/projects', signal)]);
        this.actionState.applied = applications.some(row => row.projectId === item.id && row.status === 'PENDING') || memberships.some(row => row.projectId === item.id && row.status === 'ACTIVE');
      }
    }
    const favoriteRecord = this.favorites.find(row => row.content.id === item.id), favorite = Boolean(favoriteRecord);
    const reminderHours = favoriteRecord?.reminderHours ?? [24];
    let extra = '';
    if (item.kind === 'competitions') extra = renderCompetitionRuler(d, { variant: 'detail' }) + `<dl class="pf-facts"><dt>官方报名状态</dt><dd>${registrationTimeline(d).status}</dd><dt>届次 / 年份</dt><dd>${e(d.edition)} ${e(d.year)}</dd><dt>主办信息</dt><dd>${e(d.organizer)}</dd><dt>参赛条件</dt><dd>${e(d.eligibility)}</dd><dt>赛道</dt><dd>${e((d.tracks as string[]).join('、'))}</dd>${[['registrationStart','官方报名开始'],['registrationEnd','官方报名截止'],['internalDeadline','学校/社团内部材料截止'],['submissionDeadline','作品提交截止']].map(([key,label]) => `<dt>${label}</dt><dd>${deadline(d[key])}</dd>`).join('')}<dt>最后核实</dt><dd>${e(fmt(d.lastVerifiedAt))}</dd></dl><div class="pf-actions">${external(d.officialUrl,'官方网站')}${external(d.registrationUrl,'前往官网正式报名')}${external(d.sourceUrl,'信息来源')}${button('intent',this.actionState.intent ? '撤回 IXD 参赛意向' : '提交 IXD 参赛意向')}</div><p class="pf-note">收藏或内部参赛意向不等于完成赛事官网报名。</p>`;
    if (item.kind === 'projects') {
      const positions = (d.positions as Position[]).filter(position => position.enabled);
      extra = `<dl class="pf-facts"><dt>负责人</dt><dd>${e(d.leaderName)}</dd><dt>阶段</dt><dd>${e(statusLabels[String(d.stage)] ?? d.stage)}</dd><dt>申请截止</dt><dd>${e(fmt(d.applicationDeadline))}</dd></dl>${external(d.showcaseUrl,'成果展示')}<section class="pf-section"><h3>招募岗位</h3>${positions.map(position => `<p><b>${e(position.title)}</b> · 名额 ${position.capacity}<br>${e(position.description)}</p>`).join('') || '<p>暂无开放岗位。</p>'}${d.recruiting && positions.length ? this.actionState.applied ? `${nav('account/applications','查看我的申请与处理结果')}` : `<form data-pf-form="apply"><label>选择岗位<select aria-label="选择岗位" name="positionId">${positions.map(position => `<option value="${e(position.id)}">${e(position.title)}</option>`).join('')}</select></label>${textarea('motivation','意向说明（至少 10 字）','','required minlength="10" maxlength="3000"')}${field('portfolioUrl','作品链接（可选）','','url','maxlength="2000"')}<button type="submit">提交申请</button></form>` : '<p>当前未开放招募。</p>'}</section>`;
    }
    if (item.kind === 'events') extra = `<dl class="pf-facts"><dt>活动状态</dt><dd>${e(statusLabels[String(d.eventStatus)] ?? d.eventStatus)}</dd><dt>开始</dt><dd>${e(fmt(d.startsAt,String(d.timeZone)))}</dd><dt>结束</dt><dd>${e(fmt(d.endsAt,String(d.timeZone)))}</dd><dt>地点</dt><dd>${e(d.location)}</dd><dt>报名窗口</dt><dd>${e(fmt(d.registrationStartsAt))} — ${e(fmt(d.registrationEndsAt))}</dd><dt>名额</dt><dd>${e(d.capacity)}</dd><dt>取消报名截止</dt><dd>${e(fmt(d.cancellationDeadline ?? d.startsAt))}</dd></dl>${external(d.onlineUrl,'线上活动地址')}<div class="pf-actions">${button('registration',this.actionState.registered ? '取消我的报名' : '报名参加', !this.actionState.registered && (!d.registrationOpen || d.eventStatus !== 'SCHEDULED') ? 'disabled' : '')}${nav('account/registrations','我的活动报名')}</div><section class="pf-section"><h3>活动回顾</h3><p class="pf-pre">${e(d.recap) || '暂无回顾。'}</p>${attachments(d.materialIds,'活动资料')}</section>`;
    if (item.kind === 'resources') extra = `<p>${e(statusLabels[String(d.difficulty)])} · ${e(statusLabels[String(d.resourceType)] ?? d.resourceType)}</p><div class="pf-actions">${external(d.externalUrl,'访问学习资源')}${external(d.sourceUrl,'来源')}</div><p>${e(d.licenseNote)}</p>`;
    if (item.kind === 'works') extra = `<p>作者：${(d.authors as Author[]).map(author => e(author.name)).join('、')}</p>${d.projectId ? nav(`projects/${d.projectId}`,'关联项目') : ''}${external(d.demoUrl,'查看演示')}<div class="pf-images">${(d.imageIds as string[]).map(id => `<img src="/api/v1/media/${enc(id)}/download" loading="lazy" alt="${e(p.title)} 作品图片"/>`).join('')}</div>${(d.awards as Award[]).map(award => `<p>${e(award.title)} ${external(award.evidenceUrl,'查看获奖依据')}</p>`).join('')}`;
    if (item.kind === 'directions') {
      let unavailable = false;
      const linked = await Promise.all([...new Set(d.relatedContentIds as string[])].map(async id => {
        try { return (await api.request<ContentDTO>(`/contents/${enc(id)}`, { signal })).data; }
        catch (error) { if (signal.aborted) throw error; if (!(error instanceof ApiError && error.status === 404)) unavailable = true; return null; }
      }));
      extra = `<p>${e((d.keywords as string[]).join(' · '))}</p><h3>学习路线</h3><p class="pf-pre">${e(d.learningRoute)}</p><nav class="pf-tabs">${nav(`resources?direction=${d.key}`,'方向学习资源')}${nav(`projects?direction=${d.key}`,'关联项目')}${nav(`competitions?direction=${d.key}`,'方向赛事')}</nav><section class="pf-section"><h3>方向推荐内容</h3>${linked.filter((item): item is ContentDTO => Boolean(item)).map(item => `<article class="pf-row"><div><small>${e(contentLabels[item.kind])}</small><h3>${nav(contentRoute(item),item.payload.title)}</h3><p>${e(item.payload.summary)}</p></div></article>`).join('') || '<p class="pf-note">暂无可阅读的推荐内容。</p>'}${unavailable ? '<p class="pf-note">部分推荐内容暂时无法读取，请稍后重试。</p>' : ''}</section>`;
    }
    if (item.kind === 'learning-paths') extra = `<p>${e(statusLabels[String(d.difficulty)])}</p><ol class="pf-path">${[...(d.steps as Step[])].sort((a,b) => a.sortOrder - b.sortOrder).map(step => `<li><h3>${e(step.title)}</h3><p class="pf-pre">${e(step.body)}</p>${(step.resourceIds as string[]).map(id => nav(`resources/${id}`,'阅读关联资源')).join(' ')}</li>`).join('')}</ol>`;
    if (item.kind === 'announcements' && api.session?.user && !item.read && !this.read.has(`${item.id}:${item.attentionRevision}`)) {
      try { await api.request(`/me/announcements/${item.id}/read`, { method: 'PUT', body: {}, signal }); this.read.add(`${item.id}:${item.attentionRevision}`); }
      catch (error) { if (signal.aborted) throw error; extra += `<p class="pf-note">正文已载入，已读状态暂未保存：${e(errorMessage(error))}</p>`; }
    }
    return this.heading(p.title, contentLabels[item.kind]) + `<nav class="pf-actions">${nav(item.kind === 'directions' ? 'directions' : item.kind,'← 返回列表')}${button('copy','复制内容链接')}${button('favorite',favorite ? '取消收藏' : '收藏',`data-favorite="${favorite}"`)}</nav><div class="pf-meta">${p.pinned ? '<b>置顶</b>' : ''}${p.importance === 'important' ? '<b>重要</b>' : ''}<time>${e(fmt(item.publishedAt))}</time><span>${p.visibility === 'MEMBERS' ? '成员可见' : p.visibility === 'AUTHENTICATED' ? '登录可见' : '公开内容'}</span></div><p class="pf-summary">${e(p.summary)}</p>${p.coverId ? `<img class="pf-cover" src="/api/v1/media/${enc(p.coverId)}/download" alt="${e(p.title)}"/>` : ''}<div class="pf-markdown">${item.bodyHtml}</div>${extra}${attachments(p.attachmentIds)}${item.kind === 'competitions' ? `<fieldset class="pf-reminders"><legend>收藏后的站内截止提醒</legend>${[24,72,168].map(hours => `<label><input type="checkbox" name="reminderHours" value="${hours}" ${reminderHours.includes(hours) ? 'checked' : ''}/>提前 ${hours / 24} 天</label>`).join('')}${button('reminders','保存收藏提醒')}</fieldset><p class="pf-note">提醒保存在站内；未配置手机、微信或浏览器推送。</p>` : ''}`;
  }

  private async account(tab: string, id: string | undefined, query: URLSearchParams, signal: AbortSignal): Promise<string> {
    const user = api.session?.user;
    if (!user) return this.heading('个人中心') + '<p class="pf-empty">登录后可管理收藏、申请、报名与投稿。</p>' + button('login','前往登录');
    const tabs = ['profile','favorites','applications','projects','registrations','intents','works','notifications','security'];
    const header = this.heading('个人中心', `IXD / ${user.displayName}`) + `<nav class="pf-tabs">${tabs.map(name => nav(`account/${name}`,labels[name])).join('')}</nav>${!user.emailVerified ? '<p class="pf-note">邮箱尚未验证。收藏、报名、申请等操作需要验证邮箱。' + button('resend','重发验证邮件') + '</p>' : ''}`;
    if (tab === 'profile') return header + `<form data-pf-form="profile">${field('displayName','显示名称',user.displayName,'text','required maxlength="80"')}${field('grade','年级（可选）',user.grade,'text','maxlength="40"')}${field('major','专业（可选）',user.major,'text','maxlength="100"')}<fieldset><legend>感兴趣方向（不影响管理权限）</legend>${directionKeys.map(key => `<label class="pf-checkbox"><input type="checkbox" name="directionIds" value="${key}" ${user.directionIds.includes(key) ? 'checked' : ''}/> ${directions[key]}</label>`).join('')}</fieldset><p>用户名：${e(user.username)}<br>邮箱：${e(user.email)}<br>成员身份：${user.memberStatus === 'MEMBER' ? '社团成员' : '普通注册用户'}</p><button type="submit">保存资料</button></form>`;
    if (tab === 'security') return header + `<form data-pf-form="password">${field('currentPassword','当前密码','','password','required maxlength="128" autocomplete="current-password"')}${field('password','新密码（至少 12 位）','','password','required minlength="12" maxlength="128" autocomplete="new-password"')}<button type="submit">修改密码</button></form><section class="pf-section"><h3>退出此设备</h3><p>退出将撤销当前会话并清理本页用户数据。</p>${button('logout','退出账户')}</section>`;
    const params = new URLSearchParams({ page: query.get('page') ?? '1', pageSize: '12' });
    let rows = '', meta: PageMeta | undefined;
    if (tab === 'favorites') {
      const response = await api.request<FavoriteDTO[]>(`/me/favorites?${params}`, { signal }); meta = response.meta;
      rows = response.data.map(row => `<article class="pf-row"><div><h3>${nav(contentRoute(row.content),row.content.payload.title)}</h3><p>${e(row.content.payload.summary)}</p>${button('remove-favorite','取消收藏',`data-id="${row.content.id}"`)}</div></article>`).join('');
    } else if (tab === 'applications') {
      const response = await api.request<ApplicationDTO[]>(`/me/applications?${params}`, { signal }); meta = response.meta;
      rows = response.data.map(row => `<article class="pf-row"><div><h3>${nav(`projects/${row.projectId}`,row.projectTitle)}</h3><p>${e(row.positionTitle)} · <b>${statusLabels[row.status]}</b></p><p>${e(row.motivation)}</p><p>处理说明：${e(row.decisionReason) || '暂无'}</p>${row.status === 'PENDING' ? button('withdraw','撤回申请',`data-id="${row.id}" data-revision="${row.revision}"`) : row.status === 'REJECTED' || row.status === 'WITHDRAWN' ? nav(`projects/${row.projectId}`,'查看岗位并重新申请') : ''}</div></article>`).join('');
    } else if (tab === 'projects') {
      const response = await api.request<ProjectMemberDTO[]>(`/me/projects?${params}`, { signal }); meta = response.meta;
      rows = response.data.map(row => `<article class="pf-row"><div><h3>${nav(`projects/${row.projectId}`,row.projectTitle)}</h3><p>${e(row.positionTitle)} · ${statusLabels[row.status]}</p><small>加入时间 ${e(fmt(row.joinedAt))}</small></div></article>`).join('');
    } else if (tab === 'registrations') {
      const response = await api.request<RegistrationDTO[]>(`/me/registrations?${params}`, { signal }); meta = response.meta;
      rows = response.data.map(row => `<article class="pf-row"><div><h3>${nav(`events/${row.eventId}`,row.eventTitle)}</h3><p>${statusLabels[row.status]} · ${e(fmt(row.startsAt))}</p><p>${e(row.location)}</p>${row.status === 'REGISTERED' ? button('cancel-registration','取消报名',`data-id="${row.eventId}"`) : ''}</div></article>`).join('');
    } else if (tab === 'intents') {
      const response = await api.request<CompetitionIntentDTO[]>(`/me/intents?${params}`, { signal }); meta = response.meta;
      rows = '<p class="pf-note">这些是 IXD 内部参赛意向，不代表完成官网正式报名。</p>' + response.data.map(row => `<article class="pf-row"><div><h3>${nav(`competitions/${row.competitionId}`,row.competitionTitle)}</h3><p>${row.status === 'INTERESTED' ? '已登记意向' : '已撤回'}</p>${row.status === 'INTERESTED' ? button('withdraw-intent','撤回意向',`data-id="${row.competitionId}"`) : ''}</div></article>`).join('');
    } else if (tab === 'notifications') {
      const response = await api.request<NotificationDTO[]>(`/notifications?${params}`, { signal }); meta = response.meta;
      rows = response.data.map(row => `<article class="pf-row"><div><div class="pf-meta">${row.readAt ? '已读' : '<b>未读</b>'} · ${e(fmt(row.createdAt))}</div><h3>${e(row.title)}</h3><p>${e(row.body)}</p>${!row.readAt ? button('read-notification','标为已读',`data-id="${row.id}"`) : ''}</div></article>`).join('');
    } else if (tab === 'works') {
      const response = id ? { data: await this.ownedPages<AdminContentDTO>('/me/works', signal), meta: undefined } : await api.request<AdminContentDTO[]>(`/me/works?${params}`, { signal }); meta = response.meta; this.ownWorks = response.data;
      if (id) {
        const work = id === 'new' ? undefined : response.data.find(item => item.id === id);
        if (id !== 'new' && !work) return header + '<p class="pf-error">找不到此作品，或你无权编辑。</p>';
        if (work && !['DRAFT','RETURNED'].includes(work.state)) return header + `<p class="pf-note">当前状态：${e(statusLabels[work.state])}，暂不能编辑。</p>`;
        return header + this.workForm(work,user);
      }
      rows = nav('account/works/new','＋ 创建作品草稿') + response.data.map(row => `<article class="pf-row"><div><h3>${e(row.payload.title)}</h3><p><b>${statusLabels[row.state]}</b> · ${e(fmt(row.updatedAt))}</p>${row.reviewReason ? `<p>退回原因：${e(row.reviewReason)}</p>` : ''}<div class="pf-actions">${['DRAFT','RETURNED'].includes(row.state) ? nav(`account/works/${row.id}`,'继续编辑') + button('submit-work','提交审核',`data-id="${row.id}" data-revision="${row.revision}"`) : ''}${row.state === 'PUBLISHED' ? nav(`works/${row.id}`,'查看已发布作品') : ''}</div></div></article>`).join('');
    } else return header + '<p class="pf-error">没有这个个人中心页面。</p>';
    return header + `<div class="pf-list">${rows || '<p class="pf-empty">暂无记录。</p>'}</div>` + this.pagination(meta);
  }
  private workForm(work: AdminContentDTO | undefined, user: SafeUser) {
    this.draft = work ? structuredClone(work.payload) : blankPayload('works');
    if (!work) this.draft.details.authors = [{userId:user.id,name:user.displayName}];
    this.draftId = work?.id; this.draftRevision = work?.revision;
    const p = this.draft;
    return `<h3>${work ? '编辑作品草稿' : '新的作品草稿'}</h3><p class="pf-note">保存不会直接公开。提交审核后，编辑者审核发布才对外可见。</p><form data-pf-form="work">${field('title','作品标题',p.title,'text','required maxlength="200"')}${textarea('summary','简介',p.summary,'maxlength="2000"')}${textarea('body','正文（Markdown）',p.body,'maxlength="100000"')}<fieldset><legend>方向</legend>${directionKeys.map(key => `<label class="pf-checkbox"><input type="checkbox" name="directionIds" value="${key}" ${p.directionIds.includes(key) ? 'checked' : ''}/> ${directions[key]}</label>`).join('')}</fieldset>${field('demoUrl','演示链接（可选）',String(p.details.demoUrl ?? ''),'url','maxlength="2000"')}${field('projectId','关联项目 ID（可选）',String(p.details.projectId ?? ''),'text','pattern="[a-fA-F0-9-]{36}"')}<label>上传作品图片或附件<input name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain"/></label><label>附件用途<select aria-label="附件用途" name="uploadUse"><option value="image">作品图片</option><option value="cover">封面</option><option value="attachment">附件</option></select></label>${button('upload','上传选中文件')}<div data-pf-upload-list>${this.uploadList()}</div><button type="submit">保存作品草稿</button></form>`;
  }
  private uploadList() {
    if (!this.draft) return '';
    const all = [{id:this.draft.coverId,label:'封面'},...(this.draft.details.imageIds as string[]).map(id => ({id,label:'作品图片'})),...this.draft.attachmentIds.map(id => ({id,label:'附件'}))].filter(item => item.id);
    return all.map(item => `<p>${e(item.label)} · ${e(item.id)} ${button('remove-upload','移除引用',`data-id="${e(item.id)}"`)}</p>`).join('') || '<p>尚未上传文件。</p>';
  }
  private feedback(message: string, error = false) {
    const feedback = this.map.detailHost.querySelector<HTMLElement>('.pf-feedback');
    if (feedback) { feedback.textContent = message; feedback.classList.toggle('pf-error',error); }
  }
  private requireUser() {
    if (api.session?.user) return true;
    this.feedback('此操作需要登录。请通过个人中心或下方按钮进入登录。',true);
    if (!this.map.detailHost.querySelector('[data-pf="login"]')) this.map.detailHost.querySelector('.pf-feedback')?.insertAdjacentHTML('afterend',button('login','前往登录'));
    return false;
  }
  private click = (event: MouseEvent) => {
    const target = event.target as Element, link = target.closest<HTMLAnchorElement>('a[data-pf-link]');
    if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); void this.navigate(link.hash.replace(/^#\//,'')); return; }
    const control = target.closest<HTMLButtonElement>('button[data-pf]'); if (!control || control.disabled) return;
    event.stopPropagation(); void this.action(control);
  };
  private async action(control: HTMLButtonElement) {
    const action = control.dataset.pf!, id = control.dataset.id;
    if (action === 'login') { this.options.login(); return; }
    if (action === 'refresh') { await this.render(false); return; }
    if (action === 'directions') { control.disabled = true; try { await this.navigate('directions'); } finally { control.disabled = false; } return; }
    if (action === 'page') { const {parts,query} = this.route(); query.set('page',control.dataset.page!); await this.navigate(`${parts.join('/')}?${query}`); return; }
    if (action === 'copy') { try { await navigator.clipboard.writeText(location.href); this.feedback('链接已复制。'); } catch { this.feedback('复制未获浏览器许可，可直接复制地址栏链接。',true); } return; }
    if (!this.requireUser()) return;
    if ((['logout','cancel-registration','withdraw','withdraw-intent'].includes(action) || action === 'registration' && this.actionState.registered || action === 'intent' && this.actionState.intent) && !confirm(action === 'logout' ? '确定退出当前账户？' : '确定执行此撤回 / 取消操作？')) return;
    control.disabled = true; this.feedback('正在保存…');
    try {
      if (action === 'logout') { await api.logout(); this.draft = undefined; this.dirty = false; this.options.login(); return; }
      if (action === 'resend') { await api.request('/auth/resend-verification',{method:'POST',body:{email:api.session!.user!.email}}); this.feedback('验证邮件已发送，请查看收件箱。'); return; }
      if (action === 'favorite' || action === 'reminders') {
        const hours = [...this.map.detailHost.querySelectorAll<HTMLInputElement>('input[name="reminderHours"]:checked')].map(input => Number(input.value));
        await api.request(`/me/favorites/${this.content!.id}`,{method:action === 'favorite' && control.dataset.favorite === 'true' ? 'DELETE' : 'PUT',body:action === 'favorite' && control.dataset.favorite === 'true' ? {} : {reminderHours:this.content!.kind === 'competitions' ? hours : []}});
      } else if (action === 'remove-favorite') await api.request(`/me/favorites/${id}`,{method:'DELETE',body:{}});
      else if (action === 'intent') await api.request(`/competitions/${this.content!.id}/intent`,{method:this.actionState.intent ? 'DELETE' : 'PUT',body:{}});
      else if (action === 'withdraw-intent') await api.request(`/competitions/${id}/intent`,{method:'DELETE',body:{}});
      else if (action === 'registration') await api.request(`/events/${this.content!.id}/registrations`,{method:this.actionState.registered ? 'DELETE' : 'POST',body:{}});
      else if (action === 'cancel-registration') await api.request(`/events/${id}/registrations`,{method:'DELETE',body:{}});
      else if (action === 'withdraw') await api.request(`/me/applications/${id}/withdraw`,{method:'POST',body:{expectedRevision:Number(control.dataset.revision)}});
      else if (action === 'read-notification') await api.request(`/notifications/${id}/read`,{method:'PUT',body:{}});
      else if (action === 'submit-work') { await api.request(`/me/works/${id}/submit`,{method:'POST',body:{expectedRevision:Number(control.dataset.revision)}}); }
      else if (action === 'upload') {
        const input = this.map.detailHost.querySelector<HTMLInputElement>('input[type="file"]')!, file = input.files?.[0];
        if (!file) throw new Error('请先选择文件。');
        const form = new FormData(); form.append('accessLevel','PUBLIC'); form.append('file',file);
        const media = (await api.request<MediaDTO>('/media',{method:'POST',body:form})).data;
        const use = this.map.detailHost.querySelector<HTMLSelectElement>('[name="uploadUse"]')!.value;
        if (use === 'cover') this.draft!.coverId = media.id;
        else if (use === 'image') (this.draft!.details.imageIds as string[]).push(media.id);
        else this.draft!.attachmentIds.push(media.id);
        this.dirty = true; input.value = ''; this.map.detailHost.querySelector('[data-pf-upload-list]')!.innerHTML = this.uploadList(); this.feedback('文件已上传，保存草稿后建立引用。'); return;
      } else if (action === 'remove-upload') {
        if (this.draft!.coverId === id) this.draft!.coverId = null;
        this.draft!.attachmentIds = this.draft!.attachmentIds.filter(value => value !== id);
        this.draft!.details.imageIds = (this.draft!.details.imageIds as string[]).filter(value => value !== id);
        this.dirty = true; this.map.detailHost.querySelector('[data-pf-upload-list]')!.innerHTML = this.uploadList(); this.feedback('已移除草稿中的引用，请保存。'); return;
      }
      await this.render(true); this.feedback('操作已保存。');
    } catch (error) { this.feedback(errorMessage(error),true); }
    finally { control.disabled = false; }
  }
  private submit = (event: Event) => {
    const form = event.target as HTMLFormElement;
    if (!form.matches('[data-pf-form]')) return;
    event.preventDefault(); event.stopPropagation(); void this.submitForm(form);
  };
  private async submitForm(form: HTMLFormElement) {
    if (!form.reportValidity()) return;
    const mode = form.dataset.pfForm!, data = new FormData(form), value = (key: string) => String(data.get(key) ?? '');
    if (mode === 'filter') {
      const params = new URLSearchParams(); for (const [key,value] of data) if (String(value)) params.set(key,String(value));
      const kind = this.route().parts[0] ?? 'announcements'; await this.navigate(`${kind}?${params}`); return;
    }
    if (!this.requireUser()) return;
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!; submit.disabled = true; this.feedback('正在保存…');
    try {
      if (mode === 'profile') {
        const {data:user} = await api.request<SafeUser>('/me',{method:'PATCH',body:{expectedRevision:api.session!.user!.profileVersion,displayName:value('displayName'),grade:value('grade'),major:value('major'),directionIds:data.getAll('directionIds')}});
        this.dirty = false; api.adopt({...api.session!,user});
      } else if (mode === 'password') {
        await api.request('/auth/change-password',{method:'POST',body:{currentPassword:value('currentPassword'),password:value('password')}}); form.reset(); await api.refreshSession();
      } else if (mode === 'apply') {
        await api.request(`/projects/${this.content!.id}/applications`,{method:'POST',body:{positionId:value('positionId'),motivation:value('motivation'),portfolioUrl:value('portfolioUrl')}});
        await this.navigate('account/applications'); this.feedback('申请已提交，可在这里查看处理结果。'); return;
      } else if (mode === 'work') {
        const payload: ContentPayload = {...this.draft!,title:value('title'),summary:value('summary'),body:value('body'),directionIds:data.getAll('directionIds') as ContentPayload['directionIds'],details:{...this.draft!.details,demoUrl:value('demoUrl'),projectId:value('projectId') || null}};
        await api.request<AdminContentDTO>(this.draftId ? `/me/works/${this.draftId}` : '/me/works',{method:this.draftId ? 'PATCH' : 'POST',body:this.draftId ? {expectedRevision:this.draftRevision,payload} : {payload}});
        this.dirty = false; await this.navigate('account/works'); this.feedback('草稿已保存。确认后可提交审核。'); return;
      }
      this.feedback('修改已保存。');
    } catch (error) { this.feedback(errorMessage(error),true); }
    finally { submit.disabled = false; }
  }
  dispose() {
    this.suspend(); clearInterval(this.poll); this.removeSession();
    this.map.element.removeEventListener('click',this.click); this.map.element.removeEventListener('submit',this.submit); this.map.element.removeEventListener('input',this.input);
    window.removeEventListener('hashchange',this.routeChanged); window.removeEventListener('popstate',this.routeChanged); window.removeEventListener('focus',this.refresh); window.removeEventListener('beforeunload',this.beforeUnload);
  }
}
