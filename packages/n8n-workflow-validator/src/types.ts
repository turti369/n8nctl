export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  msg: string;
  /** true when `n8nctl workflow normalize` can fix this mechanically. */
  fixable?: boolean;
}

/**
 * Severity policy profile: which severities BLOCK (valid=false).
 *   dev = CRITICAL only · ci = CRITICAL+HIGH (default) · strict = +MEDIUM.
 */
export type ValidationProfile = 'dev' | 'ci' | 'strict';

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  nodeCount: number;
}

export interface NodeSchema {
  typeVersion: number[];
  required: Record<string, ParamType>;
  optional: Record<string, ParamType>;
  enums?: Record<string, string[]>;
  conditionalRequired?: Record<string, { when: Record<string, unknown>; type: ParamType }>;
}

export type ParamType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';

export interface NodeCatalog {
  _meta?: {
    version: string;
    generated: string;
    description: string;
    type_values: ParamType[];
    notes: string;
  };
  nodes: Record<string, NodeSchema>;
}

export interface Workflow {
  name?: string;
  nodes?: WorkflowNode[];
  connections?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkflowNode {
  id?: string;
  name?: string;
  type?: string;
  typeVersion?: number;
  position?: [number, number];
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ValidateOptions {
  catalog?: NodeCatalog | null;
  /** Back-compat alias of profile 'strict'. */
  strict?: boolean;
  /** Severity policy profile (default 'ci'). Takes precedence over `strict`. */
  profile?: ValidationProfile;
}
