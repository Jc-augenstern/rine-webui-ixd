import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext, Actor } from './context.js';
import type { MediaDTO, ContentPayload, ContentKind } from '../../shared/platform.js';
import { idSchema } from '../../shared/platform.js';
import { requireActor, requireEditor, canManage } from './security.js';
import { canUseMedia, getVisibleContent, managementScopeSql } from './content.js';
import { LocalStorage } from './storage.js';
import { HttpError } from './errors.js';
import { inTransaction, type Database } from './db.js';
import { audit } from './audit.js';
import { queueJob } from './content-notifications.js';

interface MediaRow { id: string; owner_id: string; storage_key: string; original_name: string; mime_type: string; byte_size: string; access_level: 'PUBLIC' | 'PRIVATE'; created_at: Date; reference_count?: string }
const mediaDTO = (row: MediaRow): MediaDTO => ({ id: row.id, originalName: row.original_name, mimeType: row.mime_type, byteSize: Number(row.byte_size), accessLevel: row.access_level, url: `/api/v1/media/${row.id}/download`, referenceCount: Number(row.reference_count || 0), createdAt: row.created_at.toISOString() });
const mediaQuery = z.strictObject({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), q: z.string().max(200).default(''), accessLevel: z.enum(['PUBLIC', 'PRIVATE']).optional() });
const paramsId = (params: unknown) => z.strictObject({ id: idSchema }).parse(params).id;
async function getMedia(db: Database, id: string, lock = false) {
  const result = await db.query<MediaRow>(`SELECT m.*,(SELECT count(*) FROM content_version_media r WHERE r.media_id=m.id) AS reference_count FROM media m WHERE id=$1 ${lock ? 'FOR UPDATE OF m' : ''}`, [id]);
  if (!result.rows[0]) throw new HttpError(404, 'NOT_FOUND', '附件不存在或无权访问');
  return result.rows[0];
}
async function validateFile(bytes: Buffer, declared: string, filename: string) {
  if (!bytes.length) throw new HttpError(400, 'EMPTY_FILE', '不能上传空文件');
  if (/[\\/\x00-\x1f]/.test(filename) || filename.length > 200) throw new HttpError(400, 'INVALID_FILENAME', '文件名无效');
  const detected = await fileTypeFromBuffer(bytes);
  if (detected && ['image/png', 'image/jpeg', 'image/webp'].includes(detected.mime)) {
    if (declared !== detected.mime) throw new HttpError(400, 'MIME_MISMATCH', '文件声明类型与实际内容不符');
    try {
      const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: 20_000_000 });
      const meta = await decoder.metadata();
      if ((meta.pages || 1) > 1) throw new Error('Animated images are not supported');
      // Decode every pixel and re-encode, discarding embedded metadata and trailing polyglot bytes.
      const clean = await decoder.rotate().toBuffer();
      if (clean.length > 10 * 1024 * 1024) throw new Error('Re-encoded image too large');
      return { mime: detected.mime, ext: detected.ext === 'jpeg' ? 'jpg' : detected.ext, bytes: clean };
    } catch { throw new HttpError(400, 'INVALID_IMAGE', '图片损坏、超过 2000 万像素或含不支持的多帧内容'); }
  }
  if (detected?.mime === 'application/pdf' && declared === 'application/pdf') {
    // Only passive PDFs. Deny encrypted/object-stream PDFs which hide active dictionaries from inspection.
    const source = bytes.toString('latin1').replace(/#([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (!source.includes('%%EOF') || /\/(A|AA|Action|JavaScript|JS|OpenAction|URI|GoToR|GoToE|SubmitForm|ImportData|Rendition|Launch|EmbeddedFile|EmbeddedFiles|Filespec|EF|RichMedia|XFA|AcroForm|ObjStm|Encrypt|Sound|Movie|3D)\b/i.test(source)) throw new HttpError(400, 'ACTIVE_DOCUMENT', 'PDF 含交互动作、外部链接、加密或不支持的对象流，请导出为静态 PDF');
    return { mime: 'application/pdf', ext: 'pdf', bytes };
  }
  if (!detected && declared === 'text/plain' && filename.toLowerCase().endsWith('.txt')) {
    let content: string; try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new HttpError(400, 'INVALID_TEXT', '文本附件须为 UTF-8'); }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content) || /<\s*(script|html|iframe|svg|object)\b|<\?php/i.test(content)) throw new HttpError(400, 'ACTIVE_DOCUMENT', '不允许上传脚本或主动内容');
    return { mime: 'text/plain', ext: 'txt', bytes };
  }
  throw new HttpError(400, 'UNSUPPORTED_FILE', '支持 PNG、JPEG、WebP、静态 PDF 和 UTF-8 TXT，每个文件不超过 10 MB');
}

