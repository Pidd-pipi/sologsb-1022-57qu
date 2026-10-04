'use client';

import {
  Button,
  Card,
  CardBody,
  Chip,
  Divider,
  Select,
  SelectItem,
  Tooltip
} from '@heroui/react';
import {
  AlertTriangle,
  Check,
  Download,
  FileJson,
  Inbox,
  Link2Off,
  ListChecks,
  RotateCcw,
  ShieldCheck,
  Upload,
  X
} from 'lucide-react';
import { useRef, useState } from 'react';
import { annotationKindLabels } from '@/lib/data';
import { sessionCounts } from '@/lib/merge';
import { kindLabel } from '@/lib/editor';
import { samplePackageOptions } from '@/lib/sample-packages';
import type {
  AnchorType,
  Annotation,
  MergeDecision,
  MergeItem,
  MergeSession,
  TextDocument
} from '@/lib/types';

const kindColors: Record<string, 'primary' | 'warning' | 'secondary' | 'success'> = {
  footnote: 'primary',
  variant: 'warning',
  background: 'secondary',
  crossref: 'success'
};

const statusCopy: Record<MergeItem['status'], { label: string; color: 'success' | 'warning' | 'danger' | 'default' }> = {
  fresh: { label: '锚点有效', color: 'success' },
  stale: { label: '失效待确认', color: 'warning' },
  missing: { label: '锚点已缺失', color: 'danger' },
  duplicate: { label: '重复导入', color: 'default' }
};

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface MergePanelProps {
  document: TextDocument;
  session: MergeSession | null;
  feedback: string;
  onImportText: (text: string) => void;
  onDecide: (localOriginId: string, decision: MergeDecision) => void;
  onRetarget: (localOriginId: string, anchorId: string, anchorType: AnchorType) => void;
  onApply: () => void;
  onCancel: () => void;
  onRestoreCheckpoint: () => void;
  onRepairBroken: (annotationId: string, originId: string, targetAnnotationId: string | null) => void;
}

