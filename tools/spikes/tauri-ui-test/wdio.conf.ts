import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

let tauriDriver: ChildProcess;

export const config: WebdriverIO.Config = {
  specs: ["./smoke.test.ts"],
  capabilities: [
    {
      "tauri:options": {
        application: path.resolve(
          "scratch-app/src-tauri/target/debug/scratch-app",
        ),
      },
    } as any,
  ],
  hostname: "127.0.0.1",
  port: 4444,
  beforeSession: () => {
    tauriDriver = spawn("tauri-driver", [], { stdio: "inherit" });
  },
  afterSession: () => tauriDriver?.kill(),
};
