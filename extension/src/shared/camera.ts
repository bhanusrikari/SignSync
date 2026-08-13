/**
 * Shared camera-permission diagnostics for the gesture-recognition camera
 * foundation (offscreen document + permission tab). Camera start/stop
 * lifecycle only -- no MediaPipe/gesture logic here.
 */

export type CameraResultStatus =
  | "granted"
  | "denied"
  | "dismissed"
  | "no_camera"
  | "unavailable"
  | "error";

export interface CameraDiagnostics {
  ok: boolean;
  status: CameraResultStatus;
  stage?: "getUserMedia";
  mediaDevicesExists: boolean;
  videoInputCount?: number;
  elapsedMs?: number;
  errorName?: string;
  errorMessage?: string;
  errorConstructorName?: string;
}

export function describeError(error: unknown): {
  errorName?: string;
  errorMessage: string;
  errorConstructorName?: string;
} {
  const errorConstructorName =
    error != null ? Object.getPrototypeOf(error)?.constructor?.name : undefined;
  if (error instanceof DOMException) {
    return { errorName: error.name, errorMessage: error.message, errorConstructorName };
  }
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, errorConstructorName };
  }
  return { errorMessage: String(error), errorConstructorName };
}

/**
 * Buckets a getUserMedia() failure into a status a UI can react to
 * meaningfully, based on the DOMException name Chrome throws. "dismissed"
 * (prompt auto-closed, e.g. from a non-visible context) is distinguished
 * from "denied" (user or site setting explicitly blocked it) because they
 * call for different follow-up actions.
 */
export function classifyCameraError(
  errorName: string | undefined,
  errorMessage: string | undefined,
): CameraResultStatus {
  if (errorName === "NotAllowedError") {
    return errorMessage?.toLowerCase().includes("dismiss") ? "dismissed" : "denied";
  }
  if (errorName === "NotFoundError" || errorName === "OverconstrainedError") return "no_camera";
  if (errorName === "NotReadableError" || errorName === "AbortError") return "unavailable";
  return "error";
}
