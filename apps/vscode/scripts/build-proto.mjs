#!/usr/bin/env node

import chalk from "chalk"
import { execFileSync, execSync } from "child_process"
import fsSync from "fs"
import * as fs from "fs/promises"
import { globby } from "globby"
import { createRequire } from "module"
import os from "os"
import * as path from "path"
import { rmrf } from "./file-utils.mjs"
import { main as generateHostBridgeClient } from "./generate-host-bridge-client.mjs"
import { main as generateProtoBusSetup } from "./generate-protobus-setup.mjs"

const require = createRequire(import.meta.url)
const isWindows = process.platform === "win32"
const isDarwin = process.platform === "darwin"

// Resolve the grpc-tools package root safely if available.
let GRPC_TOOLS_DIR = null
let GRPC_TOOLS_PROTOC = null
try {
	GRPC_TOOLS_DIR = path.dirname(require.resolve("grpc-tools/package.json"))
	GRPC_TOOLS_PROTOC = path.join(GRPC_TOOLS_DIR, "bin", isWindows ? "protoc.exe" : "protoc")
} catch {
	// grpc-tools might not be installed or supported on this architecture (e.g. darwin-arm64)
}

const LEGACY_WINDOWS_PROTOC = path.resolve("tmp-protoc/bin/protoc.exe")

/**
 * Locate a usable protoc binary on the system before falling back to grpc-tools prebuilt.
 * This is critical on Apple Silicon (M-series Mac) where native Homebrew protoc avoids
 * Rosetta emulation, grpc-tools download failures, and corporate proxy SSL certificate blocks.
 */
