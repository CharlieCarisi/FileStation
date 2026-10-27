# Workspace folders

**Private files → New folder** or **Public files → New folder** creates a folder in the current location. Open folders and use the breadcrumb to return to a parent or **Root**. Each folder's management button lets you rename it or choose a different parent. Folder names can contain spaces and international characters; paths and control characters are rejected. Each personal workspace and the shared Public workspace support up to 1,000 folders and 20 nested levels.

Use a file's **Move** button, or select files and choose **Move selected files**, to choose a destination folder. Choose **Root** to move files out of a folder. An administrator can move another user's files within that user's folders from **All files**; moving files never changes ownership. A selection can include up to 500 visible files. Files from different uploaders can be organized together within Public. A move to Private must contain files belonging to one owner. The file list retrieves the latest 500 files in the current folder; shared/admin views remain flat and show each file's folder.

Upload dialogs initially select the folder being browsed. File requests and collaborations also let the inviter select a destination folder. Partners can submit documents without access to the owner's folder tree. Moving a collaboration working copy makes subsequent saves follow its new folder, including a save already in progress. The original document stays in its own location.

Folders organize File Station metadata across all storage connectors. Moving or renaming a folder does not rename provider objects or transfer bytes between connectors. Existing share codes, verification, file IDs, previews, retention dates, quota accounting, and paused transfers continue to work. Retention is still enforced across the entire connector, including every folder. Personal folder trees are private; sharing an individual file does not expose its parent folder or siblings. Public folders are visible to all approved members.

Only empty folders can be deleted. Move out files/subfolders and revoke active requests or collaborations using that destination first. This avoids accidental recursive file deletion or silently rerouting new submissions. Expired/revoked invitations and deleted file records do not block deletion. Account deletion retains the existing provider cleanup process and removes the user's folder metadata afterwards.

Apply migration **0005_workspace_folders.sql** before deploying this feature. Existing files and invitations start at Root without moving storage objects. Database constraints enforce owner boundaries, unique sibling names (SQLite NOCASE), nesting limits, empty deletion and cycle protection even when requests run concurrently.

## Private and Public

Every approved account has a personal **Private files** space and access to the same **Public files** space. Private content is accessible to its owner and administrators, with existing explicit share/invitation access preserved. Public content can be viewed, previewed, downloaded, uploaded, organized and shared by every approved signed-in member. Pending, inactive and anonymous visitors do not receive team access; external partners continue using email-verified invitations and individual share codes.

Use **Move → Workspace → Public** to publish personal files to the team, choosing a Public folder or Root. Only the uploader or an administrator can delete a file or move it back to its original owner's Private workspace. Other members can move it among Public folders. The uploader remains recorded even when a colleague organizes or shares the file. Members can manage the shares they create; the uploader and administrators can also manage every share for that file.

Both upload and invitation dialogs include a workspace selector. External uploads inherit the invitation's workspace and folder; guests cannot choose another destination. Existing share links and invitations remain valid when a file changes workspace. Revoke unwanted links explicitly. A collaboration working copy moved to Private stays there on subsequent saves, including an upload already in flight.

Folders stay within their workspace; create a destination folder and move its files to migrate content between spaces. Deleting an account removes its Private files/folders and unfinished uploads. Completed Public files and Public folders remain available to the team, and administrators can manage files whose uploader has been deleted. That account's invitations are revoked. Connector retention and capacity limits apply across both spaces.

Migration **0006_public_workspace.sql** adds the shared space. Every existing file, folder and invitation defaults to Private; nothing is automatically published and no provider objects are moved. Shared folder names are unique within a parent across all uploaders. Database guards reject cross-workspace folder references. API file lists remove provider upload URLs and object locators for other members' Public files; upload-part and cancellation access remains with the uploader and administrators.

## Renaming files

Use a completed file's **Rename** action to change its name. The dialog keeps the extension fixed so previews and online editing continue using the same format. Owners and administrators can rename Private files; approved members can also rename Public files as part of organizing the shared space. Uploads and unpublished collaboration saves must finish before they can be renamed. Expired and deleted files cannot be renamed.

Renaming preserves the file ID, folder, workspace, owner, storage object, share codes, creation date and retention expiry. Existing recipients download the new filename through the same links. Renaming a collaboration working copy also updates its target filename; later saves and re-uploads keep that name, including an edit uploaded before the rename. Renaming the original source leaves separately named collaboration copies alone. A stale dialog reports a conflict instead of overwriting a more recent rename.
