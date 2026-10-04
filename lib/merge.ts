import type {
  AnchorType,
  Annotation,
  AnnotationKind,
  AnnotationPackage,
  IncomingAnnotation,
  MergeItem,
  MergeReport,
  MergeSession,
  PackageAnchor,
  Sentence,
  TextDocument,
  VersionSnapshot
} from './types';

/* ---------------- 校验和 ---------------- */

/** 对锚点关键身份做 FNV-1a 校验和，正文一旦改动即可识别旧锚点失效。 */
export function checksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

interface LocatedTarget {
  chapterId: string;
  sentenceId?: string;
  quote: string;
  signature: string;
}

function locateTarget(document: TextDocument, anchorId: string, anchorType: AnchorType): LocatedTarget | null {
  if (anchorType === 'chapter') {
    const chapter = document.chapters.find((item) => item.id === anchorId);
    if (!chapter) return null;
    return {
      chapterId: chapter.id,
      quote: chapter.title,
      signature: `${chapter.id}|${chapter.title}|${chapter.summary}`
    };
  }

  for (const chapter of document.chapters) {
    if (anchorType === 'sentence') {
      const sentence = chapter.sentences.find((item) => item.id === anchorId);
      if (sentence) {
        return {
          chapterId: chapter.id,
          sentenceId: sentence.id,
          quote: sentence.text,
          signature: `${sentence.id}|${sentence.text}`
        };
      }
      continue;
    }
    for (const sentence of chapter.sentences) {
      const token = sentence.tokens.find((item) => item.id === anchorId);
      if (token) {
        return {
          chapterId: chapter.id,
          sentenceId: sentence.id,
          quote: token.text.trim(),
          signature: `${token.id}|${token.text.trim()}`
        };
      }
    }
  }
  return null;
}

/** 现稿对某锚点应有的校验和；目标不存在时返回 null。 */
export function expectedAnchorChecksum(document: TextDocument, anchorId: string, anchorType: AnchorType): string | null {
  const target = locateTarget(document, anchorId, anchorType);
  return target ? checksum(target.signature) : null;
}

/** 供导出批注包时构造锚点（正文引用 + 校验和 + 章节路径）。 */
export function buildAnchor(document: TextDocument, anchorId: string, anchorType: AnchorType): PackageAnchor | null {
  const target = locateTarget(document, anchorId, anchorType);
  if (!target) return null;
  return {
    anchorId,
    anchorType,
    quote: target.quote,
    checksum: checksum(target.signature),
    chapterId: target.chapterId,
    sentenceId: target.sentenceId
  };
}

/* ---------------- 锚点核对 ---------------- */

interface AnchorVerification {
  health: MergeItem['health'];
  anchorLabel: string;
  currentQuote: string;
  retargetOptions: MergeItem['retargetOptions'];
}

function sentenceLabel(document: TextDocument, sentence: Sentence) {
  const chapter = document.chapters.find((item) => item.sentences.some((entry) => entry.id === sentence.id));
  return `${chapter?.title ?? '未知章'} · 第 ${sentence.order} 句`;
}

function allSentenceOptions(document: TextDocument, focusChapterId?: string): MergeItem['retargetOptions'] {
  return document.chapters.flatMap((chapter) =>
    chapter.sentences.map((sentence) => ({
      anchorId: sentence.id,
      anchorType: 'sentence' as AnchorType,
      label: `${chapter.title} · 第 ${sentence.order} 句`
    }))
  ).sort((a, b) => {
    if (!focusChapterId) return 0;
    return a.label.startsWith(document.chapters.find((c) => c.id === focusChapterId)?.title ?? '') ? -1 : 1;
  });
}

