export type ViewMode = 'reading' | 'editing' | 'critical';
export type AnchorType = 'chapter' | 'sentence' | 'word';
export type AnnotationKind = 'footnote' | 'variant' | 'background' | 'crossref';
export type AnnotationStatus = 'open' | 'resolved';
export type ConflictState = 'open' | 'resolved';
export type AdjudicationState = 'pending' | 'accepted' | 'rejected';
export type AnchorState = 'ok' | 'stale';
export type RepairState = 'ok' | 'broken';

export interface TextToken {
  id: string;
  text: string;
}

export interface Sentence {
  id: string;
  order: number;
  text: string;
  tokens: TextToken[];
}

export interface Chapter {
  id: string;
  order: number;
  title: string;
  summary: string;
  sentences: Sentence[];
}

export interface Annotation {
  id: string;
  /** 稳定身份：跨批注包、跨校注员保持不变，用于幂等导入与引用解析。 */
  stableId: string;
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  title: string;
  body: string;
  source: string;
  references: string[];
  status: AnnotationStatus;
  tags: string[];
  conflictState: ConflictState;
  conflictResolution?: string;
  updatedAt: string;
  /** 裁定状态：未裁定的意见不进入校勘版与导出。 */
  adjudicationState: AdjudicationState;
  /** 正文锚点状态：正文改动后旧锚点立即失效待确认，不迁移、不硬接。 */
  anchorState: AnchorState;
  /** 跨引用状态：引用目标断开时标为待修。 */
  repairState: RepairState;
  /** 锚点失效时记录的旧文与新文，供认领时核对。 */
  anchorMismatch?: { expectedText: string; actualText: string; expectedLabel: string };
  /** 失效前的原始锚点，保留以便追溯。 */
  originalAnchorId?: string;
  originalAnchorType?: AnchorType;
  /** 认领人与认领时间。 */
  claimedBy?: string;
  claimedAt?: string;
  /** 来源批注包检查点 id。 */
  packageId?: string;
}

export interface VersionSnapshot {
  id: string;
  label: string;
  note: string;
  createdAt: string;
  chapters: Chapter[];
  annotations: Annotation[];
}

export interface TextDocument {
  id: string;
  title: string;
  author: string;
  edition: string;
  chapters: Chapter[];
  annotations: Annotation[];
  snapshots: VersionSnapshot[];
  updatedAt: string;
}

export interface WorkspaceState {
  document: TextDocument;
  mode: ViewMode;
  selectedChapterId: string;
  selectedSentenceId: string;
  selectedAnnotationId: string | null;
  query: string;
  dirty: boolean;
  /** 批注包合并检查点：合并失败后保留原草稿与检查点，重开可接着处理。 */
  mergeCheckpoint: MergeCheckpoint | null;
}

export interface EditorState {
  workspace: WorkspaceState;
  past: WorkspaceState[];
  future: WorkspaceState[];
  lastAction: string;
}

export interface SearchResult {
  chapterId: string;
  sentenceId?: string;
  annotationId?: string;
  title: string;
  excerpt: string;
  kind: 'text' | 'annotation';
}

export interface ConflictGroup {
  key: string;
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  anchorLabel: string;
  annotations: Annotation[];
}

/** 批注包：校注员离线交换意见的载体，带基准版本、稳定身份与正文锚点。 */
export interface AnnotationPackage {
  format: 'jigu-annotation-package';
  formatVersion: 1;
  baseVersionId: string;
  baseFingerprint: string;
  baseLabel: string;
  exportedAt: string;
  collator: string;
  annotations: Annotation[];
}

export interface MergeItem {
  key: string;
  stableId: string;
  annotation: Annotation;
  decision: AdjudicationState;
  anchorState: AnchorState;
  repairState: RepairState;
  duplicate: boolean;
  messages: string[];
}

export interface MergeCheckpoint {
  id: string;
  fileName: string;
  startedAt: string;
  status: 'staging' | 'failed' | 'completed';
  error?: string;
  packageMeta: {
    format: string;
    formatVersion: number;
    collator: string;
    baseLabel: string;
    exportedAt: string;
    annotationCount: number;
  };
  items: MergeItem[];
}
