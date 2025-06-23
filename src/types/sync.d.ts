interface RemoteInfo {
    url: string;
    key: string;
    name: string;
    lastSyncTime: number;
}

interface RemoteFileInfo extends RemoteInfo {
    file?: IResReadDir;
}