function wordOptions(document: TextDocument, sentenceId?: string): MergeItem['retargetOptions'] {
  const options: MergeItem['retargetOptions'] = [];
  for (const chapter of document.chapters) {
    for (const sentence of chapter.sentences) {
      if (sentenceId && sentence.id !== sentenceId) continue;
      for (const token of sentence.tokens) {
        if (!token.text.trim()) continue;
        options.push({
          anchorId: token.id,
          anchorType: 'word',
          label: `${chapter.title} · “${token.text.trim()}”`
        });
      }
    }
  }
  return options.slice(0, 40);
}

export function verifyAnchor(document: TextDocument, anchor: PackageAnchor): AnchorVerification {
  const target = locateTarget(document, anchor.anchorId, anchor.anchorType);

  if (!target) {
    // 旧锚点在现稿中已找不到：只能人工改挂，绝不自动接到别的句子上。
    return {
      health: 'missing',
      anchorLabel: '锚点已缺失',
      currentQuote: '',
      retargetOptions:
        anchor.anchorType === 'chapter'
          ? document.chapters.map((chapter) => ({ anchorId: chapter.id, anchorType: 'chapter' as AnchorType, label: chapter.title }))
          : allSentenceOptions(document, anchor.chapterId)
    };
  }

  const currentChecksum = checksum(target.signature);
  const anchorLabel =
    anchor.anchorType === 'chapter'
      ? document.chapters.find((item) => item.id === anchor.anchorId)?.title ?? target.quote
      : anchor.anchorType === 'sentence'
        ? sentenceLabel(document, document.chapters.flatMap((c) => c.sentences).find((s) => s.id === anchor.anchorId)!)
        : `“${target.quote}”`;

  if (currentChecksum === anchor.checksum) {
    return { health: 'fresh', anchorLabel, currentQuote: target.quote, retargetOptions: [] };
  }

  // 身份仍在、正文已变：失效待确认，候选只给同句词语与句子本身，防止硬接到别处。
  return {
    health: 'stale',
    anchorLabel,
    currentQuote: target.quote,
    retargetOptions:
      anchor.anchorType === 'chapter'
        ? document.chapters.map((chapter) => ({ anchorId: chapter.id, anchorType: 'chapter' as AnchorType, label: chapter.title }))
        : [
            ...wordOptions(document, target.sentenceId),
            ...(target.sentenceId
              ? [{ anchorId: target.sentenceId, anchorType: 'sentence' as AnchorType, label: sentenceLabel(document, document.chapters.flatMap((c) => c.sentences).find((s) => s.id === target.sentenceId)!) }]
              : [])
          ]
  };
}

/* ---------------- 旧版草稿 / 旧包迁移 ---------------- */

