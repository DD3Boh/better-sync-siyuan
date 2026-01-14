import {
    getRepoSnapshots,
    createSnapshot,
    getFileBlob,
    lsNotebooks,
    readDir,
    reloadFiletree,
    getUnusedAssets,
    requestWithHeaders,
    upload
} from "@/api";
import BetterSyncPlugin from "..";
import { IProtyle, Protyle, showMessage } from "siyuan";
import { ConflictHandler, LOCK_FILE, Remote, SYNC_CONFIG_DIR, StorageItem, SyncHistory, SyncUtils, WebSocketManager, getSyncTargets } from "@/sync";
import { Payload } from "@/libs/payload";
import { SyncStatus, SyncStatusCallback, SyncFileResult } from "@/types/sync-status";
import { consoleError, consoleLog, consoleWarn, SessionLog } from "@/logging";

export class SyncManager {
    // Plugin instance
    private plugin: BetterSyncPlugin;

    /**
     * WebSocket managers for local and remote servers.
     * These are used to handle real-time updates and notifications during the sync process.
     */
    private inputWebSocketManagers: [WebSocketManager, WebSocketManager] = [null, null];
    private outputWebSocketManagers: [WebSocketManager, WebSocketManager] = [null, null];

    /**
     * Remotes array containing information about local and remote servers.
     * The first element is always the local server, the second is the remote server.
     */
    private remotes: [Remote, Remote] = [
        Remote.default(),
        Remote.empty()
    ];

    /**
     * Map of loaded Protyles, where the key is the file path and the value is the Protyle instance.
     * This allows for quick access to Protyles by their file path.
     */
    private loadedProtyles: Map<string, Protyle> = new Map();

    /**
     * The currently active Protyle instance, if any.
     * This is used to set the focus on the correct Protyle after syncing.
     */
    private activeProtyle: Protyle | null = null;

    /**
     * Set of file paths that have been updated locally during the current sync session.
     * This is used to determine which files need to be reloaded in the Protyle instances.
     */
    private locallyUpdatedFiles: Set<string> = new Set();

    /**
     * Set of file paths that have been updated remotely during the current sync session.
     * This is used to track files that may need to be reloaded or handled differently.
     */
    private remotelyUpdatedFiles: Set<string> = new Set();

    /**
     * Original fetch function to restore after overriding it for custom sync behavior.
     * This is used to ensure that the original fetch functionality is preserved.
     */
    private originalFetch: typeof window.fetch;

    /**
     * Flag to indicate if a conflict was detected during the sync process.
     * This is used to show appropriate messages after the sync completes.
     */
    private conflictDetected: boolean = false;

    /**
     * Map of pending directory requests, where the key is the request ID and the value is the resolve function.
     * This is used to handle asynchronous directory file requests via WebSocket.
     */
    private pendingDirRequests: Map<string, (files: StorageItem | null) => void> = new Map();

    private receivedAppIds: Set<string> = new Set();

    /**
     * Set of request IDs that are initiated via WebSocket communication.
     * This is used to exclude these requests from being processed again by customFetch.
     */
    private webSocketRequestIds: Set<string> = new Set();

    private syncStatus: SyncStatus = SyncStatus.None;
    private statusCallbacks: SyncStatusCallback[] = [];

    /**
     * Pending file changes that are waiting to be synced.
     */
    private pendingFileChanges: Map<string, number> = new Map();

    /**
     * Constructor for the SyncManager class.
     * Initializes the plugin instance and overrides the fetch function to handle sync operations.
     * @param plugin The BetterSyncPlugin instance.
     */
    constructor(plugin: BetterSyncPlugin) {
        this.plugin = plugin;
        this.init();

        this.originalFetch = window.fetch.bind(window);
        window.fetch = this.customFetch.bind(this);
    }

    /**
     * Register a callback for sync status changes.
     * @param callback The callback to register.
     */
    onSyncStatusChange(callback: SyncStatusCallback) {
        this.statusCallbacks.push(callback);
    }

    /**
     * Set the sync status and notify listeners.
     * @param status The new sync status.
     */
    private setSyncStatus(status: SyncStatus) {
        this.syncStatus = status;
        this.statusCallbacks.forEach(callback => callback(status));
    }

    /**
     * Get the current sync status.
     *
     * @return The current sync status.
     */
    getSyncStatus(): SyncStatus {
        return this.syncStatus;
    }

    /**
     * Getters
     */
    private getUrl(): string {
        return this.plugin.settingsManager.getPref("siyuanUrl");
    }

    private getKey(): string {
        return this.plugin.settingsManager.getPref("siyuanAPIKey");
    }

    private getNickname(): string {
        return this.plugin.settingsManager.getPref("siyuanNickname");
    }

    /**
     * Initialize the SyncManager by setting up remotes and WebSocket connections.
     * This method retrieves the URL, key, and nickname from the plugin settings
     * and configures the remotes accordingly.
     * It also retrieves and sets the instance IDs for the remotes and setup the
     * WebSocket connections for real-time sync operations.
     */
    async init() {
        this.remotes[1].url = this.getUrl() || "";
        this.remotes[1].key = this.getKey() || "";
        this.remotes[1].name = this.getNickname() || "remote";

        // Update the instance ID for the local remote
        await this.checkAndSetInstanceId(this.remotes[0]);

        // Load sync history for the local remote
        await this.loadSyncHistory(this.remotes[0]);

        // Update WebSocket managers with the new remotes
        this.cleanupWebSockets();
        await this.setupWebSockets();
    }

    /**
     * Get the last local sync time.
     *
     * @return The last local sync time in milliseconds, or undefined if not set.
     */
    async getLastLocalSyncTime(): Promise<number | undefined> {
        return this.remotes[0].lastSyncTime;
    }

    /* Sync history management */

    private async checkAndSetInstanceId(
        remote: Remote = this.remotes[0]
    ) {
        if (remote.instanceId) return;

        const instanceId = await SyncUtils.getInstanceId(remote);
        if (instanceId) {
            remote.instanceId = instanceId;
        } else {
            consoleWarn("No instance ID found, generating a new one.");
            const newInstanceId = SyncUtils.generateInstanceId();
            await SyncUtils.setInstanceId(newInstanceId, remote);
            remote.instanceId = newInstanceId;
        }
    }

    private async loadSyncHistory(remote: Remote = this.remotes[0]) {
        const syncHistory = await SyncHistory.loadSyncHistory(remote);
        remote.syncHistory = syncHistory;
    }

    /* Protyle management */

    /**
     * Insert a Protyle instance into the loadedProtyles map.
     * The key is constructed from the notebook ID and path to ensure uniqueness.
     * @param protyle The Protyle instance to insert.
     */
    insertProtyle(protyle: Protyle) {
        const path = `data/${protyle.protyle.notebookId}${protyle.protyle.path}`;

        this.loadedProtyles.set(path, protyle);
    }

