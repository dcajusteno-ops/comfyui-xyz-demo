import type {
  ApiResult,
  ComfyPrompt,
  ConnectionInfo,
  DoctorDiagnosticsResult,
  DownloadProgress,
  ExampleImagesPendingResult,
  ExampleImagesStartResult,
  ExampleImagesStatus,
  JobResult,
  LoraDuplicateGroup,
  LoraExampleFilesResult,
  LoraExampleMedia,
  LoraItem,
  LoraListResult,
  LoraManagerSettings,
  LoraMetadata,
  LoraMetadataResult,
  LoraRecipe,
  LoraUpdateRecord,
  ManagedModelType,
  ProgressState,
} from "../types";

type ObjectInfo = Record<string, {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
}>;

// 结果解析与归并的纯逻辑（原先在本文件里重复写了两份，且行为不一致）
import { collectNodeImages, collectNodeTexts, mergeJobResult } from "./comfyResult";

type QueueResponse = {
  prompt_id: string;
  number?: number;
  node_errors?: Record<string, unknown>;
};

type HistoryEntry = {
  outputs?: Record<string, Record<string, unknown>>;
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: unknown[];
  };
};

type ManagedModelListParams = {
  search?: string;
  folder?: string;
  baseModel?: string;
  tag?: string;
  page?: number;
  pageSize?: number;
};

/** /api/queue 的展示条目（只保留 promptId 与序号，完整图在工作流侧不需要） */
export type QueueItem = { promptId: string; number: number };
export type QueueState = { running: QueueItem[]; pending: QueueItem[] };

function managedModelPayloadType(modelType: ManagedModelType) {
  return modelType === "embeddings" ? "embedding" : "lora";
}

export class ComfyClient {
  private status: ConnectionInfo = { status: "checking" };
  private listeners: ((info: ConnectionInfo) => void)[] = [];
  private monitorSocket: WebSocket | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private clientId: string = this.generateId();
  private promptListeners = new Map<string, (message: any) => void>();
  private currentExecutingPromptId: string | null = null;

  constructor(private readonly baseUrl = "/comfy") {}

