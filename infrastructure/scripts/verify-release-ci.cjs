const fs = require("node:fs"),
  cp = require("node:child_process"),
  { assertCi } = require("./release-contract.cjs");
async function main() {
  const sha = process.argv[2];
  if (!/^[a-f0-9]{40}$/.test(sha || ""))
    throw Error("Provide the exact reviewed commit SHA");
  const headers = {
    Accept: "application/vnd.github+json",
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  };
  const get = async (path) => {
    const response = await fetch(
      `https://api.github.com/repos/Edwarj47/DinnerSwipeApp${path}`,
      { headers },
    );
    if (!response.ok) throw Error("Unable to verify CI evidence");
    return response.json();
  };
  const runs = await get(
    `/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=20`,
  );
  const run = runs.workflow_runs.find(
    (run) => run.status === "completed" && run.conclusion === "success",
  );
  if (!run) throw Error("Exact-commit CI has not succeeded");
  assertCi(run, sha);
  const jobs = await get(`/actions/runs/${run.id}/jobs?per_page=100`);
  for (const name of [
    "backend",
    "frontend",
    "docker",
    "release-contract",
    "postgres",
    "browser",
  ])
    if (
      !jobs.jobs.some(
        (job) => job.name === name && job.conclusion === "success",
      )
    )
      throw Error(`Missing required CI gate: ${name}`);
  cp.execFileSync("git", ["merge-base", "--is-ancestor", sha, "origin/main"]);
  fs.writeFileSync("verified-ci-run.txt", String(run.id) + "\n");
  console.log(
    "Exact source, main ancestry and all required CI gates verified.",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
