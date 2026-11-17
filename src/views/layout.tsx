/** @jsxImportSource hono/jsx */
/**
 * Page shell: header (pink), language switch, OGP/Twitter meta, machine-readable alternates for AI agents.
 * Server-rendered with Hono JSX; behaviour comes from small static scripts in /static (no framework).
 */
import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import { jsDict, t, type Lang } from "../lib/i18n";
import type { Meta } from "../og/card";

export const ASSET_V = "1";

export interface View {
  lang: Lang;
  /** current path + query, for the language switch */
  here: string;
  t: (s: string, kw?: Record<string, string | number>) => string;
  admin?: { username: string; csrf: string } | null;
  /** creation allowed for this visitor (anyone mode, or admin) */
  canCreate: boolean;
}

export function makeView(lang: Lang, here: string, admin: View["admin"], canCreate: boolean): View {
  return { lang, here, admin, canCreate, t: (s, kw) => t(lang, s, kw) };
}

export interface AgentUrls {
  markdown: string;
  json: string;
  respond: string;
  docs: string;
  openapi: string;
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="6" width="26" height="23" rx="4" fill="#fff" />
      <rect x="3" y="6" width="26" height="7" rx="3" fill="#ffd0d8" />
      <rect x="9" y="3" width="3" height="7" rx="1.5" fill="#fff" />
      <rect x="20" y="3" width="3" height="7" rx="1.5" fill="#fff" />
      <circle cx="11" cy="20" r="3.4" fill="none" stroke="#fe899c" stroke-width="2.2" />
      <path d="M19 23.5l3.5-6 3.5 6z" fill="none" stroke="#e0a100" stroke-width="2" stroke-linejoin="round" />
    </svg>
  );
}

export function Layout(props: {
  v: View;
  title: string;
  meta: Meta;
  bodyClass?: string;
  indexable?: boolean;
  nav?: "default" | "none";
  agentUrls?: AgentUrls;
  scripts?: string[];
  wide?: boolean;
  children: Child;
}) {
  const { v, meta } = props;
  const other: Lang = v.lang === "ja" ? "en" : "ja";
  const ogLocale = { ja: "ja_JP", en: "en_US" };
  const switchUrl = `/lang/${other}?next=${encodeURIComponent(v.here)}`;
  return (
    <>
      {raw("<!doctype html>")}
      <html lang={v.lang}>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {!props.indexable && <meta name="robots" content="noindex, nofollow" />}
          <meta name="theme-color" content="#fe899c" />
          <title>{props.title}</title>
          <meta name="description" content={meta.description} />
          <link rel="canonical" href={meta.url} />
          <meta property="og:site_name" content="Time of EVE" />
          <meta property="og:type" content="website" />
          <meta property="og:title" content={meta.title} />
          <meta property="og:description" content={meta.description} />
          <meta property="og:url" content={meta.url} />
          <meta property="og:image" content={meta.image} />
          <meta property="og:image:type" content="image/png" />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:alt" content={meta.imageAlt} />
          <meta property="og:locale" content={ogLocale[v.lang]} />
          <meta property="og:locale:alternate" content={ogLocale[other]} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={meta.title} />
          <meta name="twitter:description" content={meta.description} />
          <meta name="twitter:image" content={meta.image} />
          <meta name="twitter:image:alt" content={meta.imageAlt} />
          <meta name="format-detection" content="telephone=no" />
          <link rel="stylesheet" href={`/static/style.css?v=${ASSET_V}`} />
          <link rel="help" type="text/plain" href="/llms.txt" title="Guide for AI agents" />
          {props.agentUrls && (
            <>
              <link rel="alternate" type="text/markdown" href={props.agentUrls.markdown} title="Machine-readable poll for AI agents" />
              <link rel="alternate" type="application/json" href={props.agentUrls.json} title="Poll JSON (candidates, tallies)" />
              <link rel="service-desc" type="application/json" href={props.agentUrls.openapi} />
            </>
          )}
          <link rel="icon" href="/static/icon.svg" type="image/svg+xml" />
        </head>
        <body class={props.bodyClass ?? ""}>
          {props.agentUrls && (
            <div class="ai-hint" aria-hidden="true" data-testid="ai-hint">
              AI agents / LLMs: do not scrape this page. Read the poll as Markdown at {props.agentUrls.markdown} or JSON at {props.agentUrls.json}.
              To answer on a participant's explicit request, POST to {props.agentUrls.respond} as described in {props.agentUrls.docs}.
            </div>
          )}
          <header class="hdr">
            <div class="container">
              <a class="logo" href="/">
                <Logo />
                Time of EVE
              </a>
              {props.nav !== "none" && <Nav v={v} />}
              <a class="lang-switch" href={switchUrl} hreflang={other} lang={other} data-testid="lang-switch">
                {v.lang === "ja" ? "English" : "日本語"}
              </a>
            </div>
          </header>
          <main>
            <div class={props.wide ? "container wide" : "container"}>{props.children}</div>
          </main>
          <Footer v={v} agentUrls={props.agentUrls} />
          <script type="application/json" id="i18n">{raw(jsDict(v.lang))}</script>
          <script src={`/static/i18n.js?v=${ASSET_V}`}></script>
          {(props.scripts ?? []).map((s) => <script src={`/static/${s}?v=${ASSET_V}`}></script>)}
        </body>
      </html>
    </>
  );
}