export async function registerMediaRoutes(app: FastifyInstance, ctx: AppContext) {
  const storage = new LocalStorage(ctx.config.storagePath);
  app.post('/api/v1/media', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (request, reply) => {
    const actor = requireActor(request);
    let accessLevel: 'PUBLIC' | 'PRIVATE' = 'PRIVATE';
    let upload: { bytes: Buffer; filename: string; mime: string } | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || upload) throw new HttpError(400, 'INVALID_UPLOAD', '每次仅允许上传一个 file 文件');
        const bytes = await part.toBuffer();
        if (part.file.truncated) throw new HttpError(413, 'UPLOAD_TOO_LARGE', '文件不超过 10 MB');
        upload = { bytes, filename: part.filename, mime: part.mimetype };
      } else {
        if (part.fieldname !== 'accessLevel') throw new HttpError(400, 'INVALID_UPLOAD', '不支持此上传字段');
        accessLevel = z.enum(['PUBLIC', 'PRIVATE']).parse(part.value);
      }
    }
    if (!upload) throw new HttpError(400, 'FILE_REQUIRED', '请选择文件');
    const validated = await validateFile(upload.bytes, upload.mime, upload.filename), id = randomUUID(), key = `${id}.${validated.ext}`;
    await storage.put(key, validated.bytes);
    try {
      const row = await inTransaction(ctx.db, async db => {
        const result = await db.query<MediaRow>('INSERT INTO media(id,owner_id,storage_key,original_name,mime_type,byte_size,access_level,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [id, actor.user.id, key, upload!.filename, validated.mime, validated.bytes.length, accessLevel, ctx.now()]);
        await audit(db, actor.user.id, 'UPLOAD_MEDIA', 'media', id, { mimeType: validated.mime, byteSize: validated.bytes.length, accessLevel }, request.id);
        return result.rows[0];
      });
      return reply.code(201).send({ data: mediaDTO(row) });
    } catch (error) { await storage.remove(key); throw error; }
  });
  app.get('/api/v1/media/:id/download', async (request, reply) => {
    const id = paramsId(request.params), row = await getMedia(ctx.db, id), actor = request.actor;
    let allowed = actor ? await canUseMedia(ctx.db, id, actor) : false;
    if (!allowed && row.access_level === 'PUBLIC') {
      const references = await ctx.db.query<{ content_id: string; version_id: string }>('SELECT v.content_id,r.version_id FROM content_version_media r JOIN content_versions v ON v.id=r.version_id WHERE r.media_id=$1', [id]);
      for (const ref of references.rows) {
        const content = await getVisibleContent(ctx.db, ref.content_id, actor, ctx.now());
        if (content?.version_id === ref.version_id) { allowed = true; break; }
      }
    }
    if (!allowed) throw new HttpError(404, 'NOT_FOUND', '附件不存在或无权访问');
    reply.header('Content-Security-Policy', "sandbox; default-src 'none'").type(row.mime_type);
    reply.header('Content-Disposition', `${row.mime_type.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.original_name).replace(/'/g, '%27')}`);
    try { return reply.send(await storage.read(row.storage_key)); }
    catch { throw new HttpError(503, 'FILE_UNAVAILABLE', '附件文件暂不可用，请联系管理员恢复'); }
  });
  async function list(actor: Actor, queryInput: unknown, ownOnly: boolean) {
    const query = mediaQuery.parse(queryInput);
    const values: unknown[] = [actor.user.id, `%${query.q}%`, query.accessLevel || null];
    const scope = managementScopeSql(actor, 'read', values);
    const access = ownOnly ? 'm.owner_id=$1' : `(m.owner_id=$1 OR EXISTS(SELECT 1 FROM content_version_media r JOIN content_versions rv ON rv.id=r.version_id JOIN contents c ON c.id=rv.content_id JOIN content_versions v ON v.id=c.draft_version_id WHERE r.media_id=m.id AND (${scope})))`;
    const where = `${actor.user.role === 'ADMIN' && !ownOnly ? '$1::uuid IS NOT NULL' : access} AND m.original_name ILIKE $2 AND ($3::text IS NULL OR m.access_level=$3)`;
    // Scope parameters only exist for editors; own-only queries need no grant bindings.
    if (ownOnly) values.splice(3);
    const count = await ctx.db.query(`SELECT count(*)::int AS n FROM media m WHERE ${where}`, values);
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await ctx.db.query<MediaRow>(`SELECT m.*,(SELECT count(*) FROM content_version_media r WHERE r.media_id=m.id) AS reference_count FROM media m WHERE ${where} ORDER BY m.created_at DESC,m.id LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { data: result.rows.map(mediaDTO), meta: { page: query.page, pageSize: query.pageSize, total: count.rows[0].n } };
  }
  app.get('/api/v1/media', async request => list(requireActor(request), request.query, true));
  app.get('/api/v1/admin/media', async request => list(requireEditor(request), request.query, false));
  app.get('/api/v1/admin/media/:id/references', async request => {
    const actor = requireEditor(request), id = paramsId(request.params);
    if (!await canUseMedia(ctx.db, id, actor)) throw new HttpError(404, 'NOT_FOUND', '附件不存在或无权访问');
    const result = await ctx.db.query<{ content_id: string; kind: ContentKind; version_id: string; revision: number; payload: ContentPayload; usage: string }>(`SELECT v.content_id,c.kind,r.version_id,v.revision,v.payload,r.usage FROM content_version_media r JOIN content_versions v ON v.id=r.version_id JOIN contents c ON c.id=v.content_id WHERE r.media_id=$1 ORDER BY v.created_at DESC`, [id]);
    return { data: result.rows.map(row => canManage(actor, { id: row.content_id, kind: row.kind, directionIds: row.payload.directionIds }, 'read') ? { contentId: row.content_id, kind: row.kind, title: row.payload.title, versionId: row.version_id, revision: row.revision, usage: row.usage } : { title: '其他受限内容的引用', restricted: true }) };
  });
  app.delete('/api/v1/admin/media/:id', async request => {
    const actor = requireEditor(request), id = paramsId(request.params);
    await inTransaction(ctx.db, async db => {
      const row = await getMedia(db, id, true);
      if (actor.user.role !== 'ADMIN' && row.owner_id !== actor.user.id) throw new HttpError(403, 'FORBIDDEN', '只能删除自己上传且未被引用的附件');
      if (Number(row.reference_count)) throw new HttpError(409, 'MEDIA_REFERENCED', '附件仍被草稿、已发布内容或历史版本引用，请查看引用记录');
      await db.query('DELETE FROM media WHERE id=$1', [id]);
      await audit(db, actor.user.id, 'DELETE_MEDIA', 'media', id, {}, request.id);
      // Persist cleanup intent in the same transaction. A failed COMMIT cannot lose file bytes.
      await queueJob(db, 'MEDIA_DELETE', { storageKey: row.storage_key }, `media-delete:${id}`, ctx.now(), ctx.now());
    });
    return { data: { message: '附件已删除' } };
  });
}
