import type { AppError } from "./types";

function isAppError(error: unknown): error is AppError {
  return typeof error === "object" && error !== null && "code" in error && "userMessage" in error;
}

export function toAppError(
  error: unknown,
  fallbackMessage: string,
  fallbackCode = "UNKNOWN"
): AppError {
  if (isAppError(error)) {
    return error.code === "UNKNOWN"
      ? {
          ...error,
          userMessage: fallbackMessage
        }
      : error;
  }

  return {
    code: fallbackCode,
    userMessage: fallbackMessage
  };
}
