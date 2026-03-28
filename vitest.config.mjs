export default {
  test: {
    include: ['tests/unit/*.test.mjs'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
};
