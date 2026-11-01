import {defineConfig} from 'vitest/config';
export default defineConfig({test:{env:{OTEL_SDK_DISABLED:'true'},include:['test/**/*.test.ts'],fileParallelism:false,testTimeout:30000,hookTimeout:30000,coverage:{provider:'v8',include:['dist/**/*.js'],exclude:['dist/main.js','dist/oauth.js','dist/telemetry.js'],reporter:['text','json-summary']}}});
