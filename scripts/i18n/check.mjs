import fs from "node:fs";
import { parse } from "@babel/parser";
const english = JSON.parse(fs.readFileSync("locales/en-CA.json", "utf8"));
const missing = [];
for (const file of fs
  .readdirSync("src")
  .filter((file) => /\.(jsx?|tsx?)$/.test(file))) {
  const ast = parse(fs.readFileSync(`src/${file}`, "utf8"), {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "t" &&
      node.arguments[0]?.type === "StringLiteral"
    ) {
      const key = node.arguments[0].value.replace(/\s+/g, " ").trim();
      if (!Object.hasOwn(english, key)) missing.push(`${file}: ${key}`);
    }
    for (const value of Object.values(node))
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
}
for (const locale of ["fr-CA", "zh-CN"]) {
  const catalog = JSON.parse(fs.readFileSync(`locales/${locale}.json`, "utf8"));
  for (const key of Object.keys(english))
    if (!Object.hasOwn(catalog, key)) missing.push(`${locale}: ${key}`);
}
if (missing.length) {
  process.stderr.write(missing.join("\n") + "\n");
  process.exitCode = 1;
} else
  process.stdout.write(
    `All static UI messages and ${Object.keys(english).length} catalog entries are translated.\n`,
  );
