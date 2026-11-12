// One error type for everything the caller did wrong. The HTTP layer turns it into
// { "error": { "code", "message" } } with the right status. Anything else is a server fault and is
// reported as a plain 500 with no detail, so internals never leak into a response.
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
