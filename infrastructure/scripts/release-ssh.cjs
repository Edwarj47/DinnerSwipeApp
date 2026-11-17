// Forced-command entry point. SSH disconnects do not terminate the tmux job.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  cp = require("node:child_process");
const contract = require("./release-contract.cjs");
function tmuxCommand(
  id,
  directory = "/var/lib/dinner-swipe/jobs",
  runner = __dirname,
) {
  if (
    !/^[a-f0-9]{32}$/.test(id) ||
    directory !== "/var/lib/dinner-swipe/jobs" ||
    !/^\/[A-Za-z0-9_/-]+$/.test(runner)
  )
    throw Error("Invalid installed job boundary");
  return `/usr/bin/node ${runner}/release-job.cjs ${directory}/${id}/request.json > ${directory}/${id}/output.log 2>&1`;
}
async function main(tier) {
  if (process.getuid() !== 0)
    throw Error("Restricted root entry point required");
  const request = contract.command(process.env.SSH_ORIGINAL_COMMAND, tier);
  const id = crypto.randomBytes(16).toString("hex"),
    root = "/var/lib/dinner-swipe/jobs",
    directory = path.join(root, id);
  fs.mkdirSync(root, { mode: 0o700, recursive: true });
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(
    path.join(directory, "request.json"),
    JSON.stringify(request),
    { mode: 0o600, flag: "wx" },
  );
  cp.execFileSync(
    "tmux",
    ["new-session", "-d", "-s", `dinner-release-${id}`, tmuxCommand(id)],
    { env: contract.dockerEnvironment(), stdio: "ignore" },
  );
  console.log(
    `Release job ${id} started; the private tmux job survives a disconnected client.`,
  );
  for (let attempt = 0; attempt < 720; attempt++) {
    const result = path.join(directory, "result.json");
    if (fs.existsSync(result)) {
      const value = JSON.parse(contract.privateFile(result));
      if (value.status !== 0)
        throw Error(`Release job ${id} failed; inspect its private journal.`);
      console.log("Release verified.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error(
    `Release job ${id} is still running or requires operator inspection; do not dispatch a duplicate.`,
  );
}
if (require.main === module)
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { tmuxCommand };
