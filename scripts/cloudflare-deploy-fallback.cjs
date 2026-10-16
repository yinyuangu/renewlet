/** Catch sync pushes containing [skip ci], without repeating an attempted production upgrade. */
module.exports = async function deployMissingMain({ github, context, core }) {
  const scope = context.repo;
  const { data: branch } = await github.rest.repos.getBranch({ ...scope, branch: "main" });
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...scope,
    workflow_id: "cloudflare-worker.yml",
    branch: "main",
    head_sha: branch.commit.sha,
    per_page: 100,
  });
  if (runs.some((run) => run.conclusion !== "skipped")) {
    core.info(`Deployment already attempted or queued for ${branch.commit.sha}; no automatic retry.`);
    return;
  }
  await github.rest.actions.createWorkflowDispatch({
    ...scope, workflow_id: "cloudflare-worker.yml", ref: "main", inputs: { expected_sha: branch.commit.sha },
  });
  core.info(`Requested missing Cloudflare deployment for main (${branch.commit.sha}).`);
};
