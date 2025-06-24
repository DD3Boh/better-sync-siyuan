type NotebookInfo = {
    boxInfo: {
        id: string;
        name: string;
        docCount: number;
        size: number;
        mtime: number;
        ctime: number;
    }
}

type DocumentFiles = {
    path: string;
    name: string;
    icon: string;
    name1: string;
    alias: string;
    memo: string;
    bookmark: string;
    id: string;
    count: number;
    size: number;
    mtime: number;
    ctime: number;
    sort: number;
    subFileCount: number;
    hidden: boolean;
}

type DocsData = {
    box: string;
    files: DocumentFiles[],
    path: string;
}

type MissingAssets = {
    missingAssets: string[];
}

type UnusedAssets = {
    unusedAssets: string[];
}

type StoragePath = {
    notebook: string;
    path: string;
}

type ITypeCount = {
    type: string;
    count: number;
}

type ISnapshot = {
    id: string;
    memo: string;
    created: number;
    hCreated: string;
    files: any;
    count: number;
    size: number;
    hSize: string;
    systemID: string;
    systemName: string;
    systemOS: string;
    tag: string;
    hTagUpdated: string;
    typesCount: ITypeCount[];
}

type IResGetRepoSnapshots = {
    pageCount: number;
    snapshots: ISnapshot[];
    totalCount: number;
}
