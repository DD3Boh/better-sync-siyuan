/**
 * Copyright (c) 2023 frostime. All rights reserved.
 * https://github.com/frostime/sy-plugin-template-vite
 * 
 * See API Document in [API.md](https://github.com/siyuan-note/siyuan/blob/master/API.md)
 * API 文档见 [API_zh_CN.md](https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md)
 */

import { fetchPost, fetchSyncPost, IWebSocketData } from "siyuan";
import { consoleError, consoleLog } from "./logging";


export async function request(url: string, data: any) {
    let response: IWebSocketData = await fetchSyncPost(url, data);
    let res = response.code === 0 ? response.data : null;
    return res;
}

export async function requestWithHeaders(url: string, data: any, headers?: Record<string, string>, timeoutMs: number = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`Request timeout for ${url}`));
        }, timeoutMs);

        try {
            fetchPost(url, data, (response: IWebSocketData) => {
                clearTimeout(timeoutId);
                if (response.code === 0) {
                    resolve(response.data);
                } else {
                    consoleError(`Request failed for ${url}:`, response.msg || 'Unknown error');
                    resolve(null);
                }
            }, headers);
        } catch (error) {
            clearTimeout(timeoutId);
            consoleError(`Request failed for ${url}:`, error);
            reject(error);
        }
    });
};

// **************************************** Noteboook ****************************************


export async function lsNotebooks(urlPrefix: string = '', headers?: Record<string, string>): Promise<IReslsNotebooks> {
    let url = `${urlPrefix}/api/notebook/lsNotebooks`;
    return requestWithHeaders(url, '', headers);
}

export async function openNotebook(notebook: NotebookId, urlPrefix: string = '', headers?: Record<string, string>) {
    let url = `${urlPrefix}/api/notebook/openNotebook`;
    return requestWithHeaders(url, { notebook: notebook }, headers);
}

export async function closeNotebook(notebook: NotebookId, urlPrefix: string = '', headers?: Record<string, string>) {
    let url = `${urlPrefix}/api/notebook/closeNotebook`;
    return requestWithHeaders(url, { notebook: notebook }, headers);
}

export async function renameNotebook(notebook: NotebookId, name: string, urlPrefix: string = '', headers?: Record<string, string>) {
    let url = `${urlPrefix}/api/notebook/renameNotebook`;
    return requestWithHeaders(url, { notebook: notebook, name: name }, headers);
}

