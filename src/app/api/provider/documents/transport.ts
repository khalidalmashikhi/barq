import { NextResponse } from "next/server";
import {
  providerDocumentErrorHttpStatus,
  type ProviderDocumentActionResult,
  type UploadProviderDocumentResult,
} from "@/lib/provider/documents/provider-document-errors";

// Gate 0 — shared JSON transport for the provider-document routes. The routes
// stay content-negotiated: the progressive <form> path keeps its 303 redirect;
// the polished auto-upload client sends `Accept: application/json` and gets these
// bodies so it can drive real XHR progress and render precise error states. The
// JSON body carries only the stable machine error CODE — never a storage/DB
// message, objectKey, or stack — mirroring what the DTO layer already guarantees.

// A browser <form> navigation sends `Accept: text/html,...` (no application/json);
// our XHR sets `Accept: application/json` explicitly. `*/*` is NOT treated as
// JSON, so default form posts always take the redirect branch.
export function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

export function jsonUploadResult(result: UploadProviderDocumentResult): NextResponse {
  if (result.ok) return NextResponse.json({ ok: true, documentId: result.documentId }, { status: 200 });
  return NextResponse.json({ ok: false, error: result.error }, { status: providerDocumentErrorHttpStatus(result.error) });
}

export function jsonActionResult(result: ProviderDocumentActionResult): NextResponse {
  if (result.ok) return NextResponse.json({ ok: true }, { status: 200 });
  return NextResponse.json({ ok: false, error: result.error }, { status: providerDocumentErrorHttpStatus(result.error) });
}

export function jsonUnauthenticated(): NextResponse {
  return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
}
