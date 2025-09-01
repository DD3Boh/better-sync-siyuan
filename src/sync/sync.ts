import {
    getRepoSnapshots,
    createSnapshot,
    getFileBlob,
    lsNotebooks,
    readDir,
    reloadFiletree,
    getUnusedAssets,
    requestWithHeaders
} from "@/api";
import BetterSyncPlugin from "..";
import { IProtyle, Protyle, showMessage } from "siyuan";
import { ConflictHandler, SyncUtils, WebSocketManager, getSyncTargets } from "@/sync";
import { Payload } from "@/libs/payload";
import { SyncStatus, SyncStatusCallback } from "@/types/sync-status";

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
    private remotes: [RemoteInfo, RemoteInfo] = [
        { url: "", key: "SKIP", name: "local", lastSyncTime: undefined },
        { url: "", key: "", name: "remote", lastSyncTime: undefined }
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
    private pendingDirRequests: Map<string, (files: Map<string, IResReadDir>) => void> = new Map();

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
        this.updateUrlKey();

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
     * Update the remotes array with the current Siyuan URL and API key.
     * This is called whenever the settings change to ensure the remotes are up-to-date.
     */
    updateUrlKey() {
        let url = this.getUrl()
        let key = this.getKey()

        const lastSyncTimes = this.remotes.map(remote => remote.lastSyncTime);

        this.remotes = [
            {
                url: "",
                key: "SKIP",
                name: "local",
                lastSyncTime: lastSyncTimes[0] || undefined
            },
            {
                url: url || "",
                key: key || "",
                name: this.getNickname() || "remote",
                lastSyncTime: lastSyncTimes[1] || undefined
            }
        ];

        // Update WebSocket managers with the new remotes
        this.cleanupWebSockets();
        this.setupWebSockets();
    }

    /**
     * Get the last local sync time.
     *
     * @return The last local sync time in milliseconds, or undefined if not set.
     */
    async getLastLocalSyncTime(): Promise<number | undefined> {
        if (!this.remotes[0].lastSyncTime)
            this.remotes[0].lastSyncTime = await SyncUtils.getLastSyncTime();

        return this.remotes[0].lastSyncTime;
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
    private async acquireLock(remote: RemoteInfo): Promise<void> {
        const lockParent = "data/.siyuan/sync";
        const resDir = await readDir(lockParent, remote.url, SyncUtils.getHeaders(remote.key));
        const lockFileInfo = resDir?.find(file => file.name === "lock");
        const now = Date.now();

        if (lockFileInfo) {
            const lockAge = now - (lockFileInfo.updated * 1000);
            const fiveMinutesInMs = 5 * 60 * 1000;

            if (lockAge > fiveMinutesInMs)
                console.log(`Lock file is ${Math.round(lockAge / 1000)} seconds old, ignoring stale lock for ${remote.name}`);
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
    private async releaseLock(remote: RemoteInfo): Promise<void> {
        const lockPath = "/data/.siyuan/sync/lock";
        try {
            await SyncUtils.deleteFile(lockPath, remote.url, remote.key);
        } catch (error) {
            this.dismissMainSyncNotification();

            console.error("Failed to release sync lock:", error);
            showMessage("Failed to release sync lock, please remove it manually.", 6000, "error");
        }
    }

    /**
     * Acquire locks for both local and remote remotes.
     * This ensures that both sides are locked before starting the sync process.
     * @param remotes The remotes to acquire locks for, defaults to the current remotes.
     */
    private async acquireAllLocks(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)): Promise<void> {
        SyncUtils.checkRemotes(remotes);

        // Acquire the remote lock first
        await this.acquireLock(remotes[1]);

        // Acquire the local lock
        await this.acquireLock(remotes[0]);

        console.log("Acquired sync locks.");
    }

    /**
     * Release locks for both local and remote remotes.
     * This is called after the sync process is complete to ensure both sides are unlocked.
     * @param remotes The remotes to release locks for, defaults to the current remotes.
     */
    private async releaseAllLocks(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)): Promise<void> {
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
                    console.log(`Sending ${url} request via WebSocket with app ID: ${appId}`);

                    const wsPayload = new Payload(url, {
                        requestData: init.body,
                        appId: appId
                    });
                    await this.transmitWebSocketMessage(wsPayload.toString(), this.inputWebSocketManagers[1]);
                } else {
                    console.log(`Sending ${url} request via regular fetch.`);
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

                console.log(`Creating new doc on remote server: ${fullPath}`);
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

                console.log(`Creating new notebook on remote server: ${notebookId}`);

                await this.syncDirectory(
                    "data",
                    notebookId,
                    this.copyRemotes(this.remotes),
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
            protyle.notebookId,
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
    setupWebSockets() {
        if (!this.plugin.settingsManager.getPref("useExperimentalWebSocket"))
            return;

        const remotes = this.copyRemotes(this.remotes);

        this.inputWebSocketManagers[0] = new WebSocketManager("better-sync-input", remotes[0]);
        this.outputWebSocketManagers[0] = new WebSocketManager("better-sync-output", remotes[0]);
        this.inputWebSocketManagers[1] = new WebSocketManager("better-sync-input", remotes[1]);
        this.outputWebSocketManagers[1] = new WebSocketManager("better-sync-output", remotes[1]);

        this.connectWebSocket(
            this.inputWebSocketManagers[0],
            this.webSocketInputCallback.bind(this),
            this.webSocketCloseRetryCallback.bind(this),
        )

        this.connectWebSocket(
            this.outputWebSocketManagers[0],
            null,
            this.webSocketCloseRetryCallback.bind(this)
        );
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
    private setRemoteAppId(appId: string, remote: RemoteInfo = this.remotes[1]) {
        remote.appId = appId;
    }

    /**
     * Checks if the remote appId is set.
     *
     * @param remote The remote information to check, defaults to the second remote.
     * @returns True if the remote appId is set and not "unknown-app-id", false otherwise.
     */
    private isRemoteAppIdSet(remote: RemoteInfo = this.remotes[1]): boolean {
        return !!remote.appId && remote.appId !== "unknown-app-id";
    }

    /**
     * Fetch and set the remote appId.
     *
     * @param remotes The list of remote connections.
     * @returns A Promise that resolves to a boolean indicating whether the appId was found successfully.
     */
    public async fetchAndSetRemoteAppId(remotes: RemoteInfo[] = this.remotes): Promise<boolean> {
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
                    console.log(`Remote app ID already set: ${remotes[1].appId}`);
                    return true;
                }

                this.setRemoteAppId(this.chooseRemoteAppId(), remotes[1]);
                console.log(`Remote app ID set to: ${remotes[1].appId}`);
                this.receivedAppIds.clear();
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 5));
        }

        console.warn("Timeout waiting for remote app ID.");
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
            console.warn("Received invalid WebSocket input message:", data);
            return;
        }

        switch (true) {
            case payload.type === "reload-protyles":
                console.log("Reloading all Protyles due to WebSocket message.");
                await this.reloadProtyles();
                break;

            case payload.type === "reload-protyles-if-open": {
                const { paths } = payload.data;

                for (const path of paths) {
                    const protyle = Array.from(this.loadedProtyles.values())
                        .find(p => `data/${p.protyle.notebookId}${p.protyle.path}` === path);
                    if (protyle) {
                        console.log(`Reloading Protyle for path: ${path}`);
                        protyle.reload(this.activeProtyle === protyle);
                    } else {
                        console.warn(`No Protyle found for path: ${path}`);
                    }
                }
                break;
            }

            case payload.type === "get-dir-files": {
                const { path, dirName, excludedItems, requestId, appId } = payload.data;

                if (appId && appId !== this.plugin.app.appId)
                    return console.warn(`Ignoring get-dir-files request for app ID ${appId}, current app ID is ${this.plugin.app.appId}`);

                console.log(`Received request for directory files: ${path}/${dirName} with app ID ${appId}`);
                const files = await SyncUtils.getDirFilesRecursively(path, dirName, "", "SKIP", true, excludedItems);
                const responsePayload = new Payload("dir-files-response", { files: Array.from(files.entries()), requestId });
                await this.transmitWebSocketMessage(responsePayload.toString(), this.outputWebSocketManagers[0]);
                break;
            }

            case payload.type.startsWith("/api/"): {
                console.log(`Processing api request via WebSocket: ${payload.type}`);

                const { appId, requestData } = payload.data;

                if (appId && appId !== this.plugin.app.appId) {
                    console.warn(`Ignoring request for app ID ${appId}, current app ID is ${this.plugin.app.appId}`);
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
                console.warn("Unknown WebSocket message:", payload);
                break;
        }
    }

    /**
     * WebSocket close callback to retry connection.
     *
     * @param websocketManager The WebSocket manager that was closed.
     */
    private async webSocketCloseRetryCallback(websocketManager: WebSocketManager) {
        console.warn(`WebSocket connection closed, attempting to reconnect...`);

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
                console.error(`Failed to reconnect WebSocket, retrying in 5 seconds...`, error);
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
            console.warn("Received invalid WebSocket output message:", data);
            return;
        }

        switch (payload.type) {
            case "dir-files-response": {
                const { files: fileArray, requestId } = payload.data;
                if (this.pendingDirRequests.has(requestId)) {
                    const filesMap = new Map<string, IResReadDir>(fileArray);
                    this.pendingDirRequests.get(requestId)(filesMap);
                    this.pendingDirRequests.delete(requestId);
                }
                break;
            }

            case "app-id-response": {
                const { appId } = payload.data;
                this.receivedAppIds.add(appId);
                console.log(`Received app ID from remote: ${appId}`);
                break;
            }

            default:
                console.warn("Unknown WebSocket message:", payload);
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
            console.warn("WebSocket manager is not initialized.");
            return;
        }

        if (webSocketManager.isConnected()) {
            console.log("WebSocket is already connected.");
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
            console.log("Remote output WebSocket is already connected.");
        } else {
            console.warn("Remote output WebSocket manager is not initialized.");
        }
    }

    /**
     * Disconnect the remote output WebSocket.
     */
    disconnectRemoteOutputWebSocket() {
        if (this.outputWebSocketManagers[1])
            this.outputWebSocketManagers[1].closeWebSocket();
        else
            console.warn("Remote output WebSocket manager is not initialized.");
    }

    /**
     * Send reload protyles message to the remote output WebSocket.
     *
     * @param paths An array of file paths to reload in the remote Protyles.
     *              If undefined, reload all Protyles.
     */
    async sendReloadProtylesMessage(paths: string[] | undefined = undefined) {
        if (!(await this.shouldUseWebSocket())) {
            console.warn("WebSocket is not enabled or remote is not listening.");
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
            console.warn("Remote input WebSocket manager is not initialized.");
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
        remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)
    ) {
        this.setSyncStatus(SyncStatus.InProgress);
        const startTime = Date.now();
        let savedError: Error | null = null;
        let promise: Promise<void> | null = null;
        try {
            SyncUtils.checkRemotes(remotes);

            if (persistentMessage)
                showMessage(this.plugin.i18n.syncingWithRemote.replace("{{remoteName}}", remotes[1].name), 0, "info", "mainSyncNotification");

            console.log(`Syncing with remote server ${remotes[1].name}...`);

            if (this.shouldUseWebSocket()) promise = this.connectRemoteOutputWebSocket();

            await this.acquireAllLocks(remotes);

            this.pendingFileChanges.forEach((timeoutId, filePath) => {
                clearTimeout(timeoutId);
                this.pendingFileChanges.set(filePath, 0);
            });

            await this.syncWithRemote(remotes, promise);
        } catch (error) {
            savedError = error;
            this.setSyncStatus(SyncStatus.Failed);
        } finally {
            await this.releaseAllLocks(remotes);
            console.log("Released all sync locks.");

            const duration = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "0.0";

            // Remove the main sync message
            if (persistentMessage)
                this.dismissMainSyncNotification();

            if (savedError !== null) {
                console.error("Error during sync:", savedError);

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
                console.warn(`Sync completed with conflicts in ${duration} seconds.`);
                this.setSyncStatus(SyncStatus.DoneWithConflict);
            } else {
                if (persistentMessage)
                    showMessage(this.plugin.i18n.syncCompletedSuccessfully.replace("{{duration}}", duration), 6000);
                console.log(`Sync completed successfully in ${duration} seconds!`);
                this.setSyncStatus(SyncStatus.Done);
            }

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
     * @param remotes An array of exactly two RemoteInfo objects containing remote server information.
     */
    private async syncWithRemote(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes), promise: Promise<void> | null = null) {
        SyncUtils.checkRemotes(remotes);

        // Create data snapshots if enabled
        if (this.plugin.settingsManager.getPref("createDataSnapshots")) {
            await this.createDataSnapshots(remotes);
        }

        // Update last sync times for both remotes
        await Promise.all([
            SyncUtils.getLastSyncTime(remotes[0].url, remotes[0].key).then(lastSyncTime => {
                this.remotes[0].lastSyncTime = lastSyncTime;
                remotes[0].lastSyncTime = lastSyncTime;
            }),
            SyncUtils.getLastSyncTime(remotes[1].url, remotes[1].key).then(lastSyncTime => {
                this.remotes[1].lastSyncTime = lastSyncTime;
                remotes[1].lastSyncTime = lastSyncTime;
            })
        ]);

        console.log(`Last sync times: ${remotes[0].lastSyncTime} (${remotes[0].name}), ${remotes[1].lastSyncTime} (${remotes[1].name})`);

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
            return this.syncDirectory(
                target.path,
                target.dirName,
                remotes,
                target.excludedItems || [],
                target.options
            );
        });

        // Add the petals list sync
        promises.push(this.syncPetalsListIfEmpty(remotes));

        // Execute all sync operations concurrently
        console.log(`Starting sync operations for ${notebooks.length} notebooks and ${syncTargets.length - notebooks.length * 2} other directories...`);

        await Promise.all(promises);

        // Handle missing assets
        await this.syncDirectory(
            "data",
            "assets",
            remotes,
            await this.getUnusedAssetsNames(remotes),
            { avoidDeletions: true }
        );

        reloadFiletree(remotes[0].url, SyncUtils.getHeaders(remotes[0].key));
        reloadFiletree(remotes[1].url, SyncUtils.getHeaders(remotes[1].key));

        const localAvFiles = Array.from(this.locallyUpdatedFiles).filter(
            path => path.startsWith("data/storage/av/") && path.endsWith(".json")
        );

        if (localAvFiles.length > 0) {
            console.log(`Locally updated AV files detected: ${localAvFiles.join(", ")}`);
            await this.reloadProtyles();
        }

        for (const [path, protyle] of this.loadedProtyles) {
            if (localAvFiles.length > 0) break;

            if (this.locallyUpdatedFiles.has(path)) {
                console.log(`Locally updated file ${path} is currently loaded in protyle ${protyle.protyle.id}`);

                protyle.reload(this.activeProtyle === protyle);
            }
        }

        const remoteAvFiles = Array.from(this.remotelyUpdatedFiles).filter(
            path => path.startsWith("data/storage/av/") && path.endsWith(".json")
        );

        if (remoteAvFiles.length > 0) {
            console.log(`Remotely updated AV files detected: ${remoteAvFiles.join(", ")}`);
            await this.sendReloadProtylesMessage();
        } else {
            this.sendReloadProtylesMessage(Array.from(this.remotelyUpdatedFiles));
        }

        const timestamp = Date.now();
        SyncUtils.setSyncStatus(remotes, timestamp);
        this.remotes[0].lastSyncTime = timestamp / 1000;
        this.remotes[1].lastSyncTime = timestamp / 1000;
    }

    private getRemoteDirFilesViaWebSocket(path: string, dirName: string, excludedItems: string[], appId: string): Promise<Map<string, IResReadDir>> {
        return new Promise(async (resolve, reject) => {
            const requestId = Math.random().toString(36).substring(2, 15);
            this.pendingDirRequests.set(requestId, resolve);

            // Timeout to prevent waiting forever
            setTimeout(() => {
                if (this.pendingDirRequests.has(requestId)) {
                    this.pendingDirRequests.delete(requestId);
                    reject(new Error(`Request for directory files timed out: ${path}/${dirName}`));
                }
            }, 5000);

            const payload = new Payload("get-dir-files", { path, dirName, excludedItems, requestId, appId });
            await this.transmitWebSocketMessage(payload.toString(), this.inputWebSocketManagers[1]);
        });
    }

    /**
     * Synchronize a directory between local and remote devices, in both directions.
     * @param path The path to the directory to synchronize.
     * @param dirName The name of the directory to synchronize.
     * @param remotes An array of exactly two RemoteInfo objects containing remote server information.
     * @param excludedItems An array of item names to exclude from synchronization.
     * @param options Synchronization options including:
     * - deleteFoldersOnly: If true, only delete folders and not single files.
     * - onlyIfMissing: If true, only synchronize files that are missing in one of the remotes.
     * - avoidDeletions: If true, do not delete files in any remote.
     * - trackConflicts: If true, track conflicts during synchronization.
     */
    private async syncDirectory(
        path: string,
        dirName: string,
        remotes: [RemoteInfo, RemoteInfo],
        excludedItems: string[] = [],
        options?: {
            deleteFoldersOnly?: boolean,
            onlyIfMissing?: boolean,
            avoidDeletions?: boolean,
            trackConflicts?: boolean,
            trackUpdatedFiles?: boolean
        }
    ) {
        console.log(`Syncing directory ${path}/${dirName}. Excluding items: ${excludedItems.join(", ")}`);

        const isRemoteAppIdSet = this.isRemoteAppIdSet(remotes[1]);
        const useWebSocket: boolean = await this.shouldUseWebSocket() && isRemoteAppIdSet;
        let disconnectWebSocket = false;

        if (useWebSocket && !this.outputWebSocketManagers[1].isConnected()) {
            this.connectRemoteOutputWebSocket();
            console.log("Connected to remote output WebSocket for directory sync.");
            disconnectWebSocket = true;
        }

        const filesOnePromise = SyncUtils.getDirFilesRecursively(path, dirName, remotes[0].url, remotes[0].key, true, excludedItems);

        const filesTwoPromise = useWebSocket
            ? this.getRemoteDirFilesViaWebSocket(path, dirName, excludedItems, remotes[1].appId)
            : SyncUtils.getDirFilesRecursively(path, dirName, remotes[1].url, remotes[1].key, true, excludedItems);

        const [filesOne, filesTwo] = await Promise.all([
            filesOnePromise,
            filesTwoPromise
        ]);

        // Create a combined map of all files
        const allFiles = new Map<string, IResReadDir>();

        [...filesOne, ...filesTwo].forEach(pair => {
            allFiles.set(pair[0], pair[1]);
        });

        const promises: Promise<void>[] = [];

        // Synchronize files
        for (const [filePath] of allFiles.entries()) {
            const remoteFileInfos: [RemoteFileInfo, RemoteFileInfo] = [
                {
                    ...remotes[0],
                    file: filesOne.get(filePath)
                },
                {
                    ...remotes[1],
                    file: filesTwo.get(filePath)
                }
            ];

            promises.push(this.syncFile(
                filePath,
                dirName,
                options,
                remoteFileInfos
            ));
        }

        await Promise.all(promises);

        if (disconnectWebSocket) this.disconnectRemoteOutputWebSocket();
    }

    /**
     * Synchronize a file between local and remote devices.
     * @param filePath The path to the file to synchronize.
     * @param dirName The name of the directory containing the file.
     * @param options Synchronization options including:
     * - deleteFoldersOnly: If true, only delete folders and not single files.
     * - onlyIfMissing: If true, only synchronize files that are missing in one of the remotes.
     * - avoidDeletions: If true, do not delete files in any remote.
     * - trackConflicts: If true, track conflicts during synchronization.
     * @param remotes An array of exactly two RemoteFileInfo objects containing remote server information.
     */
    async syncFile(
        filePath: string,
        dirName: string,
        options?: {
            deleteFoldersOnly?: boolean,
            onlyIfMissing?: boolean,
            avoidDeletions?: boolean,
            trackConflicts?: boolean,
            trackUpdatedFiles?: boolean
        },
        remotes: [RemoteFileInfo, RemoteFileInfo] = this.remotes,
    ) {
        const copyRemotes = this.copyRemotes(remotes);
        const parentPath = filePath.replace(/\/[^/]+$/, "");
        const fileName = filePath.replace(/^.*\//, "");

        await Promise.all(copyRemotes.map(async (remote) => {
            if (!remote.file) {
                const dir = await readDir(parentPath, remote.url, SyncUtils.getHeaders(remote.key));
                remote.file = dir?.find(it => it.name === fileName);
            }
        }));

        const fileRes = copyRemotes[0].file || copyRemotes[1].file;

        if (!fileRes) {
            console.log(`File ${filePath} not found in either remote.`);
            return;
        }

        const updated: [number, number] = [
            copyRemotes[0].file?.updated || 0,
            copyRemotes[1].file?.updated || 0
        ];

        // Conflict detection
        let trackConflicts = options?.trackConflicts ?? false;
        if (this.pendingFileChanges.has(filePath) && trackConflicts) {
            console.log(`Conflicts tracking skipped for ${filePath} as it has pending changes.`);
            trackConflicts = false;
            this.pendingFileChanges.delete(filePath);
        }

        if (!options?.onlyIfMissing && !fileRes.isDir && trackConflicts) {
            const conflictDetected = await ConflictHandler.handleConflictDetection(
                filePath,
                dirName,
                copyRemotes,
                this.plugin.i18n
            );

            if (conflictDetected) this.conflictDetected = true;
        }

        // Multiply by 1000 because `putFile` makes the conversion automatically
        const timestamp: number = Math.max(updated[0], updated[1]) * 1000;

        const lastSyncTime = Math.min(copyRemotes[0].lastSyncTime, copyRemotes[1].lastSyncTime);

        if (copyRemotes[0].file && copyRemotes[1].file && (updated[0] === updated[1] || options?.onlyIfMissing)) return;

        const iIn = updated[0] > updated[1] ? 0 : 1;
        const iOut = updated[0] > updated[1] ? 1 : 0;

        if (!fileRes.isDir)
            console.log(`Syncing file from ${copyRemotes[iIn].name} to ${copyRemotes[iOut].name}: ${fileRes.name} (${filePath}), timestamps: ${updated[0]} vs ${updated[1]}`);

        // Remove deleted files
        if ((!copyRemotes[0].file && lastSyncTime > updated[1]) || (!copyRemotes[1].file && lastSyncTime > updated[0])) {
            if ((fileRes.isDir || !options?.deleteFoldersOnly) && !options?.avoidDeletions) {
                const targetIndex = !copyRemotes[0].file ? 1 : 0;
                await SyncUtils.deleteFile(filePath, copyRemotes[targetIndex].url, copyRemotes[targetIndex].key);
                return;
            }
        }

        // Avoid writing directories
        if (fileRes.isDir) return;

        const syFile = await getFileBlob(filePath, copyRemotes[iIn].url, SyncUtils.getHeaders(copyRemotes[iIn].key));
        if (!syFile) {
            console.log(`File ${filePath} not found in source: ${copyRemotes[iIn].name}`);
            return;
        }

        const file = new File([syFile], fileRes.name, { lastModified: timestamp });
        await SyncUtils.putFile(filePath, file, copyRemotes[iOut].url, copyRemotes[iOut].key, timestamp);

        if (options?.trackUpdatedFiles) {
            const updatedFiles = iIn === 0 ? this.remotelyUpdatedFiles : this.locallyUpdatedFiles;
            updatedFiles.add(filePath);
        }
    }

    /**
     * Synchronize the petals list between local and remote devices.
     * This function checks if the petals list is empty in either remote and syncs it if necessary.
     * @param remotes An array of exactly two RemoteInfo objects containing remote server information.
     */
    private async syncPetalsListIfEmpty(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)) {
        SyncUtils.checkRemotes(remotes);

        const petalsList = await Promise.all([
            getFileBlob("/data/storage/petal/petals.json", remotes[0].url, SyncUtils.getHeaders(remotes[0].key)),
            getFileBlob("/data/storage/petal/petals.json", remotes[1].url, SyncUtils.getHeaders(remotes[1].key))
        ]);

        for (let index = 0; index < petalsList.length; index++) {
            if (!petalsList[index] || await petalsList[index].text() === "[]") {
                const otherIndex = index === 0 ? 1 : 0;
                console.log(`Syncing petals list from ${remotes[otherIndex].name} to ${remotes[index].name}`);
                let file = new File([petalsList[otherIndex]], "petals.json");
                SyncUtils.putFile("/data/storage/petal/petals.json", file, remotes[index].url, remotes[index].key);
                break;
            }
        }
    }

    /**
     * Get the names of unused assets from both local and remote devices.
     * This function fetches the list of unused assets from both remotes and combines them.
     * @param remotes An array of exactly two RemoteInfo objects containing remote server information.
     * @returns A Promise that resolves to an array of asset names that are not used in either remote.
     */
    private async getUnusedAssetsNames(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)): Promise<string[]> {
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
     * @param remotes - An array of exactly two RemoteInfo objects containing remote server information.
     */
    private async createDataSnapshots(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)) {
        SyncUtils.checkRemotes(remotes);

        console.log("Creating data snapshots for both local and remote devices...");

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
                console.warn(`Failed to fetch snapshots for ${remotes[i].name}, skipping snapshot creation.`);
                return;
            }

            if (Date.now() - snapshots[i].snapshots[0].created > minMilliseconds)
                promises.push(createSnapshot("[better-sync] Cloud sync", remotes[i].url, SyncUtils.getHeaders(remotes[i].key)));
            else
                console.log(`Skipping snapshot for ${remotes[i].name}, last one was less than ${minHours} hours ago.`);
        }

        await Promise.all(promises);
    }

    /* Utility functions */

    /**
     * Create a deep copy of RemoteInfo or RemoteFileInfo objects to prevent mutations
     */
    private copyRemotes<T extends RemoteInfo>(remotes: [T, T]): [T, T] {
        return [
            { ...remotes[0] },
            { ...remotes[1] }
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
