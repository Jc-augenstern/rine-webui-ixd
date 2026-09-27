import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { contentKinds, contentLabels, type ContentKind, type SessionDTO } from '../../shared/platform';
import { api, getSession, message, rememberSession } from './api';
import { Field, labels, Notice } from './common';
import { ContentEditor, Contents } from './contents';
import { Overview, MediaLibrary, SiteSettingsEditor, AuditLog, Users, BusinessManager } from './management';
import './styles.css';

function Login({ onSession, notice }: { onSession: (session: SessionDTO) => void; notice: string }) {
  const [account, setAccount] = useState(''), [password, setPassword] = useState(''), [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState(''), [forgot, setForgot] = useState(false), [email, setEmail] = useState('');
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); setSuccess(''); try {
    await getSession();
    if (forgot) { await api('/auth/forgot-password', { method: 'POST', body: { email } }); setSuccess('如果该邮箱存在，将收到重置密码邮件。开发环境请在本地测试收件箱查看；请勿重复提交。'); }
    else { const { data } = await api<SessionDTO>('/auth/login', { method: 'POST', body: { account, password } }); rememberSession(data); setPassword(''); onSession(data); }
  } catch (e) { setError(message(e)); } finally { setBusy(false); } };
  return <main className="login-page"><form className="login-card panel" onSubmit={submit}><div className="brand">IXD <span>ADMIN</span></div><h1>{forgot ? '找回管理员密码' : '登录管理后台'}</h1><p>使用已获授权的账号。成员身份与管理权限相互独立。</p><Notice error={error || notice} success={success}/>{forgot ? <Field label="注册邮箱"><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required/></Field> : <><Field label="用户名或邮箱"><input autoComplete="username" value={account} onChange={e => setAccount(e.target.value)} required maxLength={254}/></Field><Field label="密码"><div className="password-field"><input aria-label="密码" type={visible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={128}/><button type="button" aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? '隐藏' : '显示'}</button></div></Field></>}<button className="primary full" disabled={busy}>{busy ? '正在处理…' : forgot ? '发送重置邮件' : '登录'}</button><button type="button" className="text-button" onClick={() => { setForgot(!forgot); setError(''); setSuccess(''); }}>{forgot ? '返回登录' : '忘记密码？'}</button><p className="muted">首个管理员由本地受控命令创建，后台不提供公开管理员注册。<a href={__IXD_FRONTEND_URL__}>返回网站</a></p></form></main>;
}

