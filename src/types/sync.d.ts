interface RemoteInfo {
    url: string;
    key: string;
    name: string;
    lastSyncTime: number;
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
