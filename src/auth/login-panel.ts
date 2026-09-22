import type { Credentials } from "./auth-types";
import "./password-toggle.css";

export class LoginPanel {
  readonly element = document.createElement("section");
  private form: HTMLFormElement;
  private account: HTMLInputElement;
  private password: HTMLInputElement;
  private passwordToggle: HTMLButtonElement;
  private feedback: HTMLElement;
  private status: HTMLElement;
  constructor(host: HTMLElement, onSubmit: (credentials: Credentials) => void) {
    this.element.className = "identity-access";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "IXD 身份接入");
    this.element.innerHTML = `<div class="identity-topline"><span>IXD INTERNAL NETWORK</span><span class="identity-ready">● SYSTEM READY</span></div>
      <div class="identity-kicker">01 / IDENTITY ACCESS</div><h1>身份接入<span>让探索，从这里开始。</span></h1>
      <form novalidate><label for="ixd-account">ACCOUNT / ID <span>账户</span></label><input id="ixd-account" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="80" placeholder="输入你的账户" aria-describedby="identity-feedback" required />
      <label for="ixd-password">PASSWORD <span>密码</span></label><div class="identity-password"><input id="ixd-password" name="password" type="password" autocomplete="current-password" maxlength="128" placeholder="输入访问密码" aria-describedby="identity-feedback" required /><button class="identity-password-toggle" type="button" aria-label="显示密码" aria-controls="ixd-password" aria-pressed="false" title="显示密码"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/><path class="identity-eye-slash" d="M4 4 20 20"/></svg></button></div>
      <p id="identity-feedback" class="identity-feedback" role="alert"></p><button type="submit" class="identity-submit">ACCESS SYSTEM <span>→</span></button></form>
      <div class="identity-progress" role="status" aria-live="polite" hidden><i></i><strong>AUTHENTICATING</strong><span>正在确认访问身份</span><div class="identity-progress-line"></div></div>
      <div class="identity-foot"><span>AUTHENTICATION CHANNEL / 01</span><small>前端 Demo · 仅用于开发测试</small></div>`;
    this.form = this.element.querySelector("form")!;
    this.account = this.element.querySelector("#ixd-account")!;
    this.password = this.element.querySelector("#ixd-password")!;
    this.passwordToggle = this.element.querySelector(".identity-password-toggle")!;
    this.feedback = this.element.querySelector(".identity-feedback")!;
    this.status = this.element.querySelector(".identity-progress")!;
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
  }
  hide() {
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
  }
  dispose() {
    this.element.remove();
  }
}
