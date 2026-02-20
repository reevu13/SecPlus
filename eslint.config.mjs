import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...nextCoreWebVitals,
  {
    rules: {
      // This app intentionally uses effect-driven UI initialization in client pages.
      // Keep lint strict elsewhere while avoiding noisy false positives from this rule.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off'
    }
  },
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'coverage/**'
    ]
  }
];
