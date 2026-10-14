export type VideoStatus = "uploaded" | "processing" | "ready" | "error";
export type CleanStatus = "none" | "rendering" | "ready" | "error";

export interface CleanOptions {
  silences: boolean;
  /** Pauses longer than this (seconds) get shortened. */
  minSilence: number;
  fillers: boolean;
  /** Also cut comma-delimited discourse fillers: "like," "you know," "basically," */
  aggressive: boolean;
}

export type Visibility = "unlisted" | "private";

export interface VideoMeta {
  id: string;
  ownerId: string | null;
  title: string;
  visibility: Visibility;
  views: number;
  createdAt: string;
  /** Taken down by an admin after a report. Only the owner (and admins) can still open it. */
  disabled?: boolean;
  status: VideoStatus;
  stage?: string;
  error?: string;
  duration?: number;
  width?: number;
  height?: number;
  clean: {
    status: CleanStatus;
    options?: CleanOptions;
    duration?: number;
    error?: string;
  };
}

export interface Word {
  start: number;
  end: number;
  text: string;
  /** "hesitation" = um/uh, always safe to cut. "discourse" = like,/you know, */
  filler?: "hesitation" | "discourse";
}

export interface Range {
  start: number;
  end: number;
}

export interface Transcript {
  words: Word[];
  silences: Range[];
}

export const DEFAULT_CLEAN: CleanOptions = {
  silences: true,
  minSilence: 0.8,
  fillers: true,
  aggressive: false,
};