export async function createNotebook(name: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<Notebook> {
    let url = `${urlPrefix}/api/notebook/createNotebook`;
    return requestWithHeaders(url, { name: name }, headers);
}

export async function removeNotebook(notebook: NotebookId, urlPrefix: string = '', headers?: Record<string, string>) {
    let url = `${urlPrefix}/api/notebook/removeNotebook`;
    return requestWithHeaders(url, { notebook: notebook }, headers);
}

export async function getNotebookConf(notebook: NotebookId, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResGetNotebookConf> {
    let data = { notebook: notebook };
    let url = `${urlPrefix}/api/notebook/getNotebookConf`;
    return requestWithHeaders(url, data, headers);
}

export async function setNotebookConf(notebook: NotebookId, conf: NotebookConf, urlPrefix: string = '', headers?: Record<string, string>): Promise<NotebookConf> {
    let data = { notebook: notebook, conf: conf };
    let url = `${urlPrefix}/api/notebook/setNotebookConf`;
    return requestWithHeaders(url, data, headers);
}

export async function getNotebookInfo(notebook: NotebookId, urlPrefix: string = '', headers?: Record<string, string>): Promise<NotebookInfo> {
    let data = { notebook: notebook };
    let url = `${urlPrefix}/api/notebook/getNotebookInfo`;
    return requestWithHeaders(url, data, headers);
}

// **************************************** File Tree ****************************************
export async function createDocWithMd(notebook: NotebookId, path: string, markdown: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<DocumentId> {
    let data = {
        notebook: notebook,
        path: path,
        markdown: markdown,
    };
    let url = `${urlPrefix}/api/filetree/createDocWithMd`;
    return requestWithHeaders(url, data, headers);
}

export async function renameDoc(notebook: NotebookId, path: string, title: string, urlPrefix: string = '', headers?: Record<string, string>) {
    let data = {
        notebook: notebook,
        path: path,
        title: title
    };
    let url = `${urlPrefix}/api/filetree/renameDoc`;
    return requestWithHeaders(url, data, headers);
}

export async function renameDocByID(id: DocumentId, title: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<DocumentId> {
    let data = {
        id: id,
        title: title
    };
    let url = `${urlPrefix}/api/filetree/renameDocByID`;
    return requestWithHeaders(url, data, headers);
}

export async function removeDoc(notebook: NotebookId, path: string, urlPrefix: string = '', headers?: Record<string, string>) {
    let data = {
        notebook: notebook,
        path: path,
    };
    let url = `${urlPrefix}/api/filetree/removeDoc`;
    return requestWithHeaders(url, data, headers);
}

export async function moveDocs(fromPaths: string[], toNotebook: NotebookId, toPath: string, urlPrefix: string = '', headers?: Record<string, string>) {
    let data = {
        fromPaths: fromPaths,
        toNotebook: toNotebook,
        toPath: toPath
    };
    let url = `${urlPrefix}/api/filetree/moveDocs`;
    return requestWithHeaders(url, data, headers);
}

export async function listDocsByPath(notebook: NotebookId, path: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<DocsData> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = `${urlPrefix}/api/filetree/listDocsByPath`;
    return requestWithHeaders(url, data, headers);
}

export async function getHPathByPath(notebook: NotebookId, path: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<string> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = `${urlPrefix}/api/filetree/getHPathByPath`;
    return requestWithHeaders(url, data, headers);
}

export async function getHPathByID(id: BlockId, urlPrefix: string = '', headers?: Record<string, string>): Promise<string> {
    let data = {
        id: id
    };
    let url = `${urlPrefix}/api/filetree/getHPathByID`;
    return requestWithHeaders(url, data, headers);
}

export async function getIDsByHPath(notebook: NotebookId, path: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<BlockId[]> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = `${urlPrefix}/api/filetree/getIDsByHPath`;
    return requestWithHeaders(url, data, headers);
}

export async function getPathByID(id: BlockId, urlPrefix: string = '', headers?: Record<string, string>): Promise<StoragePath> {
    let data = {
        id: id
    };
    let url = `${urlPrefix}/api/filetree/getPathByID`;
    return requestWithHeaders(url, data, headers);
}

// **************************************** Asset Files ****************************************

export async function upload(files: any[], assetsDirPath: string = null, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResUpload> {
    let form = new FormData();

    if (assetsDirPath)
        form.append('assetsDirPath', assetsDirPath);

    for (let file of files)
        form.append('file[]', file);

    let url = `${urlPrefix}/api/asset/upload`;
    return requestWithHeaders(url, form, headers);
}

export async function getMissingAssets(urlPrefix: string = '', headers?: Record<string, string>): Promise<MissingAssets> {
    let url = `${urlPrefix}/api/asset/getMissingAssets`;
    return requestWithHeaders(url, null, headers);
}

export async function getUnusedAssets(urlPrefix: string = '', headers?: Record<string, string>): Promise<UnusedAssets> {
    let url = `${urlPrefix}/api/asset/getUnusedAssets`;
    return requestWithHeaders(url, null, headers);
}

// **************************************** Block ****************************************
type DataType = "markdown" | "dom";
export async function insertBlock(
    dataType: DataType, data: string,
    nextID?: BlockId, previousID?: BlockId, parentID?: BlockId,
    urlPrefix: string = '', headers?: Record<string, string>
): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        nextID: nextID,
        previousID: previousID,
        parentID: parentID
    }
    let url = `${urlPrefix}/api/block/insertBlock`;
    return requestWithHeaders(url, payload, headers);
}

export async function prependBlock(dataType: DataType, data: string, parentID: BlockId | DocumentId, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = `${urlPrefix}/api/block/prependBlock`;
    return requestWithHeaders(url, payload, headers);
}

export async function appendBlock(dataType: DataType, data: string, parentID: BlockId | DocumentId, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = `${urlPrefix}/api/block/appendBlock`;
    return requestWithHeaders(url, payload, headers);
}

export async function updateBlock(dataType: DataType, data: string, id: BlockId, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        id: id
    }
    let url = `${urlPrefix}/api/block/updateBlock`;
    return requestWithHeaders(url, payload, headers);
}

export async function deleteBlock(id: BlockId, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResdoOperations[]> {
    let data = {
        id: id
    }
    let url = `${urlPrefix}/api/block/deleteBlock`;
    return requestWithHeaders(url, data, headers);
}

export async function moveBlock(id: BlockId, previousID?: PreviousID, parentID?: ParentID, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResdoOperations[]> {
    let data = {
        id: id,
        previousID: previousID,
        parentID: parentID
    }
    let url = `${urlPrefix}/api/block/moveBlock`;
    return requestWithHeaders(url, data, headers);
}

export async function foldBlock(id: BlockId, urlPrefix: string = '', headers?: Record<string, string>) {
    let data = {
        id: id
    }
    let url = `${urlPrefix}/api/block/foldBlock`;
    return requestWithHeaders(url, data, headers);
}

export async function unfoldBlock(id: BlockId, urlPrefix: string = '', headers?: Record<string, string>) {
    let data = {
        id: id
    }
    let url = `${urlPrefix}/api/block/unfoldBlock`;
    return requestWithHeaders(url, data, headers);
}

export async function getBlockKramdown(id: BlockId, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResGetBlockKramdown> {
    let data = {
        id: id
    }
    let url = `${urlPrefix}/api/block/getBlockKramdown`;
    return requestWithHeaders(url, data, headers);
}

export async function getChildBlocks(id: BlockId, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResGetChildBlock[]> {
    let data = {
        id: id
    }
    let url = `${urlPrefix}/api/block/getChildBlocks`;
    return requestWithHeaders(url, data, headers);
}

export async function transferBlockRef(fromID: BlockId, toID: BlockId, refIDs: BlockId[], urlPrefix: string = '', headers?: Record<string, string>) {
    let data = {
        fromID: fromID,
        toID: toID,
        refIDs: refIDs
    }
    let url = `${urlPrefix}/api/block/transferBlockRef`;
    return requestWithHeaders(url, data, headers);
}

// **************************************** Attributes ****************************************
export async function setBlockAttrs(id: BlockId, attrs: { [key: string]: string }, urlPrefix: string = '', headers?: Record<string, string>) {
    let data = {
        id: id,
        attrs: attrs
    }
    let url = `${urlPrefix}/api/attr/setBlockAttrs`;
    return requestWithHeaders(url, data, headers);
}

export async function getBlockAttrs(id: BlockId, urlPrefix: string = '', headers?: Record<string, string>): Promise<{ [key: string]: string }> {
    let data = {
        id: id
    }
    let url = `${urlPrefix}/api/attr/getBlockAttrs`;
    return requestWithHeaders(url, data, headers);
}

// **************************************** SQL ****************************************

export async function sql(sql: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<any[]> {
    let sqldata = {
        stmt: sql,
    };
    let url = `${urlPrefix}/api/query/sql`;
    return requestWithHeaders(url, sqldata, headers);
}

export async function getBlockByID(blockId: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<Block> {
    let sqlScript = `select * from blocks where id ='${blockId}'`;
    let data = await sql(sqlScript, urlPrefix, headers);
    return data[0];
}

// **************************************** Template ****************************************

export async function render(id: DocumentId, path: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResGetTemplates> {
    let data = {
        id: id,
        path: path
    }
    let url = `${urlPrefix}/api/template/render`;
    return requestWithHeaders(url, data, headers);
}

export async function renderSprig(template: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<string> {
    let url = `${urlPrefix}/api/template/renderSprig`;
    return requestWithHeaders(url, { template: template }, headers);
}

// **************************************** File ****************************************

export async function getFile(path: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<any> {
    let data = {
        path: path
    }
    let url = `${urlPrefix}/api/file/getFile`;
    return new Promise((resolve, _) => {
        fetchPost(url, data, (content: any) => {
            resolve(content)
        }, headers);
    });
}

export async function copyFile(src: string, dest: string, urlPrefix: string = '', headers?: Record<string, string>) {
    let data = {
        src: src,
        dest: dest
    }
    let url = `${urlPrefix}/api/file/copyFile`;
    return requestWithHeaders(url, data, headers);
}

export const getFileBlob = async (path: string, urlPrefix: string = '', headers?: Record<string, string>, timeoutMs: number = 5000): Promise<Blob | null> => {
    const endpoint = `${urlPrefix}/api/file/getFile`;

    try {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Request timeout for ${endpoint}`)), timeoutMs);
        });

        const fetchPromise = fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: JSON.stringify({
                path: path
            })
        });

        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (!response.ok || response.status !== 200) {
            return null;
        }

        const data = await response.blob();
        return data;
    } catch (error) {
        consoleError(`getFileBlob failed for ${endpoint}:`, error);
        throw error;
    }
}

export async function putFile(path: string, isDir: boolean, file: any, urlPrefix: string = '', headers?: Record<string, string>, modTime: number = Date.now()) {
    let form = new FormData();
    form.append('path', path);
    form.append('isDir', isDir.toString());
    form.append('modTime', modTime.toString());
    form.append('file', file);
    let url = `${urlPrefix}/api/file/putFile`;
    return requestWithHeaders(url, form, headers);
}

export async function removeFile(path: string, urlPrefix: string = '', headers?: Record<string, string>) {
    let data = {
        path: path
    }
    let url = `${urlPrefix}/api/file/removeFile`;
    return requestWithHeaders(url, data, headers);
}

export async function readDir(path: string, urlPrefix: string = '', headers?: Record<string, string>, timeoutMs?: number): Promise<IResReadDir[]> {
    let data = {
        path: path
    }
    let url = `${urlPrefix}/api/file/readDir`;

    if (timeoutMs)
        return requestWithHeaders(url, data, headers, timeoutMs);

    return requestWithHeaders(url, data, headers);
}

// **************************************** Export ****************************************

export async function exportMdContent(id: DocumentId, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResExportMdContent> {
    let data = {
        id: id
    }
    let url = `${urlPrefix}/api/export/exportMdContent`;
    return requestWithHeaders(url, data, headers);
}

export async function exportResources(paths: string[], name: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResExportResources> {
    let data = {
        paths: paths,
        name: name
    }
    let url = `${urlPrefix}/api/export/exportResources`;
    return requestWithHeaders(url, data, headers);
}

// **************************************** Convert ****************************************

export type PandocArgs = string;
export async function pandoc(args: PandocArgs[], urlPrefix: string = '', headers?: Record<string, string>) {
    let data = {
        args: args
    }
    let url = `${urlPrefix}/api/convert/pandoc`;
    return requestWithHeaders(url, data, headers);
}

// **************************************** Notification ****************************************

export async function pushMsg(msg: string, timeout: number = 7000, urlPrefix: string = '', headers?: Record<string, string>) {
    let payload = {
        msg: msg,
        timeout: timeout
    };
    let url = `${urlPrefix}/api/notification/pushMsg`;
    return requestWithHeaders(url, payload, headers);
}

export async function pushErrMsg(msg: string, timeout: number = 7000, urlPrefix: string = '', headers?: Record<string, string>) {
    let payload = {
        msg: msg,
        timeout: timeout
    };
    let url = `${urlPrefix}/api/notification/pushErrMsg`;
    return requestWithHeaders(url, payload, headers);
}

// **************************************** Network ****************************************
export async function forwardProxy(
    url: string, method: string = 'GET', payload: any = {},
    headers: any[] = [], timeout: number = 7000, contentType: string = "text/html",
    urlPrefix: string = '', customHeaders?: Record<string, string>
): Promise<IResForwardProxy> {
    let data = {
        url: url,
        method: method,
        timeout: timeout,
        contentType: contentType,
        headers: headers,
        payload: payload
    }
    let url1 = `${urlPrefix}/api/network/forwardProxy`;
    return requestWithHeaders(url1, data, customHeaders);
}

// **************************************** Broadcast ****************************************

/**
 * Post a message to a broadcast channel.
 *
 * @param channel The channel name.
 * @param message The message to post.
 * @param urlPrefix The Siyuan API URL prefix.
 * @param headers Optional headers.
 */
export async function postBroadcastMessage(channel: string, message: string, urlPrefix: string = '', headers?: Record<string, string>) {
    const url = `${urlPrefix}/api/broadcast/postMessage`;
    return requestWithHeaders(url, { channel, message }, headers);
}

/**
 * Publishes messages to a broadcast channel. This can include string and binary data.
 * @param channel The channel name.
 * @param data An object containing arrays of strings and/or binary data to publish.
 * @param urlPrefix The Siyuan API URL prefix.
 * @param headers Optional headers.
 */
export async function broadcastPublish(
    channel: string,
    data: { strings?: string[], binaries?: { file: Blob, filename: string }[] },
    urlPrefix: string = '',
    headers?: Record<string, string>
) {
    const url = `${urlPrefix}/api/broadcast/publish`;
    const formData = new FormData();

    if (data.strings)
        data.strings.forEach(s => formData.append(channel, s));

    if (data.binaries)
        data.binaries.forEach(b => formData.append(channel, b.file, b.filename));

    // When sending FormData, we should not set the Content-Type header.
    // The browser will do it automatically with the correct boundary.
    const customHeaders = { ...headers };
    if (customHeaders) {
        delete customHeaders['Content-Type'];
    }

    return requestWithHeaders(url, formData, customHeaders);
}

/**
 * Create a new WebSocket connection to a broadcast channel.
 *
 * @param channel The channel name.
 * @param urlPrefix The Siyuan API URL.
 * @param token Optional authentication token to include in the WebSocket URL.
 * @returns A WebSocket object.
 */
export function newBroadcastWebSocket(channel: string, urlPrefix: string = "ws://localhost:6806", token: string = ''): WebSocket {
    let wsUrl: string = urlPrefix;
    if (urlPrefix)
        wsUrl = wsUrl.replace(/^http/, 'ws');

    let url = `${wsUrl}/ws/broadcast?channel=${channel}`;

    // The standard WebSocket API does not support setting headers directly
    if (token && token !== "SKIP") url += `&token=${token}`;

    return new WebSocket(url);
}

/**
 * Subscribe to a broadcast channel using Server-Sent Events (SSE).
 *
 * @param channels An array of channel names to subscribe to. If empty, subscribes to all channels.
 * @param urlPrefix The Siyuan API URL. Defaults to the current origin or localhost.
 * @param retry Optional retry interval in milliseconds for the connection.
 * @returns An EventSource object connected to the broadcast channel.
 */
export function broadcastSubscribe(channels: string[], urlPrefix: string = '', token: string = '', retry?: number): EventSource {
    let url = `${urlPrefix}/es/broadcast/subscribe`;
    const params: string[] = [];

    if (retry)
        params.push(`retry=${retry}`);

    channels.forEach(channel => {
        params.push(`channel=${encodeURIComponent(channel)}`);
    });

    if (token && token !== "SKIP")
        params.push(`token=${encodeURIComponent(token)}`);

    if (params.length > 0)
        url += `?${params.join('&')}`;

    consoleLog(`Connecting to broadcast channel: ${url}`);

    return new EventSource(url);
}

/**
 * Get information about a broadcast channel.
 *
 * @param name The channel name.
 * @param urlPrefix The Siyuan API URL prefix.
 * @param headers Optional headers.
 * @returns A promise that resolves to a ChannelInfo object containing details about the channel.
 */
export async function getChannelInfo(name: string, urlPrefix: string = '', headers?: Record<string, string>): Promise<ChannelInfo> {
    const payload = {
        name: name
    };
    const url = `${urlPrefix}/api/broadcast/getChannelInfo`;
    return requestWithHeaders(url, payload, headers);
}

// **************************************** System ****************************************

export async function bootProgress(urlPrefix: string = '', headers?: Record<string, string>): Promise<IResBootProgress> {
    return requestWithHeaders(`${urlPrefix}/api/system/bootProgress`, {}, headers);
}

export async function version(urlPrefix: string = '', headers?: Record<string, string>): Promise<string> {
    return requestWithHeaders(`${urlPrefix}/api/system/version`, {}, headers);
}

export async function currentTime(urlPrefix: string = '', headers?: Record<string, string>): Promise<number> {
    return requestWithHeaders(`${urlPrefix}/api/system/currentTime`, {}, headers);
}

export async function getWorkspaceInfo(urlPrefix: string = '', headers?: Record<string, string>): Promise<any> {
    return requestWithHeaders(`${urlPrefix}/api/system/getWorkspaceInfo`, {}, headers);
}

// **************************************** Indexes ****************************************
export async function upsertIndexes(paths: string[], urlPrefix: string = '', headers?: Record<string, string>) {
    let payload = {
        paths: paths
    };
    let url = `${urlPrefix}/api/filetree/upsertIndexes`;
    return requestWithHeaders(url, payload, headers);
}

export async function removeIndexes(paths: string[], urlPrefix: string = '', headers?: Record<string, string>) {
    let payload = {
        paths: paths
    };
    let url = `${urlPrefix}/api/filetree/removeIndexes`;
    return requestWithHeaders(url, payload, headers);
}

export async function refreshFiletree(urlPrefix: string = '', headers?: Record<string, string>) {
    let url = `${urlPrefix}/api/filetree/refreshFiletree`;
    return requestWithHeaders(url, {}, headers);
}

export async function reloadFiletree(urlPrefix: string = '', headers?: Record<string, string>) {
    let url = `${urlPrefix}/api/ui/reloadFiletree`;
    return requestWithHeaders(url, {}, headers);
}

export async function reloadProtyle(id: string, urlPrefix: string = '', headers?: Record<string, string>) {
    let payload = {
        id: id
    };
    let url = `${urlPrefix}/api/ui/reloadProtyle`;
    return requestWithHeaders(url, payload, headers);
}

// **************************************** Snapshots ****************************************
export async function getRepoSnapshots(page: number = 1, urlPrefix: string = '', headers?: Record<string, string>): Promise<IResGetRepoSnapshots> {
    let payload = {
        page: page
    };
    let url = `${urlPrefix}/api/repo/getRepoSnapshots`;
    return requestWithHeaders(url, payload, headers);
}

export async function createSnapshot(title: string, urlPrefix: string = '', headers?: Record<string, string>) {
    let payload = {
        memo: title
    };
    let url = `${urlPrefix}/api/repo/createSnapshot`;
    return requestWithHeaders(url, payload, headers);
}
