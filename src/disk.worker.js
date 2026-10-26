// Completed chunks are journaled separately from file length: out-of-order writes
// can leave holes, so a large local file is not proof of a completed download.
let disk, journal, metadata, completed;
self.onmessage = async ({ data: message }) => {
  try {
    let result;
    if (message.action === "open") {
      const directory = await navigator.storage.getDirectory();
      const file = await directory.getFileHandle(message.name, {
        create: true,
      });
      if (!file.createSyncAccessHandle)
        throw Error(
          "This browser cannot write resumable downloads to disk. Use the direct browser download.",
        );
      disk = await file.createSyncAccessHandle();
      try {
        const progress = await directory.getFileHandle(
          `${message.name}.progress`,
          { create: true },
        );
        journal = await progress.createSyncAccessHandle();
      } catch (error) {
        disk.close();
        disk = undefined;
        throw error;
      }
      metadata = {
        version: 1,
        fileId: message.fileId,
        size: message.size,
        partSize: message.partSize,
      };
      let saved;
      if (journal.getSize()) {
        try {
          const bytes = new Uint8Array(journal.getSize());
          journal.read(bytes);
          saved = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          /* A torn journal is re-downloaded; never trust holes. */
        }
      }
      const valid =
        saved &&
        Object.entries(metadata).every(
          ([key, value]) => saved[key] === value,
        ) &&
        Array.isArray(saved.completedParts);
      completed = new Set();
      if (valid) {
        for (const part of saved.completedParts) {
          if (
            Number.isInteger(part) &&
            part >= 1 &&
            part <= Math.ceil(metadata.size / metadata.partSize) &&
            Math.min(part * metadata.partSize, metadata.size) <= disk.getSize()
          )
            completed.add(part);
        }
      } else {
        // Migrate a confirmed contiguous prefix from the previous sequential engine.
        const legacy =
          journal.getSize() === 0
            ? Math.min(message.legacyDone || 0, disk.getSize(), metadata.size)
            : 0;
        for (
          let part = 1;
          part <= Math.ceil(metadata.size / metadata.partSize);
          part++
        ) {
          if (Math.min(part * metadata.partSize, metadata.size) <= legacy)
            completed.add(part);
        }
        if (!legacy) disk.truncate(0);
      }
      if (disk.getSize() > metadata.size)
        throw Error("The saved download is invalid. Restart it.");
      persist();
      result = { completedParts: [...completed] };
    } else if (message.action === "write") {
      if (!disk || !journal) throw Error("Download disk is not open.");
      const offset = (message.part - 1) * metadata.partSize;
      const bytes = new Uint8Array(message.data);
      if (
        !Number.isInteger(message.part) ||
        offset < 0 ||
        offset >= metadata.size ||
        bytes.length !== Math.min(metadata.partSize, metadata.size - offset)
      )
        throw Error("Invalid download chunk.");
      if (disk.write(bytes, { at: offset }) !== bytes.length)
        throw Error("Not enough browser disk space for this file.");
      disk.flush();
      completed.add(message.part);
      persist();
      result = bytes.length;
    } else if (message.action === "close") {
      try {
        disk?.flush();
      } finally {
        disk?.close();
        disk = undefined;
        journal?.close();
        journal = undefined;
      }
    }
    self.postMessage({ id: message.id, result });
  } catch (error) {
    self.postMessage({
      id: message.id,
      error:
        error instanceof Error ? error.message : "Browser disk access failed.",
    });
  }
};
function persist() {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ ...metadata, completedParts: [...completed] }),
  );
  if (journal.write(bytes, { at: 0 }) !== bytes.length)
    throw Error("Not enough browser disk space to save download progress.");
  journal.truncate(bytes.length);
  journal.flush();
}
