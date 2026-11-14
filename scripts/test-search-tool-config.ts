import strictAssert from "node:assert/strict";
import {
  buildSearchRequest,
  executeAntigravitySearch,
  SEARCH_MODEL_FALLBACKS,
} from "../src/search/index.js";

/** Cover tool-circulation config on every fallback model and the safe diagnostic. */
async function main() {
  for (const model of SEARCH_MODEL_FALLBACKS) {
    for (const urls of [undefined, ["https://www.python.org/downloads/"]]) {
      const payload = buildSearchRequest({ query: "Python release", urls }, model, "test-project");
      const request = payload.request as {
        toolConfig?: { includeServerSideToolInvocations?: boolean; functionCallingConfig?: { mode?: string } };
        tools?: unknown;
      };
      strictAssert.equal(request.toolConfig?.includeServerSideToolInvocations, true);
      strictAssert.equal(request.toolConfig?.functionCallingConfig?.mode, "VALIDATED");
      strictAssert.deepEqual(
        request.tools,
        urls ? [{ googleSearch: {} }, { urlContext: {} }] : [{ googleSearch: {} }],
      );
      strictAssert.equal(payload.model, model);
      strictAssert.equal(payload.project, "test-project");
    }
  }

  const originalFetch = globalThis.fetch;
  try {
    // Missing-flag rejection exposes only the allowlisted outgoing configuration.
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message:
              "Please enable tool_config.include_server_side_tool_invocations to use Built-in tools with Function calling.",
          },
        }),
        { status: 400 },
      );
    await strictAssert.rejects(
      executeAntigravitySearch({
        apiKey: JSON.stringify({ token: "private-test-token", projectId: "private-test-project" }),
        query: "private-test-query",
        instruction: "private-test-instruction",
        urls: ["https://example.com/private-test-url"],
      }),
      (error: Error) => {
        const marker = "Outgoing request configuration: ";
        strictAssert.ok(error.message.includes(marker));
        const diagnostic = JSON.parse(error.message.split(marker)[1] ?? "{}");
        strictAssert.equal(diagnostic.diagnosticVersion, "search-tool-config-v1");
        strictAssert.deepEqual(diagnostic.toolTypes, ["googleSearch", "urlContext"]);
        strictAssert.equal(diagnostic.toolConfig.includeServerSideToolInvocations, true);
        strictAssert.equal(diagnostic.toolConfig.functionCallingConfig.mode, "VALIDATED");
        strictAssert.doesNotMatch(error.message, /private-test-|Authorization|Bearer/);
        return true;
      },
    );

    // The executor serializes the flag and parses a successful response.
    let calls = 0;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      strictAssert.equal(payload.request.toolConfig?.includeServerSideToolInvocations, true);
      strictAssert.equal(payload.request.toolConfig.functionCallingConfig.mode, "VALIDATED");
      return new Response(
        JSON.stringify({
          response: {
            candidates: [
              {
                content: {
                  parts: [{ text: "## Findings\nMock evidence.\n## Gaps\nNone.\n## Next checks\nVerify." }],
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    const result = await executeAntigravitySearch({
      apiKey: JSON.stringify({ token: "test-token", projectId: "test-project" }),
      query: "Python release",
    });
    strictAssert.match(String(result), /Mock evidence/);
    strictAssert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("search-tool-config tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
