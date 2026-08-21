import React from "react";
import { X } from "lucide-react";
import type {
  LoraItem,
  LoraManagerSettings,
  LoraOperation,
  ManagedModelType,
  TemplateKind,
  Toast,
  TranslationSettings,
} from "../types";
import { ComfyClient } from "../lib/comfyClient";
import { LoraDetailModal, LoraOperationModal } from "./features/Lora/LoraModals";
import { LoraManagerPanel } from "./features/Lora";
import { WelcomeModal } from "./WelcomeModal";
import { TranslationToolDialog } from "./TranslationToolDialog";
import { PromptEditorDialog } from "./PromptEditorDialog";
import { ImageComparerModal } from "./ImageComparerModal";
import { ImageLightbox } from "./ImageLightbox";
import { XyzHelpModal } from "./features/Xyz/XyzHelpModal";
import { ModalFrame, FeatureModal } from "./ui";

interface GlobalModalsProps {
  loraOperation: LoraOperation | null;
  setLoraOperation: (op: LoraOperation | null) => void;
  loraDetail: LoraItem | null;
  setLoraDetail: (item: LoraItem | null) => void;
  simpleLoraTarget: TemplateKind | null;
  setSimpleLoraTarget: (target: TemplateKind | null) => void;
  showXyzHelp: boolean;
  setShowXyzHelp: (show: boolean) => void;
  featureModal: { title: string; body: string } | null;
  setFeatureModal: (modal: { title: string; body: string } | null) => void;
  onLoraInsert: (item: LoraItem, target: TemplateKind, strength?: number) => void;
  onLoraRename: (item: LoraItem, nextName: string) => Promise<void>;
  onLoraMove: (item: LoraItem, targetPath: string) => Promise<void>;
  onLoraDelete: (item: LoraItem) => Promise<void>;
  onLoraBatchMove: (items: LoraItem[], targetPath: string) => Promise<void>;
  onLoraBatchDelete: (items: LoraItem[]) => Promise<void>;
  onLoraCivitaiSync: (item: LoraItem) => Promise<void>;
  onTriggerWordsApply: (words: string[]) => void;
  onTriggerWordsSave: (item: LoraItem, words: string[]) => Promise<string[]>;
  onTriggerWordsRead: (item: LoraItem) => Promise<string[]>;
  onPromptApply?: (positive: string, negative: string) => void;
  onOpenLoraFolder: (item: LoraItem) => Promise<void>;
  onPullLoraExamples: (item: LoraItem) => Promise<any>;
  onPauseDownloads: () => void;
  onResumeDownloads: () => void;
  onStopDownloads: () => void;
  onUpdateSettings: (settings: LoraManagerSettings) => Promise<void>;
  onDoctorAction: (action: string) => Promise<void>;
  loras: any; // The result of useLoras hook
  apiBase: string;
  setApiBase: (base: string) => void;
  
  ui: any;
  client: ComfyClient;
  translationSettings: TranslationSettings;
  onTranslationSettingsSaved: (settings: TranslationSettings) => void;
  pushToast: (type: Toast["type"], title: string, message?: string) => void;
  toasts: Toast[];
  notificationLog: Toast[];
}

