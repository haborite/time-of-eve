/** @jsxImportSource hono/jsx */
/** Visitor pages: top page, about / terms / privacy, AI & API guide page, error page. */
import { raw } from "hono/html";
import type { Settings } from "../repo/settings";
import type { Meta } from "../og/card";
import { Alert, CopyBox, Layout, type View } from "./layout";

function SampleTable({ v }: { v: View }) {
  // decorative sample: three people on one afternoon (○ yes, △ maybe, × no)
  const rows: [string, string][] = [["Aさん", "○○○△××"], ["Bさん", "×○○○○△"], ["AI(Cさん)", "○○○○××"]];
  const hours = ["13", "14", "15", "16", "17", "18"];
  const cls: Record<string, string> = { "○": "m-yes", "△": "m-maybe", "×": "m-no" };
  return (
    <div class="sample" aria-hidden="true">
      <div class="sample-h">{v.t("11/20(金)")}</div>
      <table class="sample-t">
        <tr><th></th>{hours.map((h) => <th>{h}</th>)}</tr>
        {rows.map(([name, marks]) => (
          <tr><th>{name}</th>{[...marks].map((m, i) => <td class={`${cls[m]}${i === 1 || i === 2 ? " best" : ""}`}>{m}</td>)}</tr>
        ))}
        <tr class="sum"><th>{v.t("参加できる人数")}</th>{[2, 3, 3, 2, 1, 0].map((n, i) => <td class={i === 1 || i === 2 ? "best" : ""}>{n}</td>)}</tr>
      </table>
    </div>
  );
}

export function HomePage({ v, meta, settings, mcpUrl, llmsUrl }: { v: View; meta: Meta; settings: Settings; mcpUrl: string; llmsUrl: string }) {
  const open = settings.creation_mode === "anyone";
  return (
    <Layout v={v} title={`Time of EVE｜${v.t("人間にもAIにも使いやすい日程調整ツール")}`} meta={meta} bodyClass="home" indexable scripts={["home.js"]}>
      <section class="home-hero">
        <div class="home-hero-text">
          <p class="home-kicker">{v.t("人間にもAIにも使いやすい日程調整ツール")}</p>
          <h1 class="home-h1">{v.t("登録不要でかんたん日程調整")}</h1>
          <p class="home-lead">{v.t("日時の候補を選んでURLを送るだけ。都合の良い日時がひと目で分かります。APIやMCPを通じてAIエージェントによる作成・回答も可能です。")}</p>
          {open ? (
            <a class="btn-cta home-cta" href="/new" data-testid="home-cta"><span class="arrow" aria-hidden="true">➜</span><span>{v.t("日程をえらぶ")}</span></a>
          ) : (
            <p class="home-closed" data-testid="home-closed">{v.t("このサイトでは、管理者だけが日程調整を作成できます。回答ページのURLを受け取った方は、そのURLを開いてください。")}</p>
          )}
        </div>
        <SampleTable v={v} />
      </section>

      <section class="home-steps">
        <div class="home-step"><span class="home-no">1</span><h2>{v.t("候補をえらんでURLを送る")}</h2>
          <p>{v.t("カレンダーで日付を、タイムラインで時間をなぞるだけ。できたURLをメールやチャットで送ります。")}</p></div>
        <div class="home-step"><span class="home-no">2</span><h2>{v.t("登録不要で回答")}</h2>
          <p>{v.t("URLを開いて、名前と都合を入れるだけ。あとから自分の予定を直すこともできます。")}</p></div>
        <div class="home-step"><span class="home-no">3</span><h2>{v.t("重なる時間がひと目で分かる")}</h2>
          <p>{v.t("みんなの予定を時間ごとに重ねて表示。サーバーが集計して、都合のよい時間をおすすめします。")}</p></div>
      </section>

      <section class="home-ai card">
        <h2><span class="home-ai-badge">AI</span>{v.t("AIエージェントにもそのまま使える")}</h2>
        <div class="home-ai-grid">
          <div>
            <h3>{v.t("主催者のAIに")}</h3>
            <p>{v.t("「来週の平日午後で1時間の打合せの日程調整を作って、URLをちょうだい」と頼むだけ。AIは候補の時間帯を渡し、サーバーが候補に分けて検証・作成します。時差や夏時間の計算もサーバーが行います。")}</p>
          </div>
          <div>
            <h3>{v.t("参加者のAIに")}</h3>
            <p>{v.t("届いたURLをAIに渡して「私の予定で答えておいて」。回答ページはAIが読める形（Markdown・JSON）でも提供され、本人の名前で回答し、あとから修正もできます。")}</p>
          </div>
          <div>
            <h3>{v.t("集計と確定はサーバーで")}</h3>
            <p>{v.t("○△×の集計とおすすめの順位はサーバーが決定的に計算します。確定した日時は参加者のページにも表示されます。")}</p>
          </div>
        </div>
        <div class="home-ai-links">
          <div><b>MCP</b> <CopyBox v={v} id="mcp-url" value={mcpUrl} label="MCP URL" testid="home-mcp-url" /></div>
          <div><b>{v.t("AI向けの説明書")}</b> <CopyBox v={v} id="llms-url" value={llmsUrl} label="llms.txt" /></div>
          <p class="muted">{v.t("Claude・ChatGPTなどのカスタムコネクタにMCPのURLを登録するか、説明書のURLをAIに読ませてください。")} <a href="/docs">{v.t("詳しい使い方")} ›</a></p>
        </div>
      </section>

      <section class="home-recent hidden" id="home-recent">
        <h2>{v.t("この端末で開いた日程調整")}</h2>
        <ul id="home-recent-list"></ul>
        <p class="muted small">{v.t("この一覧はこのブラウザの中だけに保存されています。")} <button type="button" class="btn-linklike small" id="home-recent-clear">{v.t("一覧を消す")}</button></p>
      </section>
    </Layout>
  );
}

