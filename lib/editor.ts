import type {
  AdjudicationState,
  AnchorState,
  AnchorType,
  Annotation,
  AnnotationKind,
  AnnotationPackage,
  ConflictGroup,
  EditorState,
  MergeCheckpoint,
  MergeItem,
  RepairState,
  SearchResult,
  Sentence,
  TextDocument,
  WorkspaceState
} from './types';

export const STORAGE_KEY = 'sologsb-1022/public-text-annotator/v1';

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createInitialWorkspace(document: TextDocument): WorkspaceState {
  return {
    document: clone(document),
    mode: 'reading',
    selectedChapterId: document.chapters[0]?.id ?? '',
    selectedSentenceId: document.chapters[0]?.sentences[0]?.id ?? '',
    selectedAnnotationId: null,
    query: '',
    dirty: false,
    mergeCheckpoint: null
  };
}

export function createInitialEditorState(document: TextDocument): EditorState {
  return {
    workspace: createInitialWorkspace(document),
    past: [],
    future: [],
    lastAction: '已载入整理底本'
  };
}

function pushHistory(state: EditorState, next: WorkspaceState, label: string): EditorState {
  return {
    workspace: next,
    past: [...state.past.slice(-39), clone(state.workspace)],
    future: [],
    lastAction: label
  };
}

