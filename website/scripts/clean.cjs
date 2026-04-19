const fs = require("fs");
const path = require("path");

const root = process.cwd();

const dirs = [".next", ".next-dev", ".next-webpack", ".next-prod"];

for (const d of dirs) {
  try {
    fs.rmSync(path.join(root, d), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const nmCache = path.join(root, "node_modules", ".cache");
try {
  fs.rmSync(nmCache, { recursive: true, force: true });
} catch {
  /* ignore */
}
