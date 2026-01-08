import { SyncHistory } from "./history";

/**
 * Represents a remote server connection for synchronization.
 * This class encapsulates all information needed to connect to and sync with a remote SiYuan instance.
 */
export class Remote {
    public url: string;
    public key: string;
    public name: string;
    public appId?: string;
    public instanceId?: string;
    public syncHistory: Map<string, number>;
    public file?: IResReadDir;

    public get lastSyncTime(): number {
        return SyncHistory.getLastSyncWithRemote(this, this.instanceId || "");
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
        this.url = url;
        this.key = key;
        this.name = name;
        this.appId = appId;
        this.instanceId = instanceId;
        this.syncHistory = syncHistory;
        this.file = file;
    }

    /**
     * Create a copy of this Remote instance.
     * @returns A new Remote instance with the same values.
     */
    clone(): Remote {
        return new Remote(
            this.url,
            this.key,
            this.name,
            this.appId,
            this.instanceId,
            new Map(this.syncHistory),
            this.file
        );
    }

    static default(): Remote {
        return new Remote("", "SKIP", "Local");
    }

    static empty(): Remote {
        return new Remote("", "", "remote");
    }

    /**
     * Check if this is a local remote (has no URL or key is "SKIP").
     * @returns True if this is a local remote, false otherwise.
     */
    isLocal(): boolean {
        return this.url === "" || this.key === "SKIP";
    }

    /**
     * Check if the appId is set and valid.
     * @returns True if appId is set and not "unknown-app-id", false otherwise.
     */
    hasValidAppId(): boolean {
        return !!this.appId && this.appId !== "unknown-app-id";
    }

    /**
     * Get headers for API requests.
     * @returns An object containing the Authorization header.
     */
    getHeaders(): Record<string, string> {
        if (this.key === "SKIP" || !this.key) {
            return {};
        }
        return {
            "Authorization": `Token ${this.key}`
        };
    }

    /**
     * Create a Remote instance with file information attached.
     * @param file The file information to attach.
     * @returns A new Remote instance with the file attached.
     */
    withFile(file: IResReadDir): Remote {
        return new Remote(
            this.url,
            this.key,
            this.name,
            this.appId,
            this.instanceId,
            new Map(this.syncHistory),
            file
        );
    }
}
