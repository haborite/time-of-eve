/** @jsxImportSource hono/jsx */
/**
 * Organizer page for one poll. Same page for
 *   /m/<poll_id>/<manage_token>  (organizer without account; the URL itself is the key)
 *   /admin/polls/<poll_id>       (administrator, session + CSRF)
 */
import type { Child } from "hono/jsx";
import { activeCandidates, cKey, effectiveStatus, findCandidate, type PollAggregate } from "../domain/model";
import { fmtDateTime, fmtRange, resultsView } from "../domain/views";
import { fmtDate } from "../lib/i18n";
import { hhmm, toLocal } from "../lib/time";
import { STATUS_LABEL_JA, type Meta } from "../og/card";
import { Alert, CopyBox, Layout, type View } from "./layout";

export interface ManageProps {
  v: View;
  agg: PollAggregate;
  meta: Meta;
  /** base path for forms: "/m/<id>/<token>" or "/admin/polls/<id>" */
  basePath: string;
  publicUrl: string;
  manageUrl: string;
  isAdmin: boolean;
  csrf?: string;
  flash?: string | null;
  error?: string | null;
  reissued?: { name: string; url: string } | null;
  audits: { createdAt: number; action: string; actor: string }[];
  justCreated?: boolean;
}

export function ManagePage(props: ManageProps) {
  const { v, agg, basePath, csrf } = props;
  const poll = agg.poll;
  const status = effectiveStatus(poll);
  const res = resultsView(agg, "full") as ReturnType<typeof resultsView> & {
    participants: { id: string; display_name: string; required: boolean; preregistered: boolean; responded: boolean; comment: string | null; answers: Record<string, string> }[];
    candidates: { id: string; yes: number; maybe: number; no: number; unanswered: number }[];
    best_candidate_ids: string[]; responded: number; expected: number | null; pending: number | null;
  };
  const rows = new Map(res.candidates.map((c) => [c.id, c]));
  const roster = res.participants;
  const sym: Record<string, string> = { yes: "○", maybe: "△", no: "×" };
  const cands = activeCandidates(agg);
  const finNo = poll.finalizedCandidateNo;
  const canFinalize = poll.status === "open" || poll.status === "closed";
  const canRemove = poll.status !== "cancelled";
  const hidden = (name: string, value: string | number) => <input type="hidden" name={name} value={String(value)} />;
  const common = () => <>{csrf && hidden("csrf", csrf)}{hidden("version", poll.version)}</>;
  const Act = (p: { name: string; label: string; cls?: string; confirm?: string; extra?: Record<string, string> }) => (
    <form method="post" action={`${basePath}/action`} class="inline">
      {common()}{hidden("action", p.name)}
      {Object.entries(p.extra ?? {}).map(([k, val]) => hidden(k, val))}
      <button class={`btn ${p.cls ?? ""}`} data-testid={`act-${p.name}${p.extra?.candidate_id ? `-${p.extra.candidate_id}` : ""}${p.extra?.participant_id ? `-${p.extra.participant_id}` : ""}`} data-confirm={p.confirm}>{p.label}</button>
    </form>
  );
  const Card = (p: { title?: string; children: Child }) => <div class="card">{p.title && <h2>{p.title}</h2>}{p.children}</div>;
  const local = (ms: number) => toLocal(ms, poll.timezone);
  const deadlineValue = poll.responseDeadline != null ? (() => {
    const l = local(poll.responseDeadline);
    return `${l.year}-${String(l.month).padStart(2, "0")}-${String(l.day).padStart(2, "0")}T${hhmm(l)}`;
  })() : "";
  const fin = finNo != null ? findCandidate(agg, cKey(finNo)) : undefined;

  return (
    <Layout v={v} title={`${poll.title}｜time-of-eve`} meta={props.meta} scripts={["admin.js"]}>
      {props.flash && <Alert kind="ok" testid="flash">{props.flash}</Alert>}
      {props.error && <Alert kind="err" testid="action-error">{props.error}</Alert>}
      {props.reissued && (
        <Alert kind="warn">
          {v.t("{name} さんの新しい編集リンク（この画面でのみ表示）:", { name: props.reissued.name })}
          <CopyBox v={v} id="reissued" value={props.reissued.url} label={v.t("編集用リンク")} />
        </Alert>
      )}
      {!props.isAdmin && (
        <div class={`card manage-key${props.justCreated ? " just" : ""}`} data-testid="manage-key">
          <h2>{v.t("管理用URL（主催者だけが使うURL）")}</h2>
          <p class="muted">{v.t("このURLを知っている人は、この日程調整を編集・確定・削除できます。ブックマークするか、安全な場所に保存してください。参加者には送らないでください。")}</p>
          <CopyBox v={v} id="manage-url" value={props.manageUrl} label={v.t("管理用URL")} testid="manage-url" />
        </div>
      )}
      {poll.hidden && <Alert kind="warn" testid="hidden-note">{v.t("この日程調整は管理者により非公開にされています。回答ページは表示されません。")}</Alert>}

      <div class="card">
        <div class="row">
          <span class={`chip chip-${status}`} data-testid="poll-status" data-status={status}>{v.t(STATUS_LABEL_JA[status])}</span>
          <span class="muted">ID: {poll.id} ・ v{poll.version}</span>
        </div>
        <h1 style="margin-top:6px">{poll.title}</h1>
        {poll.description && <p class="pre" style="margin:4px 0">{poll.description}</p>}
        <dl class="kv" style="margin-top:8px">
          <dt>{v.t("タイムゾーン")}</dt><dd>{poll.timezone}</dd>
          <dt>{v.t("回答期限")}</dt><dd>{fmtDateTime(agg, poll.responseDeadline, v.lang) || v.t("なし")}</dd>
          <dt>{v.t("回答者名")}</dt><dd>{poll.showParticipantNames ? v.t("公開") : v.t("非公開（集計のみ表示）")}</dd>
          <dt>{v.t("回答")}</dt>
          <dd>{v.t("{n} 名", { n: res.responded })}{res.expected != null && <> / {v.t("予定 {n} 名（未回答 {m} 名）", { n: res.expected, m: res.pending ?? 0 })}</>}</dd>
        </dl>
        {poll.status !== "draft" ? (
          <>
            <h3>{v.t("公開URL（回答者に送るURL）")}</h3>
            <div class="urlbox">
              <input type="text" readonly value={props.publicUrl} id="public-url" data-testid="public-url" aria-label={v.t("公開URL")} />
              <button class="btn btn-primary" type="button" data-copy="#public-url" data-testid="copy-public-url">{v.t("URLをコピー")}</button>
            </div>
            <p class="muted" style="margin:4px 0 0"><a href={props.publicUrl} target="_blank" rel="noopener">{v.t("回答ページを開く")} ↗</a></p>
          </>
        ) : <Alert kind="info">{v.t("下書きです。公開すると回答用URLが発行されます。")}</Alert>}
        <div class="row" style="margin-top:14px">
          {poll.status === "draft" && <Act name="publish" label={v.t("公開する")} cls="btn-primary btn-lg" confirm={v.t("この内容で公開します。よろしいですか？")} />}
          {status === "open" && <Act name="close" label={v.t("回答を締め切る")} confirm={v.t("回答受付を終了しますか？")} />}
          {status === "closed" && <Act name="reopen" label={v.t("回答受付を再開")} confirm={v.t("回答受付を再開しますか？（過去の期限は解除されます）")} />}
          {poll.status === "finalized" && <Act name="unfinalize" label={v.t("確定を取り消す")} confirm={v.t("確定を取り消して締切状態に戻しますか？")} />}
          {poll.status !== "cancelled" && <Act name="cancel" label={v.t("中止する")} cls="btn-danger" confirm={v.t("この日程調整を中止しますか？回答ページに中止と表示されます。")} />}
        </div>
      </div>

      {fin && (
        <div class="finalbox" data-testid="finalized">{v.t("確定日時")}: <strong>{fmtRange(agg, fin, v.lang)}</strong></div>
      )}

      <div class="card">
        <div class="row">
          <h2 class="grow" style="margin:0">{v.t("出欠表")}</h2>
          <a class="btn btn-sm" href={`${basePath}/export.csv`} data-testid="export-csv">CSV</a>
        </div>
        <p class="muted" style="margin:6px 0 10px">{v.t("★おすすめ = 必須参加者が全員○の候補のうち、○が最多・×が最少（△は○と同一視しません）。確定前に主催者の予定を再確認してください。")}</p>
        {["finalize", "remove_candidate"].map((name) => (
          <form method="post" action={`${basePath}/action`} id={name === "finalize" ? "f-finalize" : "f-remove"} class="hidden">
            {common()}{hidden("action", name)}
          </form>
        ))}
        <div class="matrix-wrap">
          <table class="matrix" data-testid="result-matrix">
            <thead>
              <tr>
                <th class="dt">{v.t("候補日時")}</th><th>○</th><th>△</th><th>×</th><th>{v.t("未")}</th>
                {roster.map((p) => <th title={p.display_name}>{[...p.display_name].length > 8 ? [...p.display_name].slice(0, 7).join("") + "…" : p.display_name}{p.required && <><br /><span class="req">{v.t("必須")}</span></>}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cands.map((c) => {
                const k = cKey(c.no), row = rows.get(k)!;
                const isFin = c.no === finNo, isBest = res.best_candidate_ids.includes(k);
                const s = local(c.startAt), e = local(c.endAt);
                return (
                  <tr class={isFin ? "fixed" : isBest ? "best" : ""}>
                    <td class="dt">
                      <span class="d">{fmtDate(v.lang, s)}</span> <span class="t">{hhmm(s)}–{hhmm(e)}</span> <span class="muted">{k}</span>
                      {isFin ? <span class="badge-fixed">{v.t("確定")}</span> : isBest ? <span class="badge-best">★</span> : null}
                    </td>
                    <td class="n y">{row.yes}</td><td class="n m">{row.maybe}</td><td class="n x">{row.no}</td><td class="n muted">{row.unanswered}</td>
                    {roster.map((p) => {
                      const a = p.answers[k];
                      return <td>{a ? <i class={`sym sym-${a}`}>{sym[a]}</i> : <i class="sym sym-none">−</i>}</td>;
                    })}
                    <td style="text-align:right;white-space:nowrap">
                      {canFinalize && <button class="btn btn-sm btn-primary" form="f-finalize" name="candidate_id" value={k} data-testid={`act-finalize-${k}`} data-confirm={`${v.t("この候補で確定しますか？")}\n${fmtRange(agg, c, v.lang)}`}>{v.t("確定")}</button>}
                      {canRemove && !isFin && <button class="btn btn-sm btn-danger" form="f-remove" name="candidate_id" value={k} data-testid={`act-remove_candidate-${k}`} data-confirm={v.t("この候補を削除しますか？（回答データは履歴として保持されます）")}>{v.t("削除")}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {roster.some((p) => p.comment) && (
          <div class="comments"><strong>{v.t("コメント")}</strong>{roster.filter((p) => p.comment).map((p) => <div><strong>{p.display_name}</strong>: {p.comment}</div>)}</div>
        )}
        {(res.pending ?? 0) > 0 && (
          <p style="margin-bottom:0"><strong>{v.t("未回答")}:</strong>{" "}
            {roster.filter((p) => p.preregistered && !p.responded).map((p, i, arr) => <>{p.display_name}{p.required && <span class="req">({v.t("必須")})</span>}{i < arr.length - 1 ? v.t("、") : ""}</>)}
          </p>
        )}
      </div>

      <div class="card">
        <div class="row">
          <h2 class="grow" style="margin:0">{v.t("結果JSON（summary）")}</h2>
          <button class="btn btn-sm btn-blue" type="button" data-copy="#summary-json" data-testid="copy-summary-json">{v.t("結果JSONをコピー")}</button>
        </div>
        <div class="spacer"></div>
        <textarea id="summary-json" class="json" style="min-height:120px" readonly data-testid="summary-json">{JSON.stringify(resultsView(agg, "summary"))}</textarea>
      </div>

      <div class="grid2">
        <Card title={v.t("候補を追加")}>
          <p class="muted">{v.t("既存の回答は保持され、新しい候補は全員「未回答」になります。")}</p>
          <form method="post" action={`${basePath}/action`}>
            {common()}{hidden("action", "add_candidate")}
            <label class="f">{v.t("日付")}</label><input type="date" name="start_date" required />
            <div class="row">
              <div class="grow"><label class="f">{v.t("開始")}</label><input type="time" name="start_time" required step={300} /></div>
              <div class="grow"><label class="f">{v.t("終了（空欄: {n}分）", { n: poll.durationMinutes ?? 60 })}</label><input type="time" name="end_time" step={300} /></div>
            </div>
            <div class="spacer"></div><button class="btn btn-primary" data-testid="add-candidate-btn">{v.t("追加")}</button>
          </form>
        </Card>
        <Card title={v.t("参加予定者")}>
          <table class="list">
            {roster.length ? roster.map((p) => (
              <tr>
                <td>{p.display_name} <span class="muted">{p.id}</span>{p.required && <> <span class="req">{v.t("必須")}</span></>}<br />
                  <span class="muted">{p.responded ? v.t("回答済") : v.t("未回答")}{!p.preregistered && `・${v.t("自由記入")}`}</span></td>
                <td style="text-align:right;white-space:nowrap">
                  <Act name="toggle_required" label={p.required ? v.t("必須を外す") : v.t("必須にする")} cls="btn-sm" extra={{ participant_id: p.id }} />
                  {p.responded && <Act name="reissue_token" label={v.t("編集リンク再発行")} cls="btn-sm" confirm={v.t("旧リンクを無効にして再発行しますか？")} extra={{ participant_id: p.id }} />}
                </td>
              </tr>
            )) : <tr><td class="muted">{v.t("事前登録なし")}</td></tr>}
          </table>
          <form method="post" action={`${basePath}/action`} class="row" style="margin-top:10px">
            {common()}{hidden("action", "add_participant")}
            <input type="text" name="display_name" placeholder={v.t("氏名")} required maxlength={100} class="grow w-auto" style="flex:1 1 140px" />
            <label><input type="checkbox" name="required" value="1" /> {v.t("必須")}</label>
            <button class="btn btn-sm">{v.t("追加")}</button>
          </form>
        </Card>
        <Card title={v.t("設定")}>
          <form method="post" action={`${basePath}/action`}>
            {common()}{hidden("action", "set_deadline")}
            <label class="f">{v.t("回答期限（{tz}、空欄で期限なし）", { tz: poll.timezone })}</label>
            <div class="row"><input type="datetime-local" name="deadline" class="grow w-auto" value={deadlineValue} /><button class="btn btn-sm">{v.t("変更")}</button></div>
          </form>
          <div class="spacer"></div>
          <Act name="toggle_names" label={poll.showParticipantNames ? v.t("回答者名を非公開にする") : v.t("回答者名を公開する")} cls="btn-sm" />
          {props.isAdmin && (
            <form method="post" action={`${basePath}/action`} class="row" style="margin-top:12px">
              {common()}{hidden("action", "save_template")}
              <input type="text" name="template_name" placeholder={v.t("テンプレート名")} maxlength={100} class="grow w-auto" style="flex:1 1 140px" value={poll.title} />
              <button class="btn btn-sm">{v.t("テンプレートとして保存")}</button>
            </form>
          )}
          <div class="spacer"></div>
          <div class="row">
            <Act name="rotate_manage_link" label={v.t("管理用URLを作り直す")} cls="btn-sm" confirm={v.t("今の管理用URLは使えなくなります。よろしいですか？")} />
            {props.isAdmin && <Act name={poll.hidden ? "unhide" : "hide"} label={poll.hidden ? v.t("公開に戻す") : v.t("非公開にする（管理者）")} cls="btn-sm" />}
            <Act name="delete" label={v.t("削除する")} cls="btn-sm btn-danger" confirm={v.t("この日程調整と全ての回答を完全に削除します。元に戻せません。よろしいですか？")} />
          </div>
          {props.isAdmin && (
            <p class="muted" style="margin-top:10px">{v.t("管理用URL")}: <a href={props.manageUrl} rel="noreferrer">{v.t("開く")}</a></p>
          )}
        </Card>
        <Card title={v.t("作成根拠メモ・履歴")}>
          {poll.basis ? <p class="pre" style="font-size:13px;margin-top:0">{poll.basis}</p> : <p class="muted">{v.t("根拠メモ（basis）なし")}</p>}
          <details><summary class="muted">{v.t("操作履歴（{n}）", { n: props.audits.length })}</summary>
            <table class="list">{props.audits.map((a) => <tr><td class="muted" style="white-space:nowrap">{fmtDateTime(agg, a.createdAt, v.lang)}</td><td>{a.action}</td><td class="muted">{a.actor}</td></tr>)}</table>
          </details>
        </Card>
      </div>
    </Layout>
  );
}
