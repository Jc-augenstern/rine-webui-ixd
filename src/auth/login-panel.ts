import type { Credentials } from "./auth-types";
import "./password-toggle.css";
import { platformApi, errorMessage } from '../platform/api';
import type { SafeUser } from '../../shared/platform';
import { escapeHtml as escape } from '../html';

export class LoginPanel {
  readonly element = document.createElement("section");
  private form: HTMLFormElement;
  private account: HTMLInputElement;
  private password: HTMLInputElement;
  private passwordToggle: HTMLButtonElement;
  private feedback: HTMLElement;
  private status: HTMLElement;
  private auxiliary: HTMLElement;
  private links: HTMLElement;
  private request?: AbortController;
  private linkToken = '';
  private linkMode = '';
  constructor(host: HTMLElement, onSubmit: (credentials: Credentials) => void, private actions: { guest: () => void; resume: () => void }) {
    this.element.className = "identity-access";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "IXD 身份接入");
    this.element.innerHTML = `<div class="identity-topline"><span>IXD INTERNAL NETWORK</span><span class="identity-ready">● SYSTEM READY</span></div>
      <div class="identity-kicker">01 / IDENTITY ACCESS</div><h1>身份接入<span>让探索，从这里开始。</span></h1>
      <form novalidate><label for="ixd-account">ACCOUNT / ID <span>账户</span></label><input id="ixd-account" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="254" placeholder="用户名或邮箱" aria-describedby="identity-feedback" required />
      <label for="ixd-password">PASSWORD <span>密码</span></label><div class="identity-password"><input id="ixd-password" name="password" type="password" autocomplete="current-password" maxlength="128" placeholder="输入访问密码" aria-describedby="identity-feedback" required /><button class="identity-password-toggle" type="button" aria-label="显示密码" aria-controls="ixd-password" aria-pressed="false" title="显示密码"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/><path class="identity-eye-slash" d="M4 4 20 20"/></svg></button></div>
      <p id="identity-feedback" class="identity-feedback" role="alert"></p><button type="submit" class="identity-submit">ACCESS SYSTEM <span>→</span></button></form>
      <div class="identity-progress" role="status" aria-live="polite" hidden><i></i><strong>AUTHENTICATING</strong><span>正在确认访问身份</span><div class="identity-progress-line"></div></div>
      <nav class="identity-links" aria-label="账户操作"><button type="button" data-auth="register">创建账户</button><button type="button" data-auth="forgot-password">忘记密码</button><button type="button" data-auth="guest">访客浏览 →</button><button type="button" data-auth="resume" hidden></button></nav>
      <section class="identity-account-flow" aria-live="polite" hidden></section>
      <div class="identity-foot"><span>AUTHENTICATION CHANNEL / 01</span><small>IXD 社团内容与协作平台</small></div>`;
    this.form = this.element.querySelector("form")!;
    this.account = this.element.querySelector("#ixd-account")!;
    this.password = this.element.querySelector("#ixd-password")!;
    this.passwordToggle = this.element.querySelector(".identity-password-toggle")!;
    this.feedback = this.element.querySelector(".identity-feedback")!;
    this.status = this.element.querySelector(".identity-progress")!;
    this.links = this.element.querySelector('.identity-links')!;
    this.auxiliary = this.element.querySelector('.identity-account-flow')!;
    this.links.addEventListener('click', event => {
      const action = (event.target as Element).closest<HTMLElement>('[data-auth]')?.dataset.auth;
      if (this.form.inert) return;
      if (action === 'guest') this.actions.guest();
      else if (action === 'resume') this.actions.resume();
      else if (action) this.openFlow(action);
    });
    this.passwordToggle.addEventListener("pointerdown", (event) => {
      // Keep an active text selection and mobile keyboard while using the eye.
      // Keyboard activation retains focus on the real button instead.
      if (event.button === 0 && document.activeElement === this.password) event.preventDefault();
    });
    this.passwordToggle.addEventListener("click", () => {
      if (!this.form.inert) this.setPasswordVisible(this.password.type === "password");
    });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.form.inert) return;
      if (!this.account.value.trim() || !this.password.value) {
        this.error("INVALID IDENTITY / 请输入账户与密码");
        return;
      }
      onSubmit({ account: this.account.value, password: this.password.value });
    });
    this.form.addEventListener("input", () => {
      this.feedback.textContent = "";
      this.account.removeAttribute("aria-invalid");
      this.password.removeAttribute("aria-invalid");
    });
    host.append(this.element);
  }

  private setPasswordVisible(visible: boolean) {
    const { selectionStart, selectionEnd, selectionDirection } = this.password;
    const focused = document.activeElement === this.password;
    const type = visible ? "text" : "password";
    const typeChanged = this.password.type !== type;
    this.password.type = type;
    const action = visible ? "隐藏密码" : "显示密码";
    this.passwordToggle.setAttribute("aria-label", action);
    this.passwordToggle.setAttribute("aria-pressed", String(visible));
    this.passwordToggle.title = action;
    // Chromium rebuilds the input's internal editor lazily after a type change.
    // Resolve that one layout before restoring the range, or it resets afterward.
    if (typeChanged) this.password.getBoundingClientRect();
    if (focused) this.password.focus({ preventScroll: true });
    if (selectionStart !== null && selectionEnd !== null) {
      this.password.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? "none");
    }
  }

  show() {
    this.element.hidden = false;
    this.form.hidden = false;
    this.form.inert = false;
    this.status.hidden = true;
    this.password.value = "";
    this.setPasswordVisible(false);
    this.feedback.textContent = "";
    this.account.focus({ preventScroll: true });
    this.links.hidden = false;
    this.auxiliary.hidden = true;
    this.setSession(platformApi.session?.user ?? null);
    const authRoute = location.hash.match(/^#auth\/(verify-email|reset-password)\?(.*)$/);
    if (authRoute) {
      this.linkToken = new URLSearchParams(authRoute[2]).get('token') ?? '';
      this.linkMode = authRoute[1];
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (this.linkMode) this.openFlow(this.linkMode);
  }
  hide() {
    this.request?.abort();
    this.element.hidden = true;
    this.password.value = "";
    this.setPasswordVisible(false);
  }
  progress(text: string, caption: string) {
    this.form.inert = true;
    this.form.hidden = true;
    this.setPasswordVisible(false);
    this.status.hidden = false;
    this.status.querySelector("strong")!.textContent = text;
    this.status.querySelector("span")!.textContent = caption;
    this.links.hidden = true;
  }
  error(message = "ACCESS DENIED / INVALID IDENTITY") {
    this.form.inert = false;
    this.form.hidden = false;
    this.status.hidden = true;
    this.feedback.textContent = message;
    this.account.setAttribute("aria-invalid", "true");
    this.password.setAttribute("aria-invalid", "true");
    this.password.value = "";
    this.setPasswordVisible(false);
    this.password.focus({ preventScroll: true });
    this.links.hidden = false;
  }
  setSession(user: SafeUser | null) {
    const button = this.links.querySelector<HTMLButtonElement>('[data-auth="resume"]')!;
    button.hidden = !user;
    button.textContent = user ? `继续访问 · ${user.displayName} →` : '';
    this.links.querySelector<HTMLButtonElement>('[data-auth="guest"]')!.hidden = Boolean(user);
  }
  private openFlow(mode: string) {
    this.request?.abort(); this.request = new AbortController();
    this.form.hidden = true; this.links.hidden = true; this.status.hidden = true; this.auxiliary.hidden = false;
    const labels: Record<string, string> = { register: '创建 IXD 账户', 'forgot-password': '找回密码', 'reset-password': '设置新密码', 'verify-email': '验证邮箱' };
    const field = (name: string, label: string, type = 'text', min = 1, max = 254) => `<label>${label}<input name="${name}" type="${type}" required minlength="${min}" maxlength="${max}" autocomplete="${name === 'password' ? 'new-password' : name === 'email' ? 'email' : 'off'}" /></label>`;
    this.auxiliary.innerHTML = `<h2>${escape(labels[mode] ?? '账户操作')}</h2><form class="identity-secondary-form">${mode === 'register' ? field('username', '用户名（字母、数字、_ 或 -）', 'text', 3, 40) + field('displayName', '显示名称', 'text', 1, 80) : ''}${['register','forgot-password'].includes(mode) ? field('email', '邮箱', 'email') : ''}${['register','reset-password'].includes(mode) ? field('password', '密码（至少 12 位）', 'password', 12, 128) : ''}${mode === 'verify-email' ? '<p>确认验证此邮件对应的账户。</p>' : ''}<p class="identity-flow-feedback" role="status"></p><button class="identity-submit" type="submit">${mode === 'verify-email' ? '验证邮箱' : mode === 'forgot-password' ? '发送重置邮件' : '提交'}</button></form><button class="identity-flow-back" type="button">← 返回登录</button>`;
    this.auxiliary.querySelector('.identity-flow-back')!.addEventListener('click', () => { this.request?.abort(); this.linkMode = ''; this.linkToken = ''; this.show(); });
    this.auxiliary.querySelector('form')!.addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget as HTMLFormElement;
      if (!form.reportValidity()) return;
      const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
      const feedback = form.querySelector<HTMLElement>('.identity-flow-feedback')!;
      const body: Record<string, string> = Object.fromEntries(new FormData(form)) as Record<string, string>;
      if (mode === 'reset-password' || mode === 'verify-email') body.token = this.linkToken;
      button.disabled = true; feedback.textContent = '正在连接…';
      try {
        await platformApi.request(`/auth/${mode}`, { method: 'POST', body, signal: this.request!.signal });
        this.linkToken = '';
        this.linkMode = '';
        feedback.textContent = mode === 'register' ? '注册成功，请前往邮箱验证，然后返回登录。' : mode === 'forgot-password' ? '如果邮箱已注册，你会收到重置邮件。请检查收件箱。' : mode === 'verify-email' ? '邮箱验证成功，可以返回登录。' : '密码已重置，请使用新密码登录。';
        form.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.value = ''; input.disabled = true; });
        await platformApi.refreshSession(this.request!.signal);
      } catch (error) {
        if (!this.request!.signal.aborted) { feedback.textContent = errorMessage(error); button.disabled = false; }
      }
    });
    this.auxiliary.querySelector<HTMLInputElement>('input')?.focus();
  }
  dispose() {
    this.request?.abort();
    this.element.remove();
  }
}
