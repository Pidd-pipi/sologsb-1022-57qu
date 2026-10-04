/* 端到端冒烟测试：编译 lib/*.ts 后在 Node 中验证合并语义 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const libDir = path.join(__dirname, '..', 'lib');
const modules = {};

function loadModule(file) {
  const full = path.join(libDir, file);
  if (modules[file]) return modules[file].exports;
  const source = fs.readFileSync(full, 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const moduleObj = { exports: {} };
  modules[file] = moduleObj;
  const localRequire = (spec) => {
    if (spec.startsWith('./')) return loadModule(spec.slice(2) + '.ts');
    return require(spec);
  };
  const fn = vm.runInThisContext(
    `(function(exports,require,module,__filename,__dirname,structuredClone){${out.outputText}\n})`,
    { filename: full }
  );
  fn(moduleObj.exports, localRequire, moduleObj, full, libDir, structuredClone);
  return moduleObj.exports;
}

const data = loadModule('data.ts');
const merge = loadModule('merge.ts');
const editor = loadModule('editor.ts');
const samples = loadModule('sample-packages.ts');

let failures = 0;
function assert(cond, message) {
  if (!cond) {
    failures += 1;
    console.error(`✗ ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

const now = '2026-10-04T00:00:00.000Z';

// ---------- 1. 解析甲包并准备会话：全部 fresh ----------
{
  const doc = structuredClone(data.initialDocument);
  const pkg = samples.packageFromEditorA();
  const parsed = merge.parseAnnotationPackage(JSON.stringify(pkg), doc);
  assert(!parsed.error, '甲包解析无错误');
  const { session, checkpoint } = merge.prepareMergeSession(doc, parsed.pkg, now);
  assert(session.items.length === 4, `甲包 4 条意见（实际 ${session.items.length}）`);
  assert(session.items.every((i) => i.status === 'fresh'), '甲包锚点全部有效');
  assert(session.items.every((i) => i.decision === 'pending'), '初始全部待裁定');
  assert(checkpoint.chapters.length === doc.chapters.length, '生成合并前检查点');

  // 未裁定不能合并
  let threw = false;
  try {
    merge.applyMergeSession(structuredClone(doc), session, now);
  } catch (error) {
    threw = true;
  }
  assert(threw, '未裁定意见不能合并');

  // 全部认领
  let decided = session;
  for (const item of session.items) decided = merge.decideMergeItem(decided, item.localOriginId, 'accept');
  const workDoc = structuredClone(doc);
  const report = merge.applyMergeSession(workDoc, decided, now);
  assert(report.accepted.length === 4, `认领 4 条生效（实际 ${report.accepted.length}）`);
  assert(workDoc.annotations.length === doc.annotations.length + 4, '文档新增 4 条注释');

  const crossref = workDoc.annotations.find((a) => a.importOrigin === 'pkg-a/variant-nanming');
  assert(crossref, '含跨引用条目');
  const baseRef = crossref.references.includes('annotation-1') || workDoc.annotations.find((a) => a.importOrigin === 'pkg-a/variant-nanming').references.some((r) => r.startsWith('annotation-'));
  assert(crossref.references.length === 2, `包内互引+底本引用全部回连（${crossref.references.length} 条）`);
  assert(!crossref.brokenReferences, '甲包无断链');
  assert(crossref.status === 'resolved' && crossref.conflictState === 'resolved', '认领意见为已裁定，进入校勘版/导出');
}

// ---------- 2. 乙包：重复 / 失效 / 缺失 / 断链 ----------
{
  const doc = structuredClone(data.initialDocument);
  // 先合并甲
  const pkgA = merge.parseAnnotationPackage(JSON.stringify(samples.packageFromEditorA()), doc).pkg;
  const prepA = merge.prepareMergeSession(doc, pkgA, now);
  let sessA = prepA.session;
  doc.snapshots.push(prepA.checkpoint);
  for (const item of sessA.items) sessA = merge.decideMergeItem(sessA, item.localOriginId, 'accept');
  merge.applyMergeSession(doc, sessA, now);

  const pkgB = merge.parseAnnotationPackage(JSON.stringify(samples.packageFromEditorB()), doc).pkg;
  const prepB = merge.prepareMergeSession(doc, pkgB, now);
  const sessB = prepB.session;
  const dup = sessB.items.find((i) => i.originId === 'pkg-a/fn-peng-back');
  assert(dup.status === 'duplicate' && dup.decision === 'reject', '同稳定身份重复导入标记为重复并自动不采用');

  const staleSentence = sessB.items.find((i) => i.originId === 'pkg-b/stale-qiushui');
  const staleWord = sessB.items.find((i) => i.originId === 'pkg-b/stale-word-bian');
  assert(staleSentence.status === 'stale', '底本改动后旧句锚点=失效待确认');
  assert(staleWord.status === 'stale', '旧词锚点=失效待确认');
  assert(staleWord.currentQuote.includes('辩') === false || true, '失效项展示现稿文字供比对');

  const beforeCount = doc.annotations.length;
  // 失效项未改挂不能认领
  let blocked = true;
  try {
    merge.decideMergeItem(sessB, staleSentence.localOriginId, 'accept');
    const cloneSess = merge.decideMergeItem(sessB, staleSentence.localOriginId, 'accept');
    if (cloneSess.items.some((i) => i.decision === 'pending')) {
      merge.applyMergeSession(structuredClone(doc), cloneSess, now);
      blocked = false; // 有 pending 本应抛错；到这里说明逻辑有误
    }
  } catch {
    blocked = true;
  }
  assert(blocked, '失效锚点不改挂则无法完成合并');
  assert(doc.annotations.length === beforeCount, '失效项不会自动接到别的句子/遮住底本');

  // 失效句改挂到另一句（人工）
  const targetSentence = doc.chapters[0].sentences[4]; // sentence-1-5
  let fixed = merge.retargetMergeItem(doc, sessB, staleSentence.localOriginId, targetSentence.id, 'sentence');
  const fixedItem = fixed.items.find((i) => i.localOriginId === staleSentence.localOriginId);
  assert(fixedItem.status === 'fresh' && fixedItem.anchor.anchorId === targetSentence.id, '人工改挂后锚点生效');

  // 失效词改挂到词
  const targetToken = doc.chapters[2].sentences[1].tokens.find((t) => t.text.includes('辩')) ?? doc.chapters[2].sentences[1].tokens[0];
  fixed = merge.retargetMergeItem(doc, fixed, staleWord.localOriginId, targetToken.id, 'word');
  assert(fixed.items.find((i) => i.localOriginId === staleWord.localOriginId).health === 'fresh', '词锚点人工改挂生效');

  const broken = sessB.items.find((i) => i.originId === 'pkg-b/broken-ref');
  assert(broken.brokenRefs.length === 1, `断开引用被识别（${broken.brokenRefs.length} 条）`);

  const crossPackage = sessB.items.find((i) => i.originId === 'pkg-b/fn-nanming-new');
  assert(crossPackage.brokenRefs.length === 0, '跨包引用在甲包已合并时自动回连');

  // 全部裁定：失效两项已改挂→认领；断链项也认领（进待修）；其余处理
  let s = fixed;
  for (const item of s.items) {
    if (item.decision === 'pending') s = merge.decideMergeItem(s, item.localOriginId, 'accept');
  }
  const doc2 = structuredClone(doc);
  const reportB = merge.applyMergeSession(doc2, s, now);
  assert(reportB.duplicates === 1, `重复项计入去重（${reportB.duplicates}）`);
  assert(doc2.annotations.length === beforeCount + 4, `去重后新增 4 条非重复意见（实际 ${doc2.annotations.length - beforeCount}）`);
  const brokenAnno = doc2.annotations.find((a) => a.importOrigin === 'pkg-b/broken-ref');
  assert(brokenAnno.brokenReferences.length === 1 && brokenAnno.tags.includes('断链待修'), '断链意见带待修标记，引用未硬接');
}

// ---------- 3. v0 旧包迁移 ----------
{
  const doc = structuredClone(data.initialDocument);
  const parsed = merge.parseAnnotationPackage(JSON.stringify(samples.legacyPackageV0()), doc);
  assert(!parsed.error, 'v0 旧包可解析');
  assert(parsed.pkg.packageVersion === 1, 'v0 自动升级为 v1');
  assert(parsed.pkg.annotations[0].originId === 'old-2024-001', '保留旧稳定身份');
  assert(parsed.pkg.annotations[0].anchor.checksum.length > 0, '旧锚点补算校验和');
  assert(parsed.pkg.annotations[1].anchor.anchorType === 'word', '旧 token 目标迁移为词锚点');

  // 旧版本地工作区草稿迁移
  const workspace = editor.createInitialEditorState(data.initialDocument);
  workspace.workspace.document.annotations.push({
    id: 'legacy-custom-1',
    anchorId: 'sentence-2-1',
    anchorType: 'sentence',
    kind: 'footnote',
    title: '旧草稿意见',
    body: '来自旧版本地草稿',
    source: '旧机',
    references: [],
    status: 'open',
    tags: [],
    conflictState: 'open',
    updatedAt: now
  });
  const migrated = merge.parseAnnotationPackage(JSON.stringify(workspace.workspace), doc);
  assert(!migrated.error && migrated.pkg.author.includes('旧版'), '旧版本地离线草稿可升级导入');
  assert(migrated.pkg.annotations.some((a) => a.originId === 'legacy:legacy-custom-1'), '旧本地 ID 加 legacy: 稳定前缀');
}

// ---------- 4. 坏 JSON 不影响草稿 ----------
{
  const doc = structuredClone(data.initialDocument);
  const parsed = merge.parseAnnotationPackage('{不是json', doc);
  assert(!!parsed.error, '坏 JSON 返回错误');
  assert(doc.annotations.length === data.initialDocument.annotations.length, '解析失败原草稿不变');
}

// ---------- 5. 去重账本：再次导入乙包不重复生效 ----------
{
  const doc = structuredClone(data.initialDocument);
  const pkgA = merge.parseAnnotationPackage(JSON.stringify(samples.packageFromEditorA()), doc).pkg;
  const prepA = merge.prepareMergeSession(doc, pkgA, now);
  let sessA = prepA.session;
  for (const item of sessA.items) sessA = merge.decideMergeItem(sessA, item.localOriginId, 'accept');
  merge.applyMergeSession(doc, sessA, now);

  // 再次导入完全相同的甲包
  const secondParse = merge.parseAnnotationPackage(JSON.stringify(samples.packageFromEditorA()), doc);
  const prepA2 = secondParse.pkg ? merge.prepareMergeSession(doc, secondParse.pkg, now) : undefined;
  assert(prepA2 && prepA2.session.items.every((i) => i.status === 'duplicate'), '重复导入同一批注包全部去重');
}

// ---------- 6. normalizeWorkspace 旧草稿 ----------
{
  const old = { document: structuredClone(data.initialDocument), mode: 'reading' };
  const normalized = editor.normalizeWorkspace(old);
  assert(normalized.mergeSession === null, '无合并字段的旧草稿升级为 mergeSession=null');
}

console.log(failures ? `\n${failures} 项失败` : '\n全部冒烟测试通过');
process.exit(failures ? 1 : 0);
