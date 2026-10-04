import type { AnchorType, AnnotationKind, AnnotationPackage, IncomingAnnotation, PackageAnchor } from './types';
import { initialDocument } from './data';
import { buildAnchor, checksum } from './merge';

const BASE_AT = '2026-09-20T08:00:00.000Z';
const EXPORT_AT = '2026-09-22T18:00:00.000Z';

function requireAnchor(anchorId: string, anchorType: AnchorType): PackageAnchor {
  const anchor = buildAnchor(initialDocument, anchorId, anchorType);
  if (!anchor) throw new Error(`样例锚点缺失：${anchorType} ${anchorId}`);
  return anchor;
}

function tokenIn(sentenceId: string, text: string): string {
  for (const chapter of initialDocument.chapters) {
    const sentence = chapter.sentences.find((item) => item.id === sentenceId);
    if (sentence) {
      const token = sentence.tokens.find((item) => item.text.includes(text)) ?? sentence.tokens[0];
      return token.id;
    }
  }
  throw new Error(`样例句缺失：${sentenceId}`);
}

function staleCopy(anchor: PackageAnchor): PackageAnchor {
  // 模拟底本已改动：锚点身份还在，但原句已与批注制作时不同（改坏校验和与引用）。
  return {
    ...anchor,
    quote: `${anchor.quote}（旧稿用字）`,
    checksum: checksum(`${anchor.anchorId}|旧稿用字，仅用于演示失效`)
  };
}

function entry(
  originId: string,
  anchor: PackageAnchor,
  kind: AnnotationKind,
  title: string,
  body: string,
  source: string,
  references: string[] = [],
  tags: string[] = []
): IncomingAnnotation {
  return { originId, anchor, kind, title, body, source, references, tags };
}

/** 校注员甲：锚点全部有效，含对底本原注与包内意见的交叉引用。 */
export function packageFromEditorA(): AnnotationPackage {
  return {
    format: 'guji-annotation-package',
    packageVersion: 1,
    documentId: initialDocument.id,
    baseEdition: '整理底本 v1',
    baseAt: BASE_AT,
    author: '校注员甲',
    exportedAt: EXPORT_AT,
    annotations: [
      entry(
        'pkg-a/fn-peng-back',
        requireAnchor('sentence-1-3', 'sentence'),
        'footnote',
        '化而为鸟·补充训释',
        '化，旧读 huà，谓鱼鸟之化非实指形变，乃境界之转。甲按：与篇首“鲲鹏”寓言相发。',
        '甲氏札记',
        ['annotation-1'],
        ['训诂']
      ),
      entry(
        'pkg-a/variant-nanming',
        requireAnchor('sentence-1-6', 'sentence'),
        'variant',
        '天池异文',
        '《释文》引崔譔本“天池”作“天地之池”，于义为长，可存异文而不改底本。',
        '甲氏札记',
        ['pkg-a/bg-water', 'annotation-5'],
        ['异文', '校记']
      ),
      entry(
        'pkg-a/bg-water',
        requireAnchor('sentence-1-6', 'sentence'),
        'background',
        '南冥与天池',
        '南冥既为极远之地，“天池”言其非人力所能至，承前文海运、垂天之云的想象尺度。',
        '甲氏札记',
        [],
        ['义理']
      ),
      entry(
        'pkg-a/word-jingliu',
        requireAnchor(tokenIn('sentence-3-2', '泾流'), 'word'),
        'variant',
        '泾 / 径',
        '“泾流”之泾，《释文》云“泾，音经”，或本作“径”。二字古通，言直流也。',
        '甲氏札记',
        ['annotation-8'],
        ['通假']
      )
    ]
  };
}