  private generateId() {
    try {
      return crypto.randomUUID();
    } catch {
      return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
  }

  onStatusChange(listener: (info: ConnectionInfo) => void) {
    this.listeners.push(listener);
    listener(this.status);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private updateStatus(patch: Partial<ConnectionInfo>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l(this.status));
  }

  getStatus() {
    return this.status;
  }

  startMonitoring() {
    if (this.monitorSocket) return;
    this.connectMonitor();
  }

  stopMonitoring() {
    this.clearTimers();
    if (this.monitorSocket) {
      this.monitorSocket.close();
      this.monitorSocket = null;
    }
  }

  private clearTimers() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async connectMonitor() {
    this.clearTimers();
    
    try {
      // First check if the server is alive via HTTP
      const stats = await this.getSystemStats() as { system?: { comfyui_version?: string }; devices?: Array<{ name?: string; vram_total?: number; vram_free?: number }> };
      const version = stats?.system?.comfyui_version || "未知版本";
      
      const socket = this.openSocket(this.clientId);
      this.monitorSocket = socket;

      socket.onopen = () => {
        this.updateStatus({ status: "online", version });
        this.startHeartbeat();
      };

      socket.onclose = () => {
        this.monitorSocket = null;
        this.updateStatus({ status: "offline" });
        this.scheduleReconnect();
      };

      socket.onerror = () => {
        this.updateStatus({ status: "error", message: "WebSocket 连接错误" });
      };

      socket.onmessage = (event) => {
        if (event.data === "pong") {
          return;
        }
        
        try {
          // Handle binary previews
          if (typeof event.data !== "string") {
            if (this.currentExecutingPromptId) {
              const listener = this.promptListeners.get(this.currentExecutingPromptId);
              if (listener) {
                listener({ type: "preview", data: event.data });
              }
            }
            return;
          }

          const message = JSON.parse(event.data);
          const data = message.data ?? {};
          const promptId = data.prompt_id;

          // Track which prompt is currently executing for binary preview routing
          if (message.type === "executing" && promptId) {
            this.currentExecutingPromptId = data.node ? promptId : null;
          }

          if (promptId) {
            const listener = this.promptListeners.get(promptId);
            if (listener) {
              listener(message);
            }
          }
        } catch {
          // Ignore parse errors for non-JSON messages
        }
      };
    } catch (error) {
      this.updateStatus({ status: "offline", message: error instanceof Error ? error.message : String(error) });
      this.scheduleReconnect();
    }
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = window.setInterval(() => {
      if (this.monitorSocket?.readyState === WebSocket.OPEN) {
        // ComfyUI doesn't strictly require pings to stay open, 
        // but sending something keeps the connection active through proxies
        this.monitorSocket.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000); // 30 seconds heartbeat
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      this.connectMonitor();
    }, 5000); // Reconnect every 5 seconds
  }

  async getSystemStats() {
    return this.getJson("/system_stats").catch(() => this.getJson("/api/system_stats"));
  }

  async getObjectInfo(nodeClass?: string): Promise<ObjectInfo> {
    const suffix = nodeClass ? `/${encodeURIComponent(nodeClass)}` : "";
    return this.getJson(`/api/object_info${suffix}`);
  }

  async getNodeOptions(nodeClass: string, inputName: string): Promise<string[]> {
    const data = await this.getObjectInfo(nodeClass);
    const node = data[nodeClass];
    const required = node?.input?.required ?? {};
    const entry = required[inputName];
    if (Array.isArray(entry) && Array.isArray(entry[0])) {
      return entry[0].map(String);
    }
    return [];
  }

  async listManagedModels(modelType: ManagedModelType, params: ManagedModelListParams = {}): Promise<LoraListResult> {
    const query = new URLSearchParams({
      page: String(params.page ?? 1),
      page_size: String(params.pageSize ?? 100),
      sort_by: "name",
    });
    if (params.search?.trim()) {
      query.set("search", params.search.trim());
      query.set("fuzzy_search", "true");
      query.set("fuzzy", "true");
    }
    if (params.folder) {
      query.set("folder", params.folder);
    }
    if (params.baseModel) {
      query.set("base_model", params.baseModel);
    }
    if (params.tag) {
      query.set("tag", params.tag);
    }
    const data = await this.getJson<{ items: LoraItem[]; total: number; page: number; page_size: number; total_pages: number }>(`/api/lm/${modelType}/list?${query}`);
    return {
      items: data.items ?? [],
      total: data.total ?? 0,
      page: data.page ?? Number(query.get("page")),
      pageSize: data.page_size ?? Number(query.get("page_size")),
      totalPages: data.total_pages ?? 1,
    };
  }

  async listLoras(params: ManagedModelListParams = {}): Promise<LoraListResult> {
    return this.listManagedModels("loras", params);
  }

  async getManagedModelFolders(modelType: ManagedModelType): Promise<string[]> {
    const data = await this.getJson<{ folders?: string[] }>(`/api/lm/${modelType}/folders`);
    return data.folders ?? [];
  }

  async getLoraFolders(): Promise<string[]> {
    return this.getManagedModelFolders("loras");
  }

  async getManagedModelBaseModels(modelType: ManagedModelType): Promise<Array<{ name: string; count: number }>> {
    const data = await this.getJson<{ success: boolean; base_models?: Array<{ name: string; count: number }> }>(`/api/lm/${modelType}/base-models`);
    return data.base_models ?? [];
  }

  async getLoraBaseModels(): Promise<Array<{ name: string; count: number }>> {
    return this.getManagedModelBaseModels("loras");
  }

  async getManagedModelTopTags(modelType: ManagedModelType): Promise<string[]> {
    const data = await this.getJson<{ success: boolean; tags?: Array<string | { tag: string; count?: number }> }>(`/api/lm/${modelType}/top-tags`);
    return (data.tags ?? []).map((tag) => typeof tag === "string" ? tag : tag.tag).filter(Boolean);
  }

  async getLoraTopTags(): Promise<string[]> {
    return this.getManagedModelTopTags("loras");
  }

  async getLoraMetadata(name: string) {
    const query = new URLSearchParams({ name });
    return this.getJson(`/api/lm/loras/metadata?${query}`);
  }

  async getLoraMetadataByPath(filePath: string): Promise<LoraMetadata | undefined> {
    const query = new URLSearchParams({ file_path: filePath });
    const data = await this.getJson<LoraMetadataResult>(`/api/lm/loras/metadata?${query}`);
    return data.metadata;
  }

  async getManagedModelMetadataByPath(modelType: ManagedModelType, filePath: string): Promise<LoraMetadata | undefined> {
    const query = new URLSearchParams({ file_path: filePath });
    const data = await this.getJson<LoraMetadataResult>(`/api/lm/${modelType}/metadata?${query}`);
    return data.metadata;
  }

  async refreshManagedModelCivitaiMetadata(modelType: ManagedModelType, filePath: string): Promise<LoraItem | undefined> {
    const data = await this.postJson<{ success: boolean; metadata?: LoraItem; error?: string }>(`/api/lm/${modelType}/fetch-civitai`, { file_path: filePath });
    if (!data.success) {
      throw new Error(data.error || "Civitai metadata refresh failed");
    }
    return data.metadata;
  }

  async saveManagedModelMetadata(modelType: ManagedModelType, filePath: string, updates: Record<string, unknown>): Promise<ApiResult<{ auto_tags?: string[] }>> {
    return this.postJson(`/api/lm/${modelType}/save-metadata`, { file_path: filePath, ...updates });
  }

  async setManagedModelFavorite(modelType: ManagedModelType, filePath: string, favorite: boolean): Promise<ApiResult<{ auto_tags?: string[] }>> {
    return this.saveManagedModelMetadata(modelType, filePath, { favorite });
  }

  async renameManagedModel(modelType: ManagedModelType, filePath: string, newFileName: string): Promise<ApiResult<{ new_file_path?: string; new_preview_path?: string }>> {
    return this.postJson(`/api/lm/${modelType}/rename`, { file_path: filePath, new_file_name: newFileName });
  }

  async deleteManagedModel(modelType: ManagedModelType, filePath: string): Promise<ApiResult> {
    return this.postJson(`/api/lm/${modelType}/delete`, { file_path: filePath });
  }

  async bulkDeleteManagedModels(modelType: ManagedModelType, filePaths: string[]): Promise<ApiResult<{ deleted?: string[]; failed?: Array<Record<string, unknown>> }>> {
    return this.postJson(`/api/lm/${modelType}/bulk-delete`, { file_paths: filePaths });
  }

  async moveManagedModel(modelType: ManagedModelType, filePath: string, targetPath: string, useDefaultPaths = false): Promise<ApiResult> {
    return this.postJson(`/api/lm/${modelType}/move_model`, {
      file_path: filePath,
      target_path: targetPath,
      use_default_paths: useDefaultPaths,
    });
  }

  async bulkMoveManagedModels(modelType: ManagedModelType, filePaths: string[], targetPath: string, useDefaultPaths = false): Promise<ApiResult> {
    return this.postJson(`/api/lm/${modelType}/move_models_bulk`, {
      file_paths: filePaths,
      target_path: targetPath,
      use_default_paths: useDefaultPaths,
    });
  }

  async findManagedModelDuplicates(modelType: ManagedModelType, params: { folder?: string; favoritesOnly?: boolean } = {}): Promise<{ duplicates: LoraDuplicateGroup[]; count: number }> {
    const query = new URLSearchParams();
    if (params.folder) query.set("folder", params.folder);
    if (params.favoritesOnly) query.set("favorites_only", "true");
    const data = await this.getJson<ApiResult<{ duplicates?: LoraDuplicateGroup[]; count?: number }>>(`/api/lm/${modelType}/find-duplicates${query.size ? `?${query}` : ""}`);
    return { duplicates: data.duplicates ?? [], count: data.count ?? 0 };
  }

  async findManagedModelFilenameConflicts(modelType: ManagedModelType): Promise<{ conflicts: LoraDuplicateGroup[]; count: number }> {
    const data = await this.getJson<ApiResult<{ conflicts?: LoraDuplicateGroup[]; count?: number }>>(`/api/lm/${modelType}/find-filename-conflicts`);
    return { conflicts: data.conflicts ?? [], count: data.count ?? 0 };
  }

  async refreshManagedModelUpdates(modelType: ManagedModelType, options: { force?: boolean; modelIds?: number[]; folderPath?: string } = {}): Promise<ApiResult<{ records?: LoraUpdateRecord[] }>> {
    const query = options.force ? "?force=true" : "";
    return this.postJson(`/api/lm/${modelType}/updates/refresh${query}`, {
      force: options.force ?? false,
      modelIds: options.modelIds,
      folder_path: options.folderPath,
    });
  }

  async ignoreManagedModelUpdate(modelType: ManagedModelType, modelId: number, shouldIgnore: boolean): Promise<ApiResult<{ record?: LoraUpdateRecord }>> {
    return this.postJson(`/api/lm/${modelType}/updates/ignore`, { modelId, shouldIgnore });
  }

  async getManagedModelCivitaiByHash(modelType: ManagedModelType, hash: string): Promise<ApiResult<Record<string, unknown>>> {
    return this.getJson(`/api/lm/${modelType}/civitai/model/hash/${encodeURIComponent(hash)}`);
  }

  async downloadManagedModel(modelType: ManagedModelType, payload: Record<string, unknown>): Promise<ApiResult<{ download_id?: string }>> {
    return this.postJson("/api/lm/download-model", {
      ...payload,
      model_type: payload.model_type ?? managedModelPayloadType(modelType),
    });
  }

  async refreshLoraCivitaiMetadata(filePath: string): Promise<LoraItem | undefined> {
    const data = await this.postJson<{ success: boolean; metadata?: LoraItem; error?: string }>("/api/lm/loras/fetch-civitai", { file_path: filePath });
    if (!data.success) {
      throw new Error(data.error || "刷新 Civitai 元数据失败");
    }
    return data.metadata;
  }

  async saveLoraMetadata(filePath: string, updates: Record<string, unknown>): Promise<ApiResult<{ auto_tags?: string[] }>> {
    return this.postJson("/api/lm/loras/save-metadata", { file_path: filePath, ...updates });
  }

  async setLoraFavorite(filePath: string, favorite: boolean): Promise<ApiResult<{ auto_tags?: string[] }>> {
    return this.saveLoraMetadata(filePath, { favorite });
  }

  async renameLora(filePath: string, newFileName: string): Promise<ApiResult<{ new_file_path?: string; new_preview_path?: string }>> {
    return this.postJson("/api/lm/loras/rename", { file_path: filePath, new_file_name: newFileName });
  }

  async deleteLora(filePath: string): Promise<ApiResult> {
    return this.postJson("/api/lm/loras/delete", { file_path: filePath });
  }

  async bulkDeleteLoras(filePaths: string[]): Promise<ApiResult<{ deleted?: string[]; failed?: Array<Record<string, unknown>> }>> {
    return this.postJson("/api/lm/loras/bulk-delete", { file_paths: filePaths });
  }

  async moveLora(filePath: string, targetPath: string, useDefaultPaths = false): Promise<ApiResult> {
    return this.postJson("/api/lm/loras/move_model", {
      file_path: filePath,
      target_path: targetPath,
      use_default_paths: useDefaultPaths,
    });
  }

  async bulkMoveLoras(filePaths: string[], targetPath: string, useDefaultPaths = false): Promise<ApiResult> {
    return this.postJson("/api/lm/loras/move_models_bulk", {
      file_paths: filePaths,
      target_path: targetPath,
      use_default_paths: useDefaultPaths,
    });
  }

  async findLoraDuplicates(params: { folder?: string; favoritesOnly?: boolean } = {}): Promise<{ duplicates: LoraDuplicateGroup[]; count: number }> {
    const query = new URLSearchParams();
    if (params.folder) query.set("folder", params.folder);
    if (params.favoritesOnly) query.set("favorites_only", "true");
    const data = await this.getJson<ApiResult<{ duplicates?: LoraDuplicateGroup[]; count?: number }>>(`/api/lm/loras/find-duplicates${query.size ? `?${query}` : ""}`);
    return { duplicates: data.duplicates ?? [], count: data.count ?? 0 };
  }

  async findLoraFilenameConflicts(): Promise<{ conflicts: LoraDuplicateGroup[]; count: number }> {
    const data = await this.getJson<ApiResult<{ conflicts?: LoraDuplicateGroup[]; count?: number }>>("/api/lm/loras/find-filename-conflicts");
    return { conflicts: data.conflicts ?? [], count: data.count ?? 0 };
  }

  async verifyLoraDuplicates(filePaths: string[]): Promise<ApiResult> {
    return this.postJson("/api/lm/loras/verify-duplicates", { file_paths: filePaths });
  }

  async refreshLoraUpdates(options: { force?: boolean; modelIds?: number[]; folderPath?: string } = {}): Promise<ApiResult<{ records?: LoraUpdateRecord[] }>> {
    const query = options.force ? "?force=true" : "";
    return this.postJson(`/api/lm/loras/updates/refresh${query}`, {
      force: options.force ?? false,
      modelIds: options.modelIds,
      folder_path: options.folderPath,
    });
  }

  async getLoraUpdateStatus(modelId: number, options: { refresh?: boolean; force?: boolean } = {}): Promise<ApiResult<{ record?: LoraUpdateRecord }>> {
    const query = new URLSearchParams();
    if (options.refresh) query.set("refresh", "true");
    if (options.force) query.set("force", "true");
    return this.getJson(`/api/lm/loras/updates/status/${encodeURIComponent(String(modelId))}${query.size ? `?${query}` : ""}`);
  }

  async getLoraVersions(modelId: number, options: { refresh?: boolean; force?: boolean } = {}): Promise<ApiResult<{ record?: LoraUpdateRecord }>> {
    const query = new URLSearchParams();
    if (options.refresh) query.set("refresh", "true");
    if (options.force) query.set("force", "true");
    return this.getJson(`/api/lm/loras/updates/versions/${encodeURIComponent(String(modelId))}${query.size ? `?${query}` : ""}`);
  }

  async ignoreLoraUpdate(modelId: number, shouldIgnore: boolean): Promise<ApiResult<{ record?: LoraUpdateRecord }>> {
    return this.postJson("/api/lm/loras/updates/ignore", { modelId, shouldIgnore });
  }

  async ignoreLoraVersion(modelId: number, versionId: number, shouldIgnore: boolean): Promise<ApiResult<{ record?: LoraUpdateRecord }>> {
    return this.postJson("/api/lm/loras/updates/ignore-version", { modelId, versionId, shouldIgnore });
  }

  async getLoraCivitaiByHash(hash: string): Promise<ApiResult<Record<string, unknown>>> {
    return this.getJson(`/api/lm/loras/civitai/model/hash/${encodeURIComponent(hash)}`);
  }

  async getLoraCivitaiByVersion(modelVersionId: number): Promise<ApiResult<Record<string, unknown>>> {
    return this.getJson(`/api/lm/loras/civitai/model/version/${encodeURIComponent(String(modelVersionId))}`);
  }

  async downloadLoraModel(payload: Record<string, unknown>): Promise<ApiResult<{ download_id?: string }>> {
    return this.postJson("/api/lm/download-model", payload);
  }

  async getDownloadProgress(downloadId: string): Promise<DownloadProgress> {
    return this.getJson(`/api/lm/download-progress/${encodeURIComponent(downloadId)}`);
  }

  async pauseDownload(): Promise<ApiResult> {
    return this.getJson("/api/lm/pause-download");
  }

  async resumeDownload(): Promise<ApiResult> {
    return this.getJson("/api/lm/resume-download");
  }

  async cancelDownload(): Promise<ApiResult> {
    return this.getJson("/api/lm/cancel-download-get");
  }

  async getLoraExampleFiles(modelHash?: string): Promise<LoraExampleMedia[]> {
    if (!modelHash) return [];
    const query = new URLSearchParams({ model_hash: modelHash });
    const data = await this.getLocalJson<LoraExampleFilesResult>(`/xyz/example-image-files?${query}`);
    return data.files ?? [];
  }

  async getExampleImagesStatus(): Promise<ExampleImagesStatus> {
    return this.getLocalJson<ExampleImagesStatus>("/xyz/example-images/status");
  }

  async checkExampleImagesNeeded(modelTypes = ["lora"]): Promise<ExampleImagesPendingResult> {
    return this.postLocalJson<ExampleImagesPendingResult>("/xyz/example-images/check", { model_types: modelTypes });
  }

  async downloadExampleImages(options: { force?: boolean; optimize?: boolean; modelTypes?: string[] } = {}): Promise<ExampleImagesStartResult> {
    return this.postLocalJson<ExampleImagesStartResult>("/xyz/example-images/download", {
      force: options.force ?? true,
      optimize: options.optimize ?? false,
      model_types: options.modelTypes ?? ["lora"],
    });
  }

  async forceDownloadExampleImages(modelHashes: string[], options: { force?: boolean; optimize?: boolean; modelTypes?: string[]; items?: LoraItem[] } = {}): Promise<ExampleImagesStartResult> {
    return this.postLocalJson<ExampleImagesStartResult>("/xyz/example-images/force-download", {
      model_hashes: modelHashes.map((hash) => hash.toLowerCase()),
      items: options.items,
      force: options.force ?? true,
      optimize: options.optimize ?? false,
      model_types: options.modelTypes ?? ["lora"],
    });
  }

  async openExampleImagesFolder(modelHash: string): Promise<{ success: boolean; path?: string; uri?: string; mode?: string; error?: string }> {
    return this.postLocalJson("/xyz/example-images/open-folder", { model_hash: modelHash });
  }

  /** 列出某目录下的一层子目录（T10-① 目录选择器用；只读、不含文件） */
  async listLocalFolders(dir: string): Promise<{ success: boolean; path: string; parent: string | null; folders: string[]; error?: string }> {
    const query = new URLSearchParams({ path: dir });
    return this.getJson(`/xyz/fs/folders?${query}`);
  }

  async pauseExampleImages(): Promise<ExampleImagesStartResult> {
    return this.postLocalJson<ExampleImagesStartResult>("/xyz/example-images/pause", {});
  }

  async resumeExampleImages(): Promise<ExampleImagesStartResult> {
    return this.postLocalJson<ExampleImagesStartResult>("/xyz/example-images/resume", {});
  }

  async stopExampleImages(): Promise<ExampleImagesStartResult> {
    return this.postLocalJson<ExampleImagesStartResult>("/xyz/example-images/stop", {});
  }

  async cleanupExampleImageFolders(): Promise<ApiResult> {
    return this.postJson("/api/lm/cleanup-example-image-folders", {});
  }

  async scanLoras() {
    return this.scanManagedModels("loras");
  }

  async scanManagedModels(modelType: ManagedModelType) {
    return this.getJson(`/api/lm/${modelType}/scan`);
  }

  async listRecipes(params: { search?: string; loraHash?: string; page?: number; pageSize?: number } = {}): Promise<{ items: LoraRecipe[]; total: number; page: number; page_size: number; total_pages?: number }> {
    const query = new URLSearchParams({
      page: String(params.page ?? 1),
      page_size: String(params.pageSize ?? 20),
      sort_by: "date",
    });
    if (params.search) query.set("search", params.search);
    if (params.loraHash) query.set("lora_hash", params.loraHash);
    return this.getJson(`/api/lm/recipes?${query}`);
  }

  async getRecipe(recipeId: string): Promise<LoraRecipe> {
    return this.getJson(`/api/lm/recipe/${encodeURIComponent(recipeId)}`);
  }

  async getRecipesForLora(hash: string): Promise<LoraRecipe[]> {
    const query = new URLSearchParams({ hash });
    const data = await this.getJson<ApiResult<{ recipes?: LoraRecipe[] }>>(`/api/lm/recipes/for-lora?${query}`);
    return data.recipes ?? [];
  }

  async getRecipeSyntax(recipeId: string): Promise<string> {
    const data = await this.getJson<ApiResult<{ syntax?: string }>>(`/api/lm/recipe/${encodeURIComponent(recipeId)}/syntax`);
    return data.syntax ?? "";
  }

  async scanRecipes(): Promise<ApiResult> {
    return this.getJson("/api/lm/recipes/scan");
  }

  async getDoctorDiagnostics(): Promise<DoctorDiagnosticsResult> {
    return this.getJson("/api/lm/doctor/diagnostics");
  }

  async repairDoctorCache(): Promise<ApiResult> {
    return this.postJson("/api/lm/doctor/repair-cache", {});
  }

  async resolveDoctorFilenameConflicts(): Promise<ApiResult> {
    return this.postJson("/api/lm/doctor/resolve-filename-conflicts", {});
  }

  async exportDoctorBundle(): Promise<ApiResult<{ path?: string; bundle_path?: string; uri?: string }>> {
    return this.postJson("/api/lm/doctor/export-bundle", {});
  }

  async getLoraManagerSettings(): Promise<ApiResult<{ settings?: LoraManagerSettings } & LoraManagerSettings>> {
    return this.getJson("/api/lm/settings");
  }

  async updateLoraManagerSettings(settings: Partial<LoraManagerSettings>): Promise<ApiResult<{ settings?: LoraManagerSettings }>> {
    return this.postJson("/api/lm/settings", settings);
  }

  async healthCheck(): Promise<ApiResult<{ status?: string }>> {
    return this.getJson("/api/lm/health-check");
  }

  async getLoraTriggerWords(name: string): Promise<string[]> {
    const query = new URLSearchParams({ name });
    const data = await this.getJson<{ success: boolean; trigger_words?: string[] | string }>(`/api/lm/loras/get-trigger-words?${query}`);
    if (Array.isArray(data.trigger_words)) {
      return data.trigger_words.map(String);
    }
    if (typeof data.trigger_words === "string") {
      return data.trigger_words.split(",").map((word) => word.trim()).filter(Boolean);
    }
    return [];
  }

  async extractLoraMetadata(filePath: string): Promise<Record<string, string>> {
    const data = await this.postLocalJson<{ success: boolean; metadata?: Record<string, string>; error?: string }>("/xyz/lora/extract-metadata", { file_path: filePath });
    if (!data.success) {
      throw new Error(data.error || "Failed to extract metadata");
    }
    return data.metadata || {};
  }

  async saveLoraTriggerWords(filePath: string, words: string[]): Promise<ApiResult<{ metadata?: LoraItem; auto_tags?: string[] }>> {
    return this.saveLoraMetadata(filePath, {
      civitai: { trainedWords: words },
    });
  }

  async uploadImage(file: File): Promise<{ name: string; subfolder?: string; type?: string }> {
    const form = new FormData();
    form.set("image", file);
    form.set("type", "input");
    form.set("overwrite", "true");
    const result = await this.postForm<{ name: string; subfolder?: string; type?: string }>("/api/upload/image", form);
    return result;
  }

  async queuePrompt(prompt: ComfyPrompt, clientId: string): Promise<QueueResponse> {
    return this.postJson("/api/prompt", {
      prompt,
      client_id: clientId,
    });
  }

  async interrupt(promptId?: string) {
    return this.postJson("/api/interrupt", promptId ? { prompt_id: promptId } : {});
  }

  /**
   * 任务队列（T11）。ComfyUI 的 /queue 返回 `queue_running` / `queue_pending` 两组，
   * 每项是 `[number, prompt_id, prompt, ...]` 数组——只取展示需要的 prompt_id。
   */
  async getQueue(): Promise<QueueState> {
    const raw = await this.getJson<{ queue_running?: unknown[]; queue_pending?: unknown[] }>("/api/queue");
    const parse = (entries?: unknown[]): QueueItem[] =>
      (entries ?? [])
        .map((entry) => {
          const promptId = Array.isArray(entry) && typeof entry[1] === "string" ? entry[1] : "";
          const number = Array.isArray(entry) && typeof entry[0] === "number" ? entry[0] : 0;
          return { promptId, number };
        })
        .filter((item) => item.promptId);
    return { running: parse(raw.queue_running), pending: parse(raw.queue_pending) };
  }

  /** 从队列移除指定 pending 任务（ComfyUI 约定：DELETE /queue + { delete: [promptId] }） */
  async deleteFromQueue(promptIds: string[]): Promise<unknown> {
    return this.deleteJson("/api/queue", { delete: promptIds });
  }

  /** 清空整个队列（ComfyUI 约定：POST /queue + 空的两组列表） */
  async clearQueue(): Promise<unknown> {
    return this.postJson("/api/queue", { queue_running: [], queue_pending: [] });
  }

  async getHistory(promptId: string): Promise<Record<string, HistoryEntry>> {
    return this.getJson(`/api/history/${encodeURIComponent(promptId)}`);
  }

  viewUrl(image: { filename: string; subfolder?: string; type?: string }) {
    const query = new URLSearchParams({
      filename: image.filename,
      type: image.type ?? "output",
    });
    if (image.subfolder) {
      query.set("subfolder", image.subfolder);
    }
    return `${this.baseUrl}/api/view?${query}`;
  }

  async runPrompt(
    prompt: ComfyPrompt,
    onProgress: (progress: ProgressState) => void,
  ): Promise<JobResult> {
    // Ensure monitoring is active (shared WebSocket)
    if (!this.monitorSocket || this.monitorSocket.readyState !== WebSocket.OPEN) {
      await this.connectMonitor();
      // Wait a bit for open if just called
      if (this.monitorSocket?.readyState !== WebSocket.OPEN) {
        await new Promise<void>((resolve) => {
          this.monitorSocket?.addEventListener("open", () => resolve(), { once: true });
          setTimeout(resolve, 5000); // Fallback
        });
      }
    }

    const clientId = this.clientId;
    let promptId = "";
    let completed = false;
    let finishNotified = false;

    const queued = await this.queuePrompt(prompt, clientId);
    promptId = queued.prompt_id;
    if (!promptId) {
      throw new Error("ComfyUI 没有返回 prompt_id");
    }

    let lastProgress: ProgressState = {
      running: true,
      promptId,
      value: 0,
      max: 1,
      label: "已进入队列",
    };

    /** 预览帧的对象 URL 缓冲：延迟 revoke，避免 <img> 还在加载就被吊销而闪裂图 */
    const previewUrlBacklog: string[] = [];
    const releasePreviewUrls = () => {
      for (const url of previewUrlBacklog.splice(0)) URL.revokeObjectURL(url);
      if (lastProgress.previewUrl) URL.revokeObjectURL(lastProgress.previewUrl);
    };

    const updateProgress = (patch: Partial<ProgressState>) => {
      lastProgress = { ...lastProgress, ...patch };
      onProgress(lastProgress);
    };

    updateProgress({});

    const finishFromHistory = async () => {
      const history = await this.waitForHistory(promptId);
      completed = true;
      this.promptListeners.delete(promptId);
      const extracted = this.extractHistory(promptId, history);
      if (!finishNotified) {
        finishNotified = true;
        updateProgress({
          running: false,
          promptId,
          value: 1,
          max: 1,
          label: "完成",
        });
      }
      return extracted;
    };

    return new Promise<JobResult>((resolve, reject) => {
      let resultsFromExecuted: JobResult | null = null;

      const fallbackTimer = window.setInterval(async () => {
        if (completed) return;
        try {
          const history = await this.getHistory(promptId);
          const entry = history[promptId];
          if (entry?.outputs && Object.keys(entry.outputs).length > 0) {
            window.clearInterval(fallbackTimer);
            releasePreviewUrls();
            resolve(await finishFromHistory());
          }
        } catch {
          // Keep waiting
        }
      }, 1000);

      const messageHandler = async (message: any) => {
        try {
          if (completed) return;
          const data = message.data ?? {};
          
          if (message.type === "preview") {
            // 二进制帧结构：8 字节头（[事件类型 u32][图片类型 u32]，图片类型 1=JPEG / 2=PNG / 3=WEBP）+ 图片字节。
            // 必须显式设置 MIME：WS 帧 slice 出的 Blob type 为空，blob: URL 无嗅探，<img> 会直接裂图。
            let buffer: ArrayBuffer | null = null;
            if (data instanceof Blob) {
              buffer = await data.arrayBuffer();
            } else if (data instanceof ArrayBuffer) {
              buffer = data;
            } else {
              return;
            }
            if (buffer.byteLength <= 8) return;
            const imageType = new DataView(buffer).getUint32(4, true);
            const mime = imageType === 2 ? "image/png" : imageType === 3 ? "image/webp" : "image/jpeg";
            const blob = new Blob([buffer.slice(8)], { type: mime });
            const url = URL.createObjectURL(blob);
            // 旧 URL 不能立即 revoke：<img> 可能还在加载它，立即吊销会闪裂图。
            // 保留 3 帧缓冲，延迟到第 4 帧才回收。
            const previous = lastProgress.previewUrl;
            updateProgress({ previewUrl: url });
            if (previous) {
              previewUrlBacklog.push(previous);
              while (previewUrlBacklog.length > 3) {
                const stale = previewUrlBacklog.shift();
                if (stale) URL.revokeObjectURL(stale);
              }
            }
            return;
          }

          if (message.type === "progress") {
            const nodeId = data.node;
            const nodeDef = nodeId ? prompt[nodeId] : null;
            const nodeTitle = nodeDef ? String(nodeDef._meta?.title || nodeId) : nodeId;
            updateProgress({
              running: true,
              promptId,
              node: nodeId ?? null,
              value: Number(data.value ?? 0),
              max: Math.max(1, Number(data.max ?? 1)),
              label: nodeTitle ? `绘图: ${nodeTitle}` : "绘图中",
            });
          }
          if (message.type === "executing" && data.prompt_id === promptId) {
            const nodeId = data.node;
            const nodeDef = nodeId ? prompt[nodeId] : null;
            const nodeTitle = nodeDef ? String(nodeDef._meta?.title || nodeId) : nodeId;
            updateProgress({
              running: true,
              promptId,
              node: nodeId ?? null,
              value: nodeId ? 0 : 1,
              max: 1,
              label: nodeId ? `正在执行 ${nodeTitle}` : "收尾中",
            });
            if (data.node === null) {
              window.clearInterval(fallbackTimer);
              releasePreviewUrls();
              if (resultsFromExecuted) {
                completed = true;
                this.promptListeners.delete(promptId);
                updateProgress({ running: false, value: 1, max: 1, label: "完成" });
                resolve(resultsFromExecuted);
              } else {
                resolve(await finishFromHistory());
              }
            }
          }
          if (message.type === "execution_error" && data.prompt_id === promptId) {
            window.clearInterval(fallbackTimer);
            releasePreviewUrls();
            this.promptListeners.delete(promptId);
            reject(new Error(data.exception_message || "ComfyUI 执行失败"));
          }
          if (message.type === "executed" && data.prompt_id === promptId) {
            const outputs = data.output ?? {};
            const nodeId = data.node;
            const nodeDef = prompt[nodeId];
            const nodeTitle = String(nodeDef?._meta?.title || nodeId);

            const images = collectNodeImages(outputs, nodeTitle, (image) => this.viewUrl(image));
            const texts = collectNodeTexts(outputs);

            if (images.length > 0 || texts.length > 0) {
              resultsFromExecuted = mergeJobResult(resultsFromExecuted, promptId, images, texts);
              updateProgress({
                running: true,
                promptId,
                node: nodeId,
                value: 1,
                max: 1,
                label: `节点 ${nodeTitle} 生成完毕`,
                images: resultsFromExecuted.images,
                texts: resultsFromExecuted.texts,
              });
            }
          }
        } catch (error) {
          window.clearInterval(fallbackTimer);
          this.promptListeners.delete(promptId);
          reject(error);
        }
      };

      this.promptListeners.set(promptId, messageHandler);
    });
  }

  private async waitForHistory(promptId: string) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const history = await this.getHistory(promptId);
      const entry = history[promptId];
      if (entry?.outputs && Object.keys(entry.outputs).length > 0) {
        return history;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }
    return this.getHistory(promptId);
  }

