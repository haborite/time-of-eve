/**
 * Machine-readable errors and warnings: {code, field, message, hint?}.
 * The domain layer produces codes + params; the HTTP / MCP edge renders them in the caller's language.
 * `hint` tells an AI agent (or a human) what to do next.
 */
import { format, type Lang } from "../lib/i18n";

export interface Issue {
  code: string;
  field: string;
  params?: Record<string, string | number>;
}

export interface RenderedIssue {
  code: string;
  field: string;
  message: string;
  hint?: string;
}

type Entry = { ja: string; en: string; hint_ja?: string; hint_en?: string };

const M: Record<string, Entry> = {
  required: { ja: "必須項目です", en: "Required" },
  invalid_type: { ja: "型が不正です（{expected}）", en: "Invalid type (expected {expected})" },
  invalid_value: { ja: "値が不正です", en: "Invalid value" },
  too_long: { ja: "{max}文字以内にしてください", en: "Must be at most {max} characters" },
  unknown_field: { ja: "未知のフィールドです（無視されます）", en: "Unknown field (ignored)" },
  invalid_json: { ja: "JSONを解釈できません", en: "Invalid JSON", hint_en: "Send a single JSON object with Content-Type: application/json." },
  payload_too_large: { ja: "リクエストが大きすぎます", en: "The request is too large" },
  invalid_datetime: {
    ja: "日時を解釈できません: {value}", en: "Cannot parse date/time: {value}",
    hint_ja: "\"2026-12-01T13:00\"（timezone の現地時刻）か \"2026-12-01T13:00:00+09:00\" の形式で指定してください。",
    hint_en: "Use \"2026-12-01T13:00\" (local time in `timezone`) or \"2026-12-01T13:00:00+09:00\".",
  },
  invalid_date: { ja: "日付は YYYY-MM-DD で指定してください", en: "Use YYYY-MM-DD" },
  invalid_time: { ja: "時刻は HH:MM で指定してください", en: "Use HH:MM" },
  nonexistent_local_time: {
    ja: "{value} は {tz} に存在しない時刻です（夏時間の切替）", en: "{value} does not exist in {tz} (DST change)",
    hint_en: "Move the time out of the daylight-saving gap.",
  },
  ambiguous_local_time: {
    ja: "{value} は夏時間の切替で2回ある時刻です。早い方を使いました", en: "{value} occurs twice in {tz} (DST change); the earlier one was used",
  },
  timezone_mismatch: {
    ja: "UTCオフセット {offset} が timezone {tz} の {date} 時点の定義（{expected}）と一致しません",
    en: "UTC offset {offset} does not match {tz} on {date} (expected {expected})",
    hint_ja: "オフセットを省略して現地時刻だけを書けば、サーバーが timezone から正しいオフセットを決めます。",
    hint_en: "Omit the offset and send local time only; the server derives the correct offset from `timezone`.",
  },
  invalid_timezone: {
    ja: "IANAタイムゾーン名（例: Asia/Tokyo）を指定してください", en: "Use an IANA time zone name (e.g. Asia/Tokyo)",
  },
  invalid_duration: { ja: "5～1440の整数（5の倍数）で指定してください", en: "Use an integer from 5 to 1440 (multiple of 5)" },
  end_before_start: { ja: "終了は開始より後にしてください", en: "The end must be after the start" },
  unaligned_time: { ja: "開始・終了は5分単位で指定してください", en: "Start and end must be on 5-minute boundaries" },
  missing_end: {
    ja: "end を指定するか、duration_minutes を設定してください", en: "Give `end`, or set duration_minutes",
    hint_en: "With duration_minutes set, each candidate needs only `start`.",
  },
  duration_mismatch: {
    ja: "長さ {minutes}分 が duration_minutes={duration} と一致しません", en: "Length {minutes} min does not match duration_minutes={duration}",
    hint_ja: "意図的なら候補に allow_duration_mismatch: true を付けてください。",
    hint_en: "If intended, add allow_duration_mismatch: true to this candidate.",
  },
  candidate_in_past: { ja: "過去の日時です", en: "This date/time is in the past" },
  duplicate_candidate: { ja: "{other} と重複しています", en: "Duplicate of {other}" },
  candidate_overlap: { ja: "{other} と時間帯が重なっています", en: "Overlaps {other}" },
  no_candidates: {
    ja: "候補がありません", en: "There are no candidates",
    hint_en: "Give `candidates` (explicit slots) and/or `candidate_ranges` (windows split by duration_minutes).",
  },
  too_many_candidates: { ja: "候補は{max}件以内にしてください（{n}件）", en: "At most {max} candidates ({n} given)" },
  range_needs_duration: {
    ja: "candidate_ranges には duration_minutes が必要です", en: "candidate_ranges needs duration_minutes",
  },
  range_too_long: { ja: "日付範囲は{max}日以内にしてください", en: "Date range must be at most {max} days" },
  range_empty: { ja: "この範囲からは候補ができません", en: "This range produces no candidate", hint_en: "Check weekdays, dates and that the window is at least duration_minutes long." },
  invalid_weekday: { ja: "曜日は mon, tue, wed, thu, fri, sat, sun で指定してください", en: "Use mon, tue, wed, thu, fri, sat, sun" },
  invalid_email: { ja: "メールアドレスの形式が不正です", en: "Invalid email address" },
  duplicate_participant: { ja: "「{name}」が重複しています", en: "Duplicate participant name \"{name}\"" },
  too_many_participants: { ja: "参加者は{max}名以内にしてください", en: "At most {max} participants" },
  invalid_client_request_id: { ja: "英数字と . _ : - からなる1～100文字で指定してください", en: "Use 1–100 letters, digits or . _ : -" },
  deadline_in_past: { ja: "回答期限が過去です", en: "The deadline is in the past" },
  deadline_after_candidate: { ja: "回答期限が最初の候補より後です", en: "The deadline is after the first candidate" },
  validation_failed: {
    ja: "入力に誤りがあります（errors を参照）", en: "There are errors in the input (see errors)",
    hint_en: "Fix every entry in errors[] (field tells where) and send again. Use dry_run: true to check without saving.",
  },
  idempotency_conflict: {
    ja: "同じ client_request_id で異なる内容が送信されました", en: "Different content was sent with the same client_request_id",
    hint_en: "Use a new client_request_id for a different poll; resend the identical body to safely retry.",
  },
  not_found: { ja: "見つかりません", en: "Not found" },
  poll_not_found: { ja: "日程調整が見つかりません", en: "Poll not found", hint_en: "Check the URL. Drafts and hidden polls are not public." },
  invalid_poll_reference: {
    ja: "日程調整のURL（…/p/<id>）またはIDを指定してください", en: "Pass the poll URL (…/p/<id>) or its id",
  },
  invalid_state: { ja: "現在の状態（{status}）ではできません", en: "Not allowed while the poll is {status}" },
  candidate_not_found: { ja: "候補 {id} が見つかりません", en: "Candidate {id} not found", hint_en: "Use candidate ids such as \"c1\" from get_poll / the public view." },
  candidate_finalized: { ja: "確定済みの候補は削除できません", en: "A finalized candidate cannot be removed" },
  participant_not_found: { ja: "参加者 {id} が見つかりません", en: "Participant {id} not found" },
  version_conflict: {
    ja: "他の操作で更新されています。再読み込みしてください", en: "The poll was changed by someone else. Reload and retry.",
    hint_en: "Read the poll again (get the new version) and repeat the change.",
  },
  not_accepting: { ja: "現在は回答を受け付けていません（{status}）", en: "Responses are not being accepted ({status})" },
  invalid_answer: { ja: "回答は {allowed} のいずれかです", en: "Answer must be one of {allowed}" },
  slot_not_found: { ja: "候補外の時間です: {slot}", en: "Not part of any candidate: {slot}" },
  display_name_required: { ja: "お名前を入力してください（100文字以内）", en: "Enter a name (max 100 characters)" },
  already_responded: {
    ja: "この参加者は回答済みです。修正は編集リンクから行ってください", en: "This participant has already answered",
    hint_en: "Change the answer with the edit_url returned when it was submitted (update_my_response).",
  },
  use_participant_id: {
    ja: "「{name}」さんは招待済みです。名前の一覧から選んで回答してください（API: participant_id=\"{id}\"）",
    en: "\"{name}\" is invited. Pick the name from the list (API: send participant_id=\"{id}\" instead of display_name)",
  },
  invalid_edit_token: { ja: "編集リンクが無効です", en: "The edit link is invalid", hint_en: "Ask the organizer to reissue the edit link." },
  invalid_manage_token: {
    ja: "管理用リンクが無効です", en: "The management link is invalid",
    hint_en: "Use the manage_url returned when the poll was created.",
  },
  unauthorized: { ja: "認証が必要です", en: "Authentication required" },
  forbidden: { ja: "権限がありません", en: "You are not allowed to do this" },
  creation_disabled: {
    ja: "このサイトでは管理者だけが日程調整を作成できます", en: "Only administrators can create polls on this site",
    hint_en: "Authenticate with an administrator API token (Authorization: Bearer sch_…).",
  },
  csrf_failed: { ja: "フォームの有効期限が切れました。再読み込みしてください", en: "The form has expired. Please reload." },
  rate_limited: { ja: "リクエストが多すぎます。しばらく待ってください", en: "Too many requests. Please wait a moment.", hint_en: "Retry after about a minute." },
  turnstile_failed: { ja: "ボット確認に失敗しました。もう一度お試しください", en: "Bot check failed. Please try again." },
  login_failed: { ja: "ユーザー名またはパスワードが違います", en: "Wrong username or password" },
  login_limited: { ja: "試行回数が多すぎます。しばらく待ってください", en: "Too many attempts. Please wait." },
  invalid_view: { ja: "view は summary または full です", en: "view must be summary or full" },
  nothing_to_change: { ja: "変更する項目を指定してください", en: "Nothing to change: pass at least one field" },
  unknown_action: { ja: "不明な操作です", en: "Unknown action" },
  internal_error: { ja: "サーバー内部のエラーです", en: "Internal server error" },
};

