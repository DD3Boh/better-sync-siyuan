# Changelog

## 1.4.0

- Fix a bug with files being accidentally deleted when two remotes sync to the same third remote, under some conditions
- Rework how last sync time is handled, creating a new sync history
- Avoid syncing files in a directory when the directory has been deleted
- Add flashcards to sync targets
- Add an option to replace the default SiYuan sync menu
- Reduce the number of API calls during the directory scanning process
- Refactor the sync code fully

## 1.3.2

- Fix deletions of directories
- Use SiYuan's fetch post for API calls
- Avoid attempting the appId retrieval if websocket is disabled
- Misc improvements and refactorings

## 1.3.1

- Make the breadcrumb sync icon more interactive, showing the status of the sync process
- Fix document refresh when databases are modified
- Fix unmotivated conflicts
- Fix locks not being released correctly in some contexts
- Fix remote protyles not reloading correctly
- Track current document changes more reliably for instant sync
- Other bug fixes and performance improvements

## 1.3.0

- Implement experimental websockets support for near-instant, real-time synchronization
- Use websockets to retrieve the remote's file list more easily and faster
- Sync filetree operations like creation, renaming, and deletion across devices instantly
- Automatically refresh open notes when they are updated by a sync
- Re-brand "Auto Sync Current File" to "Instant Sync" for clarity
- Make the debounce time for instant note contents syncing configurable
- Improve handling of notebook configuration synchronization
- Improve the locking mechanism reliability and speed
- Automatically ignore lock files older than 5 minutes, in case a lock file hasn't been deleted by mistake
- Scan assets for updates as well. Fixes issues with some plugins that use assets and modify them (like Excalidraw)
- Allow moving the sync status button to the top breadcrumb bar for better visibility (especially on mobile)
- Numerous bug fixes and performance improvements

## 1.2.0

- Implement sync locking to prevent multiple syncs to happen at the same time
- Implement automatic data snapshots before sync happens, to allow resets if something breaks
- Allow the user to choose how frequently data snapshots are made
- Refactor the code heavily making it easier to read

## 1.1.1

- Fix fetch function not binding to the window, causing issues all around

## 1.1.0

- Add a method to track sync conflicts
- Allow using a nickname for the remote
- Show the user how long the sync process took
- Reload the filetree properly after changes
- Use proper translations for all user facing strings

## 1.0.1

- Add preference to sync before closing SiYuan
- Sync themes and plugin settings for newly added plugins
- Sync enabled plugins list when empty (for example on the very first sync on a new device)
- Fix a crash when deleting a plugin and syncing

## 1.0.0

- Initial release.