function Nav({ v }: { v: View }) {
  if (v.admin) {
    return (
      <nav>
        <a href="/admin">{v.t("一覧")}</a>
        <a href="/new/import" data-testid="nav-import">{v.t("JSON取込")}</a>
        <a href="/admin/tokens">{v.t("APIトークン")}</a>
        <a href="/admin/settings">{v.t("設定")}</a>
        <a class="cta" href="/new">{v.t("日程をえらぶ")}</a>
        <form method="post" action="/admin/logout">
          <input type="hidden" name="csrf" value={v.admin.csrf} />
          <button>{v.t("ログアウト")}</button>
        </form>
      </nav>
    );
  }
  return (
    <nav>
      <a href="/docs">{v.t("AI・API連携")}</a>
      {v.canCreate && <a class="cta" href="/new">{v.t("日程をえらぶ")}</a>}
    </nav>
  );
}

function Footer({ v, agentUrls }: { v: View; agentUrls?: AgentUrls }) {
  return (
    <footer>
      <div>{v.t("回答ページはURLを知っている人が閲覧できます。個人情報や未公開情報は記載しないでください。")}</div>
      {agentUrls ? (
        <small class="ai-foot" data-testid="ai-footer">
          {v.t("AI・LLMで読み取る・回答する場合")}: <a href={agentUrls.markdown} rel="alternate" type="text/markdown">{v.t("機械可読版")}</a>
          {" · "}<a href={agentUrls.json} rel="alternate" type="application/json">JSON</a>
          {" · "}<a href="/docs" rel="help">{v.t("回答APIの説明")}</a>
        </small>
      ) : null}
      <nav class="foot-links">
        <a href="/">{v.t("トップ")}</a>
        <a href="/docs">{v.t("AI・API連携")}</a>
        <a href="/about">{v.t("このサイトについて")}</a>
        <a href="/terms">{v.t("利用規約")}</a>
        <a href="/privacy">{v.t("プライバシーポリシー")}</a>
        <a href="https://github.com/haborite/time-of-eve" rel="noopener">GitHub</a>
        {v.admin ? null : <a href="/admin/login">{v.t("管理者")}</a>}
      </nav>
    </footer>
  );
}

/** JSON for <script type="application/json">: escape <, >, & so it cannot close the tag. */
export function jsonScript(id: string, value: unknown) {
  const s = JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return <script type="application/json" id={id}>{raw(s)}</script>;
}

export function Alert(props: { kind: "ok" | "err" | "warn" | "info"; testid?: string; children: Child }) {
  return <div class={`alert alert-${props.kind}`} role={props.kind === "err" ? "alert" : "status"} data-testid={props.testid}>{props.children}</div>;
}

export function CopyBox(props: { id: string; value: string; label: string; testid?: string; primary?: boolean; v: View }) {
  return (
    <div class="urlbox">
      <input type="text" readonly value={props.value} id={props.id} data-testid={props.testid} aria-label={props.label} />
      <button class={props.primary ? "btn btn-primary" : "btn btn-sm"} type="button" data-copy={`#${props.id}`}>{props.v.t("コピー")}</button>
    </div>
  );
}