export function GlobalModals(props: GlobalModalsProps) {
  const {
    loraOperation,
    setLoraOperation,
    loraDetail,
    setLoraDetail,
    simpleLoraTarget,
    setSimpleLoraTarget,
    showXyzHelp,
    setShowXyzHelp,
    featureModal,
    setFeatureModal,
    onLoraInsert,
    onTriggerWordsApply,
    onTriggerWordsSave,
    onTriggerWordsRead,
    onPullLoraExamples,
    onUpdateSettings,
    loras,
    apiBase,
    setApiBase,
    ui,
    client,
    translationSettings,
    onTranslationSettingsSaved,
    pushToast,
    toasts,
    notificationLog,
  } = props;

  return (
    <>
      {ui.showWelcome && <WelcomeModal onClose={ui.handleCloseWelcome} />}
      
      {ui.showPromptEditor && (
        <PromptEditorDialog 
          open={ui.showPromptEditor}
          onClose={() => ui.setShowPromptEditor(false)} 
          onApply={(pos, neg) => {
            if (props.onPromptApply) {
              props.onPromptApply(pos, neg);
            }
          }}
        />
      )}
      
      {ui.showTranslation && (
        <TranslationToolDialog
          onClose={() => ui.setShowTranslation(false)}
          translationSettings={translationSettings}
          onToast={pushToast}
        />
      )}

      {loraOperation && (
        <LoraOperationModal
          modelType={loras.managedModelType}
          operation={loraOperation}
          client={client}
          selectedItems={loras.selectedLoraItems}
          settingsApiBase={apiBase}
          onApiBaseSaved={setApiBase}
          onClose={() => setLoraOperation(null)}
          onToast={pushToast}
          onSettingsSaved={onUpdateSettings}
          translationSettings={translationSettings}
          onTranslationSettingsSaved={onTranslationSettingsSaved}
          onMutated={(msg) => loras.refreshLoras()}
          notifications={notificationLog}
          onShowWelcome={() => ui.setShowWelcome(true)}
        />
      )}
      
      {ui.outputLightbox && (
        <ImageLightbox 
          url={ui.outputLightbox} 
          onClose={() => ui.setOutputLightbox(null)} 
        />
      )}

      {ui.compareLightbox && (
        <ImageComparerModal 
          imageA={ui.compareLightbox[0]} 
          imageB={ui.compareLightbox[1]} 
          onClose={() => ui.setCompareLightbox(null)} 
        />
      )}
      
      {simpleLoraTarget && (
        <ModalFrame 
          title="简易 LoRA 管理器" 
          onClose={() => setSimpleLoraTarget(null)}
          style={{ width: "90vw", maxWidth: "1400px", height: "85vh", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        >
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", margin: "-16px", marginTop: "0" }}>
            <LoraManagerPanel
              modelType={loras.managedModelType}
              onModelTypeChange={loras.setManagedModelType}
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
              onDetail={setLoraDetail}
              onInsert={(item) => onLoraInsert(item, simpleLoraTarget)}
              exampleStatus={loras.exampleStatus}
              examplePending={loras.examplePending}
              pullingExampleHashes={loras.pullingExampleHashes}
              localExampleFilesByHash={loras.loraExampleFilesByHash}
              onPullAllExamples={loras.pullAllLoraExamples}
              apiBase={apiBase}
              settings={loras.loraSettings}
              isSimple
            />
          </div>
        </ModalFrame>
      )}

      {loraDetail && (
        <LoraDetailModal
          modelType={loras.managedModelType}
          item={loraDetail}
          triggerWords={loras.triggerWords[loraDetail.model_name || loraDetail.file_name] ?? []}
          client={client}
          apiBase={apiBase}
          settings={loras.loraSettings}
          onClose={() => setLoraDetail(null)}
          onInsert={(target, strength) => onLoraInsert(loraDetail, target, strength)}
          onInsertWords={(target, words) => onTriggerWordsApply(words)}
          onTriggerWords={() => onTriggerWordsRead(loraDetail)}
          onExtractTriggerWords={() => loras.extractTriggerWords(loraDetail, true)}
          onSaveTriggerWords={(words) => onTriggerWordsSave(loraDetail, words)}
          onRename={props.onLoraRename}
          onToast={pushToast}
          pullingExamples={loras.pullingExampleHashes.includes(loraDetail.sha256?.toLowerCase() ?? "")}
          exampleStatus={loras.exampleStatus}
          onPullExamples={(item) => onPullLoraExamples(item).then(res => res || [])}
        />
      )}

      {showXyzHelp && (
        <XyzHelpModal onClose={() => setShowXyzHelp(false)} />
      )}

      {featureModal && (
        <FeatureModal modal={featureModal} onClose={() => setFeatureModal(null)} />
      )}

      {ui.confirmDialog && (
        <ModalFrame title={ui.confirmDialog.title} onClose={() => ui.setConfirmDialog(null)}>
          <div style={{ padding: "24px" }}>
            <p style={{ color: "var(--text)", fontSize: "15px", margin: 0, lineHeight: 1.5 }}>
              {ui.confirmDialog.message}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
              <button
                type="button"
                className="lm-text-btn"
                onClick={() => ui.setConfirmDialog(null)}
                style={{ padding: "8px 16px" }}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-action"
                style={{ background: "var(--danger)", border: "1px solid var(--danger)", padding: "8px 16px" }}
                onClick={() => {
                  ui.confirmDialog.onConfirm();
                  ui.setConfirmDialog(null);
                }}
              >
                确定删除
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  );
}
