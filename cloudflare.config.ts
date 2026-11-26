import { defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "ayn-thor-tracker",
		compatibilityDate: "2026-08-17",
		domains: [
			"thor.rlew.io",
		],
	},
});