export type EditorAction =
  | { type: 'hydrate'; workspace: WorkspaceState }
  | { type: 'commit'; label: string; mutate: (document: TextDocument) => void }
  | { type: 'selectChapter'; chapterId: string }
  | { type: 'selectSentence'; chapterId: string; sentenceId: string }
  | { type: 'selectAnnotation'; annotationId: string | null }
  | { type: 'setMode'; mode: WorkspaceState['mode'] }
  | { type: 'setQuery'; query: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'mergeStage'; fileName: string; pkg: AnnotationPackage; items: MergeItem[] }
  | { type: 'mergeFail'; fileName: string; error: string }
  | { type: 'mergeDecide'; key: string; decision: AdjudicationState }
  | { type: 'mergeDecideAll'; decision: AdjudicationState }
  | { type: 'mergeCommit' }
  | { type: 'mergeDiscard' }
  | { type: 'reanchorAnnotation'; id: string; anchorId: string; anchorType: AnchorType }
  | { type: 'repairAnnotation'; id: string };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'hydrate':
      return {
        workspace: action.workspace,
        past: [],
        future: [],
        lastAction: '已恢复离线草稿'
      };
    case 'commit': {
      const next = clone(state.workspace);
      action.mutate(next.document);
      next.document.updatedAt = new Date().toISOString();
      next.dirty = true;
      return pushHistory(state, next, action.label);
    }
    case 'selectChapter': {
      const chapter = state.workspace.document.chapters.find((item) => item.id === action.chapterId);
      return {
        ...state,
        workspace: {
          ...state.workspace,
          selectedChapterId: action.chapterId,
          selectedSentenceId: chapter?.sentences[0]?.id ?? '',
          selectedAnnotationId: null
        }
      };
    }
    case 'selectSentence':
      return {
        ...state,
        workspace: {
          ...state.workspace,
          selectedChapterId: action.chapterId,
          selectedSentenceId: action.sentenceId,
          selectedAnnotationId: null
        }
      };
    case 'selectAnnotation':
      return {
        ...state,
        workspace: { ...state.workspace, selectedAnnotationId: action.annotationId }
      };
    case 'setMode':
      return { ...state, workspace: { ...state.workspace, mode: action.mode } };
    case 'setQuery':
      return { ...state, workspace: { ...state.workspace, query: action.query } };
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        workspace: clone(previous),
        past: state.past.slice(0, -1),
        future: [clone(state.workspace), ...state.future].slice(0, 40),
        lastAction: '已撤销上一步操作'
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        workspace: clone(next),
        past: [...state.past, clone(state.workspace)].slice(-40),
        future: state.future.slice(1),
        lastAction: '已重做上一步操作'
      };
    }
    case 'mergeStage': {
      const checkpoint: MergeCheckpoint = {
        id: `merge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: action.fileName,
        startedAt: new Date().toISOString(),
        status: 'staging',
        packageMeta: {
          format: action.pkg.format,
          formatVersion: action.pkg.formatVersion,
          collator: action.pkg.collator,
          baseLabel: action.pkg.baseLabel,
          exportedAt: action.pkg.exportedAt,
          annotationCount: action.items.length
        },
        items: action.items
      };
      return { ...state, workspace: { ...state.workspace, mergeCheckpoint: checkpoint } };
    }
    case 'mergeFail': {
      const checkpoint: MergeCheckpoint = {
        id: `merge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: action.fileName,
        startedAt: new Date().toISOString(),
        status: 'failed',
        error: action.error,
        packageMeta: { format: '', formatVersion: 0, collator: '', baseLabel: '', exportedAt: '', annotationCount: 0 },
        items: []
      };
      return { ...state, workspace: { ...state.workspace, mergeCheckpoint: checkpoint } };
    }
    case 'mergeDecide': {
      const checkpoint = state.workspace.mergeCheckpoint;
      if (!checkpoint) return state;
      const items = checkpoint.items.map((item) =>
        item.key === action.key ? { ...item, decision: action.decision } : item
      );
      return { ...state, workspace: { ...state.workspace, mergeCheckpoint: { ...checkpoint, items } } };
    }
    case 'mergeDecideAll': {
      const checkpoint = state.workspace.mergeCheckpoint;
      if (!checkpoint) return state;
      const items = checkpoint.items.map((item) => (item.duplicate ? item : { ...item, decision: action.decision }));
      return { ...state, workspace: { ...state.workspace, mergeCheckpoint: { ...checkpoint, items } } };
    }
    case 'mergeCommit': {
      const checkpoint = state.workspace.mergeCheckpoint;
      if (!checkpoint || checkpoint.status !== 'staging') return state;
      try {
        const next = clone(state.workspace);
        const existingStable = new Set<string>();
        for (const annotation of next.document.annotations) {
          if (annotation.stableId) existingStable.add(annotation.stableId);
        }
        const stableToId = new Map<string, string>();
        for (const annotation of next.document.annotations) {
          if (annotation.stableId) stableToId.set(annotation.stableId, annotation.id);
        }
        let accepted = 0;
        for (const item of checkpoint.items) {
          if (item.decision !== 'accepted' || item.duplicate) continue;
          if (existingStable.has(item.stableId)) continue;
          const annotation = clone(item.annotation);
          annotation.references = annotation.references.map((ref) => stableToId.get(ref) ?? ref);
          annotation.adjudicationState = 'accepted';
          annotation.anchorState = item.anchorState;
          annotation.repairState = item.repairState;
          annotation.claimedBy = '本地校注员';
          annotation.claimedAt = new Date().toISOString();
          annotation.packageId = checkpoint.id;
          next.document.annotations.push(annotation);
          existingStable.add(item.stableId);
          stableToId.set(item.stableId, annotation.id);
          accepted += 1;
        }
        const finalIds = new Set(next.document.annotations.map((annotation) => annotation.id));
        for (const annotation of next.document.annotations) {
          const missing = annotation.references.filter((ref) => !finalIds.has(ref));
          annotation.repairState = missing.length ? 'broken' : 'ok';
        }
        next.document.updatedAt = new Date().toISOString();
        next.mergeCheckpoint = null;
        next.dirty = true;
        return pushHistory(state, next, `合并批注包（认领 ${accepted} 条）`);
      } catch (error) {
        return {
          ...state,
          workspace: {
            ...state.workspace,
            mergeCheckpoint: {
              ...checkpoint,
              status: 'failed',
              error: `合并失败，原草稿与检查点已保留：${String(error)}`
            }
          }
        };
      }
    }
    case 'mergeDiscard':
      return { ...state, workspace: { ...state.workspace, mergeCheckpoint: null } };
    case 'reanchorAnnotation': {
      const next = clone(state.workspace);
      const annotation = next.document.annotations.find((item) => item.id === action.id);
      if (!annotation) return state;
      annotation.anchorId = action.anchorId;
      annotation.anchorType = action.anchorType;
      annotation.anchorState = 'ok';
      annotation.anchorMismatch = undefined;
      annotation.originalAnchorId = undefined;
      annotation.originalAnchorType = undefined;
      annotation.updatedAt = new Date().toISOString();
      next.document.updatedAt = new Date().toISOString();
      next.dirty = true;
      return pushHistory(state, next, '重新锚定注释');
    }
    case 'repairAnnotation': {
      const next = clone(state.workspace);
      const annotation = next.document.annotations.find((item) => item.id === action.id);
      if (!annotation) return state;
      const ids = new Set(next.document.annotations.map((item) => item.id));
      annotation.references = annotation.references.filter((ref) => ids.has(ref));
      annotation.repairState = 'ok';
      annotation.updatedAt = new Date().toISOString();
      next.document.updatedAt = new Date().toISOString();
      next.dirty = true;
      return pushHistory(state, next, '修复跨引用');
    }
    default:
      return state;
  }
}

