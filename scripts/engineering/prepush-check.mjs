#!/usr/bin/env node
// BARQ pre-push gate (run before any `git push`; the Claude Code hook runs it automatically).
//
//   node scripts/engineering/prepush-check.mjs [--target <remote-branch>] [--remote origin] [--no-fetch]
//
// FAILS when:
//   - the target is `main` / `master` (production is released only through the protected,
//     owner-approved path — never by an agent push);
//   - the working tree is not clean (what is pushed must be exactly what was validated);
//   - REMOTE DRIFT: the remote branch has commits the local branch does not (someone else pushed;
//     re-inspect instead of overwriting);
//   - the push would not be a fast-forward of the remote branch.
// Then lists exactly which commits would be pushed. It never pushes anything itself.

import { git, isMain, parseArgs, report, tryGit } from "./lib.mjs";

const PROTECTED = new Set(["main", "master", "production"]);

export function evaluate({ branch, target, dirty, remoteSha, localSha, remoteIsAncestor, localHasRemote }) {
  const failures = [];
  if (PROTECTED.has(target)) failures.push(`target "${target}" is the production branch — agents never push it; production releases go through the protected owner-approved workflow`);
  if (branch === null) failures.push("detached HEAD — check out a named branch first");
  if (dirty.length) failures.push(`working tree is not clean (${dirty.length} path(s)): ${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? " …" : ""}`);
  if (remoteSha && !localHasRemote) failures.push(`REMOTE DRIFT: origin/${target} is at ${remoteSha.slice(0, 7)}, which the local branch does not contain — fetch and re-inspect before pushing`);
  else if (remoteSha && !remoteIsAncestor) failures.push(`push to ${target} would not be a fast-forward of ${remoteSha.slice(0, 7)} (force pushes are prohibited)`);
  if (remoteSha && remoteSha === localSha) failures.push(`nothing to push — origin/${target} already equals local ${localSha.slice(0, 7)}`);
  return failures;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const remote = typeof args.remote === "string" ? args.remote : "origin";
    const branchRes = tryGit(["symbolic-ref", "--short", "-q", "HEAD"]);
    const branch = branchRes.ok && branchRes.out ? branchRes.out : null;
    const target = typeof args.target === "string" ? args.target : branch ?? "";
    const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean).map((l) => l.slice(3));
    const localSha = git(["rev-parse", "HEAD"]);
    // read-only network call: the remote tip as the server sees it right now
    const ls = args["no-fetch"] ? "" : git(["ls-remote", remote, `refs/heads/${target}`]);
    const remoteSha = ls.split(/\s+/)[0] || null;
    if (remoteSha && !args["no-fetch"]) tryGit(["fetch", "-q", remote, target]);
    const localHasRemote = remoteSha ? tryGit(["cat-file", "-e", `${remoteSha}^{commit}`]).ok && tryGit(["merge-base", "--is-ancestor", remoteSha, "HEAD"]).ok : true;
    const failures = evaluate({ branch, target, dirty, remoteSha, localSha, remoteIsAncestor: localHasRemote, localHasRemote });
    console.log(`prepush-check: local ${branch ?? "(detached)"} @ ${localSha.slice(0, 7)} → ${remote}/${target} @ ${remoteSha ? remoteSha.slice(0, 7) : "(new branch)"}`);
    if (failures.length === 0) {
      const range = remoteSha ? `${remoteSha}..HEAD` : "HEAD";
      const commits = git(["log", "--oneline", "--no-decorate", remoteSha ? range : "-20", ...(remoteSha ? [] : ["HEAD"])]).split("\n").filter(Boolean);
      console.log(`  would push ${commits.length} commit(s)${remoteSha ? ` (${remoteSha.slice(0, 7)}..${localSha.slice(0, 7)})` : " (new branch; showing up to 20)"}:`);
      for (const c of commits) console.log(`    ${c}`);
      console.log("  reminder: the full validation suite must have passed on exactly this HEAD.");
    }
    process.exit(report("prepush-check", failures));
  } catch (e) {
    console.error(`prepush-check: ${e.message}`);
    process.exit(2);
  }
}
