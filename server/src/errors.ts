import { ZodError } from 'zod';
import type { FastifyInstance } from 'fastify';
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors?: Record<string, string[]>) { super(message); }
}
export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, request, reply) => {
    let status = 500, code = 'INTERNAL_ERROR', message = '服务暂时无法完成请求，请稍后重试';
    let fieldErrors: Record<string, string[]> | undefined;
    if (error instanceof HttpError) { status = error.status; code = error.code; message = error.message; fieldErrors = error.fieldErrors; }
    else if (error instanceof ZodError) {
      status = 400; code = 'VALIDATION_ERROR'; message = '请检查输入字段'; fieldErrors = {};
      for (const issue of error.issues) (fieldErrors[issue.path.join('.') || 'form'] ||= []).push(issue.message);
    } else if (error.code === '23505') { status = 409; code = 'ALREADY_EXISTS'; message = '该记录已存在，请检查后重试'; }
    else if (error.code === '23503') { status = 409; code = 'REFERENCE_CONFLICT'; message = '记录存在关联引用，无法完成操作'; }
    else if (error.code === '22P02') { status = 400; code = 'INVALID_ID'; message = '记录标识格式无效'; }
    else if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      status = error.statusCode; code = status === 403 ? 'CSRF_INVALID' : status === 429 ? 'RATE_LIMITED' : status === 413 ? 'UPLOAD_TOO_LARGE' : 'BAD_REQUEST';
      message = status === 403 ? '安全校验失败，请刷新页面后重试' : status === 429 ? '操作过于频繁，请稍后重试' : status === 413 ? '提交内容超过大小限制' : '请求格式无效';
    }
    if (status >= 500) request.log.error({ code: error.code || 'INTERNAL_ERROR', requestId: request.id }, 'Request failed');
    reply.status(status).send({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}), requestId: request.id } });
  });
  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: '接口或记录不存在' } }));
}
