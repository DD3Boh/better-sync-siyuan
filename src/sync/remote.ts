import { SyncHistory } from "./history";

/**
 * Represents a remote server connection for synchronization.
 * This class encapsulates all information needed to connect to and sync with a remote SiYuan instance.
 */
export class Remote {
    private _url: string;
    private _key: string;
    private _name: string;
    private _appId?: string;
    private _instanceId?: string;
    private _syncHistory: Map<string, number>;
    private _file?: IResReadDir;

    public get url(): string {
        return this._url;
    }

    public set url(value: string) {
        this._url = value;
    }

    public get key(): string {
        return this._key;
    }

    public set key(value: string) {
        this._key = value;
    }

    public get name(): string {
        return this._name;
    }

    public set name(value: string) {
        this._name = value;
    }

    public get appId(): string | undefined {
        return this._appId;
    }

    public set appId(value: string | undefined) {
        this._appId = value;
    }

    public get instanceId(): string | undefined {
        return this._instanceId;
    }

    public set instanceId(value: string | undefined) {
        this._instanceId = value;
    }

    public get syncHistory(): Map<string, number> {
        return this._syncHistory;
    }

    public set syncHistory(value: Map<string, number>) {
        this._syncHistory = value;
    }

    public get file(): IResReadDir | undefined {
        return this._file;
    }

    public set file(value: IResReadDir | undefined) {
        this._file = value;
    }

    public get lastSyncTime(): number {
        return SyncHistory.getLastSyncWithRemote(this, this._instanceId || "");
    }

    constructor(
        url: string,
        key: string,
        name: string,
        appId?: string,
        instanceId?: string,
        syncHistory: Map<string, number> = new Map(),
        file?: IResReadDir
    ) {
        this._url = url;
        this._key = key;
        this._name = name;
        this._appId = appId;
        this._instanceId = instanceId;
        this._syncHistory = syncHistory;
        this._file = file;
    }

    /**
     * Create a copy of this Remote instance.
     * @returns A new Remote instance with the same values.
     */
    clone(): Remote {
        return new Remote(
            this._url,
            this._key,
            this._name,
            this._appId,
            this._instanceId,
            new Map(this._syncHistory),
            this._file
        );
    }

    static default(): Remote {
        return new Remote(
            "",
            "SKIP",
            "Local",
        );
    }

    static empty(): Remote {
        return new Remote(
            "",
            "",
            "remote",
        );
    }

    /**
     * Check if this is a local remote (has no URL or key is "SKIP").
     * @returns True if this is a local remote, false otherwise.
     */
    isLocal(): boolean {
        return this._url === "" || this._key === "SKIP";
    }

    /**
     * Check if the appId is set and valid.
     * @returns True if appId is set and not "unknown-app-id", false otherwise.
     */
    hasValidAppId(): boolean {
        return !!this._appId && this._appId !== "unknown-app-id";
    }

    /**
     * Get headers for API requests.
     * @returns An object containing the Authorization header.
     */
    getHeaders(): Record<string, string> {
        if (this._key === "SKIP" || !this._key) {
            return {};
        }
        return {
            "Authorization": `Token ${this._key}`
        };
    }

    /**
     * Create a Remote instance with file information attached.
     * @param file The file information to attach.
     * @returns A new Remote instance with the file attached.
     */
    withFile(file: IResReadDir): Remote {
        return new Remote(
            this._url,
            this._key,
            this._name,
            this._appId,
            this._instanceId,
            new Map(this._syncHistory),
            file
        );
    }

    /**
     * Set the appId for this remote.
     * @param appId The appId to set.
     */
    setAppId(appId: string): void {
        this._appId = appId;
    }

    /**
     * Set the instanceId for this remote.
     * @param instanceId The instanceId to set.
     */
    setInstanceId(instanceId: string): void {
        this._instanceId = instanceId;
    }
}
