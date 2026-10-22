(function () {
  "use strict";
  let e;
  const r = self;
  r.onmessage = async (i) => {
    const t = i.data;
    try {
      let s;
      if (t.action === "open") {
        const a = await (
          await navigator.storage.getDirectory()
        ).getFileHandle(t.name, { create: !0 });
        if (!a.createSyncAccessHandle)
          throw new Error(
            "This browser cannot write resumable downloads to disk. Use the direct browser download.",
          );
        ((e = await a.createSyncAccessHandle()), (s = e.getSize()));
      } else if (t.action === "write") {
        if (!e) throw new Error("Download disk is not open.");
        const o = new Uint8Array(t.data);
        if (((s = e.write(o, { at: t.offset })), e.flush(), s !== o.length))
          throw new Error("Not enough browser disk space for this file.");
      } else t.action === "close" && (e?.flush(), e?.close(), (e = void 0));
      r.postMessage({ id: t.id, result: s });
    } catch (s) {
      r.postMessage({
        id: t.id,
        error: s instanceof Error ? s.message : "Browser disk access failed.",
      });
    }
  };
})();
