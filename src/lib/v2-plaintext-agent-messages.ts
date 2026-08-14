export const V2_PLAINTEXT_AGENT_MESSAGES_ENV = "OPENCODEX_V2_PLAINTEXT_AGENT_MESSAGES";

const V2_COLLABORATION_MESSAGE_TOOLS = new Set([
  "spawn_agent",
  "send_message",
  "followup_task",
]);

export function v2PlaintextAgentMessagesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[V2_PLAINTEXT_AGENT_MESSAGES_ENV];
  if (typeof raw !== "string") return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stripToolGroup(tools: unknown): number {
  if (!Array.isArray(tools)) return 0;

  let stripped = 0;
  for (const tool of tools) {
    if (!isRecord(tool)) continue;

    if (
      tool.type === "function"
      && typeof tool.name === "string"
      && V2_COLLABORATION_MESSAGE_TOOLS.has(tool.name.trim())
    ) {
      const parameters = tool.parameters;
      if (isRecord(parameters)) {
        const properties = parameters.properties;
        if (isRecord(properties)) {
          const message = properties.message;
          if (isRecord(message) && Object.hasOwn(message, "encrypted")) {
            delete message.encrypted;
            stripped += 1;
          }
        }
      }
    }

    if (tool.type === "namespace") stripped += stripToolGroup(tool.tools);
  }
  return stripped;
}

/**
 * CPA-compatible V2 collaboration schema rewrite.
 *
 * Codex may carry collaboration tools in either the top-level `tools` array or
 * `input[].additional_tools[].tools`, with optional nested namespaces. The
 * ChatGPT backend interprets `parameters.properties.message.encrypted` as a
 * request to encrypt the tool argument, which routed providers cannot decrypt.
 * Remove only that annotation for spawn_agent/send_message/followup_task while
 * leaving all unrelated schema metadata untouched.
 */
export function stripV2CollaborationMessageEncryptionInPlace(payload: unknown): number {
  if (!isRecord(payload)) return 0;

  let stripped = stripToolGroup(payload.tools);
  if (!Array.isArray(payload.input)) return stripped;

  for (const item of payload.input) {
    if (!isRecord(item) || item.type !== "additional_tools") continue;
    stripped += stripToolGroup(item.tools);
  }
  return stripped;
}

/** Apply the rewrite only when the experimental env flag is enabled. */
export function applyV2PlaintextAgentMessagesInPlace(payload: unknown): number {
  return v2PlaintextAgentMessagesEnabled()
    ? stripV2CollaborationMessageEncryptionInPlace(payload)
    : 0;
}
