import { z } from 'zod';

/** One contract for the API, the native front end and the separate admin app. */
export const directionKeys = ['ai', 'robotics', 'interaction', 'visual', 'xr', 'hardware'] as const;
export const contentKinds = ['announcements', 'competitions', 'projects', 'events', 'resources', 'works', 'directions', 'learning-paths', 'pages'] as const;
export const businessKinds = contentKinds.slice(0, 6) as readonly ContentKind[];
export type DirectionKey = typeof directionKeys[number];
export type ContentKind = typeof contentKinds[number];
export const contentLabels: Record<ContentKind, string> = {
  announcements: '公告中心', competitions: '赛事中心', projects: '项目广场', events: '活动与沙龙',
  resources: '学习资源', works: '作品与成果', directions: '六方向介绍', 'learning-paths': '学习路线', pages: '社团介绍与加入说明',
};
export const roles = ['USER', 'EDITOR', 'ADMIN'] as const;
export const contentStates = ['DRAFT', 'PUBLISHED', 'WITHDRAWN', 'ARCHIVED', 'REVIEW', 'RETURNED'] as const;
export type Role = typeof roles[number];
export type ContentState = typeof contentStates[number];
export type GrantAction = 'create' | 'read' | 'update' | 'publish' | 'archive' | 'delete' | 'manage';
export interface EditorGrant { id: string; contentKind: ContentKind; directionId: DirectionKey | null; contentId: string | null; actions: GrantAction[] }

