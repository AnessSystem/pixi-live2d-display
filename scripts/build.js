import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { build } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

const entries = [
    { entry: "src/csm2.ts", name: "cubism2" },
    { entry: "src/csm4.ts", name: "cubism4" },
    { entry: "src/index.ts", name: "index" },
    { entry: "src/extra.ts", name: "extra" },
];

const profiles = entries.flatMap(({ entry, name }) =>
    [false, true].map((minify) => ({
        build: {
            emptyOutDir: false,
            minify: minify && "terser",
            lib: {
                formats: minify ? ["umd"] : ["es", "cjs", "umd"],
                entry: resolve(__dirname, "..", entry),
                fileName: (format) => {
                    if (format === "es") return `${name}.es.js`;
                    if (format === "cjs") return `${name}.cjs`;

                    return `${name}${minify ? ".min" : ""}.js`;
                },
            },
        },
    })),
);

async function main() {
    for (const profile of profiles) {
        console.log("\n" + `Building profile: ${profile.build.lib.fileName("umd")}`);

        await build(profile);
    }
}

main();
