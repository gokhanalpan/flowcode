import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.flowcode.app',
  appName: 'FlowCode',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
