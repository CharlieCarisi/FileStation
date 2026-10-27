// Treat leading-dot files (for example .env) as names without an extension.
export function splitFileName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1
    ? { stem: name.slice(0, dot), extension: name.slice(dot) }
    : { stem: name, extension: "" };
}
