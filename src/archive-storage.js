export async function archiveDirectory() {
  if (!navigator.storage?.getDirectory)
    throw Error(
      "This browser cannot create ZIPs on disk. Use a current version of Chrome, Edge, Firefox or Safari.",
    );
  return (await navigator.storage.getDirectory()).getDirectoryHandle(
    "fs-archives",
    { create: true },
  );
}
export async function archiveFile(source) {
  const handle = await (await archiveDirectory()).getFileHandle(source.key);
  return new File([await handle.getFile()], source.name, {
    type: "application/zip",
    lastModified: source.lastModified,
  });
}
export async function removeArchive(source) {
  if (source)
    await (await archiveDirectory()).removeEntry(source.key).catch(() => {});
}
