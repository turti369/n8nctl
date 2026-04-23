import { describe, it, expect } from 'vitest';
import {
  N8nCtlError,
  AuthError,
  ApiError,
  ValidationError,
  NetworkError,
  ExitCode,
} from '../src/lib/errors.js';

describe('error types', () => {
  it('N8nCtlError holds exit code and hint', () => {
    const err = new N8nCtlError('boom', ExitCode.InternalError, 'try again');
    expect(err.exitCode).toBe(5);
    expect(err.hint).toBe('try again');
    expect(err.name).toBe('N8nCtlError');
  });

  it('AuthError has exit code 2 and default hint', () => {
    const err = new AuthError('no creds');
    expect(err.exitCode).toBe(ExitCode.AuthError);
    expect(err.hint).toContain('auth login');
  });

  it('ApiError carries status and body', () => {
    const err = new ApiError('bad', 500, { detail: 'x' });
    expect(err.exitCode).toBe(ExitCode.ApiError);
    expect(err.status).toBe(500);
    expect(err.body).toEqual({ detail: 'x' });
  });

  it('ValidationError has exit code 3', () => {
    expect(new ValidationError('bad').exitCode).toBe(ExitCode.ValidationError);
  });

  it('NetworkError has exit code 4 and default hint', () => {
    const err = new NetworkError('timeout');
    expect(err.exitCode).toBe(ExitCode.NetworkError);
    expect(err.hint).toContain('N8N_HOST');
  });
});
