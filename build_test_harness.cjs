const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

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

async function build() {
  await esbuild.build({
    entryPoints: ['src/test-harness.tsx'],
    bundle: true,
    outfile: 'dist/test-bundle.js',
    plugins: [mockFirebasePlugin],
    define: {
      'process.env.NODE_ENV': '"development"'
    },
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts'
    }
  });

  const cssFile = fs.readdirSync('dist/assets').find(f => f.endsWith('.css'));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MailFlow Mobile Responsive Test Harness</title>
  <link rel="stylesheet" href="/assets/${cssFile}">
</head>
<body class="bg-slate-50 antialiased m-0 p-0 overflow-x-hidden">
  <div id="root"></div>
  <script src="/test-bundle.js"></script>
</body>
</html>`;

  fs.writeFileSync('dist/test.html', html);
  console.log('Built dist/test.html and dist/test-bundle.js successfully with mocked Firebase.');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
