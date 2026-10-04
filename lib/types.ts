export type ViewMode = 'reading' | 'editing' | 'critical';
export type AnchorType = 'chapter' | 'sentence' | 'word';
export type AnnotationKind = 'footnote' | 'variant' | 'background' | 'crossref';
export type AnnotationStatus = 'open' | 'resolved';

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
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  title: string;
  body: string;
  source: string;
  references: string[];
  status: AnnotationStatus;
  tags: string[];
  conflictState: 'open' | 'resolved';
  conflictResolution?: string;
  /** 离线批注包内的稳定身份 ID，用于重复导入去重与跨包引用回连。 */
  importOrigin?: string;
  /** 合并时无法回连的交叉引用（原稳定身份），进入“待修”清单。 */
  brokenReferences?: string[];
  updatedAt: string;
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
  mergeSession: MergeSession | null;
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

/* ===================== 离线批注包合并 ===================== */

export type PackageAnchorHealth = 'fresh' | 'stale' | 'missing';
export type MergeDecision = 'pending' | 'accept' | 'reject';
export type MergeItemStatus = 'fresh' | 'duplicate' | 'stale' | 'missing';

/** 批注包里的锚点：带稳定目标、正文引用与校验和，供导入时核对底本是否已改。 */
export interface PackageAnchor {
  anchorId: string;
  anchorType: AnchorType;
  /** 批注制作时锚点所在的原文（词语为该词语），用于人工比对。 */
  quote: string;
  /** anchorId / 原句 / 原词 上的校验和；与现稿不一致即为失效。 */
  checksum: string;
  chapterId: string;
  sentenceId?: string;
}

/** 批注包内的一条待合并意见（稳定身份为 originId）。 */
export interface IncomingAnnotation {
  originId: string;
  anchor: PackageAnchor;
  kind: AnnotationKind;
  title: string;
  body: string;
  source: string;
  references: string[];
  tags: string[];
}

/** 离线批注包：带基准版本与稳定身份。 */
export interface AnnotationPackage {
  format: 'guji-annotation-package';
  packageVersion: 1;
  documentId: string;
  baseEdition: string;
  baseAt: string;
  author: string;
  exportedAt: string;
  annotations: IncomingAnnotation[];
}

export interface MergeItem extends IncomingAnnotation {
  localOriginId: string;
  status: MergeItemStatus;
  decision: MergeDecision;
  health: PackageAnchorHealth;
  anchorLabel: string;
  currentQuote: string;
  /** 失效 / 缺失锚点改挂的候选目标。 */
  retargetOptions: { anchorId: string; anchorType: AnchorType; label: string }[];
  /** 解析时按当前文档判定为断开的引用（目标稳定身份找不到）。 */
  brokenRefs: { originId: string; title: string }[];
  note?: string;
}

export interface MergeSession {
  id: string;
  createdAt: string;
  formatVersion: number;
  author: string;
  baseEdition: string;
  baseAt: string;
  note: string;
  /** 合并开始前自动保存的检查点，合并失败可整单回到此处。 */
  checkpointId: string;
  items: MergeItem[];
}

export interface MergeReport {
  accepted: string[];
  rejected: string[];
  brokenRefs: number;
  duplicates: number;
}
