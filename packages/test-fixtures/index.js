const path = require('path');

/** Absolute path to the TypeScript mini fixture repository. */
const typescriptMiniRoot = path.join(__dirname, 'typescript-mini');

/** Absolute path to the JavaScript mini fixture repository. */
const javascriptMiniRoot = path.join(__dirname, 'javascript-mini');

/** Absolute path to the TypeScript code-graph fixture repository. */
const typescriptGraphRoot = path.join(__dirname, 'typescript-graph');

/** Absolute path to the billing/refund retrieval eval fixture. */
const billingRefundEvalRoot = path.join(__dirname, 'billing-refund-eval');

/** Absolute path to the PHP / Laravel mini fixture repository. */
const phpMiniRoot = path.join(__dirname, 'php-mini');

module.exports = {
  typescriptMiniRoot,
  javascriptMiniRoot,
  typescriptGraphRoot,
  billingRefundEvalRoot,
  phpMiniRoot,
};
