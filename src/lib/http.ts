// API errors carry a code the client translates, plus an English message for anyone calling the API directly

export const apiError = (code: string, error: string, status: number) => Response.json({ code, error }, { status });

/** LiveKit didn't answer. */
export const unreachable = (e: unknown) => {
  console.error('LiveKit:', (e as Error).message);
  return apiError('unreachable', 'The streaming server is unreachable. Try again in a moment.', 503);
};