interface ParseResult {
  pkg?: AnnotationPackage;
  error?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 把旧版（v0）批注包升级为 v1；旧包没有校验和，按“基准版本 + 稳定身份”尽量补齐。 */
function migrateLegacyPackageV0(raw: Record<string, unknown>, document: TextDocument): AnnotationPackage {
  const items = Array.isArray(raw.annotations) ? (raw.annotations as Record<string, unknown>[]) : [];
  const annotations: IncomingAnnotation[] = items.map((item, index) => {
    const target = isObject(item.target) ? item.target : {};
    const rawType = String(target.type);
    const anchorType: AnchorType =
      rawType === 'chapter' ? 'chapter' : rawType === 'token' || rawType === 'word' ? 'word' : 'sentence';
    const anchorId = String(target.token ?? target.word ?? target.sentence ?? target.chapter ?? '');
    const kind = (['footnote', 'variant', 'background', 'crossref'].includes(String(item.noteType))
      ? String(item.noteType)
      : 'footnote') as AnnotationKind;
    const anchor = buildAnchor(document, anchorId, anchorType) ?? {
      anchorId,
      anchorType,
      quote: String(item.heading ?? ''),
      checksum: '',
      chapterId: String(target.chapter ?? document.chapters[0]?.id ?? '')
    };
    return {
      originId: String(item.uid ?? `legacy-v0-${index + 1}`),
      anchor,
      kind,
      title: String(item.heading ?? '旧版批注'),
      body: String(item.text ?? ''),
      source: String(item.provenance ?? '旧版离线草稿'),
      references: Array.isArray(item.links) ? item.links.map(String) : [],
      tags: Array.isArray(item.keywords) ? item.keywords.map(String) : []
    };
  });

  return {
    format: 'guji-annotation-package',
    packageVersion: 1,
    documentId: document.id,
    baseEdition: String(raw.baseEdition ?? '旧版离线草稿'),
    baseAt: String(raw.baseAt ?? new Date(0).toISOString()),
    author: String(raw.author ?? '旧版校注员'),
    exportedAt: new Date().toISOString(),
    annotations
  };
}

/** 把旧版本地工作区草稿（v1 之前的离线保存）整体升级为一个批注包。 */
function migrateLegacyDraft(raw: Record<string, unknown>, document: TextDocument): AnnotationPackage {
  const draftDocument = isObject(raw.document) ? raw.document : raw;
  const legacyAnnotations = Array.isArray(draftDocument.annotations)
    ? (draftDocument.annotations as Record<string, unknown>[])
    : [];
  const legacyIds = new Set(legacyAnnotations.map((item) => String(item.id)));

  const annotations: IncomingAnnotation[] = legacyAnnotations.map((item) => {
    const anchorType = (['chapter', 'sentence', 'word'].includes(String(item.anchorType))
      ? String(item.anchorType)
      : 'sentence') as AnchorType;
    const anchorId = String(item.anchorId ?? '');
    const anchor = buildAnchor(document, anchorId, anchorType) ?? {
      anchorId,
      anchorType,
      quote: String(item.title ?? ''),
      checksum: '',
      chapterId: document.chapters[0]?.id ?? ''
    };
    const references = Array.isArray(item.references)
      ? (item.references as unknown[])
          .map(String)
          // 旧本地 ID 改写为迁移后的稳定身份，能回连则回连
          .map((ref) => (legacyIds.has(ref) ? `legacy:${ref}` : ref))
      : [];
    return {
      originId: `legacy:${String(item.id)}`,
      anchor,
      kind: (['footnote', 'variant', 'background', 'crossref'].includes(String(item.kind))
        ? String(item.kind)
        : 'footnote') as AnnotationKind,
      title: String(item.title ?? '迁移批注'),
      body: String(item.body ?? ''),
      source: String(item.source ?? '旧版离线草稿'),
      references,
      tags: Array.isArray(item.tags) ? item.tags.map(String) : []
    };
  });

  return {
    format: 'guji-annotation-package',
    packageVersion: 1,
    documentId: document.id,
    baseEdition: '旧版本地草稿',
    baseAt: String(draftDocument.updatedAt ?? new Date(0).toISOString()),
    author: '旧版离线草稿升级',
    exportedAt: new Date().toISOString(),
    annotations
  };
}

/** 解析导入内容：支持 v1 批注包、v0 旧包与旧版本地草稿，失败返回错误信息。 */
export function parseAnnotationPackage(rawText: string, document: TextDocument): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { error: '文件不是有效的 JSON，导入已取消（原草稿未改动）。' };
  }
  if (!isObject(raw)) return { error: '批注包结构无法识别，导入已取消。' };

  if (raw.format === 'guji-annotation-package') {
    if (raw.packageVersion === 1) {
      if (!Array.isArray(raw.annotations)) return { error: '批注包缺少 annotations 列表。' };
      return { pkg: raw as unknown as AnnotationPackage };
    }
    if (raw.packageVersion === 0) return { pkg: migrateLegacyPackageV0(raw, document) };
    return { error: `不支持的批注包版本：${String(raw.packageVersion)}。` };
  }

  // 旧版本地工作区 / 文档草稿
  const draftDocument = isObject(raw.document) ? raw.document : raw;
  if (isObject(draftDocument) && Array.isArray(draftDocument.chapters) && Array.isArray(draftDocument.annotations)) {
    return { pkg: migrateLegacyDraft(raw, document) };
  }

  return { error: '未识别到批注包或旧版草稿，导入已取消。' };
}

