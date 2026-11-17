/** @jsxImportSource hono/jsx */
/** Administrator pages: login, all polls (moderation), settings dashboard, administrators, API tokens. */
import { fmtDate } from "../lib/i18n";
import { toLocal } from "../lib/time";
import type { Settings } from "../repo/settings";
import { STATUS_LABEL_JA, type Meta } from "../og/card";
import { Alert, CopyBox, Layout, type View } from "./layout";

export function LoginPage({ v, meta, next, error }: { v: View; meta: Meta; next: string; error?: string | null }) {
  return (
    <Layout v={v} title={`${v.t("ログイン")}｜Time of EVE`} meta={meta}>
      <div class="card" style="max-width:420px;margin:24px auto">
        <h2>{v.t("管理者ログイン")}</h2>
        {error && <Alert kind="err" testid="login-error">{error}</Alert>}
        <form method="post" action="/admin/login">
          <input type="hidden" name="next" value={next} />
          <label class="f" for="username">{v.t("ユーザー名")}</label>
          <input id="username" name="username" type="text" autocomplete="username" required data-testid="login-username" />
          <label class="f" for="password">{v.t("パスワード")}</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required data-testid="login-password" />
          <div class="spacer"></div><div class="spacer"></div>
          <button class="btn btn-primary btn-lg" style="width:100%" data-testid="login-submit">{v.t("ログイン")}</button>
        </form>
      </div>
    </Layout>
  );
}

export interface PollRowView {
  id: string; title: string; status: string; effectiveStatus: string; hidden: boolean; ownerUserId: number | null;
  candidateCount: number; responded: number; invited: number; createdAt: number; timezone: string; owner: string;
}

