export class StorageItem {
    path: string;
    parentPath: string | null = null;
    item: IResReadDir
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

    constructor(path: string, parentPath: string | null = null, item?: IResReadDir | null, files: StorageItem[] = []) {
        if (!path)
            throw new Error("StorageItem path cannot be null or undefined");

        this.path = path;
        this.parentPath = parentPath;
        this.item = item ?? {} as IResReadDir;
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
     * Merges two StorageItem instances with the same path into a single StorageItem.
     * Combines their files, ensuring no duplicate file paths.
     * Throws an error if the paths of the two items do not match.
     *
     * @param item1 - The first StorageItem to join.
     * @param item2 - The second StorageItem to join.
     * @returns A new StorageItem containing merged files from both items.
     * @throws Error if item1.path !== item2.path.
     */
    static joinItems(item1: StorageItem, item2: StorageItem): StorageItem {
        if (item1?.path !== item2?.path)
            throw new Error("Cannot join StorageItems with different paths");

        if (!item1 || !item2)
            return item1 || item2;

        const filesMap = new Map<string, StorageItem>();
        for (const file of [...item1.files || [], ...item2.files || []]) {
            filesMap.set(file.path, file);
        }

        return new StorageItem(item1.path, item1.parentPath, item1.item, Array.from(filesMap.values()));
    }
}
