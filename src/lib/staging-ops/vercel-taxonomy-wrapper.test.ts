import { describe, it, expect, vi } from "vitest";
import {
  assertLinkedToStagingProject,
  parseVercelEnvFile,
  selectRequiredEnv,
  wantsApply,
  buildBootstrapArgs,
  buildChildEnv,
  buildVercelPullArgs,
  vercelCliUnavailableError,
  runVercelWrapper,
  VercelWrapperError,
  STAGING_PROJECT_NAME,
  type VercelWrapperDeps,
} from "./vercel-taxonomy-wrapper";

// Vercel staging wrapper (ADR-0016 hardening). All side effects are injected,
// so no real Vercel / Supabase / filesystem / child process is touched.

const SECRET_DB = "postgresql://postgres.yvqzubmomcrimaseijlj:SUPERSECRETPW@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
const SECRET_DIRECT = "postgresql://postgres.yvqzubmomcrimaseijlj:SUPERSECRETPW@aws-1-ap-south-1.pooler.supabase.com:5432/postgres";

const ENV_FILE_CONTENTS = [
  "# Pulled by Vercel",
  `DATABASE_URL="${SECRET_DB}"`,
  `DIRECT_URL="${SECRET_DIRECT}"`,
  'BETTER_AUTH_SECRET="unrelated-secret-should-be-ignored"',
  'GOOGLE_CLIENT_SECRET="also-ignored"',
].join("\n");

function makeDeps(overrides: Partial<VercelWrapperDeps> = {}): {
  deps: VercelWrapperDeps;
  logs: string[];
  spawnBootstrap: ReturnType<typeof vi.fn>;
  deleteTempFile: ReturnType<typeof vi.fn>;
  vercelPull: ReturnType<typeof vi.fn>;
} {
  const logs: string[] = [];
  const spawnBootstrap = vi.fn(async () => 0);
  const deleteTempFile = vi.fn(async () => {});
  const vercelPull = vi.fn(async () => {});
  const deps: VercelWrapperDeps = {
    readProjectJson: async () => ({ projectName: STAGING_PROJECT_NAME }),
    vercelPull,
    readEnvFile: async () => ENV_FILE_CONTENTS,
    deleteTempFile,
    spawnBootstrap,
    log: (m) => logs.push(m),
    argv: [],
    baseEnv: { PATH: "/usr/bin", NODE_ENV: "test" } as NodeJS.ProcessEnv,
    tempPath: "/tmp/.env.barq-staging.bootstrap.local",
    ...overrides,
  };
  return { deps, logs, spawnBootstrap, deleteTempFile, vercelPull };
}

describe("assertLinkedToStagingProject", () => {
  it("accepts the barq-staging link", () => {
    expect(() => assertLinkedToStagingProject({ projectName: "barq-staging" })).not.toThrow();
  });

  it("fails closed on a missing/invalid link", () => {
    expect(() => assertLinkedToStagingProject(null)).toThrow(VercelWrapperError);
    expect(() => assertLinkedToStagingProject("nope")).toThrow(VercelWrapperError);
  });

  it("fails closed on a different project", () => {
    expect(() => assertLinkedToStagingProject({ projectName: "some-other-project" })).toThrow(VercelWrapperError);
  });
});

describe("parseVercelEnvFile", () => {
  it("selects ONLY DATABASE_URL and DIRECT_URL, ignoring everything else", () => {
    const parsed = parseVercelEnvFile(ENV_FILE_CONTENTS);
    expect(Object.keys(parsed).sort()).toEqual(["DATABASE_URL", "DIRECT_URL"]);
    expect(parsed.DATABASE_URL).toBe(SECRET_DB);
    expect(parsed.DIRECT_URL).toBe(SECRET_DIRECT);
  });

  it("strips single or double quotes and ignores comments/blank lines", () => {
    const parsed = parseVercelEnvFile("\n# c\nDATABASE_URL='u1'\nDIRECT_URL=u2\n");
    expect(parsed).toEqual({ DATABASE_URL: "u1", DIRECT_URL: "u2" });
  });
});

describe("selectRequiredEnv", () => {
  it("returns both when present", () => {
    expect(selectRequiredEnv({ DATABASE_URL: "a", DIRECT_URL: "b" })).toEqual({ DATABASE_URL: "a", DIRECT_URL: "b" });
  });

  it("fails closed when DATABASE_URL is missing", () => {
    expect(() => selectRequiredEnv({ DIRECT_URL: "b" })).toThrow(VercelWrapperError);
  });

  it("fails closed when DIRECT_URL is missing", () => {
    expect(() => selectRequiredEnv({ DATABASE_URL: "a" })).toThrow(VercelWrapperError);
  });

  it("fails closed (with a Sensitive-specific message) when a value is the [SENSITIVE] placeholder", () => {
    expect(() => selectRequiredEnv({ DATABASE_URL: "[SENSITIVE]", DIRECT_URL: "[SENSITIVE]" })).toThrow(/Sensitive/);
    expect(() => selectRequiredEnv({ DATABASE_URL: "postgresql://ok", DIRECT_URL: "[SENSITIVE]" })).toThrow(/Sensitive/);
  });
});