/* ---------------- 合并会话 ---------------- */

/** 文档中已经登记过的“稳定身份 → 本地注释”账本，用于去重与引用回连。 */
export function originLedger(document: TextDocument): Map<string, Annotation> {
  const ledger = new Map<string, Annotation>();
  for (const annotation of document.annotations) {
    if (annotation.importOrigin) ledger.set(annotation.importOrigin, annotation);
  }
  return ledger;
}

export interface PreparedSession {
  session: MergeSession;
  checkpoint: VersionSnapshot;
}

/** 解析批注包为可逐条认领的合并会话，并同时生成合并前检查点（不落盘）。 */
export function prepareMergeSession(document: TextDocument, pkg: AnnotationPackage, now: string): PreparedSession {
  const ledger = originLedger(document);
  const incomingIds = new Set(pkg.annotations.map((item) => item.originId));
  const incomingTitles = new Map(pkg.annotations.map((item) => [item.originId, item.title]));
  const baseAnnotationIds = new Set(document.annotations.map((item) => item.id));
  const resolveTitle = (ref: string) => incomingTitles.get(ref) ?? document.annotations.find((item) => item.id === ref)?.title ?? '外部意见';

  const items: MergeItem[] = pkg.annotations.map((annotation) => {
    const duplicate = ledger.has(annotation.originId);
    const verification = verifyAnchor(document, annotation.anchor);
    const brokenRefs = annotation.references
      .filter((ref) => !ledger.has(ref) && !incomingIds.has(ref) && !baseAnnotationIds.has(ref))
      .map((ref) => ({ originId: ref, title: resolveTitle(ref) }));

    const status = duplicate ? 'duplicate' : verification.health === 'missing' ? 'missing' : verification.health === 'stale' ? 'stale' : 'fresh';

    return {
      ...annotation,
      localOriginId: annotation.originId,
      status,
      decision: duplicate ? 'reject' : 'pending',
      health: verification.health,
      anchorLabel: verification.anchorLabel,
      currentQuote: verification.currentQuote,
      retargetOptions: verification.retargetOptions,
      brokenRefs,
      note: duplicate
        ? `该稳定身份已在 ${ledger.get(annotation.originId)?.source ?? '本稿'} 中生效，重复导入只计一次。`
        : brokenRefs.length
          ? `${brokenRefs.length} 条交叉引用断开，待修。`
          : undefined
    };
  });

  const checkpointId = `checkpoint-merge-${Date.now().toString(36)}`;
  const checkpoint: VersionSnapshot = {
    id: checkpointId,
    label: `合并前检查点 · ${pkg.author}`,
    note: `导入 ${pkg.author} 的离线批注包（${pkg.baseEdition}）前自动留存，合并失败可回到此稿。`,
    createdAt: now,
    chapters: structuredClone(document.chapters),
    annotations: structuredClone(document.annotations)
  };

  const session: MergeSession = {
    id: `merge-${Date.now().toString(36)}`,
    createdAt: now,
    formatVersion: 1,
    author: pkg.author,
    baseEdition: pkg.baseEdition,
    baseAt: pkg.baseAt,
    note: `基准版本：${pkg.baseEdition}（${new Date(pkg.baseAt).toLocaleDateString('zh-CN')}）`,
    checkpointId,
    items
  };

  return { session, checkpoint };
}

export interface MergeCounts {
  total: number;
  pending: number;
  accept: number;
  reject: number;
  stale: number;
  missing: number;
  duplicate: number;
  brokenRefs: number;
}

export function sessionCounts(session: MergeSession | null): MergeCounts {
  const items = session?.items ?? [];
  return {
    total: items.length,
    pending: items.filter((item) => item.decision === 'pending').length,
    accept: items.filter((item) => item.decision === 'accept').length,
    reject: items.filter((item) => item.decision === 'reject').length,
    stale: items.filter((item) => item.status === 'stale').length,
    missing: items.filter((item) => item.status === 'missing').length,
    duplicate: items.filter((item) => item.status === 'duplicate').length,
    brokenRefs: items.reduce((sum, item) => sum + (item.decision === 'accept' ? item.brokenRefs.length : 0), 0)
  };
}

