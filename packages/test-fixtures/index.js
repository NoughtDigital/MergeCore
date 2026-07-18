const path = require('path');

/** Absolute path to the TypeScript mini fixture repository. */
const typescriptMiniRoot = path.join(__dirname, 'typescript-mini');

/** Absolute path to the JavaScript mini fixture repository. */
const javascriptMiniRoot = path.join(__dirname, 'javascript-mini');

/** Absolute path to the TypeScript code-graph fixture repository. */
const typescriptGraphRoot = path.join(__dirname, 'typescript-graph');

module.exports = {
  typescriptMiniRoot,
  javascriptMiniRoot,
  typescriptGraphRoot,
};
