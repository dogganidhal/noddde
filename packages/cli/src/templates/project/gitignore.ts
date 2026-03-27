/** Generates .gitignore content. */
export function gitignoreTemplate(): string {
  return `node_modules/
dist/
.env
.env.local
*.tsbuildinfo
`;
}