function OperatorLine({ v, s }: { v: View; s: Settings }) {
  return (
    <p>{v.t("運営者")}: {s.operator_name || v.t("（未設定）")}{s.contact && <> ・ {v.t("連絡先")}: {/^https?:\/\//.test(s.contact) ? <a href={s.contact} rel="noopener">{s.contact}</a> : s.contact}</>}</p>
  );
}

export function AboutPage({ v, meta, settings }: { v: View; meta: Meta; settings: Settings }) {
  return (
    <Layout v={v} title={`${v.t("このサイトについて")}｜Time of EVE`} meta={meta} indexable>
      <div class="card prose">
        <h1>{v.t("このサイトについて")}</h1>
        <p>{v.t("Time of EVE は、人間にもAIにも使いやすいことを目指したオープンソースの日程調整ツールです。Cloudflare Workers と D1 の上で動いています。")}</p>
        <OperatorLine v={v} s={settings} />
        <h2>{v.t("謝辞")}</h2>
        <p>{v.t("画面の構成や操作感は、2026年10月に終了した日程調整サービス「トントン」（株式会社アマネク）と、その後継の「Nextonton」に強く影響を受けています。本サイトはそれらの運営者とは関係のない非公式のプロジェクトです。")}</p>
        <h2>{v.t("ソースコード")}</h2>
        <p><a href="https://github.com/haborite/time-of-eve" rel="noopener">github.com/haborite/time-of-eve</a>（MIT License）</p>
      </div>
    </Layout>
  );
}

export function TermsPage({ v, meta, settings }: { v: View; meta: Meta; settings: Settings }) {
  const items = [
    "本サービスは日程調整のための候補日時の共有と回答の集計を提供します。",
    "回答ページはURLを知っている人なら誰でも閲覧・回答できます。個人情報や秘密情報を書き込まないでください。",
    "管理用URL・編集用リンクは、知っている人が日程調整や回答を変更できる鍵です。第三者に渡さないでください。",
    "法令や公序良俗に反する内容、他人の権利を侵害する内容、スパムや宣伝目的での利用を禁止します。運営者は予告なくこれらを非公開・削除できます。",
    "ログインなしで作成された日程調整は、管理画面で設定された保持期間を過ぎると自動的に削除されます。",
    "AIエージェント・プログラムからの利用（API・MCP）も、人間の利用と同じ規約に従います。本人の依頼なく他人になりすまして回答しないでください。",
    "本サービスは現状のまま提供され、運営者はデータの消失、サービスの中断、利用によって生じた損害について責任を負いません。",
    "本規約は予告なく変更されることがあります。変更後に利用した場合は変更に同意したものとみなします。",
  ];
  return (
    <Layout v={v} title={`${v.t("利用規約")}｜Time of EVE`} meta={meta} indexable>
      <div class="card prose">
        <h1>{v.t("利用規約")}</h1>
        <ol>{items.map((x) => <li>{v.t(x)}</li>)}</ol>
        <OperatorLine v={v} s={settings} />
      </div>
    </Layout>
  );
}

export function PrivacyPage({ v, meta, settings }: { v: View; meta: Meta; settings: Settings }) {
  const items: [string, string][] = [
    ["保存する情報", "日程調整の内容（タイトル・説明・候補日時）、回答者が入力した名前・回答・コメント、主催者が入力した参加予定者の名前とメールアドレス（任意）、操作履歴。"],
    ["表示範囲", "回答ページにはタイトル・説明・候補と集計、主催者が「回答者名を公開」にした場合は各回答者の名前・回答・コメントが表示されます。メールアドレスや作成根拠メモは表示されません。"],
    ["ブラウザに保存する情報", "言語設定のCookie、管理者のログインセッションのCookie、回答の編集用リンクと最近開いた日程調整の一覧（このブラウザのローカルストレージ。サーバーには送られません）。"],
    ["アクセスの記録", "不正利用の防止のため、Cloudflare がIPアドレスなどのアクセス情報を処理します。回数制限やボット確認（Cloudflare Turnstile）に使われます。"],
    ["第三者への提供", "法令に基づく場合を除き、保存した情報を第三者に提供しません。共有用の画像の文字の描画のため、表示する文字だけを Google Fonts から取得します。"],
    ["削除", "主催者は管理用URLから日程調整を削除できます。ログインなしで作成された日程調整は保持期間の経過後に自動で削除されます。"],
  ];
  return (
    <Layout v={v} title={`${v.t("プライバシーポリシー")}｜Time of EVE`} meta={meta} indexable>
      <div class="card prose">
        <h1>{v.t("プライバシーポリシー")}</h1>
        {items.map(([h, b]) => <><h2>{v.t(h)}</h2><p>{v.t(b)}</p></>)}
        {settings.retention_days > 0 && <p class="muted">{v.t("現在の保持期間: 最後の候補日から {n} 日", { n: settings.retention_days })}</p>}
        <OperatorLine v={v} s={settings} />
      </div>
    </Layout>
  );
}

export function DocsPage({ v, meta, doc, llmsUrl, mcpUrl, open }: { v: View; meta: Meta; doc: string; llmsUrl: string; mcpUrl: string; open: boolean }) {
  return (
    <Layout v={v} title={`${v.t("AI・API連携")}｜Time of EVE`} meta={meta} indexable scripts={["admin.js"]}>
      <div class="card">
        <h1>{v.t("AI・API連携")}</h1>
        <p>{v.t("ChatGPT・ClaudeなどのAIに、日程調整の作成・回答・確定までを任せるための説明です。")}</p>
        <h3>{v.t("1. MCPサーバーとして接続する（おすすめ）")}</h3>
        <CopyBox v={v} id="mcp-url" value={mcpUrl} label="MCP URL" testid="docs-mcp-url" />
        <p class="muted">{open
          ? v.t("このサイトはログインなしで作成できる設定です。トークンなしで接続すれば、作成・回答・確定まで使えます（作成時に返る管理用URLが主催者の鍵になります）。")
          : v.t("このサイトは管理者だけが作成できる設定です。参加者としての回答はトークンなしで使えます。作成するには管理者のAPIトークン、またはOAuth（カスタムコネクタの認証）で接続してください。")}</p>
        <h3>{v.t("2. 説明書をAIに読ませる")}</h3>
        <CopyBox v={v} id="llms-url" value={llmsUrl} label="llms.txt" testid="llms-url" />
        <p class="muted">Markdown: <a href="/llms.txt">llms.txt</a> · OpenAPI 3.1: <a href="/openapi.json">openapi.json</a> · JSON Schema: <a href="/schema/poll.json">poll.json</a></p>
      </div>
      <div class="card">
        <pre class="doc-md" data-testid="llm-doc">{doc}</pre>
      </div>
    </Layout>
  );
}

export function ErrorPage({ v, meta, status, message, code }: { v: View; meta: Meta; status: number; message: string; code: string }) {
  return (
    <Layout v={v} title={`${v.t("エラー")}｜Time of EVE`} meta={meta}>
      <div class="card hero">
        <h1>{message}</h1>
        <p class="muted">{v.t("エラーコード")}: <code>{code}</code> ({status})</p>
        <p><a href="/">{v.t("トップへ")}</a></p>
      </div>
    </Layout>
  );
}

export function OAuthConsentPage({ v, meta, clientName, redirectHost, username, csrf, state, scopes, error }: {
  v: View; meta: Meta; clientName: string; redirectHost: string; username: string | null; csrf: string; state: string; scopes: string[]; error?: string | null;
}) {
  return (
    <Layout v={v} title={`${v.t("アクセスの許可")}｜Time of EVE`} meta={meta} nav="none">
      <div class="card" style="max-width:520px;margin:24px auto">
        <h2>{v.t("アクセスの許可")}</h2>
        {error && <Alert kind="err">{error}</Alert>}
        <p>{raw("")}<b>{clientName}</b> {v.t("（{host}）が、管理者として Time of EVE を操作する許可を求めています。", { host: redirectHost })}</p>
        <ul class="muted">{scopes.map((s) => <li>{s}</li>)}</ul>
        <form method="post" action="/oauth/authorize">
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="csrf" value={csrf} />
          {username ? (
            <p>{v.t("{name} としてログイン中", { name: username })}</p>
          ) : (
            <>
              <label class="f" for="username">{v.t("ユーザー名")}</label>
              <input id="username" name="username" type="text" autocomplete="username" required />
              <label class="f" for="password">{v.t("パスワード")}</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required />
            </>
          )}
          <div class="spacer"></div>
          <div class="row">
            <button class="btn btn-primary btn-lg" name="decision" value="allow" data-testid="oauth-allow">{v.t("許可する")}</button>
            <button class="btn btn-lg" name="decision" value="deny">{v.t("拒否する")}</button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