/** 校注员乙：含重复导入项、失效锚点（底本已改）、断开引用与跨包回连。 */
export function packageFromEditorB(): AnnotationPackage {
  return {
    format: 'guji-annotation-package',
    packageVersion: 1,
    documentId: initialDocument.id,
    baseEdition: '整理底本 v1',
    baseAt: BASE_AT,
    author: '校注员乙',
    exportedAt: EXPORT_AT,
    annotations: [
      entry(
        'pkg-a/fn-peng-back', // 与甲包同稳定身份：再次导入只生效一次
        requireAnchor('sentence-1-3', 'sentence'),
        'footnote',
        '化而为鸟·补充训释',
        '乙转抄甲稿，同一条意见，用于演示重复导入去重。',
        '乙氏过录',
        ['annotation-1']
      ),
      entry(
        'pkg-b/fn-nanming-new',
        requireAnchor('sentence-1-6', 'sentence'),
        'footnote',
        '天池另说',
        '乙谓“天池”犹言造化所成，不专指方域；与甲之异文校记可并存。',
        '乙氏手校',
        ['pkg-a/variant-nanming'], // 跨包引用：甲包已合并时自动回连
        ['义理']
      ),
      entry(
        'pkg-b/stale-qiushui',
        staleCopy(requireAnchor('sentence-3-1', 'sentence')),
        'background',
        '秋水时至·背景（锚点失效）',
        '乙据改前底本立条：秋水“时”字重读，言应候而至。底本修订后此条锚点失效待确认。',
        '乙氏手校',
        [],
        ['背景']
      ),
      entry(
        'pkg-b/stale-word-bian',
        staleCopy(requireAnchor(tokenIn('sentence-3-2', '辩'), 'word')),
        'variant',
        '辩字旧校（词锚点失效）',
        '乙在改前“辩”字下记：一本作“辨”。底本既改，须人工改挂，不得遮住现稿。',
        '乙氏手校',
        [],
        ['异体字']
      ),
      entry(
        'pkg-b/broken-ref',
        requireAnchor('sentence-2-5', 'sentence'),
        'crossref',
        '道恶乎隐·互见（断链）',
        '乙引另一台机器上已删除的意见作互证，目标稳定身份在本稿与本包均不存在。',
        '乙氏手校',
        ['pkg-x/deleted-note'],
        ['互见']
      )
    ]
  };
}

/** 旧版（v0）批注包：字段名与结构均不同，导入时自动升级。 */
export function legacyPackageV0(): unknown {
  const anchor = buildAnchor(initialDocument, 'sentence-1-2', 'sentence');
  return {
    format: 'guji-annotation-package',
    packageVersion: 0,
    baseEdition: '2024 试编底本',
    baseAt: '2024-11-01T00:00:00.000Z',
    author: '旧整理机',
    annotations: [
      {
        uid: 'old-2024-001',
        noteType: 'footnote',
        heading: '几千里·旧稿补注',
        text: '旧稿按：“不知其几千里”乃夸饰之辞，所以状大，非实数。',
        provenance: '2024 试编札记',
        keywords: ['训诂', '旧稿'],
        links: [],
        target: { type: 'sentence', chapter: 'chapter-1', sentence: 'sentence-1-2' }
      },
      {
        uid: 'old-2024-002',
        noteType: 'variant',
        heading: '鹏凤旧校',
        text: '旧稿存“鹏、凤、朋”三形，未加按断，备参。',
        provenance: '2024 试编札记',
        keywords: ['异文'],
        links: ['old-2024-001'],
        target: { type: 'token', chapter: 'chapter-1', sentence: 'sentence-1-3', token: tokenIn('sentence-1-3', '鹏') }
      }
    ]
  };
}

export interface SampleOption {
  key: string;
  label: string;
  description: string;
  build: () => unknown;
}

export const samplePackageOptions: SampleOption[] = [
  {
    key: 'editor-a',
    label: '载入样例：校注员甲',
    description: '锚点全部有效，含包内互引与对底本原注的引用。',
    build: packageFromEditorA
  },
  {
    key: 'editor-b',
    label: '载入样例：校注员乙',
    description: '含重复导入、句/词失效锚点、断开引用与跨包回连。',
    build: packageFromEditorB
  },
  {
    key: 'legacy-v0',
    label: '载入样例：旧版离线草稿（v0）',
    description: '字段与结构均为旧版，导入时自动升级为 v1。',
    build: legacyPackageV0
  }
];
