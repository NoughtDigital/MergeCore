import { shout } from './shout.js';
const { whisper } = require('./whisper.cjs');

function announce(message) {
  return shout(message);
}

function soft(message) {
  return whisper(message);
}

module.exports = { announce, soft };