export function decideMergeItem(session: MergeSession, localOriginId: string, decision: MergeItem['decision']): MergeSession {
  return {
    ...session,
    items: session.items.map((item) => (item.localOriginId === localOriginId ? { ...item, decision } : item))
  };
}

/** 把失效 / 缺失锚点改挂到人工选定的目标；目标有效即转为可认领。 */
export function retargetMergeItem(
  document: TextDocument,
  session: MergeSession,
  localOriginId: string,
  anchorId: string,
  anchorType: AnchorType
): MergeSession {
  const anchor = buildAnchor(document, anchorId, anchorType);
  if (!anchor) return session;
  const verification = verifyAnchor(document, anchor);
  return {
    ...session,
    items: session.items.map((item) => {
      if (item.localOriginId !== localOriginId) return item;
      return {
        ...item,
        anchor,
        health: 'fresh',
        status: 'fresh',
        decision: item.decision === 'pending' ? 'pending' : item.decision,
        anchorLabel: verification.anchorLabel,
        currentQuote: verification.currentQuote,
        retargetOptions: [],
        note: `锚点已由人工确认改挂至：${verification.anchorLabel}。`
      };
    })
  };
}

/** 执行合并：仅当所有条目已裁定；返回生效明细。 */
export function applyMergeSession(document: TextDocument, session: MergeSession, now: string): MergeReport {
  const pending = session.items.filter((item) => item.decision === 'pending');
  if (pending.length) {
    throw new Error(`还有 ${pending.length} 条意见未裁定，未裁定意见不能进入校勘版。`);
  }
  const accepted = session.items.filter((item) => item.decision === 'accept' && item.status !== 'duplicate');
  const rejected = session.items.filter((item) => item.decision === 'reject');

  // 先生成新身份，保证同一批内互相引用也能回连
  const idByOrigin = new Map<string, string>();
  for (const ledgerAnnotation of originLedger(document)) {
    idByOrigin.set(ledgerAnnotation[0], ledgerAnnotation[1].id);
  }
  for (const annotation of document.annotations) {
    if (!annotation.importOrigin) idByOrigin.set(annotation.id, annotation.id);
  }
  for (const item of accepted) {
    idByOrigin.set(item.localOriginId, `annotation-${Date.now().toString(36)}-${idByOrigin.size.toString(36)}`);
  }

  let brokenRefsTotal = 0;
  for (const item of accepted) {
    const resolvedRefs: string[] = [];
    const broken: string[] = [];
    for (const ref of item.references) {
      const targetId = idByOrigin.get(ref);
      if (targetId) resolvedRefs.push(targetId);
      else broken.push(ref);
    }
    brokenRefsTotal += broken.length;

    const annotation: Annotation = {
      id: idByOrigin.get(item.localOriginId)!,
      anchorId: item.anchor.anchorId,
      anchorType: item.anchor.anchorType,
      kind: item.kind,
      title: item.title,
      body: item.body,
      source: item.source,
      references: resolvedRefs,
      status: 'resolved',
      tags: broken.length ? [...item.tags, '断链待修'] : item.tags,
      conflictState: 'resolved',
      conflictResolution: `${now} · 合并自“${session.author}”离线批注包，逐条认领通过`,
      importOrigin: item.localOriginId,
      brokenReferences: broken.length ? broken : undefined,
      updatedAt: now
    };
    document.annotations.push(annotation);
  }

  return {
    accepted: accepted.map((item) => item.localOriginId),
    rejected: rejected.map((item) => item.localOriginId),
    brokenRefs: brokenRefsTotal,
    duplicates: session.items.filter((item) => item.status === 'duplicate').length
  };
}
