import esbuild from 'rollup-plugin-esbuild';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';

export default {
  input: 'src/plugin/main.ts',
  output: {
    file: 'main.js',
    format: 'cjs',
    sourcemap: true
  },
  external: [
    'obsidian'
  ],
  plugins: [
    nodeResolve({ browser: true, extensions: ['.js', '.ts'] }),
    commonjs(),
    json(),
    esbuild({ include: /\.ts$|\.js$/, sourceMap: true, target: 'es2020', tsconfig: 'tsconfig.json' })
  ]
};
