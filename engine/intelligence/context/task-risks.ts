/**
 * Conservative risk *indicators* for task context (engine-side; not vulns).
 */

export interface TaskRiskIndicator {
  readonly id: string;
  readonly label: string;
  readonly evidence: string;
}

const AUTH_RE =
  /\b(auth|authenticate|authorization|permission|acl|rbac|oauth|jwt|passport|session|protected)\b/i;
const PAYMENT_RE =
  /\b(stripe|paypal|braintree|payment|billing|refund|charge|invoice|checkout|webhook)\b/i;
const DB_WRITE_RE =
  /\b(insert|update|delete|upsert|save|create|destroy|truncate|migrate|query\(|execute\(|prisma\.|knex\.|sequelize|typeorm|eloquent)\b/i;
const FS_WRITE_RE =
  /\b(writeFile|appendFile|unlink|rmdir|mkdir|createWriteStream|fs\.write|fwrite|file_put_contents)\b/i;
const NETWORK_RE =
  /\b(fetch\(|axios|http\.|https\.|got\(|request\(|curl_|HttpClient|fetchJson)\b/i;
const ENV_RE = /\b(process\.env|getenv|\$_ENV|dotenv|config\(['"]env)\b/i;
const CRYPTO_RE =
  /\b(crypto\.|createHash|createHmac|bcrypt|scrypt|argon2|encrypt|decrypt|cipher|jwt\.sign)\b/i;

export function detectTaskRiskIndicators(input: {
  readonly blob: string;
  readonly callerCount: number;
  readonly relatedTestCount: number;
}): readonly TaskRiskIndicator[] {
  const out: TaskRiskIndicator[] = [];
  const push = (id: string, label: string, evidence: string): void => {
    if (out.some((r) => r.id === id)) return;
    out.push({ id, label, evidence });
  };
  const blob = input.blob;
  if (AUTH_RE.test(blob)) {
    push('auth', 'Auth / permissions', 'Evidence suggests authentication or authorisation patterns');
  }
  if (PAYMENT_RE.test(blob)) {
    push('payment', 'Payment / billing', 'Evidence suggests payment-provider integration');
  }
  if (DB_WRITE_RE.test(blob)) {
    push('db-write', 'Possible database write', 'Evidence matches persistence write patterns');
  }
  if (FS_WRITE_RE.test(blob)) {
    push('fs-write', 'Possible filesystem write', 'Evidence matches filesystem write APIs');
  }
  if (NETWORK_RE.test(blob)) {
    push('network', 'Network call', 'Evidence matches HTTP/network client patterns');
  }
  if (ENV_RE.test(blob)) {
    push('env', 'Environment access', 'Evidence accesses environment variables');
  }
  if (CRYPTO_RE.test(blob)) {
    push('crypto', 'Cryptography', 'Evidence matches crypto/hashing APIs');
  }
  if (input.callerCount >= 12) {
    push(
      'high-callers',
      'Unusually high caller count',
      `${input.callerCount} callers indexed — change impact may be wide`
    );
  }
  if (input.relatedTestCount === 0) {
    push(
      'no-tests',
      'No related tests found',
      'Index has no related test evidence for the top symbols'
    );
  }
  return out.slice(0, 8);
}