export const idSchema = z.uuid();
export const directionSchema = z.enum(directionKeys);
export const isoTimeSchema = z.iso.datetime({ offset: true });
const short = z.string().trim().max(200);
const text = z.string().max(20_000);
export const safeUrlSchema = z.union([z.literal(''), z.url().max(2000).refine(value => /^https?:\/\//i.test(value), '仅允许 http/https 链接')]);
const ids = z.array(idSchema).max(50).default([]);
const words = z.array(z.string().trim().min(1).max(80)).max(30).default([]);
const timeZone = z.string().max(80).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, '无效时区').default('Asia/Shanghai');

export const dateValueSchema = z.strictObject({
  precision: z.enum(['unknown', 'date', 'datetime']),
  date: z.iso.date().nullable().default(null),
  at: isoTimeSchema.nullable().default(null),
  timeZone,
}).superRefine((value, ctx) => {
  if (value.precision === 'date' && (!value.date || value.at)) ctx.addIssue({ code: 'custom', message: '日期精度须填写日期，不得伪造具体时刻' });
  if (value.precision === 'datetime' && (!value.at || value.date)) ctx.addIssue({ code: 'custom', message: '时刻精度须填写带时区时间' });
  if (value.precision === 'unknown' && (value.date || value.at)) ctx.addIssue({ code: 'custom', message: '未知时间必须为空' });
});
export type DateValue = z.infer<typeof dateValueSchema>;
export const unknownDate = (): DateValue => ({ precision: 'unknown', date: null, at: null, timeZone: 'Asia/Shanghai' });
const deadline = () => dateValueSchema.default(unknownDate);
const nullableTime = () => isoTimeSchema.nullable().default(null);

export const positionSchema = z.strictObject({
  id: idSchema, title: z.string().trim().min(1).max(120), description: z.string().max(3000).default(''),
  capacity: z.number().int().min(1).max(10000), enabled: z.boolean().default(true), sortOrder: z.number().int().min(0).max(10000).default(0),
});
export const detailSchemas = {
  announcements: z.strictObject({}),
  competitions: z.strictObject({
    edition: short.default(''), year: z.number().int().min(2000).max(2200).nullable().default(null), organizer: short.default(''),
    eligibility: z.string().max(6000).default(''), tracks: words,
    registrationStart: deadline(), registrationEnd: deadline(), internalDeadline: deadline(), submissionDeadline: deadline(),
    officialUrl: safeUrlSchema.default(''), registrationUrl: safeUrlSchema.default(''), sourceUrl: safeUrlSchema.default(''), lastVerifiedAt: nullableTime(),
  }),
  projects: z.strictObject({
    leaderName: short.default(''), stage: z.enum(['IDEA', 'BUILDING', 'RECRUITING', 'COMPLETED']).default('IDEA'),
    recruiting: z.boolean().default(false), applicationDeadline: nullableTime(), showcaseUrl: safeUrlSchema.default(''),
    positions: z.array(positionSchema).max(30).default([]),
  }),
  events: z.strictObject({
    startsAt: nullableTime(), endsAt: nullableTime(), timeZone, location: short.default(''), onlineUrl: safeUrlSchema.default(''),
    registrationStartsAt: nullableTime(), registrationEndsAt: nullableTime(), cancellationDeadline: nullableTime(),
    registrationOpen: z.boolean().default(false), capacity: z.number().int().min(1).max(10000).default(30),
    eventStatus: z.enum(['SCHEDULED', 'CANCELLED', 'COMPLETED']).default('SCHEDULED'), recap: text.default(''), materialIds: ids,
  }),
  resources: z.strictObject({
    difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('BEGINNER'),
    resourceType: z.enum(['ARTICLE', 'VIDEO', 'TOOL', 'FILE', 'COURSE']).default('ARTICLE'),
    externalUrl: safeUrlSchema.default(''), sourceUrl: safeUrlSchema.default(''), licenseNote: z.string().max(1000).default(''),
  }),
  works: z.strictObject({
    authors: z.array(z.strictObject({ userId: idSchema.nullable().default(null), name: z.string().trim().min(1).max(100) })).max(30).default([]),
    projectId: idSchema.nullable().default(null), imageIds: ids, demoUrl: safeUrlSchema.default(''),
    awards: z.array(z.strictObject({ title: z.string().min(1).max(200), evidenceUrl: safeUrlSchema.refine(v => v.length > 0, '获奖信息需要依据链接') })).max(20).default([]),
  }),
  directions: z.strictObject({ key: directionSchema, keywords: words, learningRoute: text.default(''), relatedContentIds: ids }),
  'learning-paths': z.strictObject({
    difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('BEGINNER'),
    steps: z.array(z.strictObject({ id: idSchema, title: z.string().trim().min(1).max(200), body: text.default(''), resourceIds: ids, sortOrder: z.number().int().min(0).max(10000).default(0) })).max(100).default([]),
  }),
  pages: z.strictObject({ pageKey: z.enum(['about', 'join']) }),
} satisfies Record<ContentKind, z.ZodType>;

export const commonPayloadSchema = z.strictObject({
  title: z.string().trim().min(1, '请输入标题').max(200), summary: z.string().max(2000).default(''), body: z.string().max(100_000).default(''),
  visibility: z.enum(['PUBLIC', 'AUTHENTICATED', 'MEMBERS']).default('PUBLIC'), directionIds: z.array(directionSchema).max(6).default([]),
  attachmentIds: ids, coverId: idSchema.nullable().default(null), pinned: z.boolean().default(false),
  importance: z.enum(['normal', 'important']).default('normal'), sortOrder: z.number().int().min(-10000).max(10000).default(0), tags: words,
});
export type ContentPayload = z.infer<typeof commonPayloadSchema> & { details: Record<string, unknown> };
export function payloadSchema(kind: ContentKind) { return commonPayloadSchema.extend({ details: detailSchemas[kind] }); }
export function parsePayload(kind: ContentKind, input: unknown): ContentPayload {
  const parsed = payloadSchema(kind).parse(input) as ContentPayload;
  if (new Set(parsed.directionIds).size !== parsed.directionIds.length) throw new z.ZodError([{ code: 'custom', path: ['directionIds'], message: '方向不能重复' }]);
  return parsed;
}
export function blankPayload(kind: ContentKind): ContentPayload {
  const details = kind === 'directions' ? { key: 'ai' } : kind === 'pages' ? { pageKey: 'about' } : {};
  return { ...commonPayloadSchema.parse({ title: '未命名内容' }), title: '', details: detailSchemas[kind].parse(details) as Record<string, unknown> };
}

export const createContentSchema = z.strictObject({
  kind: z.enum(contentKinds), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/).optional(), payload: z.unknown(),
});
export const editContentSchema = z.strictObject({ expectedRevision: z.number().int().min(1), payload: z.unknown() });
export const publishSchema = z.strictObject({
  expectedRevision: z.number().int().min(1), publishAt: nullableTime(), expiresAt: nullableTime(), notifyImportantUpdate: z.boolean().default(false),
});
export const revisionSchema = z.strictObject({ expectedRevision: z.number().int().min(1) });
export const listQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(200).default(''), direction: directionSchema.optional(), state: z.enum(contentStates).optional(),
  year: z.coerce.number().int().min(2000).max(2200).optional(), difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  phase: z.enum(['upcoming', 'open', 'closed', 'unknown']).optional(),
  sort: z.enum(['newest', 'oldest', 'title', 'deadline', 'order']).default('newest'),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
export interface PageMeta { page: number; pageSize: number; total: number }
export interface ApiResult<T> { data: T; meta?: PageMeta }
export interface ApiErrorBody { error: { code: string; message: string; fieldErrors?: Record<string, string[]>; requestId?: string } }

export const userSchema = z.strictObject({
  id: idSchema, username: z.string(), email: z.email(), displayName: z.string(), role: z.enum(roles), status: z.enum(['ACTIVE', 'DISABLED']),
  memberStatus: z.enum(['NONE', 'MEMBER']), emailVerified: z.boolean(), grade: z.string(), major: z.string(), directionIds: z.array(directionSchema),
  profileVersion: z.number().int(), createdAt: z.string(),
});
export type SafeUser = z.infer<typeof userSchema>;
export interface SessionDTO { user: SafeUser | null; csrfToken: string; grants: EditorGrant[]; expiresAt: string | null }
export interface ContentDTO {
  id: string; kind: ContentKind; slug: string; revision: number; state: ContentState; attentionRevision: number;
  payload: ContentPayload; bodyHtml: string; createdAt: string; updatedAt: string; publishedAt: string | null;
  author: { id: string; displayName: string }; read?: boolean;
}
export interface AdminContentDTO extends ContentDTO {
  ownerId: string; publishedPayload: ContentPayload | null; scheduledAt: string | null; expiresAt: string | null; reviewReason: string | null;
}
export interface MediaDTO { id: string; originalName: string; mimeType: string; byteSize: number; accessLevel: 'PUBLIC' | 'PRIVATE'; url: string; referenceCount: number; createdAt: string }
export interface FavoriteDTO { content: ContentDTO; reminderHours: number[]; createdAt: string }
export interface NotificationDTO { id: string; type: string; title: string; body: string; contentId: string | null; readAt: string | null; createdAt: string }
export interface ApplicationDTO {
  id: string; projectId: string; projectTitle: string; positionId: string; positionTitle: string;
  motivation: string; portfolioUrl: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  decisionReason: string; revision: number; createdAt: string; updatedAt: string;
  user?: { id: string; displayName: string; email: string };
}
export interface ProjectMemberDTO {
  id: string; projectId: string; projectTitle: string; positionId: string; positionTitle: string; userId: string;
  status: 'ACTIVE' | 'LEFT' | 'REMOVED'; joinedAt: string; leftAt: string | null;
  user?: { id: string; displayName: string; email: string };
}
export interface RegistrationDTO {
  id: string; eventId: string; eventTitle: string; status: 'REGISTERED' | 'CANCELLED'; startsAt: string | null;
  location: string; createdAt: string; updatedAt: string; user?: { id: string; displayName: string; email: string };
}
export interface CompetitionIntentDTO { id: string; competitionId: string; competitionTitle: string; note: string; status: 'INTERESTED' | 'WITHDRAWN'; createdAt: string; updatedAt: string }
export const usernameSchema = z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_-]+$/, '用户名只允许字母、数字、下划线及短横线');
export const passwordSchema = z.string().min(12, '密码至少 12 位').max(128);
export const registerSchema = z.strictObject({ username: usernameSchema, email: z.email().max(254), displayName: z.string().trim().min(1).max(80), password: passwordSchema });
export const loginSchema = z.strictObject({ account: z.string().trim().min(1).max(254), password: z.string().min(1).max(128) });
export const profileSchema = z.strictObject({
  expectedRevision: z.number().int().min(1), displayName: z.string().trim().min(1).max(80), grade: z.string().trim().max(40), major: z.string().trim().max(100), directionIds: z.array(directionSchema).max(6),
});
export const tokenSchema = z.strictObject({ token: z.string().min(32).max(256) });
export const resetSchema = tokenSchema.extend({ password: passwordSchema });
export const changePasswordSchema = z.strictObject({ currentPassword: z.string().min(1).max(128), password: passwordSchema });
export const emailSchema = z.strictObject({ email: z.email().max(254) });
export const applicationSchema = z.strictObject({ positionId: idSchema, motivation: z.string().trim().min(10).max(3000), portfolioUrl: safeUrlSchema.default('') });
export const decisionSchema = z.strictObject({ expectedRevision: z.number().int().min(1), decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().max(2000).default('') });
export const reminderSchema = z.strictObject({ reminderHours: z.array(z.union([z.literal(24), z.literal(72), z.literal(168)])).max(3).default([24]) });

