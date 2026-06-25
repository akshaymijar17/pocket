module.exports = {
  env: { node: true, es2020: true },
  parserOptions: { ecmaVersion: 2020 },
  rules: {
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
  },
};
