import { ZodError } from 'zod';

/** A problem the person can fix: shown to them as-is, never as a stack trace. */
export class UserError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** A save that would overwrite different data already stored for the same key. */
export class ConflictError extends UserError {
  readonly existing: unknown;
  constructor(message: string, existing: unknown) {
    super(message, 409);
    this.existing = existing;
  }
}

/** The first problem, in plain words. Fixing one at a time is easier than reading a list. */
export function describeZodError(err: ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'Something in that entry is not valid.';
  // Our own messages are full sentences; zod's built-in ones need their field named.
  return /[.?]$/.test(issue.message) ? issue.message : `${issue.path.join(' ') || 'Entry'}: ${issue.message}`;
}
