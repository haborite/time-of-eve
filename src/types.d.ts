declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "*.md" {
  const text: string;
  export default text;
}
