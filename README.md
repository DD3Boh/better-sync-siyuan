# Better Sync for SiYuan

Better Sync is a plugin for [SiYuan](https://github.com/siyuan-note/siyuan) that implements a new synchronization system, which allows for a faster sync and a peer to peer style sync between different SiYuan instances.

## Features

- **Peer-to-peer sync**: Sync between two SiYuan instances without needing a third server
- **Sync on startup**: Sync the whole workspace automatically with the remote when opening SiYuan
- **Auto update after changes**: Automatically push the current file to the remote it gets modified
- **Manual sync triggering**: Trigger sync manually when needed with a custom button
- **Faster sync**: Syncs faster when compared to WebDav, especially on the same network
- **Set up as client-server sync**: This plugin can also behave as a regular server, if you host your SiYuan instance on a public website with the docker image, which would be accessible also outside of your home network.
- **Sync conflicts tracking**: The plugin creates Conflict files in case of errors during the sync, when a file has been modified on both machines.
- **Experimental real-time sync**: Utilizes websockets for near-instant synchronization of changes across devices.
- **Automatic data snapshots before sync to avoid data loss**: Creates a snapshot of the data before syncing to prevent data loss.
- **Plugins, themes and assets syncronization**: Syncs not only the notes, but also plugins, themes and assets.

## Basic Setup

0. **Understand the sync model**:
    - Better Sync works in a peer-to-peer model between two SiYuan instances
    - **Host device**: The device where you're installing and configuring the plugin
    - **Remote device**: The other SiYuan instance you want to sync with
    - Synchronization works bidirectionally (both push and pull) between these peers

1. **Install the plugin**:
   - Open SiYuan on the host and navigate to `Settings > Marketplace > Plugins`
   - Search for "Better Sync" and install it

2. **Enable network serving**:
    - Open SiYuan on the remote device and navigate to `Settings > About`
    - Enable the `Network serving` option

3. **Configure sync targets**:
   - Go to the plugin settings on the host by clicking the gear icon next to the plugin
   - Copy the ip address and the API Token from the peer device into the plugin settings
   - The IP address should be written like `http://xxx.xxx.x.xxx:6806`

4. **Customize sync options**:
    - Customize the provided sync options in the plugin menu according to your liking

5. **Other details**:
    - It is recommended to also install and enable the plugin on the remote device to have a more reliable and instant sync when using siyuan on that device

> **Notes** 
> - When using SiYuan on a version prior to `3.1.28`, an Access Code must be set to be able to access the APIs of the device properly, after enabling `Network serving`.
> - When syncing with mobile devices, the server may be unreachable if the application is in background, which would make sync fail. The suggestion in this case would be to install the plugin on the mobile device and sync from there directly.

## Future Features

The following features may be added in future versions of Better Sync:

- [x] **Sync Conflicts Tracking**: Detect and manage sync conflicts between different devices
- [x] **History-Based Protection**: Add files to history before syncing to avoid data loss
- [x] **Sync Locking**: Implement a locking mechanism to prevent multiple devices from syncing simultaneously
- [ ] **Selective File Sync**: Allow users to include or exclude specific files or folders from synchronization
- [ ] **Directional Sync Options**: Add capability to manually sync in push-only or pull-only mode
- [ ] **Sync Status Logging**: Detailed logs of all sync operations for easier troubleshooting and outputing it to a log file on the disk
- [ ] **Support for sync to multiple peers**: Allow syncing from one host to multiple different peers.

## Disclaimer

**USE AT YOUR OWN RISK**: Better Sync is provided "as is" without any warranties. While we strive to ensure reliable operation, you are solely responsible for backing up your SiYuan data before using this plugin.

**DATA LOSS POSSIBILITY**: Synchronization involves complex operations that could potentially lead to data loss or corruption under certain conditions. Always maintain separate backups of your important data.

**PERFORMANCE IMPACT**: Depending on your configuration and data size, synchronization may temporarily affect system performance.

By using Better Sync, you acknowledge these risks and agree not to hold the plugin developers liable for any issues arising from its use.
