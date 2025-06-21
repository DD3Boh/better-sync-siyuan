# Changelog

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
