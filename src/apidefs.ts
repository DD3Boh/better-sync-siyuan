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