export function getSentence(document: TextDocument, sentenceId: string): Sentence | undefined {
  for (const chapter of document.chapters) {
    const sentence = chapter.sentences.find((item) => item.id === sentenceId);
    if (sentence) return sentence;
  }
  return undefined;
}

export function getTargetLabel(document: TextDocument, annotation: Annotation): string {
  if (annotation.anchorType === 'chapter') {
    return document.chapters.find((chapter) => chapter.id === annotation.anchorId)?.title ?? '未知章节';
  }

  for (const chapter of document.chapters) {
    if (annotation.anchorType === 'sentence') {
      const sentence = chapter.sentences.find((item) => item.id === annotation.anchorId);
      if (sentence) return `${chapter.title} · 第 ${sentence.order} 句`;
    } else {
      for (const sentence of chapter.sentences) {
        const token = sentence.tokens.find((item) => item.id === annotation.anchorId);
        if (token) return `${chapter.title} · “${token.text.trim()}”`;
      }
    }
  }

  return annotation.anchorState === 'stale' ? '锚点已失效，待重新确认' : '引用目标已迁移到所属句';
}

export function collectSearchResults(document: TextDocument, query: string): SearchResult[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];

  const results: SearchResult[] = [];
  for (const chapter of document.chapters) {
    if (chapter.title.toLocaleLowerCase().includes(normalized)) {
      results.push({
        chapterId: chapter.id,
        title: chapter.title,
        excerpt: chapter.summary,
        kind: 'text'
      });
    }
    for (const sentence of chapter.sentences) {
      if (sentence.text.toLocaleLowerCase().includes(normalized)) {
        results.push({
          chapterId: chapter.id,
          sentenceId: sentence.id,
          title: `${chapter.title} · 第 ${sentence.order} 句`,
          excerpt: sentence.text,
          kind: 'text'
        });
      }
    }
  }

  for (const annotation of document.annotations) {
    if (!isAdjudicated(annotation)) continue;
    const searchable = `${annotation.title} ${annotation.body} ${annotation.source}`.toLocaleLowerCase();
    if (searchable.includes(normalized)) {
      const sentence = getSentence(document, annotation.anchorType === 'sentence' ? annotation.anchorId : '');
      results.push({
        chapterId: findChapterIdForAnnotation(document, annotation),
        sentenceId: sentence?.id,
        annotationId: annotation.id,
        title: annotation.title,
        excerpt: `${annotation.source} · ${annotation.body}`,
        kind: 'annotation'
      });
    }
  }

  return results.slice(0, 24);
}

function findChapterIdForAnnotation(document: TextDocument, annotation: Annotation) {
  if (annotation.anchorType === 'chapter') return annotation.anchorId;
  for (const chapter of document.chapters) {
    if (chapter.sentences.some((sentence) => sentence.id === annotation.anchorId)) return chapter.id;
    if (
      annotation.anchorType === 'word' &&
      chapter.sentences.some((sentence) => sentence.tokens.some((token) => token.id === annotation.anchorId))
    ) {
      return chapter.id;
    }
  }
  return document.chapters[0]?.id ?? '';
}

