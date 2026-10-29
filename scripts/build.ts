/**
 * Build the connector package with Bun (browser target), plus TypeScript declarations.
 * Runtime bundles must be self-contained: no Node built-ins and no runtime dependencies.
 */
import { mkdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

interface BuildSpec {
    name: string;
    entry: string;
    outdir: string;
    format: "esm" | "iife";
    minify?: boolean;
}

const specs: BuildSpec[] = [
    { name: "core/index.js", entry: resolve(root, "src/core/index.ts"), outdir: resolve(dist, "core"), format: "esm" },
    { name: "ui/index.js", entry: resolve(root, "src/ui/index.ts"), outdir: resolve(dist, "ui"), format: "esm" },
    { name: "ui/standalone.global.js", entry: resolve(root, "src/ui/standalone.ts"), outdir: resolve(dist, "ui"), format: "iife", minify: true }
];

const problems: string[] = [];

for (const spec of specs) {
    const result = await Bun.build({
        entrypoints: [spec.entry],
        outdir: spec.outdir,
        naming: spec.name.split("/").pop()!,
        target: "browser",
        format: spec.format,
        minify: spec.minify,
        sourcemap: "linked",
        metafile: true
    });
    if (!result.success) {
        for (const log of result.logs) console.error(log);
        throw new Error(`build of ${spec.name} failed`);
    }
    const inputs = Object.keys((result as any).metafile?.inputs ?? {});
    for (const input of inputs) {
        if (input.includes("node_modules/")) problems.push(`${spec.name}: bundles ${input}`);
    }
    for (const output of result.outputs) {
        if (!output.path.endsWith(".js")) continue;
        const size = output.size ?? statSync(output.path).size;
        const text = await Bun.file(output.path).text();
        if (/\brequire\(["'](?:node:)?(?:fs|path|net|crypto|buffer|stream|os|zlib|url)["']\)/.test(text)) {
            problems.push(`${spec.name}: references a Node built-in`);
        }
        console.log(`  ${spec.name}  ${(size / 1024).toFixed(1)} KiB  (${inputs.length} inputs)`);
    }
}

if (problems.length) {
    console.error(problems.join("\n"));
    throw new Error("disallowed runtime dependency in the bundle");
}

const declarations = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.build.json"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit"
});
if (declarations.exitCode !== 0) throw new Error("TypeScript declaration build failed");

console.log(`dist ready: ${dist}`);
