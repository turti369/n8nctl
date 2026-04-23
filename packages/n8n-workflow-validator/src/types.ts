export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  msg: string;
}

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
  strict?: boolean;
}