function App() {
  const [session, setSession] = useState<SessionDTO | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [route, setRoute] = useState(location.hash.slice(1) || 'overview'), [mobileNav, setMobileNav] = useState(false);
  const dirty = useRef(false), routeRef = useRef(route);
  const onDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const refresh = async () => { try { setSession(await getSession()); setError(''); } catch (e) { setError(message(e)); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); const expired = () => { setSession(null); setError('会话已失效，请重新登录。未提交操作未被视为成功。'); }; const focus = () => { void refresh(); }; window.addEventListener('ixd:session-expired', expired); window.addEventListener('focus', focus); return () => { window.removeEventListener('ixd:session-expired', expired); window.removeEventListener('focus', focus); }; }, []);
  useEffect(() => { const handler = () => { const next = location.hash.slice(1) || 'overview'; if (dirty.current && !window.confirm('还有未保存的修改，确认离开并放弃这些输入？')) { history.replaceState(null, '', `#${routeRef.current}`); return; } dirty.current = false; routeRef.current = next; setRoute(next); setMobileNav(false); }; const leave = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('hashchange', handler); window.addEventListener('beforeunload', leave); return () => { window.removeEventListener('hashchange', handler); window.removeEventListener('beforeunload', leave); }; }, []);
  const navigate = (next: string, force = false) => { if (next === routeRef.current) return; if (!force && dirty.current && !window.confirm('还有未保存的修改，确认离开并放弃这些输入？')) return; dirty.current = false; location.hash = next; };
  const logout = async () => { if (dirty.current && !window.confirm('还有未保存的修改，确认退出？')) return; try { await api('/auth/logout', { method: 'POST' }); dirty.current = false; setSession(await getSession()); } catch (e) { setError(message(e)); } };
  if (loading) return <main className="login-page"><div className="panel">正在恢复安全会话…</div></main>;
  if (!session?.user) return <Login onSession={value => { setSession(value); setError(''); }} notice={error}/>;
  if (session.user.role === 'USER') return <main className="login-page"><section className="panel login-card"><h1>无管理权限</h1><p>你已登录为 {session.user.displayName}，当前账号是普通用户。社团成员身份不会自动获得后台权限。</p><a className="button primary" href={__IXD_FRONTEND_URL__}>返回网站</a><button onClick={() => void logout()}>退出并切换账号</button><Notice error={error}/></section></main>;
  const admin = session.user.role === 'ADMIN';
  const kinds = contentKinds.filter(kind => admin || session.grants.some(g => g.contentKind === kind));
  const menu = [{ key: 'overview', title: '总览' }, ...kinds.map(kind => ({ key: `contents/${kind}`, title: contentLabels[kind] === '作品与成果' ? '作品审核与管理' : contentLabels[kind] })), ...(admin || session.grants.some(g => g.contentKind === 'projects' && g.actions.includes('manage')) ? [{ key: 'applications', title: '项目申请与成员' }] : []), ...(admin || session.grants.some(g => g.contentKind === 'events' && g.actions.includes('manage')) ? [{ key: 'registrations', title: '活动报名管理' }] : []), { key: 'media', title: '媒体附件' }, ...(admin ? [{ key: 'users', title: '用户与授权' }, { key: 'settings', title: '站点内容设置' }, { key: 'audit', title: '操作日志' }] : [])];
  const parts = route.split('/'), kind = parts[1] as ContentKind;
  const allowed = menu.some(item => route === item.key || route.startsWith(`${item.key}/`));
  const page = !allowed ? <div className="panel"><h1>无权访问此管理页面</h1><p>请联系管理员调整授权。API 会独立验证每次操作。</p></div> : parts[0] === 'contents' && kinds.includes(kind) ? parts[2] ? <ContentEditor key={route} kind={kind} id={parts[2]} session={session} navigate={navigate} onDirty={onDirty}/> : <Contents key={kind} kind={kind} session={session} navigate={navigate}/> : route === 'settings' ? <SiteSettingsEditor onDirty={onDirty}/> : route === 'users' ? <Users onDirty={onDirty} navigate={navigate}/> : route === 'media' ? <MediaLibrary/> : route === 'audit' ? <AuditLog/> : parts[0] === 'applications' || parts[0] === 'registrations' ? <BusinessManager key={route} mode={parts[0]} userId={parts[1]} navigate={navigate}/> : <Overview navigate={navigate}/>;
  return <div className="admin-layout"><aside className={`sidebar ${mobileNav ? 'open' : ''}`}><div className="brand">IXD <span>ADMIN</span></div><nav aria-label="管理菜单">{menu.map(item => <button key={item.key} className={route === item.key || route.startsWith(`${item.key}/`) ? 'active' : ''} onClick={() => navigate(item.key)}>{item.title}</button>)}</nav><small>内容与协作管理<br/>不包含签到或考勤功能</small></aside><div className="workspace"><header className="topbar"><button className="nav-toggle" onClick={() => setMobileNav(!mobileNav)} aria-expanded={mobileNav}>菜单</button><span>IXD 内容管理</span><div className="account-area"><span>{session.user.displayName} · {labels[session.user.role]}</span><a href={__IXD_FRONTEND_URL__} target="_blank" rel="noreferrer">查看网站 ↗</a><button onClick={() => void logout()}>退出</button></div></header><main className="main-content"><Notice error={error}/>{page}</main></div></div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
