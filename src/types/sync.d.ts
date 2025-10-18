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
