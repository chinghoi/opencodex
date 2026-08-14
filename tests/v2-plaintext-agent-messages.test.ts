import { afterEach, describe, expect, test } from "bun:test";
import {
  sanitizeEncryptedContentInPlace,
  stripV2CollaborationMessageEncryptionInPlace,
  V2_PLAINTEXT_AGENT_MESSAGES_ENV,
  v2PlaintextAgentMessagesEnabled,
} from "../src/server/responses/encrypted-payload";

const savedFlag = process.env[V2_PLAINTEXT_AGENT_MESSAGES_ENV];

afterEach(() => {
  if (savedFlag === undefined) delete process.env[V2_PLAINTEXT_AGENT_MESSAGES_ENV];
  else process.env[V2_PLAINTEXT_AGENT_MESSAGES_ENV] = savedFlag;
});

function collaborationInput(): any[] {
  return [
    {
      type: "additional_tools",
      role: "developer",
      tools: [
        {
          type: "namespace",
          name: "collaboration",
          tools: [
            {
              type: "function",
              name: "spawn_agent",
              parameters: {
                type: "object",
                properties: {
                  message: { type: "string", encrypted: true },
                  data: { type: "string", encrypted: "keep-me" },
                },
              },
            },
            {
              type: "function",
              name: "send_message",
              parameters: {
                type: "object",
                properties: { message: { type: "string", encrypted: true } },
              },
            },
            {
              type: "function",
              name: "followup_task",
              parameters: {
                type: "object",
                properties: { message: { type: "string", encrypted: true } },
              },
            },
            {
              type: "function",
              name: "unrelated_tool",
              parameters: {
                type: "object",
                properties: { message: { type: "string", encrypted: true } },
              },
            },
          ],
        },
        {
          type: "namespace",
          name: "other_namespace",
          tools: [
            {
              type: "function",
              name: "send_message",
              parameters: {
                type: "object",
                properties: { message: { type: "string", encrypted: true } },
              },
            },
          ],
        },
      ],
    },
  ];
}

function collaborationFunctions(input: any[]): any[] {
  return input[0].tools[0].tools;
}

describe("V2 plaintext agent-message schema", () => {
  test("flag is opt-in and accepts common truthy spellings", () => {
    expect(v2PlaintextAgentMessagesEnabled({})).toBe(false);
    expect(v2PlaintextAgentMessagesEnabled({ [V2_PLAINTEXT_AGENT_MESSAGES_ENV]: "0" })).toBe(false);
    expect(v2PlaintextAgentMessagesEnabled({ [V2_PLAINTEXT_AGENT_MESSAGES_ENV]: "true" })).toBe(true);
    expect(v2PlaintextAgentMessagesEnabled({ [V2_PLAINTEXT_AGENT_MESSAGES_ENV]: "ON" })).toBe(true);
  });

  test("strips only collaboration message encryption annotations", () => {
    const input = collaborationInput();
    expect(stripV2CollaborationMessageEncryptionInPlace(input)).toBe(3);

    const functions = collaborationFunctions(input);
    for (const fn of functions.slice(0, 3)) {
      expect(fn.parameters.properties.message).not.toHaveProperty("encrypted");
    }

    expect(functions[0].parameters.properties.data.encrypted).toBe("keep-me");
    expect(functions[3].parameters.properties.message.encrypted).toBe(true);
    expect(input[0].tools[1].tools[0].parameters.properties.message.encrypted).toBe(true);
  });

  test("sanitize path preserves historical behavior while the flag is off", () => {
    delete process.env[V2_PLAINTEXT_AGENT_MESSAGES_ENV];
    const input = collaborationInput();

    expect(sanitizeEncryptedContentInPlace(input)).toBe(0);
    expect(collaborationFunctions(input)[0].parameters.properties.message.encrypted).toBe(true);
  });

  test("sanitize path removes the annotations before request parsing when enabled", () => {
    process.env[V2_PLAINTEXT_AGENT_MESSAGES_ENV] = "1";
    const input = collaborationInput();

    // No plaintext encrypted_content parts exist, so the legacy rewrite count stays 0.
    // This keeps the existing core.ts warning/accounting contract unchanged.
    expect(sanitizeEncryptedContentInPlace(input)).toBe(0);

    const functions = collaborationFunctions(input);
    expect(functions[0].parameters.properties.message).not.toHaveProperty("encrypted");
    expect(functions[1].parameters.properties.message).not.toHaveProperty("encrypted");
    expect(functions[2].parameters.properties.message).not.toHaveProperty("encrypted");
  });
});
