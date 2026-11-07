import { GlobalModals } from "../GlobalModals";
import type { useLoras } from "../../hooks/useLoras";
import type { useUiState } from "../../hooks/useUiState";
import type { useWatermarkSettings } from "../../hooks/useWatermarkSettings";
import type { useParams } from "../../hooks/useParams";
import type { ComfyClient } from "../../lib/comfyClient";
import type { TranslationSettings } from "../../lib/translation";
import type {
  BaseGenerationParams,
  LoraInsertTarget,
  LoraItem,
  MultiGenerationParams,
  TabId,
  Toast,
} from "../../types";

interface AppModalsProps {
  loras: ReturnType<typeof useLoras>;
  ui: ReturnType<typeof useUiState>;
  client: ComfyClient;
  watermark: ReturnType<typeof useWatermarkSettings>;
  translationSettings: TranslationSettings;
  onTranslationSettingsSaved: (settings: TranslationSettings) => void;
  apiBase: string;
  setApiBase: (base: string) => void;
  pushToast: (type: Toast["type"], title: string, message?: string) => void;
  toasts: Toast[];
  notificationLog: Toast[];
  tab: TabId;
  params: ReturnType<typeof useParams>;
  onLoraInsert: (item: LoraItem, target: LoraInsertTarget, strength?: number) => void;
  onAddTriggerWords: (words: string[], target?: LoraInsertTarget) => void;
}

/**
 * 全局弹窗宿主：把 App 里 90 行 GlobalModals props 收拢到这里。
 * 「应用提示词」的落点逻辑随组件一起搬走（它是弹窗专属行为）。
 */
export function AppModals({
  loras,
  ui,
  client,
  watermark,
  translationSettings,
  onTranslationSettingsSaved,
  apiBase,
  setApiBase,
  pushToast,
  toasts,
  notificationLog,
  tab,
  params,
  onLoraInsert,
  onAddTriggerWords,
}: AppModalsProps) {
  return (
    <GlobalModals
      loraOperation={loras.loraOperation}
      setLoraOperation={loras.setLoraOperation}
      loraDetail={loras.loraDetail}
      setLoraDetail={loras.setLoraDetail}
      simpleLoraTarget={loras.simpleLoraTarget}
      setSimpleLoraTarget={loras.setSimpleLoraTarget}
      showXyzHelp={ui.showXyzHelp}
      setShowXyzHelp={ui.setShowXyzHelp}
      featureModal={ui.featureModal}
      setFeatureModal={ui.setFeatureModal}
      onLoraInsert={onLoraInsert}
      onLoraRename={loras.renameLora}
      onLoraMove={loras.moveLora}
      onLoraDelete={loras.deleteLora}
      onLoraBatchMove={(items, targetPath) => {
        loras.bulkMoveLoras(items.map((i) => i.file_path || ""), targetPath);
        return Promise.resolve();
      }}
      onLoraBatchDelete={(items) => {
        loras.bulkDeleteLoras(items.map((i) => i.file_path || ""));
        return Promise.resolve();
      }}
      onLoraCivitaiSync={async (item) => {
        await loras.syncCivitai(item);
      }}
      onTriggerWordsApply={onAddTriggerWords}
      onTriggerWordsSave={async (item, words) => {
        await loras.saveLoraTriggerWords(item, words);
        return words;
      }}
      onTriggerWordsRead={async (item) => {
        await loras.loadTriggerWords(item);
        return [];
      }}
      onPromptApply={(pos, neg) => {
        const append = (current: string, addition: string) => {
          if (!addition.trim()) return current;
          if (!current.trim()) return addition.trim();
          const trimmed = current.trim();
          const sep = (trimmed.endsWith(',') || trimmed.endsWith('，')) ? ' ' : ', ';
          return trimmed + sep + addition.trim();
        };

        const updater = <T extends BaseGenerationParams | MultiGenerationParams>(prev: T): T => {
          const posKey = tab === "multi" ? "globalPrompt" : "positivePrompt";
          return {
            ...prev,
            [posKey]: append(String((prev as unknown as Record<string, unknown>)[posKey] ?? ""), pos),
            negativePrompt: append(prev.negativePrompt ?? "", neg)
          } as T;
        };

        if (tab === "sheet") {
          // 三视图页的正向落点是「角色描述」，不是 positivePrompt
          params.setSheetParams((prev) => {
            const join = (current: string, addition: string) =>
              [current.trim(), addition.trim()].filter(Boolean).join(", ");
            const next: typeof prev = { ...prev, characterPrompt: join(prev.characterPrompt, pos) };
            if (prev.mode === "anima") {
              next.anima = { ...prev.anima, negativePrompt: join(prev.anima.negativePrompt, neg) };
            } else {
              next.sdxl = { ...prev.sdxl, negativePrompt: join(prev.sdxl.negativePrompt, neg) };
            }
            return next;
          });
        } else if (tab === "dataset") {
          // 数据集页同理：正向落「角色固定词」，负向落当前模型族
          params.setDatasetParams((prev) => {
            const join = (current: string, addition: string) =>
              [current.trim(), addition.trim()].filter(Boolean).join(", ");
            const next: typeof prev = { ...prev, characterPrompt: join(prev.characterPrompt, pos) };
            if (prev.mode === "anima") {
              next.anima = { ...prev.anima, negativePrompt: join(prev.anima.negativePrompt, neg) };
            } else {
              next.sdxl = { ...prev.sdxl, negativePrompt: join(prev.sdxl.negativePrompt, neg) };
            }
            return next;
          });
        } else if (tab === "multi") {
          params.setMultiParams(updater);
        } else if (tab === "highres") {
          params.setHighresParams(updater);
        } else if (tab === "anima") {
          params.setAnimaParams(updater);
        } else {
          params.setDefaultParams(updater);
        }
        pushToast("success", "提示词已应用", "已成功追加到输入框");
      }}
      onOpenLoraFolder={loras.openLoraExampleFolder}
      onPullLoraExamples={async (item) => {
        await loras.pullLoraExamples(item);
        return [];
      }}
      onPauseDownloads={loras.pauseExampleDownloads}
      onResumeDownloads={loras.resumeExampleDownloads}
      onStopDownloads={loras.stopExampleDownloads}
      onUpdateSettings={async (s) => {
        loras.updateLoraSettings(s);
      }}
      onDoctorAction={loras.doctorAction}
      loras={loras}
      apiBase={apiBase}
      setApiBase={setApiBase}
      ui={ui}
      client={client}
      watermark={watermark}
      translationSettings={translationSettings}
      onTranslationSettingsSaved={onTranslationSettingsSaved}
      pushToast={pushToast}
      toasts={toasts}
      notificationLog={notificationLog}
    />
  );
}
