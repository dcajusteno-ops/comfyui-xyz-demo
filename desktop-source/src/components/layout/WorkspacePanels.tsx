import React, { lazy } from "react";

import { DefaultGenerationPanel } from "../features/Generation/DefaultGenerationPanel";
import { useParams } from "../../hooks/useParams";
import { useLoras } from "../../hooks/useLoras";
import { useTagging } from "../../hooks/useTagging";
import { useMobileTasks } from "../../hooks/useMobileTasks";
import { useNotes } from "../../hooks/useNotes";
import { useSheetLora } from "../../hooks/useSheetLora";
import { useOptions } from "../../hooks/useOptions";
import { useWorkbenchComposer } from "../../hooks/useAnimaComposer";
import type { DatasetStartMode } from "../../hooks/useDatasetRun";
import type {
  CanvasCharacter,
  DatasetConfig,
  DatasetItem,
  DatasetRunState,
  LoraInsertTarget,
  LoraItem,
  LoraSelection,
  OptionsState,
  TabId,
  TemplateKind,
  Toast,
} from "../../types";
import type { AnimaApplyMode, AnimaComposerValues } from "../../lib/anima/types";
import type { WardrobeWorkbenchSplit } from "../../lib/wardrobe/types";

const MultiGenerationPanel = lazy(() =>
  import("../features/Generation/MultiGenerationPanel").then((m) => ({ default: m.MultiGenerationPanel })),
);
const HighresGenerationPanel = lazy(() =>
  import("../features/Generation/HighresGenerationPanel").then((m) => ({ default: m.HighresGenerationPanel })),
);
const AnimaGenerationPanel = lazy(() =>
  import("../features/Generation/AnimaGenerationPanel").then((m) => ({ default: m.AnimaGenerationPanel })),
);
const SheetGenerationPanel = lazy(() =>
  import("../features/Generation/SheetGenerationPanel").then((m) => ({ default: m.SheetGenerationPanel })),
);
const AnimaLibraryPanel = lazy(() =>
  import("../features/AnimaLibrary").then((m) => ({ default: m.AnimaLibraryPanel })),
);
const WardrobePanel = lazy(() =>
  import("../features/Wardrobe").then((m) => ({ default: m.WardrobePanel })),
);
const WorkbenchPanel = lazy(() =>
  import("../features/Workbench").then((m) => ({ default: m.WorkbenchPanel })),
);
const DatasetPanel = lazy(() =>
  import("../features/Dataset").then((m) => ({ default: m.DatasetPanel })),
);
const TextGenerationPanel = lazy(() =>
  import("../features/Generation/TextGenerationPanel").then((m) => ({ default: m.TextGenerationPanel })),
);
const TaggingPanel = lazy(() =>
  import("../features/Tagging/TaggingPanel").then((m) => ({ default: m.TaggingPanel })),
);
const NotesManagerPanel = lazy(() =>
  import("../features/Notes/NotesManagerPanel").then((m) => ({ default: m.NotesManagerPanel })),
);
const LoraManagerPanel = lazy(() =>
  import("../features/Lora").then((m) => ({ default: m.LoraManagerPanel })),
);
const LuckyWheelPanel = lazy(() =>
  import("../features/LuckyWheel").then((m) => ({ default: m.LuckyWheelPanel })),
);

type ParamsHook = ReturnType<typeof useParams>;
type LorasHook = ReturnType<typeof useLoras>;
type TaggingHook = ReturnType<typeof useTagging>;
type MobileHook = ReturnType<typeof useMobileTasks>;
type NotesHook = ReturnType<typeof useNotes>;
type SheetLoraHook = ReturnType<typeof useSheetLora>;
type LoraSettings = ReturnType<typeof useOptions>["loraSettings"];
type WorkbenchComposer = ReturnType<typeof useWorkbenchComposer>;

