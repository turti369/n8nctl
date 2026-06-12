export enum ExitCode {
  Success = 0,
  ApiError = 1,
  AuthError = 2,
  ValidationError = 3,
  NetworkError = 4,
  InternalError = 5,
  /**
   * A gate command ran the workflow/request successfully but the stated
   * expectation failed (verify gate, --expect-status). Distinct from infra
   * errors 1-5 so agents can tell "broken pipeline" from "failed assertion".
   */
  AssertionFailed = 6,
}

export class N8nCtlError extends Error {
  readonly exitCode: ExitCode;
  readonly hint?: string;

  constructor(message: string, exitCode: ExitCode, hint?: string) {
    super(message);
    this.name = 'N8nCtlError';
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export class AuthError extends N8nCtlError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.AuthError, hint ?? 'Run `n8nctl auth login` to configure credentials.');
    this.name = 'AuthError';
  }
}

export class ApiError extends N8nCtlError {
  readonly status: number;
  readonly body?: unknown;

  constructor(message: string, status: number, body?: unknown, hint?: string) {
    super(message, ExitCode.ApiError, hint);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export class ValidationError extends N8nCtlError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.ValidationError, hint);
    this.name = 'ValidationError';
  }
}

export class AssertionFailedError extends N8nCtlError {
  constructor(message: string, hint?: string) {
    super(message, ExitCode.AssertionFailed, hint);
    this.name = 'AssertionFailedError';
  }
}

export class NetworkError extends N8nCtlError {
  constructor(message: string, hint?: string) {
    super(
      message,
      ExitCode.NetworkError,
      hint ?? 'Check that N8N_HOST is reachable and your network is up.',
    );
    this.name = 'NetworkError';
  }
}
