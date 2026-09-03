import tseslint from 'typescript-eslint';

export default tseslint.config(
  // dist/ is generated; build.mjs and this file are build config that sits
  // outside the typechecked program.
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'build.mjs', 'eslint.config.js'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
