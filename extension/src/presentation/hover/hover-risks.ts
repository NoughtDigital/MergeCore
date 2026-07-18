/**
 * Conservative, evidence-based risk *indicators* for hover (not confirmed vulns).
 */

export interface RiskIndicator {
  readonly id: string;
  readonly label: string;
  /** Why this indicator fired — evidence snippet, not a verdict. */
  readonly evidence: string;
  readonly kind: 'indicator';
}

const AUTH_RE =
  /\b(auth|authenticate|authorization|permission|acl|rbac|oauth|jwt|passport|session)\b/i;
const PAYMENT_RE =
  /\b(stripe|paypal|braintree|payment|billing|refund|charge|invoice|checkout|webhook)\b/i;
const DB_WRITE_RE =
  /\b(insert|update|delete|upsert|save|create|destroy|truncate|migrate|query\(|execute\(|prisma\.|knex\.|sequelize|typeorm|eloquent)\b/i;
const FS_WRITE_RE =
  /\b(writeFile|appendFile|unlink|rmdir|mkdir|createWriteStream|fs\.write|fwrite|file_put_contents)\b/i;
const NETWORK_RE =
  /\b(fetch\(|axios|http\.|https\.|got\(|request\(|curl_|HttpClient|fetchJson)\b/i;
const ENV_RE = /\b(process\.env|getenv|$_ENV|dotenv|config\(['"]env)\b/i;
const CRYPTO_RE =
  /\b(crypto\.|createHash|createHmac|bcrypt|scrypt|argon2|encrypt|decrypt|cipher|jwt\.sign)\b/i;
const TENANT_RE =
  /\b(tenant|multi-?tenant|organisation|organization|workspaceId|accountId|permission|authorize|can\()\b/i;

export function detectRiskIndicators(input: {
  readonly symbolName: string;
  readonly filePath: string;
  readonly codeSample?: string;
  readonly importSpecifiers?: readonly string[];
  readonly callerCount: number;
  readonly relatedTestCount: number;
}): readonly RiskIndicator[] {
  const out: RiskIndicator[] = [];
  const blob = [
    input.symbolName,
    input.filePath,
    input.codeSample ?? '',
    ...(input.importSpecifiers ?? []),
  ].join('\n');

  const push = (id: string, label: string, evidence: string): void => {
    if (out.some((r) => r.id === id)) return;
    out.push({ id, label, evidence, kind: 'indicator' });
  };

  if (AUTH_RE.test(blob)) {
    push('auth', 'Auth / permissions', 'Name or imports suggest authentication or authorisation');
  }
  if (PAYMENT_RE.test(blob)) {
    push('payment', 'Payment / billing', 'Name or imports suggest payment-provider integration');
  }
  if (DB_WRITE_RE.test(blob)) {
    push('db-write', 'Possible database write', 'Code/text matches common persistence write patterns');
  }
  if (FS_WRITE_RE.test(blob)) {
    push('fs-write', 'Possible filesystem write', 'Code matches filesystem write APIs');
  }
  if (NETWORK_RE.test(blob)) {
    push('network', 'Network call', 'Code matches HTTP/network client patterns');
  }
  if (ENV_RE.test(blob)) {
    push('env', 'Environment access', 'Code accesses environment variables');
  }
  if (CRYPTO_RE.test(blob)) {
    push('crypto', 'Cryptography', 'Code matches crypto/hashing APIs');
  }
  if (TENANT_RE.test(blob)) {
    push('tenant', 'Tenant / permission check', 'Name suggests tenancy or permission gating');
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
      'Index has no likelyTestCoverage / related test evidence for this symbol'
    );
  }

  return out.slice(0, 6);
}
