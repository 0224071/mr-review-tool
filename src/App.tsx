import React from 'react';
import { Header } from './components/Header';
import { DiffInputPanel } from './components/DiffInputPanel';
import { AnalysisResultView } from './components/AnalysisResultView';
import { DiffViewerModal } from './components/DiffViewerModal';
import { PublishConfirmationModal } from './components/PublishConfirmationModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { ConfirmDialog } from './components/ConfirmDialog';
import { formatHistoryTime, hasNewCommit } from './core/history-store';
import { PROVIDER_META } from './providers/registry';
import { ProviderId } from './providers/types';
import { OPENROUTER_SUGGESTED_FREE_MODEL } from './providers/openai-compatible';
import { MRAnalysisResult } from './types/review';
import { AppServices } from './app/app-services';
import { SetupGuide } from './components/SetupGuide';
import { useSettings } from './hooks/useSettings';
import { useHistory } from './hooks/useHistory';
import { useAnalysis } from './hooks/useAnalysis';
import { usePublish } from './hooks/usePublish';
import { AlertCircle, DatabaseZap, FlaskConical, Info, Sparkles } from 'lucide-react';

/** 結果標記：「OpenAI · gpt-4.1-mini」；舊結果沒有標記時不顯示 */
function formatGeneratedBy(result: MRAnalysisResult): string | undefined {
  if (!result.provider) return undefined;
  const label = PROVIDER_META[result.provider as ProviderId]?.label ?? result.provider;
  return result.model ? `${label} · ${result.model}` : label;
}

/**
 * 主畫面。設定儲存、AI、GitLab 與歷史紀錄都由 services 注入（正式版或示範模式），App 本身不分辨模式。
 * 狀態與邏輯分在 useSettings／useHistory／useAnalysis／usePublish，這裡只負責組合與版面。
 */
