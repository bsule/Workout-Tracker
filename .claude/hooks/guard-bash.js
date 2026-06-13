// PreToolUse(Bash) guard. Reads the tool call on stdin; exit 2 to BLOCK with a message.
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const { tool_input } = JSON.parse(input || "{}");
  const cmd = (tool_input && tool_input.command) || "";
  const danger = [
    /\brm\s+-rf?\b/,             // rm -rf
    /\bgit\s+push\b.*--force\b/, // force push
    /\bgit\s+reset\s+--hard\b/,  // hard reset
    /:\(\)\s*\{.*\}\s*;:/        // fork bomb
  ];
  if (danger.some((re) => re.test(cmd))) {
    console.error(`Blocked by guard-bash: "${cmd}". Confirm with the user first.`);
    process.exit(2); // non-zero → blocks the command
  }
  process.exit(0);
});
