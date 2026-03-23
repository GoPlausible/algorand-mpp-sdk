import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['sdk/src/__tests__/*integration*.test.ts'],
        testTimeout: 60_000,
        globals: true,
        setupFiles: ['dotenv/config'],
    },
});
