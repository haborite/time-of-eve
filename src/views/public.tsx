/** @jsxImportSource hono/jsx */
/** Public answer page /p/<id>: title, ranking, everyone's timeline, answer modal (static/public.js). */
import type { Links } from "../domain/links";
import {
  activeCandidates, candidateSlots, cKey, effectiveStatus, finalizedCandidate, pKey, participantSlots, rankedCandidates, results, timeline,
  ANSWERS, type PollAggregate,
} from "../domain/model";
import { fmtDateTime, fmtRange } from "../domain/views";
import { fmtDate, shortDate } from "../lib/i18n";
import { STATUS_LABEL_JA, type Meta } from "../og/card";
import { Layout, jsonScript, type View } from "./layout";

export function PublicPage({ v, agg, links, meta }: { v: View; agg: PollAggregate; links: Links; meta: Meta }) {
  const poll = agg.poll;
  const status = effectiveStatus(poll);
  const res = results(agg);
  const tl = timeline(agg);
  const fin = finalizedCandidate(agg);
  const responders = agg.participants.filter((p) => p.respondedAt != null);
  const marks = new Map(responders.map((p) => [p.no, participantSlots(agg, p)]));
  const counts: Record<string, [number, number, number]> = {};
  for (const m of marks.values()) {
    for (const [k, val] of Object.entries(m)) {
      if (tl.open[k]) (counts[k] ??= [0, 0, 0])[ANSWERS.indexOf(val)]++;
    }
  }
  const boot = {
    publicId: poll.publicId,
    apiBase: `/api/v1/public/${poll.publicId}`,
    allowMaybe: poll.allowMaybe,
    accepting: status === "open",
    timeline: {
      ...tl,
      days: tl.days.map((d) => ({ date: d.date, dow: d.dow, label: fmtDate(v.lang, { year: d.y, month: d.m, day: d.d, weekday: d.dow }), short: shortDate(v.lang, { month: d.m, day: d.d, weekday: d.dow }) })),
    },
    counts,
    responded: responders.length,
    finalized: fin ? candidateSlots(agg, fin) : [],
    showNames: poll.showParticipantNames,
    people: poll.showParticipantNames ? responders.map((p) => ({ id: pKey(p.no), name: p.displayName, slots: marks.get(p.no) })) : [],
  };
  const ranked = rankedCandidates(agg);
  const candByKey = new Map(activeCandidates(agg).map((c) => [cKey(c.no), c]));
  const comments = poll.showParticipantNames ? responders.filter((p) => p.comment) : [];
  const pre = agg.participants.filter((p) => p.preregistered && p.respondedAt == null);
  const u = links.agentUrls(poll);
  const anyRequiredMiss = res.candidates.some((c) => c.all_required_yes === false);
  return (
    <Layout v={v} title={`${poll.title}｜time-of-eve`} meta={meta} bodyClass="pub" agentUrls={u} scripts={["public.js"]}>
      <div class="pub-top">
        <div class="card pub-title">
          <h1 class="ttl">{poll.title}</h1>
          {poll.description && <p class="pre">{poll.description}</p>}
          <p class="muted" style="margin:6px 0 0">
            <span class={`chip chip-${status}`} data-testid="public-status">{v.t(STATUS_LABEL_JA[status])}</span>
            {poll.responseDeadline != null && <>　{v.t("回答期限")}: {fmtDateTime(agg, poll.responseDeadline, v.lang)}</>}
            　{v.t("時刻は {tz}", { tz: poll.timezone })}
          </p>
        </div>
        <div class="card pub-cta">
          {status === "open" ? (
            <>
              <button class="btn-cta" type="button" id="open-form" data-testid="open-answer-form">
                <span class="arrow" aria-hidden="true">➜</span><span>{v.t("あなたの予定を追加する")}</span>
              </button>
              <p>{v.t("参加する方は、ここから都合を入れてください。")}</p>
              <div id="my-links" class="my-links"></div>
            </>
          ) : status === "cancelled" ? <p class="cta-msg">{v.t("この日程調整は中止されました。")}</p>
            : fin ? <p class="cta-msg">{v.t("日程が確定しました。")}</p>
            : <p class="cta-msg">{v.t("回答の受付は終了しました。")}</p>}
        </div>
      </div>

      {fin && <div class="finalbox" data-testid="public-finalized">{v.t("日程が確定しました:")} <strong>{fmtRange(agg, fin, v.lang)}</strong></div>}

      <div id="done-box" class="alert alert-ok hidden" role="status" data-testid="response-done">
        <strong id="done-msg">{v.t("予定を登録しました。")}</strong><br />
        {v.t("この端末では自分の名前を押すと直せます。別の端末で直すときは、この編集用リンクを使ってください（他の人に教えないでください）。")}
        <div class="urlbox" style="margin-top:6px">
          <input type="text" readonly id="edit-url" data-testid="edit-url" aria-label={v.t("編集用リンク")} />
          <button class="btn btn-sm" type="button" data-copy="#edit-url">{v.t("コピー")}</button>
        </div>
      </div>

      {comments.length > 0 && (
        <section class="sec">
          <h2 class="sec-h"><span class="sec-ic" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path d="M2 3h12v8H6l-3 3v-3H2z" fill="currentColor" /></svg></span>{v.t("みんなのコメント")}</h2>
          <div class="sec-b">
            {comments.map((p) => (
              <div class="cmt"><span class="cmt-av" aria-hidden="true">{[...p.displayName][0]}</span><div class="cmt-bubble"><b>{p.displayName}</b>　{p.comment}</div></div>
            ))}
          </div>
        </section>
      )}

      {ranked.length > 0 && (
        <section class="sec">
          <h2 class="sec-h"><span class="sec-ic" aria-hidden="true">★</span>{v.t("都合のよい時間")}</h2>
          <div class="sec-b">
            <ul class="good-list" data-testid="good-list">
              {ranked.map((r) => {
                const c = candByKey.get(r.id)!;
                const isFin = fin && fin.no === c.no;
                return (
                  <li class={isFin ? "fixed" : ""}>
                    <span class="when">
                      {fmtRange(agg, c, v.lang)}
                      {isFin ? <span class="badge-fixed">{v.t("確定")}</span> : res.best_candidate_ids.includes(r.id) ? <span class="badge-best">{v.t("★おすすめ")}</span> : null}
                    </span>
                    <span class="cnt">
                      <span class="mk mk-yes" aria-hidden="true">○</span>{v.t("{n}人", { n: r.yes })}
                      {r.maybe > 0 && <>　<span class="mk mk-maybe" aria-hidden="true">△</span>{v.t("{n}人", { n: r.maybe })}</>}
                      　/ {v.t("回答 {n}人", { n: res.responded })}
                    </span>
                  </li>
                );
              })}
            </ul>
            {anyRequiredMiss && res.best_candidate_ids.length > 0 && <p class="muted" style="margin:6px 0 0">{v.t("★おすすめ は必須の参加者が全員○の候補から選んでいます。")}</p>}
          </div>
        </section>
      )}

      <section class="sec">
        <h2 class="sec-h"><span class="sec-ic" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><circle cx="5" cy="5" r="2.4" fill="currentColor" /><circle cx="11" cy="5" r="2.4" fill="currentColor" /><path d="M1 13c0-2.5 1.8-4 4-4s4 1.5 4 4zM7 13c0-2.5 1.8-4 4-4s4 1.5 4 4z" fill="currentColor" /></svg></span>{v.t("みんなの予定")}</h2>
        <div class="sec-b">
          <p class="small">
            {v.t("白いマスが候補の日時、灰色は候補に入っていない時間です。")}
            {status === "open" && <>{v.t("まだの方は")}<button type="button" class="btn-linklike" data-open-form>{v.t("あなたの予定を追加する")}</button>{v.t("から都合を入れてください。")}</>}
            {poll.showParticipantNames ? v.t("自分の名前を押すと、入れた予定を直せます（この端末で登録した場合）。") : v.t("回答者名は非公開のため、人数のみ表示しています。")}
          </p>
          <div class="legend">
            <span><span class="mk mk-yes">○</span>{v.t("参加/可")}</span>
            {poll.allowMaybe && <span><span class="mk mk-maybe">△</span>{v.t("未定")}</span>}
            <span><span class="mk mk-no">×</span>{v.t("不参加/不可")}</span>
            <span><span class="mk mk-fixed"></span>{v.t("確定")}</span>
          </div>
          <p class="only-narrow small muted">{v.t("表は横にスクロールできます →")}</p>
          <div id="results" data-testid="public-matrix"></div>
        </div>
      </section>

      {status === "open" && (
        <div class="modal-back hidden" id="answer-modal" role="dialog" aria-modal="true" aria-labelledby="answer-title">
          <form class="modal-box" id="answer-form" novalidate>
            <div class="modal-h"><h2 id="answer-title">{v.t("あなたの予定を追加する")}</h2><button type="button" class="modal-x" id="cancel-x" aria-label={v.t("閉じる")}>×</button></div>
            <div class="modal-b" id="modal-body">
              <p id="ans-intro" class="intro">{v.t("名前を入れて、タイムラインに都合を入れてください。ひとことあればコメントもどうぞ。入れていない時間は「未回答」になります。")}</p>
              <div id="who-new">
                {pre.length > 0 && (
                  <div class="frow"><label for="participant-select" class="flabel">{v.t("お名前")}</label>
                    <div class="ffield"><select id="participant-select" data-testid="participant-select">
                      <option value="">{v.t("選択してください")}</option>
                      {pre.map((p) => <option value={pKey(p.no)}>{p.displayName}</option>)}
                      <option value="__new">{v.t("一覧にない（名前を入力）")}</option>
                    </select></div></div>
                )}
                <div class={`frow ${pre.length ? "hidden" : ""}`} id="name-wrap"><label for="display-name" class="flabel">{v.t("ニックネーム")}</label>
                  <div class="ffield"><input type="text" id="display-name" maxlength={100} autocomplete="nickname" data-testid="display-name" /></div></div>
              </div>
              <div id="who-edit" class="frow hidden"><span class="flabel">{v.t("お名前")}</span><div class="ffield" id="edit-name-line"></div></div>
              <div class="frow"><label for="comment" class="flabel">{v.t("コメント")}</label><div class="ffield"><input type="text" id="comment" maxlength={500} data-testid="comment" /></div></div>
              <p class="howto">{v.t("マークをえらんでからタイムラインを押すかなぞると予定が入ります。同じマークのマスを押すと消えます。")}</p>
              <div class="sticky-marks">
                <div class="mark-pick" role="radiogroup" aria-label={v.t("入れるマーク")}>
                  <input type="radio" name="mark" id="mark-yes" value="yes" checked /><label for="mark-yes" data-testid="mark-yes"><span class="mk mk-yes">○</span>{v.t("参加/可")}</label>
                  {poll.allowMaybe && <><input type="radio" name="mark" id="mark-maybe" value="maybe" /><label for="mark-maybe" data-testid="mark-maybe"><span class="mk mk-maybe">△</span>{v.t("未定")}</label></>}
                  <input type="radio" name="mark" id="mark-no" value="no" /><label for="mark-no" data-testid="mark-no"><span class="mk mk-no">×</span><span>{v.t("不参加/不可")}</span></label>
                </div>
              </div>
              <p class="tools">
                <button id="fill-all" type="button" class="btn-linklike">{v.t("空いているところをすべてえらんだマークにする")}</button>
                <button id="clear-all" type="button" class="btn-linklike">{v.t("すべて消す")}</button>
              </p>
              <p class="only-narrow hint">{v.t("スマホでは、マスを押しながら滑らせると続けて入れられます。画面を動かすときは、左の時刻の列をなぞってください。")}</p>
              <div id="answer-grid" data-testid="answer-grid"></div>
            </div>
            <div class="modal-f">
              <div id="form-error" class="alert alert-err hidden" role="alert"></div>
              <div class="modal-f-btns">
                <button type="button" class="btn" id="cancel-form">{v.t("キャンセル")}</button>
                <button class="btn-cta btn-cta-sm" id="submit-btn" data-testid="submit-response"><span class="arrow" aria-hidden="true">➜</span><span>{v.t("登 録")}</span></button>
              </div>
            </div>
          </form>
        </div>
      )}
      {jsonScript("boot", boot)}
    </Layout>
  );
}
