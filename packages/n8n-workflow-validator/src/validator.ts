import { loadCatalog } from './catalog.js';
import type {
  ValidationIssue,
  ValidationResult,
  ValidateOptions,
  Workflow,
  WorkflowNode,
  NodeSchema,
  ParamType,
  Severity,
} from './types.js';

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'Bearer token', re: /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/ },
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS session token', re: /ASIA[0-9A-Z]{16}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Slack token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'GitHub PAT (classic)', re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'GitHub OAuth token', re: /gho_[A-Za-z0-9]{36}/ },
  { name: 'GitHub user-to-server', re: /ghu_[A-Za-z0-9]{36}/ },
  { name: 'GitHub server-to-server', re: /ghs_[A-Za-z0-9]{36}/ },
  { name: 'GitHub refresh token', re: /ghr_[A-Za-z0-9]{36}/ },
  { name: 'Stripe live secret key', re: /sk_live_[A-Za-z0-9]{24,}/ },
  { name: 'Stripe live restricted key', re: /rk_live_[A-Za-z0-9]{24,}/ },
  { name: 'OpenAI API key', re: /sk-(proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{32,}/ },
  { name: 'PEM private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  { name: 'SSH private key header', re: /-----BEGIN OPENSSH PRIVATE KEY-----/ },
  {
    name: 'Generic api_key=',
    re: /["']?(api[_-]?key|apikey|secret|password|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i,
  },
];

export function validate(
  workflow: unknown,
  options: ValidateOptions = {},
): ValidationResult {
  const catalog = options.catalog ?? loadCatalog();
  const issues: ValidationIssue[] = [];
  const push = (severity: Severity, code: string, msg: string) =>
    issues.push({ severity, code, msg });

  // Layer 1: Structural schema
  if (typeof workflow !== 'object' || workflow === null) {
    push('CRITICAL', 'E001', 'Workflow is not a JSON object');
    return { valid: false, issues, nodeCount: 0 };
  }

  const wf = workflow as Workflow;
  if (!Array.isArray(wf.nodes)) push('CRITICAL', 'E002', 'Missing or invalid "nodes" array');
  if (typeof wf.connections !== 'object' || wf.connections === null) {
    push('CRITICAL', 'E003', 'Missing or invalid "connections" object');
  }
  if (typeof wf.name !== 'string' || !wf.name.trim()) {
    push('HIGH', 'E004', 'Workflow must have non-empty "name"');
  }

  if (issues.some((i) => i.severity === 'CRITICAL')) {
    return { valid: false, issues, nodeCount: wf.nodes?.length ?? 0 };
  }

  const nodes = wf.nodes as WorkflowNode[];
  const nodeNames = new Set<string>();
  const nodeIds = new Set<string>();

  // Layer 5: Node sanity
  nodes.forEach((node, idx) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      push('HIGH', 'E009', `nodes[${idx}] must be an object, got ${node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node}`);
      return;
    }
    const tag = `nodes[${idx}]${node.name ? ` "${node.name}"` : ''}`;
    if (!node.id || typeof node.id !== 'string') push('HIGH', 'E010', `${tag} missing string "id"`);
    else if (nodeIds.has(node.id)) push('HIGH', 'E011', `${tag} duplicate id "${node.id}"`);
    else nodeIds.add(node.id);

    if (!node.name || typeof node.name !== 'string') push('HIGH', 'E012', `${tag} missing string "name"`);
    else if (nodeNames.has(node.name)) push('HIGH', 'E013', `${tag} duplicate name "${node.name}"`);
    else nodeNames.add(node.name);

    if (!node.type || typeof node.type !== 'string') push('HIGH', 'E014', `${tag} missing string "type"`);
    else if (!/^n8n-nodes-(base|langchain)\.|^@/.test(node.type)) {
      push('MEDIUM', 'E015', `${tag} unusual type "${node.type}" — verify against n8n node catalog`);
    }

    if (typeof node.typeVersion !== 'number')
      push('HIGH', 'E016', `${tag} "typeVersion" must be number, got ${typeof node.typeVersion}`);

    if (
      !Array.isArray(node.position) ||
      node.position.length !== 2 ||
      typeof node.position[0] !== 'number' ||
      typeof node.position[1] !== 'number'
    ) {
      push('HIGH', 'E017', `${tag} "position" must be [x, y] number array`);
    }

    if (typeof node.parameters !== 'object' || node.parameters === null) {
      push('HIGH', 'E018', `${tag} missing "parameters" object`);
    }
  });

  // Layer 2: Referential integrity — connections
  const connections = wf.connections as Record<string, unknown>;
  Object.entries(connections ?? {}).forEach(([sourceName, sourceConn]) => {
    if (!nodeNames.has(sourceName)) {
      push('HIGH', 'E020', `connections["${sourceName}"] references non-existent node`);
      return;
    }
    if (typeof sourceConn !== 'object' || sourceConn === null) {
      push('HIGH', 'E021', `connections["${sourceName}"] must be object`);
      return;
    }
    Object.entries(sourceConn as Record<string, unknown>).forEach(([outputType, outputs]) => {
      if (!Array.isArray(outputs)) {
        push('HIGH', 'E022', `connections["${sourceName}"].${outputType} must be array`);
        return;
      }
      outputs.forEach((group, gi) => {
        if (!Array.isArray(group)) {
          push('HIGH', 'E023', `connections["${sourceName}"].${outputType}[${gi}] must be array`);
          return;
        }
        group.forEach((link: unknown, li: number) => {
          if (!link || typeof link !== 'object') {
            push('HIGH', 'E024', `connections["${sourceName}"].${outputType}[${gi}][${li}] must be object`);
            return;
          }
          const l = link as { node?: string; index?: unknown; type?: unknown };
          if (!l.node || !nodeNames.has(l.node)) {
            push('HIGH', 'E025', `connections["${sourceName}"] → "${l.node}" target not found`);
          }
          if (typeof l.index !== 'number') {
            push('MEDIUM', 'E026', `connections["${sourceName}"][${gi}][${li}] missing numeric "index"`);
          }
          if (typeof l.type !== 'string') {
            push('MEDIUM', 'E027', `connections["${sourceName}"][${gi}][${li}] missing "type"`);
          }
        });
      });
    });
  });

  // Orphan detection
  const referenced = new Set<string>();
  Object.values(connections ?? {}).forEach((src: unknown) => {
    if (typeof src !== 'object' || src === null) return;
    Object.values(src as Record<string, unknown>).forEach((outputs: unknown) => {
      if (!Array.isArray(outputs)) return;
      outputs.forEach((group: unknown) => {
        if (!Array.isArray(group)) return;
        group.forEach((link: unknown) => {
          if (link && typeof link === 'object') {
            const node = (link as { node?: string }).node;
            if (node) referenced.add(node);
          }
        });
      });
    });
  });

  const triggerLike = /trigger|webhook|schedule|cron|manual|start/i;
  nodes.forEach((node) => {
    if (node === null || typeof node !== 'object') return;
    const name = node.name as string | undefined;
    if (!name) return;
    if (!referenced.has(name) && !triggerLike.test(node.type ?? '')) {
      const outgoing = (connections?.[name] as Record<string, unknown> | undefined);
      if (!outgoing || Object.keys(outgoing).length === 0) {
        push('MEDIUM', 'E030', `node "${name}" is orphaned (no incoming or outgoing connections)`);
      }
    }
  });

  // Layer 3: Expression syntax — walk only string values
  let exprOpen = 0,
    exprClose = 0;
  const walkStrings = (v: unknown): void => {
    if (typeof v === 'string') {
      exprOpen += (v.match(/\{\{/g) ?? []).length;
      exprClose += (v.match(/\}\}/g) ?? []).length;
    } else if (Array.isArray(v)) v.forEach(walkStrings);
    else if (v && typeof v === 'object') Object.values(v).forEach(walkStrings);
  };
  walkStrings(workflow);
  if (exprOpen !== exprClose) {
    push('HIGH', 'E040', `expression braces unbalanced: ${exprOpen} "{{" vs ${exprClose} "}}"`);
  }

  // Layer 4: Secret leakage
  const raw = JSON.stringify(workflow);
  for (const pat of SECRET_PATTERNS) {
    const m = raw.match(pat.re);
    if (m) push('CRITICAL', 'E050', `hardcoded ${pat.name} detected: ${m[0].slice(0, 30)}...`);
  }

  // Layer 6: Node parameter type check
  if (catalog?.nodes) {
    nodes.forEach((node, idx) => {
      if (node === null || typeof node !== 'object') return;
      const tag = `nodes[${idx}] "${node.name ?? '?'}" (${node.type ?? '?'})`;
      const schema: NodeSchema | undefined = catalog.nodes[node.type ?? ''];
      if (!schema) return;

      if (
        Array.isArray(schema.typeVersion) &&
        typeof node.typeVersion === 'number' &&
        !schema.typeVersion.includes(node.typeVersion)
      ) {
        push(
          'MEDIUM',
          'E060',
          `${tag} typeVersion ${node.typeVersion} not in catalog (known: ${schema.typeVersion.join(', ')})`,
        );
      }

      const params = (node.parameters ?? {}) as Record<string, unknown>;

      Object.entries(schema.required ?? {}).forEach(([field, expectedType]) => {
        if (!(field in params)) {
          push('HIGH', 'E061', `${tag} missing required parameter "${field}" (expected ${expectedType})`);
          return;
        }
        const value = params[field];
        if (isExpression(value)) return;
        if (!checkType(value, expectedType)) {
          push(
            'HIGH',
            'E062',
            `${tag} parameter "${field}" expected ${expectedType}, got ${actualType(value)}`,
          );
        }
      });

      Object.entries(schema.optional ?? {}).forEach(([field, expectedType]) => {
        if (!(field in params)) return;
        const value = params[field];
        if (isExpression(value)) return;
        if (!checkType(value, expectedType)) {
          push(
            'MEDIUM',
            'E063',
            `${tag} parameter "${field}" expected ${expectedType}, got ${actualType(value)}`,
          );
        }
      });

      Object.entries(schema.enums ?? {}).forEach(([field, allowed]) => {
        if (!(field in params)) return;
        const value = params[field];
        if (isExpression(value)) return;
        if (typeof value === 'string' && !allowed.includes(value)) {
          push(
            'MEDIUM',
            'E064',
            `${tag} parameter "${field}" value "${value}" not in allowed: [${allowed.join(', ')}]`,
          );
        }
      });
    });
  }

  const blocking = issues.some(
    (i) => i.severity === 'CRITICAL' || i.severity === 'HIGH' || (options.strict && i.severity === 'MEDIUM'),
  );

  return { valid: !blocking, issues, nodeCount: nodes.length };
}

function isExpression(value: unknown): boolean {
  return typeof value === 'string' && /^=/.test(value);
}

function checkType(value: unknown, expected: ParamType): boolean {
  if (expected === 'any') return true;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object')
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === expected;
}

function actualType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}
