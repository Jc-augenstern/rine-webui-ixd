import { execFileSync } from "node:child_process";
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const owner = "https://github.com/Jc-augenstern/rine-webui-ixd.git";
const source = "https://github.com/zwh087383/rine-webui-ixd.git";
const names = git("remote").split(/\s+/);
if (names.includes("origin")) git("remote", "set-url", "origin", owner);
else git("remote", "add", "origin", owner);
git("remote", "set-url", "--push", "origin", owner);
if (names.includes("upstream")) git("remote", "set-url", "upstream", source);
else git("remote", "add", "upstream", source);
git(
  "remote",
  "set-url",
  "--push",
  "upstream",
  "https://upstream-read-only.invalid/DO-NOT-PUSH",
);
git("config", "remote.pushDefault", "origin");
git("config", "core.hooksPath", ".githooks");
console.log(git("remote", "-v"));
console.log(
  "Safe remotes and local pre-push guard configured. No network write performed.",
);