describe("buildVercelPullArgs", () => {
  it("pulls the production scope using a BARE filename (no path)", () => {
    expect(buildVercelPullArgs(".env.barq-staging.bootstrap.local")).toEqual([
      "env",
      "pull",
      ".env.barq-staging.bootstrap.local",
      "--environment=production",
      "--yes",
    ]);
  });

  it("rejects a path (with separators) or empty name — the space-in-path guard", () => {
    expect(() => buildVercelPullArgs("D:\\my backup\\Barq\\.env.x.local")).toThrow(VercelWrapperError);
    expect(() => buildVercelPullArgs("dir/name.local")).toThrow(VercelWrapperError);
    expect(() => buildVercelPullArgs("")).toThrow(VercelWrapperError);
  });
});

describe("vercelCliUnavailableError", () => {
  it("is a VercelWrapperError instructing a global install, never npx or .env", () => {
    const err = vercelCliUnavailableError();
    expect(err).toBeInstanceOf(VercelWrapperError);
    expect(err.message).toContain("npm i -g vercel");
    expect(err.message).toContain("not falling back to .env");
  });
});

describe("arg + env builders", () => {
  it("dry-run forwards no --apply; --apply is forwarded explicitly", () => {
    expect(wantsApply([])).toBe(false);
    expect(wantsApply(["--apply"])).toBe(true);
    expect(buildBootstrapArgs(false)).toEqual([]);
    expect(buildBootstrapArgs(true)).toEqual(["--apply"]);
  });

  it("child env forces APP_ENV=staging and injects the pulled DB target", () => {
    const env = buildChildEnv({ PATH: "/x", NODE_ENV: "test" } as NodeJS.ProcessEnv, { DATABASE_URL: "d1", DIRECT_URL: "d2" });
    expect(env.APP_ENV).toBe("staging");
    expect(env.DATABASE_URL).toBe("d1");
    expect(env.DIRECT_URL).toBe("d2");
    expect(env.PATH).toBe("/x");
  });
});

describe("runVercelWrapper", () => {
  it("dry-run: spawns bootstrap with NO --apply and the injected staging env", async () => {
    const { deps, spawnBootstrap } = makeDeps({ argv: [] });
    const code = await runVercelWrapper(deps);
    expect(code).toBe(0);
    expect(spawnBootstrap).toHaveBeenCalledTimes(1);
    const [args, childEnv] = spawnBootstrap.mock.calls[0]!;
    expect(args).toEqual([]);
    expect(childEnv.APP_ENV).toBe("staging");
    expect(childEnv.DATABASE_URL).toBe(SECRET_DB);
    expect(childEnv.DIRECT_URL).toBe(SECRET_DIRECT);
  });

  it("--apply: forwards --apply explicitly", async () => {
    const { deps, spawnBootstrap } = makeDeps({ argv: ["--apply"] });
    await runVercelWrapper(deps);
    expect(spawnBootstrap.mock.calls[0]![0]).toEqual(["--apply"]);
  });

  it("fails closed on a wrong project link and never pulls or spawns", async () => {
    const { deps, spawnBootstrap, vercelPull } = makeDeps({
      readProjectJson: async () => ({ projectName: "not-staging" }),
    });
    await expect(runVercelWrapper(deps)).rejects.toBeInstanceOf(VercelWrapperError);
    expect(vercelPull).not.toHaveBeenCalled();
    expect(spawnBootstrap).not.toHaveBeenCalled();
  });

  it("fails closed when the pulled env lacks DATABASE_URL", async () => {
    const { deps, spawnBootstrap, deleteTempFile } = makeDeps({
      readEnvFile: async () => `DIRECT_URL="${SECRET_DIRECT}"`,
    });
    await expect(runVercelWrapper(deps)).rejects.toBeInstanceOf(VercelWrapperError);
    expect(spawnBootstrap).not.toHaveBeenCalled();
    expect(deleteTempFile).toHaveBeenCalledTimes(1); // cleaned up even on failure
  });

  it("deletes the temp file on success", async () => {
    const { deps, deleteTempFile } = makeDeps();
    await runVercelWrapper(deps);
    expect(deleteTempFile).toHaveBeenCalledTimes(1);
    expect(deleteTempFile).toHaveBeenCalledWith("/tmp/.env.barq-staging.bootstrap.local");
  });

  it("deletes the temp file even when the bootstrap spawn fails", async () => {
    const { deps, deleteTempFile } = makeDeps({
      spawnBootstrap: vi.fn(async () => {
        throw new Error("bootstrap crashed");
      }),
    });
    await expect(runVercelWrapper(deps)).rejects.toThrow("bootstrap crashed");
    expect(deleteTempFile).toHaveBeenCalledTimes(1);
  });

  it("deletes the temp file even when vercel pull fails", async () => {
    const { deps, deleteTempFile, spawnBootstrap } = makeDeps({
      vercelPull: vi.fn(async () => {
        throw new VercelWrapperError("pull failed");
      }),
    });
    await expect(runVercelWrapper(deps)).rejects.toBeInstanceOf(VercelWrapperError);
    expect(deleteTempFile).toHaveBeenCalledTimes(1);
    expect(spawnBootstrap).not.toHaveBeenCalled();
  });

  it("never logs any secret value (DATABASE_URL / DIRECT_URL / password)", async () => {
    const { deps, logs } = makeDeps({ argv: ["--apply"] });
    await runVercelWrapper(deps);
    const joined = logs.join("\n");
    expect(joined).not.toContain(SECRET_DB);
    expect(joined).not.toContain(SECRET_DIRECT);
    expect(joined).not.toContain("SUPERSECRETPW");
  });
});
