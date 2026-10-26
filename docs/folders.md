# Workspace folders

**My files → New folder** creates a folder in the current location. Open folders and use the breadcrumb to return to a parent or **Root**. Each folder's management button lets you rename it or choose a different parent. Folder names can contain spaces and international characters; paths and control characters are rejected. Workspaces support up to 1,000 folders and 20 nested levels.

Use a file's **Move** button, or select files and choose **Move selected files**, to choose a destination folder. Choose **Root** to move files out of a folder. An administrator can move another user's files within that user's folders from **All files**; moving files never changes ownership. A selection must belong to one owner and can include up to 500 visible files. The file list retrieves the latest 500 files in the current folder; shared/admin views remain flat and show each file's folder.

Upload dialogs initially select the folder being browsed. File requests and collaborations also let the inviter select a destination folder. Partners can submit documents without access to the owner's folder tree. Moving a collaboration working copy makes subsequent saves follow its new folder, including a save already in progress. The original document stays in its own location.

Folders organize File Station metadata across all storage connectors. Moving or renaming a folder does not rename provider objects or transfer bytes between connectors. Existing share codes, verification, file IDs, previews, retention dates, quota accounting, and paused transfers continue to work. Retention is still enforced across the entire connector, including every folder. Folder trees are private; sharing an individual file does not expose its parent folder or siblings.

Only empty folders can be deleted. Move out files/subfolders and revoke active requests or collaborations using that destination first. This avoids accidental recursive file deletion or silently rerouting new submissions. Expired/revoked invitations and deleted file records do not block deletion. Account deletion retains the existing provider cleanup process and removes the user's folder metadata afterwards.

Apply migration **0005_workspace_folders.sql** before deploying this feature. Existing files and invitations start at Root without moving storage objects. Database constraints enforce owner boundaries, unique sibling names (SQLite NOCASE), nesting limits, empty deletion and cycle protection even when requests run concurrently.