function findProtoc() {
	// 1. Explicit environment variable override
	if (process.env.PROTOC && fsSync.existsSync(process.env.PROTOC)) {
		return process.env.PROTOC
	}

	// 2. Standard macOS Homebrew / system locations
	if (isDarwin) {
		const macCandidates = [
			"/opt/homebrew/bin/protoc", // Apple Silicon Homebrew default
			"/usr/local/bin/protoc", // Intel Mac Homebrew default
		]
		for (const candidate of macCandidates) {
			if (fsSync.existsSync(candidate)) {
				return candidate
			}
		}
	}

	// 3. System PATH lookup via which/where
	try {
		const whichCmd = isWindows ? "where protoc" : "which protoc"
		const output = execSync(whichCmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim()
		const firstPath = output.split(/\r?\n/)[0]?.trim()
		if (firstPath && fsSync.existsSync(firstPath)) {
			return firstPath
		}
	} catch {
		// Not on PATH
	}

	// 4. Legacy Windows path
	if (isWindows && fsSync.existsSync(LEGACY_WINDOWS_PROTOC)) {
		return LEGACY_WINDOWS_PROTOC
	}

	// 5. Existing grpc-tools bundled binary if already present
	if (GRPC_TOOLS_PROTOC && fsSync.existsSync(GRPC_TOOLS_PROTOC)) {
		return GRPC_TOOLS_PROTOC
	}

	return null
}

let PROTOC = findProtoc()

// `bun install` skips grpc-tools' `install` lifecycle script (`node-pre-gyp install`), so the prebuilt
// protoc is never downloaded into bin/. When it's missing, run that same command here to fetch it.
// grpc-tools depends on @mapbox/node-pre-gyp, which exposes the `node-pre-gyp` CLI.
function resolveNodePreGypCli() {
	if (!GRPC_TOOLS_DIR) return null
	const candidates = ["@mapbox/node-pre-gyp/bin/node-pre-gyp", "node-pre-gyp/bin/node-pre-gyp"]
	for (const candidate of candidates) {
		try {
			// Resolve from the grpc-tools package (its direct dependency).
			return require.resolve(candidate, { paths: [GRPC_TOOLS_DIR] })
		} catch {
			// Fall back to resolving from this script's location (covers hoisted installs).
			try {
				return require.resolve(candidate)
			} catch {
				// try the next candidate
			}
		}
	}
	return null
}

function ensureProtocBinary() {
	if (!GRPC_TOOLS_DIR || !GRPC_TOOLS_PROTOC) {
		console.error(
			chalk.red(
				"protoc compiler not found and grpc-tools is not installed.\n" +
					(isDarwin
						? "On macOS (Apple Silicon), install protoc with Homebrew:\n  brew install protobuf\n"
						: "Please install protoc or run `bun install`.\n"),
			),
		)
		process.exit(1)
	}
	console.warn(chalk.yellow(`protoc not found at ${GRPC_TOOLS_PROTOC}; downloading the grpc-tools prebuilt binary...`))
	const nodePreGypCli = resolveNodePreGypCli()
	if (!nodePreGypCli) {
		console.error(
			chalk.red(
				`Could not resolve the node-pre-gyp CLI from ${GRPC_TOOLS_DIR}. Run \`bun install\`, then retry \`bun run protos\`.`,
			),
		)
		process.exit(1)
	}
	try {
		// Mirrors grpc-tools' `scripts.install` ("node-pre-gyp install"): downloads the prebuilt
		// protoc for the current platform/arch into grpc-tools/bin.
		execFileSync(process.execPath, [nodePreGypCli, "install"], { cwd: GRPC_TOOLS_DIR, stdio: "inherit" })
	} catch (error) {
		console.error(chalk.red(`Failed to download protoc via node-pre-gyp: ${error?.message ?? error}`))
		if (isDarwin) {
			console.error(
				chalk.cyan(
					"\nTip for macOS users: Install native protoc via Homebrew to avoid grpc-tools prebuilt issues:\n  brew install protobuf\n",
				),
			)
		}
		process.exit(1)
	}
	if (!fsSync.existsSync(GRPC_TOOLS_PROTOC)) {
		console.error(chalk.red(`protoc still not found at ${GRPC_TOOLS_PROTOC} after node-pre-gyp install.`))
		process.exit(1)
	}
	console.log(chalk.green("✓ protoc binary installed."))
}

if (!PROTOC) {
	ensureProtocBinary()
	PROTOC = GRPC_TOOLS_PROTOC
}

const PROTO_DIR = path.resolve("proto")
const TS_OUT_DIR = path.resolve("src/shared/proto")
const GRPC_JS_OUT_DIR = path.resolve("src/generated/grpc-js")
const NICE_JS_OUT_DIR = path.resolve("src/generated/nice-grpc")
const DESCRIPTOR_OUT_DIR = path.resolve("dist-standalone/proto")

// protoc invokes the ts-proto plugin as a child process, so it needs a path it can
// directly execute. On POSIX the package's JS bin (with its shebang) works. On
// Windows protoc cannot exec a bare .js or bun's `.bunx` shim ("%1 is not a valid
// Win32 application"), and the package manager's `.cmd` shim location/name varies
// (npm vs bun's hoisted store). To be package-manager-agnostic, generate a tiny
// .cmd wrapper that runs the resolved plugin JS via `node`.
function resolveTsProtoPlugin() {
	const pluginJs = require.resolve("ts-proto/protoc-gen-ts_proto")
	if (!isWindows) {
		return pluginJs
	}
	const wrapperDir = path.resolve("dist-standalone")
	fsSync.mkdirSync(wrapperDir, { recursive: true })
	const wrapperPath = path.join(wrapperDir, "protoc-gen-ts_proto.cmd")
	// %* forwards protoc's plugin args/stdio to the JS entry run under node.
	fsSync.writeFileSync(wrapperPath, `@echo off\r\nnode "${pluginJs}" %*\r\n`)
	return wrapperPath
}

const TS_PROTO_PLUGIN = resolveTsProtoPlugin()

const TS_PROTO_OPTIONS = [
	"env=both",
	"esModuleInterop=true",
	"outputServices=generic-definitions", // output generic ServiceDefinitions
	"outputIndex=true", // output an index file for each package which exports all protos in the package.
	"useOptionals=none", // scalar and message fields are required unless they are marked as optional.
	"useDate=false", // Timestamp fields will not be automatically converted to Date.
]

async function main() {
	await cleanup()
	await compileProtos()
	await generateProtoBusSetup()
	await generateHostBridgeClient()
}
async function compileProtos() {
	console.log(chalk.bold.blue("Compiling Protocol Buffers..."))

	// Check for Apple Silicon compatibility before proceeding
	checkAppleSiliconCompatibility()

	// Create output directories if they don't exist
	for (const dir of [TS_OUT_DIR, GRPC_JS_OUT_DIR, NICE_JS_OUT_DIR, DESCRIPTOR_OUT_DIR]) {
		await fs.mkdir(dir, { recursive: true })
	}

	// Process all proto files
	const protoFiles = await globby("**/*.proto", { cwd: PROTO_DIR, realpath: true })
	console.log(chalk.cyan(`Processing ${protoFiles.length} proto files from`), PROTO_DIR)

	tsProtoc(TS_OUT_DIR, protoFiles, TS_PROTO_OPTIONS)
	// grpc-js is used to generate service impls for the ProtoBus service.
	tsProtoc(GRPC_JS_OUT_DIR, protoFiles, ["outputServices=grpc-js", ...TS_PROTO_OPTIONS])
	// nice-js is used for the Host Bridge client impls because it uses promises.
	tsProtoc(NICE_JS_OUT_DIR, protoFiles, ["outputServices=nice-grpc,useExactTypes=false", ...TS_PROTO_OPTIONS])

	const descriptorFile = path.join(DESCRIPTOR_OUT_DIR, "descriptor_set.pb")
	const descriptorProtocArgs = [
		`--proto_path=${PROTO_DIR}`,
		`--descriptor_set_out=${descriptorFile}`,
		"--include_imports",
		...protoFiles,
	]
	try {
		log_verbose(chalk.cyan("Generating descriptor set..."))
		log_verbose(`${PROTOC} ${descriptorProtocArgs.join(" ")}`)
		execFileSync(PROTOC, descriptorProtocArgs, { stdio: "inherit" })
	} catch (error) {
		console.error(chalk.red("Error generating descriptor set for proto file:"), error)
		process.exit(1)
	}

	log_verbose(chalk.green("Protocol Buffer code generation completed successfully."))
	log_verbose(chalk.green(`TypeScript files generated in: ${TS_OUT_DIR}`))
}

function tsProtoc(outDir, protoFiles, protoOptions) {
	const args = [
		`--proto_path=${PROTO_DIR}`,
		`--plugin=protoc-gen-ts_proto=${TS_PROTO_PLUGIN}`,
		`--ts_proto_out=${outDir}`,
		`--ts_proto_opt=${protoOptions.join(",")}`,
		...protoFiles,
	]
	try {
		log_verbose(chalk.cyan(`Generating TypeScript code in ${outDir} for:\n${protoFiles.join("\n")}...`))
		log_verbose(`${PROTOC} ${args.join(" ")}`)
		execFileSync(PROTOC, args, { stdio: "inherit" })
	} catch (error) {
		console.error(chalk.red("Error generating TypeScript for proto files:"), error)
		process.exit(1)
	}
}

async function cleanup() {
	// Clean up existing generated files
	log_verbose(chalk.cyan("Cleaning up existing generated TypeScript files..."))
	await rmrf(TS_OUT_DIR)
	await rmrf("src/generated")

	// Clean up generated files that were moved.
	await rmrf("src/standalone/services/host-grpc-client.ts")
	await rmrf("src/standalone/server-setup.ts")
	await rmrf("src/hosts/vscode/host-grpc-service-config.ts")
	await rmrf("src/core/controller/grpc-service-config.ts")
	const oldhostbridgefiles = [
		"src/hosts/vscode/workspace/methods.ts",
		"src/hosts/vscode/workspace/index.ts",
		"src/hosts/vscode/diff/methods.ts",
		"src/hosts/vscode/diff/index.ts",
		"src/hosts/vscode/env/methods.ts",
		"src/hosts/vscode/env/index.ts",
		"src/hosts/vscode/window/methods.ts",
		"src/hosts/vscode/window/index.ts",
		"src/hosts/vscode/watch/methods.ts",
		"src/hosts/vscode/watch/index.ts",
		"src/hosts/vscode/uri/methods.ts",
		"src/hosts/vscode/uri/index.ts",
	]
	const oldprotobusfiles = [
		"src/core/controller/account/index.ts",
		"src/core/controller/account/methods.ts",
		"src/core/controller/browser/index.ts",
		"src/core/controller/browser/methods.ts",
		"src/core/controller/checkpoints/index.ts",
		"src/core/controller/checkpoints/methods.ts",
		"src/core/controller/file/index.ts",
		"src/core/controller/file/methods.ts",
		"src/core/controller/mcp/index.ts",
		"src/core/controller/mcp/methods.ts",
		"src/core/controller/models/index.ts",
		"src/core/controller/models/methods.ts",
		"src/core/controller/slash/index.ts",
		"src/core/controller/slash/methods.ts",
		"src/core/controller/state/index.ts",
		"src/core/controller/state/methods.ts",
		"src/core/controller/task/index.ts",
		"src/core/controller/task/methods.ts",
		"src/core/controller/ui/index.ts",
		"src/core/controller/ui/methods.ts",
		"src/core/controller/web/index.ts",
		"src/core/controller/web/methods.ts",
	]
	for (const file of [...oldhostbridgefiles, ...oldprotobusfiles]) {
		await rmrf(file)
	}
}

// Check for Apple Silicon compatibility
function checkAppleSiliconCompatibility() {
	// Only run check on macOS
	if (process.platform !== "darwin") {
		return
	}

	// Check if running on Apple Silicon
	const cpuArchitecture = os.arch()
	if (cpuArchitecture === "arm64") {
		// If using native system or Homebrew protoc, Rosetta is completely unnecessary!
		if (PROTOC && PROTOC !== GRPC_TOOLS_PROTOC) {
			log_verbose(chalk.green(`Using native Apple Silicon protoc: ${PROTOC}`))
			return
		}

		// When using the x86 grpc-tools fallback binary, verify Rosetta 2 is available
		let rosettaWorking = false
		try {
			execSync("/usr/bin/arch -x86_64 /usr/bin/true 2>/dev/null")
			rosettaWorking = true
		} catch {
			// Rosetta 2 is not functional
		}

		if (!rosettaWorking) {
			console.log(chalk.yellow("Detected Apple Silicon (ARM64) architecture."))
			console.log(chalk.red("The bundled x86 protoc requires Rosetta 2 or a native Apple Silicon protoc."))
			console.log(chalk.cyan("Recommended: Install native protoc via Homebrew:"))
			console.log(chalk.cyan("  brew install protobuf"))
			console.log(chalk.cyan("Alternatively, install Rosetta 2:"))
			console.log(chalk.cyan("  softwareupdate --install-rosetta --agree-to-license"))
			console.log(chalk.red("Aborting build process."))
			process.exit(1)
		}
	}
}

function log_verbose(s) {
	if (process.argv.includes("-v") || process.argv.includes("--verbose")) {
		console.log(s)
	}
}

// Run the main function
main().catch((error) => {
	console.error(chalk.red("Error:"), error)
	process.exit(1)
})