export interface WorkspaceHandlers {
  runDefault: () => void;
  runMulti: () => void;
  runHighres: () => void;
  runAnima: () => void;
  runSheet: () => void;
  runTextMulti: () => void;
  runTextHighres: () => void;
  runWd14: () => void;
  runClSingle: () => void;
  runBatchTagger: (type: "cl" | "wd") => void;
  sendDefaultToHighres: () => void;
  openLoraDetail: (item: LoraSelection | LoraItem) => void;
  addCharacter: (characters: CanvasCharacter[]) => CanvasCharacter[];
  uploadImage: (file: File) => Promise<string>;
  applyTags: (text: string, target: TemplateKind) => void;
  openAnimaLibrary: () => void;
  openWardrobe: () => void;
  openAnimaTab: () => void;
  openOutputLightbox: (url: string, originalUrl?: string) => void;
  resolveOutputUrl: (file: { filename: string; subfolder?: string; type?: string }) => string;
  openImageManager: (dir?: string) => Promise<void>;
  clearNotes: () => void;
  slotsApply: (tags: string[], target: TemplateKind) => void;
  animaLibraryApply: (text: string, mode: AnimaApplyMode) => void;
  animaReference: (imageName: string) => void;
  wardrobeApply: (text: string, mode: AnimaApplyMode) => void;
  sendToWorkbench: (split: WardrobeWorkbenchSplit) => void;
  libraryToWorkbench: (values: AnimaComposerValues) => void;
  loraInsert: (item: LoraItem, target: LoraInsertTarget, strength?: number) => void;
  datasetStart: (mode: DatasetStartMode) => void;
  datasetStop: () => void;
  datasetRetryFailed: () => void;
  datasetRerunOne: (id: string) => void;
  datasetRegenerate: () => void;
  datasetRecover: () => void;
  datasetExportCaptions: () => void;
  datasetExportManifest: () => void;
}

export interface WorkspacePanelsProps {
  tab: TabId;
  params: ParamsHook;
  options: OptionsState;
  apiBase: string;
  loraSettings: LoraSettings;
  loras: LorasHook;
  loraNames: string[];
  wildcardNames: string[];
  sheetLora: SheetLoraHook;
  tagging: TaggingHook;
  mobile: MobileHook;
  notes: NotesHook;
  workbench: WorkbenchComposer[0];
  setWorkbench: WorkbenchComposer[1];
  datasetConfig: DatasetConfig;
  datasetItems: DatasetItem[];
  datasetRunState: DatasetRunState;
  datasetRunning: boolean;
  datasetCurrent: number;
  pushToast: (type: Toast["type"], title: string, message?: string) => void;
  confirm: (title: string, message: string, onConfirm: () => void) => void;
  handlers: WorkspaceHandlers;
}

