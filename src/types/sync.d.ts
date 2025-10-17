interface RemoteInfo {
    url: string;
    key: string;
    name: string;
    lastSyncTime: number;
    appId?: string;
    instanceId?: string;
    // Maps instance ids to last sync times
    syncHistory?: Map<string, number>;
}

interface RemoteFileInfo extends RemoteInfo {
    file?: IResReadDir;
}

interface Transaction {
    doOperations: IOperation[];
    undoOperations: IOperation[];
}

interface TransactionPayload {
    session: string;
    app: string;
    transactions: Transaction[];
    reqId: number;
}

interface CreateDocRequest {
    notebook: string;
    path: string;
    title: string;
    md: string;
    listDocTree: boolean;
}

interface RenameDocRequest {
    notebook: string;
    path: string;
    title: string;
}

interface RemoveDocRequest {
    notebook: string;
    path: string;
}

interface MoveDocsRequest {
    fromPaths: string[];
    toNotebook: string;
    toPath: string;
}

interface RemoveDocsRequest {
    paths: string[];
}
