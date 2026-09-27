import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { directionKeys } from '../../shared/platform';

export const labels: Record<string, string> = {
  USER:'普通用户',EDITOR:'内容编辑者',ADMIN:'管理员',ACTIVE:'启用',DISABLED:'停用',NONE:'非成员',MEMBER:'社团成员',
  DRAFT:'草稿',PUBLISHED:'已发布',WITHDRAWN:'已撤回',ARCHIVED:'已归档',REVIEW:'待审核',RETURNED:'已退回',
  PUBLIC:'公开',AUTHENTICATED:'已登录用户',MEMBERS:'社团成员',normal:'普通',important:'重要',
  ai:'AI 与智能系统',robotics:'具身智能与机器人',interaction:'新媒体与交互设计',visual:'文创与视觉设计',xr:'XR 与交互娱乐',hardware:'智能硬件',
  IDEA:'构想',BUILDING:'进行中',RECRUITING:'招募中',COMPLETED:'已完成',SCHEDULED:'计划举办',CANCELLED:'已取消',
  BEGINNER:'入门',INTERMEDIATE:'进阶',ADVANCED:'高级',ARTICLE:'文章',VIDEO:'视频',TOOL:'工具',FILE:'文件',COURSE:'课程',
  PENDING:'待处理',APPROVED:'已批准',REJECTED:'已拒绝',WITHDRAWN_APPLICATION:'已撤回',REGISTERED:'已报名',LEFT:'已退出',REMOVED:'已移除',
  about:'社团介绍',join:'加入说明',create:'新建',read:'读取',update:'编辑',publish:'发布',archive:'归档/撤回',delete:'删除',manage:'管理协作',
};
export function Label({ value }: { value: string | null | undefined }) { return <>{value ? labels[value] ?? value : '—'}</>; }
export function Status({ value }: { value: string }) { return <span className={`badge badge-${value.toLowerCase()}`}><Label value={value}/></span>; }
export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  const id = useId();
  const identify = (child: ReactNode): ReactNode => {
    if (!isValidElement(child)) return child;
    const element = child as ReactElement<Record<string, unknown>>;
    if (typeof element.type !== 'string' || ['input', 'textarea', 'select'].includes(element.type)) return cloneElement(element, { id, 'aria-label': label, 'aria-describedby': hint ? `${id}-hint` : undefined });
    return cloneElement(element, {}, Children.map(element.props.children as ReactNode, identify));
  };
  const control = identify(children);
  return <div className={`field ${wide ? 'wide' : ''}`}><label htmlFor={id}>{label}</label>{control}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function Select({ value, options, onChange, empty, disabled, ...props }: { value: string; options: readonly string[]; onChange: (v: string) => void; empty?: string; disabled?: boolean; id?: string; 'aria-label'?: string; 'aria-describedby'?: string }) {
  return <select {...props} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>{empty !== undefined && <option value="">{empty}</option>}{options.map(v => <option key={v} value={v}>{labels[v] ?? v}</option>)}</select>;
}
export function DirectionChecks({ value, onChange }: { value: readonly string[]; onChange: (v: string[]) => void }) {
  return <div className="checks">{directionKeys.map(key => <label key={key}><input type="checkbox" checked={value.includes(key)} onChange={e => onChange(e.target.checked ? [...value, key] : value.filter(v => v !== key))}/>{labels[key]}</label>)}</div>;
}
export function Notice({ error, success }: { error?: string; success?: string }) {
  return <>{error && <div className="notice error" role="alert">{error}</div>}{success && <div className="notice success" role="status">{success}</div>}</>;
}
export function Pager({ page, total, pageSize = 20, onChange }: { page: number; total: number; pageSize?: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pager"><span>共 {total} 条 · 第 {page} / {pages} 页</span><button disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</button><button disabled={page >= pages} onClick={() => onChange(page + 1)}>下一页</button></div>;
}
export function when(value?: string | null) { return value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
export function toLocal(value: unknown) { if (typeof value !== 'string' || !value) return ''; const date = new Date(value); if (!Number.isFinite(+date)) return ''; return new Date(+date + 8 * 3600_000).toISOString().slice(0, 16); }
export function toIso(value: string) { return value ? new Date(`${value}:00+08:00`).toISOString() : null; }
export function DateTime({ value, onChange, ...props }: { value: unknown; onChange: (v: string | null) => void; id?: string; 'aria-label'?: string; 'aria-describedby'?: string }) {
  return <input {...props} type="datetime-local" value={toLocal(value)} onChange={e => onChange(toIso(e.target.value))}/>;
}