/** 各工作流标签页的宿主：只做条件渲染与 props 转发，不含任何业务逻辑 */
export const WorkspacePanels = React.memo(function WorkspacePanels({
  tab,
  params,
  options,
  apiBase,
  loraSettings,
  loras,
  loraNames,
  wildcardNames,
  sheetLora,
  tagging,
  mobile,
  notes,
  workbench,
  setWorkbench,
  datasetConfig,
  datasetItems,
  datasetRunState,
  datasetRunning,
  datasetCurrent,
  pushToast,
  confirm,
  handlers,
}: WorkspacePanelsProps) {
  return (
    <>
      {tab === "default" && (
        <DefaultGenerationPanel
          params={params.defaultParams}
          setParams={params.setDefaultParams}
          options={options}
          apiBase={apiBase}
          loraSettings={loraSettings}
          loraExampleFilesByHash={loras.loraExampleFilesByHash}
          loraNames={loraNames}
          wildcardNames={wildcardNames}
          onRunGeneration={handlers.runDefault}
          onOpenLoraDetail={handlers.openLoraDetail}
          onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
          onSendToHighres={handlers.sendDefaultToHighres}
          onUploadImage={handlers.uploadImage}
        />
      )}

      {tab === "multi" && (
        <MultiGenerationPanel
          params={params.multiParams}
          setParams={params.setMultiParams}
          options={options}
          apiBase={apiBase}
          loraSettings={loraSettings}
          loraExampleFilesByHash={loras.loraExampleFilesByHash}
          loraNames={loraNames}
          wildcardNames={wildcardNames}
          onRunGeneration={handlers.runMulti}
          onOpenLoraDetail={handlers.openLoraDetail}
          onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
          onAddCharacter={handlers.addCharacter}
          onUploadImage={handlers.uploadImage}
        />
      )}

      {tab === "highres" && (
        <HighresGenerationPanel
          params={params.highresParams}
          setParams={params.setHighresParams}
          options={options}
          apiBase={apiBase}
          loraSettings={loraSettings}
          loraExampleFilesByHash={loras.loraExampleFilesByHash}
          loraNames={loraNames}
          wildcardNames={wildcardNames}
          onRunGeneration={handlers.runHighres}
          onOpenLoraDetail={handlers.openLoraDetail}
          onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
          onUploadImage={handlers.uploadImage}
        />
      )}

      {tab === "anima" && (
        <AnimaGenerationPanel
          params={params.animaParams}
          setParams={params.setAnimaParams}
          options={options}
          apiBase={apiBase}
          loraSettings={loraSettings}
          loraExampleFilesByHash={loras.loraExampleFilesByHash}
          loraNames={loraNames}
          wildcardNames={wildcardNames}
          onRunGeneration={handlers.runAnima}
          onOpenLoraDetail={handlers.openLoraDetail}
          onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
          onUploadImage={handlers.uploadImage}
          onOpenAnimaLibrary={handlers.openAnimaLibrary}
          onOpenWardrobe={handlers.openWardrobe}
        />
      )}

      {tab === "sheet" && (
        <SheetGenerationPanel
          params={params.sheetParams}
          setParams={params.setSheetParams}
          options={options}
          apiBase={apiBase}
          loraSettings={loraSettings}
          loraExampleFilesByHash={loras.loraExampleFilesByHash}
          loraNames={loraNames}
          wildcardNames={wildcardNames}
          loraState={sheetLora}
          onRunGeneration={handlers.runSheet}
          onOpenLoraDetail={handlers.openLoraDetail}
          onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
          onUploadImage={handlers.uploadImage}
          pushToast={pushToast}
        />
      )}

      {tab === "dataset" && (
        <DatasetPanel
          params={datasetConfig}
          setParams={params.setDatasetParams}
          options={options}
          apiBase={apiBase}
          loraSettings={loraSettings}
          loraExampleFilesByHash={loras.loraExampleFilesByHash}
          loraNames={loraNames}
          wildcardNames={wildcardNames}
          items={datasetItems}
          planMode={datasetRunState.mode}
          planSignature={datasetRunState.signature}
          running={datasetRunning}
          current={datasetCurrent}
          onStart={handlers.datasetStart}
          onStop={handlers.datasetStop}
          onRetryFailed={handlers.datasetRetryFailed}
          onRerunOne={handlers.datasetRerunOne}
          onRegeneratePlan={handlers.datasetRegenerate}
          onRecover={handlers.datasetRecover}
          onExportCaptions={handlers.datasetExportCaptions}
          onExportManifest={handlers.datasetExportManifest}
          onUploadImage={handlers.uploadImage}
          onOpenLoraDetail={handlers.openLoraDetail}
          onSetSimpleLoraTarget={loras.setSimpleLoraTarget}
          onOpenImage={handlers.openOutputLightbox}
          resolveImageUrl={handlers.resolveOutputUrl}
          confirm={confirm}
          pushToast={pushToast}
          onOpenImageManager={handlers.openImageManager}
        />
      )}

      {tab === "wd14" && (
        <TaggingPanel
          wd14={tagging.wd14}
          setWd14={tagging.setWd14}
          wdFile={tagging.wdFile}
          setWdFile={tagging.setWdFile}
          wdTags={tagging.wdTags}
          setWdTags={tagging.setWdTags}
          wd14Tab={tagging.wd14Tab}
          setWd14Tab={tagging.setWd14Tab}
          clFile={tagging.clFile}
          setClFile={tagging.setClFile}
          clSingleParams={tagging.clSingleParams}
          setClSingleParams={tagging.setClSingleParams}
          clBatchParams={tagging.clBatchParams}
          setClBatchParams={tagging.setClBatchParams}
          wdBatchParams={tagging.wdBatchParams}
          setWdBatchParams={tagging.setWdBatchParams}
          options={options}
          onRunWd14={handlers.runWd14}
          onRunClSingle={handlers.runClSingle}
          onRunBatchTagger={handlers.runBatchTagger}
          onApplyTags={handlers.applyTags}
          mobileTasks={mobile.tasks}
          onRemoveMobileTask={mobile.remove}
          onClearMobileTasks={mobile.clear}
        />
      )}

      {tab === "text" && (
        <TextGenerationPanel
          params={params.defaultParams}
          setParams={params.setDefaultParams}
          options={options}
          onRunDefault={handlers.runDefault}
          onRunMulti={handlers.runTextMulti}
          onRunHighres={handlers.runTextHighres}
          onRunAnima={handlers.runAnima}
          defaultParams={params.defaultParams}
          multiParams={params.multiParams}
          highresParams={params.highresParams}
          onUploadImage={handlers.uploadImage}
          apiBase={apiBase}
        />
      )}

      {tab === "slots" && (
        <LuckyWheelPanel onApplyPrompt={handlers.slotsApply} />
      )}

      {tab === "loras" && (
        <LoraManagerPanel
          modelType={loras.managedModelType}
          onModelTypeChange={loras.changeManagedModelType}
          result={loras.loraResult}
          query={loras.loraQuery}
          setQuery={loras.setLoraQuery}
          loading={loras.loraLoading}
          hasMore={loras.loraResult.page < loras.loraResult.totalPages}
          folders={loras.loraFolders}
          baseModels={loras.loraBaseModels}
          tags={loras.loraTags}
          density={loras.loraDensity}
          setDensity={loras.setLoraDensity}
          triggerWords={loras.triggerWords}
          onRefresh={loras.refreshLoras}
          onLoadMore={loras.loadMoreManagedModels}
          onDetail={loras.setLoraDetail}
          onInsert={handlers.loraInsert}
          exampleStatus={loras.exampleStatus}
          examplePending={loras.examplePending}
          pullingExampleHashes={loras.pullingExampleHashes}
          localExampleFilesByHash={loras.loraExampleFilesByHash}
          onPullAllExamples={loras.pullAllLoraExamples}
          apiBase={apiBase}
          settings={loraSettings}
        />
      )}

      {tab === "notes" && (
        <NotesManagerPanel
          notes={notes.notes}
          activeNoteId={notes.activeNoteId}
          notesSearch={notes.notesSearch}
          setNotesSearch={notes.setNotesSearch}
          setActiveNoteId={notes.setActiveNoteId}
          handleAddNote={notes.handleAddNote}
          handleDeleteNote={notes.handleDeleteNote}
          updateActiveNote={notes.updateActiveNote}
          saveNotes={notes.saveNotes}
          notesSaving={notes.notesSaving}
          isNotesWide={notes.isNotesWide}
          setIsNotesWide={notes.setIsNotesWide}
          onConfirmClear={handlers.clearNotes}
        />
      )}

      {tab === "anima-library" && (
        <AnimaLibraryPanel
          currentPrompt={params.animaParams.positivePrompt}
          onApplyPrompt={handlers.animaLibraryApply}
          onUploadImage={handlers.uploadImage}
          onSetAnimaReference={handlers.animaReference}
          onConfirm={confirm}
          pushToast={pushToast}
          onSendToWorkbench={handlers.libraryToWorkbench}
        />
      )}

      {tab === "wardrobe" && (
        <WardrobePanel
          currentPrompt={params.animaParams.positivePrompt}
          onApplyPrompt={handlers.wardrobeApply}
          onConfirm={confirm}
          pushToast={pushToast}
          onOpenAnima={handlers.openAnimaTab}
          workbenchValues={workbench.values}
          onSendToWorkbench={handlers.sendToWorkbench}
        />
      )}

      {tab === "workbench" && (
        <WorkbenchPanel
          state={workbench}
          setState={setWorkbench}
          currentPrompt={params.animaParams.positivePrompt}
          onApplyPrompt={handlers.animaLibraryApply}
          onConfirm={confirm}
          pushToast={pushToast}
          onOpenAnimaLibrary={handlers.openAnimaLibrary}
        />
      )}
    </>
  );
});
