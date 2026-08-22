const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

async function main() {
  console.log('Building adversarial test suite bundle with esbuild...');

  const mockFirebasePlugin = {
    name: 'mock-firebase',
    setup(build) {
      build.onResolve({ filter: /firebase(\.ts)?$/ }, args => {
        if (args.path.includes('firebase') && !args.path.includes('firebase/')) {
          return { path: args.path, namespace: 'mock-firebase' };
        }
      });
      build.onLoad({ filter: /.*/, namespace: 'mock-firebase' }, () => {
        return {
          contents: `
            export const initAuth = (onSuccess) => {
              if (onSuccess) onSuccess({ displayName: 'Alex Rivers', email: 'alex@example.com' }, 'mock-token');
              return () => {};
            };
            export const googleSignIn = async () => ({
              user: { displayName: 'Alex Rivers', email: 'alex@example.com' },
              accessToken: 'mock-token'
            });
            export const getAccessToken = async () => 'mock-token';
            export const logout = async () => {};
          `,
          loader: 'ts'
        };
      });
    }
  };

  await esbuild.build({
    entryPoints: ['test_harness_m3.tsx'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: 'dist/test_harness_m3.cjs',
    plugins: [mockFirebasePlugin],
    external: ['jsdom'],
    define: {
      'process.env.NODE_ENV': '"development"'
    },
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts'
    }
  });

  console.log('Bundle built: dist/test_harness_m3.cjs. Executing tests under Node...');

  const result = spawnSync('node', ['dist/test_harness_m3.cjs'], {
    stdio: 'inherit',
    cwd: __dirname
  });

  if (result.status !== 0) {
    console.error(`Tests failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

main().catch(err => {
  console.error('Fatal error running verification:', err);
  process.exit(1);
});