export function MergePanel({
  document,
  session,
  feedback,
  onImportText,
  onDecide,
  onRetarget,
  onApply,
  onCancel,
  onRestoreCheckpoint,
  onRepairBroken
}: MergePanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [retargetSelection, setRetargetSelection] = useState<Record<string, string>>({});
  const counts = sessionCounts(session);
  const brokenAnnotations = document.annotations.filter((annotation) => annotation.brokenReferences?.length);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onImportText(String(reader.result ?? ''));
    reader.readAsText(file, 'utf-8');
  }

  return (
    <div className="space-y-4 pr-1">
      {/* 导入区 */}
      <div className="rounded-xl border border-stone-200 p-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
          <Inbox className="h-4 w-4" />导入离线批注包
        </h3>
        <p className="mt-1 text-[11px] leading-5 text-stone-500">
          包内带基准版本、稳定身份与锚点校验和。正文改过的旧锚点只挂起待确认，不会遮住底本或硬接到别句；重复导入同一条只生效一次。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="选择批注包 JSON 文件"
          onChange={(event) => {
            handleFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <Button
          size="sm"
          color="primary"
          variant="flat"
          className="mt-3 w-full"
          startContent={<Upload className="h-4 w-4" />}
          onPress={() => fileRef.current?.click()}
        >
          选择批注包文件
        </Button>
        <div className="mt-2 space-y-1.5">
          {samplePackageOptions.map((option) => (
            <div key={option.key} className="flex items-center gap-1">
              <Tooltip content={option.description}>
                <Button
                  size="sm"
                  variant="light"
                  className="flex-1 justify-start text-xs"
                  onPress={() => onImportText(JSON.stringify(option.build(), null, 2))}
                >
                  {option.label}
                </Button>
              </Tooltip>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                aria-label={`下载${option.label}`}
                onPress={() =>
                  downloadFile(
                    `${option.key}.json`,
                    JSON.stringify(option.build(), null, 2),
                    'application/json;charset=utf-8'
                  )
                }
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        {feedback ? <p className="mt-2 text-[11px] leading-5 text-amber-700">{feedback}</p> : null}
      </div>

      {/* 待修交叉引用（已认领后留下的断链） */}
      {brokenAnnotations.length ? (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <Link2Off className="h-4 w-4" />断链待修（{brokenAnnotations.length}）
          </h3>
          <div className="mt-2 space-y-2">
            {brokenAnnotations.map((annotation) => (
              <BrokenRefCard
                key={annotation.id}
                annotation={annotation}
                document={document}
                onRepair={(originId, targetId) => onRepairBroken(annotation.id, originId, targetId)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* 合并会话 */}
      {session ? (
        <>
          <Card shadow="none" className="border border-amber-200 bg-amber-50/50">
            <CardBody className="gap-2 p-3 text-xs text-stone-700">
              <div className="flex items-center gap-2 font-semibold text-stone-900">
                <ShieldCheck className="h-4 w-4 text-amber-700" />
                {session.author} · 逐条认领
              </div>
              <p>{session.note}</p>
              <div className="flex flex-wrap gap-1.5">
                <Chip size="sm" variant="flat" color="warning">待裁定 {counts.pending}</Chip>
                <Chip size="sm" variant="flat" color="success">认领 {counts.accept}</Chip>
                <Chip size="sm" variant="flat">不采用 {counts.reject}</Chip>
                {counts.stale ? <Chip size="sm" variant="flat" color="warning">失效 {counts.stale}</Chip> : null}
                {counts.missing ? <Chip size="sm" variant="flat" color="danger">缺失 {counts.missing}</Chip> : null}
                {counts.duplicate ? <Chip size="sm" variant="flat">去重 {counts.duplicate}</Chip> : null}
                {counts.brokenRefs ? <Chip size="sm" variant="flat" color="danger">断链 {counts.brokenRefs}</Chip> : null}
              </div>
              <div className="mt-1 flex gap-2">
                <Button
                  size="sm"
                  color="primary"
                  startContent={<Check className="h-4 w-4" />}
                  isDisabled={counts.pending > 0}
                  onPress={onApply}
                >
                  完成合并
                </Button>
                <Button size="sm" variant="light" startContent={<RotateCcw className="h-4 w-4" />} onPress={onRestoreCheckpoint}>
                  回到检查点
                </Button>
                <Button size="sm" isIconOnly variant="light" aria-label="关闭合并会话" onPress={onCancel}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[11px] leading-5 text-stone-500">
                {counts.pending
                  ? `还有 ${counts.pending} 条未裁定；未裁定意见不会进入校勘版与导出，也不会遮挡底本。`
                  : '已全部裁定，可完成合并；合并前检查点已随快照保留，失败可恢复原草稿。'}
              </p>
            </CardBody>
          </Card>

          <div className="space-y-3">
            {session.items.map((item) => (
              <MergeItemCard
                key={item.localOriginId}
                item={item}
                retargetValue={retargetSelection[item.localOriginId] ?? ''}
                onRetargetValueChange={(value) =>
                  setRetargetSelection((prev) => ({ ...prev, [item.localOriginId]: value }))
                }
                onDecide={(decision) => onDecide(item.localOriginId, decision)}
                onRetarget={(anchorId, anchorType) => {
                  onRetarget(item.localOriginId, anchorId, anchorType);
                  setRetargetSelection((prev) => ({ ...prev, [item.localOriginId]: '' }));
                }}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="grid place-items-center rounded-xl border border-dashed border-stone-300 p-8 text-center">
          <ListChecks className="h-8 w-8 text-stone-400" />
          <p className="mt-2 text-sm font-medium text-stone-700">当前没有进行中的合并</p>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            导入批注包后在此逐条认领章、句、词意见；会话自动存为离线草稿，关掉重开可接着处理。
          </p>
        </div>
      )}

      <Divider />
      <p className="text-[11px] leading-5 text-stone-500">
        已认领意见以“已裁定”身份进入正文注释，校勘版、阅读版与 HTML/JSON 导出生效；未裁定项只停留在本清单。
      </p>
    </div>
  );
}

interface MergeItemCardProps {
  item: MergeItem;
  retargetValue: string;
  onRetargetValueChange: (value: string) => void;
  onDecide: (decision: MergeDecision) => void;
  onRetarget: (anchorId: string, anchorType: AnchorType) => void;
}

function MergeItemCard({ item, retargetValue, onRetargetValueChange, onDecide, onRetarget }: MergeItemCardProps) {
  const copy = statusCopy[item.status];
  const needsRetarget = item.health !== 'fresh' && item.status !== 'duplicate';
  const acceptDisabled = item.status === 'duplicate' || needsRetarget;

  return (
    <Card
      shadow="none"
      className={`border ${
        item.decision === 'accept'
          ? 'border-green-300 bg-green-50/40'
          : item.decision === 'reject'
            ? 'border-stone-200 bg-stone-50'
            : 'border-amber-200 bg-white'
      }`}
    >
      <CardBody className="gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" color={kindColors[item.kind]} variant="flat">{annotationKindLabels[item.kind]}</Chip>
          <Chip size="sm" color={copy.color} variant={item.status === 'duplicate' ? 'flat' : 'bordered'}>{copy.label}</Chip>
          <span className="ml-auto text-[11px] text-stone-500">{item.source}</span>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-stone-900">{item.title}</h4>
          <p className="mt-1 text-xs leading-5 text-stone-700">{item.body}</p>
        </div>

        <div className="rounded-lg bg-stone-100/80 p-2 text-[11px] leading-5 text-stone-600">
          <div>目标：{item.anchorLabel}</div>
          {item.health === 'fresh' ? (
            <div>现稿正文：<span className="font-serif">{item.currentQuote}</span></div>
          ) : null}
          {item.health === 'stale' ? (
            <>
              <div className="text-amber-700">批注所据旧文：<span className="font-serif">{item.anchor.quote}</span></div>
              <div className="text-stone-500">现稿正文：<span className="font-serif">{item.currentQuote || '（已找不到）'}</span></div>
            </>
          ) : null}
          {item.health === 'missing' ? (
            <div className="flex items-center gap-1 text-red-700">
              <AlertTriangle className="h-3 w-3" />旧锚点在现稿中不存在，请人工改挂，系统不会自动接到其他句子。
            </div>
          ) : null}
          <div className="text-stone-400">稳定身份：{item.originId}</div>
        </div>

        {needsRetarget ? (
          <div className="flex items-center gap-2">
            <Select
              aria-label="改挂到其他目标"
              label="人工改挂"
              labelPlacement="outside-left"
              size="sm"
              classNames={{ base: 'flex-1' }}
              selectedKeys={retargetValue ? new Set([retargetValue]) : new Set()}
              onSelectionChange={(keys) => onRetargetValueChange(String(Array.from(keys)[0] ?? ''))}
            >
              {item.retargetOptions.map((option) => (
                <SelectItem key={`${option.anchorType}:${option.anchorId}`}>{option.label}</SelectItem>
              ))}
            </Select>
            <Button
              size="sm"
              variant="flat"
              color="warning"
              isDisabled={!retargetValue}
              onPress={() => {
                const [type, ...rest] = retargetValue.split(':');
                onRetarget(rest.join(':'), type as AnchorType);
              }}
            >
              改挂
            </Button>
          </div>
        ) : null}

        {item.brokenRefs.length ? (
          <div className="flex items-start gap-1 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] leading-5 text-red-700">
            <Link2Off className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              {item.brokenRefs.length} 条交叉引用断开：
              {item.brokenRefs.map((ref) => `「${ref.title}」(${ref.originId})`).join('、')}
              ；认领后进入“断链待修”。
            </span>
          </div>
        ) : null}

        {item.note ? <p className="text-[11px] text-stone-500">{item.note}</p> : null}

        <div className="flex gap-2">
          <Button
            size="sm"
            color={item.decision === 'accept' ? 'success' : 'primary'}
            variant={item.decision === 'accept' ? 'solid' : 'flat'}
            startContent={<Check className="h-3.5 w-3.5" />}
            isDisabled={acceptDisabled}
            onPress={() => onDecide('accept')}
          >
            认领
          </Button>
          <Button
            size="sm"
            variant={item.decision === 'reject' ? 'solid' : 'light'}
            color={item.decision === 'reject' ? 'danger' : 'default'}
            startContent={<X className="h-3.5 w-3.5" />}
            onPress={() => onDecide('reject')}
          >
            {item.status === 'duplicate' ? '已存在（跳过）' : '不采用'}
          </Button>
        </div>
        {acceptDisabled && item.status !== 'duplicate' ? (
          <p className="text-[11px] text-amber-700">失效 / 缺失锚点须先人工改挂，方可认领。</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

interface BrokenRefCardProps {
  annotation: Annotation;
  document: TextDocument;
  onRepair: (originId: string, targetAnnotationId: string | null) => void;
}

function BrokenRefCard({ annotation, document, onRepair }: BrokenRefCardProps) {
  const [targetKey, setTargetKey] = useState('');
  const broken = annotation.brokenReferences ?? [];

  return (
    <div className="rounded-lg border border-red-200 bg-white p-2 text-[11px] text-stone-700">
      <div className="font-semibold text-stone-900">{annotation.title}</div>
      <div className="mt-1 space-y-1">
        {broken.map((originId) => (
          <div key={originId} className="flex flex-wrap items-center gap-1">
            <span className="text-red-700">断链：{originId}</span>
            <Button size="sm" variant="light" color="danger" onPress={() => onRepair(originId, null)}>
              移除该引用
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Select
          aria-label="改指到其他注释"
          label="改指"
          labelPlacement="outside-left"
          size="sm"
          classNames={{ base: 'flex-1' }}
          selectedKeys={targetKey ? new Set([targetKey]) : new Set()}
          onSelectionChange={(keys) => setTargetKey(String(Array.from(keys)[0] ?? ''))}
        >
          {document.annotations
            .filter((item) => item.id !== annotation.id)
            .map((item) => (
              <SelectItem key={item.id}>{`${kindLabel(item.kind)} · ${item.title}（${item.source}）`}</SelectItem>
            ))}
        </Select>
        <Button
          size="sm"
          variant="flat"
          startContent={<FileJson className="h-3.5 w-3.5" />}
          isDisabled={!targetKey || !broken.length}
          onPress={() => {
            onRepair(broken[0], targetKey);
            setTargetKey('');
          }}
        >
          改指
        </Button>
      </div>
    </div>
  );
}
