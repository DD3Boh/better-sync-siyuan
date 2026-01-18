export class StorageItem {
    path: string;
    parentPath: string | null = null;
    item?: IResReadDir | null;
    files: StorageItem[];

    public get name(): string | undefined {
        return this.item?.name;
    }

    public get timestamp(): number | undefined {
        return this.item?.updated;
    }

    public get isDir(): boolean | undefined {
        return this.item?.isDir;
    }

    public get isSymlink(): boolean | undefined {
        return this.item?.isSymlink;
    }

    public get recursiveTimestamp(): number | undefined {
        let maxTimestamp = this.timestamp;
        for (const child of this.getAllChildren()) {
            if (child.timestamp !== undefined && (maxTimestamp === undefined || child.timestamp > maxTimestamp)) {
                maxTimestamp = child.timestamp;
            }
        }
        return maxTimestamp;
    }

    constructor(path: string, parentPath: string | null = null, item?: IResReadDir | null, files: StorageItem[] = []) {
        if (!path)
            throw new Error("StorageItem path cannot be null or undefined");

        this.path = path;
        this.parentPath = parentPath;
        this.item = item;
        this.files = files;
    }

    addFileFromItem(item: IResReadDir) {
        const filePath = `${this.path}/${item.name}`;
        const storageItem = new StorageItem(filePath, this.path, item);
        this.files.push(storageItem);
    }

    *iterateStorageItem(): Generator<StorageItem> {
        const item = this;
        yield item;
        for (const file of item.files) {
            yield* file.iterateStorageItem();
        }
    }

    /**
     * Returns all child directory items recursively.
     * @returns An array of StorageItem instances that are directories.
     */
    getAllChildDirectories(): StorageItem[] {
        const directories: StorageItem[] = [];
        for (const file of this.files) {
            if (file.isDir) {
                directories.push(file);
                directories.push(...file.getAllChildDirectories());
            }
        }
        return directories;
    }

    /**
     * Returns all child files recursively (excluding directories).
     * @returns An array of StorageItem instances that are files.
     */
    getAllChildFiles(): StorageItem[] {
        const files: StorageItem[] = [];
        for (const file of this.files) {
            if (file.isDir)
                files.push(...file.getAllChildFiles());
            else
                files.push(file);
        }
        return files;
    }

    /**
     * Returns all the child items recursively (both files and directories).
     * @returns An array of StorageItem instances.
     */
    getAllChildren(): StorageItem[] {
        const items: StorageItem[] = [];
        for (const file of this.files) {
            items.push(file);
            if (file.isDir)
                items.push(...file.getAllChildren());
        }
        return items;
    }

    /**
     * Returns a map of all child files with their paths or file names as keys.
     * @param useFileNames Whether to use file names as keys instead of file paths.
     * @returns A map of StorageItem instances where the keys are file names or file paths.
     */
    getFilesMap(useFileNames: boolean = false): Map<string, StorageItem> {
        const fileMap = new Map<string, StorageItem>();
        for (const file of this.files) {
            if (useFileNames)
                fileMap.set(file.name, file);
            else
                fileMap.set(file.path, file);
        }

        return fileMap;
    }

    /**
     * Returns a recursive map of all child files with their paths or file names as keys.
     *
     * @param useFileNames Whether to use file names as keys instead of file paths.
     * @returns A map of StorageItem instances where the keys are file names or paths and the values are StorageItems.
     */
    getFilesMapRecursive(useFileNames: boolean = false): Map<string, StorageItem> {
        const fileMap = new Map<string, StorageItem>();
        for (const file of this.files) {
            if (useFileNames)
                fileMap.set(file.name, file);
            else
                fileMap.set(file.path, file);

            if (file.isDir) {
                for (const [key, value] of file.getFilesMapRecursive(useFileNames)) {
                    fileMap.set(key, value);
                }
            }
        }

        return fileMap;
    }

    /**
     * Takes two StorageItems as input, returns a map of file names or paths to pairs of StorageItems.
     * The pairs are the children of the two StorageItems.
     *
     * @param item1 The first StorageItem
     * @param item2 The second StorageItem
     * @param useFileNames Whether to use file names as keys instead of file paths.
     * @returns A map of StorageItem instances where the keys are file names or paths and the values are pairs of StorageItems.
     */
    static getFilesMapPair(item1: StorageItem, item2: StorageItem, useFileNames: boolean = false): Map<string, [StorageItem, StorageItem]> {
        const fileMap = new Map<string, [StorageItem, StorageItem]>();
        const files1 = item1?.getFilesMap(useFileNames) || new Map<string, StorageItem>();
        const files2 = item2?.getFilesMap(useFileNames) || new Map<string, StorageItem>();

        // Collect unique keys from both maps
        const allKeys = new Set<string>([...files1.keys(), ...files2.keys()]);

        for (const key of allKeys) {
            fileMap.set(key, [files1.get(key), files2.get(key)]);
        }
        return fileMap;
    }

    /**
     * Takes two StorageItems as input, returns a map of file names or paths to pairs of StorageItems.
     * This includes all items recursively.
     *
     * @param item1 The first StorageItem
     * @param item2 The second StorageItem
     * @param useFileNames Whether to use file names as keys instead of file paths.
     * @returns A map of StorageItem instances where the keys are file names or paths and the values are pairs of StorageItems.
     */
    static getFilesMapPairRecursively(item1: StorageItem, item2: StorageItem, useFileNames: boolean = false): Map<string, [StorageItem, StorageItem]> {
        const fileMap = new Map<string, [StorageItem, StorageItem]>();
        const files1 = item1?.getFilesMapRecursive(useFileNames) || new Map<string, StorageItem>();
        const files2 = item2?.getFilesMapRecursive(useFileNames) || new Map<string, StorageItem>();

        // Collect unique keys from both maps
        const allKeys = new Set<string>([...files1.keys(), ...files2.keys()]);

        for (const key of allKeys) {
            fileMap.set(key, [files1.get(key), files2.get(key)]);
        }
        return fileMap;
    }

    /**
     * Takes two StorageItems as input, returns a map of file names or paths to pairs of StorageItems.
     * Only includes items that are files (not directories).
     *
     * @param item1 The first StorageItem
     * @param item2 The second StorageItem
     * @param useFileNames Whether to use file names as keys instead of file paths.
     * @returns A map of StorageItem instances where the keys are file names or paths and the values are pairs of StorageItems (files only).
     */
    static getFilesOnlyMapPair(item1: StorageItem, item2: StorageItem, useFileNames: boolean = false): Map<string, [StorageItem, StorageItem]> {
        const allPairs = StorageItem.getFilesMapPair(item1, item2, useFileNames);
        const fileMap = new Map<string, [StorageItem, StorageItem]>();

        for (const [key, [file1, file2]] of allPairs) {
            // Include if either item exists and is not a directory
            const isFile = (file1 && !file1.isDir) || (file2 && !file2.isDir);
            if (isFile) {
                fileMap.set(key, [file1, file2]);
            }
        }
        return fileMap;
    }

    /**
     * Takes two StorageItems as input, returns a map of file names or paths to pairs of StorageItems.
     * Only includes items that are directories.
     *
     * @param item1 The first StorageItem
     * @param item2 The second StorageItem
     * @param useFileNames Whether to use file names as keys instead of file paths.
     * @returns A map of StorageItem instances where the keys are file names or paths and the values are pairs of StorageItems (directories only).
     */
    static getDirsOnlyMapPair(item1: StorageItem, item2: StorageItem, useFileNames: boolean = false): Map<string, [StorageItem, StorageItem]> {
        const allPairs = StorageItem.getFilesMapPair(item1, item2, useFileNames);
        const dirMap = new Map<string, [StorageItem, StorageItem]>();

        for (const [key, [file1, file2]] of allPairs) {
            // Include if either item exists and is a directory
            const isDir = (file1 && file1.isDir) || (file2 && file2.isDir);
            if (isDir) {
                dirMap.set(key, [file1, file2]);
            }
        }
        return dirMap;
    }

    /**
     * Recursively searches through a StorageItem to find a child
     * matching a given file name or path.
     *
     * @param item The StorageItem to search within (can be null/undefined).
     * @param key The file name or path to search for.
     * @param useFileNames Whether to match by file name instead of full path.
     * @returns The matching StorageItem, or null if not found.
     */
    static findChild(
        item: StorageItem | null | undefined,
        key: string,
        useFileNames: boolean = false
    ): StorageItem | null {
        if (!item) return null;

        for (const child of item.files) {
            const childKey = useFileNames ? child.name : child.path;
            if (childKey === key) {
                return child;
            }

            // Recursively search in subdirectories
            if (child.isDir) {
                const found = StorageItem.findChild(child, key, useFileNames);
                if (found) return found;
            }
        }

        return null;
    }

    /**
     * Recursively searches through two StorageItems to find a pair of children
     * matching a given file name or path.
     *
     * @param item1 The first StorageItem to search within (can be null/undefined).
     * @param item2 The second StorageItem to search within (can be null/undefined).
     * @param key The file name or path to search for.
     * @param useFileNames Whether to match by file name instead of full path.
     * @returns A tuple of [StorageItem | null, StorageItem | null] representing
     *          the matching child from each item, or null if not found in that item.
     */
    static findChildPair(
        item1: StorageItem | null | undefined,
        item2: StorageItem | null | undefined,
        key: string,
        useFileNames: boolean = false
    ): [StorageItem | null, StorageItem | null] {
        return [
            StorageItem.findChild(item1, key, useFileNames),
            StorageItem.findChild(item2, key, useFileNames)
        ];
    }

    /**
     * Creates a StorageItem instance from a plain object.
     * Recursively constructs child StorageItem instances from the files array.
     *
     * @param obj - A plain object with path, parentPath, item, and files properties.
     * @returns A new StorageItem instance with all nested children properly instantiated.
     */
    static fromObject(obj: any): StorageItem {
        if (!obj || !obj.path)
            throw new Error("Invalid object: missing required 'path' property");

        // Recursively create StorageItem instances for all nested files
        const childFiles = (obj.files || []).map((fileObj: any) => StorageItem.fromObject(fileObj));

        return new StorageItem(
            obj.path,
            obj.parentPath || null,
            obj.item || null,
            childFiles
        );
    }

    /**
     * Merges two StorageItem instances with the same path or names into a single StorageItem.
     * Combines their files, ensuring no duplicate file paths.
     * Throws an error if the names of the two items do not match.
     *
     * @param item1 - The first StorageItem to join.
     * @param item2 - The second StorageItem to join.
     * @param useFileNames Whether to use file names as keys instead of file paths.
     * @returns A new StorageItem containing merged files from both items.
     * @throws Error if item1.name !== item2.name.
     */
    static joinItems(item1: StorageItem, item2: StorageItem, useFileNames: boolean = false): StorageItem {
        if (item1?.name !== item2?.name)
            throw new Error("Cannot join StorageItems with different names");

        if (!item1 || !item2)
            return item1 || item2;

        const filesMap = new Map<string, StorageItem>();
        for (const file of [...item1.files || [], ...item2.files || []]) {
            filesMap.set(useFileNames ? file.name : file.path, file);
        }

        return new StorageItem(item1.path, item1.parentPath, item1.item, Array.from(filesMap.values()));
    }
}
