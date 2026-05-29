// Cross-platform mac build that surfaces errors instead of silently
// dying like the npx invocation does.
const path = require('node:path');

(async () => {
  const { packager } = await import('@electron/packager');
  const root = path.join(__dirname, '..');
  try {
    const out = await packager({
      dir: root,
      name: 'Tack',
      platform: 'darwin',
      arch: 'universal',
      out: path.join(root, 'dist'),
      overwrite: true,
      icon: path.join(root, 'icon.icns'),
      appBundleId: 'com.willshow63.tack',
      extendInfo: { LSUIElement: true },
    });
    console.log('packager wrote:', out);
  } catch (e) {
    console.error('packager failed:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