export default function App({ services }: { services: AppServices }) {
  const { gitlab } = services;
  const SettingsDialog = services.settings.Dialog;
  const settingsState = useSettings(services.settings, services.ai);
  // 歷史紀錄的開啟／刪除要動到分析結果；callback 只在事件中呼叫，此時 analysis 已建立
  const history = useHistory({
    openHistoryStore: () => services.openHistoryStore(),
    gitlab,
    settings: settingsState.settings,
    onOpenRecord: (record) => analysis.openRecord(record),
    onRemoteNotes: (notes) => analysis.setRemoteNotes(notes),
    onActiveRecordRemoved: () => analysis.resetToEmpty(),
  });
  const analysis = useAnalysis({ services, settings: settingsState, history });
  const publish = usePublish({ gitlab, settings: settingsState, analysis });

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 flex flex-col font-sans">
      {/* 1. Header */}
      <Header
        onOpenSettings={() => settingsState.setIsSettingsOpen(true)}
        hasApiKey={settingsState.providerReady}
        onOpenHistory={history.historyAvailable ? () => history.setIsHistoryOpen(true) : undefined}
        historyCount={history.historyAvailable ? history.historyRecords.length : undefined}
      />

      {/* 2. Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {services.banner}

        {history.historyAvailable === false && (
          <p className="mb-3 text-xs text-muted flex items-center gap-1.5">
            <DatabaseZap className="w-3.5 h-3.5 text-muted-light" />
            此瀏覽器無法保存歷史紀錄
          </p>
        )}

        {/* Info / Notice notification banner if any */}
        {analysis.infoMessage && (
          <div
            role="status"
            className="mb-4 p-4 bg-primary-subtle border border-primary-border rounded-xl text-ink text-xs flex items-start justify-between gap-3 shadow-xs animate-in fade-in duration-150"
          >
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-ink">系統提示</p>
                <p className="mt-0.5 text-muted-dark">{analysis.infoMessage}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => analysis.setInfoMessage(null)}
              aria-label="關閉提示"
              className="text-primary hover:text-primary-hover font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {settingsState.isSetupGuideOpen && (
          <SetupGuide
            notice={settingsState.providerSetupNotice}
            onTryDemo={services.onTryDemo}
            onOpenSettings={settingsState.openSettingsFromGuide}
            onClose={() => settingsState.setIsSetupGuideOpen(false)}
          />
        )}

        {/* Error notification banner if any */}
        {analysis.errorMessage && (
          <div className="mb-4 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start justify-between gap-3 shadow-xs animate-in fade-in duration-150">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-900">
                  {analysis.suggestFreeModel ? '額度不足，可改用免費模型' : '操作過程發生錯誤'}
                </p>
                <p className="mt-0.5">{analysis.errorMessage}</p>
                {analysis.suggestFreeModel && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={analysis.handleUseFreeModel}
                      className="px-2.5 py-1 rounded-md bg-surface border border-rose-300 text-rose-800 hover:bg-rose-100 font-semibold"
                    >
                      改用免費模型 {OPENROUTER_SUGGESTED_FREE_MODEL}
                    </button>
                    <button
                      type="button"
                      onClick={() => settingsState.setIsSettingsOpen(true)}
                      className="px-2.5 py-1 rounded-md text-rose-700 hover:underline"
                    >
                      到設定挑選其他免費模型
                    </button>
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => analysis.setErrorMessage(null)}
              className="text-rose-500 hover:text-rose-700 font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Two-Column Responsive Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Diff Input & Controls (5 cols on lg) */}
          <div className="lg:col-span-5 h-auto lg:max-h-[calc(100vh-100px)] lg:sticky lg:top-20 lg:overflow-y-auto">
            <DiffInputPanel
              rawDiff={analysis.rawDiff}
              onDiffChange={analysis.setRawDiff}
              parsedDiff={analysis.parsedDiff}
              onAnalyze={analysis.handleAnalyze}
              onLoadSampleDiff={analysis.handleLoadSampleDiff}
              onLoadSampleAnalysis={analysis.handleLoadSampleAnalysis}
              isLoading={analysis.isLoading}
              setupNotice={settingsState.providerSetupNotice}
              onOpenSettings={() => settingsState.setIsSettingsOpen(true)}
              // Stage 2 GitLab props
              gitlabMrUrl={analysis.gitlabMrUrl}
              onGitlabMrUrlChange={analysis.setGitlabMrUrl}
              onFetchGitLabMr={analysis.handleFetchGitLabMr}
              isFetchingGitLab={analysis.isFetchingGitLab}
              currentGitLabMr={analysis.currentGitLabMr}
              sharedAnalysisAvailable={analysis.sharedAnalysisAvailable}
              onLoadSharedAnalysis={analysis.handleLoadSharedAnalysis}
              hasGitLabToken={gitlab.isConfigured(settingsState.settings)}
              gitlabError={analysis.gitlabError}
              batchProgress={analysis.batchProgress}
              hasResult={!!analysis.analysisResult}
            />
          </div>

          {/* Right Column: Analysis Results (7 cols on lg) */}
          <div className="lg:col-span-7 space-y-4">
            {analysis.isLoading ? (
              /* Loading Skeleton Screen */
              <div className="bg-surface rounded-xl border border-surface-border p-6 shadow-xs space-y-6 animate-pulse">
                {/* Title and stats skeleton */}
                <div className="space-y-2">
                  <div className="h-4 bg-slate-200 rounded w-1/4" />
                  <div className="h-6 bg-slate-200 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 rounded w-1/3" />
                </div>
                {/* 3 Core Summaries skeleton */}
                <div className="space-y-2.5 pt-2">
                  <div className="h-4 bg-slate-200 rounded w-1/5" />
                  <div className="h-3 bg-slate-100 rounded w-full" />
                  <div className="h-3 bg-slate-100 rounded w-5/6" />
                  <div className="h-3 bg-slate-100 rounded w-4/5" />
                </div>
                {/* 2 Review Cards skeleton */}
                <div className="space-y-3 pt-2">
                  <div className="h-4 bg-slate-200 rounded w-1/5" />
                  <div className="p-4 border border-surface-border rounded-xl space-y-2 bg-surface-subtle/50">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-slate-200 rounded" />
                      <div className="h-4 bg-rose-100 rounded w-14" />
                      <div className="h-4 bg-slate-200 rounded w-28" />
                      <div className="h-4 bg-slate-200 rounded flex-1" />
                    </div>
                    <div className="h-12 bg-primary-subtle/40 rounded-lg" />
                  </div>
                  <div className="p-4 border border-surface-border rounded-xl space-y-2 bg-surface-subtle/50">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-slate-200 rounded" />
                      <div className="h-4 bg-amber-100 rounded w-14" />
                      <div className="h-4 bg-slate-200 rounded w-32" />
                      <div className="h-4 bg-slate-200 rounded flex-1" />
                    </div>
                    <div className="h-12 bg-primary-subtle/40 rounded-lg" />
                  </div>
                </div>
              </div>
            ) : analysis.analysisResult ? (
              <AnalysisResultView
                key={`${history.currentRecordId ?? 'unsaved'}-${analysis.analyzedAt ?? 0}`}
                result={analysis.analysisResult}
                diffFiles={analysis.resultDiffFiles}
                onOpenFileDiff={analysis.handleOpenFileDiff}
                // Stage 2 GitLab props
                onPublishSingleReview={publish.handlePublishSingleReview}
                onPublishBatchReviews={publish.handlePublishBatchReviews}
                publishStates={analysis.publishStates}
                isPublishing={publish.isPublishingInProgress}
                isGitLabConfigured={gitlab.isConfigured(settingsState.settings)}
                onPublishSummaryToMr={publish.handlePublishSummaryToMr}
                onShareAnalysisToMr={publish.handleShareAnalysisToMr}
                isSharingToMr={publish.isSharingToMr}
                isSummaryPublished={analysis.isSummaryPublished}
                isSharedToMrPublished={analysis.isSharedToMrPublished}
                mrUrl={publish.mrUrl}
                publishTargetLabel={gitlab.targetLabel}
                publishNotice={gitlab.notice}
                selectedIndices={analysis.selectedIndices}
                onSelectedIndicesChange={analysis.setSelectedIndices}
                draftEdits={analysis.draftEdits}
                onDraftEditsChange={analysis.setDraftEdits}
                publishedMatches={publish.publishedMatches}
                analyzedAtLabel={
                  history.historyAvailable && analysis.analyzedAt ? formatHistoryTime(analysis.analyzedAt) : undefined
                }
                generatedByLabel={formatGeneratedBy(analysis.analysisResult)}
                hasNewCommit={history.historyAvailable === true && !!history.currentRecord && hasNewCommit(history.currentRecord)}
                onReanalyze={analysis.handleReanalyze}
              />
            ) : (
              <div className="bg-surface rounded-xl border border-surface-border p-6 sm:p-12 text-center shadow-xs space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-primary-subtle text-primary flex items-center justify-center mx-auto shadow-inner">
                  <Sparkles className="w-8 h-8" />
                </div>
                <div className="max-w-md mx-auto space-y-2">
                  <h3 className="text-base font-bold text-slate-800">
                    準備進行 MR 講解與結構審查
                  </h3>
                  <p className="text-xs text-muted leading-relaxed">{services.homeHint}</p>
                </div>
                {services.onTryDemo && (
                  <div className="pt-2 space-y-1.5">
                    <button
                      type="button"
                      onClick={services.onTryDemo}
                      className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold shadow-xs transition-colors"
                    >
                      <FlaskConical className="w-4 h-4" />
                      用範例試試看
                    </button>
                    <p className="text-[11px] text-muted-light">不需要金鑰，不會連到 AI 或 GitLab</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 3. Settings Modal */}
      <SettingsDialog
        isOpen={settingsState.isSettingsOpen}
        onClose={() => settingsState.setIsSettingsOpen(false)}
        settings={settingsState.settings}
        onSave={settingsState.handleSaveSettings}
        onClearKey={settingsState.handleClearProviderKey}
      />

      {/* 4. Diff Viewer Modal */}
      {analysis.inspectingDiff && (
        <DiffViewerModal
          file={analysis.inspectingDiff.file}
          targetLine={analysis.inspectingDiff.line}
          onClose={() => analysis.setInspectingDiff(null)}
        />
      )}

      {/* 5. Stage 2 Publish Confirmation Modal */}
      <PublishConfirmationModal
        isOpen={publish.isPublishModalOpen}
        onClose={() => publish.setIsPublishModalOpen(false)}
        onConfirm={publish.handleConfirmPublish}
        mrInfo={analysis.currentGitLabMr}
        mrUrl={publish.mrUrl}
        itemsToPublish={publish.publishModalConfig.itemsToPublish}
        diffRefs={publish.publishDiffRefs}
        isPublishingSummary={publish.publishModalConfig.isPublishingSummary}
        summaryTitle={analysis.analysisResult?.title}
        title={gitlab.publishConfirmTitle}
        targetLabel={gitlab.targetLabel}
        notice={gitlab.notice}
        isPublishing={publish.isPublishingInProgress}
      />

      {/* 6. 重複發布警告（橘色）：預設 focus「取消」，按發布類按鈕才進入原本的發布確認 */}
      <ConfirmDialog
        open={!!publish.duplicateWarning}
        cancelIsPrimary
        title={`有 ${publish.duplicateWarning?.duplicates.length ?? 0} 則已發布過（依本地紀錄與 MR 現有留言比對）`}
        body={
          publish.duplicateWarning && publish.duplicateWarning.fresh.length > 0
            ? `可略過已發布的意見，只發布其餘 ${publish.duplicateWarning.fresh.length} 則。重複發布會在 MR 上出現相同的留言。`
            : '重複發布會在 MR 上出現相同的留言。'
        }
        confirmLabel={
          publish.duplicateWarning && publish.duplicateWarning.fresh.length > 0
            ? `只發布未發布的 ${publish.duplicateWarning.fresh.length} 則`
            : '仍要重複發布'
        }
        secondaryLabel={publish.duplicateWarning && publish.duplicateWarning.fresh.length > 0 ? '仍要全部發布' : undefined}
        onSecondary={publish.publishAllDespiteDuplicates}
        onCancel={publish.cancelDuplicateWarning}
        onConfirm={publish.confirmDuplicateWarning}
      />

      {/* 7. 歷史紀錄抽屜（IndexedDB 不可用時不顯示） */}
      {history.historyAvailable && (
        <HistoryDrawer
          open={history.isHistoryOpen}
          records={history.historyRecords}
          activeId={history.currentRecordId}
          onClose={() => history.setIsHistoryOpen(false)}
          onOpen={(id) => void history.handleOpenRecord(id)}
          onTogglePin={(id) => void history.handleTogglePin(id)}
          onDelete={(id) => void history.handleDeleteRecord(id)}
          onClearUnpinned={() => void history.handleClearUnpinned()}
        />
      )}
    </div>
  );
}