export function getConflictGroups(document: TextDocument): ConflictGroup[] {
  const groups = new Map<string, Annotation[]>();
  for (const annotation of document.annotations) {
    if (annotation.conflictState === 'resolved') continue;
    const key = `${annotation.anchorId}:${annotation.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), annotation]);
  }

  return Array.from(groups.entries())
    .filter(([, items]) => {
      const bodies = new Set(items.map((item) => item.body.trim()));
      return bodies.size > 1;
    })
    .map(([key, items]) => {
      const first = items[0];
      const sentence = first.anchorType === 'sentence' ? getSentence(document, first.anchorId) : undefined;
      const tokenText = findTokenText(document, first.anchorId);
      return {
        key,
        anchorId: first.anchorId,
        anchorType: first.anchorType,
        kind: first.kind,
        anchorLabel: sentence ? `“${sentence.text}”` : tokenText ? `“${tokenText}”` : '文本片段',
        annotations: items
      };
    });
}

function findTokenText(document: TextDocument, tokenId: string) {
  for (const chapter of document.chapters) {
    for (const sentence of chapter.sentences) {
      const token = sentence.tokens.find((item) => item.id === tokenId);
      if (token) return token.text.trim();
    }
  }
  return '';
}

export function kindLabel(kind: AnnotationKind) {
  return {
    footnote: '脚注',
    variant: '异文',
    background: '背景',
    crossref: '互见'
  }[kind];
}

export function updateSentenceText(
  document: TextDocument,
  sentenceId: string,
  text: string,
  tokenize: (value: string, id: string, existing: Sentence['tokens']) => Sentence['tokens']
) {
  let staleCount = 0;
  for (const chapter of document.chapters) {
    const sentence = chapter.sentences.find((item) => item.id === sentenceId);
    if (!sentence) continue;
    const previousText = sentence.text;
    const previousIds = new Set(sentence.tokens.map((token) => token.id));
    sentence.text = text;
    sentence.tokens = tokenize(text, sentence.id, sentence.tokens);
    const remainingIds = new Set(sentence.tokens.map((token) => token.id));

    for (const annotation of document.annotations) {
      let stale = false;
      if (annotation.anchorType === 'sentence' && annotation.anchorId === sentence.id) {
        stale = true;
      } else if (
        annotation.anchorType === 'word' &&
        previousIds.has(annotation.anchorId) &&
        !remainingIds.has(annotation.anchorId)
      ) {
        stale = true;
      }
      if (stale) {
        if (annotation.anchorState !== 'stale') {
          annotation.originalAnchorId = annotation.anchorId;
          annotation.originalAnchorType = annotation.anchorType;
        }
        annotation.anchorState = 'stale';
        annotation.anchorMismatch = {
          expectedText: previousText,
          actualText: text,
          expectedLabel: `${chapter.title} · 第 ${sentence.order} 句`
        };
        staleCount += 1;
      }
    }
    break;
  }
  return staleCount;
}

export function removeAnnotationReferences(document: TextDocument, removedId: string) {
  for (const annotation of document.annotations) {
    annotation.references = annotation.references.filter((id) => id !== removedId);
  }
}

export function toWorkspace(document: TextDocument, fallback: WorkspaceState): WorkspaceState {
  const chapter = document.chapters.find((item) => item.id === fallback.selectedChapterId) ?? document.chapters[0];
  const sentence = chapter?.sentences.find((item) => item.id === fallback.selectedSentenceId) ?? chapter?.sentences[0];
  return {
    document,
    mode: fallback.mode,
    selectedChapterId: chapter?.id ?? '',
    selectedSentenceId: sentence?.id ?? '',
    selectedAnnotationId: fallback.selectedAnnotationId,
    query: fallback.query,
    dirty: false,
    mergeCheckpoint: fallback.mergeCheckpoint ?? null
  };
}

export function createStableId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `stable-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 计算正文指纹，用于批注包基准版本比对。 */
export function fingerprintDocument(document: TextDocument): string {
  const raw = document.chapters
    .map(
      (chapter) =>
        `${chapter.id}:${chapter.order}:${chapter.title}:${chapter.sentences
          .map((sentence) => `${sentence.id}:${sentence.order}:${sentence.text}`)
          .join('|')}`
    )
    .join('::');
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a32:${h.toString(16).padStart(8, '0')}`;
}

/** 未裁定（含失效、待修）的意见不进入校勘版和导出。 */
export function isAdjudicated(annotation: Annotation): boolean {
  return (
    (annotation.adjudicationState ?? 'accepted') === 'accepted' &&
    (annotation.anchorState ?? 'ok') !== 'stale' &&
    (annotation.repairState ?? 'ok') !== 'broken'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveAnchor(
  document: TextDocument,
  anchorId: string,
  anchorType: AnchorType
): { actualText: string; label: string } | undefined {
  if (anchorType === 'chapter') {
    const chapter = document.chapters.find((item) => item.id === anchorId);
    return chapter ? { actualText: chapter.title, label: chapter.title } : undefined;
  }
  for (const chapter of document.chapters) {
    const sentence = chapter.sentences.find((item) => item.id === anchorId);
    if (sentence) return { actualText: sentence.text, label: `${chapter.title} · 第 ${sentence.order} 句` };
    if (anchorType === 'word') {
      const tokenSentence = chapter.sentences.find((item) => item.tokens.some((token) => token.id === anchorId));
      if (tokenSentence) {
        const token = tokenSentence.tokens.find((item) => item.id === anchorId);
        return { actualText: tokenSentence.text, label: `${chapter.title} · “${token?.text.trim() ?? ''}”` };
      }
    }
  }
  return undefined;
}

/** 旧版离线草稿升级：补齐稳定身份与裁定默认值，并校验锚点。 */
export function migrateDocument(raw: unknown): { document: TextDocument } | { error: string } {
  if (!isRecord(raw)) return { error: '文件内容不是有效的文档结构，原草稿保留不变' };
  let doc: TextDocument;
  if (isRecord(raw.document) && Array.isArray((raw.document as unknown as TextDocument).chapters)) {
    doc = raw.document as unknown as TextDocument;
  } else if (Array.isArray(raw.chapters)) {
    doc = raw as unknown as TextDocument;
  } else {
    return { error: '无法识别的草稿格式：缺少章节数据，原草稿保留不变' };
  }
  if (!Array.isArray(doc.chapters) || doc.chapters.length === 0) {
    return { error: '草稿中没有章节内容，原草稿保留不变' };
  }
  for (const annotation of doc.annotations ?? []) {
    annotation.stableId ??= createStableId();
    annotation.adjudicationState ??= 'accepted';
    annotation.anchorState ??= 'ok';
    annotation.repairState ??= 'ok';
  }
  for (const annotation of doc.annotations ?? []) {
    if (annotation.anchorState === 'stale') continue;
    const resolved = resolveAnchor(doc, annotation.anchorId, annotation.anchorType);
    if (!resolved) {
      annotation.anchorState = 'stale';
      annotation.anchorMismatch = {
        expectedText: annotation.anchorMismatch?.expectedText ?? '',
        actualText: '',
        expectedLabel: annotation.anchorMismatch?.expectedLabel ?? '原锚点'
      };
    }
  }
  return { document: doc };
}

/** 解析导入文件：批注包、旧版草稿或错误。解析失败时原草稿不受影响。 */
export function parsePackageFile(
  text: string
): { kind: 'package'; pkg: AnnotationPackage } | { kind: 'draft'; document: TextDocument } | { kind: 'error'; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { kind: 'error', error: '文件不是有效的 JSON，批注包未载入，原草稿保留不变' };
  }
  if (isRecord(data) && data.format === 'jigu-annotation-package') {
    if (data.formatVersion !== 1) {
      return { kind: 'error', error: `批注包版本不受支持：formatVersion=${String(data.formatVersion)}，原草稿保留不变` };
    }
    if (!Array.isArray(data.annotations)) {
      return { kind: 'error', error: '批注包缺少 annotations 字段，原草稿保留不变' };
    }
    const pkg = data as unknown as AnnotationPackage;
    for (const annotation of pkg.annotations) {
      annotation.stableId ??= createStableId();
      annotation.adjudicationState = 'pending';
      annotation.anchorState ??= 'ok';
      annotation.repairState ??= 'ok';
    }
    return { kind: 'package', pkg };
  }
  const migrated = migrateDocument(data);
  if ('error' in migrated) return { kind: 'error', error: migrated.error };
  return { kind: 'draft', document: migrated.document };
}

/** 逐条校验批注包：锚点是否失效、跨引用是否断开、是否重复导入。 */
export function buildMergeItems(document: TextDocument, pkg: AnnotationPackage): MergeItem[] {
  const existingStable = new Set<string>();
  for (const annotation of document.annotations) {
    if (annotation.stableId) existingStable.add(annotation.stableId);
  }
  const validRefs = new Set<string>();
  for (const annotation of document.annotations) {
    validRefs.add(annotation.id);
    if (annotation.stableId) validRefs.add(annotation.stableId);
  }
  for (const annotation of pkg.annotations) {
    validRefs.add(annotation.id);
    if (annotation.stableId) validRefs.add(annotation.stableId);
  }

  const seen = new Set<string>();
  return pkg.annotations.map((annotation, index) => {
    const stableId = annotation.stableId!;
    const messages: string[] = [];
    let anchorState: AnchorState = 'ok';
    let repairState: RepairState = 'ok';
    const duplicate = existingStable.has(stableId) || seen.has(stableId);
    seen.add(stableId);
    if (duplicate) messages.push('与已有批注稳定身份相同，重复导入只生效一次');

    const resolved = resolveAnchor(document, annotation.anchorId, annotation.anchorType);
    if (!resolved) {
      anchorState = 'stale';
      messages.push('正文锚点已失效：当前底本中找不到对应的章节、句子或词语，待确认后重新锚定');
    } else if (
      annotation.anchorType !== 'chapter' &&
      annotation.anchorMismatch?.expectedText !== undefined &&
      annotation.anchorMismatch.expectedText !== resolved.actualText
    ) {
      anchorState = 'stale';
      messages.push(`正文已有改动：“${annotation.anchorMismatch.expectedText}” → “${resolved.actualText}”，待确认`);
    }

    const missing = annotation.references.filter((ref) => !validRefs.has(ref));
    if (missing.length) {
      repairState = 'broken';
      messages.push(`跨引用断开：${missing.map((id) => `“${id}”`).join('、')} 在底本与批注包中均不存在，待修`);
    }

    return {
      key: `${stableId}-${index}`,
      stableId,
      annotation,
      decision: 'pending',
      anchorState,
      repairState,
      duplicate,
      messages
    };
  });
}

/** 旧版离线草稿升级为批注包格式后再导入。 */
export function draftToPackage(document: TextDocument, fileName: string): AnnotationPackage {
  const collator = fileName.replace(/\.json$/i, '') || '旧版草稿';
  return {
    format: 'jigu-annotation-package',
    formatVersion: 1,
    baseVersionId: document.snapshots[0]?.id ?? '',
    baseFingerprint: fingerprintDocument(document),
    baseLabel: document.edition,
    exportedAt: document.updatedAt,
    collator,
    annotations: document.annotations.map((annotation) => ({ ...annotation, adjudicationState: 'pending' as const }))
  };
}

/** 导出批注包：仅包含已裁定意见，引用转换为稳定身份。 */
export function exportPackage(document: TextDocument, collator: string): AnnotationPackage {
  const idToStable = new Map<string, string>();
  for (const annotation of document.annotations) {
    if (annotation.stableId) idToStable.set(annotation.id, annotation.stableId);
  }
  return {
    format: 'jigu-annotation-package',
    formatVersion: 1,
    baseVersionId: document.snapshots[0]?.id ?? '',
    baseFingerprint: fingerprintDocument(document),
    baseLabel: document.edition,
    exportedAt: new Date().toISOString(),
    collator,
    annotations: document.annotations
      .filter((annotation) => isAdjudicated(annotation))
      .map((annotation) => ({
        ...annotation,
        references: annotation.references.map((ref) => idToStable.get(ref) ?? ref)
      }))
  };
}