const STATUS_LABEL: Record<string, { ja: string; en: string }> = {
  draft: { ja: "下書き", en: "draft" }, open: { ja: "回答受付中", en: "open" }, closed: { ja: "締切", en: "closed" },
  finalized: { ja: "確定済み", en: "finalized" }, cancelled: { ja: "中止", en: "cancelled" },
};

export function renderIssue(lang: Lang, i: Issue): RenderedIssue {
  const e = M[i.code];
  const params = { ...(i.params ?? {}) };
  if (typeof params.status === "string" && STATUS_LABEL[params.status]) params.status = STATUS_LABEL[params.status][lang];
  const out: RenderedIssue = { code: i.code, field: i.field, message: e ? format(e[lang], params) : i.code };
  const hint = e && (lang === "ja" ? e.hint_ja ?? e.hint_en : e.hint_en);
  if (hint) out.hint = format(hint, params);
  return out;
}

export function message(lang: Lang, code: string, params?: Issue["params"]): string {
  return renderIssue(lang, { code, field: "", params }).message;
}

export class Issues {
  errors: Issue[] = [];
  warnings: Issue[] = [];
  err(code: string, field: string, params?: Issue["params"]) {
    this.errors.push({ code, field, params });
  }
  warn(code: string, field: string, params?: Issue["params"]) {
    this.warnings.push({ code, field, params });
  }
  get ok() {
    return this.errors.length === 0;
  }
}

export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    public field = "",
    public params?: Issue["params"],
    public errors?: Issue[],
    public warnings?: Issue[],
  ) {
    super(code);
  }

  static validation(issues: Issues): AppError {
    return new AppError("validation_failed", 422, "", undefined, issues.errors, issues.warnings);
  }

  render(lang: Lang) {
    const body: Record<string, unknown> = { error: renderIssue(lang, { code: this.code, field: this.field, params: this.params }) };
    if (this.errors) body.errors = this.errors.map((e) => renderIssue(lang, e));
    if (this.warnings) body.warnings = this.warnings.map((e) => renderIssue(lang, e));
    return body;
  }
}

export const notFound = () => new AppError("poll_not_found", 404);
