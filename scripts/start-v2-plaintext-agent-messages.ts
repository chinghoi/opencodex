import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, mutatePersistedConfig } from "../src/config";
import { V2_PLAINTEXT_AGENT_MESSAGES_ENV } from "../src/server/responses/encrypted-payload";

function confirmed(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

const current = loadConfig();
const recoveryEnabled = current.agentTaskRecovery?.enabled === true;

console.log("\nOpenCodex V2 plaintext agent-message test mode\n");
console.log("This experimental mode removes collaboration message.encrypted before the parent request is forwarded.");
if (recoveryEnabled) {
  console.log("Agent Task Recovery is currently ENABLED and conflicts with this test mode.");
  console.log("Continuing will persist agentTaskRecovery.enabled=false before OpenCodex starts.");
} else {
  console.log("Agent Task Recovery is already disabled, so no conflicting recovery path is active.");
}
console.log("The plaintext mode itself is enabled only for the OpenCodex process launched by this command.\n");

const rl = createInterface({ input, output });
let answer = "";
try {
  answer = await rl.question("Enable V2 plaintext mode and continue? [y/N] ");
} finally {
  rl.close();
}

if (!confirmed(answer)) {
  console.log("Cancelled. No configuration was changed.");
  process.exit(0);
}

if (recoveryEnabled) {
  const outcome = mutatePersistedConfig(config => {
    const recovery = config.agentTaskRecovery;
    if (!recovery || recovery.enabled !== true) return { changed: false, value: false };
    config.agentTaskRecovery = { ...recovery, enabled: false };
    return { changed: true, value: true };
  });

  if (outcome.status === "unavailable") {
    console.error(`Cannot disable Agent Task Recovery: config ${outcome.reason}. Plaintext mode was not started.`);
    process.exit(1);
  }

  console.log(outcome.status === "committed"
    ? "Agent Task Recovery disabled in config."
    : "Agent Task Recovery was already disabled by another writer.");
}

console.log(`Starting OpenCodex with ${V2_PLAINTEXT_AGENT_MESSAGES_ENV}=1 ...\n`);

const child = Bun.spawn(
  [process.execPath, "run", "src/cli/index.ts", "start"],
  {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      [V2_PLAINTEXT_AGENT_MESSAGES_ENV]: "1",
    },
  },
);

const code = await child.exited;
process.exit(code);