  private extractHistory(promptId: string, history: Record<string, HistoryEntry>): JobResult {
    const entry = history[promptId];

    // Optional chaining because TS types for history might not include prompt
    const promptDefs = (entry as unknown as { prompt?: [unknown, unknown, Record<string, Record<string, unknown> & { _meta?: { title?: string } }> ] })?.prompt?.[2] ?? {};

    let merged: JobResult | null = null;
    for (const [nodeId, output] of Object.entries(entry?.outputs ?? {})) {
      const nodeTitle = promptDefs[nodeId]?._meta?.title;
      const outputs = output as Record<string, unknown>;
      const images = collectNodeImages(outputs, nodeTitle, (image) => this.viewUrl(image));
      const texts = collectNodeTexts(outputs);
      if (images.length === 0 && texts.length === 0) continue;
      merged = mergeJobResult(merged, promptId, images, texts);
    }

    return {
      promptId,
      images: merged?.images ?? [],
      texts: merged?.texts ?? [],
      rawHistory: history,
    };
  }

  private openSocket(clientId: string) {
    const base = new URL(this.baseUrl, window.location.origin);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/$/, "")}/ws`;
    base.searchParams.set("clientId", clientId);
    return new WebSocket(base);
  }

  private async getJson<T = unknown>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`${path} ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private async postJson<T = unknown>(path: string, payload: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${path} ${response.status}: ${body}`);
    }
    return response.json() as Promise<T>;
  }

  private async deleteJson<T = unknown>(path: string, payload: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${path} ${response.status}: ${body}`);
    }
    return response.json() as Promise<T>;
  }

  private async getLocalJson<T = unknown>(path: string): Promise<T> {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`${path} ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  private async postLocalJson<T = unknown>(path: string, payload: unknown): Promise<T> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${path} ${response.status}: ${body}`);
    }
    return response.json() as Promise<T>;
  }

  private async postForm<T = unknown>(path: string, form: FormData): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${path} ${response.status}: ${body}`);
    }
    return response.json() as Promise<T>;
  }
}