export function DashboardPage({ v, meta, polls, filter, q, page, hasNext, flash }: {
  v: View; meta: Meta; polls: PollRowView[]; filter: string; q: string; page: number; hasNext: boolean; flash?: string | null;
}) {
  const tabs: [string, string][] = [["mine", v.t("自分が作成")], ["all", v.t("すべて")], ["anonymous", v.t("ログインなしで作成")]];
  const qs = (o: Record<string, string | number>) => "?" + new URLSearchParams(Object.entries({ filter, q, ...o }).map(([k, x]) => [k, String(x)])).toString();
  return (
    <Layout v={v} title={`${v.t("一覧")}｜Time of EVE`} meta={meta} scripts={["admin.js"]}>
      {flash && <Alert kind="ok" testid="flash">{flash}</Alert>}
      <div class="card">
        <div class="row">
          <h2 class="grow" style="margin:0">{v.t("日程調整の一覧")}</h2>
          <a class="btn btn-blue" href="/new/import" data-testid="go-import">{v.t("JSONを貼り付けて作成")}</a>
          <a class="btn btn-primary" href="/new">{v.t("日程をえらんで作成")}</a>
        </div>
        <div class="spacer"></div>
        <div class="row tabs">
          {tabs.map(([k, label]) => <a class={`btn btn-sm${filter === k ? " btn-primary" : ""}`} href={qs({ filter: k, page: 1 })}>{label}</a>)}
          <form method="get" class="row grow" style="justify-content:flex-end">
            <input type="hidden" name="filter" value={filter} />
            <input type="search" name="q" value={q} placeholder={v.t("タイトルで検索")} class="w-auto" />
            <button class="btn btn-sm">{v.t("検索")}</button>
          </form>
        </div>
        <div class="spacer"></div>
        {polls.length ? (
          <div style="overflow-x:auto">
            <table class="list" data-testid="poll-list">
              <thead><tr><th>{v.t("タイトル")}</th><th>{v.t("状態")}</th><th>{v.t("候補")}</th><th>{v.t("回答")}</th><th>{v.t("作成者")}</th><th>{v.t("作成")}</th></tr></thead>
              <tbody>
                {polls.map((p) => (
                  <tr>
                    <td><a href={`/admin/polls/${p.id}`}>{p.title}</a>{p.hidden && <> <span class="chip chip-cancelled">{v.t("非公開")}</span></>}</td>
                    <td><span class={`chip chip-${p.effectiveStatus}`}>{v.t(STATUS_LABEL_JA[p.effectiveStatus])}</span></td>
                    <td>{p.candidateCount}</td>
                    <td>{p.responded}{p.invited ? ` / ${p.invited}` : ""}</td>
                    <td class="muted">{p.owner}</td>
                    <td class="muted">{fmtDate(v.lang, toLocal(p.createdAt, p.timezone))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div class="hero"><p>{v.t("まだ日程調整がありません。")}</p></div>}
        <div class="row" style="justify-content:space-between;margin-top:10px">
          {page > 1 ? <a class="btn btn-sm" href={qs({ page: page - 1 })}>‹ {v.t("前へ")}</a> : <span></span>}
          {hasNext ? <a class="btn btn-sm" href={qs({ page: page + 1 })}>{v.t("次へ")} ›</a> : <span></span>}
        </div>
      </div>
    </Layout>
  );
}

export function SettingsPage({ v, meta, settings, flash, error, users, me }: {
  v: View; meta: Meta; settings: Settings; flash?: string | null; error?: string | null;
  users: { id: number; username: string; disabled: boolean; createdAt: number }[]; me: number;
}) {
  const csrf = v.admin!.csrf;
  return (
    <Layout v={v} title={`${v.t("設定")}｜Time of EVE`} meta={meta} scripts={["admin.js"]}>
      {flash && <Alert kind="ok" testid="flash">{flash}</Alert>}
      {error && <Alert kind="err" testid="settings-error">{error}</Alert>}
      <div class="card">
        <h2>{v.t("サイト設定")}</h2>
        <form method="post" action="/admin/settings" data-testid="settings-form">
          <input type="hidden" name="csrf" value={csrf} />
          <input type="hidden" name="action" value="save" />
          <h3>{v.t("日程調整を作成できる人")}</h3>
          <label class="radio-row"><input type="radio" name="creation_mode" value="admin_only" checked={settings.creation_mode === "admin_only"} data-testid="mode-admin_only" /> <b>{v.t("管理者のみ")}</b> — <span class="muted">{v.t("ログインした管理者だけが作成できます（API・MCPは管理者のトークンが必要）。")}</span></label>
          <label class="radio-row"><input type="radio" name="creation_mode" value="anyone" checked={settings.creation_mode === "anyone"} data-testid="mode-anyone" /> <b>{v.t("誰でも（ログイン不要）")}</b> — <span class="muted">{v.t("訪問者もトップページから作成できます。作成者には管理用URLが発行されます。Webはボット確認（Turnstile）、API・MCPはIPごとの回数制限で保護されます。")}</span></label>
          <h3>{v.t("データの保持期間")}</h3>
          <div class="row">
            <label for="retention_days">{v.t("ログインなしで作成された日程調整を、最後の候補日から")}</label>
            <input type="number" id="retention_days" name="retention_days" min={0} max={3650} value={String(settings.retention_days)} class="w-auto" style="width:7em" data-testid="retention-days" />
            <span>{v.t("日後に自動削除（0 = 削除しない）")}</span>
          </div>
          <h3>{v.t("既定のタイムゾーン")}</h3>
          <input type="text" name="default_timezone" value={settings.default_timezone} class="w-auto" placeholder="Asia/Tokyo" />
          <h3>{v.t("共有画像（OGP）")}</h3>
          <label class="radio-row"><input type="checkbox" name="og_dynamic" checked={settings.og_dynamic} data-testid="og-dynamic" /> <b>{v.t("日程調整ごとに画像を生成する")}</b> — <span class="muted">{v.t("オフのときは、すべてのページで共通の静的画像を使います。生成には1枚あたり数十〜数百ミリ秒のCPUを使うため、Workers Paid プランが必要です（無料プランでは生成に失敗し、静的画像になります）。")}</span></label>
          <h3>{v.t("運営者情報（利用規約・プライバシーポリシーに表示）")}</h3>
          <label class="f" for="operator_name">{v.t("運営者名")}</label>
          <input type="text" id="operator_name" name="operator_name" value={settings.operator_name} maxlength={200} />
          <label class="f" for="contact">{v.t("連絡先（URLまたはメールアドレス）")}</label>
          <input type="text" id="contact" name="contact" value={settings.contact} maxlength={500} />
          <div class="spacer"></div>
          <button class="btn btn-primary" data-testid="settings-save">{v.t("保存")}</button>
        </form>
      </div>

      <div class="card">
        <h2>{v.t("管理者アカウント")}</h2>
        <table class="list">
          <thead><tr><th>{v.t("ユーザー名")}</th><th>{v.t("状態")}</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr>
                <td>{u.username}{u.id === me && <span class="muted"> ({v.t("あなた")})</span>}</td>
                <td>{u.disabled ? <span class="chip chip-cancelled">{v.t("無効")}</span> : <span class="chip chip-finalized">{v.t("有効")}</span>}</td>
                <td style="text-align:right">
                  {u.id !== me && (
                    <form method="post" action="/admin/settings" class="inline">
                      <input type="hidden" name="csrf" value={csrf} />
                      <input type="hidden" name="action" value={u.disabled ? "enable_user" : "disable_user"} />
                      <input type="hidden" name="user_id" value={String(u.id)} />
                      <button class={`btn btn-sm${u.disabled ? "" : " btn-danger"}`} data-confirm={u.disabled ? undefined : v.t("この管理者を無効にしますか？（ログイン中のセッションとAPIトークンも無効になります）")}>{u.disabled ? v.t("有効にする") : v.t("無効にする")}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>{v.t("管理者を追加")}</h3>
        <form method="post" action="/admin/settings" class="row">
          <input type="hidden" name="csrf" value={csrf} />
          <input type="hidden" name="action" value="add_user" />
          <input type="text" name="username" placeholder={v.t("ユーザー名")} required maxlength={64} pattern="[A-Za-z0-9._\-]{2,64}" class="w-auto" autocomplete="off" />
          <input type="password" name="password" placeholder={v.t("パスワード（12文字以上）")} required minlength={12} class="w-auto" autocomplete="new-password" />
          <button class="btn btn-sm">{v.t("追加")}</button>
        </form>
        <h3>{v.t("自分のパスワードを変更")}</h3>
        <form method="post" action="/admin/settings" class="row">
          <input type="hidden" name="csrf" value={csrf} />
          <input type="hidden" name="action" value="change_password" />
          <input type="password" name="current" placeholder={v.t("現在のパスワード")} required class="w-auto" autocomplete="current-password" />
          <input type="password" name="password" placeholder={v.t("新しいパスワード（12文字以上）")} required minlength={12} class="w-auto" autocomplete="new-password" />
          <button class="btn btn-sm">{v.t("変更")}</button>
        </form>
      </div>
    </Layout>
  );
}

export function TokensPage({ v, meta, tokens, newToken, mcpUrl }: {
  v: View; meta: Meta; mcpUrl: string;
  tokens: { id: number; name: string; revoked: boolean; createdAt: number; lastUsedAt: number | null }[]; newToken?: string | null;
}) {
  const csrf = v.admin!.csrf;
  const ts = (ms: number | null) => (ms == null ? "—" : new Date(ms).toISOString().slice(0, 16).replace("T", " "));
  return (
    <Layout v={v} title={`${v.t("APIトークン")}｜Time of EVE`} meta={meta} scripts={["admin.js"]}>
      <div class="card">
        <h2>{v.t("APIトークン")}</h2>
        <p class="muted">{v.t("REST API・MCPで管理者として操作するときに Authorization: Bearer <token> を付けます。トークンは作成時に一度だけ表示されます。AIとの会話本文には貼らず、ツールの認証設定に入れてください。")}</p>
        <p class="muted">MCP: <code>claude mcp add --transport http time-of-eve {mcpUrl} --header "Authorization: Bearer sch_…"</code></p>
        {newToken && (
          <Alert kind="ok">{v.t("新しいトークン（この画面を離れると再表示できません）:")}
            <CopyBox v={v} id="newtok" value={newToken} label="token" testid="new-token" />
          </Alert>
        )}
        <form method="post" class="row">
          <input type="hidden" name="csrf" value={csrf} /><input type="hidden" name="action" value="create" />
          <input type="text" name="name" placeholder={v.t("用途（例: claude-work）")} maxlength={100} class="grow w-auto" style="max-width:320px" />
          <button class="btn btn-primary">{v.t("トークン作成")}</button>
        </form>
        <div class="spacer"></div>
        <table class="list">
          <thead><tr><th>{v.t("名前")}</th><th>{v.t("作成日時(UTC)")}</th><th>{v.t("最終使用(UTC)")}</th><th>{v.t("状態")}</th><th></th></tr></thead>
          <tbody>
            {tokens.length ? tokens.map((t) => (
              <tr>
                <td>{t.name}</td><td class="muted">{ts(t.createdAt)}</td><td class="muted">{ts(t.lastUsedAt)}</td>
                <td>{t.revoked ? <span class="chip chip-cancelled">{v.t("失効")}</span> : <span class="chip chip-finalized">{v.t("有効")}</span>}</td>
                <td>{!t.revoked && (
                  <form method="post" class="inline">
                    <input type="hidden" name="csrf" value={csrf} /><input type="hidden" name="action" value="revoke" /><input type="hidden" name="token_id" value={String(t.id)} />
                    <button class="btn btn-sm btn-danger" data-confirm={v.t("このトークンを失効させますか？")}>{v.t("失効")}</button>
                  </form>
                )}</td>
              </tr>
            )) : <tr><td colspan={5} class="muted">{v.t("トークンはありません")}</td></tr>}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
