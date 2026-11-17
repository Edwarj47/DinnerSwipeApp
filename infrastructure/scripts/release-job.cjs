// Installed root-owned alongside the executor, never run from a writable checkout.
const fs = require("node:fs"),
  path = require("node:path");
const { privateFile, command } = require("./release-contract.cjs");
const { execute } = require("./release-executor.cjs");
function jobRequest(file) {
  if (
    !/^\/var\/lib\/dinner-swipe\/jobs\/[a-f0-9]{32}\/request\.json$/.test(
      file || "",
    )
  )
    throw Error("Invalid release job path");
  const value = JSON.parse(privateFile(file));
  return command(
    `release-v1 ${value.tier} ${value.sha} ${value.digest} ${value.scope}`,
    value.tier,
  );
}
async function main(file) {
  if (process.getuid() !== 0)
    throw Error("Root-owned restricted release runner required");
  const request = jobRequest(file);
  let status = 1;
  try {
    await execute(request);
    status = 0;
  } catch {
    console.error(
      "Release failed. Inspect the private release journal before retrying.",
    );
  } finally {
    const result = path.join(path.dirname(file), "result.json");
    fs.writeFileSync(`${result}.tmp`, JSON.stringify({ status }), {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(`${result}.tmp`, result);
  }
  process.exitCode = status;
}
if (require.main === module)
  main(process.argv[2]).catch(() => {
    console.error("Release job could not start.");
    process.exitCode = 1;
  });
module.exports = { jobRequest };
