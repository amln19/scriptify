/**
 * esbuild configuration for Scriptify
 *
 * Bundles the extension into a single IIFE JavaScript file that
 * Spicetify can load. External dependencies (React, ReactDOM) are
 * provided by Spicetify at runtime via globals.
 */

const esbuild = require("esbuild");
const path = require("path");

const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: [path.resolve(__dirname, "src/app.tsx")],
  bundle: true,
  outfile: path.resolve(__dirname, "dist/scriptify.js"),
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: !isWatch,
  sourcemap: isWatch ? "inline" : false,
  define: {
    "process.env.NODE_ENV": isWatch ? '"development"' : '"production"',
  },
  // Nothing is marked external: React is never imported (JSX compiles to
  // Spicetify.React.*), and sanscript must be bundled in for the IIFE.
  loader: {
    ".tsx": "tsx",
    ".ts": "ts",
    ".json": "json",
  },
  logLevel: "info",
  // Banner to wrap in Spicetify extension format
  banner: {
    js: "// Scriptify - Lyrics Script Toggle for Spicetify\n// https://github.com/amln19/scriptify\n",
  },
};

async function build() {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("[Scriptify] Watching for changes...");
  } else {
    // esbuild.build() rejects on error, so reaching this line means success —
    // the catch below reports failures.
    await esbuild.build(buildOptions);
    console.log("[Scriptify] Build complete!");
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