    /**
     * Remove a Protyle instance from the loadedProtyles map.
     * If the removed Protyle is the active one, it sets activeProtyle to null.
     * @param protyle The Protyle instance to remove.
     */
    removeProtyle(protyle: Protyle) {
        this.loadedProtyles.delete(`data/${protyle.protyle.notebookId}${protyle.protyle.path}`);

        if (this.activeProtyle === protyle)
            this.activeProtyle = null;
    }

    /**
     * Set the currently active Protyle instance.
     * This is used to focus the correct Protyle after syncing.
     * @param protyle The Protyle instance to set as active, or null to clear it.
     */
    setActiveProtyle(protyle: Protyle | null) {
        this.activeProtyle = protyle;
    }

    /**
     * Reload currently loaded Protyles.
     * This function is used to refresh the Protyles in the editor.
     */
    async reloadProtyles() {
        for (const protyle of this.loadedProtyles.values())
            await protyle.reload(false);
    }

    /* Lock management */

    /**
     * Acquire a lock for the specified remote.
     * This is used to prevent concurrent sync operations on the same remote.
     *
     * @param remote The remote to acquire the lock for.
     */
    private async acquireLock(remote: Remote): Promise<void> {
        const lockParent = "data/.siyuan/sync";
        const resDir = await readDir(lockParent, remote.url, SyncUtils.getHeaders(remote.key), 5000);
        const lockFileInfo = resDir?.find(file => file.name === "lock");
        const now = Date.now();

        if (lockFileInfo) {
            const lockAge = now - (lockFileInfo.updated * 1000);
            const fiveMinutesInMs = 5 * 60 * 1000;

            if (lockAge > fiveMinutesInMs)
                consoleLog(`Lock file is ${Math.round(lockAge / 1000)} seconds old, ignoring stale lock for ${remote.name}`);
            else
                throw new Error(this.plugin.i18n.syncLockAlreadyExists.replace("{{remoteName}}", remote.name));
        }

        const file = new File([], "lock", { type: "text/plain", lastModified: now });
        await SyncUtils.putFile(`${lockParent}/lock`, file, remote.url, remote.key, now);
    }

    /**
     * Release the lock for the specified remote.
     * This is used to allow other sync operations to proceed.
     * @param remote The remote to release the lock for.
     */
    private async releaseLock(remote: Remote): Promise<void> {
        const path = `${SYNC_CONFIG_DIR}${LOCK_FILE}`;
        try {
            await SyncUtils.deleteFile(path, remote);
        } catch (error) {
            this.dismissMainSyncNotification();

            consoleError("Failed to release sync lock:", error);
            showMessage("Failed to release sync lock, please remove it manually.", 6000, "error");
        }
    }

    /**
     * Acquire locks for both local and remote remotes.
     * This ensures that both sides are locked before starting the sync process.
     * @param remotes The remotes to acquire locks for, defaults to the current remotes.
     */
    private async acquireAllLocks(remotes: [Remote, Remote] = this.copyRemotes(this.remotes)): Promise<void> {
        SyncUtils.checkRemotes(remotes);

        // Acquire the remote lock first
        await this.acquireLock(remotes[1]);

        // Acquire the local lock
        await this.acquireLock(remotes[0]);

        consoleLog("Acquired sync locks.");
    }

    /**
     * Release locks for both local and remote remotes.
     * This is called after the sync process is complete to ensure both sides are unlocked.
     * @param remotes The remotes to release locks for, defaults to the current remotes.
     */
    private async releaseAllLocks(remotes: [Remote, Remote] = this.copyRemotes(this.remotes)): Promise<void> {
        SyncUtils.checkRemotes(remotes);

        await Promise.allSettled(remotes.map(remote => this.releaseLock(remote)));
    }

    /**
     * Custom fetch function to handle sync operations before closing the app.
     * This is used to ensure that any pending sync operations are completed before the app exits.
     * All other fetch requests will be handled by the original fetch function.
     * @param input The request information or URL to fetch.
     * @param init Optional request initialization parameters.
     * @returns A Promise that resolves to the Response object.
     */
    async customFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        let fetchPromise: Promise<Response> | null = null;

        const blockingUrls = [
            "/api/system/exit",
        ];

        if (!blockingUrls.includes(url))
            fetchPromise = this.originalFetch(input, init);

        // Check if this request is initiated via WebSocket and should be excluded
        let requestId: string | undefined;
        if (init?.headers) {
            if (init.headers instanceof Headers)
                requestId = init.headers.get('websocket-request-id') || undefined;
            else
                requestId = (init.headers as Record<string, string>)['websocket-request-id'];
        }

        if (requestId && this.webSocketRequestIds.has(requestId)) {
            this.webSocketRequestIds.delete(requestId);
            return fetchPromise;
        }

        switch (url) {
            case "/api/system/exit":
                // Sync before closing if enabled
                if (this.plugin.settingsManager.getPref("syncOnClose")) {
                    showMessage(this.plugin.i18n.syncingBeforeClosing);
                    await this.syncHandler();
                }

                fetchPromise = this.originalFetch(input, init);
                break;

            case "/api/filetree/removeDoc":
            case "/api/filetree/removeDocs":
            case "/api/filetree/moveDocs":
            case "/api/filetree/renameDoc":
            case "/api/notebook/openNotebook":
            case "/api/notebook/closeNotebook":
            case "/api/notebook/renameNotebook":
            case "/api/notebook/removeNotebook":
            case "/api/notebook/setNotebookConf":
            case "/api/notebook/changeSortNotebook":
            case "/api/notebook/setNotebookIcon":
                if (this.plugin.settingsManager.getPref("instantSync") !== true)
                    break;

                const useWebSocket = await this.fetchAndSetRemoteAppId(this.remotes) && await this.shouldUseWebSocket();

                if (useWebSocket) {
                    const appId = this.remotes[1].appId;
                    consoleLog(`Sending ${url} request via WebSocket with app ID: ${appId}`);

                    const wsPayload = new Payload(url, {
                        requestData: init.body,
                        appId: appId
                    });
                    await this.transmitWebSocketMessage(wsPayload.toString(), this.inputWebSocketManagers[1]);
                } else {
                    consoleLog(`Sending ${url} request via regular fetch.`);
                    await requestWithHeaders(
                        `${this.remotes[1].url}${url}`,
                        JSON.parse(init.body as string),
                        SyncUtils.getHeaders(this.remotes[1].key)
                    );
                }

                break;

            case "/api/filetree/createDoc":
                if (this.plugin.settingsManager.getPref("instantSync") !== true)
                    break;

                const createDocPayload = JSON.parse(init.body as string) as CreateDocRequest;

                const fileName = `${createDocPayload.path.replace(/.*\//, "")}`;
                const fullPath = `data/${createDocPayload.notebook}${createDocPayload.path}`;
                const parent = fullPath.replace(fileName, "");

                consoleLog(`Creating new doc on remote server: ${fullPath}`);
                await fetchPromise;

                const [fileBlob, resDir] = await Promise.all([
                    getFileBlob(fullPath),
                    readDir(parent)
                ]);

                const fileRes = resDir.find(file => file.name === fileName);
                const timestamp = fileRes ? fileRes.updated * 1000 : Date.now();
                const file = new File([fileBlob], fileName, { lastModified: timestamp });

                await SyncUtils.putFile(
                    fullPath, file, this.remotes[1].url, this.remotes[1].key, timestamp
                );
                await reloadFiletree(this.remotes[1].url, SyncUtils.getHeaders(this.remotes[1].key));
                break;

            case "/api/notebook/createNotebook":
                if (this.plugin.settingsManager.getPref("instantSync") !== true)
                    break;

                const apiResponse = await (await fetchPromise).clone().json();
                const notebookId = apiResponse.data.notebook.id;

                consoleLog(`Creating new notebook on remote server: ${notebookId}`);

                const remotesWithFile: [Remote, Remote] = [
                    this.remotes[0].withFile(new StorageItem(`data/${notebookId}`)),
                    this.remotes[1].withFile(new StorageItem(`data/${notebookId}`))
                ];

                await this.syncDirectory(
                    remotesWithFile,
                    [],
                    {
                        onlyIfMissing: true,
                        avoidDeletions: true
                    }
                );
                await reloadFiletree(this.remotes[1].url, SyncUtils.getHeaders(this.remotes[1].key));
                break;

            case "/api/transactions":
            case "/api/attr/setBlockAttrs":
                const protyle = this.activeProtyle;
                await this.handleTransactionsCall(protyle.protyle);
        }

