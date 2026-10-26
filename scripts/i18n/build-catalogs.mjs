import fs from "node:fs";
const english = JSON.parse(fs.readFileSync("locales/en-CA.json"));
const french = {},
  chinese = {};
let count = 0;
for (const line of fs
  .readFileSync("locales/translations.tsv", "utf8")
  .split("\n")) {
  if (!line) continue;
  const parts = line.split("|");
  if (parts.length !== 3) throw Error("Invalid translation row: " + line);
  const [key, fr, zh] = parts;
  if (!Object.hasOwn(english, key)) throw Error("Unknown message: " + key);
  french[key] = fr;
  chinese[key] = zh;
  count++;
}
const missing = Object.keys(english).filter(
  (key) => !Object.hasOwn(french, key),
);
console.log(
  "Translated",
  Object.keys(french).length,
  "of",
  Object.keys(english).length,
  "messages. Missing:",
  JSON.stringify(missing, null, 2),
);
if (!missing.length) {
  fs.writeFileSync(
    "locales/fr-CA.json",
    JSON.stringify(french, null, 2) + "\n",
  );
  fs.writeFileSync(
    "locales/zh-CN.json",
    JSON.stringify(chinese, null, 2) + "\n",
  );
} else process.exitCode = 1;
