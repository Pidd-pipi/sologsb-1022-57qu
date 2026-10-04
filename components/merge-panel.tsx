'use client';

import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ScrollShadow
} from '@heroui/react';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  FileUp,
  Link2Off,
  RotateCcw,
  X
} from 'lucide-react';
import { annotationKindLabels } from '@/lib/data';
import { kindLabel } from '@/lib/editor';
import type { AdjudicationState, MergeCheckpoint } from '@/lib/types';

interface MergePanelProps {
  checkpoint: MergeCheckpoint;
  onClose: () => void;
  onDecide: (key: string, decision: AdjudicationState) => void;
  onDecideAll: (decision: AdjudicationState) => void;
  onCommit: () => void;
  onDiscard: () => void;
}

const decisionColors: Record<AdjudicationState, 'success' | 'danger' | 'default'> = {
  accepted: 'success',
  rejected: 'danger',
  pending: 'default'
};

const decisionLabels: Record<AdjudicationState, string> = {
  accepted: '已认领',
  rejected: '已驳回',
  pending: '待裁定'
};

export function MergePanel({ checkpoint, onClose, onDecide, onDecideAll, onCommit, onDiscard }: MergePanelProps) {
  const items = checkpoint.items;
  const counts = {
    total: items.length,
    duplicate: items.filter((item) => item.duplicate).length,
    stale: items.filter((item) => item.anchorState === 'stale').length,
    broken: items.filter((item) => item.repairState === 'broken').length,
    accepted: items.filter((item) => item.decision === 'accepted').length
  };
  const canCommit = checkpoint.status === 'staging' && counts.accepted > 0;

  return (
    <Modal isOpen onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <FileUp className="h-5 w-5 text-amber-700" />
          合并批注包
          <span className="ml-2 text-sm font-normal text-stone-500">{checkpoint.fileName}</span>
        </ModalHeader>

        <ModalBody>
          {checkpoint.status === 'failed' ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div>
                  <p className="font-semibold text-red-800">批注包合并失败</p>
                  <p className="mt-1 text-sm leading-6 text-red-700">{checkpoint.error}</p>
                  <p className="mt-2 text-xs text-red-600">
                    原草稿与检查点均已保留，关闭后可重新选择文件导入，或在「待确认」面板继续处理。
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="light" onPress={onDiscard}>放弃检查点</Button>
                <Button color="primary" onPress={onClose}>关闭</Button>
              </div>
            </div>
          ) : null}

          {checkpoint.status === 'staging' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs leading-6 text-stone-600">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip size="sm" variant="flat">来源：{checkpoint.packageMeta.collator || '未署名'}</Chip>
                  <Chip size="sm" variant="flat">基准：{checkpoint.packageMeta.baseLabel || '未知版本'}</Chip>
                  <Chip size="sm" variant="flat">导出时间：{checkpoint.packageMeta.exportedAt ? new Date(checkpoint.packageMeta.exportedAt).toLocaleString('zh-CN') : '未知'}</Chip>
                </div>
                <p className="mt-2">
                  批注包携带基准版本、稳定身份与正文锚点。逐条认领后才进入校勘版与导出；重复导入只生效一次；
                  锚点失效或跨引用断开的意见需在「待确认」面板重新锚定或修复，未裁定的意见不会进入校勘版和导出。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Chip size="sm" variant="flat" color="primary">共 {counts.total} 条</Chip>
                <Chip size="sm" variant="flat" color="success">已认领 {counts.accepted}</Chip>
                {counts.duplicate ? <Chip size="sm" variant="flat" color="warning">重复 {counts.duplicate}</Chip> : null}
                {counts.stale ? <Chip size="sm" variant="flat" color="danger">锚点失效 {counts.stale}</Chip> : null}
                {counts.broken ? <Chip size="sm" variant="flat" color="danger">待修 {counts.broken}</Chip> : null}
                <Button
                  size="sm"
                  variant="flat"
                  color="success"
                  className="ml-auto"
                  startContent={<CheckCheck className="h-3.5 w-3.5" />}
                  onPress={() => onDecideAll('accepted')}
                >
                  全部认领
                </Button>
              </div>

              <ScrollShadow className="max-h-[50vh]">
                <div className="space-y-2 pr-1">
                  {items.map((item) => (
                    <div
                      key={item.key}
                      className={`rounded-xl border p-3 ${
                        item.decision === 'accepted'
                          ? 'border-green-200 bg-green-50/60'
                          : item.decision === 'rejected'
                            ? 'border-stone-200 bg-stone-50 opacity-70'
                            : 'border-stone-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Chip size="sm" variant="flat" color="default">{kindLabel(item.annotation.kind)}</Chip>
                            <span className="truncate text-sm font-semibold text-stone-900">{item.annotation.title}</span>
                            <span className="text-xs text-stone-500">{item.annotation.source}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-600">{item.annotation.body}</p>
                        </div>
                        <Chip size="sm" variant="flat" color={decisionColors[item.decision]}>
                          {decisionLabels[item.decision]}
                        </Chip>
                      </div>

                      {item.messages.length ? (
                        <div className="mt-2 space-y-1">
                          {item.messages.map((message, index) => (
                            <p key={index} className="flex items-start gap-1 text-[11px] leading-4 text-amber-700">
                              {item.repairState === 'broken' ? (
                                <Link2Off className="mt-0.5 h-3 w-3 shrink-0" />
                              ) : (
                                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                              )}
                              {message}
                            </p>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          color="success"
                          variant={item.decision === 'accepted' ? 'solid' : 'flat'}
                          startContent={<Check className="h-3 w-3" />}
                          onPress={() => onDecide(item.key, 'accepted')}
                        >
                          认领
                        </Button>
                        <Button
                          size="sm"
                          color="danger"
                          variant={item.decision === 'rejected' ? 'solid' : 'flat'}
                          startContent={<X className="h-3 w-3" />}
                          onPress={() => onDecide(item.key, 'rejected')}
                        >
                          驳回
                        </Button>
                        <Button
                          size="sm"
                          variant="light"
                          startContent={<RotateCcw className="h-3 w-3" />}
                          onPress={() => onDecide(item.key, 'pending')}
                        >
                          待裁定
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollShadow>
            </div>
          ) : null}

          {checkpoint.status === 'completed' ? (
            <div className="grid place-items-center rounded-xl border border-green-200 bg-green-50 p-8 text-center">
              <CheckCheck className="h-8 w-8 text-green-600" />
              <p className="mt-2 text-sm font-medium text-green-800">批注包合并完成</p>
              <p className="mt-1 text-xs text-green-700">已认领的意见进入校勘版与导出，重复导入只生效一次。</p>
            </div>
          ) : null}
        </ModalBody>

        <ModalFooter>
          {checkpoint.status === 'staging' ? (
            <>
              <Button variant="light" onPress={onDiscard}>放弃并保留草稿</Button>
              <Button color="primary" isDisabled={!canCommit} onPress={onCommit}>
                完成合并（{counts.accepted} 条已认领）
              </Button>
            </>
          ) : null}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
