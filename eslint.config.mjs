import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      "legacy/**",
      ".next/**",
      "node_modules/**",
      "coverage/**",
      ".wrangler/**",
      "sim-output/**",
      "worker-configuration.d.ts",
    ],
  },
];

export default eslintConfig;