        return fetchPromise || this.originalFetch(input, init);
    }

    /**
     * Handle transactions calls to sync files.
     *
     * @param protyle The Protyle instance that has been updated.
     */
    async handleTransactionsCall(
        protyle: IProtyle
    ) {
        if (this.plugin.settingsManager.getPref("instantSync") !== true) return;

        const debounceTime = this.plugin.settingsManager.getPref("transactionsDebounceTime") || 5000;

        const key = `data/${protyle.notebookId}${protyle.path}`;

        const timeout = this.pendingFileChanges.get(key);
        if (timeout)
            clearTimeout(timeout);

        this.pendingFileChanges.set(key, window.setTimeout(() => {
            this.handleContentChange(protyle);
            this.pendingFileChanges.delete(key);
        }, debounceTime));
    }

    /**
     * Handle content changes in the Protyle.
     * This function is called when the content of a Protyle changes.
     * It tracks locally updated files and sets the active Protyle if necessary.
     *
     * @param protyle The Protyle instance that has changed.
     */
    private async handleContentChange(protyle: IProtyle) {
        if (!protyle) return;

        const path = `data/${protyle.notebookId}${protyle.path}`;

        await this.syncFile(
            path,
            { avoidDeletions: true }
        );

        this.pendingFileChanges.delete(path);
        await this.sendReloadProtylesMessage([path]);
    }

    /**
     * Get the list of notebooks from the specified remote.
     * @param url The URL of the remote.
     * @param key The access key for the remote.
     * @returns A Promise that resolves to an array of Notebook objects.
     */
    private async getNotebooks(url: string = "", key: string = null): Promise<Notebook[]> {
        let notebooks = await lsNotebooks(url, SyncUtils.getHeaders(key))

        return notebooks.notebooks;
    }

    /* WebSocket management */

    /**
     * Function to choose whether to use WebSocket or not.
     * This function checks the plugin settings to determine if WebSocket should be used for synchronization.
     * It also checks if the other remote's WebSocket is being listened to.
     */
    private async shouldUseWebSocket(): Promise<boolean> {
        const useWebSocket = this.plugin.settingsManager.getPref("useExperimentalWebSocket");
        const isRemoteListening = await this.inputWebSocketManagers[1]?.isListening();

        return useWebSocket && isRemoteListening;
    }

    /**
     * Set up WebSocket connections for input and output.
     *
     * This function initializes WebSocket connections for both input and output channels.
     * It creates two WebSocketManager instances for each channel, one for the local remote and
     * one for the remote remote.
     * We set up callbacks for handling input messages on the local input WebSocket and
     * output messages on the remote output WebSocket.
     */
    async setupWebSockets() {
        if (!this.plugin.settingsManager.getPref("useExperimentalWebSocket"))
            return;

        const remotes = this.copyRemotes(this.remotes);

        this.inputWebSocketManagers[0] = new WebSocketManager("better-sync-input", remotes[0]);
        this.outputWebSocketManagers[0] = new WebSocketManager("better-sync-output", remotes[0]);
        this.inputWebSocketManagers[1] = new WebSocketManager("better-sync-input", remotes[1]);
        this.outputWebSocketManagers[1] = new WebSocketManager("better-sync-output", remotes[1]);

        await Promise.allSettled([
            this.connectWebSocket(
                this.inputWebSocketManagers[0],
                this.webSocketInputCallback.bind(this),
                this.webSocketCloseRetryCallback.bind(this),
            ),
            this.connectWebSocket(
                this.outputWebSocketManagers[0],
                null,
                this.webSocketCloseRetryCallback.bind(this)
            )
        ]);
    }

    /**
     * Cleanup WebSocket connections.
     */
    cleanupWebSockets() {
        const webSocketManagers = [...this.inputWebSocketManagers, ...this.outputWebSocketManagers];

        for (const manager of webSocketManagers) {
            if (manager) manager.closeWebSocket();
        }
    }

    /**
     * Choose the remote's appId to use for WebSocket communication.
     *
     * This function checks if the remote appId has been received.
     */
    private chooseRemoteAppId(): string {
        const firstAppId = Array.from(this.receivedAppIds).reverse().pop();
        return firstAppId || "unknown-app-id";
    }

    /**
     * Set remote appId
     *
     * @param appId The appId to set for the remote.
     * @param remote The remote information to set the appId for, defaults to the second remote.
     */
    private setRemoteAppId(appId: string, remote: Remote = this.remotes[1]) {
        remote.appId = appId;
    }

    /**
     * Checks if the remote appId is set.
     *
     * @param remote The remote information to check, defaults to the second remote.
     * @returns True if the remote appId is set and not "unknown-app-id", false otherwise.
     */
    private isRemoteAppIdSet(remote: Remote = this.remotes[1]): boolean {
        return !!remote.appId && remote.appId !== "unknown-app-id";
    }

    /**
     * Fetch and set the remote appId.
     *
     * @param remotes The list of remote connections.
     * @returns A Promise that resolves to a boolean indicating whether the appId was found successfully.
     */
    public async fetchAndSetRemoteAppId(remotes: Remote[] = this.remotes): Promise<boolean> {
        if (!(await this.shouldUseWebSocket())) return false;

        await Promise.all([
            this.connectRemoteOutputWebSocket(),
            this.transmitWebSocketMessage(
                new Payload("get-app-id", {}).toString(),
                this.inputWebSocketManagers[1]
            )
        ]);

        for (let i = 0; i < 500; i++) {
            if (this.receivedAppIds.size > 0) {
                if (this.receivedAppIds.has(remotes[1].appId)) {
                    consoleLog(`Remote app ID already set: ${remotes[1].appId}`);
                    return true;
                }

                this.setRemoteAppId(this.chooseRemoteAppId(), remotes[1]);
                consoleLog(`Remote app ID set to: ${remotes[1].appId}`);
                this.receivedAppIds.clear();
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 5));
        }

        consoleWarn("Timeout waiting for remote app ID.");
        return false;
    }

    /**
     * Handle incoming WebSocket input messages.
     * This function is called whenever a message is received from the input WebSocket.
     *
     * @param data The data received from the WebSocket.
     */
    private async webSocketInputCallback(data: any) {
        const payload = Payload.fromString(data);
        if (!payload) {
            consoleWarn("Received invalid WebSocket input message:", data);
            return;
        }

        switch (true) {
            case payload.type === "reload-protyles":
                consoleLog("Reloading all Protyles due to WebSocket message.");
                await this.reloadProtyles();
                break;

            case payload.type === "reload-protyles-if-open": {
                const { paths } = payload.data;

                for (const path of paths) {
                    const protyle = Array.from(this.loadedProtyles.values())
                        .find(p => `data/${p.protyle.notebookId}${p.protyle.path}` === path);
                    if (protyle) {
                        consoleLog(`Reloading Protyle for path: ${path}`);
                        protyle.reload(this.activeProtyle === protyle);
                    } else {
                        consoleWarn(`No Protyle found for path: ${path}`);
                    }
                }
                break;
            }

            case payload.type === "get-dir-files": {
                const { path, excludedItems, requestId, appId } = payload.data;

                if (appId && appId !== this.plugin.app.appId)
                    return consoleWarn(`Ignoring get-dir-files request for app ID ${appId}, current app ID is ${this.plugin.app.appId}`);

                consoleLog(`Received request for directory files: ${path} with app ID ${appId}`);
                const storageItem = await SyncUtils.getDirFilesRecursively(path, Remote.default(), true, excludedItems);
                const responsePayload = new Payload("dir-files-response", { item: storageItem, requestId });
                await this.transmitWebSocketMessage(responsePayload.toString(), this.outputWebSocketManagers[0]);
                break;
            }

            case payload.type.startsWith("/api/"): {
                consoleLog(`Processing api request via WebSocket: ${payload.type}`);

                const { appId, requestData } = payload.data;

                if (appId && appId !== this.plugin.app.appId) {
                    consoleWarn(`Ignoring request for app ID ${appId}, current app ID is ${this.plugin.app.appId}`);
                    return;
                }

                const requestId = crypto.randomUUID();
                this.webSocketRequestIds.add(requestId);

                await requestWithHeaders(
                    payload.type,
                    JSON.parse(requestData),
                    { "websocket-request-id": requestId }
                );

                break;
            }

            case payload.type === "get-app-id": {
                const appId = this.plugin.app.appId || "unknown-app-id";
                const responsePayload = new Payload("app-id-response", { appId });
                await this.transmitWebSocketMessage(responsePayload.toString(), this.outputWebSocketManagers[0]);
                break;
            }

            default:
                consoleWarn("Unknown WebSocket message:", payload);
                break;
        }
    }

    /**
     * WebSocket close callback to retry connection.
     *
     * @param websocketManager The WebSocket manager that was closed.
     */
    private async webSocketCloseRetryCallback(websocketManager: WebSocketManager) {
        consoleWarn(`WebSocket connection closed, attempting to reconnect...`);

        const retry = async () => {
            try {
                await this.connectWebSocket(
                    websocketManager,
                    undefined,
                    this.webSocketCloseRetryCallback.bind(this)
                );

                if (!websocketManager.isConnected())
                    setTimeout(retry, 5000);
            } catch (error) {
                consoleError(`Failed to reconnect WebSocket, retrying in 5 seconds...`, error);
                setTimeout(retry, 5000);
            }
        };

        retry();
    }

    /**
     * Handle incoming WebSocket output messages.
     * This function is called whenever a message is received from the output WebSocket.
     * This is used to handle responses from the remote server.
     *
     * @param data The data received from the WebSocket.
     */
    private async webSocketOutputCallback(data: any) {
        const payload = Payload.fromString(data);
        if (!payload) {
            consoleWarn("Received invalid WebSocket output message:", data);
            return;
        }

        switch (payload.type) {
            case "dir-files-response": {
                const { item, requestId } = payload.data;
                if (this.pendingDirRequests.has(requestId)) {
                    const storageItem = StorageItem.fromObject(item);
                    this.pendingDirRequests.get(requestId)(storageItem);
                    this.pendingDirRequests.delete(requestId);
                }
                break;
            }

            case "app-id-response": {
                const { appId } = payload.data;
                this.receivedAppIds.add(appId);
                consoleLog(`Received app ID from remote: ${appId}`);
                break;
            }

            default:
                consoleWarn("Unknown WebSocket message:", payload);
                break;
        }
    }

    /**
     * Transmit a message through the remote WebSocket connection.
     * This function is used to send messages to the remote server via WebSocket.
     *
     * @param message The message to transmit.
     * @param webSocketManager The WebSocket manager to use for sending the message.
     */
    async transmitWebSocketMessage(
        message: string,
        webSocketManager: WebSocketManager
    ) {
        if (!webSocketManager) return;

        await webSocketManager.sendMessage(message);
    }

    /**
     * Broadcast a message to all connected clients via the remote WebSocket.
     * This function is used to send messages to all clients connected to the remote server.
     *
     * @param data The data to broadcast, which can include strings and binaries.
     * @param webSocketManager The WebSocket manager to use for broadcasting the content.
     */
    async broadcastContent(
        data: { strings?: string[], binaries?: { file: Blob, filename: string }[] },
        webSocketManager: WebSocketManager
    ) {
        if (!webSocketManager) return;

        await webSocketManager.broadcastContent(data);
    }

    /**
     * Connect to the specified WebSocket.
     *
     * @param webSocketManager The WebSocket manager to connect.
     * @param onmessageCallback The callback function to handle incoming messages.
     * @param oncloseCallback The callback function to handle WebSocket closure.
     * @param onerrorCallback The callback function to handle WebSocket errors.
     */
    async connectWebSocket(
        webSocketManager: WebSocketManager,
        onmessageCallback?: (message: any) => void,
        oncloseCallback?: (wsManager: WebSocketManager) => void,
        onerrorCallback?: (error: any) => void
    ) {
        if (!webSocketManager) {
            consoleWarn("WebSocket manager is not initialized.");
            return;
        }

        if (webSocketManager.isConnected()) {
            consoleLog("WebSocket is already connected.");
            return;
        }

        await webSocketManager.initWebSocket();

        if (oncloseCallback)
            webSocketManager.connectOnClose(oncloseCallback);

        if (onmessageCallback)
            webSocketManager.connectOnMessage(onmessageCallback);

        if (onerrorCallback)
            webSocketManager.connectOnError(onerrorCallback);
    }

    /**
     * Connect to the remote output WebSocket.
     */
    async connectRemoteOutputWebSocket() {
        if (this.outputWebSocketManagers[1] && !this.outputWebSocketManagers[1].isConnected()) {
            await this.outputWebSocketManagers[1].initWebSocket();

            this.outputWebSocketManagers[1].connectOnMessage((message) => {
                this.webSocketOutputCallback(message);
            });
        } else if (this.outputWebSocketManagers[1]) {
            consoleLog("Remote output WebSocket is already connected.");
        } else {
            consoleWarn("Remote output WebSocket manager is not initialized.");
        }
    }

    /**
     * Disconnect the remote output WebSocket.
     */
    disconnectRemoteOutputWebSocket() {
        if (this.outputWebSocketManagers[1])
            this.outputWebSocketManagers[1].closeWebSocket();
        else
            consoleWarn("Remote output WebSocket manager is not initialized.");
    }

    /**
     * Send reload protyles message to the remote output WebSocket.
     *
     * @param paths An array of file paths to reload in the remote Protyles.
     *              If undefined, reload all Protyles.
     */
    async sendReloadProtylesMessage(paths: string[] | undefined = undefined) {
        if (!(await this.shouldUseWebSocket())) {
            consoleWarn("WebSocket is not enabled or remote is not listening.");
            return;
        }

        let payload: Payload;

        if (paths === undefined)
            payload = new Payload("reload-protyles", {});
        else
            payload = new Payload("reload-protyles-if-open", { paths });

        if (this.inputWebSocketManagers[1])
            await this.transmitWebSocketMessage(payload.toString(), this.inputWebSocketManagers[1]);
        else
            consoleWarn("Remote input WebSocket manager is not initialized.");
    }

    /**
     * Clean up old WebSocket request IDs to prevent memory leaks.
     * This should be called periodically to remove request IDs that might not have been processed.
     */
    private cleanupWebSocketRequestIds(): void {
        // For now, just clear all IDs every time cleanup is called
        // In a more sophisticated implementation, you could track timestamps
        this.webSocketRequestIds.clear();
    }

    /* Sync logic */

    /**
     * Main sync handler function.
     * This is called to initiate the sync process with the specified remotes.
     * It acquires locks and calls the syncWithRemote function to handle synchronization,
     * and handles any exceptions that may occur during the process.
     *
     * @param persistentMessage Whether to show a persistent message during sync, defaults to true.
     * @param remotes The remotes to sync with, defaults to the current remotes.
     */
    async syncHandler(
        persistentMessage: boolean = true,
        remotes: [Remote, Remote] = this.copyRemotes(this.remotes)
    ) {
        this.setSyncStatus(SyncStatus.InProgress);
        const startTime = Date.now();
        let savedError: Error | null = null;
        let promise: Promise<void> | null = null;
        let locked = false;
        try {
            SyncUtils.checkRemotes(remotes);

            if (persistentMessage)
                showMessage(this.plugin.i18n.syncingWithRemote.replace("{{remoteName}}", remotes[1].name), 0, "info", "mainSyncNotification");

            consoleLog(`Syncing with remote server ${remotes[1].name}...`);

            if (this.shouldUseWebSocket()) promise = this.connectRemoteOutputWebSocket();

            await this.acquireAllLocks(remotes);
            locked = true;

            this.pendingFileChanges.forEach((timeoutId, filePath) => {
                clearTimeout(timeoutId);
                this.pendingFileChanges.set(filePath, 0);
            });

            await this.syncWithRemote(remotes, promise);
        } catch (error) {
            savedError = error;
            this.setSyncStatus(SyncStatus.Failed);
        } finally {
            if (locked) await this.releaseAllLocks(remotes);
            consoleLog("Released all sync locks.");

            const duration = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "0.0";

            // Remove the main sync message
            if (persistentMessage)
                this.dismissMainSyncNotification();

            if (savedError !== null) {
                consoleError("Error during sync:", savedError);

                showMessage(
                    this.plugin.i18n.syncWithRemoteFailed
                        .replace("{{remoteName}}", remotes[1].name)
                        .replace("{{error}}", savedError.message)
                        .replace("{{duration}}", duration),
                    6000,
                    "error"
                );
            } else if (this.conflictDetected) {
                if (persistentMessage)
                    showMessage(this.plugin.i18n.syncCompletedWithConflicts.replace("{{duration}}", duration), 6000);
                consoleWarn(`Sync completed with conflicts in ${duration} seconds.`);
                this.setSyncStatus(SyncStatus.DoneWithConflict);
            } else {
                if (persistentMessage)
                    showMessage(this.plugin.i18n.syncCompletedSuccessfully.replace("{{duration}}", duration), 6000);
                consoleLog(`Sync completed successfully in ${duration} seconds!`);
                this.setSyncStatus(SyncStatus.Done);
            }

            await SyncUtils.writeSyncLog(
                SessionLog.getLogsAsString(),
                remotes[0]
            );

            // Clear session log after writing
            SessionLog.clear();

            this.conflictDetected = false;
            this.locallyUpdatedFiles.clear();
            this.remotelyUpdatedFiles.clear();
            this.cleanupWebSocketRequestIds();
            this.disconnectRemoteOutputWebSocket();
        }
    }

    /**
     * Synchronize data with a remote server.
     * This function handles the main synchronization logic, including fetching notebooks,
     * creating data snapshots if enabled, and syncing directories and files.
     * @param remotes An array of exactly two Remote objects containing remote server information.
     */
    private async syncWithRemote(remotes: [Remote, Remote] = this.copyRemotes(this.remotes), promise: Promise<void> | null = null) {
        SyncUtils.checkRemotes(remotes);

        const isRemoteAppIdSet = this.isRemoteAppIdSet(remotes[1]);
        const useWebSocket: boolean = await this.shouldUseWebSocket() && isRemoteAppIdSet;
        let disconnectWebSocket = false;

        if (useWebSocket && !this.outputWebSocketManagers[1].isConnected()) {
            this.connectRemoteOutputWebSocket();
            consoleLog("Connected to remote output WebSocket for directory sync.");
            disconnectWebSocket = true;
        }

        // Create data snapshots if enabled
        if (this.plugin.settingsManager.getPref("createDataSnapshots")) {
            await this.createDataSnapshots(remotes);
        }

        await Promise.all([
            this.checkAndSetInstanceId(remotes[0]),
            this.checkAndSetInstanceId(remotes[1])
        ]);

        // Load sync history for both remotes
        await Promise.all([
            SyncHistory.loadSyncHistory(remotes[0]).then(syncHistory => {
                remotes[0].syncHistory = syncHistory;
            }),
            SyncHistory.loadSyncHistory(remotes[1]).then(syncHistory => {
                remotes[1].syncHistory = syncHistory;
            })
        ]);

        consoleLog(`Last sync times: ${remotes[0].lastSyncTime} (${remotes[0].name}), ${remotes[1].lastSyncTime} (${remotes[1].name})`);
        consoleLog(`Sync history loaded for ${remotes[0].name}:`, Array.from(remotes[0].syncHistory?.entries() || []));
        consoleLog(`Sync history loaded for ${remotes[1].name}:`, Array.from(remotes[1].syncHistory?.entries() || []));

        const [notebooksOne, notebooksTwo] = await Promise.all([
            this.getNotebooks(remotes[0].url, remotes[0].key),
            this.getNotebooks(remotes[1].url, remotes[1].key)
        ]);

        // Combine notebooks from both remotes, automatically deduplicating by ID
        const notebooks = Array.from(
            new Map([...notebooksOne, ...notebooksTwo].map(notebook => [notebook.id, notebook])).values()
        );

        const trackConflicts = this.plugin.settingsManager.getPref("trackConflicts");

        if (promise) await promise;

        await this.fetchAndSetRemoteAppId(remotes);

        // Get sync targets using the external function
        const syncTargets = getSyncTargets({ notebooks, trackConflicts });

        // Execute all sync operations
        const promises = syncTargets.map(target => {
            const remotesWithFile: [Remote, Remote] = [
                remotes[0].withFile(new StorageItem(target.path)),
                remotes[1].withFile(new StorageItem(target.path))
            ];

            return this.syncDirectory(
                remotesWithFile,
                target.excludedItems || [],
                target.options
            );
        });

        // Add the petals list sync
        promises.push(this.syncPetalsListIfEmpty(remotes));

        // Execute all sync operations concurrently
        consoleLog(`Starting sync operations for ${notebooks.length} notebooks and ${syncTargets.length - notebooks.length * 2} other directories...`);

        await Promise.all(promises);

        // Handle missing assets
        const remotesWithFile: [Remote, Remote] = [
            remotes[0].withFile(new StorageItem("data/assets")),
            remotes[1].withFile(new StorageItem("data/assets"))
        ];

        await this.syncDirectory(
            remotesWithFile,
            await this.getUnusedAssetsNames(remotes),
            { avoidDeletions: true }
        );

        reloadFiletree(remotes[0].url, SyncUtils.getHeaders(remotes[0].key));
        reloadFiletree(remotes[1].url, SyncUtils.getHeaders(remotes[1].key));

        const localAvFiles = Array.from(this.locallyUpdatedFiles).filter(
            path => path.startsWith("data/storage/av/") && path.endsWith(".json")
        );

        if (localAvFiles.length > 0) {
            consoleLog(`Locally updated AV files detected: ${localAvFiles.join(", ")}`);
            await this.reloadProtyles();
        }

        for (const [path, protyle] of this.loadedProtyles) {
            if (localAvFiles.length > 0) break;

            if (this.locallyUpdatedFiles.has(path)) {
                consoleLog(`Locally updated file ${path} is currently loaded in protyle ${protyle.protyle.id}`);

                protyle.reload(this.activeProtyle === protyle);
            }
        }

        const remoteAvFiles = Array.from(this.remotelyUpdatedFiles).filter(
            path => path.startsWith("data/storage/av/") && path.endsWith(".json")
        );

        if (remoteAvFiles.length > 0) {
            consoleLog(`Remotely updated AV files detected: ${remoteAvFiles.join(", ")}`);
            await this.sendReloadProtylesMessage();
        } else {
            this.sendReloadProtylesMessage(Array.from(this.remotelyUpdatedFiles));
        }

        const timestamp = Math.floor(Date.now() / 1000);

        this.remotes[0].syncHistory.set(remotes[0].instanceId, timestamp);
        this.remotes[0].syncHistory.set(remotes[1].instanceId, timestamp);
        this.remotes[1].syncHistory.set(remotes[1].instanceId, timestamp);
        this.remotes[1].syncHistory.set(remotes[0].instanceId, timestamp);

        await SyncHistory.updateSyncHistories(this.remotes);

        if (disconnectWebSocket) this.disconnectRemoteOutputWebSocket();

        consoleLog(`Sync completed. Updated sync history for both remotes.`);
    }

    private getRemoteDirFilesViaWebSocket(path: string, excludedItems: string[], appId: string): Promise<StorageItem> {
        return new Promise(async (resolve, reject) => {
            const requestId = Math.random().toString(36).substring(2, 15);
            this.pendingDirRequests.set(requestId, resolve);

            // Timeout to prevent waiting forever
            setTimeout(() => {
                if (this.pendingDirRequests.has(requestId)) {
                    this.pendingDirRequests.delete(requestId);
                    reject(new Error(`Request for directory files timed out: ${path}`));
                }
            }, 5000);

            const payload = new Payload("get-dir-files", { path, excludedItems, requestId, appId });
            await this.transmitWebSocketMessage(payload.toString(), this.inputWebSocketManagers[1]);
        });
    }

    /**
     * Scan a directory on the local and remote devices
     * @param items The StorageItem(s) representing the directory to synchronize.
     * @param remotes An array of exactly two Remote objects containing remote server information.
     * @param excludedItems An array of item names to exclude from synchronization.
     * @param useFileNames Whether to use file names as keys instead of file paths.
     * @returns A map of StorageItem instances where the keys are file names or file paths.
     */
    private async scanDirectory(
        remotes: [Remote, Remote],
        excludedItems: string[] = []
    ): Promise<[Remote, Remote] | null> {
        remotes = this.copyRemotes(remotes);
        const path = remotes[0].filePath || remotes[1].filePath;
        if (!path) {
            consoleWarn("No valid path provided for directory sync.");
            return null;
        }

        consoleLog(`Scanning directory ${path}. Excluding items: ${excludedItems.join(", ")}`);

        const useWebSocket = await this.shouldUseWebSocket() && this.isRemoteAppIdSet(remotes[1]);

        // Fetch directory files only when not already provided
        if ((!remotes[0].file?.files || !remotes[1].file?.files) && (!remotes[0].file?.item || !remotes[1].file?.item)) {
            const filesOnePromise = SyncUtils.getDirFilesRecursively(path, remotes[0], true, excludedItems);

            const filesTwoPromise = useWebSocket
                ? this.getRemoteDirFilesViaWebSocket(path, excludedItems, remotes[1].appId)
                : SyncUtils.getDirFilesRecursively(path, remotes[1], true, excludedItems);

            [remotes[0].file, remotes[1].file] = await Promise.all([
                filesOnePromise,
                filesTwoPromise
            ]);
        }

        if ((!remotes[0].file && !remotes[1].file) || (!remotes[0].file?.item && !remotes[1].file?.item)) {
            consoleLog(`Directory ${path} does not exist on either remote. Skipping sync.`);
            return null;
        }

        if ((remotes[0].file?.isDir !== remotes[1].file?.isDir)) {
            consoleLog(`Directory ${path} exists as a file on one remote and a directory on the other. Skipping sync.`);
            return null;
        }

        return remotes;
    }

    /**
     * Synchronize a directory between local and remote devices, in both directions.
     * @param remotes An array of exactly two Remote objects containing remote server information.
     * @param excludedItems An array of item names to exclude from synchronization.
     * @param options Synchronization options including:
     * - deleteFoldersOnly: If true, only delete folders and not single files.
     * - onlyIfMissing: If true, only synchronize files that are missing in one of the remotes.
     * - avoidDeletions: If true, do not delete files in any remote.
     * - trackConflicts: If true, track conflicts during synchronization.
     */
    private async syncDirectory(
        remotes: [Remote, Remote],
        excludedItems: string[] = [],
        options?: {
            deleteFoldersOnly?: boolean,
            onlyIfMissing?: boolean,
            useFileNames?: boolean,
            avoidDeletions?: boolean,
            trackConflicts?: boolean,
            trackUpdatedFiles?: boolean
        }
    ) {
        const path = remotes[0].filePath || remotes[1].filePath;
        if (!path) {
            consoleWarn("No valid path provided for directory sync.");
            return;
        }

        remotes = await this.scanDirectory(remotes, excludedItems);
        if (!remotes) {
            consoleWarn(`Failed to scan directory ${path}. Skipping sync.`);
            return;
        }

        const syncPromises: Promise<any>[] = [];
        const filesMapPair = StorageItem.getFilesMapPair(remotes[0].file, remotes[1].file, options?.useFileNames);
        for (const [_, [file0, file1]] of filesMapPair) {
            const fileItem = file0 || file1;
            if (!fileItem) continue;

            syncPromises.push(this.syncFile(
                fileItem.path,
                options,
                [
                    remotes[0].withFile(file0),
                    remotes[1].withFile(file1)
                ]
            ));
        }

        await Promise.allSettled(syncPromises);
    }

    /**
     * Synchronize a file between local and remote devices.
     * @param filePath The path to the file to synchronize.
     * @param options Synchronization options including:
     * - deleteFoldersOnly: If true, only delete folders and not single files.
     * - onlyIfMissing: If true, only synchronize files that are missing in one of the remotes.
     * - avoidDeletions: If true, do not delete files in any remote.
     * - trackConflicts: If true, track conflicts during synchronization.
     * @param remotes An array of exactly two RemoteFileInfo objects containing remote server information.
     */
    async syncFile(
        filePath: string,
        options?: {
            deleteFoldersOnly?: boolean,
            onlyIfMissing?: boolean,
            avoidDeletions?: boolean,
            trackConflicts?: boolean,
            trackUpdatedFiles?: boolean
        },
        remotes: [Remote, Remote] = this.remotes,
    ): Promise<SyncFileResult> {
        remotes = this.copyRemotes(remotes);

        await Promise.all(remotes.map(async (remote) => {
            const parentPath = filePath.replace(/\/[^/]+$/, "");
            const fileName = filePath.replace(/^.*\//, "");

            if (!remote.file || !remote.file.item) {
                consoleLog(`File info for ${filePath} missing from ${remote.name}, fetching...`);
                const dir = await readDir(parentPath, remote.url, SyncUtils.getHeaders(remote.key));
                const file = dir?.find(it => it.name === fileName);
                if (file) remote.file = new StorageItem(filePath, parentPath, file);
            }
        }));

        const fileRes = remotes[0].file?.item || remotes[1].file?.item;

        if (!fileRes) {
            consoleLog(`File ${filePath} not found in either remote.`);
            return SyncFileResult.NotFound;
        }

        const updated: [number, number] = [
            remotes[0].file?.timestamp || 0,
            remotes[1].file?.timestamp || 0
        ];

        // Conflict detection
        let trackConflicts = options?.trackConflicts ?? false;
        if (this.pendingFileChanges.has(filePath) && trackConflicts) {
            consoleLog(`Conflicts tracking skipped for ${filePath} as it has pending changes.`);
            trackConflicts = false;
            this.pendingFileChanges.delete(filePath);
        }

        if (!options?.onlyIfMissing && !fileRes.isDir && trackConflicts) {
            const conflictDetected = await ConflictHandler.handleConflictDetection(
                filePath,
                remotes,
                this.plugin.i18n
            );

            if (conflictDetected) this.conflictDetected = true;
        }

        // Multiply by 1000 because `putFile` makes the conversion automatically
        const timestamp: number = Math.max(updated[0], updated[1]) * 1000;

        if (remotes[0].file?.item && remotes[1].file?.item && (updated[0] === updated[1] || options?.onlyIfMissing) &&
            remotes[0].file?.path === remotes[1].file?.path) {
            return SyncFileResult.Skipped;
        }

        let inputIndex = updated[0] > updated[1] ? 0 : 1;
        let outputIndex = updated[0] > updated[1] ? 1 : 0;

        const pathMismatch = remotes[0]?.file?.item && remotes[1]?.file?.item && remotes[0].file?.path !== remotes[1].file?.path;

        if (pathMismatch) {
            if (remotes[0].file?.timestamp === remotes[1].file?.timestamp) {
                consoleLog(`File ${filePath} has different paths but the same timestamp on the two remotes, looking at the parent directory...`);

                const result = await SyncUtils.compareParentDirectoryTimestamps(remotes);

                if (!result) return SyncFileResult.Skipped;

                inputIndex = result.inputIndex;
                outputIndex = result.outputIndex;
            } else {
                consoleLog(`File ${filePath} has different paths and different timestamps on the two remotes, deleting the older file...`);
            }
        }

        if (!fileRes.isDir)
            consoleLog(`Syncing file from ${remotes[inputIndex].name} to ${remotes[outputIndex].name}: ${fileRes.name} (${filePath}), timestamps: ${updated[0]} vs ${updated[1]}`);

        // Handle deletions
        if (!remotes[0].file?.item || !remotes[1].file?.item || pathMismatch) {
            const missingIndex = outputIndex;
            const existingIndex = inputIndex;

            const commonSync = SyncHistory.getLastSyncWithRemote(
                remotes[existingIndex],
                remotes[missingIndex].instanceId
            );

            const existingLastSync = SyncHistory.getMostRecentSyncTime(
                remotes[existingIndex]
            );

            /**
             * Determine if the file should be deleted based on sync history.
             * The file should be deleted if all the following conditions are met:
             * - The last sync time with the other remote is greater than 0 (they have synced before).
             * - The last sync time with the other remote is greater than the file's last updated timestamp.
             * - The last sync time with the other remote is greater than the existing remote's last sync time.
             * Or if there is a directory/file mismatch or file path mismatch.
             * This ensures that we only delete files that were present during the last sync and have not been updated since.
             */
            const dirMismatch = remotes[0].file?.item && remotes[1].file?.item && remotes[0].file?.isDir != remotes[1].file?.isDir;
            const shouldDelete: boolean = (commonSync > 0) &&
                (commonSync > updated[existingIndex]) &&
                (commonSync >= existingLastSync) || dirMismatch || pathMismatch;

            consoleLog(`Last sync with other: ${commonSync}, existing last sync: ${existingLastSync}, file updated: ${updated[existingIndex]}, dir mismatch: ${dirMismatch}, path mismatch: ${pathMismatch}. Should delete: ${shouldDelete}`);

            // If the file is a path mismatch, delete the older file that we're marking as least recently updated
            const target = pathMismatch ? remotes[outputIndex] : remotes[inputIndex];

            if (shouldDelete) {
                if ((fileRes.isDir || !options?.deleteFoldersOnly) && !options?.avoidDeletions) {
                    await SyncUtils.deleteFile(target.file?.path, target);

                    // Continue syncing the file if it's a directory mismatch or path mismatch
                    if (!dirMismatch && !pathMismatch)
                        return fileRes.isDir ? SyncFileResult.DirectoryDeleted : SyncFileResult.Deleted;
                }
            } else {
                consoleLog(`File ${filePath} is missing on ${remotes[missingIndex].name} but will be synced (timestamp check passed)`);
            }
        }

        // Avoid writing directories
        if (fileRes.isDir) return SyncFileResult.Skipped;

        const syFile = await getFileBlob(filePath, remotes[inputIndex].url, SyncUtils.getHeaders(remotes[inputIndex].key));
        if (!syFile) {
            consoleLog(`File ${filePath} not found in source: ${remotes[inputIndex].name}`);
            return SyncFileResult.NotFound;
        }

        const file = new File([syFile], fileRes.name, { lastModified: timestamp });
        await SyncUtils.putFile(filePath, file, remotes[outputIndex].url, remotes[outputIndex].key, timestamp);

        if (options?.trackUpdatedFiles) {
            const updatedFiles = inputIndex === 0 ? this.remotelyUpdatedFiles : this.locallyUpdatedFiles;
            updatedFiles.add(filePath);
        }

        return SyncFileResult.Success;
    }

    /**
     * Synchronize the petals list between local and remote devices.
     * This function checks if the petals list is empty in either remote and syncs it if necessary.
     * @param remotes An array of exactly two Remote objects containing remote server information.
     */
    private async syncPetalsListIfEmpty(remotes: [Remote, Remote] = this.copyRemotes(this.remotes)) {
        SyncUtils.checkRemotes(remotes);

        const petalsList = await Promise.all([
            getFileBlob("/data/storage/petal/petals.json", remotes[0].url, SyncUtils.getHeaders(remotes[0].key)),
            getFileBlob("/data/storage/petal/petals.json", remotes[1].url, SyncUtils.getHeaders(remotes[1].key))
        ]);

        for (let index = 0; index < petalsList.length; index++) {
            if (!petalsList[index] || await petalsList[index].text() === "[]") {
                const otherIndex = index === 0 ? 1 : 0;
                consoleLog(`Syncing petals list from ${remotes[otherIndex].name} to ${remotes[index].name}`);
                let file = new File([petalsList[otherIndex]], "petals.json");
                SyncUtils.putFile("/data/storage/petal/petals.json", file, remotes[index].url, remotes[index].key);
                break;
            }
        }
    }

    /**
     * Get the names of unused assets from both local and remote devices.
     * This function fetches the list of unused assets from both remotes and combines them.
     * @param remotes An array of exactly two Remote objects containing remote server information.
     * @returns A Promise that resolves to an array of asset names that are not used in either remote.
     */
    private async getUnusedAssetsNames(remotes: [Remote, Remote] = this.copyRemotes(this.remotes)): Promise<string[]> {
        SyncUtils.checkRemotes(remotes);

        const [unusedAssetsOne, unusedAssetsTwo] = await Promise.all([
            getUnusedAssets(remotes[0].url, SyncUtils.getHeaders(remotes[0].key)),
            getUnusedAssets(remotes[1].url, SyncUtils.getHeaders(remotes[1].key))
        ]);

        // Get the assets filenames by replacing anything before the last slash
        const unusedAssetsNames = [...unusedAssetsOne.unusedAssets, ...unusedAssetsTwo.unusedAssets].map(asset => {
            return asset.replace(/.*\//, "");
        });

        return unusedAssetsNames;
    }

    /**
     * Create a data snapshot for both local and remote devices.
     *
     * This function checks the last snapshot creation time and creates a new snapshot
     * if the minimum time between snapshots has passed.
     * @param remotes - An array of exactly two Remote objects containing remote server information.
     */
    private async createDataSnapshots(remotes: [Remote, Remote] = this.copyRemotes(this.remotes)) {
        SyncUtils.checkRemotes(remotes);

        consoleLog("Creating data snapshots for both local and remote devices...");

        const minHours = this.plugin.settingsManager.getPref("minHoursBetweenSnapshots");
        const minMilliseconds = minHours * 3600 * 1000;

        const snapshots = await Promise.all([
            getRepoSnapshots(1, remotes[0].url, SyncUtils.getHeaders(remotes[0].key)),
            getRepoSnapshots(1, remotes[1].url, SyncUtils.getHeaders(remotes[1].key))
        ]);

        const promises: Promise<void>[] = [];

        for (let i = 0; i < snapshots.length; i++) {
            if (!snapshots[i] || snapshots[i].snapshots.length <= 0) {
                showMessage(this.plugin.i18n.initializeDataRepo.replace(/{{remoteName}}/g, remotes[i].name), 6000);
                consoleWarn(`Failed to fetch snapshots for ${remotes[i].name}, skipping snapshot creation.`);
                return;
            }

            if (Date.now() - snapshots[i].snapshots[0].created > minMilliseconds)
                promises.push(createSnapshot("[better-sync] Cloud sync", remotes[i].url, SyncUtils.getHeaders(remotes[i].key)));
            else
                consoleLog(`Skipping snapshot for ${remotes[i].name}, last one was less than ${minHours} hours ago.`);
        }

        await Promise.all(promises);

        consoleLog("Data snapshots created successfully.");
    }

    /**
     * Get the newest sync log file for a remote and turn it into an asset.
     * Return the asset path.
     *
     * @param remote The remote information containing URL and key.
     * @returns The asset file path of the newest sync log.
     */
    async getNewestSyncLogAsAsset(remote: Remote = this.copyRemotes(this.remotes)[0]): Promise<string | null> {
        const lastSyncLog = await SyncUtils.getNewestSyncLogFile(remote);

        if (!lastSyncLog) return null;

        const result: IResUpload = await upload([lastSyncLog]);
        if (!result.succMap) {
            consoleWarn("Failed to upload sync log file.");
            return null;
        }

        const assetPath = Object.values(result.succMap)[0];
        if (!assetPath) {
            consoleWarn("No asset path found in upload result.");
            return null;
        }

        return assetPath;
    }

    /* Utility functions */

    /**
     * Create a deep copy of Remote or RemoteFileInfo objects to prevent mutations
     */
    private copyRemotes<T extends Remote>(remotes: [T, T]): [T, T] {
        return [
            remotes[0].clone() as T,
            remotes[1].clone() as T
        ];
    }

    /**
     * Dismiss the main sync notification message.
     * This is used to remove the sync message after the sync process completes.
     */
    private dismissMainSyncNotification() {
        showMessage("", 1, "info", "mainSyncNotification");
    }
}