export const visualPresets = ['neural-cluster','binary-mechanism','echo-nebula','asymmetric-arms','spatial-gate','lattice-satellites','ixd-core','protostar-shell','ascent-comet','exchange-stars','prism-shards','open-beacon'] as const;
export const routeKeys = ['announcements','competitions','projects','events','learning','works','core','account'] as const;
export type RouteKey = typeof routeKeys[number];
export const nodeSettingSchema = z.strictObject({
  routeKey: z.enum(routeKeys), title: z.string().trim().min(1).max(40), subtitle: z.string().max(100), enabled: z.boolean(), visualPreset: z.enum(visualPresets),
});
export const siteSettingsSchema = z.strictObject({
  siteName: z.string().trim().min(1).max(80), tagline: z.string().max(200), contact: z.string().max(2000),
  sectionDescriptions: z.record(z.enum(routeKeys), z.string().max(500)), nodes: z.array(nodeSettingSchema).length(8),
}).superRefine((value, ctx) => {
  if (new Set(value.nodes.map(n => n.routeKey)).size !== 8) ctx.addIssue({ code: 'custom', path: ['nodes'], message: '每个已实现栏目只能配置一次' });
  if (!value.nodes.find(n => n.routeKey === 'core')?.enabled) ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'IXD CORE 是星门锚点，须保持启用' });
  if (!value.nodes.find(n => n.routeKey === 'account')?.enabled) ctx.addIssue({ code: 'custom', path: ['nodes'], message: '个人中心须保持可访问' });
});
export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export interface FieldDefinition { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'url' | 'datetime' | 'deadline' | 'boolean' | 'select' | 'strings' | 'positions' | 'steps' | 'authors' | 'awards' | 'media' | 'content'; options?: readonly string[] }
/** Describes real form controls, not an arbitrary JSON/HTML page builder. */
export const detailFields: Record<ContentKind, FieldDefinition[]> = {
  announcements: [],
  competitions: [
    {key:'edition',label:'届次',type:'text'}, {key:'year',label:'年份',type:'number'}, {key:'organizer',label:'主办信息',type:'text'}, {key:'eligibility',label:'参赛条件',type:'textarea'}, {key:'tracks',label:'赛道',type:'strings'},
    {key:'registrationStart',label:'官方报名开始',type:'deadline'}, {key:'registrationEnd',label:'官方报名截止',type:'deadline'}, {key:'internalDeadline',label:'学校/社团内部材料截止',type:'deadline'}, {key:'submissionDeadline',label:'作品提交截止',type:'deadline'},
    {key:'officialUrl',label:'官方网站',type:'url'}, {key:'registrationUrl',label:'官方报名链接',type:'url'}, {key:'sourceUrl',label:'信息来源',type:'url'}, {key:'lastVerifiedAt',label:'最后核实时间',type:'datetime'},
  ],
  projects: [
    {key:'leaderName',label:'负责人展示名称（不授予权限）',type:'text'}, {key:'stage',label:'阶段',type:'select',options:['IDEA','BUILDING','RECRUITING','COMPLETED']}, {key:'recruiting',label:'开放招募',type:'boolean'},
    {key:'applicationDeadline',label:'申请截止',type:'datetime'}, {key:'showcaseUrl',label:'成果展示链接',type:'url'}, {key:'positions',label:'招募岗位与名额',type:'positions'},
  ],
  events: [
    {key:'startsAt',label:'开始时间',type:'datetime'}, {key:'endsAt',label:'结束时间',type:'datetime'}, {key:'timeZone',label:'显示时区',type:'text'}, {key:'location',label:'地点',type:'text'}, {key:'onlineUrl',label:'线上地址',type:'url'},
    {key:'registrationStartsAt',label:'报名开始',type:'datetime'}, {key:'registrationEndsAt',label:'报名截止',type:'datetime'}, {key:'cancellationDeadline',label:'允许取消报名截止（空值沿用活动开始）',type:'datetime'},
    {key:'registrationOpen',label:'开放报名',type:'boolean'}, {key:'capacity',label:'名额上限',type:'number'}, {key:'eventStatus',label:'活动状态',type:'select',options:['SCHEDULED','CANCELLED','COMPLETED']}, {key:'recap',label:'活动回顾',type:'textarea'}, {key:'materialIds',label:'活动资料',type:'media'},
  ],
  resources: [{key:'difficulty',label:'难度',type:'select',options:['BEGINNER','INTERMEDIATE','ADVANCED']},{key:'resourceType',label:'资料类型',type:'select',options:['ARTICLE','VIDEO','TOOL','FILE','COURSE']},{key:'externalUrl',label:'资源链接',type:'url'},{key:'sourceUrl',label:'来源',type:'url'},{key:'licenseNote',label:'许可说明',type:'textarea'}],
  works: [{key:'authors',label:'作者（不公开联系方式）',type:'authors'},{key:'projectId',label:'关联项目',type:'content'},{key:'imageIds',label:'作品图片',type:'media'},{key:'demoUrl',label:'演示链接',type:'url'},{key:'awards',label:'获奖及依据',type:'awards'}],
  directions: [{key:'key',label:'方向标识',type:'select',options:directionKeys},{key:'keywords',label:'关键词',type:'strings'},{key:'learningRoute',label:'学习路线介绍',type:'textarea'},{key:'relatedContentIds',label:'关联内容',type:'content'}],
  'learning-paths': [{key:'difficulty',label:'难度',type:'select',options:['BEGINNER','INTERMEDIATE','ADVANCED']},{key:'steps',label:'路线步骤与关联资料',type:'steps'}],
  pages: [{key:'pageKey',label:'页面用途',type:'select',options:['about','join']}],
};
