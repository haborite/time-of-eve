/**
 * Data the public answer page (src/views/public.tsx) embeds as <script id="boot"> for its browser code
 * (src/client/public). Types only: shared by the Worker and the browser bundle.
 */

export type Answer = "yes" | "maybe" | "no";

/** Slot key: wall-clock start in the poll's time zone, "2026-12-01T13:00". */
export type SlotKey = string;

export interface PublicBoot {
  publicId: string;
  /** Base of the public API, e.g. "/api/v1/public/<id>". */
  apiBase: string;
  allowMaybe: boolean;
  /** Answers can be added or changed now. */
  accepting: boolean;
  /** The poll's IANA time zone. */
  tz: string;
  timeline: {
    /** Slot length in minutes. */
    step: number;
    /** Open slots → candidate keys covering them. */
    open: Record<SlotKey, string[]>;
    /** Absolute start of each open slot (epoch ms), for laying out in another time zone. */
    at: Record<SlotKey, number>;
  };
  /** Per open slot: [yes, maybe, no] counts. */
  counts: Record<SlotKey, [number, number, number]>;
  /** Number of people who answered. */
  responded: number;
  /** Slots of the finalized candidate (empty if none). */
  finalized: SlotKey[];
  showNames: boolean;
  /** Everyone's answers (empty when names are hidden). */
  people: { id: string; name: string; slots: Record<SlotKey, Answer> }[];
}
