/** @jsxImportSource hono/jsx */
/**
 * Poll creation: /new (pick dates and times, static/new.js) → /new/confirm (preview, bot check, create).
 * /new/import accepts pasted JSON (what an AI agent produced). Administrators skip the bot check.
 */
import type { RenderedIssue } from "../domain/errors";
import type { Meta } from "../og/card";
import { Alert, Layout, type View } from "./layout";

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240];
const COMMON_TZ = ["Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Singapore", "Asia/Kolkata", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Australia/Sydney", "Pacific/Auckland", "UTC"];

export function NewPage({ v, meta, maxCandidates, defaultTz, durLabel }: { v: View; meta: Meta; maxCandidates: number; defaultTz: string; durLabel: (m: number) => string }) {
  const tzs = COMMON_TZ.includes(defaultTz) ? COMMON_TZ : [defaultTz, ...COMMON_TZ];
  return (
    <Layout v={v} title={`${v.t("日程をえらぶ")}｜time-of-eve`} meta={meta} bodyClass="newp" scripts={["new.js"]}>
      <div class="page-head">
        <h1 class="page-ttl">{v.t("日程をえらぶ")}</h1>
        <p>{v.t("3つのステップで候補日時をつくります。最後に確認画面で内容を確かめてから作成・公開します。")}</p>
      </div>
      <div class="steps12">
        <section class="step" aria-labelledby="step1-h">
          <h2 class="step-h" id="step1-h"><span class="step-no">STEP<b>1</b></span><span class="step-arrow" aria-hidden="true"></span><span>{v.t("基本情報を入力")}</span></h2>
          <div class="step-b">
            <div class="frow"><label for="title" class="flabel">{v.t("タイトル")}<span class="need">{v.t("必須")}</span></label>
              <div class="ffield"><input type="text" id="title" maxlength={200} placeholder={v.t("例: 研究打合せ")} required data-testid="new-title" /></div></div>
            <div class="frow"><label for="duration" class="flabel">{v.t("予定時間")}</label>
              <div class="ffield"><select id="duration" class="w-auto" data-testid="new-duration">
                {DURATIONS.map((m) => <option value={String(m)} selected={m === 60}>{durLabel(m)}</option>)}
              </select>
                <span class="fhint">{v.t("1つの候補の長さです。STEP 3 で選んだ時間帯をこの長さで区切って候補にします。")}</span></div></div>
            <div class="frow"><label for="desc" class="flabel">{v.t("補足・備考")}</label>
              <div class="ffield"><textarea id="desc" rows={3} maxlength={2000} placeholder={v.t("開催形式・場所など")}></textarea></div></div>
            <div class="frow"><span class="flabel">{v.t("利用マーク")}</span>
              <div class="ffield marks-use">
                <span><span class="mk mk-yes">○</span>{v.t("参加/可")}</span>
                <label><input type="checkbox" id="allow-maybe" checked /> <span class="mk mk-maybe">△</span>{v.t("未定")}</label>
                <span><span class="mk mk-no">×</span>{v.t("不参加/不可")}</span>
                <span class="fhint">{v.t("回答する人が使えるマークです。△を使わない場合はチェックを外してください。")}</span>
              </div></div>
            <div class="frow"><label for="deadline" class="flabel">{v.t("回答期限")}<span class="opt">{v.t("任意")}</span></label>
              <div class="ffield"><input type="datetime-local" id="deadline" class="w-auto" /></div></div>
            <details class="more">
              <summary>{v.t("その他の設定")}</summary>
              <div class="frow"><label for="people" class="flabel">{v.t("参加予定者")}<span class="opt">{v.t("任意")}</span></label>
                <div class="ffield"><textarea id="people" rows={4} placeholder={v.t("*代表者\nメンバーA\nメンバーB")}></textarea>
                  <span class="fhint">{v.t("1行に1名。先頭に * を付けると必須の参加者になります。")}</span></div></div>
              <div class="frow"><span class="flabel">{v.t("回答者名")}</span>
                <div class="ffield"><label><input type="checkbox" id="show-names" checked /> {v.t("回答者名を回答ページに表示する")}</label></div></div>
              <div class="frow"><label for="split" class="flabel">{v.t("候補の区切り方")}</label>
                <div class="ffield"><select id="split" class="w-auto">
                  <option value="fit" selected>{v.t("予定時間ごとに区切る（重ならない）")}</option>
                  <option value="slide">{v.t("30分ずつずらす（重なりあり）")}</option>
                  <option value="block">{v.t("区切らない（選んだ時間帯をそのまま1候補）")}</option>
                </select></div></div>
              <div class="frow"><label for="tz" class="flabel">{v.t("タイムゾーン")}</label>
                <div class="ffield"><select id="tz" class="w-auto" data-default={defaultTz}>
                  {tzs.map((z) => <option value={z} selected={z === defaultTz}>{z}</option>)}
                </select></div></div>
            </details>
          </div>
        </section>
        <section class="step" aria-labelledby="step2-h">
          <h2 class="step-h" id="step2-h"><span class="step-no">STEP<b>2</b></span><span class="step-arrow" aria-hidden="true"></span><span>{v.t("日付を選択")}</span></h2>
          <div class="step-b">
            <p class="howto">{v.t("日付をタップするか、なぞると複数の日付をまとめて選べます。選んだ日付をもう一度タップすると外れます。")}</p>
            <div class="cal-nav">
              <button type="button" class="btn btn-sm" id="cal-prev" aria-label={v.t("前の月")}>‹ {v.t("前の月")}</button>
              <span id="date-count" class="muted" aria-live="polite"></span>
              <button type="button" class="btn btn-sm" id="cal-next" aria-label={v.t("次の月")}>{v.t("次の月")} ›</button>
            </div>
            <div class="cal-months" id="cal-months" data-testid="new-calendar"></div>
          </div>
        </section>
      </div>
      <section class="step" aria-labelledby="step3-h">
        <h2 class="step-h" id="step3-h"><span class="step-no">STEP<b>3</b></span><span class="step-arrow" aria-hidden="true"></span><span>{v.t("時間を選択")}</span></h2>
        <div class="step-b">
          <p class="howto">{v.t("タイムラインの白いところをタップするか、なぞると候補の時間になります（タップ1回で予定時間ぶん）。選んだところをもう一度タップするか、なぞると外れます。")}</p>
          <div class="bulk-row">
            <select id="bulk-from" class="w-auto" aria-label={v.t("開始時刻")}></select>
            <span>{v.t("〜")}</span>
            <select id="bulk-to" class="w-auto" aria-label={v.t("終了時刻")}></select>
            <span>{v.t("まで")}</span>
            <button type="button" class="btn btn-blue btn-sm" id="bulk-set" data-testid="bulk-set">{v.t("一括設定する")}</button>
            <button type="button" class="btn btn-sm" id="reset-all">{v.t("全てリセット")}</button>
          </div>
          <p class="fhint" style="margin:4px 0 0">{v.t("「一括設定する」を押すと、選んだすべての日付に同じ時間を設定します。あとから追加した日付にも同じ時間が入ります。")}</p>
          <div class="view-range">{v.t("表示する時間")}:{" "}
            <select id="view-from" class="w-auto" aria-label={v.t("表示開始")}></select> {v.t("〜")} <select id="view-to" class="w-auto" aria-label={v.t("表示終了")}></select></div>
          <p class="only-narrow hint">{v.t("スマホでは、マスを押しながら滑らせると続けて選べます。画面を動かすときは、左の時刻の列をなぞってください。")}</p>
          <div id="time-grid" data-testid="time-grid"></div>
        </div>
      </section>
      <div class="new-bar" id="new-bar">
        <div class="new-bar-in">
          <details class="cand-sum" id="cand-sum">
            <summary><span>{v.t("候補日時")}</span> <b id="count" data-testid="new-count">0</b><span class="muted" id="count-unit">{v.t("件")}</span> <span id="frag-note" class="frag-note"></span></summary>
            <div class="chips" id="preview"></div>
          </details>
          <form method="post" action="/new/confirm" id="new-form" data-max={String(maxCandidates)}>
            {v.admin && <input type="hidden" name="csrf" value={v.admin.csrf} />}
            <input type="hidden" name="action" value="validate" />
            <input type="hidden" name="from_new" value="1" />
            <input type="hidden" name="json_text" id="json-out" />
            <a class="btn" href={v.admin ? "/admin" : "/"}>{v.t("戻る")}</a>
            <button class="btn-cta btn-cta-sm" data-testid="new-submit"><span class="arrow" aria-hidden="true">➜</span><span>{v.t("確認画面へ")}</span></button>
          </form>
        </div>
        <div id="new-error" class="alert alert-err hidden" role="alert"></div>
      </div>
    </Layout>
  );
}

export interface PreviewData {
  valid: boolean;
  errors: RenderedIssue[];
  warnings: RenderedIssue[];
  preview?: {
    title: string; timezone: string; response_deadline: string | null; candidate_count: number;
    candidates: { start: string; end: string }[]; participants: { display_name: string; required: boolean }[];
  };
}

export function ConfirmPage(props: {
  v: View; meta: Meta; raw: string; fromNew: boolean; result?: PreviewData | null; parseError?: string | null;
  turnstileSiteKey?: string | null; templates?: { id: number; name: string }[]; sample: string;
}) {
  const { v, result } = props;
  const errs = result?.errors ?? [];
  return (
    <Layout v={v} title={`${v.t("JSON取込")}｜time-of-eve`} meta={props.meta} scripts={["admin.js"]}>
      <div class="card">
        <h2>{props.fromNew ? v.t("内容の確認") : v.t("JSONを貼り付けて作成")}</h2>
        {props.fromNew ? (
          <p class="muted">{v.t("「日程をえらぶ」で作った内容です。プレビューを確認して「作成して公開」を押してください。")}{" "}
            <a href="/new#restore" data-testid="back-to-new">{v.t("← 日程の選択に戻る")}</a></p>
        ) : (
          <p class="muted">{v.t("AIが作ったJSONを貼り付けて「検証」→ プレビューを確認 →「作成して公開」。.json ファイルのドラッグ＆ドロップも可。書式は「AI・API連携」のページを参照してください。")}</p>
        )}
        {props.templates && props.templates.length > 0 && (
          <div class="row" style="margin-bottom:8px">
            <span class="muted">{v.t("テンプレートから開始:")}</span>
            {props.templates.map((t) => <a class="btn btn-sm" href={`/new/import?template=${t.id}`}>{t.name}</a>)}
          </div>
        )}
        {props.parseError && <Alert kind="err" testid="import-errors">{props.parseError}</Alert>}
        {errs.length > 0 && (
          <Alert kind="err" testid="import-errors">
            <strong>{v.t("エラー（{n}件）— 修正して再度「検証」してください", { n: errs.length })}</strong>
            <ul>{errs.map((e) => <li><code>{e.code}</code>{e.field && <> <code>{e.field}</code></>} {e.message}{e.hint && <span class="muted"> — {e.hint}</span>}</li>)}</ul>
          </Alert>
        )}
        {result && result.warnings.length > 0 && (
          <Alert kind="warn" testid="import-warnings">
            <strong>{v.t("注意（{n}件）", { n: result.warnings.length })}</strong>
            <ul>{result.warnings.map((e) => <li><code>{e.code}</code>{e.field && <> <code>{e.field}</code></>} {e.message}</li>)}</ul>
          </Alert>
        )}
        <form method="post" action="/new/confirm" id="import-form">
          {v.admin && <input type="hidden" name="csrf" value={v.admin.csrf} />}
          {props.fromNew && <input type="hidden" name="from_new" value="1" />}
          <details open={!props.fromNew}>
            <summary class="f" style="cursor:pointer">JSON</summary>
            <textarea id="json_text" name="json_text" class="json" spellcheck={false} placeholder={props.sample} data-testid="import-json" aria-label={v.t("JSON貼付欄")}>{props.raw}</textarea>
          </details>
          <div class="spacer"></div>
          {result?.valid && result.preview && (
            <div class="card" style="background:#fffafb;border-color:#ffd0d8" data-testid="import-preview">
              <h3 style="margin-top:0">{v.t("プレビュー")}</h3>
              <dl class="kv">
                <dt>{v.t("タイトル")}</dt><dd><strong>{result.preview.title}</strong></dd>
                <dt>{v.t("タイムゾーン")}</dt><dd>{result.preview.timezone}</dd>
                <dt>{v.t("回答期限")}</dt><dd>{result.preview.response_deadline ?? v.t("なし")}</dd>
                <dt>{v.t("候補数")}</dt><dd data-testid="preview-candidate-count">{result.preview.candidate_count}</dd>
                <dt>{v.t("参加予定者")}</dt>
                <dd>{result.preview.participants.length ? result.preview.participants.map((p, i, a) => <>{p.display_name}{p.required && <span class="req">({v.t("必須")})</span>}{i < a.length - 1 ? v.t("、") : ""}</>) : v.t("なし（自由記入のみ）")}</dd>
              </dl>
              <div class="spacer"></div>
              <div class="matrix-wrap"><table class="matrix"><thead><tr><th>#</th><th class="dt">{v.t("候補日時")}</th></tr></thead><tbody>
                {result.preview.candidates.map((c, i) => (
                  <tr><td class="muted">{i + 1}</td><td class="dt"><span class="d">{c.start.slice(0, 10)}</span> <span class="t">{c.start.slice(11, 16)}–{c.end.slice(0, 10) === c.start.slice(0, 10) ? c.end.slice(11, 16) : c.end.slice(0, 16).replace("T", " ")}</span></td></tr>
                ))}
              </tbody></table></div>
              <div class="spacer"></div>
              <label class="row" style="font-weight:700"><input type="checkbox" name="confirm_publish" value="1" data-testid="confirm-publish" /> {v.t("内容を確認しました（公開時に必須）")}</label>
              {props.turnstileSiteKey && (
                <>
                  <div class="spacer"></div>
                  <div class="cf-turnstile" data-sitekey={props.turnstileSiteKey} data-language={v.lang}></div>
                  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
                </>
              )}
            </div>
          )}
          <div class="row">
            <button class="btn btn-blue btn-lg" name="action" value="validate" data-testid="validate-btn">{v.t("検証")}</button>
            {result?.valid && (
              <>
                <button class="btn btn-lg" name="action" value="create" data-testid="create-draft-btn">{v.t("下書き作成")}</button>
                <button class="btn btn-primary btn-lg" name="action" value="publish" data-testid="publish-btn">{v.t("作成して公開")}</button>
              </>
            )}
            <span class="grow"></span>
            {!props.fromNew && <button class="btn btn-sm" type="button" id="fill-sample">{v.t("サンプルを入れる")}</button>}
          </div>
        </form>
        <template id="sample-json">{props.sample}</template>
      </div>
    </Layout>
  );
}
