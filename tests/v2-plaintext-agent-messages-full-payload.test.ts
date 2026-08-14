import { afterEach, describe, expect, test } from "bun:test";
import {
  stripV2CollaborationMessageEncryptionInPlace,
  V2_PLAINTEXT_AGENT_MESSAGES_ENV,
} from "../src/lib/v2-plaintext-agent-messages";
import { readJsonRequestBody } from "../src/server/request-decompress";

const savedFlag = process.env[V2_PLAINTEXT_AGENT_MESSAGES_ENV];

afterEach(() => {
  if (savedFlag === undefined) delete process.env[V2_PLAINTEXT_AGENT_MESSAGES_ENV];
  else process.env[V2_PLAINTEXT_AGENT_MESSAGES_ENV] = savedFlag;
});

function messageSchema(encrypted: unknown = true) {
  return { type: "string", encrypted };
}

function functionTool(name: string) {
  return {
    type: "function",
    name,
    parameters: {
      type: "object",
      properties: {
        message: messageSchema(),
        data: { type: "string", encrypted: "keep-me" },
      },
    },
  };
}

describe("V2 plaintext collaboration rewrite on full payload", () => {
  test("covers top-level tools, additional_tools, and nested namespaces", () => {
    const payload: any = {
      tools: [
        functionTool("spawn_agent"),
        {
          type: "namespace",
          name: "collaboration",
          tools: [functionTool("send_message")],
        },
      ],
      input: [
        {
          type: "additional_tools",
          role: "developer",
          tools: [
            functionTool("followup_task"),
            {
              type: "namespace",
              name: "different_namespace_name",
              tools: [functionTool("send_message")],
            },
          ],
        },
      ],
    };

    expect(stripV2CollaborationMessageEncryptionInPlace(payload)).toBe(4);
    expect(payload.tools[0].parameters.properties.message).not.toHaveProperty("encrypted");
    expect(payload.tools[1].tools[0].parameters.properties.message).not.toHaveProperty("encrypted");
    expect(payload.input[0].tools[0].parameters.properties.message).not.toHaveProperty("encrypted");
    expect(payload.input[0].tools[1].tools[0].parameters.properties.message).not.toHaveProperty("encrypted");
  });

  test("preserves unrelated encrypted schema fields and unrelated functions", () => {
    const payload: any = {
      tools: [
        functionTool("send_message"),
        functionTool("unrelated_tool"),
      ],
    };

    expect(stripV2CollaborationMessageEncryptionInPlace(payload)).toBe(1);
    expect(payload.tools[0].parameters.properties.message).not.toHaveProperty("encrypted");
    expect(payload.tools[0].parameters.properties.data.encrypted).toBe("keep-me");
    expect(payload.tools[1].parameters.properties.message.encrypted).toBe(true);
  });

  test("readJsonRequestBody applies the rewrite only when the env flag is enabled", async () => {
    const makeRequest = () => new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        tools: [functionTool("spawn_agent")],
        input: [{
          type: "additional_tools",
          role: "developer",
          tools: [functionTool("send_message")],
        }],
      }),
    });

    delete process.env[V2_PLAINTEXT_AGENT_MESSAGES_ENV];
    const disabled: any = await readJsonRequestBody(makeRequest());
    expect(disabled.tools[0].parameters.properties.message.encrypted).toBe(true);
    expect(disabled.input[0].tools[0].parameters.properties.message.encrypted).toBe(true);

    process.env[V2_PLAINTEXT_AGENT_MESSAGES_ENV] = "1";
    const enabled: any = await readJsonRequestBody(makeRequest());
    expect(enabled.tools[0].parameters.properties.message).not.toHaveProperty("encrypted");
    expect(enabled.input[0].tools[0].parameters.properties.message).not.toHaveProperty("encrypted");
  });
});
